import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSentenceFromSegment } from '../src/utils/sentence.ts';
import { splitReaderParagraphs } from '../src/utils/readerText.ts';

test('preserves ordinary and full-width spaces, gap text and original token indices', () => {
  const tokens = [{ s: '　', gap: true }, { s: '彼' }, { s: '  ' }, { s: '女', gap: true }];
  const paragraphs = splitReaderParagraphs(tokens);
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].map(({ token }) => token.s).join(''), '　彼  女');
  assert.deepEqual(paragraphs[0].map(({ sourceTokenIndex }) => sourceTokenIndex), [0, 1, 2, 3]);
  assert.deepEqual(paragraphs[0].map(({ tokenIndex }) => tokenIndex), [null, 0, null, null]);
});

test('retains token indices after leading and consecutive paragraph breaks', () => {
  const paragraphs = splitReaderParagraphs([{ s: '\n' }, { s: '\n' }, { s: '猫' }, { s: '\n\n' }, { s: '犬' }]);
  assert.deepEqual(paragraphs.map((parts) => parts.map(({ sourceTokenIndex }) => sourceTokenIndex)), [[], [], [2], [], [4]]);
  // Stored highlights made by the original reader must still hit the same words.
  assert.deepEqual(paragraphs.flat().map(({ tokenIndex }) => tokenIndex), [0, 4]);
});

test('splits embedded CRLF and newline without dropping surrounding text or duplicating ruby', () => {
  const paragraphs = splitReaderParagraphs([{ s: '前\r\n\n後', r: 'ぜんご', RUBY: [{ text: '前後', ruby: 'ぜんご' }] }]);
  assert.deepEqual(paragraphs.map((parts) => parts.map(({ token }) => token.s).join('')), ['前', '', '後']);
  assert.deepEqual(paragraphs.flat().map(({ tokenIndex }) => tokenIndex), [0, 0]);
  assert.ok(paragraphs.flat().every(({ token }) => !token.RUBY && !token.r));
});

test('highlight coordinates map legacy token indices back to the source tokens', async () => {
  const { getReaderHighlightText, getSourceTokenIndex } = await import('../src/utils/readerText.ts');
  const tokens = [{ s: '\n' }, { s: '\n' }, { s: '前' }, { s: '。' }, { s: '猫' }, { s: '。' }];
  const highlight = { start_segment_index: 0, end_segment_index: 0, start_token_idx: 2, end_token_idx: 2 };
  assert.equal(getSourceTokenIndex(tokens, 2), 4);
  assert.equal(extractSentenceFromSegment(0, getSourceTokenIndex(tokens, 2)!, [{ type: 'text', tokens }]), '猫。');
  assert.equal(getReaderHighlightText([{ type: 'text', tokens }], highlight), '猫');
  assert.equal(getReaderHighlightText([{ type: 'text', tokens }], { ...highlight, selected_text: '猫の一部' }), '猫の一部');
});
