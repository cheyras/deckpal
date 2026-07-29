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

// Background-trim ops, applied ONLY to a query photo (never to the index).
// `-fuzz N% -trim` strips a roughly-uniform border — the table/mat/desk around a
// card that doesn't fill the phone frame — before the grid is sampled. Without
// it, a centred card surrounded by 25% background hashes almost entirely to the
// background gradient and matches nothing (measured: distance 37 → 4 once the
// border is trimmed). It is a QUERY-ONLY candidate, min-combined with the plain
// hash (see hashQueryCandidates), so it can only ever help: a full-bleed modern
// card or a white/yellow-bordered vintage card still matches via the plain hash
// at distance 0, even though trimming would shift its own border by several bits.
const TRIM_OPS = ['-fuzz', '15%', '-trim', '+repage'];

// The decode pipeline, shared by path and buffer inputs. `input` is a file path
// or `-` (stdin). `pre` are extra ops that run BEFORE grayscale+resize (e.g. a
// background trim for query photos). Output is raw 8-bit gray, row-major, 72 B.
function imArgs(input: string, pre: string[]): string[] {
  return [input, ...pre, '-colorspace', 'Gray', '-resize', '9x8!', '-depth', '8', 'gray:-'];
}

interface GrayInput {
  path?: string;
  buffer?: Buffer;
  /** Extra ImageMagick ops before grayscale+resize (query-only preprocessing). */
  pre?: string[];
}

/**
 * Decode an image (WebP path from the cache, or an uploaded buffer of any
 * format ImageMagick understands) to the 72-byte 9×8 grayscale field.
 * Rejects if the decoder exits non-zero or the output is the wrong size.
 */
export function decodeGray(input: GrayInput): Promise<Uint8Array> {
  const fromStdin = input.buffer !== undefined;
  const args = imArgs(fromStdin ? '-' : (input.path as string), input.pre ?? []);
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

/**
 * Query-time hashing that is robust to a photographed card sitting inside a
 * background. Returns up to two candidate hashes for the SAME uploaded image:
 *   [0] whole-frame dHash — matches full-bleed catalog art and client-cropped
 *       frames, and re-finds vintage bordered cards at distance 0.
 *   [1] background-trimmed dHash — rescues photos where the card doesn't fill
 *       the frame (a phone shot with table/mat around it).
 * The caller scores each catalog entry by the MINIMUM distance across these
 * candidates, so trimming is purely additive: it can rescue a match but never
 * push a clean card away (its plain hash is always still in the running). If the
 * trim step fails (e.g. a perfectly uniform image collapses to nothing), only
 * the plain hash is returned — the query still succeeds.
 */
export async function hashQueryCandidates(buffer: Buffer): Promise<bigint[]> {
  const out: bigint[] = [dhashFromGray(await decodeGray({ buffer }))];
  try {
    const trimmed = dhashFromGray(await decodeGray({ buffer, pre: TRIM_OPS }));
    if (trimmed !== out[0]) out.push(trimmed);
  } catch {
    /* trim can fail on a degenerate (uniform) image; the plain hash stands. */
  }
  return out;
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
