// foil/region-learn.ts — LEARN THE REGION POLICY, then let edge-trace do the geometry.
//
// Chey, 2026-08-07: "once i've made a few hand-done masks, i want an AI to be able to
// learn from mine to be able to do its best at replicating it across other cards in
// similar sets/series."
//
// WHY THIS FILE EXISTS, stated as the previous lane measured it (DECISIONS 2026-08-08,
// run `edgetrace-me05-batch-1`): seeding `edge-trace@1` from the era rectangle failed on
// all five me05 reverses, and the diagnosis was unambiguous — **99.7% of the gap between
// the layout rule and his intent is REGION decisions, not boundary crispness**. A tracer
// crisps a boundary; it can never add or remove a region. So the missing half of the loop
// is a thing that decides WHICH REGIONS carry foil. That is this module. `edge-trace`
// still does what it is good at: it takes the region boundary and puts it on the printed
// edge, sub-pixel.
//
// THE SHAPE OF THE IDEA
//
//   1. PARTITION the card face into five structural classes, computed from the card's
//      OWN printed geometry (the era rect only bootstraps the search):
//
//        border           achromatic ring connected to the outside of the card — the
//                         silver/foil-stock frame edge on modern cards
//        furniture        achromatic printed elements INSIDE the frame that are not
//                         connected to the outside: species strip, stage tag, evolution
//                         medallion, "evolves from" bar, copyright footer, WOTC stage box
//        frameBody        the coloured frame body — the card's chromatic field outside
//                         the illustration
//        windowBackground inside the illustration box, the field that is colour-connected
//                         to the box's own inner edge (on a WOTC holo, the starlight)
//        windowSubject    inside the illustration box, everything else (the Pokémon)
//
//   2. READ THE POLICY off his masks: for each class, what share of its pixels did he
//      make foil? >50% ⇒ the class carries foil. Where his exemplars agree, that
//      agreement IS the policy; where they disagree the disagreement is reported, never
//      averaged away (`PolicyVote.spread`, `RegionPolicy.disagreements`).
//
//   3. APPLY it to a new card: partition it the same way, union the classes the policy
//      says carry foil, clean up, and hand the boundary to `edge-trace`.
//
// Nothing here is hand-authored from anybody's beliefs about Pokémon cards. The five
// classes are generic printing structures; WHICH of them carries foil is read off the
// pixels, and it comes out DIFFERENT for the two classes in the corpus — which is the
// evidence that the reading is real and not a restatement of the rule:
//
//     wotc/window       foil = windowBackground                (the rest excluded)
//     modern-sv/sheet   foil = frameBody                       (the rest excluded)
//
// See `data/foil-masks/codified/` for the written-out policy and the numbers.

import type { RgbaImage } from './png.js';
import { structureTensor, type Tensor } from './edge-trace.js';

// ── Params — the knobs, all of them, recorded verbatim in the sidecar ───────

export interface RegionLearnParams {
  /** max(R,G,B) − min(R,G,B) above which a pixel counts as CHROMATIC (coloured ink). */
  chromaThreshold: number;
  /** Morphological close/open radius, px — closes dark text holes, drops speckle. */
  morphRadius: number;
  /** Islands smaller than this are printing noise, not regions, px. */
  minComponentPx: number;

  /** How far either side of the era rect an art-window edge is searched for, px. */
  windowSearchPx: number;
  /** Fraction of the opposite span, centred, that a window edge profile sums over. */
  windowProfileSpan: number;
  /**
   * A detected window edge must beat the median profile response in its search band
   * by this ratio, or the era rect's edge is kept and the refusal is reported.
   */
  windowEdgeMinRatio: number;
  /**
   * A candidate peak counts as a rival of the strongest one at this fraction of its
   * height. THE BEVEL PROBLEM: an illustration box is framed by a bevel, so its edge
   * is TWO parallel printed lines a few px apart, both real, both strong. Which one
   * he draws to is not a detection question — it is which side the foil is on
   * (`bevelSide` below), and taking "the strongest" picks at random between them.
   */
  windowRivalPeakRatio: number;
  /** A detected edge further than this from the prior is refused as a different feature. */
  windowMaxMovePx: number;

  /** Depth of the ring inside the window edge the background colour is sampled from, px. */
  bgRingPx: number;
  /** Colour distance from the background cluster, in robust sigmas, that still counts
   *  as background. Above it, the pixel is subject. */
  bgSigmaK: number;

  /** Class share above which a class counts as carrying foil when reading his masks. */
  voteThreshold: number;
  /**
   * Spread (max−min share across exemplars) above which the class is reported as a
   * DISAGREEMENT rather than a policy. n is tiny; averaging a disagreement away is how
   * a generator learns something nobody said.
   */
  disagreeSpread: number;
}

export const DEFAULT_REGION_LEARN_PARAMS: RegionLearnParams = {
  chromaThreshold: 24,
  morphRadius: 3,
  minComponentPx: 64,
  windowSearchPx: 26,
  windowProfileSpan: 0.7,
  windowEdgeMinRatio: 1.6,
  windowRivalPeakRatio: 0.55,
  windowMaxMovePx: 16,
  bgRingPx: 6,
  bgSigmaK: 2,
  voteThreshold: 0.5,
  disagreeSpread: 0.35,
};

// ── The five structural classes ────────────────────────────────────────────

export const REGION_CLASSES = ['border', 'furniture', 'frameBody', 'windowBackground', 'windowSubject'] as const;
export type RegionClass = (typeof REGION_CLASSES)[number];
export const CLASS_INDEX: Record<RegionClass, number> = {
  border: 0,
  furniture: 1,
  frameBody: 2,
  windowBackground: 3,
  windowSubject: 4,
};

/** Pixel rect of the illustration box, inclusive of x0/y0, exclusive of x1/y1. */
export interface WindowRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface EdgeEvidence {
  edge: 'top' | 'bottom' | 'left' | 'right';
  /** Where the era rect put it, px. */
  priorPx: number;
  /** Where the card's own printed edge is, px — or the prior when refused. */
  foundPx: number;
  /** Peak profile response / median response in the search band. */
  ratio: number;
  accepted: boolean;
}

export interface Partition {
  /** width*height, values are CLASS_INDEX. */
  cls: Uint8Array;
  window: WindowRect;
  windowEvidence: EdgeEvidence[];
  /** Pixel counts per class, in REGION_CLASSES order. */
  counts: number[];
}

// ── Small image primitives (no deps; the api has no native image addon) ─────

export function chromaField(img: RgbaImage): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = img.rgba[i * 4]!;
    const g = img.rgba[i * 4 + 1]!;
    const b = img.rgba[i * 4 + 2]!;
    out[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  return out;
}

/** Separable min/max over a (2r+1)² box — dilate (max) or erode (min). */
function morph(src: Uint8Array, w: number, h: number, r: number, op: 'dilate' | 'erode'): Uint8Array {
  if (r <= 0) return src;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const better = op === 'dilate' ? (a: number, b: number): number => (b > a ? b : a) : (a: number, b: number): number => (b < a ? b : a);
  const seed = op === 'dilate' ? 0 : 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = seed;
      for (let d = -r; d <= r; d++) {
        const xx = x + d < 0 ? 0 : x + d >= w ? w - 1 : x + d;
        v = better(v, src[y * w + xx]!);
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = seed;
      for (let d = -r; d <= r; d++) {
        const yy = y + d < 0 ? 0 : y + d >= h ? h - 1 : y + d;
        v = better(v, tmp[yy * w + x]!);
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
export const closeMask = (a: Uint8Array, w: number, h: number, r: number): Uint8Array =>
  morph(morph(a, w, h, r, 'dilate'), w, h, r, 'erode');
export const openMask = (a: Uint8Array, w: number, h: number, r: number): Uint8Array =>
  morph(morph(a, w, h, r, 'erode'), w, h, r, 'dilate');

/** 4-connected flood from every seed pixel, restricted to `allow`. */
export function floodFrom(allow: Uint8Array, w: number, h: number, seeds: number[]): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const s of seeds) {
    if (s >= 0 && s < allow.length && allow[s]! !== 0 && out[s] === 0) {
      out[s] = 255;
      stack.push(s);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0 && allow[i - 1]! !== 0 && out[i - 1] === 0) { out[i - 1] = 255; stack.push(i - 1); }
    if (x < w - 1 && allow[i + 1]! !== 0 && out[i + 1] === 0) { out[i + 1] = 255; stack.push(i + 1); }
    if (y > 0 && allow[i - w]! !== 0 && out[i - w] === 0) { out[i - w] = 255; stack.push(i - w); }
    if (y < h - 1 && allow[i + w]! !== 0 && out[i + w] === 0) { out[i + w] = 255; stack.push(i + w); }
  }
  return out;
}

/** The single biggest 4-connected component of `bin`; empty when there is none. */
export function largestComponent(bin: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  let bestSeed = -1;
  let bestSize = 0;
  const stack: number[] = [];
  for (let start = 0; start < bin.length; start++) {
    if (bin[start] === 0 || seen[start] !== 0) continue;
    let size = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && bin[i - 1]! !== 0 && seen[i - 1] === 0) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && bin[i + 1]! !== 0 && seen[i + 1] === 0) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && bin[i - w]! !== 0 && seen[i - w] === 0) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && bin[i + w]! !== 0 && seen[i + w] === 0) { seen[i + w] = 1; stack.push(i + w); }
    }
    if (size > bestSize) { bestSize = size; bestSeed = start; }
  }
  return bestSeed < 0 ? new Uint8Array(w * h) : floodFrom(bin, w, h, [bestSeed]);
}

/** Drop 4-connected components smaller than `minPx`. */
export function dropSmall(bin: Uint8Array, w: number, h: number, minPx: number): Uint8Array {
  if (minPx <= 1) return bin;
  const out = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < bin.length; start++) {
    if (bin[start] === 0 || seen[start] !== 0) continue;
    const members: number[] = [];
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && bin[i - 1]! !== 0 && seen[i - 1] === 0) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && bin[i + 1]! !== 0 && seen[i + 1] === 0) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && bin[i - w]! !== 0 && seen[i - w] === 0) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && bin[i + w]! !== 0 && seen[i + w] === 0) { seen[i + w] = 1; stack.push(i + w); }
    }
    if (members.length >= minPx) for (const i of members) out[i] = 255;
  }
  return out;
}

// ── The art window, detected on the card's own printed geometry ────────────
//
// The era rect is a SEARCH PRIOR and nothing more. Both eras in the corpus have a
// measurably wrong one (`modern-sv` was 41px out at the top until 2026-08-08; `wotc`
// is still ~11px out at the top and ~6px out at the right — see DECISIONS), and a
// generator that trusted it would inherit the error on every card it touched.

/** Profile of |∂I/∂y| (horizontal edges) summed across a centred x span, per row. */
function rowEdgeProfile(t: Tensor, x0: number, x1: number, y0: number, y1: number): Float32Array {
  const out = new Float32Array(Math.max(0, y1 - y0));
  for (let y = y0; y < y1; y++) {
    let s = 0;
    for (let x = x0; x < x1; x++) s += Math.sqrt(Math.max(0, t.jyy[y * t.width + x]!));
    out[y - y0] = s;
  }
  return out;
}
/** Profile of |∂I/∂x| (vertical edges) summed down a centred y span, per column. */
function colEdgeProfile(t: Tensor, x0: number, x1: number, y0: number, y1: number): Float32Array {
  const out = new Float32Array(Math.max(0, x1 - x0));
  for (let x = x0; x < x1; x++) {
    let s = 0;
    for (let y = y0; y < y1; y++) s += Math.sqrt(Math.max(0, t.jxx[y * t.width + x]!));
    out[x - x0] = s;
  }
  return out;
}

/**
 * Pick the edge position out of a 1-D profile.
 *
 * Not "the strongest peak". An illustration box is framed by a bevel, so its edge is a
 * PAIR of parallel printed lines a few px apart and both are strong; which one is the
 * boundary depends on which side of it the foil lies. `prefer` says which of the
 * comparable rivals to take: 'low' = the smallest coordinate, 'high' = the largest.
 */
function pickEdge(
  profile: Float32Array,
  offset: number,
  prefer: 'low' | 'high',
  rivalRatio: number,
): { at: number; ratio: number } {
  let best = -1;
  for (let i = 0; i < profile.length; i++) if (profile[i]! > best) best = profile[i]!;
  const sorted = Array.from(profile).sort((a, b) => a - b);
  const med = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  // Local maxima at or above rivalRatio × the best; pick the wanted extreme of them.
  const rivals: number[] = [];
  for (let i = 0; i < profile.length; i++) {
    const v = profile[i]!;
    if (v < best * rivalRatio) continue;
    const l = i > 0 ? profile[i - 1]! : -1;
    const r = i < profile.length - 1 ? profile[i + 1]! : -1;
    if (v >= l && v >= r) rivals.push(i);
  }
  if (rivals.length === 0) return { at: offset, ratio: 0 };
  const at = prefer === 'low' ? Math.min(...rivals) : Math.max(...rivals);
  // A band whose typical response is ZERO means the peak is infinitely better than
  // its surroundings, not that there is no evidence. Reporting ratio 0 there would
  // veto every real edge on a clean printing — the flattest, most certain case.
  const ratio = med > 0 ? profile[at]! / med : profile[at]! > 0 ? 99 : 0;
  return { at: offset + at, ratio };
}

/**
 * Where the illustration box really is on THIS card.
 *
 * `foilInsideWindow` is the whole reason this takes a side argument: the foil boundary
 * never crosses the printed bevel, so a `window`-scope card (foil inside) stops at the
 * bevel's INNER line and a `sheet`-scope card (foil outside) stops at its OUTER line.
 * Same physical frame, opposite pick — and picking "the strongest" chooses between them
 * at random, card by card.
 */
export function detectWindow(
  artwork: RgbaImage,
  prior: WindowRect,
  p: RegionLearnParams,
  foilInsideWindow: boolean,
  tensor?: Tensor,
): { window: WindowRect; evidence: EdgeEvidence[] } {
  const t = tensor ?? structureTensor(artwork, 1);
  const { width: w, height: h } = artwork;
  const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
  const s = p.windowSearchPx;
  const span = p.windowProfileSpan;
  const evidence: EdgeEvidence[] = [];

  const insetX0 = Math.round(prior.x0 + ((1 - span) / 2) * (prior.x1 - prior.x0));
  const insetX1 = Math.round(prior.x1 - ((1 - span) / 2) * (prior.x1 - prior.x0));
  const insetY0 = Math.round(prior.y0 + ((1 - span) / 2) * (prior.y1 - prior.y0));
  const insetY1 = Math.round(prior.y1 - ((1 - span) / 2) * (prior.y1 - prior.y0));

  // Foil inside ⇒ take the innermost line of each bevel (a bigger x0, a smaller x1);
  // foil outside ⇒ the outermost.
  const preferStart: 'low' | 'high' = foilInsideWindow ? 'high' : 'low';
  const preferEnd: 'low' | 'high' = foilInsideWindow ? 'low' : 'high';

  const accept = (edge: EdgeEvidence['edge'], at: number, pk: { at: number; ratio: number }): number => {
    const ok = pk.ratio >= p.windowEdgeMinRatio && Math.abs(pk.at - at) <= p.windowMaxMovePx;
    evidence.push({ edge, priorPx: at, foundPx: ok ? pk.at : at, ratio: Number(pk.ratio.toFixed(2)), accepted: ok });
    return ok ? pk.at : at;
  };
  const findRow = (edge: 'top' | 'bottom', at: number, prefer: 'low' | 'high'): number => {
    const y0 = clamp(Math.round(at - s), 1, h - 2);
    const y1 = clamp(Math.round(at + s), y0 + 1, h - 1);
    return accept(edge, at, pickEdge(rowEdgeProfile(t, insetX0, insetX1, y0, y1), y0, prefer, p.windowRivalPeakRatio));
  };
  const findCol = (edge: 'left' | 'right', at: number, prefer: 'low' | 'high'): number => {
    const x0 = clamp(Math.round(at - s), 1, w - 2);
    const x1 = clamp(Math.round(at + s), x0 + 1, w - 1);
    return accept(edge, at, pickEdge(colEdgeProfile(t, x0, x1, insetY0, insetY1), x0, prefer, p.windowRivalPeakRatio));
  };

  const y0 = findRow('top', prior.y0, preferStart);
  const y1 = findRow('bottom', prior.y1, preferEnd);
  const x0 = findCol('left', prior.x0, preferStart);
  const x1 = findCol('right', prior.x1, preferEnd);
  return { window: { x0, y0, x1, y1 }, evidence };
}

// ── The partition ──────────────────────────────────────────────────────────

/**
 * Robust colour model of the illustration's own background, sampled from a ring just
 * inside the detected window edge. The MODE of a coarse colour histogram, not the
 * median: on a card whose subject touches the window edge (Gyarados, Machamp) the
 * subject poisons a median but only contributes a minority bin here.
 */
function backgroundModel(
  img: RgbaImage,
  win: WindowRect,
  ringPx: number,
  skip: Uint8Array | null,
): { mean: number[]; sigma: number[]; support: number } | null {
  const w = img.width;
  const samples: number[][] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const i = y * w + x;
    if (skip && skip[i] !== 0) return;
    samples.push([img.rgba[i * 4]!, img.rgba[i * 4 + 1]!, img.rgba[i * 4 + 2]!]);
  };
  for (let x = win.x0; x < win.x1; x += 2) for (let d = 1; d <= ringPx; d++) { push(x, win.y0 + d); push(x, win.y1 - d); }
  for (let y = win.y0; y < win.y1; y += 2) for (let d = 1; d <= ringPx; d++) { push(win.x0 + d, y); push(win.x1 - d, y); }
  if (samples.length < 32) return null;

  const bins = new Map<string, number[][]>();
  for (const s of samples) {
    const k = `${s[0]! >> 5},${s[1]! >> 5},${s[2]! >> 5}`;
    const l = bins.get(k);
    if (l) l.push(s); else bins.set(k, [s]);
  }
  let dominant: number[][] = [];
  for (const l of bins.values()) if (l.length > dominant.length) dominant = l;
  const med = (list: number[][], k: number): number => {
    const v = list.map((s) => s[k]!).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)]!;
  };
  const mean = [med(dominant, 0), med(dominant, 1), med(dominant, 2)];
  // Spread from every sample NEAR the dominant colour — the cluster alone
  // understates it (it is a histogram bin, so its width is the bin's).
  const near = samples.filter((s) => Math.abs(s[0]! - mean[0]!) < 60 && Math.abs(s[1]! - mean[1]!) < 60 && Math.abs(s[2]! - mean[2]!) < 60);
  const sig = (k: number): number => {
    const v = near.map((s) => Math.abs(s[k]! - mean[k]!)).sort((a, b) => a - b);
    return Math.max(6, v[Math.floor(v.length * 0.75)]!);
  };
  return { mean, sigma: [sig(0), sig(1), sig(2)], support: dominant.length / samples.length };
}

/**
 * Partition a card face into the five structural classes. Pure: artwork in,
 * classification out. Nothing here knows what a Pokémon is or which class carries
 * foil — that is the policy's job, and the policy comes from his masks.
 */
export function partitionCard(
  artwork: RgbaImage,
  priorWindow: WindowRect,
  p: RegionLearnParams = DEFAULT_REGION_LEARN_PARAMS,
  foilInsideWindow = false,
): Partition {
  const { width: w, height: h } = artwork;
  const n = w * h;
  const t = structureTensor(artwork, 1);
  const { window: win, evidence } = detectWindow(artwork, priorWindow, p, foilInsideWindow, t);

  const chroma = chromaField(artwork);
  const chromatic = new Uint8Array(n);
  for (let i = 0; i < n; i++) chromatic[i] = chroma[i]! > p.chromaThreshold ? 255 : 0;
  // Close first: dark text on a coloured field reads as achromatic, and a caption
  // is not a region. Then drop speckle.
  const chromaticClean = dropSmall(closeMask(chromatic, w, h, p.morphRadius), w, h, p.minComponentPx);

  const inWindow = new Uint8Array(n);
  for (let y = win.y0; y < win.y1; y++) for (let x = win.x0; x < win.x1; x++) inWindow[y * w + x] = 255;

  // border = achromatic AND reachable from the image edge without crossing colour.
  const achromatic = new Uint8Array(n);
  for (let i = 0; i < n; i++) achromatic[i] = chromaticClean[i] === 0 ? 255 : 0;
  const seeds: number[] = [];
  for (let x = 0; x < w; x++) { seeds.push(x); seeds.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seeds.push(y * w); seeds.push(y * w + w - 1); }
  const border = floodFrom(achromatic, w, h, seeds);

  // frameBody = the biggest coloured field outside the illustration. Taking the
  // largest component (rather than "all chromatic") is what drops the coloured
  // sprite inside an evolution medallion: it is chromatic, but it is an island
  // marooned inside silver furniture, not part of the frame.
  const chromaOutside = new Uint8Array(n);
  for (let i = 0; i < n; i++) chromaOutside[i] = chromaticClean[i] !== 0 && inWindow[i] === 0 ? 255 : 0;
  const frameBody = largestComponent(chromaOutside, w, h);

  // Inside the illustration: background (colour-connected to the box's own edge) vs subject.
  const windowBackground = new Uint8Array(n);
  const bg = backgroundModel(artwork, win, p.bgRingPx, null);
  if (bg) {
    const near = new Uint8Array(n);
    for (let y = win.y0; y < win.y1; y++) {
      for (let x = win.x0; x < win.x1; x++) {
        const i = y * w + x;
        const d = Math.hypot(
          (artwork.rgba[i * 4]! - bg.mean[0]!) / bg.sigma[0]!,
          (artwork.rgba[i * 4 + 1]! - bg.mean[1]!) / bg.sigma[1]!,
          (artwork.rgba[i * 4 + 2]! - bg.mean[2]!) / bg.sigma[2]!,
        );
        near[i] = d < p.bgSigmaK * Math.sqrt(3) ? 255 : 0;
      }
    }
    const cleaned = openMask(closeMask(near, w, h, p.morphRadius), w, h, p.morphRadius);
    const ringSeeds: number[] = [];
    for (let x = win.x0; x < win.x1; x++) for (let d = 0; d < 3; d++) { ringSeeds.push((win.y0 + d) * w + x); ringSeeds.push((win.y1 - 1 - d) * w + x); }
    for (let y = win.y0; y < win.y1; y++) for (let d = 0; d < 3; d++) { ringSeeds.push(y * w + win.x0 + d); ringSeeds.push(y * w + win.x1 - 1 - d); }
    const connected = floodFrom(cleaned, w, h, ringSeeds);
    for (let i = 0; i < n; i++) if (inWindow[i] !== 0 && connected[i] !== 0) windowBackground[i] = 255;
  }

  const cls = new Uint8Array(n);
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    let c: number;
    if (inWindow[i] !== 0) c = windowBackground[i] !== 0 ? CLASS_INDEX.windowBackground : CLASS_INDEX.windowSubject;
    else if (frameBody[i] !== 0) c = CLASS_INDEX.frameBody;
    else if (border[i] !== 0) c = CLASS_INDEX.border;
    else c = CLASS_INDEX.furniture;
    cls[i] = c;
    counts[c] = counts[c]! + 1;
  }
  return { cls, window: win, windowEvidence: evidence, counts };
}

// ── Reading the policy off his masks ───────────────────────────────────────

export interface PolicyVote {
  cls: RegionClass;
  /** Per-exemplar share of the class's pixels he made foil. */
  shares: { card: string; share: number; px: number; weight: number }[];
  /** Weighted mean share. */
  mean: number;
  /** max − min across exemplars. Large ⇒ they disagree; do not average it away. */
  spread: number;
  carriesFoil: boolean;
  /** True when `spread` exceeds the params' threshold — reported, not silently used. */
  disputed: boolean;
}

export interface RegionPolicy {
  eraId: string;
  scope: string;
  params: RegionLearnParams;
  votes: PolicyVote[];
  /** The classes the corpus says carry foil, in REGION_CLASSES order. */
  foilClasses: RegionClass[];
  /** Classes whose exemplars disagree — surfaced, never averaged into a decision. */
  disagreements: string[];
  exemplarCount: number;
  /** Plain-language statement of what was learned; goes in the sidecar notes. */
  statement: string;
}

export interface PolicyExemplar {
  card: string;
  /** Alpha of his mask at the partition's resolution. */
  alpha: Uint8Array;
  partition: Partition;
  weight: number;
}

export function learnPolicy(
  eraId: string,
  scope: string,
  exemplars: PolicyExemplar[],
  p: RegionLearnParams = DEFAULT_REGION_LEARN_PARAMS,
): RegionPolicy {
  const votes: PolicyVote[] = REGION_CLASSES.map((cls) => {
    const idx = CLASS_INDEX[cls];
    const shares: PolicyVote['shares'] = [];
    for (const ex of exemplars) {
      let foil = 0;
      let total = 0;
      for (let i = 0; i < ex.partition.cls.length; i++) {
        if (ex.partition.cls[i] !== idx) continue;
        total++;
        if (ex.alpha[i]! >= 128) foil++;
      }
      // A class with almost no pixels on a card casts no vote — it is absent, not
      // "excluded" (a Basic card has no evolution medallion).
      if (total >= 200) shares.push({ card: ex.card, share: Number((foil / total).toFixed(4)), px: total, weight: ex.weight });
    }
    const wsum = shares.reduce((a, s) => a + s.weight, 0);
    const mean = wsum > 0 ? shares.reduce((a, s) => a + s.share * s.weight, 0) / wsum : 0;
    const spread = shares.length ? Math.max(...shares.map((s) => s.share)) - Math.min(...shares.map((s) => s.share)) : 0;
    return {
      cls,
      shares,
      mean: Number(mean.toFixed(4)),
      spread: Number(spread.toFixed(4)),
      carriesFoil: shares.length > 0 && mean > p.voteThreshold,
      disputed: spread > p.disagreeSpread,
    };
  });
  const foilClasses = votes.filter((v) => v.carriesFoil).map((v) => v.cls);
  const disagreements = votes
    .filter((v) => v.disputed)
    .map((v) => `${v.cls}: shares ${v.shares.map((s) => `${s.card} ${(s.share * 100).toFixed(0)}%`).join(', ')} (spread ${(v.spread * 100).toFixed(0)}pp)`);
  const say = (v: PolicyVote): string => `${v.cls} ${(v.mean * 100).toFixed(0)}%`;
  return {
    eraId,
    scope,
    params: p,
    votes,
    foilClasses,
    disagreements,
    exemplarCount: exemplars.length,
    statement:
      `${eraId}/${scope} from ${exemplars.length} human exemplar(s): foil = ${foilClasses.join(' + ') || '(nothing)'}. ` +
      `Class foil-share ${votes.filter((v) => v.shares.length).map(say).join(', ')}.` +
      (disagreements.length ? ` DISPUTED — ${disagreements.join('; ')}` : ''),
  };
}

// ── Applying a policy to a new card ────────────────────────────────────────

export interface AppliedRegions {
  alpha: Uint8Array;
  partition: Partition;
  /** Pixels contributed by each foil class, for the report. */
  contribution: { cls: RegionClass; px: number }[];
}

export function applyPolicy(
  artwork: RgbaImage,
  priorWindow: WindowRect,
  policy: RegionPolicy,
  p: RegionLearnParams = policy.params,
): AppliedRegions {
  const foilInside = policy.foilClasses.includes('windowBackground') || policy.foilClasses.includes('windowSubject');
  const part = partitionCard(artwork, priorWindow, p, foilInside);
  const { width: w, height: h } = artwork;
  const alpha = new Uint8Array(w * h);
  const wanted = new Set(policy.foilClasses.map((c) => CLASS_INDEX[c]));
  const contribution: AppliedRegions['contribution'] = [];
  for (const c of policy.foilClasses) contribution.push({ cls: c, px: part.counts[CLASS_INDEX[c]]! });
  for (let i = 0; i < alpha.length; i++) if (wanted.has(part.cls[i]!)) alpha[i] = 255;
  // One close/open pass over the UNION: the classes meet along printed seams and a
  // 1px gap between two included classes is a rasterisation artefact, not a decision.
  const cleaned = dropSmall(openMask(closeMask(alpha, w, h, p.morphRadius), w, h, p.morphRadius), w, h, p.minComponentPx);
  return { alpha: cleaned, partition: part, contribution };
}

/** Jaccard over foil pixels — the same definition as sidecar `diff.agreement`. */
export function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    const A = a[i]! >= 128;
    const B = b[i]! >= 128;
    if (A && B) inter++;
    if (A || B) uni++;
  }
  return uni === 0 ? 1 : Number((inter / uni).toFixed(4));
}

/**
 * Mean and p95 distance from each boundary pixel of `a` to the nearest boundary pixel
 * of `b`, px. Secondary to IoU on purpose: the previous lane proved that a boundary
 * metric alone will happily approve a mask that is in the wrong PLACE.
 */
export function boundaryDistance(a: Uint8Array, b: Uint8Array, w: number, h: number): { mean: number; p95: number; max: number } {
  const edge = (m: Uint8Array): Uint8Array => {
    const e = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = m[i]! >= 128;
        const l = x > 0 ? m[i - 1]! >= 128 : v;
        const r = x < w - 1 ? m[i + 1]! >= 128 : v;
        const u = y > 0 ? m[i - w]! >= 128 : v;
        const d = y < h - 1 ? m[i + w]! >= 128 : v;
        if (v !== l || v !== r || v !== u || v !== d) e[i] = 1;
      }
    }
    return e;
  };
  const eb = edge(b);
  // Chamfer distance transform of eb (two passes, 3-4 metric / 3).
  const INF = 1e9;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = eb[i] !== 0 ? 0 : INF;
  const rel = (dx: number, dy: number, cost: number): [number, number, number] => [dx, dy, cost];
  const fwd = [rel(-1, -1, 4), rel(0, -1, 3), rel(1, -1, 4), rel(-1, 0, 3)];
  const bwd = [rel(1, 1, 4), rel(0, 1, 3), rel(-1, 1, 4), rel(1, 0, 3)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    for (const [dx, dy, c] of fwd) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = dist[yy * w + xx]! + c;
      if (v < dist[i]!) dist[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    for (const [dx, dy, c] of bwd) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const v = dist[yy * w + xx]! + c;
      if (v < dist[i]!) dist[i] = v;
    }
  }
  const ea = edge(a);
  const ds: number[] = [];
  for (let i = 0; i < w * h; i++) if (ea[i] !== 0) ds.push(dist[i]! / 3);
  if (ds.length === 0) return { mean: 0, p95: 0, max: 0 };
  ds.sort((x, y) => x - y);
  const mean = ds.reduce((x, y) => x + y, 0) / ds.length;
  return {
    mean: Number(mean.toFixed(3)),
    p95: Number(ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.95))]!.toFixed(2)),
    max: Number(ds[ds.length - 1]!.toFixed(2)),
  };
}
