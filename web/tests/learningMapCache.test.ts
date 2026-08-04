import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  decrementPendingLexeme,
  getLearningMapLexemeStatus,
  incrementPendingLexeme,
  isLatestLexemeMutation,
  updateLearningMapLexemeStatus,
} from '../src/services/learning-map-cache.ts';

const mapFixture = {
  book_id: 'fixture',
  analysis_status: 'ready' as const,
  analysis_run_id: 1,
  knowledge_baseline_status: 'ready' as const,
  knowledge_baseline_migration_status: 'none' as const,
  knowledge_baseline_message: '',
  filter_spec: {
    pos_allowlist: ['名詞'],
    exclude_proper_nouns: false,
    exclude_oov: false,
    identity: 'fixture',
  },
  reading_anchor_chapter_index: 0,
  coverage: {
    explicit_known_coverage: 0,
    known_occurrences: 0,
    eligible_occurrences: 3,
  },
  coverage_curve: [],
  chapters: [],
  recommended_lexemes: [{
    lexeme_id: 7,
    normalized_form: '猫',
    display_form: '猫',
    reading: 'ねこ',
    part_of_speech: '名詞',
    book_occurrence_count: 3,
    upcoming_chapter_occurrence_count: 3,
    first_chapter_index: 0,
    excluded_from_learning_target: false,
    knowledge_status: null,
  }],
  manageable_lexemes: [{
    lexeme_id: 7,
    normalized_form: '猫',
    display_form: '猫',
    reading: 'ねこ',
    part_of_speech: '名詞',
    book_occurrence_count: 3,
    upcoming_chapter_occurrence_count: 3,
    first_chapter_index: 0,
    excluded_from_learning_target: false,
    knowledge_status: null,
    is_recommended: true,
  }],
};

test('optimistic learning-map status updates are immediate and reversible by the snapshot', () => {
  const known = updateLearningMapLexemeStatus(mapFixture, 7, 'known');

  assert.equal(known.recommended_lexemes[0].knowledge_status, 'known');
  assert.equal(known.manageable_lexemes?.[0].knowledge_status, 'known');
  assert.equal(known.manageable_lexemes?.[0].is_recommended, false);
  assert.equal(mapFixture.recommended_lexemes[0].knowledge_status, null);

  const unset = updateLearningMapLexemeStatus(known, 7, null);
  assert.equal(unset.recommended_lexemes[0].knowledge_status, null);
  assert.equal(unset.recommended_lexemes[0].state, null);
  assert.equal(unset.manageable_lexemes?.[0].is_recommended, true);
});

test('interleaved failure rollback changes only the failed lexeme', () => {
  const secondLexemeMap = {
    ...mapFixture,
    recommended_lexemes: [
      ...mapFixture.recommended_lexemes,
      {
        ...mapFixture.recommended_lexemes[0],
        lexeme_id: 8,
        normalized_form: '本',
        display_form: '本',
      },
    ],
    manageable_lexemes: [
      ...mapFixture.manageable_lexemes!,
      {
        ...mapFixture.manageable_lexemes![0],
        lexeme_id: 8,
        normalized_form: '本',
        display_form: '本',
      },
    ],
  };
  const afterFirstOptimistic = updateLearningMapLexemeStatus(
    secondLexemeMap,
    7,
    'learning',
  );
  const afterSecondOptimistic = updateLearningMapLexemeStatus(
    afterFirstOptimistic,
    8,
    'known',
  );

  const rolledBackFirst = updateLearningMapLexemeStatus(
    afterSecondOptimistic,
    7,
    getLearningMapLexemeStatus(secondLexemeMap, 7) ?? null,
  );

  assert.equal(getLearningMapLexemeStatus(rolledBackFirst, 7), null);
  assert.equal(getLearningMapLexemeStatus(rolledBackFirst, 8), 'known');
  assert.equal(
    rolledBackFirst.manageable_lexemes?.find((item) => item.lexeme_id === 8)
      ?.is_recommended,
    false,
  );
});

test('keeps each lexeme pending until all of its requests settle', () => {
  let counts = new Map<number, number>();
  counts = incrementPendingLexeme(counts, 7);
  counts = incrementPendingLexeme(counts, 8);
  counts = incrementPendingLexeme(counts, 7);

  counts = decrementPendingLexeme(counts, 7);
  assert.equal(counts.get(7), 1);
  assert.equal(counts.get(8), 1);

  counts = decrementPendingLexeme(counts, 7);
  assert.equal(counts.has(7), false);
  assert.equal(counts.has(8), true);
});

test('only the latest request for a lexeme may roll back its optimistic state', () => {
  const latest = new Map<number, number>([[7, 2], [8, 1]]);

  assert.equal(isLatestLexemeMutation(latest, 7, 1), false);
  assert.equal(isLatestLexemeMutation(latest, 7, 2), true);
  assert.equal(isLatestLexemeMutation(latest, 8, 1), true);
});
