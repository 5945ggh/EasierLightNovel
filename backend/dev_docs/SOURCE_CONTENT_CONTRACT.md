# Source Content Contract

## Purpose

This document defines the private, rebuildable source-data boundary introduced
in Phase 1. It is the contract between import/parsing and any future analysis
layer. It does not add fields to the reader API or `Chapter.content_json`.

The lifecycle is deliberately one-directional:

```text
immutable original EPUB/PDF
  -> parser-derived SourceContentVersion
  -> rebuildable AnalysisRun artifacts
```

The original file is authoritative input. `SourceContentVersion` is a
versioned derivative. `AnalysisRun`, lexeme observation, occurrence, and chapter
stat data are derived from a specific source-content version and remain
discardable/rebuildable.

## Storage And Visibility

- Imported originals are stored privately at
  `data_dir/sources/<book-id>/original.<ext>`.
- The source directory is never mounted as static content. Only
  `data_dir/books/` is served below `/static/books/`.
- `BookSourceFile` records the file type, media type, SHA-256, private relative
  path, and creation time.
- `SourceContentVersion` records the original-file hash, parser version,
  source-schema version, source-content hash, and source JSON.
- `SourceRubyHint` duplicates queryable ruby metadata, while the complete
  versioned source document remains in `source_content_json`.
- Deletion stages source directories under `data_dir/sources/.cleanup/` before
  the database delete commits. Failed final deletion is retried at startup.

## Version 4 Coordinate Contract

Current producer values are:

```text
parser_version: epub-pdf-source-v4
source_schema_version: 4
offset_unit: unicode_codepoint
```

All offsets are Python Unicode code-point boundaries into the exact `text`
field of one source document. They are not UTF-8 byte offsets, DOM offsets,
reader token indexes, or global-book offsets.

An EPUB source document has this conceptual shape:

```json
{
  "document_id": "spine-item-id",
  "spine_index": 12,
  "text": "...",
  "ruby_hints": [],
  "structural_boundaries": [],
  "reader_projection": {
    "reader_chapter_index": 4,
    "reader_segment_start_index": 8,
    "reader_segment_end_index": 11,
    "text_spans": []
  }
}
```

`reader_projection` is private source metadata. It maps only source text spans
that correspond to rendered reader text. Empty source documents, navigation
documents, and other source-only documents intentionally have no fabricated
reader projection.

## Normalization And Boundaries

Source text and reader text share one normalization rule for each reader text
buffer:

- remove `U+200B`;
- collapse each run of three or more newlines to two newlines.

The buffer boundary is part of the contract. At every EPUB image node, the
parser flushes the current source text buffer exactly when the reader flushes
its text buffer. The image then adds a source-only `"\n"` structural boundary.
That boundary is not reader text and must not be projected to a reader token or
segment. It prevents future tokenization from joining text on opposite sides
of an image into a new word.

Do not normalize source text across a structural boundary. In particular, do
not collapse newline runs formed by both reader text and a source-only image
separator. This would make source and reader coordinates diverge.

`text_spans` contain document-relative source offsets and a final reader
segment index. A source span must slice to exactly the pre-tokenization reader
segment text. Spans for distinct reader text segments must not overlap.

`structural_boundaries` use the Phase 1 offset-based shape: `offset`, `text`,
and `reason`, with EPUB documents also persisting `end_offset`. The boundary
range is `[offset, end_offset)`, or `[offset, offset + len(text))` when
the fallback producer omits `end_offset`. Its text must match that exact source
slice, ranges must be ordered and non-overlapping, and reader text spans must
not intersect a boundary.

## Ruby Provenance

For each author ruby hint:

- `start_offset` and `end_offset` refer to the normalized source-document text;
- `base_text` equals the source-text slice at those offsets;
- `base_text_raw` preserves the author-emitted base text when normalization
  removed characters;
- `reading_raw` retains the author-provided `rt` text;
- `markup` records `rb` and `rp` structure;
- provenance is `epub_ruby`.

Ruby must remain source-level provenance in Phase 1. Do not write it into the
existing rendered token reading field as part of analysis work.

## Reader Compatibility Boundary

`Chapter.content_json` is a compact reader cache. The existing public chapter
API, frontend token shape, and highlight
`(chapter_index, segment_index, token_index)` coordinates are independent of
this contract and must not be expanded to carry source-analysis fields.

The parser-private `source_document_segment_counts` provenance exists only
until chapter merging has produced the persisted source-to-reader projection.
It must not be serialized through the reader cache.

## Compatibility And Migration

- Existing books imported before Phase 1 are `legacy_unavailable` because the
  original upload and a source-content version do not exist. They remain fully
  readable.
- A book is `rebuildable` only after its immutable source file and source
  content version commit successfully in the same import completion path.
- Do not treat older source-schema versions as version 4. A future migration
  must either understand the old contract explicitly or rebuild from the
  private original file into a new source-content version.
- The current application does not provide an in-place attachment/rebuild flow
  for old books. Do not advise users to delete and re-import a book as a way to
  preserve its existing reading progress, highlights, or vocabulary records.

## Phase 2 Analysis Contract

The first rebuildable analysis layer uses these tables:

- `AnalysisRun`: one versioned build with tokenizer, dictionary, split mode,
  filter, source hash, and analysis-schema metadata;
- `Lexeme`: a cross-run identity keyed by normalized form plus a trusted,
  normalized reading, or an explicitly provisional null reading;
- `RunLexeme`: the run-local Sudachi observation, including full POS,
  inflection, reading provenance, OOV, word ID, and dictionary ID diagnostics;
- `LexemeOccurrence`: one lexical occurrence with source-document offsets and
  optional Reader segment/token projections;
- `ChapterLexemeStat`: the only materialized aggregate. Book totals are summed
  from chapter rows; there is no `BookLexemeStat`.

The current filter indexes content-word POS (`名詞`, `動詞`, `形容詞`, `形状詞`,
`副詞`), including OOV and proper nouns. The complete filter specification is
stored on every run. `word_id` and `dictionary_id` are diagnostics only and do
not participate in canonical or provisional identity.

Run publication follows these rules:

1. Make every analysis run reference a concrete `SourceContentVersion`.
2. Store occurrence offsets in that version's document coordinate space.
3. Use `reader_projection` only when navigating from an analysis occurrence
   back to the existing reader; never infer a target chapter from titles or
   text search.
4. Treat structural boundaries as non-text and do not create lexical
   occurrences that span them.
5. Keep analysis data disposable. Rebuilding a version must not mutate reader
   caches or user-owned learning state.
6. Build the new run while inactive. Mark it completed and switch the book's
   single active run in one transaction only after all rows validate.
7. Roll back partial derived rows on failure, persist the run as failed, and
   leave the previous active run unchanged.

`reader_segment_index` and `reader_token_index` are coordinates in the compact
Reader cache, not source coordinates. The analysis service writes
`reader_token_index` only after one source span, one rendered text segment, and
the segment's token surfaces reconstruct the same text and identify one
non-gap token. It must not derive the value from `source_token_index`, filtered
occurrence order, or a guessed token sequence. Existing runs may have a null
Reader token coordinate and remain readable. The current Reader lookup payload
contains Reader coordinates, so a lookup against such a legacy run generally
cannot be associated with a Lexeme and remains a valid unresolved event instead
of guessing. Re-analyzing from the retained source content is the supported way
to obtain the reliable Reader projection needed for Lexeme-level lookup
observations.

Before tokenization, the analysis service strictly validates the persisted
version-4 source shape. The payload must declare `unicode_codepoint` offsets
and a `documents` array. Every document needs a unique non-empty ID, text,
`ruby_hints`, and `structural_boundaries`; each non-blank reader-source
document also needs a projection with a valid chapter index and ordered,
in-bounds, non-overlapping text spans. Ruby hints and structural boundaries
must slice back to their declared source text; reader spans cannot cross a
structural boundary. Contract or hash validation failures produce a failed,
inactive run and can never publish an empty active index.

Successful imports start an initial analysis only after the reader chapters,
immutable source file, and source-content version have committed. Analysis
failure therefore cannot turn a readable imported book into a failed import.

The Phase 3-facing internal API is intentionally separate from the reader API:

```text
POST /api/internal/books/{book_id}/analysis-runs
GET  /api/internal/books/{book_id}/analysis/lexemes
GET  /api/internal/books/{book_id}/analysis/lexemes/{lexeme_id}/occurrences
```

The two GET routes always read the completed active run. The first aggregates
book counts from `ChapterLexemeStat`; an optional `chapter_index` limits the
same contract to one chapter. No analysis fields are added to
`Chapter.content_json` or the existing chapter response.

`POST /analysis-runs` is synchronous. HTTP `200` means the rebuild request was
processed, not necessarily that an index was published: callers must inspect
the returned run's `status`. A body with `status: "completed"` is the success
case; `status: "failed"` reports a retained failed run while any previously
active completed run remains queryable. HTTP `409` means source analysis could
not be started because the book or requested rebuildable source version is
unavailable.

The public, user-visible consumer of an active run is documented separately in
[Book Learning Map Contract](LEARNING_MAP_CONTRACT.md). It owns coverage,
knowledge-baseline, and recommendation semantics; this document owns the
source coordinate and analysis-lifecycle invariants beneath it.

## Regression Coverage

`backend/tests/test_source_content.py` covers the source contract's critical
fixtures: ruby variants and remapped offsets, zero-width text, newline
normalization, source-to-merged-chapter projection, image boundaries, PDF
fallback boundaries, private static-path denial, and deferred source cleanup.

`backend/tests/test_analysis_service.py` covers canonical/provisional identity,
OOV convergence, occurrence offsets, chapter/book aggregation, deterministic
rebuilds, active-run switching, malformed-source rejection, failed-run
isolation, deletion, and the internal API contract.
