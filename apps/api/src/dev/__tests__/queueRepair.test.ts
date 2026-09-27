import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discardQueuePhoto, repairQueuePhoto, replacementId, type QueueMeta, type QueueStore } from '../queueRepair.js';

const ID = 1_700_000_000_000;
const jpg = Buffer.from('jpeg');
const original = `dev-queue/${ID}.jpg`;
const next = `dev-queue/${replacementId(ID)}.jpg`;
const sidecar = `dev-queue/${replacementId(ID)}.json`;
const requested = { name: 'camera.jpg', source: 'camera' as const };

function fakeStore() {
  const files = new Map<string, Buffer>([[original, Buffer.from('heic')]]);
  const waiters = new Map<number, Promise<void>>();
  let failSidecar = false;
  const store: QueueStore = {
    async locked(id, work) {
      const previous = waiters.get(id) ?? Promise.resolve();
      let release!: () => void;
      const finished = new Promise<void>((resolve) => { release = resolve; });
      waiters.set(id, previous.then(() => finished));
      await previous;
      try { return await work(); } finally { release(); }
    },
    async exists(path) { return files.has(path); },
    async photo(path) { return files.get(path) ?? null; },
    async meta(path) {
      try { return JSON.parse(files.get(path)?.toString() ?? '') as QueueMeta; }
      catch { return null; }
    },
    async put(path, bytes) {
      if (path === sidecar && failSidecar) { failSidecar = false; throw new Error('interrupted'); }
      files.set(path, bytes);
    },
    async remove(path) { return files.delete(path); },
  };
  return { files, store, interruptSidecar: () => { failSidecar = true; } };
}

const isHeic = (bytes: Buffer) => bytes.toString() === 'heic';

test('retry completes an interrupted JPEG and restores missing metadata before acknowledging', async () => {
  const { files, store, interruptSidecar } = fakeStore();
  files.set(`dev-queue/${ID}.json`, Buffer.from(JSON.stringify({ name: 'camera.heic', source: 'camera', addedAt: '2026-09-01T00:00:00.000Z' })));
  interruptSidecar();
  await assert.rejects(repairQueuePhoto(ID, jpg, requested, store, isHeic), /interrupted/);
  assert.ok(files.has(next));
  assert.ok(!files.has(sidecar));
  const result = await repairQueuePhoto(ID, jpg, requested, store, isHeic);
  assert.equal(result.id, replacementId(ID));
  assert.equal(result.addedAt, '2026-09-01T00:00:00.000Z');
  assert.deepEqual(JSON.parse(files.get(sidecar)!.toString()), { ...requested, addedAt: result.addedAt });
});

test('a corrupt replacement sidecar is repaired from the request before success', async () => {
  const { files, store } = fakeStore();
  files.set(next, jpg);
  files.set(sidecar, Buffer.from('{broken'));
  const result = await repairQueuePhoto(ID, jpg, requested, store, isHeic);
  assert.equal(result.name, requested.name);
  assert.deepEqual(JSON.parse(files.get(sidecar)!.toString()).name, requested.name);
});

test('discard waits for repair and removes both copies; a later retry cannot resurrect either', async () => {
  const { files, store } = fakeStore();
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  const put = store.put;
  store.put = async (path, bytes, type) => { if (path === next) await blocked; await put(path, bytes, type); };
  const repairing = repairQueuePhoto(ID, jpg, requested, store, isHeic);
  await new Promise((resolve) => setImmediate(resolve));
  const discarding = discardQueuePhoto(ID, store);
  unblock();
  await Promise.all([repairing, discarding]);
  assert.equal(files.size, 0);
  await assert.rejects(repairQueuePhoto(ID, jpg, requested, store, isHeic), /no such queued photo/);
  assert.equal(files.size, 0);
});

test('a discard that wins the lock makes a concurrent repair fail without writing', async () => {
  const { files, store } = fakeStore();
  await discardQueuePhoto(ID, store);
  await assert.rejects(repairQueuePhoto(ID, jpg, requested, store, isHeic), /no such queued photo/);
  assert.equal(files.size, 0);
});
