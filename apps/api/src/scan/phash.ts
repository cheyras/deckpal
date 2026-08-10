import sharp from 'sharp';

/**
 * Perceptual hashing for the offline card scanner (Phase 8; reworked for the
 * 2026-07 "scanner is inconsistent" bug report, and again for the 2026-08 cloud
 * port — issue #20).
 *
 * Fully local, no ML model, no cloud: an image is decoded to a 72×64 grayscale
 * field, box-averaged down to a 9×8 grid, and turned into a 64-bit **dHash**
 * (one bit per horizontal neighbour comparison). dHash is cheap, deterministic,
 * and robust to scale, re-encode and uniform brightness — but NOT to rotation:
 * benchmarked on this Pi, a 4° phone tilt dropped top-1 accuracy from ~99% to
 * ~40% (8°: 6%). Phones are never perfectly square-on, so query-time hashing
 * probes a set of geometry corrections (background trim, counter-rotations,
 * keystone) and the matcher min-combines distances across all candidates.
 *
 * The 72×64 intermediate field exists so those geometric probes can be
 * resampled in pure JS at ~µs cost. CRITICAL INVARIANT: index-time and
 * query-time hashing share the exact same decode and the exact same JS
 * box-average resample — measured earlier, mixing IM's direct 9×8 Lanczos (old
 * index) with JS-resampled probes cost a 3–19 bit noise floor that swamped the
 * rotation correction. `ALGO` names this pipeline; changing either side means
 * bumping it and re-indexing.
 *
 * Decoding is **sharp** (libvips), not a shelled-out ImageMagick. The scanner
 * originally spawned `magick` to keep native addons out of the dependency tree;
 * that choice is what broke the hosted deployment — a serverless function has no
 * system ImageMagick, so every scan died with `spawn magick ENOENT` before it
 * ever reached the index (issue #20). sharp ships prebuilt binaries for the
 * platforms both deployments run on, so one pipeline now serves self-host and
 * cloud alike. Measured on this Pi over 300 cached cards, sharp's 72×64 field
 * differs from ImageMagick's by 0–9 bits (median 2) — far too much to reuse the
 * old index, which is why `ALGO` moved to `dhash8v3` and everything was
 * re-hashed. sharp is also ~8× faster (1.5 ms vs 12.3 ms per cached image).
 */

// The 64-bit dHash needs a (W+1)×H = 9×8 grayscale field: 8 horizontal
// comparisons per row × 8 rows = 64 bits.
const HASH_W = 9;
const HASH_H = 8;

// Probe field: 8×8 source pixels per hash cell.
const PROBE_W = HASH_W * 8; // 72
const PROBE_H = HASH_H * 8; // 64

// Aspect (w/h) of the frame a query field was squashed from. The client crops
// to the card guide (63:88 plus a proportional margin, same aspect); a real-
// space rotation must be conjugated by the frame→field squash to be applied on
// the 72×64 field.
const FRAME_ASPECT = 63 / 88;

// dHash over a 72×64 box-averaged field. "v3" is the sharp/libvips decode; "v2"
// rows were ImageMagick's 72×64 field and differ by a median of 2 bits, so they
// are NOT comparable. The indexer upserts over them (PK is (card_id, quality)),
// and the matcher filters on `algo`, so a half-migrated index can only ever
// under-report matches — never mis-report them.
export const ALGO = 'dhash8v3';

// Background trim, applied ONLY to a query photo (never to the index). It strips
// a roughly-uniform border — the table/mat/desk around a card that doesn't fill
// the phone frame — before the grid is sampled. Without it, a centred card
// surrounded by 25% background hashes almost entirely to the background gradient
// and matches nothing (measured: distance 37 → 4 once the border is trimmed).
// It is a QUERY-ONLY candidate, min-combined with the other probes (see
// hashQueryCandidates), so it can only ever help. `threshold` is the allowed
// deviation from the corner colour in 0–255 units; 38 ≈ ImageMagick's `-fuzz 15%`,
// the value the original benchmark was tuned at.
const TRIM_THRESHOLD = 38;

// Hard ceiling on decoded pixels. A 50 MP frame is far beyond any phone camera
// the client sends and bounds both memory and decode time in a serverless
// function; anything larger is rejected rather than silently resampled.
const MAX_INPUT_PIXELS = 50_000_000;

interface GrayInput {
  path?: string;
  buffer?: Buffer;
  /** Strip a uniform background border first (query-only preprocessing). */
  trim?: boolean;
}

/**
 * Decode an image (WebP path from the cache, or an uploaded buffer of any format
 * libvips understands) to the 72×64 probe field.
 *
 * `autoOrient` matters only for query photos: a phone writes the sensor's native
 * landscape pixels plus an EXIF rotation tag, and hashing the un-rotated pixels
 * of a portrait shot compares a sideways card against upright art — a guaranteed
 * miss that no rotation probe covers (they span ±12°). Cached card art carries no
 * EXIF, so this is a no-op on the index side and the two stay comparable.
 *
 * Rejects if the decoder fails or the output is the wrong size.
 */
export async function decodeGray(input: GrayInput): Promise<Uint8Array> {
  const src = input.buffer ?? (input.path as string);
  let pipeline = sharp(src, { autoOrient: true, limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
  if (input.trim) pipeline = pipeline.trim({ threshold: TRIM_THRESHOLD });
  const out = await pipeline
    .grayscale()
    .resize(PROBE_W, PROBE_H, { fit: 'fill' })
    .raw({ depth: 'uchar' })
    .toBuffer();
  const expected = PROBE_W * PROBE_H;
  if (out.length !== expected) {
    throw new Error(`decode produced ${out.length} bytes, expected ${expected}`);
  }
  return new Uint8Array(out);
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

// ── geometric resampling over the 72×64 field ────────────────────────────────

/** Bilinear sample with edge clamp from a row-major 8-bit field. */
function sampleBilinear(field: Uint8Array, fw: number, fh: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > fw - 1 ? fw - 1 : x;
  const cy = y < 0 ? 0 : y > fh - 1 ? fh - 1 : y;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = x0 + 1 < fw ? x0 + 1 : x0;
  const y1 = y0 + 1 < fh ? y0 + 1 : y0;
  const tx = cx - x0;
  const ty = cy - y0;
  const a = field[y0 * fw + x0]!;
  const b = field[y0 * fw + x1]!;
  const c = field[y1 * fw + x0]!;
  const d = field[y1 * fw + x1]!;
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** Maps normalized frame coords (u,v ∈ [0,1]) to source-field pixel coords. */
type ProbeTransform = (u: number, v: number) => readonly [number, number];

const IDENTITY: ProbeTransform = (u, v) => [PROBE_W * u, PROBE_H * v] as const;

/**
 * Resample a geometry-corrected 9×8 grid from the 72×64 field (each cell
 * box-averaged from a 4×4 bilinear supersample) and dHash it. With the
 * IDENTITY transform this IS the canonical hash pipeline — the indexer uses
 * exactly this, so a self-match stays at distance 0.
 */
export function dhashFromField(field: Uint8Array, t: ProbeTransform = IDENTITY): bigint {
  const SS = 4;
  const gray = new Uint8Array(HASH_W * HASH_H);
  for (let r = 0; r < HASH_H; r++) {
    for (let c = 0; c < HASH_W; c++) {
      let acc = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const u = (c + (i + 0.5) / SS) / HASH_W;
          const v = (r + (j + 0.5) / SS) / HASH_H;
          const [x, y] = t(u, v);
          acc += sampleBilinear(field, PROBE_W, PROBE_H, x, y);
        }
      }
      gray[r * HASH_W + c] = acc / (SS * SS);
    }
  }
  return dhashFromGray(gray);
}

/**
 * Counter-rotation by `deg` in REAL frame space for a WHOLE-FRAME field,
 * conjugated by the frame→field squash (a rotation of a 63:88 portrait frame
 * becomes shear+rotate once resized to 72×64). Optional `zoom` < 1 samples a
 * centred sub-window first — used to probe the guide region of a margin-
 * expanded client capture when the background trim fails.
 */
export function frameRotation(deg: number, zoom = 1): ProbeTransform {
  const th = (deg * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const a = FRAME_ASPECT;
  return (u, v) => {
    const du = (u - 0.5) * zoom;
    const dv = (v - 0.5) * zoom;
    const x = PROBE_W * (0.5 + du * cos + (dv / a) * sin);
    const y = PROBE_H * (0.5 - du * a * sin + dv * cos);
    return [x, y] as const;
  };
}

/**
 * Exact un-rotation for a TRIMMED field: `-trim` on a card photographed at a
 * small tilt yields the card's rotated BOUNDING BOX, ~5–15% larger than the
 * card with background wedges in the corners. Knowing the card aspect (63:88),
 * the card's corners inside that box are fully determined by the angle, so this
 * both rotates AND zooms past the bbox margin. Benchmarked: this is what
 * recovers an 8°-tilted card to near-clean distance; a plain conjugated
 * rotation of the bbox does not.
 */
export function bboxRotation(deg: number): ProbeTransform {
  const th = (deg * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const w = 63;
  const h = 88;
  const W = w * Math.abs(cos) + h * Math.abs(sin);
  const H = w * Math.abs(sin) + h * Math.abs(cos);
  return (u, v) => {
    const X = (u - 0.5) * w * cos - (v - 0.5) * h * sin;
    const Y = (u - 0.5) * w * sin + (v - 0.5) * h * cos;
    return [PROBE_W * (0.5 + X / W), PROBE_H * (0.5 + Y / H)] as const;
  };
}

/**
 * Mild keystone (perspective tilt): `f` > 0 assumes the photographed card's TOP
 * edge is squeezed (camera above the card, tilted) — the probe samples a
 * correspondingly narrower strip near the top to undo it; `f` < 0 the bottom.
 * A real tilt also foreshortens vertically toward the squeezed edge, so the
 * vertical sampling is quadratically compressed the same way (measured on the
 * benchmark: coupling roughly halves the persp-scene distance vs. a pure
 * horizontal squeeze).
 */
export function keystone(f: number): ProbeTransform {
  const fv = Math.abs(f) / 2;
  return (u, v) => {
    const s = f >= 0 ? 1 - f * (1 - v) : 1 + f * v;
    const vv = f >= 0 ? v * (1 - fv) + fv * v * v : 1 - ((1 - v) * (1 - fv) + fv * (1 - v) * (1 - v));
    const x = PROBE_W * (0.5 + (u - 0.5) * s);
    const y = PROBE_H * vv;
    return [x, y] as const;
  };
}

// ── canonical hashing (index + query entrypoints) ────────────────────────────

/** Canonical hash of an image file — used by the indexer. */
export async function hashPath(path: string): Promise<bigint> {
  return dhashFromField(await decodeGray({ path }));
}

/** Canonical hash of an image buffer (whole frame, no probes). */
export async function hashBuffer(buffer: Buffer): Promise<bigint> {
  return dhashFromField(await decodeGray({ buffer }));
}

// Probe schedule. Angles cover realistic phone tilt at ≤2° residual (each 1°
// of residual costs only a couple of bits now that index and probes share one
// pipeline); keystones cover a typical off-axis shot. The client capture adds
// ~7% margin around the guide, so GUIDE_ZOOM re-probes exactly the guide
// region for backgrounds too busy for `-trim` to find the card's edges.
const ROTATION_DEGS = [-12, -10, -8, -6, -4, -2, 2, 4, 6, 8, 10, 12];
const KEYSTONE_FS = [-0.1, -0.05, 0.05, 0.1];
const GUIDE_ZOOM = 1 / 1.14;

/**
 * Query-time hashing that is robust to how a phone actually frames a card.
 * Returns candidate hashes for the SAME uploaded image:
 *   • whole-frame hash — identical pipeline to the index, so a full-bleed
 *     image of catalog art still self-matches at distance 0;
 *   • background-trimmed hash + bbox-aware counter-rotations (±2–12°) and
 *     keystone probes — the main path for a real phone shot: trim finds the
 *     card in the frame, the rotation probes undo tilt (the benchmarked
 *     dominant failure: 4° tilt took top-1 from ~99% to ~40%);
 *   • whole-frame counter-rotations and guide-zoom probes — backstops for
 *     full-bleed captures and for backgrounds the trim can't separate.
 * The matcher scores each catalog entry by the MINIMUM distance across all
 * candidates, so every probe is purely additive: it can rescue a match but
 * never push a clean card away. Probe decode failures degrade gracefully to
 * whatever candidates did decode; index-time hashing is untouched.
 */
export async function hashQueryCandidates(buffer: Buffer): Promise<bigint[]> {
  const [plainField, trimmedField] = await Promise.all([
    decodeGray({ buffer }),
    // libvips throws "Image is entirely blank" when the trim eats the whole
    // frame (a photo of a bare table). That is a probe that did not apply, not
    // an error — the plain field and its rotations still stand.
    decodeGray({ buffer, trim: true }).catch(() => null),
  ]);

  const seen = new Set<bigint>();
  const out: bigint[] = [];
  const push = (h: bigint): void => {
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  };

  push(dhashFromField(plainField)); // [0] — always the whole-frame hash, reported to the client
  if (trimmedField) {
    push(dhashFromField(trimmedField));
    for (const deg of ROTATION_DEGS) push(dhashFromField(trimmedField, bboxRotation(deg)));
    for (const f of KEYSTONE_FS) push(dhashFromField(trimmedField, keystone(f)));
  }
  for (const deg of ROTATION_DEGS) push(dhashFromField(plainField, frameRotation(deg)));
  push(dhashFromField(plainField, frameRotation(0, GUIDE_ZOOM)));
  for (const deg of [-8, -4, 4, 8]) push(dhashFromField(plainField, frameRotation(deg, GUIDE_ZOOM)));
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
