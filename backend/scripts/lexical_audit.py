#!/usr/bin/env python3
"""Stage 0 lexical coverage audit.

The legacy and source-file paths intentionally use different identity contracts:
legacy JSON has only ``b`` (base form), while source files use Sudachi's
normalized form and complete POS.  No database rows or rendered content are
modified by this script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sqlite3
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

import jaconv
from sudachipy import dictionary, tokenizer as sudachi_tokenizer


POS_ALLOWLIST = ["名詞", "動詞", "形容詞", "形状詞", "副詞"]
TARGETS = [0.80, 0.90, 0.91, 0.95, 0.96, 0.98]
MODES = {"A": sudachi_tokenizer.Tokenizer.SplitMode.A,
         "B": sudachi_tokenizer.Tokenizer.SplitMode.B,
         "C": sudachi_tokenizer.Tokenizer.SplitMode.C}
FIXTURE_GROUPS = {
    "出会う_variants": ["出会う", "出逢う", "出遭う"],
    "引っ越す_variants": ["引っ越す", "引越す", "引っこす"],
    "子供_variants": ["子供", "子ども"],
    "一杯_variants": ["一杯", "いっぱい"],
    "出来る_variants": ["出来る", "できる"],
    "振り返る_variants": ["振り返る", "振返る"],
}


@dataclass(frozen=True)
class LexemeToken:
    surface: str
    dictionary_form: str
    normalized_form: Optional[str]
    reading: Optional[str]
    pos: str
    full_pos: tuple[str, ...] = ()
    is_oov: Optional[bool] = None
    is_gap: bool = False
    canonical_reading: Optional[str] = None

    @property
    def identity(self) -> str:
        """Normalized-form identity used only for the coverage curve."""
        return self.normalized_form or self.dictionary_form or self.surface

    @property
    def canonical_lookup_key(self) -> tuple[str, Optional[str]]:
        """Stable analysis key; null reading is provisional/unresolved."""
        return (self.identity, self.canonical_reading)

    @property
    def proper_noun(self) -> bool:
        return len(self.full_pos) > 1 and self.full_pos[1] == "固有名詞"


def _safe_call(obj: Any, name: str, default: Any = None) -> Any:
    try:
        value = getattr(obj, name)()
        return value if value is not None else default
    except (AttributeError, TypeError, ValueError):
        return default


def _derive_canonical_reading(morpheme: Any, sudachi: Any,
                              cache: dict[str, Optional[str]]) -> Optional[str]:
    """Derive a conservative reading from the dictionary form.

    Inflected surfaces are mapped through their dictionary form (食べた ->
    食べる).  If an uninflected surface's observed reading disagrees with the
    dictionary-form reanalysis (方 -> カタ vs default ホウ), it is left
    unresolved instead of turning a surface guess into a permanent key.
    """
    dictionary_form = str(_safe_call(morpheme, "dictionary_form", "") or "")
    if not dictionary_form or bool(_safe_call(morpheme, "is_oov", False)):
        return None
    if dictionary_form in cache:
        candidate = cache[dictionary_form]
    else:
        pieces = sudachi.tokenize(dictionary_form, MODES["C"])
        candidate = None
        if len(pieces) == 1 and pieces[0].surface() == dictionary_form and not pieces[0].is_oov():
            candidate = pieces[0].reading_form() or None
        cache[dictionary_form] = candidate
    if not candidate:
        return None
    surface = str(_safe_call(morpheme, "surface", "") or "")
    observed = _safe_call(morpheme, "reading_form", None)
    if surface != dictionary_form or observed == candidate:
        return candidate
    return None


def _source_token(morpheme: Any, sudachi: Any,
                  canonical_cache: dict[str, Optional[str]]) -> LexemeToken:
    full_pos = tuple(_safe_call(morpheme, "part_of_speech", ()) or ())
    surface_reading = _safe_call(morpheme, "reading_form", None)
    return LexemeToken(
        surface=str(_safe_call(morpheme, "surface", "")),
        dictionary_form=str(_safe_call(morpheme, "dictionary_form", "") or ""),
        normalized_form=_safe_call(morpheme, "normalized_form", None),
        reading=surface_reading,
        pos=full_pos[0] if full_pos else "Unknown",
        full_pos=full_pos,
        is_oov=bool(_safe_call(morpheme, "is_oov", False)),
        canonical_reading=_derive_canonical_reading(morpheme, sudachi, canonical_cache),
    )


def tokenize_source(texts: Iterable[str], mode: str = "C") -> list[LexemeToken]:
    """Tokenize text, deriving A/B from C morphemes where possible."""
    sudachi = dictionary.Dictionary().create()
    selected = MODES[mode]
    canonical_cache: dict[str, Optional[str]] = {}
    output: list[LexemeToken] = []
    for text in texts:
        if not text:
            continue
        for morpheme in sudachi.tokenize(text, MODES["C"]):
            pieces = morpheme.split(selected) if mode != "C" else [morpheme]
            output.extend(_source_token(p, sudachi, canonical_cache) for p in (pieces or [morpheme]))
    return output


def tokenize_source_all_modes(texts: Iterable[str]) -> dict[str, list[LexemeToken]]:
    cached = list(texts)
    sudachi = dictionary.Dictionary().create()
    canonical_cache: dict[str, Optional[str]] = {}
    mode_tokens = {mode: [] for mode in MODES}
    # One C pass is shared by all modes; A/B are derived from each C morpheme.
    for text in cached:
        if not text:
            continue
        for morpheme in sudachi.tokenize(text, MODES["C"]):
            for mode, split_mode in MODES.items():
                pieces = morpheme.split(split_mode) if mode != "C" else [morpheme]
                mode_tokens[mode].extend(_source_token(piece, sudachi, canonical_cache)
                                         for piece in (pieces or [morpheme]))
    return mode_tokens


def legacy_tokens(content_rows: Iterable[Any]) -> list[LexemeToken]:
    """Read compressed Chapter JSON; identity is explicitly legacy ``b``."""
    result: list[LexemeToken] = []
    for content in content_rows:
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except json.JSONDecodeError:
                continue
        for segment in content or []:
            for raw in (segment.get("tokens", []) if isinstance(segment, dict) else []):
                if not isinstance(raw, dict) or raw.get("gap"):
                    continue
                surface = str(raw.get("s", ""))
                base = str(raw.get("b") or surface)
                pos = str(raw.get("p") or "Unknown")
                result.append(LexemeToken(surface, base, None, raw.get("r"), pos, (pos,), None))
    return result


def _include(token: LexemeToken, *, exclude_oov: bool, exclude_proper_nouns: bool) -> bool:
    if token.pos not in POS_ALLOWLIST:
        return False
    if exclude_oov and token.is_oov is True:
        return False
    if exclude_proper_nouns and token.proper_noun:
        return False
    return bool(token.identity)


def filtered(tokens: Iterable[LexemeToken], *, exclude_oov: bool = False,
             exclude_proper_nouns: bool = False) -> list[LexemeToken]:
    return [t for t in tokens if _include(t, exclude_oov=exclude_oov,
                                          exclude_proper_nouns=exclude_proper_nouns)]


def coverage_points(tokens: Iterable[LexemeToken], targets: Iterable[float] = TARGETS) -> list[dict[str, Any]]:
    counts = Counter(t.identity for t in tokens)
    denominator = sum(counts.values())
    ranked = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
    result = []
    for target in targets:
        needed = math.ceil(denominator * target)
        cumulative = 0
        required_types = 0
        occurrence_count = 0
        for required_types, (_, count) in enumerate(ranked, 1):
            cumulative += count
            occurrence_count = cumulative
            if cumulative >= needed:
                break
        if denominator == 0:
            required_types = occurrence_count = 0
        result.append({"coverage": target, "required_types": required_types,
                       "token_occurrences": occurrence_count,
                       "achieved_coverage": (occurrence_count / denominator if denominator else 0.0)})
    return result


def stats(tokens: Iterable[LexemeToken], *, exclude_oov: bool = False,
          exclude_proper_nouns: bool = False) -> dict[str, Any]:
    selected = filtered(tokens, exclude_oov=exclude_oov, exclude_proper_nouns=exclude_proper_nouns)
    counts = Counter(t.identity for t in selected)
    hapax = sum(1 for count in counts.values() if count == 1)
    return {"denominator_tokens": len(selected), "total_types": len(counts),
            "hapax_count": hapax, "hapax_ratio": hapax / len(counts) if counts else 0.0,
            "coverage_points": coverage_points(selected)}


def canonical_stats(tokens: Iterable[LexemeToken], *, exclude_oov: bool = False,
                    exclude_proper_nouns: bool = False) -> dict[str, Any]:
    selected = filtered(tokens, exclude_oov=exclude_oov, exclude_proper_nouns=exclude_proper_nouns)
    counts = Counter(t.canonical_lookup_key for t in selected)
    normalized_readings: dict[str, set[str]] = {}
    for token in selected:
        if token.canonical_reading:
            normalized_readings.setdefault(token.identity, set()).add(token.canonical_reading)
    unresolved_keys = {key for key in counts if key[1] is None}
    return {
        "canonical_distinct_identity_count": len(counts),
        "canonical_hapax_count": sum(1 for count in counts.values() if count == 1),
        "unresolved_canonical_reading_count": len(unresolved_keys),
        "unresolved_canonical_reading_occurrences": sum(counts[key] for key in unresolved_keys),
        "normalized_forms_with_multiple_canonical_readings": sum(
            1 for readings in normalized_readings.values() if len(readings) > 1
        ),
    }


def boundary_lemmas(tokens: Iterable[LexemeToken], low: float = .95, high: float = .96) -> list[dict[str, Any]]:
    selected = filtered(tokens)
    counts = Counter(t.identity for t in selected)
    representative: dict[str, LexemeToken] = {}
    variants: dict[str, list[LexemeToken]] = {}
    for token in selected:
        representative.setdefault(token.identity, token)
        variants.setdefault(token.identity, []).append(token)
    ranked = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
    denominator = sum(counts.values())
    low_n, high_n = math.ceil(denominator * low), math.ceil(denominator * high)
    cumulative = 0
    result = []
    for rank, (identity, count) in enumerate(ranked, 1):
        before = cumulative
        cumulative += count
        if cumulative > low_n and before < high_n:
            token = representative[identity]
            identity_tokens = variants[identity]
            result.append({"rank": rank, "identity": identity, "surface": token.surface,
                           "dictionary_form": token.dictionary_form,
                           "normalized_form": token.normalized_form,
                           "reading": token.reading, "reading_form": token.reading,
                           "surface_reading": token.reading,
                           "canonical_reading": token.canonical_reading,
                           "canonical_lookup_key": [token.identity, token.canonical_reading],
                           "pos": token.pos, "POS": token.pos,
                           "full_pos": list(token.full_pos), "occurrences": count,
                           "is_oov": token.is_oov,
                           "surface_variants": sorted({t.surface for t in identity_tokens}),
                           "dictionary_form_variants": sorted({t.dictionary_form for t in identity_tokens}),
                           "surface_reading_variants": sorted({t.reading for t in identity_tokens if t.reading}),
                           "canonical_reading_variants": sorted({t.canonical_reading for t in identity_tokens if t.canonical_reading}),
                           "unresolved_canonical_reading_occurrences": sum(
                               1 for t in identity_tokens if t.canonical_reading is None
                           )})
    return result


def _mode_summary(mode_tokens: list[LexemeToken], *, exclude_oov: bool = False,
                  exclude_proper_nouns: bool = False,
                  external_vocab: Optional[set[tuple[str, Optional[str]]]] = None) -> dict[str, Any]:
    s = stats(mode_tokens, exclude_oov=exclude_oov, exclude_proper_nouns=exclude_proper_nouns)
    canonical = canonical_stats(mode_tokens, exclude_oov=exclude_oov,
                                exclude_proper_nouns=exclude_proper_nouns)
    selected = filtered(mode_tokens, exclude_oov=exclude_oov,
                        exclude_proper_nouns=exclude_proper_nouns)
    oov = sum(1 for t in selected if t.is_oov is True)
    missing_reading = sum(1 for t in selected if not t.reading)
    matched = None
    join_rate = None
    if external_vocab is not None:
        distinct_keys = {t.canonical_lookup_key for t in selected}
        matched = len(distinct_keys & external_vocab)
        join_rate = matched / len(distinct_keys) if distinct_keys else 0.0
    return {"raw_token_count": len(mode_tokens), "denominator_tokens": len(selected),
            "distinct_identity_count": s["total_types"],
            "hapax_count": s["hapax_count"], "oov_count": oov,
            "oov_ratio": oov / len(selected) if selected else 0.0,
            "missing_reading_count": missing_reading,
            **canonical,
            "external_vocab_matched_types": matched,
            "external_vocab_join_rate": join_rate,
            "filter_spec": {"pos_allowlist": POS_ALLOWLIST,
                            "exclude_oov": exclude_oov,
                            "exclude_proper_nouns": exclude_proper_nouns,
                            "identity_field": "normalized_form"}}


def _token_dict(token: LexemeToken, occurrences: int) -> dict[str, Any]:
    return {"surface": token.surface, "dictionary_form": token.dictionary_form,
            "normalized_form": token.normalized_form, "reading": token.reading,
            "surface_reading": token.reading, "reading_form": token.reading,
            "canonical_reading": token.canonical_reading,
            "canonical_lookup_key": [token.identity, token.canonical_reading],
            "POS": token.pos, "full_POS": list(token.full_pos),
            "occurrences": occurrences, "is_oov": token.is_oov}


def _fixture_report(tokens: Iterable[LexemeToken]) -> dict[str, Any]:
    by_surface: dict[str, list[LexemeToken]] = {}
    for token in tokens:
        by_surface.setdefault(token.surface, []).append(token)
    result = {}
    for group, surfaces in FIXTURE_GROUPS.items():
        rows = []
        for surface in surfaces:
            # Probe each spelling independently so the report records actual
            # Sudachi behavior even when a book does not contain that spelling.
            probe = tokenize_source([surface], "C")
            matches = [t for t in probe if t.surface == surface]
            observed = by_surface.get(surface, [])
            if matches:
                rows.append({**_token_dict(matches[0], len(observed)),
                             "probe_occurrences": len(matches),
                             "book_occurrences": len(observed)})
            else:
                rows.append({"surface": surface, "dictionary_form": None,
                             "normalized_form": None, "reading": None, "surface_reading": None,
                             "reading_form": None, "canonical_reading": None,
                             "canonical_lookup_key": None, "POS": None,
                             "full_POS": [], "occurrences": len(observed), "is_oov": None,
                             "probe_tokens": [_token_dict(t, 1) for t in probe],
                             "not_observed_as_single_surface": True})
        result[group] = rows
    return result


def _markdown(report: dict[str, Any]) -> str:
    lines = ["# Lexical Coverage Audit", "", f"- source: `{report['source_kind']}`",
             f"- book: `{report['source_book_id']}`",
             f"- tokenizer: SudachiPy / {report['tokenizer']['split_mode']}", "",
             "## Coverage", "", "| Target | Required types | Occurrences | Achieved |",
             "|---:|---:|---:|---:|"]
    for point in report["coverage_points"]:
        lines.append(f"| {point['coverage']:.0%} | {point['required_types']} | {point['token_occurrences']} | {point['achieved_coverage']:.2%} |")
    lines += ["", "## Boundary words (95%-96%)", "",
              "| Rank | Surface | Dictionary | Normalized | Reading | POS | Count | OOV |",
              "|---:|---|---|---|---|---|---:|---|"]
    for row in report["boundary_lemmas"]:
        vals = [row.get(k) if row.get(k) is not None else "" for k in ("rank", "surface", "dictionary_form", "normalized_form", "reading", "pos", "occurrences")]
        lines.append("| " + " | ".join(map(str, vals)) + f" | {row.get('is_oov', '')} |")
    lines += ["", "## Proper noun comparison", "", "```json", json.dumps(report["proper_noun_comparison"], ensure_ascii=False, indent=2), "```",
              "", "## Canonical identity diagnostics", "", "```json",
              json.dumps({"coverage_metric": report.get("coverage_metric"),
                          "canonical_contract": report.get("canonical_contract"),
                          "canonical_metrics": report.get("canonical_metrics")}, ensure_ascii=False, indent=2), "```",
              "", "## A/B/C", "", "```json", json.dumps(report["mode_comparison"], ensure_ascii=False, indent=2), "```",
              "", "## Data quality", "", "```json", json.dumps(report.get("data_quality", {}), ensure_ascii=False, indent=2), "```"]
    return "\n".join(lines) + "\n"


def _dictionary_version() -> str:
    try:
        from importlib.metadata import version
        return version("sudachidict_core")
    except Exception:
        return "unknown"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_texts_and_metadata(path: Path) -> tuple[list[str], dict[str, Any]]:
    from app.utils.parsers.epub_parser import LightNovelParser, TextSegment
    if path.suffix.lower() == ".pdf":
        pdftotext = shutil.which("pdftotext")
        if not pdftotext:
            raise RuntimeError("PDF input needs a local pdftotext executable; no network/MinerU fallback is used.")
        completed = subprocess.run([pdftotext, "-layout", str(path), "-"], check=True,
                                   capture_output=True, text=True)
        return [completed.stdout], {"ruby_markup_count": 0, "ruby_count": 0,
                                    "ruby_readings_applied": 0,
                                    "rendered_json_size_bytes": len(completed.stdout.encode("utf-8")),
                                    "pdf_text_extractor": "pdftotext"}
    with tempfile.TemporaryDirectory(prefix="lexical-audit-") as temp_dir:
        parser = LightNovelParser(str(path), "lexical-audit", temp_dir)
        chapters = parser.parse()
        texts = [seg.text for chapter in chapters for seg in chapter.segments
                 if isinstance(seg, TextSegment) and seg.text]
        rendered = [{"title": c.title, "index": c.index, "segments": [s.to_dict() for s in c.segments]} for c in chapters]
    ruby_count = 0
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.lower().endswith((".xhtml", ".html", ".htm")):
                data = archive.read(name).decode("utf-8", errors="ignore")
                ruby_count += data.lower().count("<ruby")
    return texts, {"ruby_markup_count": ruby_count, "ruby_count": ruby_count,
                   "ruby_readings_applied": 0,
                   "rendered_json_size_bytes": len(json.dumps(rendered, ensure_ascii=False).encode("utf-8"))}


def audit_source(path: str, *, split_mode: str = "C", exclude_oov: bool = False,
                 exclude_proper_nouns: bool = False, external_vocab: Optional[str] = None) -> dict[str, Any]:
    source = Path(path)
    parse_start = time.perf_counter()
    texts, metadata = _source_texts_and_metadata(source)
    parse_seconds = time.perf_counter() - parse_start
    tokenize_start = time.perf_counter()
    all_modes = tokenize_source_all_modes(texts)
    tokenize_seconds = time.perf_counter() - tokenize_start
    tokens = all_modes[split_mode]
    external_vocab_set = _load_vocab(external_vocab) if external_vocab else None
    selected = filtered(tokens, exclude_oov=exclude_oov, exclude_proper_nouns=exclude_proper_nouns)
    base_stats = stats(tokens, exclude_oov=exclude_oov, exclude_proper_nouns=exclude_proper_nouns)
    mode_comparison = []
    for mode, mode_tokens in all_modes.items():
        item = _mode_summary(mode_tokens, exclude_oov=exclude_oov,
                             exclude_proper_nouns=exclude_proper_nouns,
                             external_vocab=external_vocab_set)
        item["split_mode"] = mode
        mode_comparison.append(item)
    report = _assemble_report(base_stats, selected, comparison_tokens=tokens, source_kind="source_file", source_book_id=source.stem,
                              split_mode=split_mode, exclude_oov=exclude_oov,
                              exclude_proper_nouns=exclude_proper_nouns,
                              source_size=source.stat().st_size, source_sha256=_sha256_file(source), parse_seconds=parse_seconds,
                              tokenize_seconds=tokenize_seconds, metadata=metadata,
                              mode_comparison=mode_comparison, external_vocab=external_vocab)
    report["notation_fixture"] = _fixture_report(tokens)
    return report


def audit_legacy(db_path: str, *, book_id: Optional[str] = None,
                 exclude_proper_nouns: bool = False) -> dict[str, Any]:
    started = time.perf_counter()
    conn = sqlite3.connect(db_path)
    try:
        if book_id:
            row = conn.execute("SELECT id FROM books WHERE id = ?", (book_id,)).fetchone()
            if not row:
                raise ValueError(f"book id not found: {book_id}")
            rows = conn.execute("SELECT content_json FROM chapters WHERE book_id = ? ORDER BY \"index\"", (book_id,)).fetchall()
            source_id = book_id
        else:
            row = conn.execute("SELECT id FROM books ORDER BY created_at LIMIT 1").fetchone()
            if not row:
                raise ValueError("no books found in database")
            source_id = str(row[0])
            rows = conn.execute("SELECT content_json FROM chapters WHERE book_id = ? ORDER BY \"index\"", (source_id,)).fetchall()
    finally:
        conn.close()
    contents = [r[0] for r in rows]
    tokens = legacy_tokens(contents)
    selected = filtered(tokens, exclude_proper_nouns=exclude_proper_nouns)
    report = _assemble_report(stats(tokens, exclude_proper_nouns=exclude_proper_nouns), selected, comparison_tokens=tokens,
                              source_kind="legacy_json", source_book_id=source_id, split_mode="legacy",
                              exclude_oov=False, exclude_proper_nouns=exclude_proper_nouns,
                              source_size=None, source_sha256=None, parse_seconds=time.perf_counter() - started,
                              tokenize_seconds=0.0, metadata={"legacy_rendered_json_size_bytes": sum(len(c.encode("utf-8")) if isinstance(c, str) else len(json.dumps(c, ensure_ascii=False).encode("utf-8")) for c in contents)},
                              mode_comparison=[], external_vocab=None)
    report["data_quality"]["legacy_estimate"] = True
    report["data_quality"].update({"oov_count": None, "oov_ratio": None,
                                    "missing_reading_count": None, "ruby_count": None,
                                    "ruby_markup_count": None, "ruby_readings_applied": None,
                                    "mode_comparison_unavailable": True})
    report["data_quality"]["limitations"] = ["legacy JSON has only base_form/一级词性; normalized_form, full POS, OOV, ruby and A/B/C retokenization are unavailable"]
    report["canonical_metrics"] = {"canonical_distinct_identity_count": None,
                                    "canonical_hapax_count": None,
                                    "unresolved_canonical_reading_count": None,
                                    "unresolved_canonical_reading_occurrences": None,
                                    "normalized_forms_with_multiple_canonical_readings": None,
                                    "unavailable": True}
    report["canonical_contract"]["unavailable"] = True
    report["proper_noun_comparison"] = {"include": report["proper_noun_comparison"]["include"],
                                         "exclude": None,
                                         "note": "legacy JSON lacks complete POS, so proper-noun exclusion cannot be measured"}
    report["notation_fixture"] = {}
    return report


def _assemble_report(base_stats: dict[str, Any], selected: list[LexemeToken], *, source_kind: str,
                     comparison_tokens: Optional[list[LexemeToken]] = None,
                     source_book_id: str, split_mode: str, exclude_oov: bool,
                     exclude_proper_nouns: bool, source_size: Optional[int], source_sha256: Optional[str], parse_seconds: float,
                     tokenize_seconds: float, metadata: dict[str, Any], mode_comparison: list[dict[str, Any]],
                     external_vocab: Optional[str]) -> dict[str, Any]:
    counts = Counter(t.identity for t in selected)
    reps: dict[str, LexemeToken] = {}
    for token in selected:
        reps.setdefault(token.identity, token)
    boundary = boundary_lemmas(selected)
    oov_count = sum(1 for t in selected if t.is_oov is True)
    quality = {"oov_count": oov_count, "oov_ratio": oov_count / len(selected) if selected else 0.0,
               "missing_reading_count": sum(1 for t in selected if not t.reading),
               "estimated_occurrence_rows": len(selected), "parse_seconds": parse_seconds,
               "tokenize_seconds": tokenize_seconds, "source_content_size_bytes": source_size,
               "source_sha256": source_sha256,
               **metadata}
    proper_source = comparison_tokens if comparison_tokens is not None else selected
    proper = {"include": stats(proper_source, exclude_oov=exclude_oov),
              "exclude": stats(proper_source, exclude_oov=exclude_oov, exclude_proper_nouns=True)}
    canonical = canonical_stats(selected, exclude_oov=exclude_oov,
                                exclude_proper_nouns=exclude_proper_nouns)
    join = None
    if external_vocab:
        entries = _load_vocab(external_vocab)
        distinct_keys = {token.canonical_lookup_key for token in selected}
        matched = len(distinct_keys & entries)
        join = {"path": external_vocab, "canonical_key": "(normalized_form, canonical_reading)",
                "reading_format": "katakana", "vocab_entries": len(entries),
                "matched_types": matched,
                "join_rate": matched / len(distinct_keys) if distinct_keys else 0.0}
    report = {"report_version": "stage0-v2-canonical-reading", "source_kind": source_kind,
              "source_book_id": source_book_id, "source_content_version": None,
              "tokenizer": {"name": "SudachiPy", "split_mode": split_mode, "dictionary_version": _dictionary_version()},
              "coverage_metric": "normalized_form_coverage_curve",
              "canonical_contract": {"key": "(normalized_form, canonical_reading)",
                                     "surface_reading_field": "reading_form",
                                     "oov_policy": "(normalized_form, null) provisional key",
                                     "unresolved_reading_policy": "do not use surface reading as canonical"},
              "denominator_tokens": base_stats["denominator_tokens"], "total_types": base_stats["total_types"],
              "hapax_count": base_stats["hapax_count"], "hapax_ratio": base_stats["hapax_ratio"],
              "filter_spec": {"pos_allowlist": POS_ALLOWLIST, "exclude_oov": exclude_oov,
                              "exclude_proper_nouns": exclude_proper_nouns,
                              "identity_field": "legacy_base_form" if source_kind == "legacy_json" else "normalized_form"},
              "coverage_points": base_stats["coverage_points"], "boundary_lemmas": boundary,
              "canonical_metrics": canonical,
              "proper_noun_comparison": proper, "mode_comparison": mode_comparison,
              "data_quality": quality}
    if join is not None:
        report["external_vocab_join"] = join
    return report


def _load_vocab(path: str) -> set[tuple[str, Optional[str]]]:
    def normalize_reading(value: Any) -> Optional[str]:
        if value is None or not str(value).strip():
            return None
        return jaconv.hira2kata(str(value).strip())

    raw = Path(path).read_text(encoding="utf-8")
    if raw.lstrip().startswith("["):
        data = json.loads(raw)
        result: set[tuple[str, Optional[str]]] = set()
        for item in data:
            if isinstance(item, dict):
                normalized = item.get("normalized_form") or item.get("normalized")
                reading = item.get("reading") or item.get("reading_form")
                if normalized:
                    result.add((str(normalized), normalize_reading(reading)))
            elif isinstance(item, (list, tuple)) and item:
                result.add((str(item[0]), normalize_reading(item[1] if len(item) > 1 else None)))
        return result
    entries: set[tuple[str, Optional[str]]] = set()
    for line in raw.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.lstrip().startswith("["):
            continue
        parts = line.split("\t")
        entries.add((parts[0].strip(), normalize_reading(parts[1] if len(parts) > 1 else None)))
    return entries


def write_report(report: dict[str, Any], output_dir: str) -> None:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "coverage_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "coverage_report.md").write_text(_markdown(report), encoding="utf-8")
    (out / "boundary_lemmas.json").write_text(json.dumps(report["boundary_lemmas"], ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "boundary_lemmas.md").write_text(_markdown({**report, "coverage_points": [], "proper_noun_comparison": {}, "mode_comparison": {}, "data_quality": {}}), encoding="utf-8")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source", help="raw EPUB/PDF path")
    source.add_argument("--db", help="SQLite database path containing Chapter.content_json")
    parser.add_argument("--book-id")
    parser.add_argument("--output-dir", default=os.path.join(tempfile.gettempdir(), "easierlightnovel-lexical-audit"))
    parser.add_argument("--split-mode", choices=sorted(MODES), default="C")
    parser.add_argument("--exclude-oov", action="store_true")
    parser.add_argument("--exclude-proper-nouns", action="store_true")
    parser.add_argument("--external-vocab")
    args = parser.parse_args(argv)
    if args.source:
        report = audit_source(args.source, split_mode=args.split_mode, exclude_oov=args.exclude_oov,
                              exclude_proper_nouns=args.exclude_proper_nouns, external_vocab=args.external_vocab)
    else:
        report = audit_legacy(args.db, book_id=args.book_id, exclude_proper_nouns=args.exclude_proper_nouns)
    write_report(report, args.output_dir)
    print(json.dumps({"output_dir": os.path.abspath(args.output_dir), "source_kind": report["source_kind"],
                      "denominator_tokens": report["denominator_tokens"], "total_types": report["total_types"],
                      "hapax_count": report["hapax_count"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    raise SystemExit(main())
