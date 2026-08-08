// foil/vector-template.ts — INTENT, NOT HANDWRITING.
//
// Chey, 2026-08-08: "I want to make sure that what the system is really learning is not
// 'give these a hand drawn quality' but what I draw is intent. Generated masks should feel
// like they're derived from clean vectors, with straight lines and crisp curves/rounded
// corners following the artwork."
//
// THE PREMISE MOVES AGAIN. `region-learn@1` learned WHICH REGIONS carry foil (right) and
// then handed the region boundary to `edge-trace`, which walks a livewire path pixel by
// pixel (wrong, for this purpose). Measured on his corrections: where the card prints a
// dead-straight edge, HIS hand line is straighter than the traced one. The machine was the
// thing that wobbled. So a "smoother" tracer is not the fix — the fix is to stop emitting
// a traced path at all and emit ANALYTIC GEOMETRY: line segments and circular arcs, joined
// at real corners and real fillets, rasterised with clean coverage AA.
//
// And, from the same conversation, the scale correction: "We don't need 3,454 vector masks.
// All of these share the same 2 layouts really." Measured over his 11 masks, it is better
// than that — ONE layout, plus one optional element (the evolution medallion, a ~70x85 disc
// that is foil on a Basic and furniture on anything that evolves). 50.05% of the card face
// is foil on all 11 masks and 47.18% is bare on all 11; only 2.77% is contested at all, and
// nearly all of that is the ±1-2px registration band along the boundary.
//
// So the artifact is a TEMPLATE, not a mask: geometry in normalised card space, committed,
// diffable, correctable by hand, applied at render time. Per-card rasters are a cache.
//
// Nothing here knows what a Pokemon card is. The template is FITTED from his masks; this
// file only knows how to turn a boundary into primitives and primitives back into pixels.

import { type Vec, type Line, traceLoops, rasterizePolygons, intersectLines } from './line-snap.js';
import { contourSegments } from './edge-trace.js';

// ── The vector language ────────────────────────────────────────────────────
//
// Deliberately tiny. A card frame is axis-aligned rectangles with filleted corners and a
// few rounded cut-outs; lines + circular arcs express all of it exactly. Bezier curves
// would be more general and less checkable — an arc has a radius you can read and argue
// with, which is the point of a reviewable artifact.

export interface LinePrim {
  k: 'line';
  /** End point. The start is the previous primitive's end (or the path's `start`). */
  to: [number, number];
}
export interface ArcPrim {
  k: 'arc';
  to: [number, number];
  /** Signed radius; sign is unused, `sweep` carries the direction. */
  r: number;
  /** 1 = clockwise in image coords (y down), 0 = counter-clockwise. */
  sweep: 0 | 1;
}
export type Prim = LinePrim | ArcPrim;

/** A closed path. `prims` returns to `start`; the closing primitive is explicit. */
export interface VPath {
  start: [number, number];
  prims: Prim[];
}

export interface TemplateHole {
  /** Human-readable so the committed JSON can be argued with: 'window', 'species-tail-l', … */
  id: string;
  /**
   * `always` — the hole is part of the layout.
   * `evolves` — present only when the card has an evolution medallion.
   */
  when: 'always' | 'evolves';
  path: VPath;
}

export interface VectorTemplate {
  /** e.g. 'modern-sv/sheet'. */
  id: string;
  version: number;
  eraId: string;
  scope: string;
  /**
   * Coordinates are FRACTIONS of card width/height (0..1, y down), so the template is
   * resolution-independent. `space` records the raster the fit was done on, for the record.
   */
  space: { width: number; height: number };
  /** The foil region's outer boundary. */
  outer: VPath;
  holes: TemplateHole[];
  provenance: TemplateProvenance;
}

export interface TemplateProvenance {
  generator: { name: string; version: number; modelId: string | null; runId: string };
  /** The human masks the geometry was fitted to — never unreviewed `ai` masks. */
  exemplars: { cardId: string; variantId: number; method: string; weight: number }[];
  fittedAt: string;
  params: VectorFitParams;
  /** Plain-language statement of what the fit found. */
  statement: string;
}

// ── Fit parameters ─────────────────────────────────────────────────────────

export interface VectorFitParams {
  /** Max deviation, px, a primitive may leave any of its points at. Sub-pixel on purpose. */
  tolerancePx: number;
  /** Contour resample step, px. */
  stepPx: number;
  /** A fitted line within this of horizontal/vertical is snapped exactly axis-aligned. */
  axisSnapDeg: number;
  /** Shortest primitive worth emitting, px; shorter runs are absorbed by their neighbours. */
  minPrimPx: number;
  /** Two lines meeting at more than this are a CORNER — intersected to an exact point. */
  minCornerDeg: number;
  /** Arc radii outside this range are not credible card geometry; fit a line instead. */
  minArcRadiusPx: number;
  maxArcRadiusPx: number;
  /** Loops smaller than this are printing noise, not geometry. */
  minLoopPx: number;
  /** Arc flattening sagitta, px — the rasteriser sees polylines this close to the true arc. */
  flattenSagittaPx: number;
  /**
   * How far a computed join may sit from where the contour actually turned, px. Beyond it
   * the two primitives were never meant to meet there (near-parallel lines intersect at
   * infinity), so the endpoint is projected onto the outgoing primitive instead.
   */
  joinMaxMovePx: number;
}

export const DEFAULT_VECTOR_FIT_PARAMS: VectorFitParams = {
  tolerancePx: 0.75,
  stepPx: 1,
  axisSnapDeg: 2.5,
  minPrimPx: 3,
  minCornerDeg: 12,
  minArcRadiusPx: 2,
  maxArcRadiusPx: 400,
  minLoopPx: 40,
  flattenSagittaPx: 0.02,
  joinMaxMovePx: 6,
};

// ── Geometry primitives ────────────────────────────────────────────────────

const v = (x: number, y: number): Vec => ({ x, y });
const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * `traceLoops` tests `bin[i] === 1`, not `>= 128`. Every caller converts here so the
 * 0/255 convention the rest of this file uses can never be handed to it by accident —
 * it fails silently by returning zero loops, which reads like "no geometry" rather than
 * like a type error.
 */
export function toBin01(alpha: Uint8Array): Uint8Array {
  const b = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) b[i] = alpha[i]! >= 128 ? 1 : 0;
  return b;
}

/**
 * `nx*x + ny*y = c`, |n| = 1 — the same representation `line-snap` uses, reused verbatim so
 * its `intersectLines` works on these directly rather than through a cast.
 */
type FitLine = Line;

/** Total-least-squares line through points[i..j] (inclusive), plus its max deviation. */
function fitLine(pts: Vec[], i: number, j: number): { line: FitLine; maxDev: number } {
  let sx = 0, sy = 0;
  const n = j - i + 1;
  for (let k = i; k <= j; k++) { sx += pts[k]!.x; sy += pts[k]!.y; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let k = i; k <= j; k++) {
    const dx = pts[k]!.x - mx, dy = pts[k]!.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  // Principal direction = eigenvector of the larger eigenvalue; normal is the other one.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(theta), dy = Math.sin(theta);
  const nx = -dy, ny = dx;
  const c = nx * mx + ny * my;
  let maxDev = 0;
  for (let k = i; k <= j; k++) {
    const d = Math.abs(nx * pts[k]!.x + ny * pts[k]!.y - c);
    if (d > maxDev) maxDev = d;
  }
  return { line: { nx, ny, c }, maxDev };
}

interface FitCircle { cx: number; cy: number; r: number }

/**
 * Kasa algebraic circle fit over points[i..j], plus max RADIAL deviation.
 *
 * Algebraic rather than geometric on purpose: it is a 3x3 solve, it is stable for the short
 * arcs a card corner actually contains, and the acceptance test is the honest geometric
 * one (max radial error), so a bad algebraic fit is rejected, not smuggled through.
 */
function fitCircle(pts: Vec[], i: number, j: number): { circle: FitCircle; maxDev: number } | null {
  const n = j - i + 1;
  if (n < 5) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (let k = i; k <= j; k++) {
    const x = pts[k]!.x, y = pts[k]!.y, z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Normal equations for x^2+y^2 = A x + B y + C.
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const rhs = [sxz, syz, sz];
  const det =
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (col: number): number => {
    const a = m.map((row, ri) => row.map((val, ci) => (ci === col ? rhs[ri]! : val)));
    return (
      a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) -
      a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) +
      a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!)
    ) / det;
  };
  const A = solve(0), B = solve(1), C = solve(2);
  const cx = A / 2, cy = B / 2;
  const rsq = C + cx * cx + cy * cy;
  if (!(rsq > 0)) return null;
  const r = Math.sqrt(rsq);
  let maxDev = 0;
  for (let k = i; k <= j; k++) {
    const d = Math.abs(Math.hypot(pts[k]!.x - cx, pts[k]!.y - cy) - r);
    if (d > maxDev) maxDev = d;
  }
  return { circle: { cx, cy, r }, maxDev };
}

// ── The vectoriser ─────────────────────────────────────────────────────────

interface Run {
  kind: 'line' | 'arc';
  i: number;
  j: number;
  line?: FitLine;
  circle?: FitCircle;
}

/**
 * Greedy longest-primitive decomposition of a closed contour.
 *
 * At each position, extend a LINE as far as it will go within tolerance, and an ARC as far
 * as it will go, and take whichever reaches further (ties to the line — a line is the
 * simpler claim). Exponential probe + binary refine, so this is O(n log n) fits rather
 * than O(n^2).
 */
function decompose(pts: Vec[], p: VectorFitParams): Run[] {
  const n = pts.length;
  const runs: Run[] = [];
  let i = 0;
  let guard = 0;
  while (i < n - 1 && guard++ < n + 8) {
    const maxJ = n - 1;
    const growLine = (): number => {
      let lo = Math.min(i + 1, maxJ), hi = lo;
      let step = 2;
      while (hi < maxJ) {
        const t = Math.min(maxJ, hi + step);
        if (fitLine(pts, i, t).maxDev <= p.tolerancePx) { lo = t; hi = t; step *= 2; } else break;
      }
      let a = lo, b = Math.min(maxJ, lo + step);
      while (a < b) {
        const mid = Math.ceil((a + b) / 2);
        if (fitLine(pts, i, mid).maxDev <= p.tolerancePx) a = mid; else b = mid - 1;
      }
      return a;
    };
    const growArc = (): number => {
      if (i + 5 > maxJ) return i;
      let lo = i, hi = Math.min(maxJ, i + 5);
      const ok = (t: number): boolean => {
        const f = fitCircle(pts, i, t);
        return !!f && f.maxDev <= p.tolerancePx && f.circle.r >= p.minArcRadiusPx && f.circle.r <= p.maxArcRadiusPx;
      };
      if (!ok(hi)) return i;
      lo = hi;
      let step = 2;
      while (hi < maxJ) {
        const t = Math.min(maxJ, hi + step);
        if (ok(t)) { lo = t; hi = t; step *= 2; } else break;
      }
      let a = lo, b = Math.min(maxJ, lo + step);
      while (a < b) {
        const mid = Math.ceil((a + b) / 2);
        if (ok(mid)) a = mid; else b = mid - 1;
      }
      return a;
    };
    const jL = growLine();
    const jA = growArc();
    if (jA > jL) {
      const f = fitCircle(pts, i, jA)!;
      runs.push({ kind: 'arc', i, j: jA, circle: f.circle });
      i = jA;
    } else {
      const f = fitLine(pts, i, jL);
      runs.push({ kind: 'line', i, j: jL, line: f.line });
      i = jL;
    }
  }
  return runs;
}

const angleOf = (l: FitLine): number => Math.atan2(-l.nx, l.ny);

/** Force a near-axis line exactly axis-aligned, through its own centroid. */
function snapAxis(l: FitLine, pts: Vec[], i: number, j: number, tolDeg: number): FitLine {
  const deg = (Math.atan2(-l.nx, l.ny) * 180) / Math.PI;
  const norm = ((deg % 180) + 180) % 180;
  let mx = 0, my = 0;
  for (let k = i; k <= j; k++) { mx += pts[k]!.x; my += pts[k]!.y; }
  mx /= j - i + 1; my /= j - i + 1;
  if (Math.min(norm, 180 - norm) <= tolDeg) return { nx: 0, ny: 1, c: my };   // horizontal
  if (Math.abs(norm - 90) <= tolDeg) return { nx: 1, ny: 0, c: mx };          // vertical
  return l;
}

export interface VectorizeResult {
  path: VPath;
  /** Every primitive, in order, with the source span it explains. */
  runs: Run[];
  /** Total contour length, px. */
  lengthPx: number;
  /** Length explained by primitives within tolerance. */
  explainedPx: number;
  primitives: number;
  lines: number;
  arcs: number;
  corners: number;
}

/**
 * Turn one closed contour into an analytic path.
 *
 * The last two steps are what make the output read as VECTOR rather than as a smoothed
 * trace: near-axis lines are snapped exactly axis-aligned (a card frame's edges ARE axis
 * aligned — a fitted 89.7 degrees is measurement noise, not geometry), and consecutive
 * lines that meet at a real angle are INTERSECTED, so a corner is a point rather than a
 * short diagonal chamfer left over from the contour walking round it.
 */
export function vectorizeLoop(loop: Vec[], p: VectorFitParams = DEFAULT_VECTOR_FIT_PARAMS): VectorizeResult | null {
  if (loop.length < 8) return null;
  // Resample uniformly, closed, and repeat the first point so the last run closes the loop.
  const pts = resampleLoop(loop, p.stepPx);
  if (pts.length < 8) return null;
  const closed = [...pts, pts[0]!];

  const runs = decompose(closed, p);
  if (runs.length === 0) return null;

  // Axis-snap the lines.
  for (const r of runs) if (r.kind === 'line') r.line = snapAxis(r.line!, closed, r.i, r.j, p.axisSnapDeg);

  // EVERY VERTEX MUST LIE ON THE PRIMITIVES IT JOINS.
  //
  // The version of this that shipped for about an hour took each run's endpoint straight
  // off the raw contour (`closed[r.j]`) and only replaced it for line/line corners. The
  // emitted "vertical" left edge of a rounded rect then ran from x=25.00 to x=25.66 — a
  // polyline through contour samples with arcs bridging them, wearing a vector's clothes.
  // Round-tripping it lost 5% of the area and, far worse, the straightness the whole lane
  // claims to deliver was not actually in the artifact. A join is the intersection of the
  // two primitives that meet there, or nothing.
  const endOf = (r: Run): Vec => closed[r.j]!;
  const projOnLine = (l: FitLine, q: Vec): Vec => {
    const d = l.nx * q.x + l.ny * q.y - l.c;
    return v(q.x - d * l.nx, q.y - d * l.ny);
  };
  const lineCircle = (l: FitLine, c: FitCircle, near: Vec): Vec | null => {
    const d = l.nx * c.cx + l.ny * c.cy - l.c;
    const h2 = c.r * c.r - d * d;
    if (h2 < 0) return null;                       // the line misses the circle entirely
    const h = Math.sqrt(h2);
    const fx = c.cx - d * l.nx, fy = c.cy - d * l.ny;   // foot of the perpendicular
    const a = v(fx - l.ny * h, fy + l.nx * h);
    const b = v(fx + l.ny * h, fy - l.nx * h);
    return dist(a, near) <= dist(b, near) ? a : b;
  };
  const circleCircle = (c1: FitCircle, c2: FitCircle, near: Vec): Vec | null => {
    const dx = c2.cx - c1.cx, dy = c2.cy - c1.cy;
    const D = Math.hypot(dx, dy);
    if (D < 1e-9 || D > c1.r + c2.r || D < Math.abs(c1.r - c2.r)) return null;
    const a = (c1.r * c1.r - c2.r * c2.r + D * D) / (2 * D);
    const h2 = c1.r * c1.r - a * a;
    if (h2 < 0) return null;
    const h = Math.sqrt(h2);
    const mx = c1.cx + (a * dx) / D, my = c1.cy + (a * dy) / D;
    const p1 = v(mx + (h * dy) / D, my - (h * dx) / D);
    const p2 = v(mx - (h * dy) / D, my + (h * dx) / D);
    return dist(p1, near) <= dist(p2, near) ? p1 : p2;
  };

  /** Where runs `a` and `b` really meet. Falls back to projecting onto `a` alone. */
  const joinOf = (a: Run, b: Run): { pt: Vec; corner: boolean } => {
    const raw = endOf(a);
    let cand: Vec | null = null;
    let corner = false;
    if (a.kind === 'line' && b.kind === 'line') {
      const turn = Math.abs(((angleOf(b.line!) - angleOf(a.line!)) * 180) / Math.PI) % 180;
      if (Math.min(turn, 180 - turn) >= p.minCornerDeg) { cand = intersectLines(a.line!, b.line!); corner = true; }
      else cand = projOnLine(a.line!, raw);
    } else if (a.kind === 'line' && b.kind === 'arc') cand = lineCircle(a.line!, b.circle!, raw);
    else if (a.kind === 'arc' && b.kind === 'line') cand = lineCircle(b.line!, a.circle!, raw);
    else cand = circleCircle(a.circle!, b.circle!, raw);
    // A join that lands far from where the contour actually turned is not this join.
    if (!cand || dist(cand, raw) > p.joinMaxMovePx) {
      return { pt: a.kind === 'line' ? projOnLine(a.line!, raw) : raw, corner: false };
    }
    return { pt: cand, corner: corner && dist(cand, raw) <= p.joinMaxMovePx };
  };

  const joins = runs.map((r, k) => joinOf(r, runs[(k + 1) % runs.length]!));
  const corners = joins.filter((j) => j.corner).length;

  const verts: Prim[] = runs.map((r, k) => {
    const end = joins[k]!.pt;
    if (r.kind === 'line') return { k: 'line', to: [end.x, end.y] } as Prim;
    const c = r.circle!;
    // Start of this arc = the previous join (or the loop's closing join for run 0).
    const s = joins[(k - 1 + runs.length) % runs.length]!.pt;
    const cross = (s.x - c.cx) * (end.y - c.cy) - (s.y - c.cy) * (end.x - c.cx);
    return { k: 'arc', to: [end.x, end.y], r: c.r, sweep: cross > 0 ? 1 : 0 } as Prim;
  });

  let lengthPx = 0;
  for (let k = 0; k + 1 < closed.length; k++) lengthPx += dist(closed[k]!, closed[k + 1]!);
  const explainedPx = lengthPx; // every point is inside some accepted primitive by construction

  // The path starts where the LAST run hands over to the first, so `start` is a real join
  // too and the closed path is consistent all the way round.
  const start = joins[runs.length - 1]!.pt;
  return {
    path: { start: [start.x, start.y], prims: verts },
    runs,
    lengthPx,
    explainedPx,
    primitives: verts.length,
    lines: runs.filter((r) => r.kind === 'line').length,
    arcs: runs.filter((r) => r.kind === 'arc').length,
    corners,
  };
}

/** Uniform arc-length resample of a closed loop. */
export function resampleLoop(loop: Vec[], step: number): Vec[] {
  const out: Vec[] = [];
  let carry = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!, b = loop[(i + 1) % loop.length]!;
    const seg = dist(a, b);
    if (seg <= 1e-9) continue;
    let t = carry;
    while (t < seg) {
      out.push(v(a.x + ((b.x - a.x) * t) / seg, a.y + ((b.y - a.y) * t) / seg));
      t += step;
    }
    carry = t - seg;
  }
  return out;
}

// ── Rasterising the analytic geometry ──────────────────────────────────────

/** Flatten a path to a polygon fine enough that the arc error is invisible at 8-bit AA. */
export function flattenPath(path: VPath, sagitta: number): Vec[] {
  const out: Vec[] = [];
  let cur = v(path.start[0], path.start[1]);
  out.push(cur);
  for (const pr of path.prims) {
    const to = v(pr.to[0], pr.to[1]);
    if (pr.k === 'line') { out.push(to); cur = to; continue; }
    const r = Math.abs(pr.r);
    const d = dist(cur, to);
    if (!(r > 0) || d < 1e-9 || d > 2 * r + 1e-6) { out.push(to); cur = to; continue; }
    // Centre of the circle through cur and to with radius r, on the side `sweep` says.
    const mx = (cur.x + to.x) / 2, my = (cur.y + to.y) / 2;
    const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
    const ux = (to.x - cur.x) / d, uy = (to.y - cur.y) / d;
    const sign = pr.sweep === 1 ? 1 : -1;
    const cx = mx + sign * h * -uy, cy = my + sign * h * ux;
    let a0 = Math.atan2(cur.y - cy, cur.x - cx);
    let a1 = Math.atan2(to.y - cy, to.x - cx);
    let sweepAng = a1 - a0;
    if (pr.sweep === 1) { while (sweepAng <= 0) sweepAng += 2 * Math.PI; }
    else { while (sweepAng >= 0) sweepAng -= 2 * Math.PI; }
    // Steps so the sagitta of each chord stays under `sagitta`.
    const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - sagitta / r)));
    const steps = Math.max(2, Math.ceil(Math.abs(sweepAng) / Math.max(1e-4, maxStep)));
    for (let s = 1; s <= steps; s++) {
      const a = a0 + (sweepAng * s) / steps;
      out.push(v(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
    cur = to;
  }
  return out;
}

/**
 * Rasterise a template at width x height. Template coordinates are fractions of the card,
 * so this is resolution-independent — the same artifact serves a 490px mask and a 1024px one.
 */
export function rasterizeTemplate(
  tpl: VectorTemplate,
  width: number,
  height: number,
  opts: { evolves: boolean; supersample?: number; sagittaPx?: number },
): Uint8Array {
  const ss = opts.supersample ?? 4;
  const sag = opts.sagittaPx ?? DEFAULT_VECTOR_FIT_PARAMS.flattenSagittaPx;
  const toPx = (path: VPath): VPath => ({
    start: [path.start[0] * width, path.start[1] * height],
    prims: path.prims.map((pr) =>
      pr.k === 'line'
        ? { k: 'line', to: [pr.to[0] * width, pr.to[1] * height] }
        : { k: 'arc', to: [pr.to[0] * width, pr.to[1] * height], r: pr.r * width, sweep: pr.sweep },
    ),
  });
  const loops: Vec[][] = [flattenPath(toPx(tpl.outer), sag)];
  for (const h of tpl.holes) {
    if (h.when === 'evolves' && !opts.evolves) continue;
    loops.push(flattenPath(toPx(h.path), sag));
  }
  return rasterizePolygons(loops, width, height, ss);
}

// ── Vector-ness: the measure that proves intent, not handwriting ───────────

export interface Vectorness {
  /**
   * Fraction of boundary length carried by LONG primitives (>= `longPrimPx`) at the strict
   * tolerance. This is the headline number. A boundary that is really made of lines and arcs
   * keeps them long; a boundary that merely passes near them shatters into short pieces as
   * soon as the tolerance is tightened below the wobble amplitude.
   */
  explainedLong: number;
  /** Primitive count per 1000px of boundary. Fewer = more vector-like. */
  primitivesPerKpx: number;
  primitives: number;
  boundaryPx: number;
  /** RMS distance from each contour point to its own fitted primitive, px. */
  residualPx: number;
  /** Fraction of boundary length lying on exactly axis-aligned runs. */
  axisAlignedFrac: number;
  /** The tolerance the decomposition was run at — the number is meaningless without it. */
  tolerancePx: number;
}

/**
 * The measure is run at a STRICTER tolerance than the fitter uses.
 *
 * At the fitting tolerance every boundary decomposes into primitives by construction, so
 * "explained" would be 1.0 for a hand mask and for a vector mask alike — a measure that
 * cannot separate them proves nothing. Tightened below the amplitude of a hand wobble
 * (~1px) and below the livewire's pixel-to-pixel noise, the difference appears.
 */
export const VECTORNESS_TOLERANCE_PX = 0.35;
/** A primitive at least this long is "structure"; shorter is the boundary chasing noise. */
export const VECTORNESS_LONG_PRIM_PX = 8;

/**
 * Measure how much of a mask's boundary is explainable as clean analytic geometry.
 *
 * NOT a quality score and never a promotion criterion — a flawless vector boundary in the
 * wrong place is still wrong, which is why IoU gates and this only describes. Its job is to
 * separate two things that look similar in an IoU table: a boundary that HAS a shape, and a
 * boundary that merely passes near one.
 */
/**
 * Chain marching-squares segments into closed sub-pixel loops.
 *
 * MEASURING ON `traceLoops` IS A TRAP and this function exists because I fell in it: crack
 * following returns a rectilinear staircase on the integer lattice, so every run is exactly
 * horizontal or exactly vertical and every residual is exactly zero — the measure reports
 * the tracer, not the mask, and rates a hand-drawn blob as perfectly axis-aligned. The
 * half-level iso-contour is the honest boundary: it is sub-pixel, and it respects the
 * antialiasing, so clean coverage AA and a ragged edge no longer look alike.
 */
export function subpixelLoops(alpha: Uint8Array, width: number, height: number): Vec[][] {
  const segs = contourSegments(alpha, width, height, 127.5);
  const key = (p: Vec): string => `${Math.round(p.x * 4096)},${Math.round(p.y * 4096)}`;
  const adj = new Map<string, { pt: Vec; to: string }[]>();
  for (const s of segs) {
    const ka = key(s.a), kb = key(s.b);
    (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push({ pt: s.b, to: kb });
    (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push({ pt: s.a, to: ka });
  }
  const ptOf = new Map<string, Vec>();
  for (const s of segs) { ptOf.set(key(s.a), s.a); ptOf.set(key(s.b), s.b); }
  const used = new Set<string>();
  const loops: Vec[][] = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop: Vec[] = [];
    let cur = start;
    let guard = 0;
    while (guard++ < segs.length * 2 + 8) {
      if (used.has(cur)) break;
      used.add(cur);
      loop.push(ptOf.get(cur)!);
      const nxt = (adj.get(cur) ?? []).find((e) => !used.has(e.to));
      if (!nxt) break;
      cur = nxt.to;
    }
    if (loop.length >= 8) loops.push(loop);
  }
  return loops;
}

export function vectorness(
  alpha: Uint8Array,
  width: number,
  height: number,
  base: VectorFitParams = DEFAULT_VECTOR_FIT_PARAMS,
  tolerancePx: number = VECTORNESS_TOLERANCE_PX,
  longPrimPx: number = VECTORNESS_LONG_PRIM_PX,
): Vectorness {
  const p: VectorFitParams = { ...base, tolerancePx };
  const loops = subpixelLoops(alpha, width, height);

  let boundaryPx = 0, longPx = 0, primitives = 0, axisPx = 0;
  const resid: number[] = [];
  for (const loop of loops) {
    const pts = resampleLoop(loop, p.stepPx);
    if (pts.length < 8) continue;
    let len = 0;
    for (let k = 0; k < pts.length; k++) len += dist(pts[k]!, pts[(k + 1) % pts.length]!);
    if (len < p.minLoopPx) continue;
    boundaryPx += len;

    const closed = [...pts, pts[0]!];
    const runs = decompose(closed, p);
    primitives += runs.length;
    for (const r of runs) {
      let rl = 0;
      for (let k = r.i; k < r.j; k++) rl += dist(closed[k]!, closed[k + 1]!);
      if (rl >= longPrimPx) longPx += rl;
      if (r.kind === 'line') {
        const snapped = snapAxis(r.line!, closed, r.i, r.j, p.axisSnapDeg);
        if (snapped.nx === 0 || snapped.ny === 0) axisPx += rl;
        for (let k = r.i; k <= r.j; k++) resid.push(r.line!.nx * closed[k]!.x + r.line!.ny * closed[k]!.y - r.line!.c);
      } else {
        const c = r.circle!;
        for (let k = r.i; k <= r.j; k++) resid.push(Math.hypot(closed[k]!.x - c.cx, closed[k]!.y - c.cy) - c.r);
      }
    }
  }
  const rms = resid.length ? Math.sqrt(resid.reduce((a, b) => a + b * b, 0) / resid.length) : 0;
  return {
    explainedLong: boundaryPx > 0 ? Number((longPx / boundaryPx).toFixed(4)) : 0,
    primitivesPerKpx: boundaryPx > 0 ? Number(((primitives * 1000) / boundaryPx).toFixed(2)) : 0,
    primitives,
    boundaryPx: Number(boundaryPx.toFixed(1)),
    residualPx: Number(rms.toFixed(4)),
    axisAlignedFrac: boundaryPx > 0 ? Number((axisPx / boundaryPx).toFixed(4)) : 0,
    tolerancePx,
  };
}

// ── Discovering the optional element (nothing here is told it is a medallion) ──

export interface OptionalElement {
  /** width*height, 255 inside the element's footprint. */
  region: Uint8Array;
  px: number;
  /** Per-exemplar foil share inside the region — bimodal when the element is real. */
  shares: { cardId: string; share: number }[];
  /** Share below which an exemplar is taken to HAVE the element (it cuts the foil away). */
  split: number;
  /** Gap between the two clusters. Small ⇒ this is not really an optional element. */
  separation: number;
}

/**
 * Find the one region his masks systematically disagree about, without being told what it is.
 *
 * Two masks of the same layout differ in two ways: a ±1-2px registration band all along the
 * boundary (noise), and — if the layout has an optional element — one compact blob (signal).
 * Opening the contested set by `morphRadius` destroys the thin band and leaves the blob, so
 * the element falls out of the corpus rather than being asserted. On modern-sv/sheet this
 * finds the evolution medallion; on another era it would find whatever that era's optional
 * element is, or nothing, which is also an answer.
 */
export function discoverOptionalElement(
  masks: { cardId: string; alpha: Uint8Array }[],
  width: number,
  height: number,
  openRadius = 4,
  minPx = 200,
): OptionalElement | null {
  const n = width * height;
  const contested = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let foil = 0;
    for (const m of masks) if (m.alpha[i]! >= 128) foil++;
    contested[i] = foil > 0 && foil < masks.length ? 255 : 0;
  }
  const opened = morphOpen(contested, width, height, openRadius);
  const region = largestBlob(opened, width, height);
  let px = 0;
  for (let i = 0; i < n; i++) if (region[i] !== 0) px++;
  if (px < minPx) return null;

  const shares = masks.map((m) => {
    let foil = 0, tot = 0;
    for (let i = 0; i < n; i++) if (region[i] !== 0) { tot++; if (m.alpha[i]! >= 128) foil++; }
    return { cardId: m.cardId, share: tot ? Number((foil / tot).toFixed(4)) : 0 };
  });
  const sorted = [...shares].map((s) => s.share).sort((a, b) => a - b);
  let bestGap = 0, split = 0.5;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const gap = sorted[i + 1]! - sorted[i]!;
    if (gap > bestGap) { bestGap = gap; split = (sorted[i]! + sorted[i + 1]!) / 2; }
  }
  return { region, px, shares, split, separation: Number(bestGap.toFixed(4)) };
}

function morphOpen(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const pass = (a: Uint8Array, op: 'min' | 'max'): Uint8Array => {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    const seed = op === 'max' ? 0 : 255;
    const pick = op === 'max' ? Math.max : Math.min;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let val = seed;
      for (let d = -r; d <= r; d++) { const xx = Math.min(w - 1, Math.max(0, x + d)); val = pick(val, a[y * w + xx]!); }
      tmp[y * w + x] = val;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let val = seed;
      for (let d = -r; d <= r; d++) { const yy = Math.min(h - 1, Math.max(0, y + d)); val = pick(val, tmp[yy * w + x]!); }
      out[y * w + x] = val;
    }
    return out;
  };
  return pass(pass(src, 'min'), 'max');
}

function largestBlob(bin: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  let best: number[] = [];
  for (let s = 0; s < bin.length; s++) {
    if (bin[s] === 0 || seen[s]) continue;
    const st = [s]; seen[s] = 1; const mem: number[] = [];
    while (st.length) {
      const i = st.pop()!; mem.push(i);
      const x = i % w, y = (i - x) / w;
      for (const nb of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (nb >= 0 && bin[nb] !== 0 && !seen[nb]) { seen[nb] = 1; st.push(nb); }
    }
    if (mem.length > best.length) best = mem;
  }
  const out = new Uint8Array(w * h);
  for (const i of best) out[i] = 255;
  return out;
}

/**
 * Does THIS card have the optional element? Read off its own printing, not a database.
 *
 * Inside the element's footprint a card that lacks it shows the coloured frame (high chroma);
 * a card that has it shows a silver disc (low chroma). The gap is large, so this is a robust
 * binary test — and it keeps the template self-contained: no catalog lookup at render time.
 */
export function probeOptional(
  artwork: { width: number; height: number; rgba: Uint8Array },
  region: Uint8Array,
  chromaThreshold = 24,
): { chromaFrac: number; hasElement: boolean } {
  let chromatic = 0, tot = 0;
  for (let i = 0; i < region.length; i++) {
    if (region[i] === 0) continue;
    tot++;
    const r = artwork.rgba[i * 4]!, g = artwork.rgba[i * 4 + 1]!, b = artwork.rgba[i * 4 + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > chromaThreshold) chromatic++;
  }
  const frac = tot ? chromatic / tot : 0;
  return { chromaFrac: Number(frac.toFixed(4)), hasElement: frac < 0.5 };
}

// ── Fitting a template from his masks ──────────────────────────────────────

export interface TemplateFitInput {
  /** Human masks, all at the same width x height, with their exemplar weights. */
  exemplars: { cardId: string; variantId: number; method: string; weight: number; alpha: Uint8Array; evolves: boolean }[];
  width: number;
  height: number;
  eraId: string;
  scope: string;
  runId: string;
  params?: VectorFitParams;
}

export interface TemplateFitResult {
  template: VectorTemplate;
  /** The consensus rasters the fit was taken from, for review. */
  consensusBase: Uint8Array;
  consensusEvolves: Uint8Array;
  stats: {
    agreeFoilPx: number;
    agreeBarePx: number;
    disputedPx: number;
    medallionPx: number;
    loopsFitted: number;
    primitives: number;
    lines: number;
    arcs: number;
    corners: number;
  };
}

/** Weighted majority vote per pixel over a set of masks. */
function consensus(masks: { alpha: Uint8Array; weight: number }[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  let wsum = 0;
  for (const m of masks) wsum += m.weight;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const m of masks) if (m.alpha[i]! >= 128) s += m.weight;
    out[i] = s > wsum / 2 ? 255 : 0;
  }
  return out;
}

/**
 * Fit the layout template from his masks.
 *
 * The geometry comes from the CONSENSUS of the human corpus, not from any single mask: a
 * per-pixel weighted majority is the median boundary, so one card's 2px registration error
 * cannot become the template's edge. The optional medallion is fitted separately, from the
 * region where the Basic consensus and the evolving consensus actually disagree — which is
 * measured, not asserted.
 */
export function fitTemplate(input: TemplateFitInput): TemplateFitResult {
  const p = input.params ?? DEFAULT_VECTOR_FIT_PARAMS;
  const { width: w, height: h } = input;
  const n = w * h;
  const basics = input.exemplars.filter((e) => !e.evolves);
  const evolvers = input.exemplars.filter((e) => e.evolves);
  if (basics.length === 0) throw new Error('fitTemplate: no non-evolving exemplar — cannot fit the base layout');

  const consensusBase = consensus(basics, n);
  const consensusEvolves = evolvers.length ? consensus(evolvers, n) : new Uint8Array(n);

  // Agreement stats over the WHOLE corpus, for the record.
  let agreeFoilPx = 0, agreeBarePx = 0, disputedPx = 0;
  for (let i = 0; i < n; i++) {
    let foil = 0;
    for (const e of input.exemplars) if (e.alpha[i]! >= 128) foil++;
    if (foil === input.exemplars.length) agreeFoilPx++;
    else if (foil === 0) agreeBarePx++;
    else disputedPx++;
  }

  // The medallion: foil on a Basic, bare on an evolver.
  const medallion = new Uint8Array(n);
  let medallionPx = 0;
  if (evolvers.length) {
    for (let i = 0; i < n; i++) {
      if (consensusBase[i] !== 0 && consensusEvolves[i] === 0) { medallion[i] = 255; medallionPx++; }
    }
  }

  const norm = (path: VPath): VPath => ({
    start: [path.start[0] / w, path.start[1] / h],
    prims: path.prims.map((pr) =>
      pr.k === 'line'
        ? { k: 'line', to: [pr.to[0] / w, pr.to[1] / h] }
        : { k: 'arc', to: [pr.to[0] / w, pr.to[1] / h], r: pr.r / w, sweep: pr.sweep },
    ),
  });

  // Outer boundary + holes, straight off the Basic consensus. traceLoops winds holes
  // opposite to the outer loop, so nonzero winding reproduces the topology for free.
  const loops = traceLoops(toBin01(consensusBase), w, h);
  const fitted = loops
    .map((l) => ({ loop: l, res: vectorizeLoop(l, p) }))
    .filter((x): x is { loop: Vec[]; res: VectorizeResult } => x.res !== null && x.res.lengthPx >= p.minLoopPx)
    .sort((a, b) => b.res.lengthPx - a.res.lengthPx);
  if (fitted.length === 0) throw new Error('fitTemplate: consensus produced no fittable loop');

  const outer = fitted[0]!;
  const holes: TemplateHole[] = fitted.slice(1).map((f, i) => ({
    id: `hole-${i + 1}`,
    when: 'always' as const,
    path: norm(f.res.path),
  }));

  let stats = {
    agreeFoilPx, agreeBarePx, disputedPx, medallionPx,
    loopsFitted: fitted.length,
    primitives: fitted.reduce((a, f) => a + f.res.primitives, 0),
    lines: fitted.reduce((a, f) => a + f.res.lines, 0),
    arcs: fitted.reduce((a, f) => a + f.res.arcs, 0),
    corners: fitted.reduce((a, f) => a + f.res.corners, 0),
  };

  if (medallionPx > p.minLoopPx) {
    const mLoops = traceLoops(toBin01(medallion), w, h);
    const mFit = mLoops
      .map((l) => vectorizeLoop(l, p))
      .filter((r): r is VectorizeResult => r !== null)
      .sort((a, b) => b.lengthPx - a.lengthPx);
    if (mFit.length) {
      // A hole is wound opposite to the outer loop; the medallion came from a separate
      // trace of its own positive region, so reverse it to cut rather than add.
      const rev = reversePath(mFit[0]!.path);
      holes.push({ id: 'evolution-medallion', when: 'evolves', path: norm(rev) });
      stats = { ...stats, primitives: stats.primitives + mFit[0]!.primitives, lines: stats.lines + mFit[0]!.lines, arcs: stats.arcs + mFit[0]!.arcs };
    }
  }

  const statement =
    `${input.eraId}/${input.scope} fitted from ${input.exemplars.length} human exemplar(s) ` +
    `(${basics.length} non-evolving, ${evolvers.length} evolving). ` +
    `${agreeFoilPx} px foil on every mask, ${agreeBarePx} px bare on every mask, ${disputedPx} px contested. ` +
    `One layout; the evolution medallion is a ${medallionPx}px optional cut-out. ` +
    `Geometry: ${stats.primitives} primitives (${stats.lines} lines, ${stats.arcs} arcs, ${stats.corners} exact corners) across ${fitted.length} loop(s).`;

  return {
    template: {
      id: `${input.eraId}/${input.scope}`,
      version: 1,
      eraId: input.eraId,
      scope: input.scope,
      space: { width: w, height: h },
      outer: norm(outer.res.path),
      holes,
      provenance: {
        generator: { name: 'vector-template', version: 1, modelId: null, runId: input.runId },
        exemplars: input.exemplars.map((e) => ({ cardId: e.cardId, variantId: e.variantId, method: e.method, weight: e.weight })),
        fittedAt: new Date().toISOString(),
        params: p,
        statement,
      },
    },
    consensusBase,
    consensusEvolves,
    stats,
  };
}

/** Reverse a closed path's direction (turns a fill into a cut under nonzero winding). */
export function reversePath(path: VPath): VPath {
  const ptsAll: [number, number][] = [path.start, ...path.prims.map((p) => p.to)];
  const last = ptsAll[ptsAll.length - 1]!;
  const prims: Prim[] = [];
  for (let i = path.prims.length - 1; i >= 0; i--) {
    const pr = path.prims[i]!;
    const target = i === 0 ? path.start : path.prims[i - 1]!.to;
    prims.push(pr.k === 'line' ? { k: 'line', to: target } : { k: 'arc', to: target, r: pr.r, sweep: pr.sweep === 1 ? 0 : 1 });
  }
  return { start: last, prims };
}
