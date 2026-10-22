import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getReaderSelectionText, isReaderSelectionRange } from '../src/utils/readerSelection.ts';

function textNode(root: object | null) {
  return { nodeType: 3, parentElement: { closest: (selector: string) => selector === '.reader-content' ? root : null } } as unknown as Node;
}

test('accepts a short selection whose common ancestor is the same text node', () => {
  const node = textNode({});
  assert.equal(isReaderSelectionRange({ startContainer: node, endContainer: node }), true);
});

test('rejects selections extending outside the body or into another reader', () => {
  const root = {};
  const inside = textNode(root);
  const outside = textNode(null);
  const other = textNode({});
  assert.equal(isReaderSelectionRange({ startContainer: inside, endContainer: outside }), false);
  assert.equal(isReaderSelectionRange({ startContainer: inside, endContainer: other }), false);
});

test('accepts element endpoints and rejects endpoints inside ruby annotations', () => {
  const root = {};
  const element = { nodeType: 1, closest: (selector: string) => selector === '.reader-content' ? root : null } as unknown as Node;
  assert.equal(isReaderSelectionRange({ startContainer: element, endContainer: element }), true);
  const annotation = { nodeType: 3, parentElement: { closest: () => root } } as unknown as Node;
  assert.equal(isReaderSelectionRange({ startContainer: annotation, endContainer: element }), false);
});

test('uses plain selection text without ruby and strips annotation text from ruby selections', () => {
  const plain = { toString: () => ' 短い語 ', cloneContents: () => ({ querySelectorAll: () => [] }) };
  assert.equal(getReaderSelectionText(plain as unknown as Range), '短い語');
  let text = '漢かん字じ';
  const fragment = {
    querySelectorAll: (selector: string) => {
      assert.equal(selector, 'rt, rp');
      return [{ remove: () => { text = '漢字'; } }];
    },
    get textContent() { return text; },
  };
  const ruby = { toString: () => '漢かん字じ', cloneContents: () => fragment };
  assert.equal(getReaderSelectionText(ruby as unknown as Range), '漢字');
});

test('resolves real tokens intersecting whitespace and element boundary selections', async () => {
  const { getReaderSelectionCoordinates } = await import('../src/utils/readerSelection.ts');
  // Model DOM ranges as offsets in a paragraph: whitespace [0,2), 前 [2,3),
  // space [3,4), 猫 [4,5), and a touching token outside the selection [5,6).
  const tokens = [[2, 3, 0], [4, 5, 1], [5, 6, 2]].map(([start, end, index]) => ({
    start, end,
    getAttribute: (name: string) => name === 'data-segment-index' ? '3' : String(index),
  }));
  const root = {
    querySelectorAll: () => tokens,
    ownerDocument: { createRange: () => ({ start: 0, end: 0,
      selectNodeContents(token: typeof tokens[number]) { this.start = token.start; this.end = token.end; },
    }) },
  };
  const endpoint = textNode(root);
  const makeRange = (start: number, end: number) => ({
    start, end, startContainer: endpoint, endContainer: endpoint,
    compareBoundaryPoints(how: number, other: { start: number; end: number }) {
      return how === 0 ? this.start - other.start : this.end - other.end;
    },
    cloneRange() { return makeRange(this.start, this.end); },
    setStart(_node: unknown, offset: number) { this.start = offset; },
    setEnd(_node: unknown, offset: number) { this.end = offset; },
    get collapsed() { return this.start >= this.end; },
    toString() { return '  前 猫犬'.slice(this.start, this.end); },
    cloneContents() { return { querySelectorAll: () => [] }; },
  });
  // Supply offsets through token Range endpoints, like selectNodeContents.
  root.ownerDocument.createRange = () => ({ start: 0, end: 0,
    selectNodeContents(token: typeof tokens[number]) { this.start = token.start; this.end = token.end; },
    get startContainer() { return endpoint; }, get endContainer() { return endpoint; },
    get startOffset() { return this.start; }, get endOffset() { return this.end; },
  });
  assert.deepEqual(getReaderSelectionCoordinates(makeRange(0, 5) as unknown as Range), {
    start: { segIdx: 3, tokIdx: 0 }, end: { segIdx: 3, tokIdx: 1 },
  });
  assert.equal(getReaderSelectionCoordinates(makeRange(0, 2) as unknown as Range), null);
});
