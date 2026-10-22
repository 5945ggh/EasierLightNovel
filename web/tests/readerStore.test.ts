import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// Only the archive service is runtime-imported by this store; avoid the browser
// API client while testing the real Zustand actions.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/services/highlights.service') {
      return { url: 'data:text/javascript,export async function getArchiveItem() { return {}; }', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { useReaderStore } = await import('../src/stores/readerStore.ts');
const highlight = { id: 41, start_segment_index: 0, end_segment_index: 0, start_token_idx: 0, end_token_idx: 0, style_category: 'yellow', selected_text: '猫' };

test('a late highlight stays in its original chapter after navigation', () => {
  useReaderStore.getState().resetReader();
  useReaderStore.setState({ bookId: 'book', chapterIndex: 2 });
  useReaderStore.getState().addHighlight(highlight, { bookId: 'book', chapterIndex: 1 });
  const state = useReaderStore.getState();
  assert.deepEqual(state.highlights, []);
  assert.equal(state.highlightMap.size, 0);
  assert.equal(state.allHighlights[0]?.chapter_index, 1);
  assert.equal(state.allHighlights[0]?.selected_text, '猫');
});

test('a late highlight for another book is ignored', () => {
  useReaderStore.getState().resetReader();
  useReaderStore.setState({ bookId: 'new-book', chapterIndex: 1 });
  useReaderStore.getState().addHighlight(highlight, { bookId: 'old-book', chapterIndex: 1 });
  assert.deepEqual(useReaderStore.getState().allHighlights, []);
  assert.deepEqual(useReaderStore.getState().highlights, []);
});

test('a response in the current chapter retains its origin and selected text', () => {
  useReaderStore.getState().resetReader();
  useReaderStore.setState({ bookId: 'book', chapterIndex: 1 });
  useReaderStore.getState().addHighlight(highlight, { bookId: 'book', chapterIndex: 1 });
  assert.equal(useReaderStore.getState().highlights[0]?.chapter_index, 1);
  assert.equal(useReaderStore.getState().highlightMap.get('0-0'), 'yellow');
});
