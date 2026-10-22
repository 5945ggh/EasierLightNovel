import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureReaderAnchor, restoreReaderAnchor } from '../src/utils/readerAnchor.ts';

test('layout changes preserve the visible token and its viewport offset', () => {
  let tokenTop = 180;
  const token = {
    dataset: { segmentIndex: '4', tokenIndex: '17' },
    getBoundingClientRect: () => ({ top: tokenTop, bottom: tokenTop + 30 }),
  };
  const hidden = { getBoundingClientRect: () => ({ top: -20, bottom: 0 }) };
  const segment = {
    getBoundingClientRect: () => ({ top: 40, bottom: 500 }),
    querySelectorAll: () => [hidden, token],
  };
  const container = {
    scrollTop: 300, scrollHeight: 2000, clientHeight: 600,
    getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
    querySelectorAll: () => [segment],
    querySelector: (selector: string) => selector.includes('navigation') ? null : token,
  } as unknown as HTMLElement;
  const anchor = captureReaderAnchor(container);
  assert.deepEqual(anchor, { segmentIndex: '4', tokenIndex: '17', offset: 80 });
  tokenTop = 410;
  assert.equal(restoreReaderAnchor(container, anchor!), true);
  assert.equal(container.scrollTop, 530);
});

test('a missing token never invents a different position or changes scrollTop', () => {
  const container = { scrollTop: 50, querySelector: () => null } as unknown as HTMLElement;
  assert.equal(restoreReaderAnchor(container, { segmentIndex: '3', tokenIndex: '2', offset: 10 }), false);
  assert.equal(container.scrollTop, 50);
});

test('image-only segments can anchor without changing existing token coordinates', () => {
  const image = {
    dataset: { segmentIndex: '8' },
    getBoundingClientRect: () => ({ top: -120, bottom: 800 }),
    querySelectorAll: () => [],
    querySelector: () => ({}),
  };
  const container = {
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelectorAll: () => [image], querySelector: () => null,
  } as unknown as HTMLElement;
  assert.deepEqual(captureReaderAnchor(container), { segmentIndex: '8', tokenIndex: null, offset: -120 });
});

test('blank paragraphs sharing a segment index do not restore to the first paragraph', () => {
  const blank = {
    dataset: { segmentIndex: '0' },
    getBoundingClientRect: () => ({ top: 10, bottom: 40 }),
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const token = {
    dataset: { segmentIndex: '0', tokenIndex: '52' },
    getBoundingClientRect: () => ({ top: 60, bottom: 90 }),
  };
  const paragraph = {
    getBoundingClientRect: () => ({ top: 60, bottom: 120 }),
    querySelectorAll: () => [token],
  };
  const container = {
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelectorAll: () => [blank, paragraph],
    querySelector: () => null,
  } as unknown as HTMLElement;
  assert.deepEqual(captureReaderAnchor(container), {
    segmentIndex: '0', tokenIndex: '52', offset: 60,
  });
});
