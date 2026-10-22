from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote
from zipfile import ZipFile
import xml.etree.ElementTree as ET

from ebooklib import epub
import pytest

from app.services.source_content_service import attach_reader_projections
from app.utils.domain import ImageSegment, TextSegment
from app.utils.parsers.epub_parser import LightNovelParser


def _parse(tmp_path, body, *, toc_title=None, images=(), document_path="text/chapter.xhtml"):
    book = epub.EpubBook()
    book.set_identifier("reader-regressions")
    book.set_title("Reader regressions")
    book.set_language("ja")
    chapter = epub.EpubHtml(uid="chapter", file_name=document_path, lang="ja")
    chapter.content = f'<html xmlns="http://www.w3.org/1999/xhtml"><body>{body}</body></html>'
    book.add_item(chapter)
    for index, (name, content) in enumerate(images):
        book.add_item(epub.EpubItem(
            uid=f"image-{index}", file_name=name, media_type="image/png", content=content,
        ))
    book.add_item(epub.EpubNcx())
    book.toc = (epub.Link(document_path, toc_title, "chapter"),) if toc_title else (epub.Link("other.xhtml", "Other", "other"),)
    book.spine = [chapter]
    source = tmp_path / "fixture.epub"
    epub.write_epub(str(source), book)
    parser = LightNovelParser(str(source), "fixture", str(tmp_path / "books"))
    chapters = parser.parse()
    attach_reader_projections(parser.source_documents, chapters)
    return parser, chapters


def _assert_text_projection(parser, chapters, expected):
    assert len(chapters) == 1
    texts = [segment.text for segment in chapters[0].segments if isinstance(segment, TextSegment)]
    assert "".join(texts) == expected
    document = parser.source_documents[0]
    assert document["text"] == expected
    assert [
        document["text"][span["start_offset"]:span["end_offset"]]
        for span in document["reader_projection"]["text_spans"]
    ] == texts
    for hint in document["ruby_hints"]:
        assert document["text"][hint["start_offset"]:hint["end_offset"]] == hint["base_text"]


@pytest.mark.parametrize(("body", "toc_title", "expected"), [
    ('<p>前。「会話」後。</p>', "目次の章", '前。「会話」後。\n'),
    ('<h1>章見出し</h1><p>前。『会話』後。</p>', None, '章見出し\n前。『会話』後。\n'),
    ('<p>「会話」続き。</p>', None, '「会話」続き。\n'),
    ('<p>前。「<ruby>漢字<rt>かんじ</rt></ruby>」後。</p>', "目次の章", '前。「漢字」後。\n'),
])
def test_title_labels_never_remove_dialogue(tmp_path, body, toc_title, expected):
    parser, chapters = _parse(tmp_path, body, toc_title=toc_title)
    _assert_text_projection(parser, chapters, expected)
    if "<ruby>" in body:
        assert [(hint["base_text"], hint["reading_raw"]) for hint in parser.source_documents[0]["ruby_hints"]] == [("漢字", "かんじ")]
    if toc_title:
        assert chapters[0].title == toc_title


@pytest.mark.parametrize(("body", "expected"), [
    ('<p>A<span> </span>B<span>　</span>C</p>', 'A B　C\n'),
    ('<p>A <ruby>漢<span> </span>字<rt>かんじ</rt></ruby> B</p>', 'A 漢 字 B\n'),
    ('\n  <div>\n    <p>A</p>\n    <p>B</p>\n  </div>\n', 'A\nB\n'),
    ('<div><p>A</p> <p>B</p></div>', 'A\nB\n'),
    ('<p>\n <ruby>\n <rb>漢</rb>\n <rb>字</rb>\n <rt>かんじ</rt>\n </ruby>\n </p>', '漢字\n'),
])
def test_inline_spaces_and_markup_indentation_share_reader_coordinates(tmp_path, body, expected):
    parser, chapters = _parse(tmp_path, body)
    _assert_text_projection(parser, chapters, expected)


def test_images_resolve_relative_paths_without_basename_collisions(tmp_path):
    parser, chapters = _parse(
        tmp_path,
        '<img src="../a/page.png"/><img src="../b/page.png"/>'
        '<img src="../images/space%20name.png?size=1#part"/>'
        '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../a/./page.png"/></svg>',
        images=(("a/page.png", b"first"), ("b/page.png", b"second"), ("images/space name.png", b"encoded")),
    )
    sources = [segment.src for segment in chapters[0].segments if isinstance(segment, ImageSegment)]
    assert len(sources) == 4
    assert sources[0] != sources[1]
    assert sources[0] == sources[3]
    assert [
        (Path(parser.image_output_dir) / source.rsplit("/", 1)[-1]).read_bytes()
        for source in sources
    ] == [b"first", b"second", b"encoded", b"first"]
    assert parser._find_image_web_path("missing/page.png") is None
    assert parser._find_image_web_path("missing/space%20name.png") == sources[2]


def test_image_resolution_prefers_current_document_directory(tmp_path):
    parser, chapters = _parse(
        tmp_path, '<img src="page.png"/>', document_path="text/chapter.xhtml",
        images=(("text/page.png", b"local"), ("page.png", b"root")),
    )
    source = next(segment.src for segment in chapters[0].segments if isinstance(segment, ImageSegment))
    assert (Path(parser.image_output_dir) / source.rsplit("/", 1)[-1]).read_bytes() == b"local"


def test_encoded_image_uris_keep_literal_percent_resource_names_distinct(tmp_path):
    _parse(tmp_path, "<p>Fixture</p>", images=(("images/page name.png", b"space"),))
    source = tmp_path / "fixture.epub"
    # Encode the manifest URI, but preserve the literal archive member name.
    with ZipFile(source) as archive:
        entries = {info.filename: archive.read(info) for info in archive.infolist()}
    entries["EPUB/images/page%20name.png"] = b"literal-percent"
    package = ET.fromstring(entries["EPUB/content.opf"])
    manifest = package.find("{http://www.idpf.org/2007/opf}manifest")
    ET.SubElement(manifest, "{http://www.idpf.org/2007/opf}item", {
        "id": "literal-percent", "href": quote("images/page%20name.png"), "media-type": "image/png",
    })
    entries["EPUB/content.opf"] = ET.tostring(package)
    entries["EPUB/text/chapter.xhtml"] = (
        b'<html xmlns="http://www.w3.org/1999/xhtml"><body>'
        b'<img src="../images/page%20name.png"/>'
        b'<img src="../images/page%2520name.png"/></body></html>'
    )
    with ZipFile(source, "w") as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    parser = LightNovelParser(str(source), "percent", str(tmp_path / "books"))
    chapters = parser.parse()
    sources = [segment.src for segment in chapters[0].segments if isinstance(segment, ImageSegment)]
    assert len(sources) == 2
    assert sources[0] != sources[1]
    assert [
        (Path(parser.image_output_dir) / source.rsplit("/", 1)[-1]).read_bytes()
        for source in sources
    ] == [b"space", b"literal-percent"]


@pytest.mark.parametrize("cover_kind", ["epub2", "epub3", "filename"])
@pytest.mark.parametrize("inline_image", [False, True])
def test_import_keeps_non_spine_cover_priority(tmp_path, monkeypatch, cover_kind, inline_image):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.enums import ProcessingStatus
    from app.models import Base, Book
    from app.services.book_service import BookService
    import app.database as database_module
    import app.services.book_service as book_service_module
    import app.services.source_content_service as source_module

    book = epub.EpubBook()
    book.set_identifier("cover-fixture")
    book.set_title("Cover fixture")
    book.set_language("ja")
    chapter = epub.EpubHtml(uid="chapter", file_name="chapter.xhtml", lang="ja")
    chapter.content = '<html><body><p>本文</p>' + ('<img src="art/page.png"/>' if inline_image else '') + '</body></html>'
    book.add_item(chapter)
    cover_name = "art/cover.png" if cover_kind == "filename" else "art/jacket.png"
    cover = (epub.EpubCover(uid="jacket", file_name=cover_name) if cover_kind == "epub3" else
             epub.EpubItem(uid="jacket", file_name=cover_name, media_type="image/png"))
    cover.content = b"cover-bytes"
    book.add_item(cover)
    book.add_item(epub.EpubItem(uid="page", file_name="art/page.png", media_type="image/png", content=b"page-bytes"))
    if cover_kind == "epub2":
        book.add_metadata(None, "meta", "", {"name": "cover", "content": "jacket"})
    book.add_item(epub.EpubNcx())
    book.toc = (epub.Link("chapter.xhtml", "Fixture", "chapter"),)
    book.spine = [chapter]
    uploaded = tmp_path / "cover.epub"
    epub.write_epub(str(uploaded), book)

    monkeypatch.setattr(source_module, "SOURCE_FILES_DIR", str(tmp_path / "sources"))
    monkeypatch.setattr(book_service_module, "UPLOAD_DIR", str(tmp_path / "books"))
    engine = create_engine(f"sqlite:///{tmp_path / 'library.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    monkeypatch.setattr(database_module, "SessionLocal", Session)
    monkeypatch.setattr(book_service_module.AnalysisService, "rebuild_book_analysis",
                        lambda *_args, **_kwargs: SimpleNamespace(status="completed"))
    with Session() as session:
        session.add(Book(id="cover", title="Cover", status=ProcessingStatus.PENDING))
        session.commit()
    BookService(Session()).process_book_task("cover", str(uploaded), ".epub")
    with Session() as session:
        stored = session.get(Book, "cover")
        assert stored.status == ProcessingStatus.COMPLETED
        assert stored.cover_url
        saved = tmp_path / "books" / "cover" / "images" / stored.cover_url.rsplit("/", 1)[-1]
        # Keep filename heuristics behind the existing first-reader-image rule.
        expected = b"page-bytes" if cover_kind == "filename" and inline_image else b"cover-bytes"
        assert saved.read_bytes() == expected
