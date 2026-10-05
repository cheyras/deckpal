import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import pg from 'pg';
import {
  cleanupRepairedOriginal,
  discardQueuePhoto,
  enqueueQueuePhoto,
  listQueuePhotos,
  LISTING_LOCKED_CONCURRENCY,
  LISTING_META_CONCURRENCY,
  readQueuePhoto,
  repairQueuePhoto,
  replacementId,
  type QueueMeta,
  type QueueObject,
  type QueueStore,
} from '../queueRepair.js';
import { createQueueLocker } from '../queueLock.js';

// What an object listing of `files` reports right now.
const snapshot = (files: Map<string, Buffer>): QueueObject[] =>
  [...files].map(([path, bytes]) => ({ path, byteSize: bytes.length }));

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
    async list() { return snapshot(files); },
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
  assert.match(route, /SUPABASE_MODE \? makePool\(\{ role: 'worker', max: 3 \}\) : pool/);
  assert.match(route, /createQueueLocker\(queueLockPool, SUPABASE_MODE \? 3 : 1\)/);
  const locker = readFileSync(fileURLToPath(new URL('../queueLock.ts', import.meta.url)), 'utf8');
  assert.match(locker, /const result = await work\(\);\s*await client\.query\('COMMIT'\)/);
  assert.doesNotMatch(route, /withTx\(/);
});

// The listing locks only families its snapshot saw as sidecars alone, so this
// one lists sidecars only: every family takes the locked recheck, which is the
// listing path that still meets the shared FIFO and the real pg pool.
test('concurrent listing rechecks and a thumbnail wait outside pg checkout under slow storage', async () => {
  class FakeClient extends EventEmitter {
    _queryable = true;
    _ending = false;
    connect(done: (error: Error | null) => void) { queueMicrotask(() => done(null)); }
    async query() { return { rows: [] }; }
    end(done?: () => void) { done?.(); }
    ref() {}
    unref() {}
  }
  const pool = new pg.Pool({ Client: FakeClient as unknown as typeof pg.Client, max: 3, connectionTimeoutMillis: 50 });
  const locked = createQueueLocker(pool, 3);
  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
  const ids = Array.from({ length: 20 }, (_, i) => ID + i);
  const store: QueueStore = {
    locked,
    async list() { return ids.map((id) => ({ path: `dev-queue/${id}.json`, byteSize: 64 })); },
    async exists() { return false; },
    async size(objectPath) {
      await delay();
      return objectPath.split('/')[1]!.split('.')[0]!.length > 13 ? null : 100;
    },
    async meta() {
      await delay();
      return { name: 'x.jpg', source: 'upload', addedAt: '2026-01-01T00:00:00.000Z' };
    },
    async photo() { await delay(); return jpg; },
    async put() {},
    async remove() { return false; },
  };
  let maxWaiting = 0;
  const sample = setInterval(() => { maxWaiting = Math.max(maxWaiting, pool.waitingCount); }, 5);
  let listsDone = false;
  try {
    const listings = Promise.all([listQueuePhotos(store), listQueuePhotos(store)]).then((result) => {
      listsDone = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const thumbnail = await readQueuePhoto(ID, store);
    assert.equal(listsDone, false, 'a thumbnail should not wait behind a whole listing');
    assert.deepEqual(thumbnail?.bytes, jpg);
    const [first, second] = await listings;
    assert.equal(first.length, 20);
    assert.equal(second.length, 20);
    assert.equal(maxWaiting, 0, 'all queue work must wait before pg.Pool.connect');
    assert.ok(pool.totalCount <= 3);
  } finally {
    clearInterval(sample);
    await pool.end();
  }
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
          const ids = [ID, replacementId(ID)];
          const listed = await listQueuePhotos(store);
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
      const listed = await listQueuePhotos(store);
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
        assert.equal((await listQueuePhotos(store)).length, 1);
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
      assert.equal((await listQueuePhotos(store)).length, 1);
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
  assert.equal((await listQueuePhotos(store)).length, 2);
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
  assert.equal((await listQueuePhotos(store)).length, 1);
});

test('two-device operations serialize in both orders and preserve the final family state', async () => {
  // `listedDuring`: what a listing started mid-operation reports. The listing
  // no longer waits behind the family lock, so it reports its snapshot: mid-
  // discard, the photo was still there when it was listed. That entry is stale,
  // never a resurrection — opening it is a locked read that returns nothing,
  // and repair has no source to recreate it from (both asserted below).
  const cases = [
    { first: 'repair', second: 'repair', expected: 1 },
    { first: 'repair', second: 'cleanup', expected: 1 },
    { first: 'cleanup', second: 'discard', expected: 0 },
    { first: 'discard', second: 'cleanup', expected: 0 },
    { first: 'repair', second: 'list', expected: 1, listedDuring: 1 },
    { first: 'repair', second: 'read', expected: 1 },
    { first: 'discard', second: 'list', expected: 0, listedDuring: 1 },
    { first: 'discard', second: 'read', expected: 0 },
  ] as const;
  for (const testCase of cases) {
    const { first, second, expected } = testCase;
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
      list: () => listQueuePhotos(store),
      read: () => readQueuePhoto(replacementId(ID), store),
    };
    const firstAction = actions[first]();
    await atBoundary;
    const secondAction = actions[second]();
    release();
    const [, secondResult] = await Promise.all([firstAction, secondAction]);
    const listed = await listQueuePhotos(store);
    assert.equal(listed.length, expected, `${first}/${second}`);
    if (second === 'list') {
      const during = secondResult as Awaited<ReturnType<typeof actions.list>>;
      assert.equal(during.length, 'listedDuring' in testCase ? testCase.listedDuring : expected, `${first}/${second}`);
      assert.ok(during.every((photo) => photo.id === ID), 'one entry per family, under the original ID');
      // Every entry it showed opens as whatever the family holds NOW.
      for (const photo of during) assert.equal((await readQueuePhoto(photo.id, store)) !== null, expected === 1);
    }
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

// ── The listing: one object listing, lock-free sidecar reads ────────────────

const metaOf = (name: string, source: QueueMeta['source'] = 'camera', addedAt = new Date(ID).toISOString()) =>
  Buffer.from(JSON.stringify({ name, source, addedAt }));

// Counts every store call and the peak number of sidecar reads and locked
// sections in flight. `listing` overrides what the object listing reports.
function countingStore(files: Map<string, Buffer>, listing?: () => QueueObject[]) {
  const calls = { list: 0, locked: 0, exists: 0, size: 0, photo: 0, meta: 0, put: 0, remove: 0 };
  const metaEtags: Array<[string, string | null | undefined]> = [];
  const inFlight = { meta: 0, locked: 0 };
  const peak = { meta: 0, locked: 0 };
  const enter = (kind: 'meta' | 'locked') => { inFlight[kind]++; peak[kind] = Math.max(peak[kind], inFlight[kind]); };
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const store: QueueStore = {
    async locked(_id, work) {
      calls.locked++;
      enter('locked');
      try { await tick(); return await work(); } finally { inFlight.locked--; }
    },
    async list() { calls.list++; return listing ? listing() : snapshot(files); },
    async exists(path) { calls.exists++; return files.has(path); },
    async size(path) { calls.size++; return files.get(path)?.length ?? null; },
    async photo(path) { calls.photo++; return files.get(path) ?? null; },
    async meta(path, listedEtag) {
      calls.meta++;
      metaEtags.push([path, listedEtag]);
      enter('meta');
      try {
        await tick();
        try { return JSON.parse(files.get(path)?.toString() ?? '') as QueueMeta; } catch { return null; }
      } finally { inFlight.meta--; }
    },
    async put(path, bytes) { calls.put++; files.set(path, bytes); },
    async remove(path) { calls.remove++; return files.delete(path); },
  };
  return { store, calls, peak, metaEtags };
}

test('the listing hands the store each sidecar\'s listed etag; the locked recheck reads fresh', async () => {
  const files = new Map<string, Buffer>([
    [original, Buffer.from('heic')], [`dev-queue/${ID}.json`, metaOf('IMG_5.HEIC')], [next, jpg], // replacement sidecar not listed
    [`dev-queue/${ID + 1}.json`, metaOf('missed.jpg')], [`dev-queue/${ID + 1}.jpg`, jpg], // its photo missing from the listing
  ]);
  const etag = (path: string) => `etag-of-${path}`;
  const { store, metaEtags } = countingStore(files, () =>
    snapshot(files).filter((object) => object.path !== `dev-queue/${ID + 1}.jpg`).map((object) => ({ ...object, etag: etag(object.path) })));
  const listed = await listQueuePhotos(store);
  assert.deepEqual(listed.map((photo) => [photo.id, photo.meta.name]), [[ID, 'IMG_5.HEIC'], [ID + 1, 'missed.jpg']]);
  assert.equal(metaEtags.length, 3);
  assert.deepEqual(new Map(metaEtags), new Map([
    [sidecar, undefined], // not in the snapshot: nothing to vouch for it
    [`dev-queue/${ID}.json`, etag(`dev-queue/${ID}.json`)],
    [`dev-queue/${ID + 1}.json`, undefined], // under the lock: always a fresh read
  ]));
});

test('the listing takes no lock and probes no photo for a family whose photo was listed', async () => {
  const [a, b, c] = [ID, ID + 1, ID + 2];
  const files = new Map<string, Buffer>([
    [`dev-queue/${a}.jpg`, jpg], [`dev-queue/${a}.json`, metaOf('a.jpg')], // original only
    [`dev-queue/${b}.jpg`, Buffer.from('heic')], [`dev-queue/${b}.json`, metaOf('b.heic')], // repaired, original kept
    [`dev-queue/${replacementId(b)}.jpg`, jpg], [`dev-queue/${replacementId(b)}.json`, metaOf('b.jpg')],
    [`dev-queue/${replacementId(c)}.jpg`, jpg], [`dev-queue/${replacementId(c)}.json`, metaOf('c.jpg')], // cleaned up
  ]);
  const { store, calls } = countingStore(files);
  const listed = await listQueuePhotos(store);
  assert.deepEqual(listed.map((photo) => [photo.id, photo.photoId, photo.meta.name]), [
    [a, a, 'a.jpg'],
    [b, replacementId(b), 'b.jpg'],
    [c, replacementId(c), 'c.jpg'],
  ]);
  assert.deepEqual(calls, { list: 1, locked: 0, exists: 0, size: 0, photo: 0, meta: 3, put: 0, remove: 0 });
});

test('a listed replacement wins over a listed original, with its own size and sidecar', async () => {
  const files = new Map<string, Buffer>([
    [original, Buffer.from('heic-original-bytes')], [`dev-queue/${ID}.json`, metaOf('IMG_1.HEIC')],
    [next, jpg], [sidecar, metaOf('IMG_1.jpg')],
  ]);
  const { store, calls } = countingStore(files);
  const [photo, ...rest] = await listQueuePhotos(store);
  assert.equal(rest.length, 0, 'one entry per family');
  assert.deepEqual(photo, { id: ID, photoId: replacementId(ID), size: jpg.length, meta: JSON.parse(metaOf('IMG_1.jpg').toString()) });
  assert.equal(calls.meta, 1, 'the original sidecar is not read when the replacement has one');
  assert.equal(calls.size + calls.exists + calls.locked, 0, 'chosen from the snapshot, not by probing');
});

test('a stale listing entry opens as the photo the family holds now', async () => {
  // Listed before a repair finished and its cleanup ran: the snapshot shows
  // the original. The entry is still the family's ID, so opening it is a
  // locked read that resolves the replacement.
  const files = new Map<string, Buffer>([[original, Buffer.from('heic')], [`dev-queue/${ID}.json`, metaOf('IMG_4.HEIC')]]);
  const before = snapshot(files);
  const { store } = countingStore(files, () => before);
  await repairQueuePhoto(ID, jpg, requested, store, isHeic);
  await cleanupRepairedOriginal(ID, store);
  const [entry] = await listQueuePhotos(store);
  assert.deepEqual([entry?.id, entry?.photoId], [ID, ID]);
  const opened = await readQueuePhoto(entry!.id, store);
  assert.equal(opened?.photo.photoId, replacementId(ID));
  assert.deepEqual(opened?.bytes, jpg);

  // Listed before a discard: the entry opens as nothing, and nothing can bring it back.
  await discardQueuePhoto(ID, store);
  assert.equal(await readQueuePhoto(entry!.id, store), null);
  await assert.rejects(repairQueuePhoto(entry!.id, jpg, requested, store, isHeic), /no such queued photo/);
  assert.equal(files.size, 0);
});

test('sizes come from the object listing, not from a probe of each photo', async () => {
  const files = new Map<string, Buffer>([
    [original, jpg], [`dev-queue/${ID}.json`, metaOf('a.jpg')],
    [`dev-queue/${ID + 1}.jpg`, jpg], [`dev-queue/${ID + 1}.json`, metaOf('b.jpg')],
    [`dev-queue/${replacementId(ID + 1)}.jpg`, jpg],
  ]);
  const reported = new Map([[original, 123_456], [`dev-queue/${ID + 1}.jpg`, 7], [`dev-queue/${replacementId(ID + 1)}.jpg`, 654_321]]);
  const { store, calls } = countingStore(files, () =>
    snapshot(files).map((object) => ({ ...object, byteSize: reported.get(object.path) ?? object.byteSize })));
  const listed = await listQueuePhotos(store);
  assert.deepEqual(listed.map((photo) => [photo.id, photo.size]), [[ID, 123_456], [ID + 1, 654_321]]);
  assert.equal(calls.size, 0);
});

test('a missing sidecar falls back to the other sidecar, then to fixed values, without a lock', async () => {
  // The replacement lost its sidecar: the original's describes the photo.
  const repaired = new Map<string, Buffer>([[original, Buffer.from('heic')], [`dev-queue/${ID}.json`, metaOf('IMG_2.HEIC')], [next, jpg]]);
  const first = countingStore(repaired);
  const [fromOriginal] = await listQueuePhotos(first.store);
  assert.equal(fromOriginal?.photoId, replacementId(ID));
  assert.equal(fromOriginal?.meta.name, 'IMG_2.HEIC');
  assert.equal(first.calls.locked, 0);

  // No sidecar anywhere: still shown, with the deterministic fallback, and the
  // one missing sidecar is read once, not twice.
  const bare = new Map<string, Buffer>([[original, jpg]]);
  const second = countingStore(bare);
  const listed = await listQueuePhotos(second.store);
  assert.deepEqual(listed, [{
    id: ID,
    photoId: ID,
    size: jpg.length,
    meta: { name: `photo-${ID}.jpg`, source: 'upload', addedAt: new Date(ID).toISOString() },
  }]);
  assert.equal(second.calls.meta, 1);
  assert.equal(second.calls.locked, 0);
});

test('a family listed only as sidecars is rechecked under its lock: an orphan is not shown, a missed photo is', async () => {
  // A sidecar alone is not a photo.
  for (const orphan of [`dev-queue/${ID}.json`, sidecar]) {
    const { store, calls } = countingStore(new Map([[orphan, metaOf('gone.jpg')]]));
    assert.deepEqual(await listQueuePhotos(store), [], orphan);
    assert.equal(calls.locked, 1);
  }

  // The listing missed a photo that exists (a page shifted under a delete, or
  // a migration ran between the two bucket listings). The recheck finds it.
  const files = new Map<string, Buffer>([[next, jpg], [sidecar, metaOf('IMG_3.jpg')], [`dev-queue/${ID}.json`, metaOf('IMG_3.HEIC')]]);
  const { store, calls } = countingStore(files, () => snapshot(files).filter((object) => !object.path.endsWith('.jpg')));
  const listed = await listQueuePhotos(store);
  assert.deepEqual(listed.map((photo) => [photo.id, photo.photoId, photo.size, photo.meta.name]), [[ID, replacementId(ID), jpg.length, 'IMG_3.jpg']]);
  assert.equal(calls.locked, 1);
});

test('one listing bounds its sidecar reads and its locked rechecks', async () => {
  const files = new Map<string, Buffer>();
  for (let i = 0; i < 100; i++) {
    files.set(`dev-queue/${ID + i}.jpg`, jpg);
    files.set(`dev-queue/${ID + i}.json`, metaOf(`${i}.jpg`));
  }
  for (let i = 0; i < 10; i++) files.set(`dev-queue/${ID + 1000 + i}.json`, metaOf('orphan.jpg'));
  const { store, calls, peak } = countingStore(files);
  const listed = await listQueuePhotos(store);
  assert.equal(listed.length, 100);
  assert.equal(calls.locked, 10, 'only the sidecar-only families lock');
  assert.equal(peak.meta, LISTING_META_CONCURRENCY);
  assert.equal(peak.locked, LISTING_LOCKED_CONCURRENCY);
  assert.ok(LISTING_META_CONCURRENCY <= 8 && LISTING_LOCKED_CONCURRENCY <= 2);
});

test('a 500-photo queue lists with one object listing and one sidecar read per photo', async () => {
  const files = new Map<string, Buffer>();
  for (let i = 0; i < 500; i++) {
    const id = ID + i * 7;
    files.set(`dev-queue/${id}.jpg`, i % 10 === 0 ? Buffer.from('heic') : jpg);
    files.set(`dev-queue/${id}.json`, metaOf(`${i}.jpg`, i % 2 ? 'camera' : 'upload', new Date(id).toISOString()));
    if (i % 10 === 0) { // every tenth was repaired and kept its original
      files.set(`dev-queue/${replacementId(id)}.jpg`, jpg);
      files.set(`dev-queue/${replacementId(id)}.json`, metaOf(`${i}.jpg`, 'upload', new Date(id).toISOString()));
    }
  }
  const { store, calls } = countingStore(files);
  const listed = await listQueuePhotos(store);
  assert.equal(listed.length, 500);
  assert.equal(new Set(listed.map((photo) => photo.id)).size, 500, 'each family once');
  assert.equal(listed.filter((photo) => photo.photoId !== photo.id).length, 50, 'repaired families show the replacement');
  // The old listing made ~3 store calls and took a database lock per photo.
  assert.deepEqual(calls, { list: 1, locked: 0, exists: 0, size: 0, photo: 0, meta: 500, put: 0, remove: 0 });
});
