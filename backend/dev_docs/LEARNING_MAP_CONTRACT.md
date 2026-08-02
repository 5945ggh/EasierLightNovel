# Book Learning Map Contract

## Endpoint

`GET /api/books/{book_id}/learning-map`

Optional query parameters:

- `chapter_index`: reading anchor used to rank upcoming occurrences. When omitted, the stored reading progress chapter is used, falling back to `0`.
- `recommendation_limit`: maximum recommendation rows, default `20`, maximum `100`.

The response always includes `analysis_run_id` (or `null`), `analysis_status`, and the run's `filter_spec`. A missing active run returns HTTP 200 with `analysis_status: "needs_analysis"`, `coverage: null`, and an empty derived result. It does not calculate from legacy chapter JSON.

## Coverage

`coverage.explicit_known_coverage` is the only coverage percentage. Its denominator is eligible occurrences from the active run after applying the persisted filter spec:

- `pos_allowlist`: `名詞`, `動詞`, `形容詞`, `形状詞`, `副詞`
- `exclude_proper_nouns`: `false`
- `exclude_oov`: `false`

OOV and proper-noun behavior is therefore visible and reproducible. OOV can remain in the denominator while its `RunLexeme.excluded_from_learning_target` flag keeps it out of recommendations. The frequency curve uses the same eligible occurrences and ranks lexemes by book occurrence count.

## Knowledge baseline

Phase 3 consumes only legacy `Vocabulary.status == 3` rows. A row maps to a canonical active-run Lexeme only when:

1. the legacy `base_form` exactly matches one active-run `RunLexeme.dictionary_form`;
2. the candidate Lexeme is non-provisional and not merged; and
3. the candidate is unambiguous, or a supplied legacy reading matches its canonical/observed reading.

Ordinary Vocabulary rows, status `1` learning rows, lookups, frequency, OOV, and reading progress do not create known state. Unmapped legacy rows remain preserved and are counted in `knowledge_baseline_migration_status` / `knowledge_baseline_message`.

When no canonical known Lexeme is available, `knowledge_baseline_status` is `"uninitialized"`, `coverage` is `null`, chapter unknown fields are `null`, and recommendations are empty. This does not mean every lexeme is unknown.

## Recommendation order

Recommendations exclude canonical known Lexemes and rows marked `excluded_from_learning_target`. They are sorted by upcoming occurrence count from the reading anchor (descending), book occurrence count (descending), first chapter (ascending), then stable lexeme text/id tie-breakers.

The endpoint does not implement manual Phase 4 knowledge editing, AnkiConnect, lookup logs, acquired-in-context, sentence cards, i+1 selection, exports, external frequency data, or new OOV categories.
