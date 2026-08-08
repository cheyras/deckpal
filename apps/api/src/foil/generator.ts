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
import { DEFAULT_STRAIGHTEN_PARAMS, gradientOf, straightenMask, type SegmentReport } from './line-snap.js';
import {
  DEFAULT_EDGE_TRACE_PARAMS,
  edgeTraceMask,
  luminanceProbe,
  measureAdherence,
} from './edge-trace.js';
import {
  DEFAULT_REGION_LEARN_PARAMS,
  applyPolicy,
  learnPolicy,
  partitionCard,
  type PolicyExemplar,
  type RegionLearnParams,
  type RegionPolicy,
  type WindowRect,
} from './region-learn.js';
import {
  DEFAULT_VECTOR_FIT_PARAMS,
  discoverOptionalElement,
  fitTemplate,
  probeOptional,
  rasterizeTemplate,
} from './vector-template.js';

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

// ── Refiner: edge-trace ────────────────────────────────────────────────────
//
// Chey, 2026-08-08, after reviewing the line-snap result: "I made changes to the
// tropius mask. Really just 'straighten' isn't quite enough, really just
// detecting edges and actually tracing accurately around them is the real move."
//
// So the premise moves. `line-snap` treats his strokes as the geometry and nudges
// near-straight runs onto printed lines. `edge-trace` treats his mask as a
// STATEMENT OF INTENT — which regions carry foil — and takes the geometry from
// the ARTWORK: an edge map, then livewire (Dijkstra over an edge-cost graph)
// between anchors lifted off his boundary, then sub-pixel refinement onto the
// gradient peak, and only THEN a straight fit where the traced path really is
// straight. Curves are first-class: the rounded end of a BASIC stage tag, the
// swept tail of a species strip and a corner fillet are traced, not approximated
// by the nearest axis-aligned line, which is what line-snap structurally could
// not do.
//
// It is a REFINER for the same reason line-snap is: its evidence is the mask it
// is handed, so `run --refine` refuses a source that is unreviewed machine
// output and a tracer can never eat its own tail.

const EDGE_TRACE_PARAMS: Record<string, number | string | boolean> = { ...DEFAULT_EDGE_TRACE_PARAMS };

export const edgeTraceGenerator: MaskGenerator = {
  name: 'edge-trace',
  version: 1,
  modelId: null,
  params: EDGE_TRACE_PARAMS,
  minExemplars: 1,
  requiresSource: true,
  generate({ target, source }): MaskGeneratorOutput {
    if (!source) {
      return {
        alpha: rectCoverage(target.width, target.height, target.rect, target.radius, target.invert),
        confidence: null,
        notes:
          'edge-trace is a REFINER and was given no source mask — it has no intent to follow. ' +
          'Fell back to the plain era rect, which adds nothing; do not accept this.',
      };
    }
    const r = edgeTraceMask({
      alpha: source.alpha,
      width: target.width,
      height: target.height,
      artwork: target.artwork,
    });
    if (r.refused) {
      return { alpha: source.alpha, confidence: null, notes: `edge-trace refused: ${r.refused}` };
    }

    // Adherence is measured with line-snap's OWN luminance Sobel, deliberately
    // not the colour tensor edge-trace optimised — a tracer scored on its own
    // edge map proves nothing. The incumbent gets the home field.
    const probe = luminanceProbe(gradientOf(target.artwork));
    const before = measureAdherence(source.alpha, target.width, target.height, probe);
    const after = measureAdherence(r.alpha, target.width, target.height, probe);

    const traced = r.segments.filter((s) => s.action === 'traced');
    const kept = r.segments.filter((s) => s.action === 'kept');
    const moves = traced.map((s) => s.maxMovePx ?? 0);
    const maxMove = moves.length ? Math.max(...moves) : 0;
    // Confidence: how much of his boundary rests on traced scan evidence, times
    // how much closer to the printed edge that actually got it, damped by how
    // far it had to move. Capped below 1 because no human has looked at it yet.
    const tracedShare = r.tracedPx + r.keptPx > 0 ? r.tracedPx / (r.tracedPx + r.keptPx) : 0;
    const gain = before.meanDistPx > 0 ? Math.min(1, before.meanDistPx / Math.max(after.meanDistPx, 1e-3) / 3) : 0;
    const confidence = Number(Math.max(0, Math.min(0.9, tracedShare * gain * Math.exp(-maxMove / 8))).toFixed(3));

    return {
      alpha: r.alpha,
      confidence,
      notes:
        `Traced ${source.method} mask ${source.ref.cardId}/${source.ref.variantId} ` +
        `(sha256 ${source.ref.sha256.slice(0, 12)}) against its own scan. ` +
        `${traced.length} stretch(es) traced from the artwork (${r.tracedPx}px of boundary), ` +
        `${kept.length} left exactly as drawn (${r.keptPx}px). ` +
        `${r.straightRuns} genuinely-straight run(s) crisped to a line (${r.straightPx}px); everything else is curve. ` +
        `Mean move ${(traced.reduce((a, s) => a + (s.meanMovePx ?? 0), 0) / Math.max(1, traced.length)).toFixed(2)}px, ` +
        `max ${maxMove.toFixed(2)}px (hard-capped at corridorPx ${DEFAULT_EDGE_TRACE_PARAMS.corridorPx}). ` +
        `EDGE ADHERENCE (line-snap's luminance Sobel, nearest edge max within ±4px, floor 12): ` +
        `within 1px ${(before.within1px * 100).toFixed(1)}% → ${(after.within1px * 100).toFixed(1)}%, ` +
        `mean distance ${before.meanDistPx}px → ${after.meanDistPx}px, ` +
        `p95 ${before.p95DistPx}px → ${after.p95DistPx}px. ` +
        `${r.changedPx}px changed (${(r.changedFraction * 100).toFixed(2)}% of the face), Jaccard vs his mask ${r.agreementWithSource}. ` +
        `Edge softness ${r.softness.source} → ${r.softness.result} (a sub-pixel contour is legitimately softer than a hand-drawn one). ` +
        `dropped ${r.dropped.length} stray blob(s). ` +
        'UNREVIEWED: every "kept" stretch above is his hand exactly as drawn, on purpose.',
      report: {
        segments: r.segments,
        loops: r.loops,
        dropped: r.dropped,
        tracedPx: r.tracedPx,
        keptPx: r.keptPx,
        straightRuns: r.straightRuns,
        straightPx: r.straightPx,
        softness: r.softness,
        changedPx: r.changedPx,
        changedFraction: r.changedFraction,
        agreementWithSource: r.agreementWithSource,
        edgeThresholds: r.edgeThresholds,
        adherence: { probe: 'luminance-sobel', before, after },
      },
    };
  },
};

// ── Proposer: region-learn ─────────────────────────────────────────────────
//
// The missing half of the loop. `edge-trace` and `line-snap` are REFINERS: they need
// a mask to already exist and they only move its boundary. Seeding one from the era
// rectangle was measured and refused (DECISIONS 2026-08-08, `edgetrace-me05-batch-1`):
// 99.7% of the gap between the rule and Chey's intent is REGIONS the rule gets wrong,
// and no tracer can add or remove a region.
//
// So `region-learn` decides the REGIONS, and only then hands the boundary to
// `edge-trace` for the GEOMETRY. What it knows about a card is a five-class partition
// of the face computed from the card's own printing (`region-learn.ts`); what it knows
// about FOIL is read off his masks — which of those five classes he filled. That vote
// comes out opposite for the two classes in the corpus (`windowBackground` for
// wotc/window, `frameBody` for modern-sv/sheet), which is the evidence that it is
// reading his pixels rather than restating the rule it started from.

/** UV y-up rect [x,y,w,h] → the pixel box the partition works in. */
export function rectToPixels(rect: [number, number, number, number], width: number, height: number): WindowRect {
  const [rx, ryUp, rw, rh] = rect;
  return {
    x0: Math.round(rx * width),
    y0: Math.round((1 - ryUp - rh) * height),
    x1: Math.round((rx + rw) * width),
    y1: Math.round((1 - ryUp) * height),
  };
}

/**
 * Learn the region policy from the exemplars a generator run was handed.
 *
 * `scope` decides exactly ONE thing — whether the illustration box is the inside or the
 * outside of the foil zone — and that is the resolver's own definition of the scope
 * (`era-layouts.json`: window = foil fills the art window, sheet = foil fills everything
 * except it), not an assumption about card design. Every other decision is voted on by
 * his pixels.
 */
export function policyFromExemplars(
  eraId: string,
  scope: string,
  exemplars: GeneratorExemplar[],
  width: number,
  height: number,
  p: RegionLearnParams = DEFAULT_REGION_LEARN_PARAMS,
): RegionPolicy | null {
  const usable: PolicyExemplar[] = [];
  for (const ex of exemplars) {
    if (!ex.artwork) continue;
    usable.push({
      card: `${ex.ref.cardId}/${ex.ref.variantId}`,
      alpha: ex.alpha,
      partition: partitionCard(ex.artwork, rectToPixels(ex.rect, width, height), p, scope === 'window'),
      weight: ex.ref.weight,
    });
  }
  if (usable.length === 0) return null;
  return learnPolicy(eraId, scope, usable, p);
}

const REGION_LEARN_PARAMS: Record<string, number | string | boolean> = { ...DEFAULT_REGION_LEARN_PARAMS };

export const regionLearnGenerator: MaskGenerator = {
  name: 'region-learn',
  version: 1,
  modelId: null,
  params: REGION_LEARN_PARAMS,
  // Two, so "where they agree, that agreement IS the policy" can mean something. One
  // exemplar cannot disagree with itself, and would ship its idiosyncrasies as law.
  minExemplars: 2,
  generate({ target, exemplars }): MaskGeneratorOutput {
    const { width, height } = target;
    const policy = policyFromExemplars(target.eraId, target.scope, exemplars, width, height);
    if (!policy || policy.foilClasses.length === 0) {
      return {
        alpha: new Uint8Array(width * height),
        confidence: null,
        notes:
          `region-learn could not read a policy out of the exemplars (${exemplars.length} given, ` +
          `${exemplars.filter((e) => e.artwork).length} with a cached scan). No class carried foil in a ` +
          'majority of their pixels, so there is nothing to apply. Do not accept this.',
      };
    }
    const geom = target.window ?? { rect: target.rect, radius: target.radius };
    const applied = applyPolicy(target.artwork, rectToPixels(geom.rect, width, height), policy);

    // The regions are decided; NOW the tracer earns its keep — it puts the region
    // boundary on the card's own printed edge, sub-pixel, and refuses where there is
    // no edge under it. That division of labour is the whole point of this lane.
    const traced = edgeTraceMask({ alpha: applied.alpha, width, height, artwork: target.artwork });
    const alpha = traced.refused ? applied.alpha : traced.alpha;

    const probe = luminanceProbe(gradientOf(target.artwork));
    const before = measureAdherence(applied.alpha, width, height, probe);
    const after = measureAdherence(alpha, width, height, probe);

    // Confidence: how decisively and how unanimously the corpus voted, damped by how
    // much of the window detection had to fall back on the prior. Capped well below 1
    // — no human has looked at it, which is what `ai` means.
    const votes = policy.votes.filter((v) => v.shares.length > 0);
    const decisiveness = votes.length ? votes.reduce((a, v) => a + Math.abs(v.mean - 0.5) * 2, 0) / votes.length : 0;
    const unanimity = votes.length ? 1 - votes.reduce((a, v) => a + v.spread, 0) / votes.length : 0;
    const ev = applied.partition.windowEvidence;
    const detected = ev.length ? ev.filter((e) => e.accepted).length / ev.length : 0;
    const confidence = Number(Math.max(0, Math.min(0.85, decisiveness * unanimity * (0.5 + 0.5 * detected))).toFixed(3));

    const evText = ev
      .map((e) => `${e.edge} ${e.priorPx}→${e.foundPx}px (×${e.ratio}${e.accepted ? '' : ', REFUSED — kept the prior'})`)
      .join(', ');
    return {
      alpha,
      confidence,
      notes:
        `REGION-LEARNED from ${policy.exemplarCount} human exemplar(s). ${policy.statement} ` +
        `Art window detected on this card's own printing: ${evText}. ` +
        `Regions contributed ${applied.contribution.map((c) => `${c.cls} ${c.px}px`).join(', ')}. ` +
        (traced.refused
          ? `edge-trace refused (${traced.refused}) — the region boundary ships as the partition drew it. `
          : `edge-trace then put the boundary on the printed edge: ` +
            `${traced.segments.filter((s) => s.action === 'traced').length} stretch(es) traced (${traced.tracedPx}px), ` +
            `${traced.segments.filter((s) => s.action === 'kept').length} kept (${traced.keptPx}px); adherence within 1px ` +
            `${(before.within1px * 100).toFixed(1)}% → ${(after.within1px * 100).toFixed(1)}%, ` +
            `mean distance ${before.meanDistPx}px → ${after.meanDistPx}px. `) +
        (policy.disagreements.length
          ? `HIS EXEMPLARS DISAGREE on: ${policy.disagreements.join('; ')} — reported, not averaged away. `
          : 'His exemplars agree on every class that cast a vote. ') +
        'UNREVIEWED: edge adherence measures precision, not correctness — check the REGIONS first, then the edges.',
      report: {
        policy: {
          foilClasses: policy.foilClasses,
          votes: policy.votes,
          disagreements: policy.disagreements,
          exemplarCount: policy.exemplarCount,
        },
        window: applied.partition.window,
        windowEvidence: ev,
        counts: applied.partition.counts,
        contribution: applied.contribution,
        edgeTrace: traced.refused
          ? { refused: traced.refused }
          : {
              tracedPx: traced.tracedPx,
              keptPx: traced.keptPx,
              straightRuns: traced.straightRuns,
              changedPx: traced.changedPx,
              agreementWithSource: traced.agreementWithSource,
            },
        adherence: { probe: 'luminance-sobel', before, after },
      },
    };
  },
};

/**
 * `vector-template@1` — the LAYOUT is the artifact, and it is analytic geometry.
 *
 * Chey, 2026-08-08: "Generated masks should feel like they're derived from clean vectors,
 * with straight lines and crisp curves/rounded corners following the artwork" — and then,
 * on scale: "We don't need 3,454 vector masks. All of these share the same 2 layouts really."
 *
 * So this generator does not trace anything. It fits ONE template to the consensus of his
 * masks (lines + arcs + exact corners), discovers from the corpus itself which single
 * element is optional, reads off THIS card's own printing whether that element is present,
 * and rasterises the analytic geometry. Per-card output is a rasterisation of a committed
 * template, not a per-card derivation — which is why it is cheap enough to apply to a whole
 * population, and reviewable enough that Chey can correct the template once instead of
 * correcting thousands of masks.
 *
 * Registered as an ordinary `MaskGenerator` so leave-one-out `eval`, the stated bar,
 * provenance and `revert --run-id` all keep working unchanged.
 */
export const vectorTemplateGenerator: MaskGenerator = {
  name: 'vector-template',
  version: 1,
  modelId: null,
  params: {
    tolerancePx: DEFAULT_VECTOR_FIT_PARAMS.tolerancePx,
    stepPx: DEFAULT_VECTOR_FIT_PARAMS.stepPx,
    axisSnapDeg: DEFAULT_VECTOR_FIT_PARAMS.axisSnapDeg,
    minCornerDeg: DEFAULT_VECTOR_FIT_PARAMS.minCornerDeg,
    minArcRadiusPx: DEFAULT_VECTOR_FIT_PARAMS.minArcRadiusPx,
    maxArcRadiusPx: DEFAULT_VECTOR_FIT_PARAMS.maxArcRadiusPx,
    flattenSagittaPx: DEFAULT_VECTOR_FIT_PARAMS.flattenSagittaPx,
    supersample: 4,
  },
  // Four, not two: a per-pixel MAJORITY over the corpus is only a median if there are
  // enough masks to have one, and the fit needs at least one card on each side of the
  // optional element or it cannot tell a layout feature from a card feature.
  minExemplars: 4,
  generate({ target, exemplars }): MaskGeneratorOutput {
    const { width, height } = target;
    const n = width * height;
    const usable = exemplars.filter((e) => e.alpha.length === n);
    if (usable.length < 4) {
      return {
        alpha: new Uint8Array(n),
        confidence: null,
        notes: `vector-template needs 4 usable human exemplars at ${width}x${height}; got ${usable.length}. Do not accept this.`,
      };
    }
    const opt = discoverOptionalElement(usable.map((e) => ({ cardId: e.ref.cardId, alpha: e.alpha })), width, height);
    const loaded = usable.map((e) => ({
      cardId: e.ref.cardId,
      variantId: e.ref.variantId,
      method: e.ref.method as string,
      weight: e.ref.weight,
      alpha: e.alpha,
      evolves: opt ? (opt.shares.find((s) => s.cardId === e.ref.cardId)?.share ?? 1) < opt.split : false,
    }));
    if (loaded.every((e) => e.evolves)) {
      return {
        alpha: new Uint8Array(n),
        confidence: null,
        notes:
          'vector-template: every exemplar carries the optional element, so the base layout is unobservable. ' +
          'Do not accept this — hand-draw one card without it.',
      };
    }

    const fit = fitTemplate({
      exemplars: loaded, width, height,
      eraId: target.eraId, scope: target.scope, runId: 'inline',
    });

    // Does THIS card have the optional element? Read it off the card, not a catalog.
    const probe = opt ? probeOptional(target.artwork, opt.region) : { chromaFrac: 1, hasElement: false };
    const alpha = rasterizeTemplate(fit.template, width, height, { evolves: probe.hasElement });

    // Confidence: how cleanly the corpus split on the optional element, how decisively THIS
    // card lands on one side of that split, and how little of the corpus was contested at all.
    const sep = opt ? opt.separation : 0;
    const decisive = Math.min(1, Math.abs(probe.chromaFrac - 0.5) * 2);
    const agreement = 1 - fit.stats.disputedPx / n;
    const confidence = Number(Math.max(0, Math.min(0.85, sep * decisive * agreement)).toFixed(3));

    return {
      alpha,
      confidence,
      notes:
        `VECTOR TEMPLATE fitted from ${loaded.length} human exemplar(s). ${fit.template.provenance.statement} ` +
        `This card: optional element ${probe.hasElement ? 'PRESENT' : 'absent'} — chroma ${(probe.chromaFrac * 100).toFixed(1)}% ` +
        'inside its footprint (a card without it shows the coloured frame there; a card with it shows silver). ' +
        'The boundary is analytic geometry rasterised with coverage AA — no path was traced on this card, so ' +
        'nothing here can wobble. UNREVIEWED: check the REGIONS first; clean geometry in the wrong place is still wrong.',
      report: {
        optionalElementPx: opt?.px ?? 0,
        optionalSeparation: sep,
        hasOptionalElement: probe.hasElement,
        chromaFrac: probe.chromaFrac,
        primitives: fit.stats.primitives,
        lines: fit.stats.lines,
        arcs: fit.stats.arcs,
        corners: fit.stats.corners,
        loops: fit.stats.loopsFitted,
        disputedPx: fit.stats.disputedPx,
      },
    };
  },
};

export const GENERATORS: Record<string, MaskGenerator> = {
  [windowArtGateGenerator.name]: windowArtGateGenerator,
  [lineSnapGenerator.name]: lineSnapGenerator,
  [edgeTraceGenerator.name]: edgeTraceGenerator,
  [regionLearnGenerator.name]: regionLearnGenerator,
  [vectorTemplateGenerator.name]: vectorTemplateGenerator,
};
