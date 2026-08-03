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

Phase 4 consumes the resolved canonical `UserLexemeKnowledge` baseline. `known`
is the only state that contributes to explicit-known coverage. `learning` and
`ignored` are explicit user choices, but neither increases coverage; an absent
row means undeclared rather than `unknown`.

`GET /api/internal/books/{book_id}/analysis/knowledge-baseline` returns the
effective known, learning, and ignored counts together with an effective
`source_distribution` and `latest_updated_at`. The source distribution follows
the same manual > active external import > legacy precedence used for coverage,
so it describes the baseline currently in effect rather than every superseded
record.

Manual state has priority over active external imports, which have priority
over the compatibility migration from legacy `Vocabulary.status == 3` rows. A
manual row therefore never gets overwritten by Anki, JLPT, or a legacy
migration. State resolution follows `Lexeme.merged_into_id` to its final
canonical target before aggregating occurrences, so a merge cannot double
count a word.

Legacy rows remain read-only compatibility input. A row maps only when:

1. the legacy `base_form` is NFKC-normalized and trimmed, then matches one active-run `RunLexeme.dictionary_form`;
2. the candidate Lexeme is non-provisional and not merged; and
3. the candidate is unambiguous, or a supplied legacy reading matches its canonical/observed reading.

Ordinary Vocabulary rows, status `1` learning rows, lookups, frequency, OOV,
and reading progress do not create known state. The migration is idempotent;
it writes only unambiguous trusted canonical identities with provenance
`legacy_vocabulary`, and leaves the original Vocabulary data unchanged.
Unmapped legacy rows remain preserved and are counted in
`knowledge_baseline_migration_status` / `knowledge_baseline_message`.

When no canonical known Lexeme is available, `knowledge_baseline_status` is `"uninitialized"`, `coverage` is `null`, chapter unknown fields are `null`, and recommendations are empty. This does not mean every lexeme is unknown.

## Recommendation order

`recommended_lexemes` is the actionable learning-target set. It excludes
canonical `known` Lexemes, Lexemes whose effective state is `ignored`, and
rows marked `excluded_from_learning_target`. `known` is excluded because it is
already counted in explicit-known coverage; `ignored` is excluded because the
reader explicitly chose not to study it. `learning` remains eligible for
recommendation but does not increase coverage.

`manageable_lexemes` is deliberately broader than `recommended_lexemes`: it
keeps the ranked, manually controllable rows visible, including `known` and
`ignored` rows, so a reader can inspect the effective state and restore a
different choice. It exposes `is_recommended` instead of silently treating an
ignored row as a recommendation. Both collections use upcoming occurrence
count from the reading anchor (descending), book occurrence count (descending),
first chapter (ascending), then stable lexeme text/id tie-breakers.

The endpoint does not implement lookup logs, acquired-in-context, sentence
cards, i+1 selection, exports, external frequency data, or new OOV categories.

## External baseline imports

External baseline reads are opt-in. AnkiConnect is queried only from an
explicit preview/apply request using its localhost read-only actions `version`,
`findNotes`, and `notesInfo`, with a finite timeout. An unavailable Anki,
connection refusal, timeout, or invalid protocol response returns a recoverable
request error and never affects application startup, reading, or an existing
baseline. Callers supply the expression and reading field mappings; no note
template is assumed.

`POST /api/knowledge-imports/anki/preview` and its JLPT equivalent return
total, parsable, unique, ambiguous, unmatched, and provisional counts before
any write. Only a unique exact match on normalized form and trusted canonical
kana reading can become `known`. `POST .../apply` repeats the specified read
and persists one reversible import batch; `DELETE /api/knowledge-imports/{id}`
revokes only that batch. Repeated active imports are idempotent, while a
revoked import may be deliberately applied again.

Different active batches may retain separate import items for the same Lexeme,
including across Anki and JLPT. A source-scoped `UserLexemeKnowledge` row is
removed only after its final active item is revoked, so deleting one batch
never discards evidence retained by another batch.

JLPT accepts a local JSON document and does not bundle a dataset:

```json
{"schema_version":1,"source_id":"optional-source-id","entries":[
  {"id":"n5-001","level":"N5","word":"猫","reading":"ネコ"}
]}
```

The client selects at least one N5--N1 level before preview/import. Imported
item provenance retains the source entry id, optional source id, original
level, metadata, and time. The same NFKC plus Katakana-to-Hiragana normalizer
used for `canonical_reading_kana` handles imported readings. A selected JLPT
level is an explicit choice to import a known baseline, not proof of mastery,
and it never changes Lexeme identity.
