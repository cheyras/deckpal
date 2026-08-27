import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * The guard AT the Storage choke points (CodeQL js/request-forgery #37, #60, #39).
 *
 * `object-path.test.ts` pins the allow-list itself. This file pins that the
 * exported functions actually CALL it — which is the whole difference between
 * the fix and the situation before it, where the same allow-list existed but
 * lived in `parseImagePath`, a module away, and the bulk callers never went
 * through it.
 *
 * Two properties, and the second is the one worth stating out loud:
 *
 *  1. a real key still composes exactly the URL it used to;
 *  2. a bad key REJECTS rather than resolving falsy. `objectExists` and
 *     `headObject` both wrap their fetch in `catch → miss`, so a guard placed
 *     inside that try would turn "this key is dangerous" into "the object is not
 *     there", and a bulk run would count it as work skipped. The assertion here
 *     is on the throw, not merely on the absence of a request.
 *
 * No network: the credentials below are fake, and every case rejects before any
 * request is built. Env is set before the dynamic import because `storageEnv()`
 * memoises on first read; node's test runner gives each FILE its own process, so
 * this cannot leak into a sibling suite.
 */

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'not-a-real-key';
process.env.CARD_ART_BUCKET = 'card-art';

const { deleteObject, headObject, moveObject, objectExists, publicObjectUrl, uploadObject } =
  await import('../object-store.js');

const GOOD = 'images/en/sv/sv03.5/102.low.webp';
const BAD = [
  '../../secret.webp',
  'images/../../../etc/passwd',
  'images/en/sv/1.low.webp?download=1',
  'images/en/sv/1.low.webp#x',
  'images/%2e%2e/secret',
  'images\\en\\sv\\1.low.webp',
  '/images/en/sv/1.low.webp',
  '',
];

describe('publicObjectUrl', () => {
  it('still builds the URL it always built', () => {
    assert.equal(
      publicObjectUrl(GOOD),
      'https://example.supabase.co/storage/v1/object/public/card-art/images/en/sv/sv03.5/102.low.webp',
    );
  });

  for (const key of BAD) {
    it(`throws for ${JSON.stringify(key)}`, () => {
      assert.throws(() => publicObjectUrl(key), /refusing unsafe object key/);
    });
  }
});

describe('the exported choke points reject an unsafe key', () => {
  for (const key of BAD) {
    it(`objectExists(${JSON.stringify(key)}) rejects — it does not answer "miss"`, async () => {
      await assert.rejects(() => objectExists(key), /objectExists: refusing unsafe object key/);
    });

    it(`headObject(${JSON.stringify(key)}) rejects — it does not answer null`, async () => {
      await assert.rejects(() => headObject(key), /headObject: refusing unsafe object key/);
    });

    it(`uploadObject(${JSON.stringify(key)}) rejects`, async () => {
      await assert.rejects(
        () => uploadObject(key, new Uint8Array([1, 2, 3]), 'image/webp'),
        /uploadObject: refusing unsafe object key/,
      );
    });

    it(`deleteObject(${JSON.stringify(key)}) rejects`, async () => {
      await assert.rejects(() => deleteObject(key), /deleteObject: refusing unsafe object key/);
    });
  }

  it('moveObject checks BOTH addresses, not just the source', async () => {
    await assert.rejects(
      () => moveObject('../../secret.webp', GOOD),
      /moveObject\(source\): refusing unsafe object key/,
    );
    await assert.rejects(
      () => moveObject(GOOD, '../../secret.webp'),
      /moveObject\(destination\): refusing unsafe object key/,
    );
  });
});
