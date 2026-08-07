// foil/generator.ts — THE MASK GENERATOR CONTRACT (+ a reference generator).
//
// Chey's loop: hand-paint a few masks → an AI learns from them and proposes
// masks for similar cards → he corrects the proposals → the corrections train
// the next generation. This file is the seam a real generator drops into.
//
// A generator is a pure-ish function:
//
//        MaskGeneratorInput  ──▶  MaskGenerator  ──▶  MaskGeneratorOutput
//
// It NEVER writes files. `runGenerator()` (generate-masks.ts) persists the
// output through provenance.writeMaskRecord with the generator identity, which
// is the only way a mask can legally be stamped `ai`. Consequences that are
// structural, not conventions:
//   - every generated mask is `ai` / unreviewed until a human touches it;
//   - every generated mask carries name+version+runId+params+exemplars;
//   - the exemplars it received came from selectExemplars(), which refuses to
//     hand over unreviewed `ai` masks — so no generation can train on itself.
//
// WHAT A GENERATOR CONSUMES (all of it supplied, none of it fetched by hand):
//   target.artwork      decoded RGBA of the card scan from the image cache
//   target.rect/radius  the deterministic era-layout window for this card
//                       (+ target.window when a human adjusted the geometry)
//   target.eraId/scope  the layout family and foil zone class
//   exemplars[]         human masks for the SAME era+scope, each with its own
//                       decoded artwork + mask alpha + rule rect + weight
//
// WHAT IT EMITS, per target:
//   alpha               Uint8Array width*height, 0..255, alpha IS the mask
//   confidence          0..1, or null if the generator honestly has none
//   params              whatever reproduces the run (recorded verbatim)
//   notes               free text for the reviewer (why it did what it did)

import type { RgbaImage } from './png.js';
import type { ExemplarRef } from './provenance.js';

export interface GeneratorTarget {
  cardId: string;
  variantId: number;
  eraId: string;
  scope: 'window' | 'sheet' | 'full' | 'none';
  /** Deterministic era rect, UV y-up [x,y,w,h]. */
  rect: [number, number, number, number];
  radius: number;
  invert: boolean;
  /** Human-adjusted window geometry for this card, when one exists. */
  window: { rect: [number, number, number, number]; radius: number } | null;
  /** The card scan, decoded at mask resolution (width×height below). */
  artwork: RgbaImage;
  artworkUrl: string | null;
  width: number;
  height: number;
  setId: string | null;
  seriesSlug: string | null;
}

export interface GeneratorExemplar {
  ref: ExemplarRef;
  /** The human mask's alpha, resampled to the target's width×height. */
  alpha: Uint8Array;
  /** The exemplar card's scan at the same resolution (may be null if uncached). */
  artwork: RgbaImage | null;
  /** The era rect the exemplar was drawn against. */
  rect: [number, number, number, number];
  scope: string;
  eraId: string;
}

export interface MaskGeneratorInput {
  target: GeneratorTarget;
  /** Human ground truth for this era+scope. NEVER contains unreviewed `ai` masks. */
  exemplars: GeneratorExemplar[];
}

export interface MaskGeneratorOutput {
  /** width*height alpha, 0..255. Alpha IS the mask (>=128 = foil). */
  alpha: Uint8Array;
  /** 0..1, or null when the generator emits no calibrated confidence. */
  confidence: number | null;
  notes: string;
}

export interface MaskGenerator {
  /** Stable id recorded on every mask it makes. */
  name: string;
  /** Bump when behavior changes meaning. */
  version: number;
  /** Model id when a model is involved; null for classical CV. */
  modelId: string | null;
  /** Reproduction params, recorded verbatim in the sidecar. */
  params: Record<string, number | string | boolean>;
  /** Minimum human exemplars before this generator will run at all. */
  minExemplars: number;
  generate(input: MaskGeneratorInput): MaskGeneratorOutput;
}

// ── Reference generator: window ∩ art-gate ─────────────────────────────────
//
// STATUS: reference implementation, deliberately simple, NOT a good mask
// generator. It exists so the loop is executable end to end and so a real
// generator has a working shape to copy. Its whole idea:
//
//   coverage = inside the (adjusted) window rect  AND  the scan is dark there
//
// i.e. the shader's `uArtGate` luminance idea baked into pixels, with the
// luminance threshold FIT to the human exemplars rather than guessed: for each
// exemplar we measure the mean luminance of the pixels the human KEPT vs the
// pixels the human ERASED inside the window, and take the midpoint (weighted
// by exemplar weight). That is a genuine, if crude, use of the corpus.
//
// Its honest limitation is stated in the notes it emits: WOTC "window minus
// subject silhouette" is a SEGMENTATION problem; a global luminance threshold
// approximates it only where the subject is uniformly brighter than the
// background, which is not generally true. See DECISIONS 2026-08-07.

const FOIL = 128;

function luma(img: RgbaImage, i: number): number {
  return 0.2126 * img.rgba[i * 4]! + 0.7152 * img.rgba[i * 4 + 1]! + 0.0722 * img.rgba[i * 4 + 2]!;
}

/** Rounded-rect coverage in the same space/AA as rasterizePriorAlpha. */
export function rectCoverage(
  width: number,
  height: number,
  rect: [number, number, number, number],
  radius: number,
  invert: boolean,
): Uint8Array {
  const [rx, ryUp, rw, rh] = rect;
  const px = rx * width;
  const py = (1 - ryUp - rh) * height;
  const pw = rw * width;
  const ph = rh * height;
  const rad = Math.min(radius * width, pw / 2, ph / 2);
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  const hw = pw / 2;
  const hh = ph / 2;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const qx = Math.abs(x + 0.5 - cx) - hw + rad;
      const qy = Math.abs(y + 0.5 - cy) - hh + rad;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
      let cov = Math.min(1, Math.max(0, 0.5 - d));
      if (invert) cov = 1 - cov;
      out[y * width + x] = Math.round(cov * 255);
    }
  }
  return out;
}

/**
 * Fit the luminance threshold from the exemplars: midpoint between the mean
 * luminance of KEPT foil pixels and ERASED pixels, inside each exemplar's own
 * window rect, weighted by exemplar weight. Returns null when the corpus gives
 * no usable signal (then the generator must not run).
 */
export function fitArtGate(exemplars: GeneratorExemplar[]): { threshold: number; separation: number } | null {
  let keptSum = 0;
  let keptW = 0;
  let erasedSum = 0;
  let erasedW = 0;
  for (const ex of exemplars) {
    if (!ex.artwork) continue;
    const { width, height } = ex.artwork;
    if (ex.alpha.length !== width * height) continue;
    const inWindow = rectCoverage(width, height, ex.rect, 0, ex.scope === 'sheet');
    for (let i = 0; i < ex.alpha.length; i++) {
      if (inWindow[i]! < FOIL) continue;
      const l = luma(ex.artwork, i);
      if (ex.alpha[i]! >= FOIL) {
        keptSum += l * ex.ref.weight;
        keptW += ex.ref.weight;
      } else {
        erasedSum += l * ex.ref.weight;
        erasedW += ex.ref.weight;
      }
    }
  }
  if (keptW === 0 || erasedW === 0) return null;
  const kept = keptSum / keptW;
  const erased = erasedSum / erasedW;
  // The human keeps foil on the DARKER background and erases the brighter
  // subject — if the corpus says otherwise, the assumption is wrong here.
  if (erased <= kept) return null;
  return { threshold: (kept + erased) / 2, separation: Number((erased - kept).toFixed(2)) };
}

export const windowArtGateGenerator: MaskGenerator = {
  name: 'window-artgate',
  version: 1,
  modelId: null,
  params: { gate: 'exemplar-fit-luminance', feather: 0 },
  minExemplars: 2,
  generate({ target, exemplars }): MaskGeneratorOutput {
    const { width, height } = target;
    const geom = target.window ?? { rect: target.rect, radius: target.radius };
    const inWindow = rectCoverage(width, height, geom.rect, geom.radius, target.invert);
    const fit = fitArtGate(exemplars);
    if (!fit) {
      return {
        alpha: inWindow,
        confidence: null,
        notes:
          'No usable luminance separation in the exemplars — fell back to the plain window rect. ' +
          'This proposal adds NOTHING over the layout tier; review accordingly.',
      };
    }
    const alpha = new Uint8Array(width * height);
    let gated = 0;
    let inside = 0;
    for (let i = 0; i < alpha.length; i++) {
      if (inWindow[i]! < FOIL) continue;
      inside++;
      if (luma(target.artwork, i) < fit.threshold) {
        alpha[i] = inWindow[i]!;
        gated++;
      }
    }
    // Confidence is deliberately crude and deliberately LOW: it reports how
    // separable the exemplars were, capped hard, because n is tiny. A real
    // generator should replace this with something calibrated.
    const confidence = Number(Math.min(0.5, fit.separation / 200).toFixed(3));
    return {
      alpha,
      confidence,
      notes:
        `luminance gate fit from ${exemplars.length} human exemplar(s): threshold ${fit.threshold.toFixed(1)}, ` +
        `kept/erased separation ${fit.separation}. Kept ${gated}/${inside} in-window px. ` +
        'Crude global threshold — it approximates "window minus subject" only where the subject is brighter than the background.',
    };
  },
};

export const GENERATORS: Record<string, MaskGenerator> = {
  [windowArtGateGenerator.name]: windowArtGateGenerator,
};
