# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-08-08
- Primary product surfaces: application workspace (Library, global vocabulary and excerpt library, settings), Reader, and book learning map
- Evidence reviewed: `web/src/App.tsx`, `web/src/pages/LibraryPage.tsx`, `web/src/pages/StudyPage/index.tsx`, `web/src/pages/SettingsPage/index.tsx`, `web/src/pages/StudyPage/VocabularyTab.tsx`, `web/src/pages/StudyPage/HighlightTab.tsx`, `web/src/pages/LearningMapPage.tsx`, `web/src/components/reader/LeftDock.tsx`, `web/src/components/reader/TokenPopover.tsx`, `web/src/components/reader/ReaderSidebar.tsx`, `backend/app/services/analysis_service.py`, `backend/app/services/lookup_event_service.py`, `backend/tests/test_learning_map.py`, `backend/tests/test_lookup_events.py`, `backend/dev_docs/LEARNING_MAP_CONTRACT.md`, `backend/dev_docs/KNOWLEDGE_IMPORT_CONTRACT.md`, `backend/dev_docs/STUDY_MATERIALS_BOUNDARY.md`

## Brand
- Personality: quiet, practical, study-focused, and local-first
- Trust signals: show the analysis run and filter scope behind derived book metrics; distinguish unavailable data from zero
- Avoid: marketing dashboards, competing coverage percentages, decorative visualization without reading value

## Product goals
- Goals: help a reader decide what to read next and which unknown lexemes matter in the current book; preserve a clear cross-book library for saved vocabulary, excerpts, and reading analyses
- Non-goals: spaced repetition, review scheduling, external corpus ranking, bulk Anki export, automatic or bulk sentence-card generation, editable personal notes, or treating lookup history as inferred context acquisition. Context-card Anki writing is an explicit, text-only action outside the Learning Map.
- Success signals: a reader can identify the next chapter, its unresolved vocabulary density, the real long-tail cost of book coverage, and factual lookup/recurrence evidence without mistaking saved material for mastery or a review queue

## Personas and jobs
- Primary personas: one local reader studying Japanese through imported light novels
- User jobs: scan a book's chapter difficulty, review explicit-known coverage, and choose a small next vocabulary set
- Key contexts of use: desktop study sessions and narrow mobile reading breaks

## Information architecture
- Primary navigation: the shared application workspace contains Library, Vocabulary and excerpts, plus Settings as a lower-priority utility entry. Library -> Reader; Library book menu -> Learning map; Reader -> current-book Learning map. The Reader and book-specific routes deliberately use their own contextual navigation rather than the workspace navigation.
- Core routes/screens: `/`, `/study`, `/settings`, `/book/:bookId`, `/read/:bookId`, `/study/map/:bookId`
- Content hierarchy: desktop workspace navigation is a persistent left sidebar; narrow screens use a stable bottom navigation. The global material library contains Vocabulary collection (word form, reading, definition, source book, existing context) and Excerpts and analysis (highlighted original text and saved AI analysis). The Settings workspace has a second-level configuration navigation: desktop lists configuration domains and the Anki vocabulary baseline import in a local sidebar, while narrow screens use an equivalent native selection control. The book learning map remains a separate book-level route.

## Design principles
- Evidence before interpretation: show the filter scope, run identity, and actual curve values close to the metric
- Compact scanning: use dense rows and restrained panels instead of a marketing-style dashboard
- Honest empty states: uninitialized baseline and missing analysis are explicit states, never zero-filled substitutes
- Fact versus inference: lookup history is an immutable user-action fact; recurrence after a lookup is a query-time observation and must never be presented as a knowledge-state decision
- Content role clarity: saved vocabulary is a reading-material collection, excerpts and AI analysis are reference material, and neither is presented as a review queue or mastery state
- Navigation hierarchy: cross-book destinations have one persistent, visible navigation model. The current page's primary command, such as importing a book or saving settings, stays within its content header rather than competing with global navigation.
- Settings hierarchy: a settings configuration domain is a mutually exclusive work surface, so show the selected domain's fields rather than making users scan every collapsed group. Unsaved modifications remain visible in the local navigation and survive section changes until saved or reset.
- Tradeoffs: small-screen readability and stable labels take priority over showing every metadata field at once. A compact bottom navigation replaces the desktop sidebar on narrow screens; the lower-frequency Settings destination remains available but does not compete with reading controls.

## Visual language
- Color: reuse the existing light gray, white, blue, indigo, amber, and red status palette from the Study and Library pages
- Typography: existing Tailwind text scale; compact headings inside panels and normal Japanese line wrapping
- Spacing/layout rhythm: a border-separated workspace sidebar frames full-width page content. Settings adds a compact, border-separated local sidebar within its content area on desktop. Use `p-4` on narrow screens and `p-6` to `p-8` in the desktop workspace; page content owns its readable maximum width.
- Shape/radius/elevation: existing 8px to 12px functional surfaces; no nested decorative cards. The workspace navigation is structural, not a floating card.
- Motion: existing subtle loading indicators only; no new motion required
- Imagery/iconography: reuse `lucide-react` icons for navigation and state cues

## Components
- Existing components to reuse: reader navigation's responsive desktop/mobile pattern, Study tab pattern, `Loader2`, `AlertCircle`, `BookOpen`, and Tailwind status colors
- New/changed components: shared workspace navigation shell, settings configuration navigation, learning map page, chapter density rows, and coverage curve table
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
- Layout adaptations: the workspace sidebar is visible from `md` upward; below `md`, the same destinations move into a safe-area-aware bottom navigation and page content reserves bottom space. The Settings local sidebar is visible from `lg` upward and becomes a native select at smaller widths. Two-column desktop content becomes one column; recommendation and chapter metadata wrap instead of shrinking.
- Touch/hover differences: rows remain readable and actionable without hover-only content

## Interaction states
- Loading: centered spinner and short loading label
- Empty: distinguish no saved vocabulary/excerpts from an uninitialized learning-map baseline; do not say coverage is 0% and do not suggest that empty material means no review is due
- Error: distinguish missing analysis from a generic request failure and preserve a recovery-oriented message
- Success: show the single explicit-known metric and evidence underneath
- Disabled: none beyond unavailable/rebuild-required actions
- Offline/slow network, if applicable: existing React Query error surface, with retry affordance where the page already uses it

## Content voice
- Tone: concise, factual, non-judgmental
- Terminology: use “词汇与摘录”, “词汇收藏”, and “摘录与解析” for the global library; use “明确掌握” for explicit known, “个人词汇基线” for the learning-map baseline, and “待确认” for unavailable chapter unknown counts
- Microcopy rules: describe saved vocabulary as material the reader chose to keep, not as a study commitment or mastery; describe highlights/AI analysis as reference material; explain OOV/proper-noun handling in plain language; state that the reader queried and that the word later appeared, never that the system decided the reader learned it; do not promise that a small word list reaches a target percentage

## Implementation constraints
- Framework/styling system: React 19, TypeScript, Vite, Tailwind, React Query, lucide-react
- Design-token constraints: follow existing utility classes and palette; no new dependency or parallel design system
- Performance constraints: one learning-map request per book view, bounded aggregate response, no client-side corpus computation
- Compatibility constraints: preserve existing Reader, Vocabulary, Highlight, and Progress routes and API contracts
- Navigation constraints: preserve `/`, `/study`, and `/settings` paths and direct-link behavior. Do not mount the shared workspace shell on `/book/:bookId`, `/read/:bookId`, or `/study/map/:bookId`; those surfaces have their own book-specific navigation.
- Settings navigation constraints: derive local configuration navigation items from the backend-provided `schema_info` groups so every supported configuration remains reachable. Changing the selected domain must not discard unsaved edits, bypass restart warnings, or alter the user-config API contract.
- Study boundary: `/study` keeps its route and data requests, but is labeled “词汇与摘录”; do not add SRS, review, note-editing, AI schema migration, or bulk export controls as part of terminology changes. Context-card Anki writing remains an explicit action after a draft is generated.
- Lookup constraints: `GET /api/dictionary/search` stays side-effect free; only the Reader token selection handler owns the idempotent lookup-event write. Unresolved mappings remain valid data, while Lexeme merges are resolved only during summary queries.
- Lookup provenance: Learning Map observations only use events whose recorded analysis run shares the active run's `source_content_version_id`; legacy analysis rows without a Reader token projection remain readable, but Reader-originated events against them generally stay unresolved until re-analysis.
- Deferred exports: Sentence/i+1 and bulk Anki export remain out of scope. Context-card writes use their own `ContextCardAnkiLedger`; any future bulk-export GUIDs belong to an append-only `AnkiExportLedger`, not auto-increment Lexeme ids.
- Test/screenshot expectations: lint and build; inspect desktop and mobile widths when a browser surface is available

## Open questions
- [ ] Manual explicit-known editing is a Phase 4 concern; Phase 3 only consumes unambiguous legacy mastered records.
- [ ] Personal note ownership (vocabulary, excerpt, or independent entity), editing/history, and export semantics need a separate design.
- [ ] `ai_analysis` compatibility, structured schema, rendering, and migration strategy need a separate review.
- [ ] Anki baseline import must remain distinct from context-card writes and future bulk export; stable GUID, example/i+1, media, and bulk export-ledger semantics need a separate design.
