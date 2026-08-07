import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isLearningMapResponse } from '../src/types/learningMap.ts';

const readyResponse = {
  book_id: 'book-1',
  analysis_status: 'ready',
  analysis_run_id: 7,
  knowledge_baseline_status: 'ready',
  knowledge_baseline_migration_status: 'none',
  knowledge_baseline_message: 'ready',
  filter_spec: {
    pos_allowlist: ['名詞'],
    exclude_proper_nouns: false,
    exclude_oov: true,
    identity: 'run-7',
  },
  reading_anchor_chapter_index: 0,
  coverage: { explicit_known_coverage: 0.5, known_occurrences: 1, eligible_occurrences: 2 },
  coverage_curve: [{ target_coverage: 0.8, required_lexeme_count: 3, covered_occurrences: 2 }],
  chapters: [{
    chapter_index: 0,
    title: 'Opening',
    eligible_occurrences: 2,
    explicit_known_occurrences: 1,
    unknown_occurrences: 1,
    unknown_lexeme_count: 1,
    new_lexeme_count: 1,
  }],
};

test('accepts the ready Learning Map API contract', () => {
  assert.equal(isLearningMapResponse(readyResponse), true);
});

test('accepts an uninitialized map without fabricating coverage', () => {
  assert.equal(isLearningMapResponse({
    ...readyResponse,
    analysis_status: 'needs_analysis',
    knowledge_baseline_status: 'uninitialized',
    coverage: null,
    coverage_curve: [],
    chapters: [],
  }), true);
});

test('rejects a response missing required baseline metadata', () => {
  const invalid = { ...readyResponse } as { knowledge_baseline_message?: string };
  delete invalid.knowledge_baseline_message;
  assert.equal(isLearningMapResponse(invalid), false);
});
