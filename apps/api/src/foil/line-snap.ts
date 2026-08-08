// foil/line-snap.ts — read a hand-drawn mask's INTENT, not just its pixels.
//
// Chey, 2026-08-08: "I also did a hand drawn mask on a tropius reverse holo -
// it's impossible to get the lines really straight so I'm hoping you can get
// computer vision on the mask and card art in tandem to really see my intent
// there, and make the mask nice and crisp and straight on the lines I was
// trying to draw along."
//
// So this is NOT a smoother. Smoothing a wobbly boundary gives a smoothly
// wobbly boundary. The premise instead is that a hand-drawn foil boundary is an
// ATTEMPT TO TRACE A PRINTED EDGE — the card frame, the art box, the species
// strip, the text panel — and those edges are dead straight in the scan. So:
//
//   1. contour the mask                    → closed boundary loops
//   2. cut each loop into near-axis RUNS   → "here he was drawing a line"
//   3. robust-fit each run                 → the line he was aiming for
//   4. hunt the ARTWORK for the edge       → local Hough over (angle, offset)
//      he was evidently tracing              on the scan's directional gradient
//   5. replace the run with that line       (or, honestly, don't — see below)
//   6. intersect adjacent lines             → corners that actually meet
//   7. rasterize with his own AA character
//
// THE HONESTY RULES, in code (`decide()`):
//   - A run only becomes an artwork line if the scan really has an edge there:
//     the (angle, offset) peak must beat the local search band by `edgeSnrMin`,
//     be at least `edgeMinStrength` strong, and be present along at least
//     `edgeCoverageMin` of the run. A weak match is not a match.
//   - `prior.window` (the rect Chey dragged by hand before painting) is a
//     first-class candidate: geometry a human already chose is not invention.
//   - A run with no artwork edge is only straightened to HIS OWN fit, and only
//     if his own wobble says he was aiming straight at all
//     (`selfStraightenResidPx`). Otherwise it is copied through untouched.
//   - Anything short, curved or diagonal (`minSegmentPx`, `axisToleranceDeg`)
//     is copied through untouched. Freehand stays freehand.
//   - Corners are only closed when the two lines actually meet nearby
//     (`cornerJoinPx`); a long freehand stretch between two straight runs is
//     shape, not a sloppy corner, and survives.
//
// Everything here is pure: pixels in, pixels + a per-segment report out. The
// generator wrapper (generator.ts `line-snap`) is what the provenance system
// runs; this module has no I/O and no opinions about storage.

import type { RgbaImage } from './png.js';

// ── Params ─────────────────────────────────────────────────────────────────

export interface StraightenParams {
  /** Shortest boundary run that can count as "a line he was drawing", px. */
  minSegmentPx: number;
  /** How far off horizontal/vertical a run may be and still count as a line attempt. */
  axisToleranceDeg: number;
  /** Half-window (in path px) for the local tangent used to classify runs. */
  tangentWindowPx: number;
  /** Wobble excursions shorter than this don't split a run in two. */
  runMergeGapPx: number;
  /** How far from his line to hunt for the artwork edge he was tracing, px. */
  searchRadiusPx: number;
  /** Angular half-range of the artwork hunt, degrees (absorbs scan rotation). */
  slopeSearchDeg: number;
  slopeStepDeg: number;
  offsetStepPx: number;
  /** Peak edge score must beat the search band's median by this factor. */
  edgeSnrMin: number;
  /** Fraction of the run where that edge must actually be the local best. */
  edgeCoverageMin: number;
  /** Absolute floor on edge strength (luminance per px) — kills texture matches. */
  edgeMinStrength: number;
  /**
   * Two ridges within this ratio of each other are indistinguishable evidence:
   * the scan offers more than one line he could have meant.
   */
  ambiguityRatio: number;
  /**
   * How far an AMBIGUOUS band may move his line. A nudge onto the nearest of
   * several comparable ridges is fine; a multi-pixel relocation on evidence
   * that cannot say which ridge he meant is a guess, and gets refused.
   */
  ambiguousMaxMovePx: number;
  /** A run only self-straightens if his own robust residual RMS is under this, px. */
  selfStraightenResidPx: number;
  /** A hand line this close to a `prior.window` edge counts as tracing that edge, px. */
  windowSnapPx: number;
  /** Max distance from a junction to the intersection of its two lines, px. */
  cornerJoinPx: number;
  /** Foil blobs / holes smaller than this are stray marks, not geometry, px. */
  minComponentPx: number;
  /** Vertical supersampling for the rasterizer (x is analytic). */
  supersample: number;
}

export const DEFAULT_STRAIGHTEN_PARAMS: StraightenParams = {
  minSegmentPx: 40,
  axisToleranceDeg: 12,
  tangentWindowPx: 20,
  runMergeGapPx: 8,
  searchRadiusPx: 12,
  slopeSearchDeg: 1.5,
  slopeStepDeg: 0.25,
  offsetStepPx: 0.25,
  edgeSnrMin: 1.6,
  edgeCoverageMin: 0.5,
  edgeMinStrength: 6,
  ambiguityRatio: 0.85,
  ambiguousMaxMovePx: 2,
  selfStraightenResidPx: 3,
  windowSnapPx: 4,
  cornerJoinPx: 160,
  minComponentPx: 128,
  supersample: 4,
};

const FOIL = 128;

// ── Lines: nx*x + ny*y = c, |n| = 1 ────────────────────────────────────────

export interface Vec {
  x: number;
  y: number;
}

export interface Line {
  nx: number;
  ny: number;
  c: number;
}

const dirOf = (l: Line): Vec => ({ x: -l.ny, y: l.nx });
const projT = (l: Line, p: Vec): number => {
  const d = dirOf(l);
  return p.x * d.x + p.y * d.y;
};
const at = (l: Line, t: number): Vec => {
  const d = dirOf(l);
  return { x: l.nx * l.c + d.x * t, y: l.ny * l.c + d.y * t };
};
const signedDist = (l: Line, p: Vec): number => l.nx * p.x + l.ny * p.y - l.c;
const flip = (l: Line): Line => ({ nx: -l.nx, ny: -l.ny, c: -l.c });

export function intersectLines(a: Line, b: Line): Vec | null {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-4) return null; // parallel — no corner to make
  return { x: (a.c * b.ny - a.ny * b.c) / det, y: (a.nx * b.c - a.c * b.nx) / det };
}

/** Rotate a line's normal by `deg` about the foot of its perpendicular from `pivot`. */
function rotateAbout(l: Line, deg: number, pivot: Vec): Line {
  const r = (deg * Math.PI) / 180;
  const cs = Math.cos(r);
  const sn = Math.sin(r);
  const nx = l.nx * cs - l.ny * sn;
  const ny = l.nx * sn + l.ny * cs;
  return { nx, ny, c: nx * pivot.x + ny * pivot.y };
}

/** The four edges of a rect given in UV y-up [x,y,w,h], as pixel-space lines. */
export function rectLines(rect: [number, number, number, number], width: number, height: number): Line[] {
  const [rx, ryUp, rw, rh] = rect;
  const px = rx * width;
  const py = (1 - ryUp - rh) * height;
  return [
    { nx: 1, ny: 0, c: px },
    { nx: 1, ny: 0, c: px + rw * width },
    { nx: 0, ny: 1, c: py },
    { nx: 0, ny: 1, c: py + rh * height },
  ];
}

// ── 1. Binary mask + stray-component filtering ─────────────────────────────

export interface DroppedComponent {
  kind: 'foil' | 'hole';
  areaPx: number;
  bbox: [number, number, number, number];
}

interface Components {
  bin: Uint8Array;
  dropped: DroppedComponent[];
}

/**
 * 4-connected component filter, applied to BOTH phases: a 40-px speck of foil
 * in the corner is a slipped stylus, and so is a 40-px pinhole. Neither is a
 * line anyone was trying to draw, and both wreck contour tracing.
 */
export function filterComponents(bin: Uint8Array, width: number, height: number, minPx: number): Components {
  const out = new Uint8Array(bin);
  const dropped: DroppedComponent[] = [];
  const seen = new Uint8Array(bin.length);
  const stack: number[] = [];
  for (const phase of [1, 0] as const) {
    seen.fill(0);
    for (let start = 0; start < bin.length; start++) {
      if (seen[start] || (bin[start] ? 1 : 0) !== phase) continue;
      const cells: number[] = [];
      let x0 = width;
      let y0 = height;
      let x1 = -1;
      let y1 = -1;
      let touchesBorder = false;
      seen[start] = 1;
      stack.push(start);
      while (stack.length) {
        const p = stack.pop()!;
        cells.push(p);
        const x = p % width;
        const y = (p / width) | 0;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        const push = (q: number): void => {
          if (!seen[q] && (bin[q] ? 1 : 0) === phase) {
            seen[q] = 1;
            stack.push(q);
          }
        };
        if (x > 0) push(p - 1);
        if (x < width - 1) push(p + 1);
        if (y > 0) push(p - width);
        if (y < height - 1) push(p + width);
      }
      // The background sea (phase 0 touching the border) is not a hole.
      if (phase === 0 && touchesBorder) continue;
      if (cells.length >= minPx) continue;
      for (const p of cells) out[p] = phase === 1 ? 0 : 1;
      dropped.push({ kind: phase === 1 ? 'foil' : 'hole', areaPx: cells.length, bbox: [x0, y0, x1, y1] });
    }
  }
  return { bin: out, dropped };
}

// ── 2. Contour tracing (crack following on the pixel-corner lattice) ────────
//
// Directed unit cracks with the foil always on the (dy, -dx) side, so outer
// loops and hole loops come out with opposite winding and a nonzero-winding
// rasterizer reproduces the holes for free. At a diagonal pinch the traversal
// prefers the sharpest turn TOWARD the foil, which is exactly 4-connectivity
// for the foreground — the same connectivity filterComponents() used.

export function traceLoops(bin: Uint8Array, width: number, height: number): Vec[][] {
  const key = (x: number, y: number): number => y * (width + 1) + x;
  const outgoing = new Map<number, { to: number; used: boolean }[]>();
  const addEdge = (ax: number, ay: number, bx: number, by: number): void => {
    const k = key(ax, ay);
    const list = outgoing.get(k);
    const e = { to: key(bx, by), used: false };
    if (list) list.push(e);
    else outgoing.set(k, [e]);
  };
  const isFoil = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && bin[y * width + x] === 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isFoil(x, y)) continue;
      if (!isFoil(x, y - 1)) addEdge(x + 1, y, x, y);
      if (!isFoil(x - 1, y)) addEdge(x, y, x, y + 1);
      if (!isFoil(x, y + 1)) addEdge(x, y + 1, x + 1, y + 1);
      if (!isFoil(x + 1, y)) addEdge(x + 1, y + 1, x + 1, y);
    }
  }

  const px = (k: number): number => k % (width + 1);
  const py = (k: number): number => (k / (width + 1)) | 0;
  const loops: Vec[][] = [];
  for (const [startKey, list] of outgoing) {
    for (const first of list) {
      if (first.used) continue;
      const loop: Vec[] = [];
      let cur = startKey;
      let edge = first;
      let inDir: Vec = { x: 0, y: 0 };
      for (let guard = 0; guard < width * height * 4 + 8; guard++) {
        edge.used = true;
        loop.push({ x: px(cur), y: py(cur) });
        const next = edge.to;
        inDir = { x: px(next) - px(cur), y: py(next) - py(cur) };
        cur = next;
        if (cur === startKey) break;
        const outs = (outgoing.get(cur) ?? []).filter((e) => !e.used);
        if (outs.length === 0) break;
        if (outs.length === 1) {
          edge = outs[0]!;
          continue;
        }
        // Ambiguous junction: prefer the turn toward the foil side, which is
        // the -90° rotation (dx,dy) → (dy,-dx). Then straight, then away.
        const rank = (e: { to: number }): number => {
          const d = { x: px(e.to) - px(cur), y: py(e.to) - py(cur) };
          const cross = inDir.x * d.y - inDir.y * d.x;
          const dot = inDir.x * d.x + inDir.y * d.y;
          if (cross < 0) return 0; // toward foil
          if (dot > 0) return 1; // straight on
          return 2;
        };
        edge = outs.reduce((best, e) => (rank(e) < rank(best) ? e : best), outs[0]!);
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

export function loopArea(loop: Vec[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// ── 3. Runs: where was he drawing a straight line? ─────────────────────────

export type Axis = 'H' | 'V' | 'free';

export interface Run {
  axis: Axis;
  /** Indices into the loop, inclusive, possibly wrapping. */
  start: number;
  end: number;
  length: number;
}

/**
 * Local orientation by PCA over the whole ±w window, NOT by the difference of
 * its two endpoints. A stylus wobbles; endpoint differencing samples exactly
 * two points and inherits the wobble, which chops one long line into a row of
 * short ones that then fail `minSegmentPx`. The principal axis of the window
 * is what the eye reads as "the direction of this stroke".
 */
function classify(loop: Vec[], i: number, w: number, tolDeg: number): Axis {
  const n = loop.length;
  let mx = 0;
  let my = 0;
  for (let k = -w; k <= w; k++) {
    const q = loop[(i + k + n * 2) % n]!;
    mx += q.x;
    my += q.y;
  }
  const count = 2 * w + 1;
  mx /= count;
  my /= count;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let k = -w; k <= w; k++) {
    const q = loop[(i + k + n * 2) % n]!;
    sxx += (q.x - mx) ** 2;
    sxy += (q.x - mx) * (q.y - my);
    syy += (q.y - my) ** 2;
  }
  if (sxx + syy < 1e-9) return 'free';
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ang = (Math.abs(Math.atan2(Math.abs(Math.sin(theta)), Math.abs(Math.cos(theta)))) * 180) / Math.PI;
  if (ang <= tolDeg) return 'H';
  if (ang >= 90 - tolDeg) return 'V';
  return 'free';
}

export function segmentLoop(loop: Vec[], p: StraightenParams): Run[] {
  const n = loop.length;
  const w = Math.max(2, Math.min(p.tangentWindowPx, Math.floor(n / 4)));
  const cls: Axis[] = [];
  for (let i = 0; i < n; i++) cls.push(classify(loop, i, w, p.axisToleranceDeg));
  // Bridge momentary excursions: a couple of px of wobble in the middle of a
  // long straight run is the wobble we are here to remove, not a corner.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const before = cls[(i - 1 + n) % n]!;
      if (before === 'free') continue;
      let gap = 0;
      while (gap < p.runMergeGapPx && cls[(i + gap) % n] !== before) gap++;
      if (gap === 0 || gap >= p.runMergeGapPx) continue;
      if (cls[(i + gap) % n] !== before) continue;
      for (let k = 0; k < gap; k++) cls[(i + k) % n] = before;
    }
  }
  // Rotate so index 0 is a class change (otherwise a run straddling the seam
  // gets cut in two and both halves fall under minSegmentPx).
  let origin = 0;
  for (let i = 0; i < n; i++) {
    if (cls[i] !== cls[(i - 1 + n) % n]) {
      origin = i;
      break;
    }
  }
  const runs: Run[] = [];
  let s = 0;
  while (s < n) {
    const axis = cls[(origin + s) % n]!;
    let e = s;
    while (e + 1 < n && cls[(origin + e + 1) % n] === axis) e++;
    runs.push({ axis, start: (origin + s) % n, end: (origin + e) % n, length: e - s + 1 });
    s = e + 1;
  }
  return runs;
}

function runPoints(loop: Vec[], run: Run, trim: number): Vec[] {
  const n = loop.length;
  const out: Vec[] = [];
  const t = Math.min(trim, Math.floor((run.length - 2) / 2));
  for (let k = Math.max(0, t); k < run.length - Math.max(0, t); k++) out.push(loop[(run.start + k) % n]!);
  return out;
}

// ── 4. Robust line fit (total least squares + MAD trimming) ────────────────

export interface Fit {
  line: Line;
  residRms: number;
  residMax: number;
  tMin: number;
  tMax: number;
  kept: number;
  total: number;
}

function tlsFit(pts: Vec[]): Line {
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // major-axis angle
  const nx = -Math.sin(theta);
  const ny = Math.cos(theta);
  return { nx, ny, c: nx * mx + ny * my };
}

export function robustFit(pts: Vec[], iterations = 3): Fit | null {
  if (pts.length < 4) return null;
  let keep = pts;
  let line = tlsFit(keep);
  for (let it = 0; it < iterations; it++) {
    const res = keep.map((p) => Math.abs(signedDist(line, p)));
    const sorted = [...res].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1]!;
    const mad = [...res].map((r) => Math.abs(r - med)).sort((a, b) => a - b)[res.length >> 1]!;
    const cut = Math.max(0.75, med + 2.5 * 1.4826 * mad);
    const next = keep.filter((p) => Math.abs(signedDist(line, p)) <= cut);
    if (next.length < Math.max(4, pts.length * 0.5)) break;
    keep = next;
    line = tlsFit(keep);
  }
  let sum = 0;
  let max = 0;
  for (const p of keep) {
    const d = Math.abs(signedDist(line, p));
    sum += d * d;
    if (d > max) max = d;
  }
  const ts = pts.map((p) => projT(line, p));
  return {
    line,
    residRms: Math.sqrt(sum / keep.length),
    residMax: max,
    tMin: Math.min(...ts),
    tMax: Math.max(...ts),
    kept: keep.length,
    total: pts.length,
  };
}

// ── 5. The artwork hunt ────────────────────────────────────────────────────

export interface Gradient {
  width: number;
  height: number;
  gx: Float32Array;
  gy: Float32Array;
}

/** Sobel gradient of the scan's luminance, in luminance units per pixel. */
export function gradientOf(img: RgbaImage): Gradient {
  const { width, height, rgba } = img;
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    lum[i] = 0.2126 * rgba[i * 4]! + 0.7152 * rgba[i * 4 + 1]! + 0.0722 * rgba[i * 4 + 2]!;
  }
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const L = (x: number, y: number): number =>
    lum[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      gx[y * width + x] =
        (L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1)) / 8;
      gy[y * width + x] =
        (L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1)) / 8;
    }
  }
  return { width, height, gx, gy };
}

/** |∂I/∂n| sampled bilinearly — how hard the scan changes ACROSS the line. */
function edgeAt(g: Gradient, x: number, y: number, nx: number, ny: number): number {
  if (x < 0 || y < 0 || x > g.width - 1 || y > g.height - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(g.width - 1, x0 + 1);
  const y1 = Math.min(g.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const s = (arr: Float32Array): number =>
    arr[y0 * g.width + x0]! * (1 - fx) * (1 - fy) +
    arr[y0 * g.width + x1]! * fx * (1 - fy) +
    arr[y1 * g.width + x0]! * (1 - fx) * fy +
    arr[y1 * g.width + x1]! * fx * fy;
  return Math.abs(s(g.gx) * nx + s(g.gy) * ny);
}

export interface EdgeMatch {
  line: Line;
  /** Mean |∂I/∂n| along the run at the winning (angle, offset). */
  score: number;
  /** score / median score over the whole search band. */
  snr: number;
  /** Fraction of the run where this line is the local edge maximum. */
  coverage: number;
  /** Perpendicular move from his line, px (signed). */
  offsetPx: number;
  /** Angle change from his line, degrees. */
  angleDeg: number;
  /**
   * True when the band holds more than one comparably strong ridge ≥2px apart
   * — the scan does not say which line he meant, only that he was near some
   * lines. `decide()` then caps how far the snap may move him.
   */
  ambiguous: boolean;
  /** Competing ridge offsets in the band, strongest first (for the report). */
  ridges: number[];
}

/**
 * Local Hough over (angle, offset) around his fitted line, scoring the scan's
 * directional gradient along the run's own extent. Deliberately LOCAL: a
 * global Hough finds the strongest lines on the card, which is not the
 * question. The question is "what was he tracing HERE".
 *
 * The argmax carries a Gaussian proximity prior (σ = searchRadius/2): the edge
 * he was tracing is, by hypothesis, near where his hand put it. `snr` is still
 * measured on the RAW scores so the prior can flatter nothing into acceptance.
 */
export function huntArtworkEdge(g: Gradient, fit: Fit, p: StraightenParams): EdgeMatch | null {
  const mid = at(fit.line, (fit.tMin + fit.tMax) / 2);
  const span = fit.tMax - fit.tMin;
  if (span < 4) return null;
  const steps = Math.max(8, Math.round(span));
  const sigma = Math.max(1, p.searchRadiusPx / 2);
  const scores: number[] = [];
  /** Raw score profile at the winning angle, indexed by offset step. */
  let bestAngleProfile: { offset: number; score: number }[] = [];
  let best: { score: number; line: Line; offset: number; angle: number } | null = null;
  for (let a = -p.slopeSearchDeg; a <= p.slopeSearchDeg + 1e-9; a += p.slopeStepDeg) {
    const rotated = rotateAbout(fit.line, a, mid);
    const profile: { offset: number; score: number }[] = [];
    let bestHere: { score: number; line: Line; offset: number; angle: number } | null = null;
    for (let t = -p.searchRadiusPx; t <= p.searchRadiusPx + 1e-9; t += p.offsetStepPx) {
      const cand: Line = { nx: rotated.nx, ny: rotated.ny, c: rotated.c + t };
      let sum = 0;
      const t0 = projT(cand, at(fit.line, fit.tMin));
      const t1 = projT(cand, at(fit.line, fit.tMax));
      for (let k = 0; k <= steps; k++) {
        const q = at(cand, t0 + ((t1 - t0) * k) / steps);
        sum += edgeAt(g, q.x, q.y, cand.nx, cand.ny);
      }
      const score = sum / (steps + 1);
      scores.push(score);
      profile.push({ offset: t, score });
      const weighted = score * Math.exp(-0.5 * (t / sigma) ** 2);
      const bestWeighted = bestHere ? bestHere.score * Math.exp(-0.5 * (bestHere.offset / sigma) ** 2) : -1;
      if (weighted > bestWeighted) bestHere = { score, line: cand, offset: t, angle: a };
    }
    if (!bestHere) continue;
    const bw = bestHere.score * Math.exp(-0.5 * (bestHere.offset / sigma) ** 2);
    const cw = best ? best.score * Math.exp(-0.5 * (best.offset / sigma) ** 2) : -1;
    if (bw > cw) {
      best = bestHere;
      bestAngleProfile = profile;
    }
  }
  if (!best) return null;
  const sorted = [...scores].sort((x, y) => x - y);
  // Floor the noise estimate: on a blank stretch of card the median is ~0 and
  // an unfloored ratio reports millions, which is not a signal-to-noise ratio,
  // it is a division by zero wearing a hat. 1 luminance/px is the floor.
  const median = Math.max(sorted[sorted.length >> 1] ?? 0, 1);

  // Ridge census on the winning angle's raw profile: distinct local maxima at
  // least 2px apart. More than one comparable ridge ⇒ the scan cannot say which
  // line he meant, only that he was near some lines.
  const ridges: { offset: number; score: number }[] = [];
  for (let i = 1; i < bestAngleProfile.length - 1; i++) {
    const s = bestAngleProfile[i]!.score;
    if (s <= bestAngleProfile[i - 1]!.score || s < bestAngleProfile[i + 1]!.score) continue;
    const o = bestAngleProfile[i]!.offset;
    const near = ridges.find((r) => Math.abs(r.offset - o) < 2);
    if (near) {
      if (s > near.score) {
        near.offset = o;
        near.score = s;
      }
      continue;
    }
    ridges.push({ offset: o, score: s });
  }
  ridges.sort((a, b) => b.score - a.score);
  const top = ridges[0]?.score ?? best.score;
  const ambiguous = ridges.filter((r) => r.score >= p.ambiguityRatio * top).length > 1;

  // Coverage: at how many places along the run is the winning line actually
  // the local edge maximum? A line that only matches over its middle third is
  // not the line he was tracing.
  const winner = best.line;
  const w0 = projT(winner, at(fit.line, fit.tMin));
  const w1 = projT(winner, at(fit.line, fit.tMax));
  let hits = 0;
  for (let k = 0; k <= steps; k++) {
    const t = w0 + ((w1 - w0) * k) / steps;
    const q = at(winner, t);
    const here = edgeAt(g, q.x, q.y, winner.nx, winner.ny);
    let localMax = here;
    for (let d = -p.searchRadiusPx; d <= p.searchRadiusPx + 1e-9; d += 0.5) {
      const r = { x: q.x + winner.nx * d, y: q.y + winner.ny * d };
      const v = edgeAt(g, r.x, r.y, winner.nx, winner.ny);
      if (v > localMax) localMax = v;
    }
    if (here >= p.edgeMinStrength && here >= 0.5 * localMax) hits++;
  }
  return {
    line: winner,
    score: Number(best.score.toFixed(2)),
    snr: Number((best.score / median).toFixed(2)),
    coverage: Number((hits / (steps + 1)).toFixed(3)),
    offsetPx: Number(best.offset.toFixed(2)),
    angleDeg: Number(best.angle.toFixed(2)),
    ambiguous,
    ridges: ridges.slice(0, 4).map((r) => Number(r.offset.toFixed(2))),
  };
}

// ── 6. Decide, per run ─────────────────────────────────────────────────────

export type SegmentAction = 'artwork' | 'window' | 'self' | 'kept';

export interface SegmentReport {
  loop: number;
  index: number;
  axis: Axis;
  lengthPx: number;
  action: SegmentAction;
  reason: string;
  /** His line's coordinate (y for H runs, x for V runs) at the run midpoint. */
  handPos: number | null;
  /** The straightened line's coordinate at the same midpoint. */
  newPos: number | null;
  /** How far his drawn boundary strayed from the final line. */
  meanDeviationPx: number | null;
  maxDeviationPx: number | null;
  /** His own wobble: robust residual of his points about his OWN best fit. */
  wobbleRmsPx: number | null;
  wobbleMaxPx: number | null;
  edge: { score: number; snr: number; coverage: number; offsetPx: number; angleDeg: number; ambiguous: boolean; ridges: number[] } | null;
}

interface Decision {
  run: Run;
  fit: Fit | null;
  line: Line | null;
  report: SegmentReport;
}

function coordOf(line: Line, t: number, axis: Axis): number {
  const q = at(line, t);
  return axis === 'H' ? q.y : q.x;
}

function decide(
  loop: Vec[],
  loopIndex: number,
  run: Run,
  index: number,
  g: Gradient | null,
  windowLines: Line[],
  p: StraightenParams,
): Decision {
  const base: SegmentReport = {
    loop: loopIndex,
    index,
    axis: run.axis,
    lengthPx: run.length,
    action: 'kept',
    reason: '',
    handPos: null,
    newPos: null,
    meanDeviationPx: null,
    maxDeviationPx: null,
    wobbleRmsPx: null,
    wobbleMaxPx: null,
    edge: null,
  };
  if (run.axis === 'free') {
    return { run, fit: null, line: null, report: { ...base, reason: 'freehand / diagonal — not a line attempt' } };
  }
  if (run.length < p.minSegmentPx) {
    return { run, fit: null, line: null, report: { ...base, reason: `run ${run.length}px < minSegmentPx` } };
  }
  const pts = runPoints(loop, run, Math.round(p.tangentWindowPx / 2));
  const fit = robustFit(pts);
  if (!fit) {
    return { run, fit: null, line: null, report: { ...base, reason: 'too few points to fit' } };
  }
  const midT = (fit.tMin + fit.tMax) / 2;
  const handPos = Number(coordOf(fit.line, midT, run.axis).toFixed(2));
  const wobble = { rms: Number(fit.residRms.toFixed(2)), max: Number(fit.residMax.toFixed(2)) };

  const finish = (line: Line, action: SegmentAction, reason: string, edge: EdgeMatch | null): Decision => {
    let sum = 0;
    let max = 0;
    for (const q of pts) {
      const d = Math.abs(signedDist(line, q));
      sum += d;
      if (d > max) max = d;
    }
    return {
      run,
      fit,
      line,
      report: {
        ...base,
        action,
        reason,
        handPos,
        newPos: Number(coordOf(line, projT(line, at(fit.line, midT)), run.axis).toFixed(2)),
        meanDeviationPx: Number((sum / pts.length).toFixed(2)),
        maxDeviationPx: Number(max.toFixed(2)),
        wobbleRmsPx: wobble.rms,
        wobbleMaxPx: wobble.max,
        edge: edge
          ? {
              score: edge.score,
              snr: edge.snr,
              coverage: edge.coverage,
              offsetPx: edge.offsetPx,
              angleDeg: edge.angleDeg,
              ambiguous: edge.ambiguous,
              ridges: edge.ridges,
            }
          : null,
      },
    };
  };

  // (a) the artwork edge he was evidently tracing
  const match = g ? huntArtworkEdge(g, fit, p) : null;
  const strong =
    match !== null && match.snr >= p.edgeSnrMin && match.coverage >= p.edgeCoverageMin && match.score >= p.edgeMinStrength;
  // An ambiguous band may still nudge him onto the nearest of its ridges — but
  // it may not relocate him. That distinction is the whole difference between
  // crisping a line and moving someone's mask on a guess.
  const matchOk = strong && match !== null && (!match.ambiguous || Math.abs(match.offsetPx) <= p.ambiguousMaxMovePx);
  if (match && matchOk) {
    const q = at(match.line, projT(match.line, at(fit.line, midT)));
    const winAgree = windowLines.some(
      (wl) =>
        Math.abs(wl.nx * match.line.nx + wl.ny * match.line.ny) > 0.99 && Math.abs(signedDist(wl, q)) <= p.windowSnapPx,
    );
    return finish(
      match.line,
      'artwork',
      `traced a real printed edge (strength ${match.score}, snr ${match.snr}, present over ${(match.coverage * 100).toFixed(0)}% of the run)` +
        (match.ambiguous
          ? `; the band holds several comparable edges (offsets ${match.ridges.join('/')}px) so the move was held to ` +
            `${Math.abs(match.offsetPx)}px, onto the ridge nearest his stroke`
          : '') +
        (winAgree ? ' — and it coincides with his adjusted window edge' : ''),
      match,
    );
  }

  const why = match
    ? match.ambiguous && strong
      ? `the scan has ${match.ridges.length} comparable edges in this band (offsets ${match.ridges.join('/')}px) — it does not ` +
        `say which one he meant, and the best of them is ${Math.abs(match.offsetPx)}px away, too far to move him on a guess`
      : `best artwork candidate too weak (strength ${match.score}, snr ${match.snr}, coverage ${match.coverage})`
    : 'no scan to compare against';

  // (b) the window rect he dragged by hand before painting — human geometry
  const midPt = at(fit.line, midT);
  const win = windowLines.find(
    (wl) =>
      Math.abs(wl.nx * fit.line.nx + wl.ny * fit.line.ny) > 0.99 && Math.abs(signedDist(wl, midPt)) <= p.windowSnapPx,
  );
  if (win) {
    // Orientation is irrelevant here — rebuildLoop re-orients every line to the
    // loop's own traversal direction before it emits vertices.
    return finish(win, 'window', `${why}; snapped to the window rect he adjusted by hand`, match);
  }

  // (c) he was clearly aiming straight — straighten to HIS OWN line
  if (fit.residRms <= p.selfStraightenResidPx) {
    return finish(
      fit.line,
      'self',
      `${why}; his own stroke was straight to ${fit.residRms.toFixed(2)}px RMS, so it is straightened to ` +
        'his own best-fit line and nothing is invented',
      match,
    );
  }

  // (d) honest refusal
  return {
    run,
    fit,
    line: null,
    report: {
      ...base,
      handPos,
      wobbleRmsPx: wobble.rms,
      wobbleMaxPx: wobble.max,
      edge: match
        ? {
            score: match.score,
            snr: match.snr,
            coverage: match.coverage,
            offsetPx: match.offsetPx,
            angleDeg: match.angleDeg,
            ambiguous: match.ambiguous,
            ridges: match.ridges,
          }
        : null,
      reason: `${why}, and his stroke wanders ${fit.residRms.toFixed(2)}px RMS — left exactly as drawn`,
    },
  };
}

// ── 7. Rebuild the loop ────────────────────────────────────────────────────

interface Element {
  kind: 'line' | 'poly';
  line?: Line;
  t0?: number;
  t1?: number;
  pts?: Vec[];
  pathLen: number;
  absorbed?: boolean;
  startV?: Vec;
  endV?: Vec;
}

function rebuildLoop(loop: Vec[], decisions: Decision[], p: StraightenParams): { pts: Vec[]; corners: number } {
  const n = loop.length;
  const els: Element[] = decisions.map((d) => {
    const runPts: Vec[] = [];
    for (let k = 0; k < d.run.length; k++) runPts.push(loop[(d.run.start + k) % n]!);
    if (!d.line || !d.fit) return { kind: 'poly', pts: runPts, pathLen: d.run.length };
    // Orient the line along the loop's traversal so the polygon stays ordered.
    const a = runPts[0]!;
    const b = runPts[runPts.length - 1]!;
    const dir = dirOf(d.line);
    const line = (b.x - a.x) * dir.x + (b.y - a.y) * dir.y < 0 ? flip(d.line) : d.line;
    return { kind: 'line', line, t0: projT(line, a), t1: projT(line, b), pathLen: d.run.length };
  });
  if (els.every((e) => e.kind === 'poly')) return { pts: loop, corners: 0 };

  const m = els.length;
  let corners = 0;
  // Close corners: for each line element, walk forward past SHORT freehand to
  // the next line element and intersect — but only if the meeting point is
  // actually near the junction. A long freehand stretch is shape, not slop.
  for (let i = 0; i < m; i++) {
    const a = els[i]!;
    if (a.kind !== 'line' || a.absorbed) continue;
    let gap = 0;
    for (let step = 1; step <= m; step++) {
      const j = (i + step) % m;
      const b = els[j]!;
      if (b.absorbed) continue;
      if (b.kind === 'poly') {
        gap += b.pathLen;
        if (gap > p.cornerJoinPx) break;
        continue;
      }
      if (j === i) break;
      const X = intersectLines(a.line!, b.line!);
      if (!X) break;
      const endA = at(a.line!, a.t1!);
      const startB = at(b.line!, b.t0!);
      if (Math.hypot(X.x - endA.x, X.y - endA.y) <= p.cornerJoinPx && Math.hypot(X.x - startB.x, X.y - startB.y) <= p.cornerJoinPx) {
        a.endV = X;
        b.startV = X;
        corners++;
        for (let k = 1; k < step; k++) els[(i + k) % m]!.absorbed = true;
      }
      break;
    }
  }

  const out: Vec[] = [];
  for (let i = 0; i < m; i++) {
    const e = els[i]!;
    if (e.absorbed) continue;
    if (e.kind === 'poly') {
      out.push(...e.pts!);
      continue;
    }
    // Free ends fall back to the perpendicular foot of the neighbouring
    // freehand point, so a line-to-freehand handoff has no visible jog.
    const prev = (() => {
      for (let k = 1; k <= m; k++) {
        const q = els[(i - k + m * 2) % m]!;
        if (!q.absorbed) return q;
      }
      return null;
    })();
    const next = (() => {
      for (let k = 1; k <= m; k++) {
        const q = els[(i + k) % m]!;
        if (!q.absorbed) return q;
      }
      return null;
    })();
    const startV =
      e.startV ??
      (prev?.kind === 'poly'
        ? at(e.line!, projT(e.line!, prev.pts![prev.pts!.length - 1]!))
        : at(e.line!, e.t0!));
    const endV =
      e.endV ?? (next?.kind === 'poly' ? at(e.line!, projT(e.line!, next.pts![0]!)) : at(e.line!, e.t1!));
    out.push(startV, endV);
  }
  return { pts: out.length >= 3 ? out : loop, corners };
}

// ── 8. Rasterize (analytic in x, supersampled in y, nonzero winding) ───────

export function rasterizePolygons(loops: Vec[][], width: number, height: number, ss: number): Uint8Array {
  const cov = new Float32Array(width * height);
  const edges: { x0: number; y0: number; x1: number; y1: number; dir: number }[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      if (a.y === b.y) continue;
      edges.push(a.y < b.y ? { x0: a.x, y0: a.y, x1: b.x, y1: b.y, dir: 1 } : { x0: b.x, y0: b.y, x1: a.x, y1: a.y, dir: -1 });
    }
  }
  const weight = 1 / ss;
  const xs: { x: number; dir: number }[] = [];
  for (let sy = 0; sy < height * ss; sy++) {
    const y = (sy + 0.5) / ss;
    xs.length = 0;
    for (const e of edges) {
      if (y < e.y0 || y >= e.y1) continue;
      xs.push({ x: e.x0 + ((e.x1 - e.x0) * (y - e.y0)) / (e.y1 - e.y0), dir: e.dir });
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    const row = (Math.floor(y) | 0) * width;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i]!.dir;
      if (wind === 0) continue;
      let x0 = xs[i]!.x;
      let x1 = xs[i + 1]!.x;
      if (x1 <= 0 || x0 >= width) continue;
      x0 = Math.max(0, x0);
      x1 = Math.min(width, x1);
      const px0 = Math.floor(x0);
      const px1 = Math.min(width - 1, Math.ceil(x1) - 1);
      for (let px = px0; px <= px1; px++) {
        const l = Math.max(x0, px);
        const r = Math.min(x1, px + 1);
        if (r > l) cov[row + px] = (cov[row + px] ?? 0) + (r - l) * weight;
      }
    }
  }
  const out = new Uint8Array(width * height);
  for (let i = 0; i < cov.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, cov[i]!)) * 255);
  return out;
}

// ── 9. Edge-softness (so the result composites like his other masks) ───────

/**
 * Partly-covered pixels per unit of boundary. A hard 1-px-AA edge scores ~0.75;
 * a soft airbrushed edge scores much higher. The supersampled rasterizer
 * natively produces ~1-px AA, so a match is reported, and a blur is only
 * applied when his edge was genuinely softer than that.
 */
export function measureSoftness(alpha: Uint8Array, width: number, height: number): number {
  let partial = 0;
  let boundary = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = alpha[i]!;
      if (a > 32 && a < 223) partial++;
      const here = a >= FOIL;
      if (x + 1 < width && (alpha[i + 1]! >= FOIL) !== here) boundary++;
      if (y + 1 < height && (alpha[i + width]! >= FOIL) !== here) boundary++;
    }
  }
  return boundary === 0 ? 0 : Number((partial / boundary).toFixed(3));
}

function blurAlpha(alpha: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius < 0.5) return alpha;
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(alpha.length);
  const out = new Uint8Array(alpha.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let d = -r; d <= r; d++) {
        const q = x + d;
        if (q < 0 || q >= width) continue;
        s += alpha[y * width + q]!;
        n++;
      }
      tmp[y * width + x] = s / n;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let d = -r; d <= r; d++) {
        const q = y + d;
        if (q < 0 || q >= height) continue;
        s += tmp[q * width + x]!;
        n++;
      }
      out[y * width + x] = Math.round(s / n);
    }
  }
  return out;
}

// ── The entry point ────────────────────────────────────────────────────────

export interface StraightenInput {
  /** His mask's alpha plane, width*height. */
  alpha: Uint8Array;
  width: number;
  height: number;
  /** The card scan at the same resolution. Null ⇒ no artwork snapping at all. */
  artwork: RgbaImage | null;
  /** Candidate lines from geometry a HUMAN chose (prior.window, then the era rect). */
  windowRects: [number, number, number, number][];
  params?: Partial<StraightenParams>;
}

export interface StraightenResult {
  alpha: Uint8Array;
  params: StraightenParams;
  segments: SegmentReport[];
  dropped: DroppedComponent[];
  loops: { points: number; runs: number; corners: number; area: number }[];
  cornersClosed: number;
  softness: { source: number; result: number };
  changedPx: number;
  changedFraction: number;
  /** Jaccard(result, his mask) over foil pixels — 1.0 = nothing moved. */
  agreementWithSource: number;
}

export function straightenMask(input: StraightenInput): StraightenResult {
  const p: StraightenParams = { ...DEFAULT_STRAIGHTEN_PARAMS, ...(input.params ?? {}) };
  const { width, height } = input;
  const bin0 = new Uint8Array(width * height);
  for (let i = 0; i < bin0.length; i++) bin0[i] = input.alpha[i]! >= FOIL ? 1 : 0;
  const { bin, dropped } = filterComponents(bin0, width, height, p.minComponentPx);

  const g = input.artwork ? gradientOf(input.artwork) : null;
  const windowLines = input.windowRects.flatMap((r) => rectLines(r, width, height));

  const loops = traceLoops(bin, width, height);
  const segments: SegmentReport[] = [];
  const rebuilt: Vec[][] = [];
  const loopStats: StraightenResult['loops'] = [];
  let cornersClosed = 0;
  for (const [li, loop] of loops.entries()) {
    const runs = segmentLoop(loop, p);
    const decisions = runs.map((r, i) => decide(loop, li, r, i, g, windowLines, p));
    for (const d of decisions) segments.push(d.report);
    const { pts, corners } = rebuildLoop(loop, decisions, p);
    cornersClosed += corners;
    rebuilt.push(pts);
    loopStats.push({ points: loop.length, runs: runs.length, corners, area: Number(loopArea(loop).toFixed(1)) });
  }

  let alpha = rasterizePolygons(rebuilt, width, height, p.supersample);
  const srcSoft = measureSoftness(input.alpha, width, height);
  const resSoft = measureSoftness(alpha, width, height);
  if (srcSoft > resSoft + 0.8) {
    alpha = blurAlpha(alpha, width, height, (srcSoft - resSoft) * 0.8);
  }

  let changed = 0;
  let inter = 0;
  let union = 0;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]! >= FOIL;
    const b = input.alpha[i]! >= FOIL;
    if (a !== b) changed++;
    if (a && b) inter++;
    if (a || b) union++;
  }
  return {
    alpha,
    params: p,
    segments,
    dropped,
    loops: loopStats,
    cornersClosed,
    softness: { source: srcSoft, result: measureSoftness(alpha, width, height) },
    changedPx: changed,
    changedFraction: Number((changed / (width * height)).toFixed(6)),
    agreementWithSource: union === 0 ? 1 : Number((inter / union).toFixed(4)),
  };
}
