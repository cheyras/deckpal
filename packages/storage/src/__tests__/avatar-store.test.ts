import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACCEPTED_AVATAR_UPLOAD_TYPES,
  MAX_AVATAR_UPLOAD_BYTES,
  type AvatarRecorder,
  type StoredAvatar,
  isAvatarKey,
  newAvatarKey,
  putAvatarObject,
} from '../avatar-store.js';
import { sniffContentType } from '../sniff.js';

/**
 * Pure guards on the avatar choke point. No network, no database: every case
 * here is rejected BEFORE the recorder or the upload would run, which is
 * exactly the property worth pinning — a malformed or mistyped avatar must
 * never reach the point where it could leave bytes or a row behind.
 */

/** Recorder that fails the test if it is ever called. */
function forbiddenRecorder(): AvatarRecorder {
  return {
    record: () => Promise.reject(new Error('recorder.record must not run for a rejected avatar')),
    revert: () => Promise.reject(new Error('recorder.revert must not run for a rejected avatar')),
  };
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const TEXT_FILE = Buffer.from('this is definitely not an image, whatever it is named\n');

describe('avatar keys', () => {
  it('mints 32 hex characters and a .webp suffix', () => {
    const key = newAvatarKey();
    assert.match(key, /^[0-9a-f]{32}\.webp$/);
    assert.ok(isAvatarKey(key));
  });

  it('is unguessable from anything about the user', () => {
    // 100 keys, no collisions — the point is that the key carries no user id,
    // so a public bucket cannot be probed by iterating accounts.
    const keys = new Set(Array.from({ length: 100 }, () => newAvatarKey()));
    assert.equal(keys.size, 100);
  });

  it('rejects keys it did not mint', () => {
    for (const bad of [
      '',
      'avatar.webp',
      '../../card-art/images/en/x.webp',
      'ABCDEF0123456789abcdef0123456789.webp', // uppercase
      '0123456789abcdef0123456789abcde.webp', // 31 chars
      '0123456789abcdef0123456789abcdef.png',
      '0123456789abcdef0123456789abcdef.webp/../x',
    ]) {
      assert.equal(isAvatarKey(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
  });
});

describe('accepted upload types', () => {
  it('accepts exactly JPEG, PNG and WebP', () => {
    assert.deepEqual([...ACCEPTED_AVATAR_UPLOAD_TYPES].sort(), ['image/jpeg', 'image/png', 'image/webp']);
  });

  it('does not accept GIF or SVG', () => {
    assert.ok(!ACCEPTED_AVATAR_UPLOAD_TYPES.includes('image/gif'));
    assert.ok(!ACCEPTED_AVATAR_UPLOAD_TYPES.includes('image/svg+xml'));
  });

  it('sniffs a renamed text file as neither', () => {
    // The .txt-renamed-.png case: the extension and the declared content-type
    // are both irrelevant, and the magic bytes give it away.
    assert.equal(sniffContentType(TEXT_FILE), 'application/octet-stream');
    assert.ok(!ACCEPTED_AVATAR_UPLOAD_TYPES.includes(sniffContentType(TEXT_FILE)));
  });

  it('caps the upload well below Vercel’s 4.5 MB request body limit', () => {
    assert.ok(MAX_AVATAR_UPLOAD_BYTES < 4.5 * 1024 * 1024);
  });
});

describe('putAvatarObject refuses to publish', () => {
  it('0 bytes, without recording anything', async () => {
    await assert.rejects(
      () => putAvatarObject(new Uint8Array(0), forbiddenRecorder()),
      /refusing to store 0 bytes/,
    );
  });

  it('a malformed key, without recording anything', async () => {
    await assert.rejects(
      () => putAvatarObject(PNG_MAGIC, forbiddenRecorder(), 'not-a-key.webp'),
      /malformed avatar key/,
    );
  });

  it('bytes that are not WebP after normalisation', async () => {
    // The caller's resize step is what produces WebP; if these ever reach the
    // store it is a bug upstream, not a bad upload — so it throws rather than
    // rejecting politely, and it throws before the record is written.
    for (const bytes of [PNG_MAGIC, JPEG_MAGIC, TEXT_FILE]) {
      await assert.rejects(
        () => putAvatarObject(bytes, forbiddenRecorder()),
        /must be WebP after normalisation/,
      );
    }
  });
});

describe('the record ordering contract', () => {
  it('records before publishing, and reverts when publishing fails', async () => {
    const calls: string[] = [];
    const recorder: AvatarRecorder = {
      record: (a: StoredAvatar) => {
        calls.push(`record:${a.key}`);
        return Promise.resolve();
      },
      revert: (a: StoredAvatar) => {
        calls.push(`revert:${a.key}`);
        return Promise.resolve();
      },
    };
    // A minimal valid WebP header is enough to pass the sniff; the upload then
    // fails because no Supabase credentials are configured in this test process.
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP'),
      Buffer.from([0, 0, 0, 0]),
    ]);
    const key = newAvatarKey();
    await assert.rejects(() => putAvatarObject(webp, recorder, key));
    assert.deepEqual(calls, [`record:${key}`, `revert:${key}`]);
  });
});
