/** Run against Vite with an externally supplied Playwright runtime; all API data is isolated. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.READER_TEST_URL || 'http://localhost:5188';
let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
});
after(async () => { await browser?.close(); });

async function fixture(t, customTokens) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const writes = [];
  const requestedChapters = [];
  let deleted = false;
  let listReads = 0;
  const book = {
    id: 'review', title: 'Reader regression fixture', status: 'completed', total_chapters: 3,
    author: null, cover_url: null, error_message: null, created_at: '2026-10-22T00:00:00Z',
  };
  const tokens = customTokens ?? Array.from({ length: 130 }, (_, i) => [
    { s: `段落${i}。これは試験です。静かな夜に本を読みます。`.repeat(3) },
    { s: '\n\n', gap: true },
  ]).flat();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data = [];
    if (path.includes('/config')) return route.fulfill({ status: 503, json: { detail: 'Use default public config in fixture' } });
    if (path === '/api/books') { listReads++; data = deleted ? [] : [book]; }
    else if (path.endsWith('/toc')) data = [0, 1, 2].map(index => ({ index, title: `章 ${index}` }));
    else if (/\/chapters\/\d+$/.test(path)) {
      const index = Number(path.split('/').at(-1));
      requestedChapters.push(index);
      data = { index, title: `章 ${index}`, segments: [{ type: 'text', tokens }], highlights: [] };
    } else if (path.endsWith('/progress/chapters')) {
      await new Promise(resolve => setTimeout(resolve, 600));
      data = [{ chapter_index: 2, current_segment_index: 0, progress_percentage: 60, updated_at: new Date().toISOString() }];
    } else if (path.endsWith('/progress')) {
      if (route.request().method() === 'PUT') {
        data = route.request().postDataJSON();
        writes.push(data);
      } else {
        await new Promise(resolve => setTimeout(resolve, 600));
        data = { book_id: 'review', current_chapter_index: 2, current_segment_index: 0, progress_percentage: 60, updated_at: new Date().toISOString() };
      }
    } else if (path.endsWith('/base_forms')) data = { base_forms: [] };
    else if (path === '/api/books/review') {
      if (route.request().method() === 'DELETE') { deleted = true; data = { ok: true }; }
      else data = book;
    }
    await route.fulfill({ json: data });
  });
  return { page, errors, writes, requestedChapters, getListReads: () => listReads };
}

test('cold resume waits for delayed progress before loading the initial chapter', async t => {
  const { page, requestedChapters, writes, errors } = await fixture(t);
  await page.goto(`${baseURL}/read/review`);
  await page.getByRole('heading', { name: '章 2', exact: true }).waitFor();
  await page.waitForFunction(() => {
    const container = document.querySelector('[aria-label="章节正文"]');
    return container && Math.abs(container.scrollTop / (container.scrollHeight - container.clientHeight) - 0.6) < 0.01;
  });
  assert.deepEqual([...new Set(requestedChapters)], [2]);
  assert.equal(writes.length, 0, 'restoration alone must not overwrite progress');
  assert.deepEqual(errors, []);
});

test('reflow at a blank paragraph preserves the visible token on desktop and mobile', async t => {
  const { page, errors } = await fixture(t);
  await page.goto(`${baseURL}/read/review?chapter=0`);
  await page.getByRole('heading', { name: '章 0', exact: true }).waitFor();
  const result = await page.evaluate(async () => {
    const { captureReaderAnchor } = await import('/src/utils/readerAnchor.ts');
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    const container = document.querySelector('[aria-label="章节正文"]');
    const blank = [...document.querySelectorAll('.reader-content > p')].filter(p => !p.textContent)[50];
    container.scrollTop += blank.getBoundingClientRect().top - container.getBoundingClientRect().top - 70;
    await new Promise(resolve => setTimeout(resolve, 100));
    const before = captureReaderAnchor(container);
    useSettingsStore.getState().setFontSize(24);
    await new Promise(resolve => setTimeout(resolve, 600));
    return { before, after: captureReaderAnchor(container), scrollTop: container.scrollTop };
  });
  assert.notEqual(result.before.tokenIndex, null);
  assert.equal(result.after.tokenIndex, result.before.tokenIndex);
  assert.ok(Math.abs(result.after.offset - result.before.offset) < 2);
  assert.ok(result.scrollTop > 1000, 'must not jump to the chapter beginning');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const afterMobile = await page.evaluate(async () => {
    const { captureReaderAnchor } = await import('/src/utils/readerAnchor.ts');
    return { anchor: captureReaderAnchor(document.querySelector('[aria-label="章节正文"]')), width: document.documentElement.scrollWidth };
  });
  assert.equal(afterMobile.anchor.tokenIndex, result.before.tokenIndex);
  assert.equal(afterMobile.width, 390);
  assert.deepEqual(errors, []);
});

test('deleting from book home invalidates a fresh library cache', async t => {
  const { page, errors, getListReads } = await fixture(t);
  await page.goto(baseURL);
  await page.getByRole('heading', { name: 'Reader regression fixture', exact: true }).locator('../..').locator('div.cursor-pointer').click();
  await page.waitForURL('**/book/review');
  await page.getByRole('button', { name: '删除书籍', exact: true }).click();
  await page.getByRole('button', { name: '彻底删除', exact: true }).click();
  await page.waitForURL(`${baseURL}/`);
  await page.waitForFunction(() => !document.body.textContent.includes('Reader regression fixture'));
  assert.ok(getListReads() >= 2, 'library must fetch again despite its five-minute staleTime');
  assert.deepEqual(errors, []);
});


test('whitespace and element selections resolve real tokens without including ruby annotations', async t => {
  const { page, errors } = await fixture(t, [
    { s: '　' }, { s: '猫', r: 'ねこ' }, { s: '。' }, { s: ' ' }, { s: '犬', r: 'いぬ' },
  ]);
  await page.goto(`${baseURL}/read/review?chapter=0`);
  await page.getByRole('heading', { name: '章 0', exact: true }).waitFor();
  const result = await page.evaluate(async () => {
    const { getReaderSelectionCoordinates, getReaderSelectionText } = await import('/src/utils/readerSelection.ts');
    const p = document.querySelector('.reader-content > p');
    const tokens = p.querySelectorAll('[data-token-index]');
    const range = document.createRange();
    range.setStart(p.firstChild, 0);
    range.setEndAfter(tokens[1]);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const whitespace = getReaderSelectionCoordinates(range);
    const text = getReaderSelectionText(range);
    const elementRange = document.createRange();
    elementRange.setStart(p, 0);
    elementRange.setEnd(p, 3);
    const annotationRange = document.createRange();
    annotationRange.selectNodeContents(p.querySelector('rt'));
    return { whitespace, text, element: getReaderSelectionCoordinates(elementRange), annotation: getReaderSelectionCoordinates(annotationRange) };
  });
  const expected = { start: { segIdx: 0, tokIdx: 0 }, end: { segIdx: 0, tokIdx: 1 } };
  assert.deepEqual(result.whitespace, expected);
  assert.deepEqual(result.element, expected);
  assert.equal(result.text, '猫。');
  assert.equal(result.annotation, null);
  await page.getByRole('button', { name: '高亮: 默认', exact: true }).waitFor();
  assert.deepEqual(errors, []);
});
