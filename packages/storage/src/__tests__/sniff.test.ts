import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sniffContentType, isWebp, isCacheableImage } from '../sniff.js';

// ── Valid image detection ───────────────────────────────────────────────────

describe('sniffContentType — valid images', () => {
  it('detects PNG from magic bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    assert.equal(sniffContentType(png), 'image/png');
  });

  it('detects JPEG from magic bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.equal(sniffContentType(jpeg), 'image/jpeg');
  });

  it('detects WebP from RIFF...WEBP header', () => {
    const webp = Buffer.alloc(16);
    webp.write('RIFF', 0);
    webp.writeUInt32LE(100, 4);
    webp.write('WEBP', 8);
    assert.equal(sniffContentType(webp), 'image/webp');
  });

  it('detects GIF87a', () => {
    const gif = Buffer.from('GIF87a\x00\x00\x00\x00');
    assert.equal(sniffContentType(gif), 'image/gif');
  });

  it('detects GIF89a', () => {
    const gif = Buffer.from('GIF89a\x00\x00\x00\x00');
    assert.equal(sniffContentType(gif), 'image/gif');
  });

  it('returns application/octet-stream for unknown bytes', () => {
    const unknown = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    assert.equal(sniffContentType(unknown), 'application/octet-stream');
  });
});

// ── Truncated bytes ─────────────────────────────────────────────────────────

describe('sniffContentType — truncated inputs', () => {
  it('returns octet-stream for empty buffer', () => {
    assert.equal(sniffContentType(Buffer.alloc(0)), 'application/octet-stream');
  });

  it('returns octet-stream for 1-byte buffer', () => {
    assert.equal(sniffContentType(Buffer.from([0xff])), 'application/octet-stream');
  });

  it('returns octet-stream for truncated PNG (7 bytes)', () => {
    const truncated = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]);
    assert.equal(sniffContentType(truncated), 'application/octet-stream');
  });

  it('returns octet-stream for truncated WebP (11 bytes)', () => {
    const truncated = Buffer.alloc(11);
    truncated.write('RIFF', 0);
    truncated.write('WEB', 8);
    assert.equal(sniffContentType(truncated), 'application/octet-stream');
  });

  it('detects JPEG with minimum 3 bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    assert.equal(sniffContentType(jpeg), 'image/jpeg');
  });
});

// ── Uint8Array and nonzero byteOffset ───────────────────────────────────────

describe('sniffContentType — Uint8Array inputs', () => {
  it('accepts plain Uint8Array', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    assert.equal(sniffContentType(png), 'image/png');
  });

  it('handles Uint8Array with nonzero byteOffset (sliced view)', () => {
    const raw = new Uint8Array(20);
    raw[0] = 0xde; raw[1] = 0xad;
    raw[2] = 0x89; raw[3] = 0x50; raw[4] = 0x4e; raw[5] = 0x47;
    raw[6] = 0x0d; raw[7] = 0x0a; raw[8] = 0x1a; raw[9] = 0x0a;
    const slice = raw.subarray(2, 12);
    assert.equal(slice.byteOffset, 2, 'precondition: nonzero byteOffset');
    assert.equal(sniffContentType(slice), 'image/png');
  });

  it('handles WebP via Uint8Array with nonzero byteOffset', () => {
    const raw = new Uint8Array(32);
    raw[4] = 0x52; raw[5] = 0x49; raw[6] = 0x46; raw[7] = 0x46; // RIFF at offset 4
    raw[12] = 0x57; raw[13] = 0x45; raw[14] = 0x42; raw[15] = 0x50; // WEBP at offset 12
    const slice = raw.subarray(4, 20);
    assert.equal(slice.byteOffset, 4);
    assert.equal(sniffContentType(slice), 'image/webp');
  });

  it('accepts Buffer (which extends Uint8Array)', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    assert.equal(sniffContentType(jpeg), 'image/jpeg');
  });
});

// ── Adversarial / rejected inputs — graceful degradation ────────────────

describe('sniffContentType — runtime type guard (graceful)', () => {
  it('returns octet-stream for null', () => {
    assert.equal(
      sniffContentType(null as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for undefined', () => {
    assert.equal(
      sniffContentType(undefined as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for plain arrays', () => {
    assert.equal(
      sniffContentType([0x89, 0x50] as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for strings', () => {
    assert.equal(
      sniffContentType('RIFF....WEBP' as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for typed-array lookalike objects', () => {
    const fake = { buffer: new ArrayBuffer(8), byteOffset: 0, byteLength: 8, length: 8 };
    assert.equal(
      sniffContentType(fake as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for Object.create(Uint8Array.prototype)', () => {
    // Passes instanceof but is not a genuine typed array
    const fake = Object.create(Uint8Array.prototype);
    assert.equal(
      sniffContentType(fake as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for other typed array types (Int32Array)', () => {
    const int32 = new Int32Array([0x474e5089, 0x0a1a0a0d]);
    assert.equal(
      sniffContentType(int32 as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for Float64Array', () => {
    const f64 = new Float64Array(2);
    assert.equal(
      sniffContentType(f64 as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for Uint16Array', () => {
    const u16 = new Uint16Array(12);
    assert.equal(
      sniffContentType(u16 as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for DataView', () => {
    const dv = new DataView(new ArrayBuffer(12));
    assert.equal(
      sniffContentType(dv as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for numbers', () => {
    assert.equal(
      sniffContentType(42 as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for objects with misleading constructor', () => {
    const fake = Object.create(null);
    fake.buffer = new ArrayBuffer(4);
    fake.byteOffset = 0;
    fake.byteLength = 4;
    assert.equal(
      sniffContentType(fake as unknown as Uint8Array),
      'application/octet-stream',
    );
  });

  it('returns octet-stream for empty object', () => {
    assert.equal(
      sniffContentType({} as unknown as Uint8Array),
      'application/octet-stream',
    );
  });
});

// ── Helper functions ────────────────────────────────────────────────────────

describe('isWebp', () => {
  it('returns true for WebP', () => {
    const webp = Buffer.alloc(16);
    webp.write('RIFF', 0);
    webp.writeUInt32LE(100, 4);
    webp.write('WEBP', 8);
    assert.ok(isWebp(webp));
  });

  it('returns false for PNG', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    assert.ok(!isWebp(png));
  });
});

describe('isCacheableImage', () => {
  it('accepts webp, png, jpeg, gif', () => {
    assert.ok(isCacheableImage('image/webp'));
    assert.ok(isCacheableImage('image/png'));
    assert.ok(isCacheableImage('image/jpeg'));
    assert.ok(isCacheableImage('image/gif'));
  });

  it('rejects svg and octet-stream', () => {
    assert.ok(!isCacheableImage('image/svg+xml'));
    assert.ok(!isCacheableImage('application/octet-stream'));
  });
});
