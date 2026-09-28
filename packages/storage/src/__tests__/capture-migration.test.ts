import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conflictKey, migrateLegacyCaptures } from '../capture-migration.js';
import { sha256Hex } from '../capture-store.js';
import { memoryBucket, text } from './memory-capture-bucket.js';

/**
 * The move of public captures into the private bucket.
 *
 * The property every case below is really about: a public object is deleted
 * ONLY after a byte-identical private copy has been read back. Each failure
 * mode is injected at the step it would happen in, and each one must leave the
 * public copy where it was.
 */

const CORPUS = {
  'dev-flags/1700000000001.png': 'png-bytes-one',
  'dev-flags/1700000000001.json': '{"type":"quad-label","corners":null}',
  'dev-flags/1700000000001.comment.json': '{"comment":"old note"}',
  'dev-queue/1700000000002.jpg': 'jpeg-bytes-two',
  'dev-queue/1700000000002.json': '{"name":"a.jpg","source":"camera","addedAt":"2026-09-01T00:00:00.000Z"}',
};

function setup(initialPublic: Record<string, string> = CORPUS) {
  const primary = memoryBucket('dev-captures');
  const legacy = memoryBucket('card-art', initialPublic);
  return { primary, legacy };
}

describe('migrateLegacyCaptures', () => {
  it('copies, verifies, then deletes every public capture', async () => {
    const { primary, legacy } = setup();
    const report = await migrateLegacyCaptures({ primary, legacy });

    assert.equal(report.listed, 5);
    assert.equal(report.moved, 5);
    assert.deepEqual(report.failed, []);
    assert.equal(report.remaining, 0);
    assert.equal(report.done, true);
    assert.equal(legacy.objects.size, 0, 'nothing is left public');
    for (const [path, body] of Object.entries(CORPUS)) {
      assert.equal(text(primary, path), body, `${path} is in the private bucket, byte for byte`);
    }
    // Order per object: the private write and its read-back BEFORE the public delete.
    for (const path of Object.keys(CORPUS)) {
      const write = primary.calls.indexOf(`write ${path} create`);
      const verify = primary.calls.indexOf(`read ${path}`);
      assert.ok(write >= 0 && verify > write, `${path}: written create-only, then read back`);
      assert.ok(legacy.calls.includes(`remove ${path}`));
    }
  });

  it('keeps the public copy when the private copy does not verify', async () => {
    const { primary, legacy } = setup({ 'dev-flags/1700000000001.png': 'the real photo' });
    // Storage "accepts" the upload but holds different bytes — at the key and
    // at the conflict key alike.
    primary.hooks.write = (_path, bytes) => Buffer.concat([bytes, Buffer.from('!corrupt')]);

    const report = await migrateLegacyCaptures({ primary, legacy });

    assert.equal(report.moved + report.preserved, 0);
    assert.equal(report.failed.length, 1);
    assert.match(report.failed[0]!.reason, /verification failed/);
    assert.equal(report.remaining, 1);
    assert.equal(report.done, false);
    assert.equal(text(legacy, 'dev-flags/1700000000001.png'), 'the real photo', 'the public copy survives');
    assert.ok(!legacy.calls.some((c) => c.startsWith('remove')), 'no public delete was even attempted');
  });

  it('keeps the public copy when the private write or read-back fails', async () => {
    for (const fault of ['write', 'read'] as const) {
      const { primary, legacy } = setup({ 'dev-flags/1700000000001.png': 'photo' });
      if (fault === 'write') {
        primary.write = async () => {
          throw new Error('503 from storage');
        };
      } else {
        primary.hooks.read = () => {
          throw new Error('timeout');
        };
      }
      const report = await migrateLegacyCaptures({ primary, legacy });
      assert.equal(report.failed.length, 1, fault);
      assert.equal(text(legacy, 'dev-flags/1700000000001.png'), 'photo', `${fault} failure keeps the public copy`);
      assert.ok(!legacy.calls.some((c) => c.startsWith('remove')), fault);
    }
  });

  it('skips an object whose public read does not match the listing', async () => {
    const { primary, legacy } = setup({ 'dev-flags/1700000000001.comment.json': '{"comment":"v2"}' });
    // A stale edge copy, or an overwrite between list and read.
    legacy.hooks.read = () => ({ bytes: Buffer.from('{"comment":"v1"}'), contentType: 'application/json' });
    const report = await migrateLegacyCaptures({ primary, legacy });
    assert.equal(report.failed.length, 1);
    assert.match(report.failed[0]!.reason, /changed or was read stale/);
    assert.equal(primary.objects.size, 0, 'nothing was copied');
    assert.equal(legacy.objects.size, 1, 'nothing was deleted');
  });

  it('is a no-op when re-run after it finished', async () => {
    const { primary, legacy } = setup();
    await migrateLegacyCaptures({ primary, legacy });
    const snapshot = new Map([...primary.objects].map(([k, v]) => [k, v.bytes.toString('base64')]));
    primary.calls.length = 0;
    legacy.calls.length = 0;

    const again = await migrateLegacyCaptures({ primary, legacy });

    assert.deepEqual(again, { listed: 0, moved: 0, preserved: 0, gone: 0, failed: [], remaining: 0, done: true });
    assert.deepEqual(primary.calls, [], 'the private bucket is not touched');
    assert.deepEqual(legacy.calls, ['list dev-flags', 'list dev-queue'], 'only the two listings');
    assert.deepEqual(new Map([...primary.objects].map(([k, v]) => [k, v.bytes.toString('base64')])), snapshot);
  });

  it('finishes an interrupted run without rewriting what it already copied', async () => {
    const { primary, legacy } = setup({ 'dev-flags/1700000000001.png': 'photo', 'dev-flags/1700000000001.json': '{}' });
    let interrupted = false;
    legacy.hooks.remove = (path) => {
      if (!interrupted && path.endsWith('.png')) {
        interrupted = true;
        throw new Error('function killed');
      }
    };
    const first = await migrateLegacyCaptures({ primary, legacy });
    assert.equal(first.failed.length, 1);
    assert.equal(text(primary, 'dev-flags/1700000000001.png'), 'photo', 'the copy landed before the crash');
    assert.equal(text(legacy, 'dev-flags/1700000000001.png'), 'photo', 'and the public one is still there');

    primary.calls.length = 0;
    const second = await migrateLegacyCaptures({ primary, legacy });
    assert.equal(second.moved, 1);
    assert.equal(second.done, true);
    assert.equal(legacy.objects.size, 0);
    assert.deepEqual(
      primary.calls.filter((c) => c.startsWith('write')),
      ['write dev-flags/1700000000001.png create'],
      'the create-only write found it already there',
    );
    assert.equal(text(primary, 'dev-flags/1700000000001.png'), 'photo');
  });

  it('never overwrites a newer private object; parks the public bytes instead', async () => {
    const path = 'dev-flags/1700000000001.comment.json';
    const { primary, legacy } = setup({ [path]: '{"comment":"old note"}' });
    // Edited after the deploy: the new comment went to the private bucket.
    await primary.write(path, Buffer.from('{"comment":"new note"}'), 'application/json', 'upsert');

    const report = await migrateLegacyCaptures({ primary, legacy });

    assert.equal(report.preserved, 1);
    assert.equal(report.moved, 0);
    assert.equal(text(primary, path), '{"comment":"new note"}', 'the newer private copy is untouched');
    const parked = conflictKey(path, sha256Hex(Buffer.from('{"comment":"old note"}')));
    assert.match(parked, /^legacy-conflicts\/dev-flags\/1700000000001\.[0-9a-f]{16}\.comment\.json$/);
    assert.equal(text(primary, parked), '{"comment":"old note"}', 'the public bytes are kept, privately');
    assert.equal(legacy.objects.size, 0, 'and are no longer public');
  });

  it('two runs at once move everything exactly once and lose nothing', async () => {
    const { primary, legacy } = setup();
    const [a, b] = await Promise.all([
      migrateLegacyCaptures({ primary, legacy, concurrency: 2 }),
      migrateLegacyCaptures({ primary, legacy, concurrency: 3 }),
    ]);
    assert.deepEqual([...a.failed, ...b.failed], []);
    assert.equal(a.moved + a.gone + b.moved + b.gone, 10, 'each run accounts for all five');
    assert.ok(a.moved + b.moved >= 5);
    assert.equal(legacy.objects.size, 0);
    for (const [p, body] of Object.entries(CORPUS)) assert.equal(text(primary, p), body);
    assert.ok(![...primary.objects.keys()].some((k) => k.startsWith('legacy-conflicts/')), 'identical bytes are not a conflict');
  });

  it('stops starting objects when the budget runs out, and the next run finishes', async () => {
    const { primary, legacy } = setup();
    let clock = 0;
    const now = () => clock;
    legacy.hooks.read = () => {
      clock += 10; // each object "takes" 10 ms
      return undefined;
    };
    const first = await migrateLegacyCaptures({ primary, legacy, budgetMs: 15, concurrency: 1, now });
    assert.equal(first.moved, 2);
    assert.equal(first.remaining, 3);
    assert.equal(first.done, false);
    assert.equal(legacy.objects.size, 3);

    const second = await migrateLegacyCaptures({ primary, legacy, budgetMs: 1_000_000, now });
    assert.equal(second.moved, 3);
    assert.equal(second.done, true);
    assert.equal(legacy.objects.size, 0);
  });

  it('runs each object under the caller lock', async () => {
    const { primary, legacy } = setup();
    const locked: string[] = [];
    await migrateLegacyCaptures({
      primary,
      legacy,
      lock: async (path, work) => {
        locked.push(path);
        return work();
      },
    });
    assert.deepEqual(locked.sort(), Object.keys(CORPUS).sort());
  });

  it('refuses to treat one bucket as both sides', async () => {
    const same = memoryBucket('dev-captures', CORPUS);
    const report = await migrateLegacyCaptures({ primary: same, legacy: same });
    assert.equal(report.listed, 0);
    assert.equal(same.objects.size, 5, 'deleting "the old copy" would have deleted the only one');
    assert.deepEqual(same.calls, []);
  });

  it('does nothing without a legacy bucket', async () => {
    const report = await migrateLegacyCaptures({ primary: memoryBucket('dev-captures'), legacy: null });
    assert.equal(report.done, true);
  });
});
