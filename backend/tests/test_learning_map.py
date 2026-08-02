from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.enums import AnalysisRunStatus, ProcessingStatus
from app.models import AnalysisRun, Base, Book, Chapter, SourceContentVersion, Vocabulary
from app.routers.analysis import get_analysis_service, learning_map_router
from app.services.analysis_service import AnalysisService
from app.services.source_content_service import build_source_content, source_content_hash
from app.utils.tokenizer import RebuildToken


BOOK_ID = "learning-map-fixture"


def _token(
    surface: str,
    reading: str,
    start: int,
    end: int,
    *,
    is_oov: bool = False,
    proper_noun: bool = False,
) -> RebuildToken:
    return RebuildToken(
        surface=surface,
        dictionary_form=surface,
        normalized_form=surface,
        part_of_speech=(
            "名詞",
            "固有名詞" if proper_noun else "普通名詞",
            "一般",
            "*",
            "*",
            "*",
        ),
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


class LearningMapTokenizer:
    def __init__(self, mode: str):
        self.mode = mode

    def tokenize_for_rebuild(self, text: str):
        fixtures = {
            "猫 猫": [_token("猫", "ネコ", 0, 1), _token("猫", "ネコ", 2, 3)],
            "本 猫": [_token("本", "ホン", 0, 1), _token("猫", "ネコ", 2, 3)],
            "山 QX 太郎": [
                _token("山", "ヤマ", 0, 1),
                _token("QX", "キュー", 2, 4, is_oov=True),
                _token("太郎", "タロウ", 5, 7, proper_noun=True),
            ],
        }
        return fixtures[text]

    @staticmethod
    def canonical_reading_for(token: RebuildToken):
        return token.reading_form


def _session_factory(tmp_path: Path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'learning-map.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _seed_source(Session):
    documents = []
    for index, (text, title) in enumerate([
        ("猫 猫", "Opening"),
        ("本 猫", "Library"),
        ("山 QX 太郎", "Mountain"),
    ]):
        documents.append({
            "document_id": f"chapter-{index}.xhtml",
            "text": text,
            "ruby_hints": [],
            "structural_boundaries": [],
            "reader_projection": {
                "reader_chapter_index": index,
                "text_spans": [{
                    "start_offset": 0,
                    "end_offset": len(text),
                    "reader_segment_index": 0,
                }],
            },
        })

    source_content = build_source_content(documents)
    session = Session()
    session.add(Book(
        id=BOOK_ID,
        title="Learning map fixture",
        status=ProcessingStatus.COMPLETED,
        source_rebuild_status="rebuildable",
        total_chapters=3,
    ))
    session.add_all([
        Chapter(book_id=BOOK_ID, index=0, title="Opening", content_json=[]),
        Chapter(book_id=BOOK_ID, index=1, title="Library", content_json=[]),
        Chapter(book_id=BOOK_ID, index=2, title="Mountain", content_json=[]),
    ])
    version = SourceContentVersion(
        book_id=BOOK_ID,
        source_file_sha256="c" * 64,
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


def _build_map(Session):
    session = Session()
    run = AnalysisService(
        session,
        tokenizer_factory=LearningMapTokenizer,
    ).rebuild_book_analysis(BOOK_ID, split_mode="B")
    assert run.status == AnalysisRunStatus.COMPLETED
    session.add_all([
        Vocabulary(
            book_id=BOOK_ID,
            word="猫",
            reading="ねこ",
            base_form="猫",
            status=3,
        ),
        Vocabulary(
            book_id=BOOK_ID,
            word="本",
            reading="ほん",
            base_form="本",
            status=1,
        ),
        Vocabulary(
            book_id=BOOK_ID,
            word="QX",
            reading="きゅー",
            base_form="QX",
            status=3,
        ),
    ])
    session.commit()
    return session


def test_learning_map_uses_only_explicit_canonical_known_and_prioritizes_upcoming(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = _build_map(Session)

    result = AnalysisService(session, tokenizer_factory=LearningMapTokenizer).get_learning_map(
        BOOK_ID,
        chapter_index=1,
    )

    assert result["knowledge_baseline_status"] == "ready"
    assert result["coverage"] == {
        "explicit_known_coverage": 3 / 7,
        "known_occurrences": 3,
        "eligible_occurrences": 7,
    }
    assert result["filter_spec"]["exclude_proper_nouns"] is False
    assert result["filter_spec"]["exclude_oov"] is False
    assert [point["required_lexeme_count"] for point in result["coverage_curve"]] == [4, 5, 5, 5]

    chapter_one = result["chapters"][1]
    assert chapter_one["title"] == "Library"
    assert chapter_one["eligible_occurrences"] == 2
    assert chapter_one["explicit_known_occurrences"] == 1
    assert chapter_one["unknown_occurrences"] == 1
    assert chapter_one["unknown_lexeme_count"] == 1
    assert chapter_one["new_lexeme_count"] == 1

    recommendations = result["recommended_lexemes"]
    assert recommendations[0]["normalized_form"] == "本"
    assert {item["normalized_form"] for item in recommendations} == {"本", "山", "太郎"}
    assert recommendations[0]["upcoming_chapter_occurrence_count"] == 1
    assert recommendations[0]["first_chapter_index"] == 1
    assert all(item["normalized_form"] != "猫" for item in recommendations)
    assert all(item["normalized_form"] != "QX" for item in recommendations)
    assert next(item for item in recommendations if item["normalized_form"] == "太郎")[
        "excluded_from_learning_target"
    ] is False
    session.close()


def test_learning_map_does_not_turn_vocab_or_missing_baseline_into_zero(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = Session()
    AnalysisService(session, tokenizer_factory=LearningMapTokenizer).rebuild_book_analysis(BOOK_ID)

    result = AnalysisService(session, tokenizer_factory=LearningMapTokenizer).get_learning_map(BOOK_ID)

    assert result["knowledge_baseline_status"] == "uninitialized"
    assert result["coverage"] is None
    assert result["recommended_lexemes"] == []
    assert result["chapters"][0]["explicit_known_occurrences"] is None
    assert result["chapters"][0]["unknown_occurrences"] is None
    assert result["chapters"][0]["new_lexeme_count"] == 1
    session.close()


def test_learning_map_filter_spec_controls_denominator_without_excluding_proper_nouns_by_default(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = _build_map(Session)
    run = session.query(AnalysisRun).filter(AnalysisRun.book_id == BOOK_ID).one()
    run.filter_spec = {
        "pos_allowlist": ["名詞", "動詞", "形容詞", "形状詞", "副詞"],
        "exclude_oov": True,
        "exclude_proper_nouns": False,
        "identity": "normalized_form_and_trusted_canonical_reading",
    }
    session.commit()

    result = AnalysisService(session, tokenizer_factory=LearningMapTokenizer).get_learning_map(BOOK_ID)

    assert result["coverage"]["eligible_occurrences"] == 6
    assert result["coverage"]["known_occurrences"] == 3
    assert result["filter_spec"]["exclude_oov"] is True
    assert {item["normalized_form"] for item in result["recommended_lexemes"]} == {"本", "山", "太郎"}
    session.close()


def test_learning_map_counts_duplicate_legacy_rows_as_mapped(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = _build_map(Session)
    session.query(Vocabulary).filter(
        Vocabulary.book_id == BOOK_ID,
        Vocabulary.base_form == "QX",
    ).one().status = 1
    session.add(Vocabulary(
        book_id=BOOK_ID,
        word="猫 ",
        reading="ねこ",
        base_form=" 猫 ",
        status=3,
    ))
    session.commit()

    result = AnalysisService(session, tokenizer_factory=LearningMapTokenizer).get_learning_map(BOOK_ID)

    assert result["knowledge_baseline_status"] == "ready"
    assert result["knowledge_baseline_migration_status"] == "ready"
    session.close()


def test_learning_map_handles_empty_filtered_denominator_without_dividing_by_zero(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = _build_map(Session)
    run = session.query(AnalysisRun).filter(AnalysisRun.book_id == BOOK_ID).one()
    run.filter_spec = {
        "pos_allowlist": ["動詞"],
        "exclude_oov": False,
        "exclude_proper_nouns": False,
        "identity": "normalized_form_and_trusted_canonical_reading",
    }
    session.commit()

    result = AnalysisService(session, tokenizer_factory=LearningMapTokenizer).get_learning_map(BOOK_ID)

    assert result["knowledge_baseline_status"] == "ready"
    assert result["coverage"] is None
    assert all(chapter["eligible_occurrences"] == 0 for chapter in result["chapters"])
    session.close()


def test_learning_map_returns_recoverable_state_without_active_analysis(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = Session()

    result = AnalysisService(session).get_learning_map(BOOK_ID)

    assert result["analysis_status"] == "needs_analysis"
    assert result["analysis_run_id"] is None
    assert result["knowledge_baseline_status"] == "uninitialized"
    assert result["coverage"] is None
    assert result["chapters"] == []
    assert result["filter_spec"]["pos_allowlist"] == ["名詞", "動詞", "形容詞", "形状詞", "副詞"]
    session.close()


def test_learning_map_router_returns_reproducible_run_and_filter_contract(tmp_path):
    Session = _session_factory(tmp_path)
    _seed_source(Session)
    session = _build_map(Session)
    session.close()

    app = FastAPI()
    app.include_router(learning_map_router)

    def override_service():
        request_session = Session()
        try:
            yield AnalysisService(request_session, tokenizer_factory=LearningMapTokenizer)
        finally:
            request_session.close()

    app.dependency_overrides[get_analysis_service] = override_service
    client = TestClient(app)

    response = client.get(f"/api/books/{BOOK_ID}/learning-map?chapter_index=1")

    assert response.status_code == 200
    body = response.json()
    assert body["book_id"] == BOOK_ID
    assert body["analysis_run_id"] is not None
    assert body["filter_spec"] == {
        "pos_allowlist": ["名詞", "動詞", "形容詞", "形状詞", "副詞"],
        "exclude_proper_nouns": False,
        "exclude_oov": False,
        "identity": "normalized_form_and_trusted_canonical_reading",
    }
    assert body["reading_anchor_chapter_index"] == 1
