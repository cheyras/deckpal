/**
 * The capture routes read, list, write and delete the PRIVATE bucket, and see
 * a not-yet-migrated public copy only through the server — never by URL.
 *
 * `scanFlags.ts` is exercised over real HTTP against its own router, with an
 * in-memory pair of buckets standing in for Storage and an open gate standing
 * in for `labelerOnlyInProduction` (whose own tests are ownerGate.test.ts).
 * The queue's object layer is tested directly: its route opens a database pool
 * for the family lock, and `queueRepair.test.ts` already covers the state
 * machine above that layer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  CaptureStorageError,
  createCaptureStore,
  type CaptureBucket,
  type CaptureObject,
  type CaptureStore,
} from '@deckpal/storage';
import { ApiError, errorMiddleware } from '../../http.js';
import { createScanFlagsRouter } from '../scanFlags.js';
import { createCaptureQueueStore } from '../captureQueueStore.js';
import { listQueuePhotos } from '../queueRepair.js';

const md5 = (bytes: Buffer | string) => createHash('md5').update(bytes).digest('hex');

function bucket(name: string, initial: Record<string, string> = {}) {
  const objects = new Map<string, CaptureObject>(
    Object.entries(initial).map(([k, v]) => [k, { bytes: Buffer.from(v), contentType: k.endsWith('.json') ? 'application/json' : 'image/png' }]),
  );
  const writes: string[] = [];
  let failing = false;
  const guard = () => {
    if (failing) throw new CaptureStorageError(`[storage] ${name} is down`, 503);
  };
  const b: CaptureBucket & { objects: typeof objects; writes: string[]; fail(on: boolean): void } = {
    name,
    objects,
    writes,
    fail: (on) => {
      failing = on;
    },
    async list(prefix) {
      guard();
      return [...objects]
        .filter(([k]) => k.startsWith(`${prefix}/`))
        // Storage's etag for a single-part upload is the MD5 of its bytes.
        .map(([path, o]) => ({ path, byteSize: o.bytes.length, contentType: o.contentType, etag: md5(o.bytes), cacheControl: null }));
    },
    async read(path) {
      guard();
      return objects.get(path) ?? null;
    },
    async stat(path) {
      guard();
      const o = objects.get(path);
      return o ? { byteSize: o.bytes.length } : null;
    },
    async write(path, bytes, contentType, mode) {
      guard();
      if (name === 'card-art') throw new Error('a capture was written to the PUBLIC bucket');
      if (mode === 'create' && objects.has(path)) return 'exists';
      writes.push(path);
      objects.set(path, { bytes, contentType });
      return 'written';
    },
    async remove(path) {
      guard();
      return objects.delete(path);
    },
  };
  return b;
}

async function serve(store: CaptureStore | null, run: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json({ limit: '4200kb' }));
  app.use('/dev/scan-flags', createScanFlagsRouter({ store: () => store, gate: (_req, _res, next) => next() }));
  app.use(errorMiddleware);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    await run(`http://127.0.0.1:${port}/dev/scan-flags`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const OLD = 1_700_000_000_000; // captured before the move: public only

describe('scan-flags routes over the private capture store', () => {
  it('a new capture lands in the private bucket and nowhere else', async () => {
    const primary = bucket('dev-captures');
    const legacy = bucket('card-art');
    await serve(createCaptureStore(primary, legacy), async (base) => {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ png: Buffer.from('PNGDATA').toString('base64'), meta: { type: 'quad-label', corners: null } }),
      });
      assert.equal(res.status, 200);
      const { id } = (await res.json()) as { id: number };
      assert.deepEqual(primary.writes.sort(), [`dev-flags/${id}.json`, `dev-flags/${id}.png`]);
      assert.equal(primary.objects.get(`dev-flags/${id}.png`)?.bytes.toString(), 'PNGDATA');
      assert.equal(legacy.objects.size, 0);
    });
  });

  it('lists and serves private and not-yet-migrated rows alike, privately cached', async () => {
    const NEW = OLD + 5;
    const primary = bucket('dev-captures', {
      [`dev-flags/${NEW}.png`]: 'new-png',
      [`dev-flags/${NEW}.json`]: JSON.stringify({ type: 'quad-label', corners: [[0, 0]], face: 'back' }),
    });
    const legacy = bucket('card-art', {
      [`dev-flags/${OLD}.png`]: 'old-png',
      [`dev-flags/${OLD}.json`]: JSON.stringify({ type: 'quad-label', corners: null, invalidReason: 'blur' }),
      [`dev-flags/${OLD}.comment.json`]: JSON.stringify({ comment: 'kept' }),
    });
    await serve(createCaptureStore(primary, legacy), async (base) => {
      const list = await fetch(`${base}?meta=1`);
      assert.equal(list.headers.get('cache-control'), 'private, no-store');
      const { flags } = (await list.json()) as { flags: Array<{ id: number; comment: string | null; label: { verdict: string } | null }> };
      assert.deepEqual(flags.map((f) => [f.id, f.label?.verdict, f.comment]), [
        [NEW, 'back', null],
        [OLD, 'negative', 'kept'],
      ]);

      for (const [id, body] of [[NEW, 'new-png'], [OLD, 'old-png']] as const) {
        const file = await fetch(`${base}/${id}.png`);
        assert.equal(file.status, 200);
        assert.equal(Buffer.from(await file.arrayBuffer()).toString(), body);
        assert.equal(file.headers.get('cache-control'), 'private, no-store', 'never public CDN caching');
        assert.equal(file.headers.get('content-type'), 'image/png');
      }
      assert.equal((await fetch(`${base}/${OLD + 1}.png`)).status, 404);
    });
  });

  it('a comment on an old public row is written privately', async () => {
    const primary = bucket('dev-captures');
    const legacy = bucket('card-art', { [`dev-flags/${OLD}.json`]: '{}' });
    await serve(createCaptureStore(primary, legacy), async (base) => {
      const res = await fetch(`${base}/${OLD}/comment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'a note' }),
      });
      assert.equal(res.status, 200);
      assert.match(primary.objects.get(`dev-flags/${OLD}.comment.json`)!.bytes.toString(), /"a note"/);
      assert.equal(legacy.objects.has(`dev-flags/${OLD}.comment.json`), false);
    });
  });

  it('a delete removes the row from both buckets', async () => {
    const primary = bucket('dev-captures', { [`dev-flags/${OLD}.json`]: '{}' });
    const legacy = bucket('card-art', { [`dev-flags/${OLD}.png`]: 'p', [`dev-flags/${OLD}.json`]: '{}', [`dev-flags/${OLD}.comment.json`]: '{}' });
    await serve(createCaptureStore(primary, legacy), async (base) => {
      const res = await fetch(`${base}/${OLD}`, { method: 'DELETE' });
      assert.equal(res.status, 200);
      assert.equal(primary.objects.size + legacy.objects.size, 0, 'no public straggler for the migration to bring back');
    });
  });

  it('degrades exactly as before when no object store is configured', async () => {
    await serve(null, async (base) => {
      assert.deepEqual(await (await fetch(base)).json(), { flags: [] });
      assert.equal((await fetch(`${base}/${OLD}.png`)).status, 404);
    });
  });
});

describe('the queue object layer over the private capture store', () => {
  const locked = <T>(_id: number, work: () => Promise<T>) => work();

  it('writes privately, reads through to an unmigrated photo, and deletes both copies', async () => {
    const primary = bucket('dev-captures');
    const legacy = bucket('card-art', { [`dev-queue/${OLD}.jpg`]: 'old-jpeg', [`dev-queue/${OLD}.json`]: '{"name":"a.jpg","source":"camera","addedAt":"x"}' });
    const queue = createCaptureQueueStore(createCaptureStore(primary, legacy), locked);

    await queue.put(`dev-queue/${OLD + 1}.jpg`, Buffer.from('new-jpeg'), 'image/jpeg');
    assert.deepEqual(primary.writes, [`dev-queue/${OLD + 1}.jpg`]);
    assert.equal((await queue.photo(`dev-queue/${OLD}.jpg`))?.toString(), 'old-jpeg');
    assert.deepEqual(await queue.meta(`dev-queue/${OLD}.json`), { name: 'a.jpg', source: 'camera', addedAt: 'x' });
    assert.equal(await queue.size(`dev-queue/${OLD}.jpg`), 'old-jpeg'.length);
    assert.equal(await queue.remove(`dev-queue/${OLD}.jpg`), true);
    assert.equal(legacy.objects.has(`dev-queue/${OLD}.jpg`), false);
    assert.equal(await queue.remove(`dev-queue/${OLD + 9}.jpg`), false, 'absent is not an error');
  });

  it('an outage is a 502, never a missing photo', async () => {
    const primary = bucket('dev-captures', { [`dev-queue/${OLD}.jpg`]: 'jpeg' });
    const queue = createCaptureQueueStore(createCaptureStore(primary, null), locked);
    primary.fail(true);
    for (const op of [() => queue.list(), () => queue.photo(`dev-queue/${OLD}.jpg`), () => queue.size(`dev-queue/${OLD}.jpg`), () => queue.exists(`dev-queue/${OLD}.jpg`), () => queue.meta(`dev-queue/${OLD}.json`)]) {
      await assert.rejects(op(), (error: unknown) => error instanceof ApiError && error.status === 502 && error.code === 'queue_storage_unavailable');
    }
  });

  it('a sidecar read retries a throttle, a 5xx or a timeout on a short clock, and fails fast on a refusal', async () => {
    const sidecarPath = `dev-queue/${OLD}.json`;
    const primary = bucket('dev-captures', { [sidecarPath]: '{"name":"a.jpg","source":"camera","addedAt":"x"}' });
    const read = primary.read.bind(primary);
    const timeouts: Array<number | undefined> = [];
    let failures: number[] = [];
    primary.read = async (path, options) => {
      timeouts.push(options?.timeoutMs);
      const status = failures.shift();
      if (status !== undefined) throw new CaptureStorageError(`[storage] dev-captures read failed: HTTP ${status}`, status);
      return read(path);
    };
    const queue = createCaptureQueueStore(createCaptureStore(primary, null), locked);
    const unavailable = (error: unknown) => error instanceof ApiError && error.status === 502 && error.code === 'queue_storage_unavailable';

    failures = [429, 0]; // a throttle, then a timeout or dropped connection
    assert.deepEqual(await queue.meta(sidecarPath), { name: 'a.jpg', source: 'camera', addedAt: 'x' });
    assert.deepEqual(timeouts, [5_000, 5_000, 5_000], 'each attempt on a 5 s clock, not the 20 s default');

    timeouts.length = 0;
    failures = [503, 503, 503, 503];
    await assert.rejects(queue.meta(sidecarPath), unavailable);
    assert.equal(timeouts.length, 3, 'three attempts, then the retryable 502');

    timeouts.length = 0;
    failures = [403];
    await assert.rejects(queue.meta(sidecarPath), unavailable);
    assert.equal(timeouts.length, 1, 'a refusal is not retried');
  });

  it('lists the queue from one snapshot of both buckets, with listed sizes and no lock', async () => {
    const NEW = OLD + 5;
    const primary = bucket('dev-captures', {
      [`dev-queue/${NEW}.jpg`]: 'new-jpeg',
      [`dev-queue/${NEW}.json`]: '{"name":"new.jpg","source":"camera","addedAt":"2026-09-30T00:00:00.000Z"}',
      [`dev-flags/${NEW}.png`]: 'a label, not a queued photo',
    });
    const legacy = bucket('card-art', {
      [`dev-queue/${OLD}.jpg`]: 'old-jpeg-bytes',
      [`dev-queue/${OLD}.json`]: '{"name":"old.jpg","source":"upload","addedAt":"2026-09-01T00:00:00.000Z"}',
    });
    let locks = 0;
    const queue = createCaptureQueueStore(createCaptureStore(primary, legacy), (id, work) => { locks++; return locked(id, work); });
    const entry = (from: ReturnType<typeof bucket>, path: string) => {
      const bytes = from.objects.get(path)!.bytes;
      return { path, byteSize: bytes.length, etag: md5(bytes) };
    };
    assert.deepEqual((await queue.list()).sort((a, b) => a.path.localeCompare(b.path)), [
      entry(legacy, `dev-queue/${OLD}.jpg`),
      entry(legacy, `dev-queue/${OLD}.json`),
      entry(primary, `dev-queue/${NEW}.jpg`),
      entry(primary, `dev-queue/${NEW}.json`),
    ]);
    const photos = await listQueuePhotos(queue);
    assert.deepEqual(photos.map((p) => [p.id, p.size, p.meta.name]).sort(), [[OLD, 'old-jpeg-bytes'.length, 'old.jpg'], [NEW, 'new-jpeg'.length, 'new.jpg']]);
    assert.equal(locks, 0);
  });

  it('a re-list reads only the sidecars whose listed bytes it has not read before', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 500; i++) {
      files[`dev-queue/${OLD + i}.jpg`] = `jpeg-${i}`;
      files[`dev-queue/${OLD + i}.json`] = JSON.stringify({ name: `${i}.jpg`, source: 'camera', addedAt: new Date(OLD + i).toISOString() });
    }
    const primary = bucket('dev-captures', files);
    const reads: string[] = [];
    const read = primary.read.bind(primary);
    primary.read = async (path, options) => { reads.push(path); return read(path, options); };
    const queue = createCaptureQueueStore(createCaptureStore(primary, null), locked);

    assert.equal((await listQueuePhotos(queue)).length, 500);
    assert.equal(reads.length, 500, 'a cold listing reads every sidecar once');

    reads.length = 0;
    assert.equal((await listQueuePhotos(queue)).length, 500);
    assert.equal(reads.length, 0, 'a warm re-list reads none');

    // A rewritten sidecar (a repair, a fixed corrupt one) lists a new etag.
    const changed = `dev-queue/${OLD + 7}.json`;
    primary.objects.set(changed, { bytes: Buffer.from(JSON.stringify({ name: 'renamed.jpg', source: 'upload', addedAt: new Date(OLD + 7).toISOString() })), contentType: 'application/json' });
    reads.length = 0;
    const relisted = await listQueuePhotos(queue);
    assert.deepEqual(reads, [changed]);
    assert.equal(relisted.find((p) => p.id === OLD + 7)?.meta.name, 'renamed.jpg');

    // A locked read never answers from memory.
    reads.length = 0;
    await queue.meta(`dev-queue/${OLD + 8}.json`);
    assert.deepEqual(reads, [`dev-queue/${OLD + 8}.json`]);
  });

  it('remembers a sidecar only when the bytes read are the bytes the listing named', async () => {
    const path = `dev-queue/${OLD}.json`;
    const primary = bucket('dev-captures', { [path]: '{"name":"a.jpg","source":"camera","addedAt":"x"}' });
    let reads = 0;
    const read = primary.read.bind(primary);
    primary.read = async (p, options) => { reads++; return read(p, options); };
    const queue = createCaptureQueueStore(createCaptureStore(primary, null), locked);
    // The sidecar changed between the listing and the read: an etag that does
    // not match what was read must not vouch for it next time.
    await queue.meta(path, md5('the bytes the listing saw'));
    await queue.meta(path, md5('the bytes the listing saw'));
    assert.equal(reads, 2);
    // A multipart or otherwise non-MD5 etag never caches.
    await queue.meta(path, 'not-an-md5-etag-1');
    await queue.meta(path, 'not-an-md5-etag-1');
    assert.equal(reads, 4);
  });

  it('a failed object listing is retried before the queue reports itself unavailable', async () => {
    const primary = bucket('dev-captures', { [`dev-queue/${OLD}.jpg`]: 'jpeg', [`dev-queue/${OLD}.json`]: '{"name":"a.jpg","source":"camera","addedAt":"x"}' });
    const list = primary.list.bind(primary);
    let attempts = 0;
    primary.list = async (prefix) => {
      attempts++;
      if (attempts === 1) throw new CaptureStorageError('[storage] dev-captures list failed for dev-queue: HTTP 429', 0);
      return list(prefix);
    };
    const queue = createCaptureQueueStore(createCaptureStore(primary, null), locked);
    assert.equal((await listQueuePhotos(queue)).length, 1);
    assert.equal(attempts, 2);
  });

  it('a delete that leaves the photo in place fails loudly', async () => {
    const primary = bucket('dev-captures', { [`dev-queue/${OLD}.jpg`]: 'jpeg' });
    primary.remove = async () => false; // Storage said "nothing there"… but it is.
    const queue = createCaptureQueueStore(createCaptureStore(primary, null), locked);
    await assert.rejects(queue.remove(`dev-queue/${OLD}.jpg`), (error: unknown) => error instanceof ApiError && error.code === 'queue_delete_failed');
  });

  it('a corrupt sidecar is missing metadata, not an outage', async () => {
    const primary = bucket('dev-captures', { [`dev-queue/${OLD}.json`]: '{not json' });
    const queue = createCaptureQueueStore(createCaptureStore(primary, null), locked);
    assert.equal(await queue.meta(`dev-queue/${OLD}.json`), null);
  });
});

describe('no capture route can reach the public bucket by URL', () => {
  const source = (file: string) => readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');

  it('the routes use the capture store, not the card-art object helpers', () => {
    for (const file of ['scanFlags.ts', 'scanQueue.ts', 'captureQueueStore.ts']) {
      const text = source(file);
      for (const helper of ['publicObjectUrl', 'putUnmanifestedObject', 'listObjectsRecursive', 'deleteObject', 'objectExists', 'headObject']) {
        assert.doesNotMatch(text, new RegExp(`\\b${helper}\\b`), `${file} must not use ${helper} — that is the public card-art bucket`);
      }
      assert.doesNotMatch(text, /object\/public/, `${file} builds no public Storage URL`);
    }
  });

  it('the migration runs behind the labeler gate, under the queue family lock', () => {
    const route = source('scanQueue.ts');
    assert.match(route, /scanQueueRouter\.use\(labelerOnlyInProduction\('forbidden'\)\)/);
    assert.match(route, /scanQueueRouter\.post\(\s*'\/migrate-captures'/);
    assert.match(route, /lock: migrationLock/);
    assert.match(route, /queueLocked\(queueFamilyId\(id\), work\)/);
  });
});
