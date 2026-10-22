import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProgressSaver, enqueueProgressWrite } from '../src/utils/progressPersistence.ts';

test('a scroll is saved locally before the debounce, and leaving flushes it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const local: number[] = [];
  const remote: number[] = [];
  const saver = createProgressSaver<number>({
    writeLocal: (value) => { local.push(value); return true; },
    writeRemote: async (value) => { remote.push(value); },
  });
  saver.record(35);
  assert.deepEqual(local, [35]);
  t.mock.timers.tick(100);
  assert.deepEqual(remote, []);
  await saver.flush();
  assert.deepEqual(remote, [35]);
  t.mock.timers.tick(1000);
  assert.deepEqual(remote, [35]);
});

test('debouncing keeps the latest sample, and an older response cannot report it saved', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const statuses: string[] = [];
  let finish: () => void = () => {};
  const saver = createProgressSaver<number>({
    writeLocal: () => true,
    writeRemote: () => new Promise<void>((resolve) => { finish = resolve; }),
    onStatus: (status) => { statuses.push(status); },
  });
  saver.record(10);
  const first = saver.flush();
  await Promise.resolve();
  saver.record(20);
  finish();
  await first;
  assert.equal(statuses.at(-1), 'pending');
});

test('a failed remote save preserves the local fallback and a later save can succeed', async () => {
  const statuses: string[] = [];
  let fail = true;
  const saver = createProgressSaver<number>({
    writeLocal: () => true,
    writeRemote: async () => { if (fail) throw new Error('offline'); },
    onStatus: (status) => { statuses.push(status); },
  });
  saver.record(40);
  await saver.flush();
  assert.equal(statuses.at(-1), 'local-only');
  fail = false;
  saver.record(45);
  await saver.flush();
  assert.equal(statuses.at(-1), 'saved');
});

test('a storage failure still attempts the server, and two failures report an error', async () => {
  const statuses: string[] = [];
  let attempts = 0;
  const saver = createProgressSaver<number>({
    writeLocal: () => false,
    writeRemote: async () => { attempts++; throw new Error('offline'); },
    onStatus: (status) => { statuses.push(status); },
  });
  saver.record(10);
  await saver.flush();
  assert.equal(attempts, 1);
  assert.equal(statuses.at(-1), 'error');
});

test('writes for a book stay ordered after a failed request without blocking other books', async () => {
  const pending = new Map<string, Promise<unknown>>();
  const events: string[] = [];
  let release: () => void = () => {};
  const first = enqueueProgressWrite(pending, 'a', async () => {
    events.push('a1');
    await new Promise<void>((resolve) => { release = resolve; });
    throw new Error('offline');
  });
  const second = enqueueProgressWrite(pending, 'a', async () => { events.push('a2'); });
  const other = enqueueProgressWrite(pending, 'b', async () => { events.push('b1'); });
  await other;
  assert.deepEqual(events, ['a1', 'b1']);
  release();
  await assert.rejects(first);
  await second;
  assert.deepEqual(events, ['a1', 'b1', 'a2']);
  assert.equal(pending.size, 0);
});
