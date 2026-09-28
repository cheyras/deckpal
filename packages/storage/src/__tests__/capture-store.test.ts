import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { unknownProvenance } from '../put-asset.js';
import { memoryBucket, text } from './memory-capture-bucket.js';

/**
 * The private capture store: what the routes read, list, write and delete
 * through, and the HTTP handles underneath it.
 *
 * Env is set before the dynamic import because `storageEnv()` memoises on first
 * read; node's test runner gives each FILE its own process.
 */
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test-only';
process.env.CARD_ART_BUCKET = 'card-art';

const {
  CAPTURE_BUCKET,
  CaptureStorageError,
  __resetCaptureBucketEnsure,
  captureStore,
  createCaptureStore,
  ensureCaptureBucket,
  httpCaptureBucket,
  legacyCaptureBucket,
} = await import('../capture-store.js');

const provenance = unknownProvenance('test capture');
const put = (objectPath: string, body: string) => ({
  objectPath,
  bytes: Buffer.from(body),
  contentType: 'application/json',
  provenance,
  tierProvenanceReason: 'test class',
});

describe('createCaptureStore (private first, public read-through)', () => {
  it('writes only the private bucket', async () => {
    const primary = memoryBucket('dev-captures');
    const legacy = memoryBucket('card-art');
    const store = createCaptureStore(primary, legacy);
    await store.put(put('dev-flags/1.json', '{"a":1}'));
    assert.equal(text(primary, 'dev-flags/1.json'), '{"a":1}');
    assert.equal(legacy.objects.size, 0);
    assert.ok(!legacy.calls.some((c) => c.startsWith('write')), 'the public bucket is never written');
    assert.deepEqual(primary.calls, ['write dev-flags/1.json upsert'], 'a route write is an upsert (a comment re-POST is an edit)');
  });

  it('demands provenance and the class reason on every write (B1)', async () => {
    const store = createCaptureStore(memoryBucket('dev-captures'), null);
    await assert.rejects(store.put({ ...put('dev-flags/1.json', '{}'), tierProvenanceReason: ' ' }), /tierProvenanceReason/);
    await assert.rejects(store.put({ ...put('dev-flags/1.json', '') }), /0 bytes/);
  });

  it('lists both buckets as one, the private copy winning a tie', async () => {
    const primary = memoryBucket('dev-captures', { 'dev-flags/2.png': 'new', 'dev-flags/1.png': 'moved' });
    const legacy = memoryBucket('card-art', { 'dev-flags/1.png': 'moved-but-not-yet-deleted', 'dev-flags/3.png': 'old' });
    const store = createCaptureStore(primary, legacy);
    const listed = await store.list('dev-flags');
    const byPath = Object.fromEntries(listed.map((o) => [o.path, o.byteSize]));
    assert.deepEqual(Object.keys(byPath).sort(), ['dev-flags/1.png', 'dev-flags/2.png', 'dev-flags/3.png']);
    assert.equal(byPath['dev-flags/1.png'], 'moved'.length, 'the private object is the one reported');
  });

  it('reads the private copy first and falls back to a not-yet-moved public one', async () => {
    const primary = memoryBucket('dev-captures', { 'dev-flags/1.json': 'private' });
    const legacy = memoryBucket('card-art', { 'dev-flags/1.json': 'public', 'dev-flags/2.json': 'only-public' });
    const store = createCaptureStore(primary, legacy);
    assert.equal((await store.read('dev-flags/1.json'))?.bytes.toString(), 'private');
    assert.ok(!legacy.calls.includes('read dev-flags/1.json'), 'a private hit never touches the public bucket');
    assert.equal((await store.read('dev-flags/2.json'))?.bytes.toString(), 'only-public');
    assert.equal(await store.read('dev-flags/9.json'), null);
    assert.equal(await store.exists('dev-flags/2.json'), true);
    assert.deepEqual(await store.stat('dev-flags/1.json'), { byteSize: 'private'.length });
  });

  it('does not 404 an object the migration moves between the two reads', async () => {
    const primary = memoryBucket('dev-captures');
    const legacy = memoryBucket('card-art', { 'dev-flags/1.png': 'photo' });
    // The migration finishes in between: private gets it, public loses it.
    legacy.hooks.read = (path) => {
      primary.objects.set(path, legacy.objects.get(path)!);
      legacy.objects.delete(path);
      return null;
    };
    const store = createCaptureStore(primary, legacy);
    assert.equal((await store.read('dev-flags/1.png'))?.bytes.toString(), 'photo');
  });

  it('deletes both copies, the public one first', async () => {
    const primary = memoryBucket('dev-captures', { 'dev-flags/1.png': 'a' });
    const legacy = memoryBucket('card-art', { 'dev-flags/1.png': 'a', 'dev-flags/2.png': 'b' });
    const order: string[] = [];
    legacy.hooks.remove = (path) => void order.push(`public ${path}`);
    primary.hooks.remove = (path) => void order.push(`private ${path}`);
    const store = createCaptureStore(primary, legacy);
    assert.equal(await store.remove('dev-flags/1.png'), true);
    assert.deepEqual(order, ['public dev-flags/1.png', 'private dev-flags/1.png'], 'the exposure goes first');
    assert.equal(await store.remove('dev-flags/2.png'), true, 'a public-only object is still deleted');
    assert.equal(await store.remove('dev-flags/3.png'), false);
    assert.equal(primary.objects.size + legacy.objects.size, 0);
  });

  it('drops a "legacy" handle that names the private bucket itself', async () => {
    const primary = memoryBucket('dev-captures', { 'dev-flags/1.png': 'only copy' });
    const store = createCaptureStore(primary, memoryBucket('dev-captures'));
    assert.equal(store.legacy, null);
  });
});

// ── The HTTP handles, against a fake Storage ────────────────────────────────

interface Call {
  method: string;
  url: string;
  headers: Headers;
  body?: string;
}

function fakeStorage(options: { bucketPublic?: boolean | 'missing'; duplicateCreate?: boolean } = {}) {
  const calls: Call[] = [];
  let bucket: { public: boolean } | null = options.bucketPublic === 'missing' ? null : { public: options.bucketPublic ?? false };
  const objects = new Map<string, string>(); // "<bucket>/<key>" -> body
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : init?.body ? Buffer.from(init.body as Uint8Array).toString() : undefined;
    calls.push({ method, url, headers: new Headers(init?.headers), body });
    const path = new URL(url).pathname;
    if (path === `/storage/v1/bucket/${CAPTURE_BUCKET}`) {
      return bucket ? Response.json({ id: CAPTURE_BUCKET, public: bucket.public }) : new Response('{"statusCode":"404"}', { status: 400 });
    }
    if (path === '/storage/v1/bucket' && method === 'POST') {
      if (options.duplicateCreate) {
        bucket = { public: false }; // another cold start created it first
        return new Response('{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}', { status: 400 });
      }
      bucket = { public: JSON.parse(body!).public };
      return Response.json({ name: CAPTURE_BUCKET });
    }
    const list = /^\/storage\/v1\/object\/list\/([^/]+)$/.exec(path);
    if (list) {
      const prefix = JSON.parse(body!).prefix as string;
      const entries = [...objects.keys()]
        .filter((k) => k.startsWith(`${list[1]}/${prefix}/`))
        .map((k) => ({ name: k.slice(`${list[1]}/${prefix}/`.length), id: 'x', metadata: { size: objects.get(k)!.length, mimetype: 'image/png' } }));
      return Response.json(entries);
    }
    const object = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(path);
    if (object) {
      const key = `${object[1]}/${object[2]}`;
      if (method === 'POST') {
        if (objects.has(key) && init?.headers && new Headers(init.headers).get('x-upsert') === 'false') {
          return new Response('{"statusCode":"409","error":"Duplicate"}', { status: 400 });
        }
        objects.set(key, body ?? '');
        return Response.json({ Key: key });
      }
      if (method === 'DELETE') {
        return objects.delete(key) ? Response.json({}) : new Response('{"statusCode":"404","error":"not_found"}', { status: 400 });
      }
      if (!objects.has(key)) return new Response('{"statusCode":"404","error":"not_found"}', { status: 400 });
      const stored = objects.get(key)!;
      return new Response(method === 'HEAD' ? null : stored, { status: 200, headers: { 'content-length': String(stored.length), 'content-type': 'image/png' } });
    }
    return new Response('unexpected', { status: 500 });
  };
  return { calls, objects, fetchImpl, bucketState: () => bucket };
}

describe('the HTTP capture handles', () => {
  let original: typeof fetch;
  beforeEach(() => {
    __resetCaptureBucketEnsure();
    original = globalThis.fetch;
  });
  const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
    globalThis.fetch = impl;
    try {
      await run();
    } finally {
      globalThis.fetch = original;
    }
  };

  it('reads, lists, writes and deletes the PRIVATE bucket with the service key — never a public URL', async () => {
    const storage = fakeStorage();
    await withFetch(storage.fetchImpl as typeof fetch, async () => {
      const store = captureStore();
      await store.put(put('dev-flags/1700000000001.json', '{"type":"quad-label"}'));
      assert.equal((await store.read('dev-flags/1700000000001.json'))?.bytes.toString(), '{"type":"quad-label"}');
      assert.deepEqual((await store.list('dev-flags')).map((o) => o.path), ['dev-flags/1700000000001.json']);
      assert.equal(await store.remove('dev-flags/1700000000001.json'), true);
    });
    const objectCalls = storage.calls.filter((c) => c.url.includes('/object/'));
    assert.ok(objectCalls.length > 0);
    for (const call of storage.calls) {
      assert.doesNotMatch(call.url, /\/object\/public\//, `${call.method} ${call.url} must not use the public route`);
      assert.equal(call.headers.get('apikey'), 'sb_secret_test-only', `${call.method} ${call.url} carries the service key`);
    }
    const writes = storage.calls.filter((c) => c.method === 'POST' && c.url.includes('/object/dev-captures/'));
    assert.equal(writes.length, 1, 'the write went to the private bucket');
    assert.equal(writes[0]!.headers.get('cache-control'), 'private, no-store');
    assert.ok(storage.calls.some((c) => c.url.endsWith('/object/list/dev-captures')), 'the private bucket is listed');
    assert.ok(!storage.calls.some((c) => c.method === 'POST' && c.url.includes('/object/card-art/')), 'nothing is written to card-art');
  });

  it('creates the private bucket once, private, when it does not exist', async () => {
    const storage = fakeStorage({ bucketPublic: 'missing' });
    await withFetch(storage.fetchImpl as typeof fetch, async () => {
      await ensureCaptureBucket();
      await ensureCaptureBucket();
    });
    const creates = storage.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/storage/v1/bucket'));
    assert.equal(creates.length, 1, 'memoised: one create per process');
    assert.deepEqual(JSON.parse(creates[0]!.body!), { id: 'dev-captures', name: 'dev-captures', public: false });
    assert.deepEqual(storage.bucketState(), { public: false });
  });

  it('treats losing the create race as success, after checking the winner made it private', async () => {
    const storage = fakeStorage({ bucketPublic: 'missing', duplicateCreate: true });
    await withFetch(storage.fetchImpl as typeof fetch, () => ensureCaptureBucket());
    assert.equal(storage.calls.filter((c) => c.url.endsWith(`/bucket/${CAPTURE_BUCKET}`)).length, 2, 'read, create, re-read');
  });

  it('refuses to store anything in a same-named bucket that is public', async () => {
    const storage = fakeStorage({ bucketPublic: true });
    await withFetch(storage.fetchImpl as typeof fetch, async () => {
      const bucket = httpCaptureBucket({ bucket: CAPTURE_BUCKET, before: ensureCaptureBucket, writable: true, allowConflicts: true });
      await assert.rejects(bucket.write('dev-flags/1.png', Buffer.from('x'), 'image/png', 'upsert'), CaptureStorageError);
    });
    assert.ok(!storage.calls.some((c) => c.url.includes('/object/')), 'no object request was made');
  });

  it('answers create-only onto an existing key with "exists", not an error', async () => {
    const storage = fakeStorage();
    storage.objects.set('dev-captures/dev-flags/1.png', 'first');
    await withFetch(storage.fetchImpl as typeof fetch, async () => {
      const bucket = httpCaptureBucket({ bucket: CAPTURE_BUCKET, writable: true, allowConflicts: true });
      assert.equal(await bucket.write('dev-flags/1.png', Buffer.from('second'), 'image/png', 'create'), 'exists');
    });
    assert.equal(storage.objects.get('dev-captures/dev-flags/1.png'), 'first', 'nothing overwritten');
  });

  it('tells a missing object from a refused request', async () => {
    const refusing = (async () => new Response('{"statusCode":"403","error":"Unauthorized"}', { status: 400 })) as typeof fetch;
    await withFetch(refusing, async () => {
      const bucket = httpCaptureBucket({ bucket: CAPTURE_BUCKET, writable: true, allowConflicts: true });
      await assert.rejects(bucket.read('dev-flags/1.png'), CaptureStorageError, 'a 400 that is not a 404 is a failure');
      await assert.rejects(bucket.remove('dev-flags/1.png'), CaptureStorageError);
    });
    const storage = fakeStorage();
    await withFetch(storage.fetchImpl as typeof fetch, async () => {
      const bucket = httpCaptureBucket({ bucket: CAPTURE_BUCKET, writable: true, allowConflicts: true });
      assert.equal(await bucket.read('dev-flags/404.png'), null);
      assert.equal(await bucket.remove('dev-flags/404.png'), false);
    });
  });

  it('the legacy handle reads card-art through the authenticated route, and cannot write or leave the capture prefixes', async () => {
    const storage = fakeStorage();
    storage.objects.set('card-art/dev-flags/1.png', 'old photo');
    await withFetch(storage.fetchImpl as typeof fetch, async () => {
      const legacy = legacyCaptureBucket()!;
      assert.equal(legacy.name, 'card-art');
      assert.equal((await legacy.read('dev-flags/1.png'))?.bytes.toString(), 'old photo');
      await assert.rejects(legacy.write('dev-flags/1.png', Buffer.from('x'), 'image/png', 'upsert'), /never written to the public bucket/);
      await assert.rejects(legacy.remove('images/en/sv/sv01/1.low.webp'), /not under dev-flags\/ or dev-queue\//);
      await assert.rejects(legacy.read('sets/sv01/logo.webp'), /not under/);
      await assert.rejects(legacy.read('legacy-conflicts/dev-flags/1.png'), /not under/);
    });
    const reads = storage.calls.filter((c) => c.url.includes('/object/card-art/'));
    assert.equal(reads.length, 1, 'only the one capture read reached Storage');
    assert.match(reads[0]!.url, /\/storage\/v1\/object\/card-art\/dev-flags\/1\.png$/);
  });
});
