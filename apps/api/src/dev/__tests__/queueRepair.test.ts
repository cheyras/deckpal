import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cleanupRepairedOriginal, discardQueuePhoto, enqueueQueuePhoto, listQueuePhotos, readQueuePhoto, repairQueuePhoto, replacementId, type QueueMeta, type QueueStore } from '../queueRepair.js';

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
    async size(path) { return files.get(path)?.length ?? null; },
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

test('storage operations hold a dedicated lock beyond the request transaction in cloud mode', () => {
  const route = readFileSync(fileURLToPath(new URL('../scanQueue.ts', import.meta.url)), 'utf8');
  assert.match(route, /SUPABASE_MODE \? makePool\(\{ role: 'worker', max: 1 \}\) : pool/);
  assert.match(route, /const result = await work\(\);\s*await client\.query\('COMMIT'\)/);
  assert.doesNotMatch(route, /withTx\(/);
});

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

test('repair cleanup removes only the HEIC; the JPEG remains until the user discards it', async () => {
  const { files, store } = fakeStore();
  await repairQueuePhoto(ID, jpg, requested, store, isHeic);
  await cleanupRepairedOriginal(ID, store);
  assert.ok(!files.has(original));
  assert.deepEqual(files.get(next), jpg);
  assert.ok(files.has(sidecar));
  const retry = await repairQueuePhoto(ID, jpg, requested, store, isHeic);
  assert.equal(retry.id, replacementId(ID));
  await discardQueuePhoto(retry.id, store);
  assert.equal(files.size, 0);
});

test('repair cleanup refuses to remove the only copy when the replacement sidecar is missing', async () => {
  const { files, store } = fakeStore();
  files.set(next, jpg);
  await assert.rejects(cleanupRepairedOriginal(ID, store), /replacement is incomplete/);
  assert.ok(files.has(original));
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

test('all photo and sidecar combinations show exactly one surviving family photo', async () => {
  for (const originalKind of ['none', 'heic', 'jpeg'] as const) {
    for (const originalMeta of [false, true]) {
      for (const replacementPhoto of [false, true]) {
        for (const replacementMeta of [false, true]) {
          const { files, store } = fakeStore();
          files.clear();
          if (originalKind !== 'none') files.set(original, Buffer.from(originalKind));
          if (originalMeta) files.set(`dev-queue/${ID}.json`, Buffer.from(JSON.stringify({ ...requested, addedAt: '2026-09-01T00:00:00.000Z' })));
          if (replacementPhoto) files.set(next, jpg);
          if (replacementMeta) files.set(sidecar, Buffer.from(JSON.stringify({ ...requested, addedAt: '2026-09-01T00:00:00.000Z' })));
          const ids = [ID, replacementId(ID), ID];
          const listed = await listQueuePhotos(ids, store);
          const visible = replacementPhoto || originalKind !== 'none';
          assert.equal(listed.length, Number(visible), JSON.stringify({ originalKind, originalMeta, replacementPhoto, replacementMeta }));
          const reads = await Promise.all(ids.slice(0, 2).map((id) => readQueuePhoto(id, store)));
          assert.equal(reads.every((read) => read !== null), visible);
          if (visible) {
            assert.equal(listed[0]?.id, ID);
            assert.equal(listed[0]?.photoId, replacementPhoto ? replacementId(ID) : ID);
            assert.deepEqual(reads[0]?.bytes, reads[1]?.bytes);
            assert.equal(reads[0]?.bytes.toString(), replacementPhoto ? 'jpeg' : originalKind);
          }
          if (replacementPhoto || originalKind === 'heic') {
            const repaired = await repairQueuePhoto(ID, jpg, requested, store, isHeic);
            assert.equal(repaired.id, replacementId(ID));
            assert.ok(files.has(next) && files.has(sidecar));
          } else {
            await assert.rejects(repairQueuePhoto(ID, jpg, requested, store, isHeic));
            assert.equal(files.has(next), false);
          }
          await discardQueuePhoto(ID, store);
          assert.equal(files.size, 0);
        }
      }
    }
  }
});

test('each interrupted discard remains visible while a photo survives and is retryable', async () => {
  for (const failingPath of [original, `dev-queue/${ID}.json`, next, sidecar]) {
    for (const timing of ['before', 'after']) {
      const { files, store } = fakeStore();
      files.set(`dev-queue/${ID}.json`, Buffer.from(JSON.stringify({ ...requested, addedAt: new Date(ID).toISOString() })));
      files.set(next, jpg);
      files.set(sidecar, Buffer.from(JSON.stringify({ ...requested, addedAt: new Date(ID).toISOString() })));
      const remove = store.remove;
      let fail = true;
      store.remove = async (path) => {
        if (path === failingPath && fail) {
          fail = false;
          if (timing === 'after') await remove(path);
          throw new Error('interrupted delete');
        }
        return remove(path);
      };
      await assert.rejects(discardQueuePhoto(ID, store), /interrupted delete/);
      const listed = await listQueuePhotos([ID, replacementId(ID)], store);
      const surviving = files.has(original) || files.has(next);
      assert.equal(listed.length, Number(surviving), `${failingPath} ${timing}`);
      assert.equal((await readQueuePhoto(ID, store)) !== null, surviving);
      await discardQueuePhoto(replacementId(ID), store);
      assert.equal(files.size, 0);
      await assert.rejects(repairQueuePhoto(ID, jpg, requested, store, isHeic), /no such queued photo/);
    }
  }
});

test('each interrupted repair and cleanup can finish without losing the JPEG', async () => {
  for (const failingPath of [next, sidecar, original, `dev-queue/${ID}.json`]) {
    for (const timing of ['before', 'after']) {
      const { files, store } = fakeStore();
      files.set(`dev-queue/${ID}.json`, Buffer.from(JSON.stringify({ ...requested, addedAt: new Date(ID).toISOString() })));
      const operation = failingPath === next || failingPath === sidecar ? 'put' : 'remove';
      let fail = true;
      if (operation === 'put') {
        const originalOperation = store.put;
        store.put = async (path, bytes, contentType) => {
          if (path === failingPath && fail) {
            fail = false;
            if (timing === 'after') await originalOperation(path, bytes, contentType);
            throw new Error('interrupted write');
          }
          return originalOperation(path, bytes, contentType);
        };
        await assert.rejects(repairQueuePhoto(ID, jpg, requested, store, isHeic), /interrupted write/);
        assert.equal((await listQueuePhotos([ID, replacementId(ID)], store)).length, 1);
        await repairQueuePhoto(ID, jpg, requested, store, isHeic);
      } else {
        await repairQueuePhoto(ID, jpg, requested, store, isHeic);
        const originalOperation = store.remove;
        store.remove = async (path) => {
          if (path === failingPath && fail) {
            fail = false;
            if (timing === 'after') await originalOperation(path);
            throw new Error('interrupted delete');
          }
          return originalOperation(path);
        };
        await assert.rejects(cleanupRepairedOriginal(ID, store), /interrupted delete/);
      }
      await cleanupRepairedOriginal(ID, store);
      assert.equal(files.has(original), false);
      assert.equal(files.has(`dev-queue/${ID}.json`), false);
      assert.ok(files.has(next) && files.has(sidecar));
      assert.equal((await listQueuePhotos([ID, replacementId(ID)], store)).length, 1);
    }
  }
});

test('same-millisecond uploads from two devices get distinct families', async () => {
  const { files, store } = fakeStore();
  files.clear();
  const [a, b] = await Promise.all([
    enqueueQueuePhoto(ID, Buffer.from('device A'), requested, store),
    enqueueQueuePhoto(ID, Buffer.from('device B'), requested, store),
  ]);
  assert.deepEqual([a.id, b.id].sort(), [ID, ID + 1]);
  assert.equal((await listQueuePhotos([ID, ID + 1], store)).length, 2);
  assert.deepEqual(new Set([files.get(`dev-queue/${ID}.jpg`)?.toString(), files.get(`dev-queue/${ID + 1}.jpg`)?.toString()]), new Set(['device A', 'device B']));
});

test('upload skips an occupied sidecar and operations preserve unrelated families', async () => {
  const { files, store } = fakeStore();
  files.clear();
  files.set(sidecar, Buffer.from('{}'));
  const queued = await enqueueQueuePhoto(ID, jpg, requested, store);
  assert.equal(queued.id, ID + 1);
  const neighbor = `dev-queue/${ID + 1}.jpg`;
  await discardQueuePhoto(ID, store);
  assert.deepEqual(files.get(neighbor), jpg);
  assert.equal((await listQueuePhotos([ID, ID + 1], store)).length, 1);
});

test('two-device operations serialize in both orders and preserve the final family state', async () => {
  const cases = [
    { first: 'repair', second: 'repair', expected: 1 },
    { first: 'repair', second: 'cleanup', expected: 1 },
    { first: 'cleanup', second: 'discard', expected: 0 },
    { first: 'discard', second: 'cleanup', expected: 0 },
    { first: 'repair', second: 'list', expected: 1 },
    { first: 'repair', second: 'read', expected: 1 },
    { first: 'discard', second: 'list', expected: 0 },
    { first: 'discard', second: 'read', expected: 0 },
  ] as const;
  for (const { first, second, expected } of cases) {
    const { files, store } = fakeStore();
    if (first !== 'repair') {
      files.set(next, jpg);
      files.set(sidecar, Buffer.from(JSON.stringify({ ...requested, addedAt: new Date(ID).toISOString() })));
    }
    let reached!: () => void;
    const atBoundary = new Promise<void>((resolve) => { reached = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    if (first === 'repair') {
      const put = store.put;
      store.put = async (path, bytes, contentType) => {
        if (path === next) { reached(); await blocked; }
        await put(path, bytes, contentType);
      };
    } else {
      const remove = store.remove;
      store.remove = async (path) => {
        if (path === original) { reached(); await blocked; }
        return remove(path);
      };
    }
    const actions = {
      repair: () => repairQueuePhoto(ID, jpg, requested, store, isHeic),
      cleanup: () => cleanupRepairedOriginal(ID, store),
      discard: () => discardQueuePhoto(ID, store),
      list: () => listQueuePhotos([ID, replacementId(ID)], store),
      read: () => readQueuePhoto(replacementId(ID), store),
    };
    const firstAction = actions[first]();
    await atBoundary;
    const secondAction = actions[second]();
    release();
    const [, secondResult] = await Promise.all([firstAction, secondAction]);
    const listed = await listQueuePhotos([ID, replacementId(ID)], store);
    assert.equal(listed.length, expected, `${first}/${second}`);
    if (second === 'list') assert.equal((secondResult as Awaited<ReturnType<typeof actions.list>>).length, expected);
    if (second === 'read') assert.equal(secondResult !== null, expected === 1);
    if (expected === 0) {
      assert.equal(files.size, 0);
      await assert.rejects(repairQueuePhoto(ID, jpg, requested, store, isHeic), /no such queued photo/);
    } else {
      assert.equal(listed[0]?.id, ID);
      assert.equal(listed[0]?.photoId, replacementId(ID));
    }
  }
});
