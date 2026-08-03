# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-08-03
- Primary product surfaces: Library, Reader, Study, book learning map
- Evidence reviewed: `web/src/App.tsx`, `web/src/pages/LibraryPage.tsx`, `web/src/pages/LearningMapPage.tsx`, `web/src/components/reader/TokenRenderer.tsx`, `backend/app/services/analysis_service.py`, `backend/app/services/lookup_event_service.py`, `backend/tests/test_learning_map.py`, `backend/tests/test_lookup_events.py`, `backend/dev_docs/LEARNING_MAP_CONTRACT.md`

## Brand
- Personality: quiet, practical, study-focused, and local-first
- Trust signals: show the analysis run and filter scope behind derived book metrics; distinguish unavailable data from zero
- Avoid: marketing dashboards, competing coverage percentages, decorative visualization without reading value

## Product goals
- Goals: help a reader decide what to read next and which unknown lexemes matter in the current book
- Non-goals: spaced repetition, external corpus ranking, Anki export, sentence cards, or treating lookup history as inferred context acquisition
- Success signals: a reader can identify the next chapter, its unresolved vocabulary density, the real long-tail cost of book coverage, and factual lookup/recurrence evidence without mistaking it for mastery

## Personas and jobs
- Primary personas: one local reader studying Japanese through imported light novels
- User jobs: scan a book's chapter difficulty, review explicit-known coverage, and choose a small next vocabulary set
- Key contexts of use: desktop study sessions and narrow mobile reading breaks

## Information architecture
- Primary navigation: Library -> Reader; Library -> Study; Library book menu -> Learning map; Reader -> current-book Learning map; Study -> Vocabulary, Highlights
- Core routes/screens: `/`, `/read/:bookId`, `/study`, `/study/map/:bookId`
- Content hierarchy: book identity and data status, one coverage metric, chapter scan, current/upcoming recommendations, frequency curve, scope notes

## Design principles
- Evidence before interpretation: show the filter scope, run identity, and actual curve values close to the metric
- Compact scanning: use dense rows and restrained panels instead of a marketing-style dashboard
- Honest empty states: uninitialized baseline and missing analysis are explicit states, never zero-filled substitutes
- Fact versus inference: lookup history is an immutable user-action fact; recurrence after a lookup is a query-time observation and must never be presented as a knowledge-state decision
- Tradeoffs: small-screen readability and stable labels take priority over showing every metadata field at once

## Visual language
- Color: reuse the existing light gray, white, blue, indigo, amber, and red status palette from the Study and Library pages
- Typography: existing Tailwind text scale; compact headings inside panels and normal Japanese line wrapping
- Spacing/layout rhythm: existing `px-6`, `gap-4`, and border-separated Study layout, reduced to `px-4` on mobile
- Shape/radius/elevation: existing 8px to 12px Study surfaces; no nested decorative cards
- Motion: existing subtle loading indicators only; no new motion required
- Imagery/iconography: reuse `lucide-react` icons for navigation and state cues

## Components
- Existing components to reuse: Study header/tab pattern, `Loader2`, `AlertCircle`, `BookOpen`, `ArrowLeft`, Tailwind status colors
- New/changed components: learning map page, chapter density rows, frequency curve table, recommendation rows
- Variants and states: loading, ready, uninitialized baseline, needs analysis, request error, and an optional lookup observation only when real event evidence exists
- Token/component ownership: page-local Tailwind classes, with global changes limited to responsive behavior if required

## Accessibility
- Target standard: semantic HTML and WCAG-oriented contrast within the existing visual system
- Keyboard/focus behavior: all navigation uses links or buttons with visible focus styles from browser/Tailwind defaults
- Contrast/readability: status text is paired with labels and never conveyed by color alone
- Screen-reader semantics: tables use headers; progress bars include textual percentage values
- Reduced motion and sensory considerations: no required animation for comprehension

## Responsive behavior
- Supported breakpoints/devices: existing Tailwind mobile-first breakpoints, desktop and narrow mobile widths
- Layout adaptations: two-column desktop content becomes one column; recommendation and chapter metadata wrap instead of shrinking
- Touch/hover differences: rows remain readable and actionable without hover-only content

## Interaction states
- Loading: centered spinner and short loading label
- Empty: explain that the personal vocabulary baseline is not initialized; do not say coverage is 0%
- Error: distinguish missing analysis from a generic request failure and preserve a recovery-oriented message
- Success: show the single explicit-known metric and evidence underneath
- Disabled: none beyond unavailable/rebuild-required actions
- Offline/slow network, if applicable: existing React Query error surface, with retry affordance where the page already uses it

## Content voice
- Tone: concise, factual, non-judgmental
- Terminology: use “明确掌握” for explicit known, “个人词汇基线” for the baseline, and “待确认” for unavailable chapter unknown counts
- Microcopy rules: explain OOV/proper-noun handling in plain language; state that the reader queried and that the word later appeared, never that the system decided the reader learned it; do not promise that a small word list reaches a target percentage

## Implementation constraints
- Framework/styling system: React 19, TypeScript, Vite, Tailwind, React Query, lucide-react
- Design-token constraints: follow existing utility classes and palette; no new dependency or parallel design system
- Performance constraints: one learning-map request per book view, bounded recommendation list, no client-side corpus computation
- Compatibility constraints: preserve existing Reader, Vocabulary, Highlight, and Progress routes and API contracts
- Lookup constraints: `GET /api/dictionary/search` stays side-effect free; only the Reader token selection handler owns the idempotent lookup-event write. Unresolved mappings remain valid data, while Lexeme merges are resolved only during summary queries.
- Lookup provenance: Learning Map observations only use events whose recorded analysis run shares the active run's `source_content_version_id`; legacy analysis rows without a Reader token projection remain readable, but Reader-originated events against them generally stay unresolved until re-analysis.
- Deferred exports: Sentence/i+1/Anki write remain out of scope. Future Anki GUIDs belong to an append-only `AnkiExportLedger`, not auto-increment Lexeme ids.
- Test/screenshot expectations: lint and build; inspect desktop and mobile widths when a browser surface is available

## Open questions
- [ ] Manual explicit-known editing is a Phase 4 concern; Phase 3 only consumes unambiguous legacy mastered records.
