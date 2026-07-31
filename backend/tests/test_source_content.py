from __future__ import annotations

import hashlib
from pathlib import Path

from ebooklib import epub
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.enums import ProcessingStatus
from app.models import Base, Book, BookSourceFile, SourceContentVersion, SourceRubyHint
from app.schemas import ChapterResponse
from app.services.book_service import BookService
from app.services.source_content_service import attach_reader_projections, source_documents_from_chapters
from app.utils.domain import Chapter, ImageSegment, TextSegment
from app.utils.parsers.epub_parser import LightNovelParser
from app.utils.tokenizer import JapaneseTokenizer


def _write_epub(path: Path, body: str, *, include_image: bool = False) -> None:
    book = epub.EpubBook()
    book.set_identifier("source-content-fixture")
    book.set_title("Source content fixture")
    book.set_language("ja")
    chapter = epub.EpubHtml(title="Fixture", file_name="fixture.xhtml", lang="ja")
    chapter.content = f"<html><body>{body}</body></html>"
    book.add_item(chapter)
    if include_image:
        book.add_item(epub.EpubItem(
            uid="page-image",
            file_name="images/page.png",
            media_type="image/png",
            content=b"source-content-image",
        ))
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.toc = (epub.Link("fixture.xhtml", "Fixture", "fixture"),)
    book.spine = ["nav", chapter]
    epub.write_epub(str(path), book)


def _session_factory(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'library.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _write_multi_spine_epub(path: Path) -> None:
    book = epub.EpubBook()
    book.set_identifier("source-projection-fixture")
    book.set_title("Source projection fixture")
    book.set_language("ja")
    empty = epub.EpubHtml(uid="empty", title="Empty", file_name="empty.xhtml", lang="ja")
    # A zero-width-only body is valid XHTML but produces no reader segment.
    empty.content = "<html><body><p>\u200b</p></body></html>"
    first = epub.EpubHtml(uid="first", title="Merged", file_name="first.xhtml", lang="ja")
    first.content = "<html><body><p>第一部</p></body></html>"
    second = epub.EpubHtml(uid="second", title="Merged", file_name="second.xhtml", lang="ja")
    second.content = "<html><body><p>第二部</p></body></html>"
    for item in (empty, first, second, epub.EpubNcx(), epub.EpubNav()):
        book.add_item(item)
    book.toc = (
        epub.Link("first.xhtml", "Merged", "first"),
        epub.Link("second.xhtml", "Merged", "second"),
    )
    book.spine = ["nav", empty, first, second]
    epub.write_epub(str(path), book)


def test_epub_ruby_source_hints_preserve_variants_and_offsets(tmp_path):
    source = tmp_path / "ruby.epub"
    _write_epub(
        source,
        "<p>前<ruby>漢字<rt>かんじ</rt></ruby>後</p>"
        "<p><ruby>語<rp>(</rp><rt>ご</rt><rp>)</rp></ruby></p>"
        "<p><ruby><rb>本気</rb><rp>(</rp><rt>マジ</rt><rp>)</rp></ruby></p>",
    )

    parser = LightNovelParser(str(source), "book-ruby", str(tmp_path / "books"))
    parsed = parser.parse()

    assert parsed  # Existing render parser remains usable.
    hints = [hint for document in parser.source_documents for hint in document["ruby_hints"]]
    assert [(hint["base_text"], hint["reading_raw"]) for hint in hints] == [
        ("漢字", "かんじ"), ("語", "ご"), ("本気", "マジ"),
    ]
    assert hints[1]["markup"]["has_rp"] is True
    assert hints[2]["markup"]["has_rb"] is True
    for document in parser.source_documents:
        for hint in document["ruby_hints"]:
            assert document["text"][hint["start_offset"]:hint["end_offset"]] == hint["base_text"]


def test_epub_ruby_hint_offsets_are_remapped_with_source_normalization(tmp_path):
    source = tmp_path / "normalized-ruby.epub"
    _write_epub(
        source,
        "<p>前<ruby>漢\u200b字<rt>かんじ</rt></ruby>後</p>",
    )

    parser = LightNovelParser(str(source), "normalized-ruby", str(tmp_path / "books"))
    parser.parse()

    document = next(document for document in parser.source_documents if document["ruby_hints"])
    hint = document["ruby_hints"][0]
    assert document["text"] == "前漢字後\n"
    assert hint["base_text_raw"] == "漢\u200b字"
    assert hint["base_text"] == "漢字"
    assert document["text"][hint["start_offset"]:hint["end_offset"]] == "漢字"


@pytest.mark.parametrize(
    ("body", "expected_text"),
    [
        ("<p>A\u200bB</p>", "AB\n"),
        ("<p>A\n\n\nB</p>", "A\n\nB\n"),
    ],
)
def test_epub_import_normalizes_source_and_reader_in_one_coordinate_space(
    tmp_path, monkeypatch, body, expected_text
):
    import app.database as database_module
    import app.services.book_service as book_service_module
    import app.services.source_content_service as source_module

    source_root = tmp_path / "private-sources"
    upload_dir = tmp_path / "books"
    monkeypatch.setattr(source_module, "SOURCE_FILES_DIR", str(source_root))
    monkeypatch.setattr(book_service_module, "UPLOAD_DIR", str(upload_dir))
    Session = _session_factory(tmp_path)
    monkeypatch.setattr(database_module, "SessionLocal", Session)

    uploaded = tmp_path / "coordinate-space.epub"
    _write_epub(uploaded, body)

    # Capture the reader text before the import path tokenizes and clears it.
    expected_parser = LightNovelParser(str(uploaded), "expected", str(tmp_path / "expected-books"))
    expected_chapters = expected_parser.parse()
    expected_segments = {
        document_id: [
            segment.text
            for segment in chapter.segments[:segment_count]
            if isinstance(segment, TextSegment) and segment.text
        ]
        for chapter in expected_chapters
        for document_id, segment_count in chapter.source_document_segment_counts
    }

    session = Session()
    session.add(Book(id="coordinate-space", title="Coordinate space", status=ProcessingStatus.PENDING))
    session.commit()
    session.close()

    BookService(Session()).process_book_task("coordinate-space", str(uploaded), ".epub")

    session = Session()
    book = session.get(Book, "coordinate-space")
    version = session.query(SourceContentVersion).one()
    assert not uploaded.exists()
    assert book.status == ProcessingStatus.COMPLETED
    assert book.source_rebuild_status == "rebuildable"
    assert version.source_schema_version == 4

    document = next(
        document for document in version.source_content_json["documents"]
        if document["text"] == expected_text
    )
    projection = document["reader_projection"]
    projected_text = [
        document["text"][span["start_offset"]:span["end_offset"]]
        for span in projection["text_spans"]
    ]
    assert projected_text == expected_segments[document["document_id"]]
    assert document["text"] == expected_text
    session.close()


def test_epub_import_preserves_distinct_reader_spans_across_image_boundary(tmp_path, monkeypatch):
    import app.database as database_module
    import app.services.book_service as book_service_module
    import app.services.source_content_service as source_module

    source_root = tmp_path / "private-sources"
    monkeypatch.setattr(source_module, "SOURCE_FILES_DIR", str(source_root))
    monkeypatch.setattr(book_service_module, "UPLOAD_DIR", str(tmp_path / "books"))
    Session = _session_factory(tmp_path)
    monkeypatch.setattr(database_module, "SessionLocal", Session)

    uploaded = tmp_path / "image-boundary.epub"
    _write_epub(
        uploaded,
        "<p>A\n\n</p><img src=\"images/page.png\"/><p>\nB</p>",
        include_image=True,
    )
    session = Session()
    session.add(Book(id="image-boundary", title="Image boundary", status=ProcessingStatus.PENDING))
    session.commit()
    session.close()

    BookService(Session()).process_book_task("image-boundary", str(uploaded), ".epub")

    session = Session()
    book = session.get(Book, "image-boundary")
    version = session.query(SourceContentVersion).one()
    document = next(
        document for document in version.source_content_json["documents"]
        if document["text"] == "A\n\n\n\nB\n"
    )
    spans = document["reader_projection"]["text_spans"]
    assert not uploaded.exists()
    assert book.status == ProcessingStatus.COMPLETED
    assert book.source_rebuild_status == "rebuildable"
    assert version.source_schema_version == 4
    assert [
        document["text"][span["start_offset"]:span["end_offset"]]
        for span in spans
    ] == ["A\n\n", "\nB\n"]
    assert spans[0]["end_offset"] <= spans[1]["start_offset"]
    assert document["structural_boundaries"] == [{
        "offset": 3,
        "end_offset": 4,
        "text": "\n",
        "reason": "image",
    }]
    session.close()


def test_merged_epub_source_documents_project_to_final_reader_chapter(tmp_path):
    source = tmp_path / "merged.epub"
    _write_multi_spine_epub(source)
    parser = LightNovelParser(str(source), "book-projection", str(tmp_path / "books"))
    original_chapters = parser.parse()

    merged = BookService.__new__(BookService)._merge_chapters(original_chapters)
    attach_reader_projections(parser.source_documents, merged)
    documents = {document["document_id"]: document for document in parser.source_documents}

    merged_chapter = next(chapter for chapter in merged if chapter.title == "Merged")
    for document_id, text in (("first", "第一部"), ("second", "第二部")):
        projection = documents[document_id]["reader_projection"]
        assert projection["reader_chapter_index"] == merged_chapter.index
        span = projection["text_spans"][0]
        assert documents[document_id]["text"][span["start_offset"]:span["end_offset"]] == f"{text}\n"
    # The nav and empty spine documents remain source material but do not
    # pretend to map to a reader chapter that was never rendered.
    assert "reader_projection" not in documents["empty"]


def test_pdf_fallback_keeps_image_boundary_out_of_rebuilt_words():
    chapter = Chapter("PDF", 0)
    chapter.segments = [
        TextSegment("日"),
        ImageSegment("/static/books/pdf/images/page.png"),
        TextSegment("本"),
    ]

    document = source_documents_from_chapters([chapter])[0]
    assert document["text"] == "日\n本"
    assert document["reader_projection"]["text_spans"] == [
        {"start_offset": 0, "end_offset": 1, "reader_segment_index": 0},
        {"start_offset": 2, "end_offset": 3, "reader_segment_index": 2},
    ]
    assert document["reader_projection"]["structural_boundaries"] == [{
        "offset": 1,
        "text": "\n",
        "reason": "non_text_segment",
        "reader_segment_index": 1,
    }]
    assert "日本" not in [token.surface for token in JapaneseTokenizer().tokenize_for_rebuild(document["text"])]


@pytest.mark.parametrize(
    ("file_ext", "payload"),
    [(".epub", b"immutable epub bytes"), (".pdf", b"immutable pdf bytes")],
)
def test_successful_import_keeps_private_source_and_version_after_temp_cleanup(
    tmp_path, monkeypatch, file_ext, payload
):
    import app.database as database_module
    import app.services.source_content_service as source_module

    source_root = tmp_path / "private-sources"
    monkeypatch.setattr(source_module, "SOURCE_FILES_DIR", str(source_root))
    Session = _session_factory(tmp_path)
    monkeypatch.setattr(database_module, "SessionLocal", Session)

    initial = Session()
    initial.add(Book(id="book-source", title="Fixture", status=ProcessingStatus.PENDING))
    initial.commit()
    initial.close()

    temp_file = tmp_path / f"upload{file_ext}"
    temp_file.write_bytes(payload)
    parser_chapter = Chapter("Fixture", 0)
    parser_chapter.segments.append(TextSegment("行なう"))
    parser_chapter.source_document_segment_counts.append(("fixture.xhtml", 1))

    class FakeParser:
        source_documents = [{
            "document_id": "fixture.xhtml",
            "spine_index": 0,
            "text": "行なう",
            "ruby_hints": [{
                "start_offset": 0,
                "end_offset": 3,
                "base_text": "行なう",
                "reading_raw": "おこなう",
                "markup": {"element": "ruby", "has_rb": False, "has_rp": False},
                "provenance": "epub_ruby",
            }],
        }]

        def parse(self, *_args):
            return [parser_chapter]

    service = BookService(Session())
    monkeypatch.setattr(service, "_create_parser", lambda *_: FakeParser())
    service.process_book_task("book-source", str(temp_file), file_ext)

    assert not temp_file.exists()
    session = Session()
    stored_file = session.query(BookSourceFile).one()
    version = session.query(SourceContentVersion).one()
    hint = session.query(SourceRubyHint).one()
    private_file = source_root / stored_file.relative_path
    assert private_file.read_bytes() == payload
    assert stored_file.file_type == file_ext.lstrip(".")
    assert stored_file.sha256 == hashlib.sha256(payload).hexdigest()
    assert version.source_file_sha256 == stored_file.sha256
    assert version.source_schema_version == 4
    assert hint.source_content_version_id == version.id
    document = version.source_content_json["documents"][0]
    assert document["text"][hint.start_offset:hint.end_offset] == hint.base_text
    assert document["reader_projection"]["reader_chapter_index"] == 0
    assert session.get(Book, "book-source").source_rebuild_status == "rebuildable"
    session.close()


def test_deleting_book_removes_private_source_and_source_records(tmp_path, monkeypatch):
    import app.services.source_content_service as source_module
    from app.services.source_content_service import build_source_content, copy_immutable_source, create_source_records

    source_root = tmp_path / "private-sources"
    monkeypatch.setattr(source_module, "SOURCE_FILES_DIR", str(source_root))
    Session = _session_factory(tmp_path)
    uploaded = tmp_path / "upload.pdf"
    uploaded.write_bytes(b"pdf")
    relative_path, source_hash = copy_immutable_source(str(uploaded), "delete-me", ".pdf")
    source_file, version = create_source_records(
        book_id="delete-me",
        file_ext=".pdf",
        relative_path=relative_path,
        source_file_sha256=source_hash,
        source_content=build_source_content([]),
    )
    session = Session()
    session.add(Book(id="delete-me", title="Delete", status=ProcessingStatus.COMPLETED,
                     source_rebuild_status="rebuildable"))
    session.add(source_file)
    session.add(version)
    session.commit()

    assert BookService(session).delete_book("delete-me") is True
    assert not (source_root / "delete-me").exists()
    assert session.query(BookSourceFile).count() == 0
    assert session.query(SourceContentVersion).count() == 0


def test_deferred_source_cleanup_is_retried_after_finalization_failure(tmp_path, monkeypatch):
    import app.services.source_content_service as source_module
    from app.services.source_content_service import build_source_content, copy_immutable_source, create_source_records

    source_root = tmp_path / "private-sources"
    monkeypatch.setattr(source_module, "SOURCE_FILES_DIR", str(source_root))
    Session = _session_factory(tmp_path)
    uploaded = tmp_path / "upload.epub"
    uploaded.write_bytes(b"epub")
    relative_path, source_hash = copy_immutable_source(str(uploaded), "retry-cleanup", ".epub")
    source_file, version = create_source_records(
        book_id="retry-cleanup",
        file_ext=".epub",
        relative_path=relative_path,
        source_file_sha256=source_hash,
        source_content=build_source_content([]),
    )
    session = Session()
    session.add(Book(id="retry-cleanup", title="Retry", status=ProcessingStatus.COMPLETED,
                     source_rebuild_status="rebuildable"))
    session.add_all([source_file, version])
    session.commit()

    original_rmtree = source_module.shutil.rmtree
    monkeypatch.setattr(source_module.shutil, "rmtree", lambda _path: (_ for _ in ()).throw(OSError("busy")))
    assert BookService(session).delete_book("retry-cleanup") is True
    cleanup_root = source_root / ".cleanup"
    assert any(cleanup_root.iterdir())
    assert session.get(Book, "retry-cleanup") is None

    monkeypatch.setattr(source_module.shutil, "rmtree", original_rmtree)
    assert source_module.recover_staged_source_removals() == 1
    assert not cleanup_root.exists()


def test_actual_application_serves_book_images_and_rejects_private_sources(tmp_path, monkeypatch):
    import main as main_module

    books_dir = tmp_path / "books"
    image_path = books_dir / "book" / "images" / "cover.txt"
    image_path.parent.mkdir(parents=True)
    image_path.write_bytes(b"cover")

    book_static_route = next(
        route for route in main_module.app.routes
        if getattr(route, "name", None) == "book-static"
    )
    monkeypatch.setattr(book_static_route.app, "directory", str(books_dir))
    monkeypatch.setattr(book_static_route.app, "all_directories", [str(books_dir)])
    client = TestClient(main_module.app)

    assert client.get("/static/books/book/images/cover.txt").content == b"cover"
    private_response = client.get("/static/sources/book/original.epub")
    assert private_response.status_code == 404


def test_rebuild_token_contract_preserves_semantics_without_changing_ui_token_shape():
    tokenizer = JapaneseTokenizer()
    records = tokenizer.tokenize_for_rebuild("行なう QWERTY")
    spelling = next(record for record in records if record.surface == "行なう")
    oov = next(record for record in records if record.surface == "QWERTY")

    assert spelling.normalized_form == "行う"
    assert len(spelling.part_of_speech) == 6
    assert spelling.part_of_speech[0] == "動詞"
    assert spelling.conjugation_type == "五段-ワア行"
    assert spelling.conjugation_form == "終止形-一般"
    assert spelling.word_id >= 0
    assert spelling.dictionary_id >= 0
    assert spelling.reading_provenance == "sudachi_registered"
    assert spelling.has_trusted_reading is True
    assert oov.is_oov is True
    assert oov.reading_provenance == "oov_guess"
    assert oov.reading_confidence == "untrusted"
    assert oov.has_trusted_reading is False

    ui_token = tokenizer.process_text("行なう")[0].to_dict()
    assert set(ui_token).issubset({"s", "r", "b", "p", "gap", "RUBY"})
    response = ChapterResponse(
        index=0,
        title="Fixture",
        segments=[{"type": "text", "tokens": [ui_token]}],
    )
    assert response.segments[0].tokens[0].s == "行なう"
