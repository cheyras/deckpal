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
import type { DerivationMethod, ExemplarRef } from './provenance.js';
import { DEFAULT_STRAIGHTEN_PARAMS, straightenMask, type SegmentReport } from './line-snap.js';

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

/**
 * The mask already at the target path, when a generator REFINES rather than
 * proposes from scratch (`generate-masks.ts run --refine`). Always
 * human-authored: `run --refine` refuses a source whose exemplar weight is 0,
 * so a refiner can never compound its own unreviewed output.
 */
export interface GeneratorSource {
  ref: ExemplarRef & { sha256: string };
  /** The existing mask's alpha at the target's width×height. Alpha IS the mask. */
  alpha: Uint8Array;
  /** Its full RGBA (tint + antialiasing character), for generators that match it. */
  image: RgbaImage;
  /** Its own derivation method, so a generator can refuse the wrong kind of input. */
  method: DerivationMethod;
}

export interface MaskGeneratorInput {
  target: GeneratorTarget;
  /** Human ground truth for this era+scope. NEVER contains unreviewed `ai` masks. */
  exemplars: GeneratorExemplar[];
  /** Present only in refine mode; null when the generator proposes from scratch. */
  source?: GeneratorSource | null;
}

export interface MaskGeneratorOutput {
  /** width*height alpha, 0..255. Alpha IS the mask (>=128 = foil). */
  alpha: Uint8Array;
  /** 0..1, or null when the generator emits no calibrated confidence. */
  confidence: number | null;
  notes: string;
  /**
   * Optional structured account of what it did and why, for the reviewer and
   * for the run log. Persisted as a JSON string in the recorded params, so a
   * generated mask can always answer "which lines moved, to what, by how much".
   */
  report?: Record<string, unknown>;
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
  /**
   * True for REFINERS: generators that rework an existing human mask instead of
   * proposing one. `run` then requires `--refine`, loads the mask at the target
   * path as `input.source`, and refuses if that mask is unreviewed `ai`.
   */
  requiresSource?: boolean;
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

// ── Refiner: line-snap ─────────────────────────────────────────────────────
//
// Chey, 2026-08-08, on his hand-drawn Tropius reverse-holo mask: "it's
// impossible to get the lines really straight so I'm hoping you can get
// computer vision on the mask and card art in tandem to really see my intent
// there, and make the mask nice and crisp and straight on the lines I was
// trying to draw along."
//
// So this generator does NOT propose a mask. It takes a mask a human already
// painted and reads the INTENT out of it: each near-axis stretch of his
// boundary is an attempt to trace a printed edge (frame, art box, species
// strip), those edges are dead straight in the scan, so find the one he was
// tracing and replace his wobble with it. Geometry lives in line-snap.ts; the
// rules that keep it honest are summarised in the notes it emits and enforced
// there (`decide()`): weak or ambiguous edge evidence ⇒ no move, freehand and
// short runs ⇒ untouched, nothing invented where he drew nothing.
//
// It is a REFINER (`requiresSource`), so `run --refine` hands it the existing
// mask and refuses if that mask is unreviewed machine output — a straightener
// that could eat its own output would drift a boundary a pixel per pass forever.

/** Every knob, recorded verbatim in the sidecar — the params ARE the spec. */
const LINE_SNAP_PARAMS: Record<string, number | string | boolean> = { ...DEFAULT_STRAIGHTEN_PARAMS };

function summarise(segments: SegmentReport[]): string {
  const by = (a: SegmentReport['action']): SegmentReport[] => segments.filter((s) => s.action === a);
  const line = (s: SegmentReport): string =>
    `${s.axis}${s.lengthPx}px ${String(s.handPos)}→${String(s.newPos)} (max ${String(s.maxDeviationPx)}px)`;
  const parts = [
    `${by('artwork').length} snapped to a printed edge: ${by('artwork').map(line).join(', ') || '—'}`,
    `${by('window').length} snapped to his adjusted window rect: ${by('window').map(line).join(', ') || '—'}`,
    `${by('self').length} straightened to his own fit: ${by('self').map(line).join(', ') || '—'}`,
    `${by('kept').length} left exactly as drawn (${by('kept').reduce((a, s) => a + s.lengthPx, 0)}px of boundary)`,
  ];
  return parts.join('; ');
}

export const lineSnapGenerator: MaskGenerator = {
  name: 'line-snap',
  version: 1,
  modelId: null,
  params: LINE_SNAP_PARAMS,
  // Its evidence is the source mask itself, which IS a human exemplar. It
  // learns nothing from other cards and says so rather than implying otherwise.
  minExemplars: 1,
  requiresSource: true,
  generate({ target, source }): MaskGeneratorOutput {
    if (!source) {
      return {
        alpha: rectCoverage(target.width, target.height, target.rect, target.radius, target.invert),
        confidence: null,
        notes:
          'line-snap is a REFINER and was given no source mask — it has nothing to straighten. ' +
          'Fell back to the plain era rect, which adds nothing; do not accept this.',
      };
    }
    const rects: [number, number, number, number][] = target.window ? [target.window.rect, target.rect] : [target.rect];
    const r = straightenMask({
      alpha: source.alpha,
      width: target.width,
      height: target.height,
      artwork: target.artwork,
      windowRects: rects,
    });

    const snapped = r.segments.filter((s) => s.action !== 'kept');
    const artwork = r.segments.filter((s) => s.action === 'artwork');
    const devs = snapped.map((s) => s.maxDeviationPx ?? 0);
    // Confidence = how much of the straightened boundary rests on real scan
    // evidence, damped by how far it had to move. Deliberately not 1.0: a human
    // has not looked at it yet, which is the whole meaning of `ai`.
    const evidence = snapped.length ? artwork.length / snapped.length : 0;
    const drift = devs.length ? Math.max(...devs) : 0;
    const confidence = Number(Math.max(0, Math.min(0.9, evidence * Math.exp(-drift / 8))).toFixed(3));

    return {
      alpha: r.alpha,
      confidence,
      notes:
        `Straightened ${source.method} mask ${source.ref.cardId}/${source.ref.variantId} ` +
        `(sha256 ${source.ref.sha256.slice(0, 12)}). ${summarise(r.segments)}. ` +
        `Closed ${r.cornersClosed} corner(s); dropped ${r.dropped.length} stray blob(s) ` +
        `[${r.dropped.map((d) => `${d.areaPx}px @${d.bbox.join(',')}`).join(' ')}]. ` +
        `${r.changedPx}px changed (${(r.changedFraction * 100).toFixed(2)}% of the face), ` +
        `Jaccard vs his mask ${r.agreementWithSource}. ` +
        `Edge softness ${r.softness.source} → ${r.softness.result} (his AA character preserved). ` +
        'UNREVIEWED: every "kept" run above is his hand exactly as drawn, on purpose.',
      report: {
        segments: r.segments,
        dropped: r.dropped,
        loops: r.loops,
        cornersClosed: r.cornersClosed,
        softness: r.softness,
        changedPx: r.changedPx,
        changedFraction: r.changedFraction,
        agreementWithSource: r.agreementWithSource,
      },
    };
  },
};

export const GENERATORS: Record<string, MaskGenerator> = {
  [windowArtGateGenerator.name]: windowArtGateGenerator,
  [lineSnapGenerator.name]: lineSnapGenerator,
};
