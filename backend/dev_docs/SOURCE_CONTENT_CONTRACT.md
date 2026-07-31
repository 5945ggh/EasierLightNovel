# Source Content Contract

## Purpose

This document defines the private, rebuildable source-data boundary introduced
in Phase 1. It is the contract between import/parsing and any future analysis
layer. It does not add fields to the reader API or `Chapter.content_json`.

The lifecycle is deliberately one-directional:

```text
immutable original EPUB/PDF
  -> parser-derived SourceContentVersion
  -> future rebuildable analysis artifacts
```

The original file is authoritative input. `SourceContentVersion` is a
versioned derivative. Future `AnalysisRun`, lexeme, sentence, and occurrence
data must be derived from a specific source-content version and must remain
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

## Requirements For Future Analysis

Before adding analysis tables:

1. Make every analysis run reference a concrete `SourceContentVersion`.
2. Store occurrence offsets in that version's document coordinate space.
3. Use `reader_projection` only when navigating from an analysis occurrence
   back to the existing reader; never infer a target chapter from titles or
   text search.
4. Treat structural boundaries as non-text and do not create lexical
   occurrences that span them.
5. Keep analysis data disposable. Rebuilding a version must not mutate reader
   caches or user-owned learning state.

## Regression Coverage

`backend/tests/test_source_content.py` covers the source contract's critical
fixtures: ruby variants and remapped offsets, zero-width text, newline
normalization, source-to-merged-chapter projection, image boundaries, PDF
fallback boundaries, private static-path denial, and deferred source cleanup.
