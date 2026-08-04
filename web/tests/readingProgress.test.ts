import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  clearReadingProgressSnapshot,
  isLocalChapterSnapshotNewer,
  loadChapterProgressSnapshot,
  loadReadingProgressSnapshot,
  loadReadingProgressStore,
  parseChapterQuery,
  resolveInitialReaderPosition,
  saveChapterProgressSnapshot,
  saveReadingProgressSnapshot,
} from '../src/utils/readingProgress.ts';

const storage = new Map<string, string>();

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  },
});

beforeEach(() => {
  storage.clear();
});

test('migrates the legacy single snapshot without losing the resume location', () => {
  storage.set('reading_progress_book', JSON.stringify({
    chapterIndex: 3,
    segmentIndex: 12,
    percentage: 0.456,
    timestamp: 1730000000000,
  }));

  const store = loadReadingProgressStore('book');

  assert.equal(store.version, 2);
  assert.deepEqual(store.resume?.chapterIndex, 3);
  assert.deepEqual(store.chapters['3']?.segmentIndex, 12);
  assert.equal(JSON.parse(storage.get('reading_progress_book') ?? '{}').version, 2);
});

test('keeps chapter snapshots independent from the book resume cursor', () => {
  saveReadingProgressSnapshot('book', {
    chapterIndex: 1,
    segmentIndex: 4,
    percentage: 0.2,
    timestamp: 100,
  });
  saveChapterProgressSnapshot('book', {
    chapterIndex: 4,
    segmentIndex: 9,
    percentage: 0.8,
    timestamp: 200,
  });

  assert.equal(loadReadingProgressSnapshot('book')?.chapterIndex, 1);
  assert.equal(loadChapterProgressSnapshot('book', 1)?.segmentIndex, 4);
  assert.equal(loadChapterProgressSnapshot('book', 4)?.segmentIndex, 9);
});

test('prefers a newer local chapter snapshot and clears all book-local data', () => {
  const local = {
    chapterIndex: 2,
    segmentIndex: 7,
    percentage: 0.5,
    timestamp: 200,
  };
  saveChapterProgressSnapshot('book', local);

  assert.equal(isLocalChapterSnapshotNewer(local, {
    chapter_index: 2,
    current_segment_index: 1,
    progress_percentage: 10,
    updated_at: new Date(100).toISOString(),
  }), true);

  clearReadingProgressSnapshot('book');
  assert.equal(loadReadingProgressStore('book').resume, null);
  assert.equal(loadChapterProgressSnapshot('book', 2), null);
});

test('keeps book resume and chapter checkpoint positions separate', () => {
  const bookResume = {
    current_chapter_index: 1,
    current_segment_index: 14,
    progress_percentage: 72,
  };

  assert.deepEqual(
    resolveInitialReaderPosition({
      targetChapterIndex: 3,
      isExplicitChapterRequest: true,
      selectedChapterProgress: null,
      persistedProgress: bookResume,
    }),
    { percentage: 0, segmentIndex: 0 }
  );

  assert.deepEqual(
    resolveInitialReaderPosition({
      targetChapterIndex: 3,
      isExplicitChapterRequest: true,
      selectedChapterProgress: {
        chapter_index: 3,
        current_segment_index: 8,
        progress_percentage: 35,
      },
      persistedProgress: bookResume,
    }),
    { percentage: 0.35, segmentIndex: 8 }
  );

  assert.deepEqual(
    resolveInitialReaderPosition({
      targetChapterIndex: 1,
      isExplicitChapterRequest: false,
      selectedChapterProgress: null,
      persistedProgress: bookResume,
    }),
    { percentage: 0.72, segmentIndex: 14 }
  );
});

test('accepts only valid chapter query values and falls back for invalid values', () => {
  const chapters = [0, 2, 5];

  assert.equal(parseChapterQuery('2', chapters), 2);
  assert.equal(parseChapterQuery(' 5 ', chapters), 5);
  assert.equal(parseChapterQuery('1', chapters), null);
  assert.equal(parseChapterQuery('-1', chapters), null);
  assert.equal(parseChapterQuery('2.5', chapters), null);
  assert.equal(parseChapterQuery('not-a-number', chapters), null);
});
