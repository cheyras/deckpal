import { spawn } from 'node:child_process';

/**
 * Perceptual hashing for the offline card scanner (Phase 8).
 *
 * Fully local, no ML model, no cloud: we decode a card image down to a tiny
 * 9×8 grayscale gradient and compute a 64-bit **dHash** (difference hash) — a
 * bit per horizontal neighbour comparison. dHash is cheap, deterministic, and
 * robust to scale, mild crop, re-encode and uniform brightness — exactly the
 * distortions between our cached art and a phone photo of the same card.
 *
 * Decoding is delegated to system **ImageMagick** (`magick`/`convert`, built
 * with libwebp), which does decode + grayscale + resize in one native call. No
 * native node addon (no `sharp`/libvips) is pulled in — see scan/README notes.
 * The identical pipeline is used both to index cached WebP art and to hash an
 * uploaded query image, so index-time and query-time hashes are comparable.
 */

// The 64-bit dHash needs a (W+1)×H = 9×8 grayscale field: 8 horizontal
// comparisons per row × 8 rows = 64 bits.
const HASH_W = 9;
const HASH_H = 8;
const GRAY_BYTES = HASH_W * HASH_H; // 72

export const ALGO = 'dhash8';

// ImageMagick v7 ships `magick`; `convert` is the v6-compat entry. Either works
// with the arg vector below. Overridable for odd installs.
const IM_BIN = process.env.IMAGEMAGICK_BIN ?? 'magick';

// The decode pipeline, shared by path and buffer inputs. `INPUT` is replaced by
// a file path or `-` (stdin). Output is raw 8-bit gray, row-major, 72 bytes.
function imArgs(input: string): string[] {
  return [input, '-colorspace', 'Gray', '-resize', '9x8!', '-depth', '8', 'gray:-'];
}

interface GrayInput {
  path?: string;
  buffer?: Buffer;
}

/**
 * Decode an image (WebP path from the cache, or an uploaded buffer of any
 * format ImageMagick understands) to the 72-byte 9×8 grayscale field.
 * Rejects if the decoder exits non-zero or the output is the wrong size.
 */
export function decodeGray(input: GrayInput): Promise<Uint8Array> {
  const fromStdin = input.buffer !== undefined;
  const args = imArgs(fromStdin ? '-' : (input.path as string));
  return new Promise((resolve, reject) => {
    const cp = spawn(IM_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let err = '';
    cp.stdout.on('data', (d: Buffer) => chunks.push(d));
    cp.stderr.on('data', (d: Buffer) => {
      if (err.length < 2000) err += d.toString();
    });
    cp.on('error', (e) => reject(new Error(`imagemagick spawn failed (${IM_BIN}): ${e.message}`)));
    cp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`imagemagick exited ${code}: ${err.trim().slice(0, 300)}`));
        return;
      }
      const out = Buffer.concat(chunks);
      if (out.length !== GRAY_BYTES) {
        reject(new Error(`decode produced ${out.length} bytes, expected ${GRAY_BYTES}`));
        return;
      }
      resolve(new Uint8Array(out));
    });
    if (fromStdin) {
      cp.stdin.on('error', () => {
        /* EPIPE if IM rejects the input before draining stdin; the close/stderr
           handler surfaces the real reason. */
      });
      cp.stdin.write(input.buffer as Buffer);
      cp.stdin.end();
    }
  });
}

/** dHash over a 9×8 grayscale field → 64-bit hash as a bigint (MSB first). */
export function dhashFromGray(gray: Uint8Array): bigint {
  let h = 0n;
  for (let r = 0; r < HASH_H; r++) {
    const row = r * HASH_W;
    for (let c = 0; c < HASH_W - 1; c++) {
      const bit = gray[row + c]! < gray[row + c + 1]! ? 1n : 0n;
      h = (h << 1n) | bit;
    }
  }
  return h;
}

export async function hashPath(path: string): Promise<bigint> {
  return dhashFromGray(await decodeGray({ path }));
}

export async function hashBuffer(buffer: Buffer): Promise<bigint> {
  return dhashFromGray(await decodeGray({ buffer }));
}

// ── bigint ⇄ 8-byte big-endian bytea (how the hash persists) ─────────────────

export function hashToBytes(h: bigint): Buffer {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(BigInt.asUintN(64, h));
  return buf;
}

export function bytesToHash(buf: Buffer): bigint {
  return buf.readBigUInt64BE();
}

export function hashToHex(h: bigint): string {
  return BigInt.asUintN(64, h).toString(16).padStart(16, '0');
}

/** Hamming distance between two 64-bit hashes (number of differing bits, 0–64). */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    x &= x - 1n; // clear lowest set bit
    n++;
  }
  return n;
}
