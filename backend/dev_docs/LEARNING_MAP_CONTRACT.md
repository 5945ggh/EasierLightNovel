# Book Learning Map Contract

## Endpoint

`GET /api/books/{book_id}/learning-map`

Optional query parameters:

- `chapter_index`: reading anchor used to select the chapter context. When omitted, the stored reading progress chapter is used, falling back to `0`.

The response always includes `analysis_run_id` (or `null`), `analysis_status`, the baseline status/message, the reading anchor, and the run's `filter_spec`. A missing active run returns HTTP 200 with `analysis_status: "needs_analysis"`, `coverage: null`, an empty coverage curve, and no chapter rows. It does not calculate from legacy chapter JSON.

## Coverage

`coverage.explicit_known_coverage` is the only coverage percentage. Its denominator is eligible occurrences from the active run after applying the persisted filter spec:

- `pos_allowlist`: `名詞`, `動詞`, `形容詞`, `形状詞`, `副詞`
- `exclude_proper_nouns`: `false`
- `exclude_oov`: `false`

OOV and proper-noun behavior is therefore visible and reproducible. OOV can remain in the denominator when the persisted filter allows it. The coverage curve uses the same eligible occurrences and reports the additional covered occurrences needed for each target percentage.

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

When no canonical known Lexeme is available, `knowledge_baseline_status` is `"uninitialized"`, `coverage` is `null`, chapter unknown fields are `null`, and the coverage curve is empty. This does not mean every lexeme is unknown.

## Reader lookup facts and context observations

`POST /api/books/{book_id}/reader/lookup-events` is the dedicated write API for
deliberate Reader dictionary lookups. `GET /api/dictionary/search` remains a
pure dictionary query. Study-page dictionary hydration, Vocabulary detail
loading, background requests, and either dictionary display surface do not
create lookup events.

The event table is an append-only history of user behavior. Each event keeps
the book and chapter identity, chapter index, the active `analysis_run_id` when
one exists, Reader segment/token coordinates, the surface/query text, the
event type, server creation time, and a client event id. It may also keep a
canonical/provisional Lexeme and RunLexeme reference plus source document
offsets when the mapping is proven. The client id is unique, so retries are
idempotent; a later deliberate selection gets a new id and is a new event.

`TokenRenderer` is the sole frontend event owner. `TokenPopover` and
`ReaderSidebar` may issue the dictionary GET needed to display the result, but
they do not write the event. This boundary is stable under React effect
replays, Strict Mode, duplicate rendering surfaces, and dictionary cache
hydration.

Lexeme association is conservative. Source offsets and Reader coordinates are
accepted only when they identify one occurrence with matching surface and
consistent coordinate evidence. A missing, contradictory, or multiply matched
identity remains a valid unresolved event with its surface and coordinates;
the system never fills it by guessing from source token order or filtered
occurrence order. `LexemeOccurrence.reader_token_index` is an additive,
nullable Reader-cache coordinate. Older analysis rows can therefore continue
to load and can remain unresolved.

Lookup events remain an independent reader-history contract. They are not
embedded in the Learning Map response, do not increase
`explicit_known_coverage`, and never modify `UserLexemeKnowledge`.

Events retain the Lexeme id that was known at write time. If a Lexeme is later
merged, summary queries follow `Lexeme.merged_into_id` to the current canonical
Lexeme without rewriting historical events. Observations are omitted when
there is no real lookup history; unavailable source-coordinate evidence is
reported as unavailable rather than converted into a fabricated page number.
Observation history is limited to events whose recorded analysis run points to
the active run's `source_content_version_id`. A re-analysis of the same source
version may therefore retain compatible lookup history, while events from an
older or different source version do not enter the current Learning Map
observation. Legacy analysis rows remain readable, but their nullable
`reader_token_index` cannot be reconstructed from the Reader token index; with
the current Reader event payload, lookups against those rows are preserved as
unresolved until the book is re-analyzed from its source content.

Sentence entities, Japanese sentence splitting, i+1 selection/scoring,
sentence caches, bulk Anki exports, TTS/media exports, JLPT datasets, and new
frequency baselines remain deferred. Context-card Anki writes are a separate
explicit action outside the Learning Map and baseline-import contract. A future Anki export
must obtain stable GUID ownership from an append-only `AnkiExportLedger`, never
from `lexeme_id` or another auto-increment id; Phase 5 does not create that
ledger.

The endpoint does not implement per-lexeme recommendation rows, an
`acquired_in_context` state, sentence cards, i+1 selection, exports, external
frequency data, or new OOV categories. The coverage curve is aggregate output
only; it is not a recommendation queue or a knowledge-state decision.

## External baseline imports

External baseline reads are opt-in. AnkiConnect is queried only from an
explicit preview/apply request using its localhost read-only v6 actions
`version`, `deckNames`, `modelNames`, `findCards`, `cardsInfo`, `cardsToNotes`,
and `notesInfo` (plus model template metadata), with a finite timeout. An unavailable Anki,
connection refusal, timeout, or invalid protocol response returns a recoverable
request error and never affects application startup, reading, or an existing
baseline. Callers supply the expression and reading field mappings; no note
template is assumed.

`POST /api/knowledge-imports/anki/preview` and its JLPT equivalent return
total, parsable, unique, ambiguous, unmatched, and provisional counts before
any write. Anki previews additionally return card/note/Lexeme conversion
funnel counts, raw state distribution, known counts before/after, and affected
book coverage deltas. Only a unique exact match on normalized form and trusted
canonical kana reading can become `known`; Anki evidence below the Mature
interval threshold becomes `learning`, while Suspended evidence is retained
without creating `known`. `POST .../apply` repeats the specified read and
persists one reversible import batch with card-level provenance;
`DELETE /api/knowledge-imports/{id}` revokes only that batch. Repeated active
imports are idempotent, while a revoked import may be deliberately applied
again.

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
