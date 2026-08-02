from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.enums import AnalysisRunStatus, ProcessingStatus
from app.models import (
    AnalysisRun,
    Base,
    Book,
    Chapter,
    ChapterLexemeStat,
    Lexeme,
    LexemeOccurrence,
    RunLexeme,
    SourceContentVersion,
)
from app.routers.analysis import get_analysis_service, router as analysis_router
from app.services.analysis_service import AnalysisService
from app.services.source_content_service import (
    build_source_content,
    source_content_hash,
    source_documents_from_chapters,
)
from app.utils.domain import Chapter as ParsedChapter, ImageSegment, TextSegment
from app.utils.tokenizer import JapaneseTokenizer, RebuildToken


BOOK_ID = "analysis-fixture"


def _token(
    surface: str,
    normalized_form: str,
    reading: str,
    start: int,
    end: int,
    *,
    is_oov: bool = False,
) -> RebuildToken:
    return RebuildToken(
        surface=surface,
        dictionary_form=surface,
        normalized_form=normalized_form,
        part_of_speech=("名詞", "普通名詞", "一般", "*", "*", "*"),
        conjugation_type="*",
        conjugation_form="*",
        is_oov=is_oov,
        word_id=-1 if is_oov else 10,
        dictionary_id=-1 if is_oov else 0,
        reading_form=reading,
        reading_provenance="oov_guess" if is_oov else "sudachi_registered",
        reading_confidence="untrusted" if is_oov else "trusted",
        start_offset=start,
        end_offset=end,
    )


class FakeTokenizer:
    def __init__(self, mode: str):
        self.mode = mode

    def tokenize_for_rebuild(self, text: str):
        if text == "猫 QX QX":
            return [
                _token("猫", "猫", "ネコ", 0, 1),
                _token("QX", "QX", "キュー", 2, 4, is_oov=True),
                _token("QX", "QX", "キュウ", 5, 7, is_oov=True),
            ]
        if text == "猫":
            return [_token("猫", "猫", "ネコ", 0, 1)]
        raise AssertionError(f"Unexpected fixture text: {text}")

    @staticmethod
    def canonical_reading_for(token: RebuildToken):
        assert token.has_trusted_reading
        return token.reading_form


class BrokenTokenizer:
    def __init__(self, mode: str):
        self.mode = mode

    def tokenize_for_rebuild(self, _text: str):
        raise RuntimeError("forced rebuild failure")


class BoundaryTokenizer:
    def __init__(self, mode: str):
        self.mode = mode

    def tokenize_for_rebuild(self, text: str):
        assert text == "日\n本"
        return [
            _token("日", "日", "ヒ", 0, 1),
            _token("本", "本", "ホン", 2, 3),
        ]

    @staticmethod
    def canonical_reading_for(token: RebuildToken):
        return token.reading_form


def _session_factory(tmp_path: Path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'analysis.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _seed_source(Session) -> int:
    documents = [
        {
            "document_id": "chapter-0.xhtml",
            "text": "猫 QX QX",
            "ruby_hints": [],
            "structural_boundaries": [],
            "reader_projection": {
                "reader_chapter_index": 0,
                "text_spans": [
                    {"start_offset": 0, "end_offset": 7, "reader_segment_index": 0}
                ],
                "structural_boundaries": [],
            },
        },
        {
            "document_id": "chapter-1.xhtml",
            "text": "猫",
            "ruby_hints": [],
            "structural_boundaries": [],
            "reader_projection": {
                "reader_chapter_index": 1,
                "text_spans": [
                    {"start_offset": 0, "end_offset": 1, "reader_segment_index": 0}
                ],
                "structural_boundaries": [],
            },
        },
    ]
    source_content = build_source_content(documents)
    session = Session()
    session.add(Book(
        id=BOOK_ID,
        title="Analysis fixture",
        status=ProcessingStatus.COMPLETED,
        source_rebuild_status="rebuildable",
        total_chapters=2,
    ))
    session.add_all([
        Chapter(book_id=BOOK_ID, index=0, title="One", content_json=[]),
        Chapter(book_id=BOOK_ID, index=1, title="Two", content_json=[]),
    ])
    version = SourceContentVersion(
        book_id=BOOK_ID,
        source_file_sha256="a" * 64,
        parser_version="fixture-parser",
        source_schema_version=source_content["schema_version"],
        source_content_sha256=source_content_hash(source_content),
        source_content_json=source_content,
    )
    session.add(version)
    session.commit()
    version_id = version.id
    session.close()
    return version_id


def _seed_single_document_source(Session, document: dict) -> int:
    source_content = build_source_content([document])
    session = Session()
    session.add(Book(
        id=BOOK_ID,
        title="Boundary fixture",
        status=ProcessingStatus.COMPLETED,
        source_rebuild_status="rebuildable",
        total_chapters=1,
    ))
    session.add(Chapter(book_id=BOOK_ID, index=0, title="One", content_json=[]))
    version = SourceContentVersion(
        book_id=BOOK_ID,
        source_file_sha256="b" * 64,
        parser_version="fixture-parser",
        source_schema_version=source_content["schema_version"],
        source_content_sha256=source_content_hash(source_content),
        source_content_json=source_content,
    )
    session.add(version)
    session.commit()
    version_id = version.id
    session.close()
    return version_id


def test_rebuild_publishes_complete_index_and_reuses_provisional_identity(tmp_path):
    Session = _session_factory(tmp_path)
    source_version_id = _seed_source(Session)
    session = Session()
    service = AnalysisService(session, tokenizer_factory=FakeTokenizer)

    first = service.rebuild_book_analysis(
        BOOK_ID,
        source_content_version_id=source_version_id,
        split_mode="B",
    )

    assert first.status == AnalysisRunStatus.COMPLETED
    assert first.is_active is True
    assert first.source_content_version_id == source_version_id
    assert (first.lexeme_count, first.occurrence_count, first.chapter_stat_count) == (2, 4, 3)
    assert session.query(Lexeme).count() == 2
    assert session.query(RunLexeme).count() == 3
    assert session.query(LexemeOccurrence).count() == 4
    assert session.query(ChapterLexemeStat).count() == 3

    provisional = session.query(Lexeme).filter(Lexeme.normalized_form == "QX").one()
    assert provisional.is_provisional is True
    assert provisional.canonical_reading_kana is None
    assert session.query(RunLexeme).filter(RunLexeme.lexeme_id == provisional.id).count() == 2

    cat = session.query(Lexeme).filter(Lexeme.normalized_form == "猫").one()
    assert cat.is_provisional is False
    assert cat.canonical_reading_kana == "ねこ"
    run, stats = service.get_active_lexeme_stats(BOOK_ID)
    assert run.id == first.id
    assert {item["normalized_form"]: item["occurrence_count"] for item in stats} == {
        "QX": 2,
        "猫": 2,
    }

    run, occurrences = service.get_active_lexeme_occurrences(BOOK_ID, provisional.id)
    assert run.id == first.id
    assert [
        (row["source_document_id"], row["source_start"], row["source_end"])
        for row in occurrences
    ] == [
        ("chapter-0.xhtml", 2, 4),
        ("chapter-0.xhtml", 5, 7),
    ]

    second = service.rebuild_book_analysis(BOOK_ID, split_mode="B")
    assert second.id != first.id
    assert second.result_sha256 == first.result_sha256
    assert second.is_active is True
    assert session.get(AnalysisRun, first.id).is_active is False
    assert session.query(Lexeme).count() == 2
    assert service.delete_run(first.id) is True
    assert session.query(AnalysisRun).count() == 1
    assert session.query(Lexeme).count() == 2
    assert service.delete_run(second.id) is True
    assert service.get_active_run(BOOK_ID) is None
    assert session.query(LexemeOccurrence).count() == 0
    assert session.query(ChapterLexemeStat).count() == 0
    assert session.query(Lexeme).count() == 2
    session.close()


def test_failed_rebuild_does_not_replace_active_run(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = Session()
    active = AnalysisService(
        session,
        tokenizer_factory=FakeTokenizer,
    ).rebuild_book_analysis(BOOK_ID)

    failed = AnalysisService(
        session,
        tokenizer_factory=BrokenTokenizer,
    ).rebuild_book_analysis(BOOK_ID)

    assert failed.status == AnalysisRunStatus.FAILED
    assert failed.is_active is False
    assert "forced rebuild failure" in failed.error_message
    assert AnalysisService(session).get_active_run(BOOK_ID).id == active.id
    assert session.query(LexemeOccurrence).filter(
        LexemeOccurrence.analysis_run_id == failed.id
    ).count() == 0
    assert session.query(ChapterLexemeStat).filter(
        ChapterLexemeStat.analysis_run_id == failed.id
    ).count() == 0
    session.close()


def test_invalid_split_mode_is_recorded_as_failed_run(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = Session()

    run = AnalysisService(session, tokenizer_factory=FakeTokenizer).rebuild_book_analysis(
        BOOK_ID,
        split_mode="Z",
    )

    assert run.status == AnalysisRunStatus.FAILED
    assert run.is_active is False
    assert run.error_message == "split_mode must be one of A, B, or C"
    assert session.query(AnalysisRun).count() == 1
    assert AnalysisService(session).get_active_run(BOOK_ID) is None
    session.close()


def test_invalid_source_contract_does_not_publish_an_empty_active_run(tmp_path):
    Session = _session_factory(tmp_path)
    source_version_id = _seed_source(Session)
    session = Session()
    active = AnalysisService(
        session,
        tokenizer_factory=FakeTokenizer,
    ).rebuild_book_analysis(BOOK_ID)

    version = session.get(SourceContentVersion, source_version_id)
    malformed_content = {
        "schema_version": version.source_schema_version,
        "offset_unit": "unicode_codepoint",
    }
    version.source_content_json = malformed_content
    version.source_content_sha256 = source_content_hash(malformed_content)
    session.commit()

    failed = AnalysisService(
        session,
        tokenizer_factory=FakeTokenizer,
    ).rebuild_book_analysis(BOOK_ID, source_content_version_id=source_version_id)

    assert failed.status == AnalysisRunStatus.FAILED
    assert failed.is_active is False
    assert "documents must be a list" in failed.error_message
    assert failed.occurrence_count == 0
    assert AnalysisService(session).get_active_run(BOOK_ID).id == active.id
    session.close()


def test_invalid_projection_span_is_rejected_before_run_publication(tmp_path):
    Session = _session_factory(tmp_path)
    source_version_id = _seed_source(Session)
    session = Session()
    version = session.get(SourceContentVersion, source_version_id)
    malformed_content = build_source_content([{
        "document_id": "chapter-0.xhtml",
        "text": "猫",
        "ruby_hints": [],
        "structural_boundaries": [],
        "reader_projection": {
            "reader_chapter_index": 0,
            "text_spans": [{
                "start_offset": 0,
                "end_offset": 2,
                "reader_segment_index": 0,
            }],
        },
    }])
    version.source_content_json = malformed_content
    version.source_content_sha256 = source_content_hash(malformed_content)
    session.commit()

    failed = AnalysisService(
        session,
        tokenizer_factory=FakeTokenizer,
    ).rebuild_book_analysis(BOOK_ID, source_content_version_id=source_version_id)

    assert failed.status == AnalysisRunStatus.FAILED
    assert failed.is_active is False
    assert "Reader text span" in failed.error_message
    assert AnalysisService(session).get_active_run(BOOK_ID) is None
    session.close()


def test_epub_image_boundary_schema_publishes_active_analysis_run(tmp_path):
    Session = _session_factory(tmp_path)
    source_version_id = _seed_single_document_source(Session, {
        "document_id": "chapter-0.xhtml",
        "text": "日\n本",
        "ruby_hints": [],
        # This is the existing EPUB producer shape.
        "structural_boundaries": [{
            "offset": 1,
            "end_offset": 2,
            "text": "\n",
            "reason": "image",
        }],
        "reader_projection": {
            "reader_chapter_index": 0,
            "text_spans": [
                {"start_offset": 0, "end_offset": 1, "reader_segment_index": 0},
                {"start_offset": 2, "end_offset": 3, "reader_segment_index": 2},
            ],
        },
    })
    session = Session()

    run = AnalysisService(
        session,
        tokenizer_factory=BoundaryTokenizer,
    ).rebuild_book_analysis(BOOK_ID, source_content_version_id=source_version_id)

    assert run.status == AnalysisRunStatus.COMPLETED
    assert run.is_active is True
    assert run.occurrence_count == 2
    assert {row.normalized_form for row in session.query(Lexeme).all()} == {"日", "本"}
    session.close()


def test_fallback_image_boundary_schema_publishes_without_joining_words(tmp_path):
    parsed_chapter = ParsedChapter("Fallback", 0)
    parsed_chapter.segments = [
        TextSegment("日"),
        ImageSegment("/static/books/fallback/images/page.png"),
        TextSegment("本"),
    ]
    document = source_documents_from_chapters([parsed_chapter])[0]
    assert document["structural_boundaries"] == [{
        "offset": 1,
        "text": "\n",
        "reason": "non_text_segment",
        "reader_segment_index": 1,
    }]

    Session = _session_factory(tmp_path)
    source_version_id = _seed_single_document_source(Session, document)
    session = Session()
    run = AnalysisService(
        session,
        tokenizer_factory=BoundaryTokenizer,
    ).rebuild_book_analysis(BOOK_ID, source_content_version_id=source_version_id)

    assert run.status == AnalysisRunStatus.COMPLETED
    assert run.is_active is True
    assert run.occurrence_count == 2
    assert session.query(Lexeme).filter(Lexeme.normalized_form == "日本").count() == 0
    session.close()


def test_deleting_book_discards_analysis_rows_but_keeps_shared_lexemes(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = Session()
    AnalysisService(
        session,
        tokenizer_factory=FakeTokenizer,
    ).rebuild_book_analysis(BOOK_ID)

    session.delete(session.get(Book, BOOK_ID))
    session.commit()

    assert session.query(AnalysisRun).count() == 0
    assert session.query(RunLexeme).count() == 0
    assert session.query(LexemeOccurrence).count() == 0
    assert session.query(ChapterLexemeStat).count() == 0
    assert session.query(Lexeme).count() == 2
    session.close()


def test_internal_analysis_router_exposes_stats_and_occurrences(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    app = FastAPI()
    app.include_router(analysis_router)

    def override_service():
        session = Session()
        try:
            yield AnalysisService(session, tokenizer_factory=FakeTokenizer)
        finally:
            session.close()

    app.dependency_overrides[get_analysis_service] = override_service
    client = TestClient(app)

    rebuilt = client.post(
        f"/api/internal/books/{BOOK_ID}/analysis-runs",
        json={"split_mode": "B"},
    )
    assert rebuilt.status_code == 200
    assert rebuilt.json()["status"] == "completed"

    index = client.get(f"/api/internal/books/{BOOK_ID}/analysis/lexemes")
    assert index.status_code == 200
    body = index.json()
    assert body["run"]["source_content_version_id"] == rebuilt.json()["source_content_version_id"]
    assert sum(item["occurrence_count"] for item in body["lexemes"]) == 4

    provisional = next(item for item in body["lexemes"] if item["is_provisional"])
    occurrence_response = client.get(
        f"/api/internal/books/{BOOK_ID}/analysis/lexemes/"
        f"{provisional['lexeme_id']}/occurrences"
    )
    assert occurrence_response.status_code == 200
    assert [item["surface"] for item in occurrence_response.json()["occurrences"]] == [
        "QX",
        "QX",
    ]


def test_canonical_reading_rejects_context_specific_surface_reading():
    tokenizer = JapaneseTokenizer(mode="B")
    tokens = tokenizer.tokenize_for_rebuild("あの方は食べた")
    person = next(token for token in tokens if token.surface == "方")
    inflected = next(token for token in tokens if token.surface == "食べ")

    assert person.reading_form == "カタ"
    assert tokenizer.canonical_reading_for(person) is None
    assert tokenizer.canonical_reading_for(inflected) == "タベル"
