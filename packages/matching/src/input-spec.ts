// THE EMBED INPUT SPEC — the one description of what the identity model looks at.
//
// ── WHY THERE IS EXACTLY ONE ─────────────────────────────────────────────────
//
// Owner ruling, 2026-09-04 (PLAN.md, "MATCHING ARCHITECTURE RULING"): identity
// comes from an on-device embedding compared against catalog vectors in
// pgvector. That only works if the two sides agree to the bit about what an
// image IS. A catalog vector is computed once, months before the scan it will
// be compared against, on a different machine, in a different language, from a
// different source image. If the phone resizes with a smoothed `drawImage` and
// the catalog job resizes with libvips' Lanczos, the two vectors are answers to
// two different questions and the cosine between them is noise dressed as a
// score.
//
// So: ONE spec, versioned, with a bit-parity test between the TypeScript and
// Python implementations (`__tests__/parity.test.ts` and
// `python/tests/test_parity.py` both check the same committed golden digest).
//
// ── WHAT THIS MODULE DELIBERATELY DOES NOT OWN ───────────────────────────────
//
// The DETECTOR's canonical frame. `apps/web/src/scan/engine/frame.ts` owns
// `PIPELINE_VERSION` and `CANONICAL_SIZE`, and this module does not import,
// re-export or copy them — a second declaration of a version number is how two
// pipelines start disagreeing about which one they are. Where a caller needs
// both facts on one row (a scan exemplar, whose crop geometry really does
// depend on the detector), it passes the detector's number in and this module
// only formats it: `frameStamp()`. `__tests__/input-spec.test.ts` asserts the
// number itself appears nowhere in this file.
//
// The reason a CATALOG vector carries no frame version is that a catalog render
// never went through a camera. Stamping it with the detector's version would be
// a claim about provenance that is simply false.
//
// ── THE SQUASH IS INTENTIONAL, AND IT IS WHY THE MARGIN CROP EXISTS ──────────
//
// The model input is square; a Pokémon card is 63:88. The spec resizes the WHOLE
// card into the square — a non-uniform squash — rather than letterboxing or
// centre-cropping. Two reasons, one measured:
//
//   * Measured (p2-work/embed-spike, 2026-09-04): timm's stock eval transform
//     (resize short side, then centre-crop) scores 4/10 top-5 on the 19-frame
//     ground truth; a plain squash of the same model scores 7/10. The centre
//     crop throws away the name bar and the set/number strip — the two most
//     identity-bearing bands on the card.
//   * Structural: both sides squash by the SAME rule, so the distortion is
//     shared and cancels in the comparison. A letterbox would spend a fifth of
//     the model's input on grey bars instead.
//
// The squash only cancels if both sides show the same THING, which is what
// `marginFrac` is for. A live capture deliberately includes background beyond
// the card (`rectify.ts` CAPTURE_MARGIN = 0.05 per side, because a hash cannot
// recover a name bar that was never in the JPEG). A catalog render has none. So
// the spec takes the margin as a parameter and crops it back off before the
// squash: the capture path passes CAPTURE_MARGIN, the catalog path passes 0,
// and both hand the model the card and nothing else.
//
// ── WHY THE RESAMPLER IS AN EXACT BOX FILTER ─────────────────────────────────
//
// It has to be reproducible in two languages, bit for bit, and it has to survive
// a ~2.7x downscale (436 px of card width into 224) without aliasing the fine
// print into noise. Nearest-neighbour is reproducible and aliases badly.
// Bicubic/Lanczos are neither reproducible across libvips, PIL, canvas and a
// hand-rolled kernel, nor agreed upon about edge handling.
//
// An area-average — each output pixel is the mean of the source pixels its
// footprint covers, weighted by the overlap — is the exact operation both sides
// can spell identically: IEEE-754 float64 add and multiply are correctly
// rounded, so the same operations in the same ORDER give the same bits in
// JavaScript and in CPython. The loops below fix that order and the Python
// reference mirrors it statement for statement. It is also the right filter for
// a pure downscale on its own merits.
//
// Everything here is pure and allocation-explicit. No DOM, no Buffer, no numpy.

/**
 * Bumped whenever anything below changes what tensor a given image produces:
 * the size, the crop rule, the resampler, the channel order, the
 * normalisation. A stored vector records this (see `embedStamp`), so a bump
 * makes old vectors *visibly* stale instead of silently incomparable.
 *
 *   1  square box-filter squash, RGB, CLIP normalisation, 224 (this file)
 */
export const EMBED_SPEC_VERSION = 1

/**
 * The model input's side, in pixels.
 *
 * 224 is what every candidate in the 2026-09-04 bakeoff wanted, winner
 * included, and it is the size their pretrained position embeddings were
 * learned at — a ViT run at another resolution needs its position grid
 * interpolated, which is a different model in all but name. It is also the
 * cheapest square that holds a readable card: at 224 the collector number is
 * ~4 px tall, and the retrieval does not depend on reading it.
 */
export const EMBED_SIZE = 224

/**
 * Channel-mean and standard deviation, in the 0..1 domain, applied per channel
 * after the divide by 255.
 *
 * These are OpenAI CLIP's, which is not an arbitrary choice: they are the
 * statistics the winning checkpoint's weights were fitted against, and feeding
 * a model ImageNet's numbers instead is exactly the failure that cost phase 0b
 * session 1 (see `apps/web/src/scan/engine/preprocess.ts` — a mismatched tensor
 * read on-device as "the model is awful" when the model was never being fed).
 * They are transcribed from the checkpoint's own preprocessing config, and
 * `__tests__/input-spec.test.ts` pins them so a copy-paste drift is a failing
 * test rather than a slow-moving accuracy loss.
 */
export const EMBED_MEAN: readonly [number, number, number] = [0.48145466, 0.4578275, 0.40821073]
export const EMBED_STD: readonly [number, number, number] = [0.26862954, 0.26130258, 0.27577711]

/** The identity model this build embeds with. Part of every stored vector's
 *  stamp, because a vector from another checkpoint is not comparable even at
 *  the same spec version. Slug, not a file path: the ONNX asset can be renamed
 *  or re-quantised without invalidating a catalog. */
export const EMBED_MODEL_ID = 'vitamin-small-datacomp1b'

/** Dimensionality of the produced embedding. Migration 048 declares
 *  `vector(384)` against this number and cites it; `__tests__/confidence.test.ts`
 *  is where a change to one without the other stops being quiet. A checkpoint
 *  with a different width is a new column type, a new migration, and a full
 *  re-embed — which is the honest cost, since it is also a different vector
 *  space in which none of the old rows mean anything. */
export const EMBED_DIM = 384

/** A plain RGBA image, in the shape every producer already has: a rectified
 *  card from `rectify.ts`, an `ImageData`, or a decoded catalog webp. */
export interface RgbaImage {
  width: number
  height: number
  /** Row-major RGBA bytes, length `width * height * 4`. */
  data: Uint8ClampedArray | Uint8Array
}

export interface EmbedInputOptions {
  /**
   * Background included beyond the card on EACH side, as a fraction of the
   * card's own dimension — the same number `rectify.ts` warps with. A capture
   * passes `CAPTURE_MARGIN`; a catalog render passes 0 (the default).
   */
  marginFrac?: number
  /** Output side. Only overridden by tests; production is `EMBED_SIZE`. */
  size?: number
}

/** The source rectangle the model actually sees, after the margin is removed.
 *  Exported so a caller can draw the same box for a verification overlay
 *  instead of re-deriving it and drifting. */
export function cardRect(
  width: number,
  height: number,
  marginFrac = 0,
): { x: number; y: number; w: number; h: number } {
  if (marginFrac <= 0) return { x: 0, y: 0, w: width, h: height }
  // The rectified buffer holds (1 + 2m) card-widths across, so the card is
  // 1/(1+2m) of it, centred. Rounded to whole pixels, then clamped so a silly
  // margin cannot produce an empty rect.
  const fx = Math.round((width * marginFrac) / (1 + 2 * marginFrac))
  const fy = Math.round((height * marginFrac) / (1 + 2 * marginFrac))
  const w = Math.max(1, width - 2 * fx)
  const h = Math.max(1, height - 2 * fy)
  return { x: Math.min(fx, width - 1), y: Math.min(fy, height - 1), w, h }
}

/**
 * THE SPEC. Rectified card RGBA -> the NCHW float32 tensor the identity model
 * takes: 1 x 3 x size x size, RGB planar, mean/std normalised.
 *
 * Returns a FRESH Float32Array every call. ORT with `env.wasm.proxy = true`
 * transfers a tensor's backing buffer to its proxy worker and detaches it here,
 * so a reused scratch buffer throws `DataCloneError` on the second inference —
 * the same trap `preprocess.rgbaToBGRPlanar` documents. Do not "optimise" this
 * into a shared buffer.
 *
 * RGB, not BGR. The detector's LC050 wants BGR and says so loudly; this model
 * wants RGB, and the two living side by side in one app is precisely why each
 * states its order in its own module instead of relying on a house convention.
 */
export function embedInput(img: RgbaImage, opts: EmbedInputOptions = {}): Float32Array {
  const size = opts.size ?? EMBED_SIZE
  const rect = cardRect(img.width, img.height, opts.marginFrac ?? 0)
  const plane = size * size
  const out = new Float32Array(3 * plane)
  const src = img.data
  const srcW = img.width

  // Area-average box filter. The loop order below IS the specification: output
  // row, output column, source row, source column, each ascending, with the
  // three channel accumulators advanced together. Python's reference repeats it
  // statement for statement so the float64 rounding sequence is identical.
  for (let oy = 0; oy < size; oy++) {
    const y0 = (oy * rect.h) / size + rect.y
    const y1 = ((oy + 1) * rect.h) / size + rect.y
    const iy0 = Math.floor(y0)
    const iy1 = Math.max(iy0 + 1, Math.ceil(y1))
    for (let ox = 0; ox < size; ox++) {
      const x0 = (ox * rect.w) / size + rect.x
      const x1 = ((ox + 1) * rect.w) / size + rect.x
      const ix0 = Math.floor(x0)
      const ix1 = Math.max(ix0 + 1, Math.ceil(x1))
      let ar = 0
      let ag = 0
      let ab = 0
      let wsum = 0
      for (let iy = iy0; iy < iy1; iy++) {
        const wy = Math.min(iy + 1, y1) - Math.max(iy, y0)
        if (wy <= 0) continue
        const row = iy * srcW
        for (let ix = ix0; ix < ix1; ix++) {
          const wx = Math.min(ix + 1, x1) - Math.max(ix, x0)
          if (wx <= 0) continue
          const w = wy * wx
          const o = (row + ix) * 4
          ar += w * (src[o] as number)
          ag += w * (src[o + 1] as number)
          ab += w * (src[o + 2] as number)
          wsum += w
        }
      }
      const o = oy * size + ox
      out[o] = (ar / wsum / 255 - EMBED_MEAN[0]) / EMBED_STD[0]
      out[plane + o] = (ag / wsum / 255 - EMBED_MEAN[1]) / EMBED_STD[1]
      out[2 * plane + o] = (ab / wsum / 255 - EMBED_MEAN[2]) / EMBED_STD[2]
    }
  }
  return out
}

/** L2-normalise in place and return the same array. Cosine similarity is a dot
 *  product only if both sides are unit length, and pgvector's `<=>` is cosine
 *  DISTANCE — normalising at write time makes the index's inner-product
 *  operator legal too, and makes a stored vector's scale one less thing that
 *  can differ between the two producers. */
export function l2Normalize(v: Float32Array): Float32Array {
  let s = 0
  for (let i = 0; i < v.length; i++) s += (v[i] as number) * (v[i] as number)
  const n = Math.sqrt(s)
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] = (v[i] as number) / n
  return v
}

/**
 * The stamp every stored vector carries: which input spec and which checkpoint
 * produced it. `e1:clip-vit-b32-openai`.
 *
 * Compared as an exact string, never parsed for ordering — a vector either was
 * produced by the running configuration or it was not, and "close enough"
 * is not a thing two embeddings can be.
 */
export function embedStamp(modelId: string = EMBED_MODEL_ID): string {
  return `e${EMBED_SPEC_VERSION}:${modelId}`
}

/**
 * The DETECTOR's frame version, formatted for storage alongside an exemplar.
 * The number is NOT declared here: `apps/web/src/scan/engine/frame.ts` owns it
 * and the caller passes it in. See this file's header.
 */
export function frameStamp(framePipelineVersion: number): string {
  return `p${framePipelineVersion}`
}
