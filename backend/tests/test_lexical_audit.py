import json
import sqlite3
from pathlib import Path

import pytest
from ebooklib import epub

import scripts.lexical_audit as audit_module
from scripts.lexical_audit import (
    LexemeToken,
    audit_legacy,
    audit_source,
    boundary_lemmas,
    canonical_stats,
    coverage_points,
    stats,
    tokenize_source,
)


def tok(identity, count=1, *, surface=None, pos="名詞", oov=False, reading="ヨミ", proper=False):
    full = (pos, "固有名詞" if proper else "普通名詞", "一般", "*", "*", "*")
    return [LexemeToken(surface or identity, identity, identity, reading, pos, full, oov)] * count


def test_empty_and_all_filtered_report_shape():
    report = stats([LexemeToken("。", "。", "。", None, "記号", ("記号",), False)])
    assert report["denominator_tokens"] == 0
    assert report["total_types"] == 0
    assert report["hapax_count"] == 0
    assert report["coverage_points"][0]["required_types"] == 0


def test_hapax_ties_and_coverage_boundary_are_deterministic():
    tokens = tok("甲", 5) + tok("乙", 3) + tok("丙", 2) + tok("丁") + tok("戊")
    result = stats(tokens)
    assert result["denominator_tokens"] == 12
    assert result["total_types"] == 5
    assert result["hapax_count"] == 2
    assert coverage_points(tokens, [0.95])[0]["required_types"] == 5
    assert [row["identity"] for row in boundary_lemmas(tokens, .5, .75)] == ["乙", "丙"]


def test_proper_noun_and_oov_filters():
    tokens = tok("人名", 3, proper=True) + tok("普通", 2) + tok("碎片", 1, oov=True)
    assert stats(tokens)["denominator_tokens"] == 6
    assert stats(tokens, exclude_oov=True)["denominator_tokens"] == 5
    assert stats(tokens, exclude_proper_nouns=True)["denominator_tokens"] == 3


def test_source_spelling_fixture_records_actual_sudachi_values():
    values = tokenize_source(["出会う 出逢う 出遭う 引っ越す 引越す 引っこす 子供 子ども 一杯 いっぱい 出来る できる 振り返る 振返る"])
    by_surface = {t.surface: t for t in values}
    assert by_surface["出逢う"].normalized_form == "出会う"
    assert by_surface["引越す"].normalized_form == "引っ越す"
    assert by_surface["子ども"].normalized_form == "子供"
    assert by_surface["できる"].normalized_form == "出来る"
    assert by_surface["振返る"].normalized_form == "振り返る"
    # 一杯 is deliberately checked as a possible segmentation/OOV case.
    assert any(t.surface == "一" and t.is_oov for t in tokenize_source(["一杯"]))


def test_canonical_key_keeps_unresolved_homograph_reading_separate():
    tokens = [
        LexemeToken("方", "方", "方", "ホウ", "名詞", ("名詞", "普通名詞"), False, False, "ホウ"),
        LexemeToken("方", "方", "方", "カタ", "名詞", ("名詞", "普通名詞"), False, False, None),
    ]
    result = canonical_stats(tokens)
    assert result["canonical_distinct_identity_count"] == 2
    assert result["unresolved_canonical_reading_count"] == 1


def test_legacy_json_input_is_separate_and_report_has_required_fields(tmp_path):
    db = tmp_path / "legacy.sqlite"
    conn = sqlite3.connect(db)
    conn.executescript("CREATE TABLE books (id TEXT PRIMARY KEY, created_at TEXT); CREATE TABLE chapters (book_id TEXT, content_json TEXT, \"index\" INTEGER);")
    content = [{"type": "text", "tokens": [
        {"s": "食べた", "r": "たべた", "b": "食べる", "p": "動詞"},
        {"s": "。", "gap": True},
        {"s": "安達", "r": "あだち", "b": "安達", "p": "名詞"},
    ]}]
    conn.execute("INSERT INTO books VALUES ('book1','2026')")
    conn.execute("INSERT INTO chapters VALUES ('book1',?,0)", (json.dumps(content, ensure_ascii=False),))
    conn.commit(); conn.close()
    report = audit_legacy(str(db), book_id="book1")
    assert report["source_kind"] == "legacy_json"
    assert report["filter_spec"]["identity_field"] == "legacy_base_form"
    for key in ("denominator_tokens", "total_types", "hapax_count", "filter_spec"):
        assert key in report
    assert report["denominator_tokens"] == 2
    assert report["data_quality"]["source_sha256"] is None
    assert report["data_quality"]["legacy_estimate"] is True


def test_source_epub_report_shape():
    sample = Path(__file__).parents[2] / ".design-notes/book-sample/安達としまむら2.epub"
    if not sample.exists():
        pytest.skip("manual long-book benchmark fixture is not present")
    report = audit_source(str(sample))
    assert report["source_kind"] == "source_file"
    assert report["filter_spec"]["identity_field"] == "normalized_form"
    assert report["denominator_tokens"] > 0
    assert len(report["data_quality"]["source_sha256"]) == 64
    assert report["data_quality"]["ruby_markup_count"] > 0
    assert report["data_quality"]["ruby_readings_applied"] == 0
    assert len(report["boundary_lemmas"]) >= 50
    assert {p["coverage"] for p in report["coverage_points"]} == {0.8, .9, .91, .95, .96, .98}


def _write_minimal_epub(path: Path) -> None:
    book = epub.EpubBook()
    book.set_identifier("lexical-audit-fixture")
    book.set_title("Lexical audit fixture")
    book.set_language("ja")
    chapter = epub.EpubHtml(title="Fixture", file_name="fixture.xhtml", lang="ja")
    chapter.content = """<html><body><h1>Fixture</h1>
    <p><ruby>食<rt>た</rt></ruby>べる。食べた。食べない。</p>
    <p>出逢う 子ども</p></body></html>"""
    book.add_item(chapter)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.toc = (epub.Link("fixture.xhtml", "Fixture", "fixture"),)
    book.spine = ["nav", chapter]
    epub.write_epub(str(path), book)


def test_minimal_source_epub_is_reproducible_and_mode_join_is_specific(tmp_path):
    source = tmp_path / "fixture.epub"
    vocab = tmp_path / "vocab.tsv"
    _write_minimal_epub(source)
    vocab.write_text("食べる\tたべる\n", encoding="utf-8")
    report = audit_source(str(source), exclude_oov=True,
                          exclude_proper_nouns=True, external_vocab=str(vocab))
    assert report["source_kind"] == "source_file"
    assert report["data_quality"]["ruby_markup_count"] == 1
    assert report["data_quality"]["ruby_readings_applied"] == 0
    assert len(report["data_quality"]["source_sha256"]) == 64
    assert report["canonical_contract"]["key"] == "(normalized_form, canonical_reading)"
    assert report["canonical_metrics"]["canonical_distinct_identity_count"] >= 1
    assert {row["split_mode"] for row in report["mode_comparison"]} == {"A", "B", "C"}
    for row in report["mode_comparison"]:
        assert row["filter_spec"]["exclude_oov"] is True
        assert row["filter_spec"]["exclude_proper_nouns"] is True
        assert row["external_vocab_matched_types"] >= 1
        assert row["external_vocab_join_rate"] > 0
    food = tokenize_source(["食べる 食べた 食べない"])
    food_keys = {token.canonical_lookup_key for token in food if token.normalized_form == "食べる"}
    assert food_keys == {("食べる", "タベル")}


def test_source_empty_text_and_missing_reading_are_reported(monkeypatch, tmp_path):
    source = tmp_path / "fixture.epub"
    source.write_bytes(b"fixture")
    monkeypatch.setattr(audit_module, "_source_texts_and_metadata",
                        lambda path: (["。。。"], {"ruby_count": 0}))
    report = audit_source(str(source))
    assert report["denominator_tokens"] == 0

    # An image-only parsed book has no text rows and must remain an empty audit.
    monkeypatch.setattr(audit_module, "_source_texts_and_metadata",
                        lambda path: ([], {"ruby_count": 0}))
    report = audit_source(str(source))
    assert report["denominator_tokens"] == 0

    token = LexemeToken("語", "語", "語", None, "名詞", ("名詞", "普通名詞"), True)
    monkeypatch.setattr(audit_module, "tokenize_source_all_modes", lambda texts: {"A": [token], "B": [token], "C": [token]})
    report = audit_source(str(source))
    assert report["data_quality"]["missing_reading_count"] == 1
    assert report["data_quality"]["oov_count"] == 1
