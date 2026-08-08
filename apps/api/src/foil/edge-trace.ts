// foil/edge-trace.ts — the ARTWORK holds the geometry; his mask says which of it to follow.
//
// Chey, 2026-08-08, after reviewing the line-snap result: "I made changes to the
// tropius mask. Really just 'straighten' isn't quite enough, really just
// detecting edges and actually tracing accurately around them is the real move."
//
// THE PREMISE SHIFT. `line-snap@1` treated his strokes as the geometry and
// nudged near-straight runs onto printed lines where the evidence was strong,
// leaving everything else exactly as drawn. That frame is wrong. His mask is a
// STATEMENT OF INTENT — which regions of the card should carry foil. The
// ARTWORK holds the true geometry. So the output boundary is DERIVED FROM THE
// CARD'S OWN EDGES, traced accurately, with his mask used only to decide WHICH
// edge to follow and which side is inside. Curves, rounded corners, tag ends and
// panel fillets are first-class: they are the cases line-snap could not do at
// all, because a line fit cannot represent them.
//
// THE METHOD — livewire (intelligent scissors) over an edge-cost graph:
//
//   1. EDGE MAP        Di Zenzo colour structure tensor (a green→silver card
//                      boundary is a big CHROMA step and a small luminance one,
//                      so a luminance Sobel under-reads it) → non-maximum
//                      suppression → hysteresis linking. Canny-shaped, colour-aware.
//   2. CORRIDOR        A distance+index field around HIS boundary. Nothing
//                      outside `corridorPx` is reachable: the trace can crisp
//                      his line, never relocate it. His intent is a hard bound,
//                      not a suggestion.
//   3. ANCHORS         His boundary sampled every `anchorSpacingPx`, each snapped
//                      to the strongest ridge within `anchorSnapPx`. An anchor
//                      with no ridge is UNSUPPORTED and his line survives there.
//   4. TRACE           Dijkstra between consecutive supported anchors on
//                      cost = ridge + linked + proximity + direction. The path
//                      follows the printed edge wherever it goes — around a
//                      fillet, around the rounded end of a stage tag — because
//                      nothing in the cost function prefers straightness.
//   5. SUB-PIXEL       Each traced vertex is refined along the local path normal
//                      to the parabolic peak of |∂I/∂n|. A lattice path becomes
//                      a sub-pixel contour.
//   6. CRISP           Only THEN are genuinely straight stretches replaced by
//                      their total-least-squares line, so a straight printed edge
//                      comes out dead straight instead of a 1-px staircase. This
//                      is line-snap's move, demoted to a post-pass — the fallback,
//                      not the method.
//   7. RASTERIZE       Shared with line-snap: analytic in x, supersampled in y,
//                      nonzero winding (holes for free), his AA character kept.
//
// WHEN IT REFUSES (each a recorded param, each visible in the per-segment report):
//   - no artwork at all                                  ⇒ returns his mask untouched
//   - an anchor with no ridge ≥ `anchorMinStrength`       ⇒ unsupported, his line kept
//   - a traced path whose mean ridge < `segmentMinRidge`  ⇒ his line kept
//   - a traced path longer than `segmentMaxDetourRatio`×  ⇒ his line kept (a detour
//     his own span                                          around a texture blob is
//                                                            not the boundary he meant)
//   - no path inside the corridor                        ⇒ his line kept
//   - refinement only moves a vertex onto an edge ≥ `refineMinStrength`
//   - EVERY move is capped by `corridorPx` by construction
//
// Pure: pixels in, pixels + a report out. No I/O, no storage opinions — the
// generator wrapper (generator.ts `edge-trace`) is what the provenance system runs.

import type { RgbaImage } from './png.js';
import {
  filterComponents,
  measureSoftness,
  rasterizePolygons,
  robustFit,
  traceLoops,
  type DroppedComponent,
  type Gradient,
  type Vec,
} from './line-snap.js';

// ── Params ─────────────────────────────────────────────────────────────────

export interface EdgeTraceParams {
  /** Separable 1-2-1 passes before the gradient — kills scan/JPEG speckle. */
  presmoothPasses: number;
  /** Ridge magnitude at this percentile of the non-zero ridges becomes the strong threshold. */
  ridgeHighPercentile: number;
  /** Weak threshold = ridgeLowRatio × strong (hysteresis linking). */
  ridgeLowRatio: number;
  /** Absolute floor under the strong threshold, so a blank card cannot manufacture edges. */
  ridgeAbsFloor: number;

  /** HARD BOUND: no output pixel may sit further than this from his boundary. */
  corridorPx: number;
  /** Spacing of the anchors taken off his boundary, px of path length. */
  anchorSpacingPx: number;
  /**
   * EXTRA anchors wherever his own boundary turns hard. A corner, a tag end, a
   * notch — those are where his intent is most specific and where a shortest
   * path is most tempted to cut across. Turning angle over ±`cornerWindowPx`,
   * in degrees, above which a local maximum earns its own anchor.
   */
  cornerAnchorDeg: number;
  cornerWindowPx: number;
  /** How far an anchor may be snapped onto a ridge, px. */
  anchorSnapPx: number;
  /** Ridge magnitude an anchor needs before it counts as supported by the scan. */
  anchorMinStrength: number;

  /** Livewire cost weights (they sum to 1 by convention; only the ratio matters). */
  wRidge: number;
  wLinked: number;
  wProximity: number;
  wDirection: number;
  /**
   * Exponent on the proximity term. >1 makes sitting 1px off his stroke nearly
   * free while sitting 4px off is expensive — which is the difference between
   * crisping his line onto the edge under it and RELOCATING it onto a different
   * edge nearby (an element's drop shadow, the second edge of a border).
   */
  proximityPower: number;

  /** Mean ridge magnitude a traced path must carry to be accepted. */
  segmentMinRidge: number;
  /** Traced length / his length. Above this the path detoured; refuse it. */
  segmentMaxDetourRatio: number;

  /** Half-range of the sub-pixel normal search, px. */
  refineRadiusPx: number;
  /** Edge strength a vertex needs before refinement will move it. */
  refineMinStrength: number;
  /** Half-window (path vertices) for the tangent estimate used by refinement. */
  smoothWindowPx: number;

  /** Shortest traced stretch that may be crisped to a straight line, px. */
  minStraightPx: number;
  /** Residual RMS under which a traced stretch counts as genuinely straight, px. */
  straightResidPx: number;
  /**
   * WORST single deviation a stretch may have and still be called straight, px.
   *
   * This one is load-bearing. The robust fit trims outliers BY DESIGN, so a long
   * straight edge plus a 10px feature hanging off its end still fits "straight
   * to 0.3px RMS" — the feature having been discarded as an outlier — and
   * crisping would then FLATTEN the very thing the fit ignored. The rounded end
   * of a species strip, a corner fillet, a notch around a stage tag: exactly the
   * geometry this generator exists to keep. So a run counts as straight only if
   * EVERY point in it is close, outliers included.
   */
  straightMaxDevPx: number;

  /** Foil blobs / holes smaller than this are stray marks, not geometry, px. */
  minComponentPx: number;
  /** Vertical supersampling for the rasterizer (x is analytic). */
  supersample: number;
}

export const DEFAULT_EDGE_TRACE_PARAMS: EdgeTraceParams = {
  presmoothPasses: 1,
  ridgeHighPercentile: 0.9,
  ridgeLowRatio: 0.4,
  ridgeAbsFloor: 8,

  corridorPx: 5,
  anchorSpacingPx: 12,
  cornerAnchorDeg: 35,
  cornerWindowPx: 6,
  anchorSnapPx: 3,
  anchorMinStrength: 12,

  wRidge: 0.42,
  wLinked: 0.14,
  wProximity: 0.3,
  wDirection: 0.14,
  proximityPower: 2,

  segmentMinRidge: 10,
  segmentMaxDetourRatio: 1.6,

  refineRadiusPx: 2,
  refineMinStrength: 8,
  smoothWindowPx: 3,

  minStraightPx: 40,
  straightResidPx: 0.6,
  straightMaxDevPx: 1,

  minComponentPx: 128,
  supersample: 4,
};

const FOIL = 128;

// ── 1. The edge map ────────────────────────────────────────────────────────

/**
 * Di Zenzo colour structure tensor: J = Σ_c ∇I_c ∇I_cᵀ over R,G,B.
 *
 * Why not a luminance Sobel (what line-snap uses): the boundary that matters
 * most on a modern Pokémon card is the green printed field against the silver
 * card border. Their LUMINANCE is close; their CHROMA is not. Summing the
 * per-channel outer products keeps that signal, and it still answers the same
 * question a scalar gradient does — `edgeAlong()` below gives |∂I/∂n| for any
 * direction n, which is exactly what a boundary crossing needs.
 */
export interface Tensor {
  width: number;
  height: number;
  jxx: Float32Array;
  jxy: Float32Array;
  jyy: Float32Array;
  /** sqrt(λ+) — the strongest directional derivative at each pixel. */
  mag: Float32Array;
}

function presmooth(src: Float32Array, width: number, height: number, passes: number): Float32Array {
  let cur = src;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(cur.length);
    const out = new Float32Array(cur.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const l = cur[y * width + Math.max(0, x - 1)]!;
        const c = cur[y * width + x]!;
        const r = cur[y * width + Math.min(width - 1, x + 1)]!;
        tmp[y * width + x] = (l + 2 * c + r) / 4;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = tmp[Math.max(0, y - 1) * width + x]!;
        const c = tmp[y * width + x]!;
        const d = tmp[Math.min(height - 1, y + 1) * width + x]!;
        out[y * width + x] = (u + 2 * c + d) / 4;
      }
    }
    cur = out;
  }
  return cur;
}

export function structureTensor(img: RgbaImage, passes: number): Tensor {
  const { width, height, rgba } = img;
  const n = width * height;
  const jxx = new Float32Array(n);
  const jxy = new Float32Array(n);
  const jyy = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = rgba[i * 4 + c]!;
    const ch = presmooth(raw, width, height, passes);
    const S = (x: number, y: number): number =>
      ch[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Scharr 3×3 — measurably better rotational symmetry than Sobel, which
        // matters here precisely because we follow curves, not axis-aligned lines.
        const gx =
          (3 * S(x + 1, y - 1) + 10 * S(x + 1, y) + 3 * S(x + 1, y + 1) -
            3 * S(x - 1, y - 1) - 10 * S(x - 1, y) - 3 * S(x - 1, y + 1)) / 32;
        const gy =
          (3 * S(x - 1, y + 1) + 10 * S(x, y + 1) + 3 * S(x + 1, y + 1) -
            3 * S(x - 1, y - 1) - 10 * S(x, y - 1) - 3 * S(x + 1, y - 1)) / 32;
        const i = y * width + x;
        jxx[i] = jxx[i]! + gx * gx;
        jxy[i] = jxy[i]! + gx * gy;
        jyy[i] = jyy[i]! + gy * gy;
      }
    }
  }
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = jxx[i]!;
    const b = jxy[i]!;
    const d = jyy[i]!;
    const half = (a + d) / 2;
    const disc = Math.sqrt(Math.max(0, ((a - d) / 2) ** 2 + b * b));
    mag[i] = Math.sqrt(Math.max(0, half + disc));
  }
  return { width, height, jxx, jxy, jyy, mag };
}

/** Bilinear sample of a scalar plane. */
function sampleF(arr: Float32Array, width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  return (
    arr[y0 * width + x0]! * (1 - fx) * (1 - fy) +
    arr[y0 * width + x1]! * fx * (1 - fy) +
    arr[y1 * width + x0]! * (1 - fx) * fy +
    arr[y1 * width + x1]! * fx * fy
  );
}

/**
 * TWO COORDINATE FRAMES, and the half pixel between them.
 *
 * MASK space is what `traceLoops` emits and `rasterizePolygons` consumes: pixel
 * (x,y) occupies the unit square [x,x+1]×[y,y+1], so its CENTRE is (x+.5, y+.5).
 * IMAGE space is what a gradient array indexes: sample (x,y) IS that centre.
 * So an image lookup for a mask-space point P is `sampleF(…, P.x-.5, P.y-.5)`.
 *
 * Getting this wrong is invisible — everything still runs, the boundary just
 * sits half a pixel off the edge it claims to be on, in a direction that depends
 * on which way the boundary faces. Every artwork lookup in this module goes
 * through `edgeAlong` / the probes below, and they all convert here, once.
 */
const HALF = 0.5;

/** |∂I/∂n| at a sub-pixel MASK-SPACE point, for an arbitrary unit normal n. */
export function edgeAlong(t: Tensor, x: number, y: number, nx: number, ny: number): number {
  const a = sampleF(t.jxx, t.width, t.height, x - HALF, y - HALF);
  const b = sampleF(t.jxy, t.width, t.height, x - HALF, y - HALF);
  const d = sampleF(t.jyy, t.width, t.height, x - HALF, y - HALF);
  return Math.sqrt(Math.max(0, a * nx * nx + 2 * b * nx * ny + d * ny * ny));
}

/** Unit normal (direction of maximum change) at a pixel. */
function normalAt(t: Tensor, i: number): Vec {
  const theta = 0.5 * Math.atan2(2 * t.jxy[i]!, t.jxx[i]! - t.jyy[i]!);
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

export interface EdgeMap {
  tensor: Tensor;
  /** Ridge magnitude after non-maximum suppression; 0 where not a ridge. */
  ridge: Float32Array;
  /** Hysteresis-linked binary edge map (1 = a real, connected edge). */
  linked: Uint8Array;
  high: number;
  low: number;
}

export function buildEdgeMap(img: RgbaImage, p: EdgeTraceParams): EdgeMap {
  const tensor = structureTensor(img, p.presmoothPasses);
  const { width, height, mag } = tensor;
  const ridge = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const m = mag[i]!;
      if (m <= 0) continue;
      const n = normalAt(tensor, i);
      const a = sampleF(mag, width, height, x + n.x, y + n.y);
      const b = sampleF(mag, width, height, x - n.x, y - n.y);
      if (m >= a && m >= b) ridge[i] = m;
    }
  }
  // Adaptive thresholds: this card's own ridge distribution, floored absolutely
  // so a flat scan cannot promote texture into "edges".
  const nz: number[] = [];
  for (let i = 0; i < ridge.length; i++) if (ridge[i]! > 0) nz.push(ridge[i]!);
  nz.sort((a, b) => a - b);
  const pct = nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * p.ridgeHighPercentile))]! : 0;
  const high = Math.max(p.ridgeAbsFloor, pct);
  const low = Math.max(p.ridgeAbsFloor * 0.5, high * p.ridgeLowRatio);

  const linked = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let i = 0; i < ridge.length; i++) {
    if (ridge[i]! >= high) {
      linked[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (linked[j] || ridge[j]! < low) continue;
        linked[j] = 1;
        stack.push(j);
      }
    }
  }
  return { tensor, ridge, linked, high, low };
}

// ── 2. The corridor: his intent as a hard bound ────────────────────────────

interface Corridor {
  /** Distance to his boundary, px; Infinity outside the corridor. */
  dist: Float32Array;
  /** Index of the nearest sample on his boundary polyline; -1 outside. */
  idx: Int32Array;
  /** His boundary, resampled to ~1px spacing (the polyline the indices point into). */
  samples: Vec[];
}

/** Resample a closed polyline to approximately `step` px spacing. */
export function resampleClosed(loop: Vec[], step: number): Vec[] {
  const out: Vec[] = [];
  let carry = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    let t = carry;
    while (t < len) {
      out.push({ x: a.x + (dx * t) / len, y: a.y + (dy * t) / len });
      t += step;
    }
    carry = t - len;
  }
  return out.length >= 3 ? out : loop;
}

function buildCorridor(loop: Vec[], width: number, height: number, radius: number): Corridor {
  const samples = resampleClosed(loop, 1);
  const dist = new Float32Array(width * height).fill(Infinity);
  const idx = new Int32Array(width * height).fill(-1);
  const r = Math.ceil(radius);
  for (const [si, s] of samples.entries()) {
    const x0 = Math.max(0, Math.floor(s.x) - r);
    const x1 = Math.min(width - 1, Math.ceil(s.x) + r);
    const y0 = Math.max(0, Math.floor(s.y) - r);
    const y1 = Math.min(height - 1, Math.ceil(s.y) + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y);
        if (d > radius) continue;
        const i = y * width + x;
        if (d < dist[i]!) {
          dist[i] = d;
          idx[i] = si;
        }
      }
    }
  }
  return { dist, idx, samples };
}

// ── 3. Livewire: Dijkstra over the edge-cost graph ─────────────────────────

/** Minimal binary heap keyed by cost — a sort-per-pop would dominate the runtime. */
class Heap {
  private readonly cost: number[] = [];
  private readonly node: number[] = [];
  get size(): number {
    return this.node.length;
  }
  push(node: number, cost: number): void {
    this.node.push(node);
    this.cost.push(cost);
    let i = this.node.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p]! <= this.cost[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): { node: number; cost: number } | null {
    if (this.node.length === 0) return null;
    const node = this.node[0]!;
    const cost = this.cost[0]!;
    const ln = this.node.pop()!;
    const lc = this.cost.pop()!;
    if (this.node.length) {
      this.node[0] = ln;
      this.cost[0] = lc;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.node.length && this.cost[l]! < this.cost[m]!) m = l;
        if (r < this.node.length && this.cost[r]! < this.cost[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return { node, cost };
  }
  private swap(a: number, b: number): void {
    [this.node[a], this.node[b]] = [this.node[b]!, this.node[a]!];
    [this.cost[a], this.cost[b]] = [this.cost[b]!, this.cost[a]!];
  }
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

interface LivewireCtx {
  edges: EdgeMap;
  corridor: Corridor;
  width: number;
  height: number;
  p: EdgeTraceParams;
  /** Normalizer for ridge magnitude → 0..1. */
  scale: number;
}

/**
 * Per-node cost of ENTERING q from p. Four terms, each doing one job:
 *   ridge      — be on a strong edge maximum
 *   linked     — be on an edge the hysteresis actually connected (kills specks)
 *   proximity  — stay near where HE put it (this is what makes his mask the
 *                arbiter of *which* edge, not just *an* edge)
 *   direction  — travel ALONG the edge, not across it
 */
function stepCost(ctx: LivewireCtx, from: number, to: number): number {
  const { edges, corridor, p, scale } = ctx;
  const fx = from % ctx.width;
  const fy = (from / ctx.width) | 0;
  const tx = to % ctx.width;
  const ty = (to / ctx.width) | 0;
  const len = Math.hypot(tx - fx, ty - fy);
  const r = Math.min(1, edges.ridge[to]! / scale);
  const linked = edges.linked[to] ? 0 : 1;
  const prox = Math.min(1, corridor.dist[to]! / p.corridorPx) ** p.proximityPower;
  // Edge tangent at `to`; a step aligned with it is free, a step across it is not.
  const th = 0.5 * Math.atan2(2 * edges.tensor.jxy[to]!, edges.tensor.jxx[to]! - edges.tensor.jyy[to]!);
  const tanx = -Math.sin(th);
  const tany = Math.cos(th);
  const ux = (tx - fx) / (len || 1);
  const uy = (ty - fy) / (len || 1);
  const dir = edges.ridge[to]! > 0 ? 1 - Math.abs(ux * tanx + uy * tany) : 0.5;
  return (
    len * (p.wRidge * (1 - r) + p.wLinked * linked + p.wProximity * prox + p.wDirection * dir) + 1e-4
  );
}

/**
 * Shortest edge-cost path from `start` to `goal`, restricted to the corridor and
 * to the arc of his boundary between the two anchors (plus slack). The arc
 * restriction is what keeps a Dijkstra cheap AND stops a path from short-cutting
 * backwards along the loop.
 */
function livewire(
  ctx: LivewireCtx,
  start: number,
  goal: number,
  arcFrom: number,
  arcTo: number,
  slack: number,
): number[] | null {
  const total = ctx.corridor.samples.length;
  const inArc = (i: number): boolean => {
    if (i < 0) return false;
    // Circular window [arcFrom - slack, arcTo + slack].
    const span = (arcTo - arcFrom + total) % total;
    const rel = (i - arcFrom + total) % total;
    if (rel <= span + slack) return true;
    return total - rel <= slack;
  };
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new Heap();
  dist.set(start, 0);
  heap.push(start, 0);
  const done = new Set<number>();
  let guard = 0;
  while (heap.size) {
    const top = heap.pop()!;
    if (done.has(top.node)) continue;
    done.add(top.node);
    if (top.node === goal) break;
    if (++guard > 400000) return null;
    const x = top.node % ctx.width;
    const y = (top.node / ctx.width) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
      const q = ny * ctx.width + nx;
      if (done.has(q)) continue;
      if (!Number.isFinite(ctx.corridor.dist[q]!)) continue;
      if (q !== goal && !inArc(ctx.corridor.idx[q]!)) continue;
      const nd = top.cost + stepCost(ctx, top.node, q);
      const old = dist.get(q);
      if (old !== undefined && old <= nd) continue;
      dist.set(q, nd);
      prev.set(q, top.node);
      heap.push(q, nd);
    }
  }
  if (!done.has(goal)) return null;
  const path: number[] = [];
  let cur = goal;
  for (let i = 0; i < 100000; i++) {
    path.push(cur);
    if (cur === start) break;
    const pnode = prev.get(cur);
    if (pnode === undefined) return null;
    cur = pnode;
  }
  return path.reverse();
}

// ── 4. Sub-pixel refinement ────────────────────────────────────────────────

/**
 * Push each vertex onto the parabolic peak of |∂I/∂n| along the local path
 * normal. This is what turns an 8-connected lattice path into a contour that
 * sits on the true printed edge to a fraction of a pixel — including on curves,
 * where a line fit has nothing to offer.
 */
function refineSubpixel(pts: Vec[], edges: EdgeMap, p: EdgeTraceParams, cap: (v: Vec) => Vec): Vec[] {
  const n = pts.length;
  const w = Math.max(1, Math.min(p.smoothWindowPx, Math.floor(n / 4)));
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - w)]!;
    const b = pts[Math.min(n - 1, i + w)]!;
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      out.push(pts[i]!);
      continue;
    }
    const nx = -ty / tl;
    const ny = tx / tl;
    const q = pts[i]!;
    const step = 0.25;
    let bestT = 0;
    let bestV = -1;
    for (let t = -p.refineRadiusPx; t <= p.refineRadiusPx + 1e-9; t += step) {
      const v = edgeAlong(edges.tensor, q.x + nx * t, q.y + ny * t, nx, ny);
      if (v > bestV) {
        bestV = v;
        bestT = t;
      }
    }
    if (bestV < p.refineMinStrength) {
      out.push(q);
      continue;
    }
    // Parabolic vertex through the three samples around the discrete max.
    const vm = edgeAlong(edges.tensor, q.x + nx * (bestT - step), q.y + ny * (bestT - step), nx, ny);
    const vp = edgeAlong(edges.tensor, q.x + nx * (bestT + step), q.y + ny * (bestT + step), nx, ny);
    const denom = vm - 2 * bestV + vp;
    const sub = Math.abs(denom) > 1e-6 ? (0.5 * (vm - vp)) / denom : 0;
    const t = bestT + Math.max(-1, Math.min(1, sub)) * step;
    out.push(cap({ x: q.x + nx * t, y: q.y + ny * t }));
  }
  return out;
}

// ── 5. Crisping: straight where it really is straight ──────────────────────

/**
 * A traced path along a straight printed edge is straight to within the lattice
 * plus the sub-pixel refinement's own noise. Fitting those stretches and
 * projecting onto the fit removes that last jitter WITHOUT touching curvature:
 * a run only qualifies if its own robust residual is under `straightResidPx`,
 * which a fillet or a rounded tag end never is.
 */
function crispStraightRuns(pts: Vec[], p: EdgeTraceParams): { pts: Vec[]; runs: number; straightPx: number } {
  const n = pts.length;
  if (n < p.minStraightPx * 2) return { pts, runs: 0, straightPx: 0 };
  const out = pts.map((q) => ({ ...q }));
  /** Straight means straight for EVERY point, not for the survivors of a trim. */
  const straight = (from: number, to: number): ReturnType<typeof robustFit> => {
    const slice = pts.slice(from, to);
    const f = robustFit(slice);
    if (!f || f.residRms > p.straightResidPx) return null;
    for (const q of slice) {
      if (Math.abs(f.line.nx * q.x + f.line.ny * q.y - f.line.c) > p.straightMaxDevPx) return null;
    }
    return f;
  };
  let runs = 0;
  let straightPx = 0;
  let i = 0;
  while (i < n) {
    // Grow a window while it stays straight.
    let j = i + p.minStraightPx;
    if (j > n) break;
    let fit = straight(i, j);
    if (!fit) {
      i++;
      continue;
    }
    let best = fit;
    while (j < n) {
      const trial = straight(i, j + 1);
      if (!trial) break;
      best = trial;
      j++;
    }
    fit = best;
    const dir = { x: -fit.line.ny, y: fit.line.nx };
    for (let k = i; k < j; k++) {
      const q = pts[k]!;
      const t = q.x * dir.x + q.y * dir.y;
      out[k] = { x: fit.line.nx * fit.line.c + dir.x * t, y: fit.line.ny * fit.line.c + dir.y * t };
    }
    runs++;
    straightPx += j - i;
    i = j;
  }
  return { pts: out, runs, straightPx };
}

// ── 6. Per-loop tracing ────────────────────────────────────────────────────

export type TraceAction = 'traced' | 'kept';

export interface TraceSegmentReport {
  loop: number;
  index: number;
  action: TraceAction;
  reason: string;
  /** Length of HIS boundary over this stretch, px. */
  handLengthPx: number;
  /** Length of the traced path, px (null when kept). */
  tracedLengthPx: number | null;
  /** Mean ridge magnitude along the traced path (null when kept). */
  meanRidge: number | null;
  /** How far the output moved from his line over this stretch. */
  meanMovePx: number | null;
  maxMovePx: number | null;
  /** Ridge magnitude found at the two anchors bounding this stretch. */
  anchorStrength: [number, number] | null;
}

export interface Anchor {
  /** Index into the resampled boundary (his line at 1px spacing). */
  sample: number;
  /** Pixel index the anchor snapped to. */
  pixel: number;
  strength: number;
  supported: boolean;
  /** True when this anchor exists because HIS boundary turns hard here. */
  corner: boolean;
}

/**
 * Anchors: uniform spacing PLUS every hard turn in his own boundary.
 *
 * Uniform anchors alone let a shortest path cut across a small feature — the
 * pointed tail of a species strip, a notch around a stage tag — because the
 * detour costs more than the straight run and no anchor forces the issue. His
 * corners are exactly where his intent is most specific, so they get anchors of
 * their own. Exported because an anchor overlay is the fastest way to see why a
 * trace went where it went.
 */
export function computeAnchors(
  samples: Vec[],
  edges: EdgeMap,
  width: number,
  height: number,
  p: EdgeTraceParams,
): Anchor[] {
  const total = samples.length;
  const corners = new Set<number>();
  const w = Math.max(2, Math.round(p.cornerWindowPx));
  const turn = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const a = samples[(i - w + total) % total]!;
    const b = samples[i]!;
    const c = samples[(i + w) % total]!;
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = ((a2 - a1) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    turn[i] = Math.abs(d);
  }
  for (let i = 0; i < total; i++) {
    if (turn[i]! < p.cornerAnchorDeg) continue;
    let isMax = true;
    for (let k = -w; k <= w; k++) {
      if (turn[(i + k + total) % total]! > turn[i]!) {
        isMax = false;
        break;
      }
    }
    if (isMax) corners.add(i);
  }
  const picked = new Set<number>(corners);
  const count = Math.max(3, Math.round(total / p.anchorSpacingPx));
  for (let a = 0; a < count; a++) picked.add(Math.round((a * total) / count) % total);

  const out: Anchor[] = [];
  for (const si of [...picked].sort((a, b) => a - b)) {
    const s = samples[si]!;
    let bestPx =
      Math.min(height - 1, Math.max(0, Math.round(s.y - HALF))) * width +
      Math.min(width - 1, Math.max(0, Math.round(s.x - HALF)));
    let bestScore = -1;
    let bestStrength = 0;
    const r = Math.ceil(p.anchorSnapPx);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.round(s.x - HALF) + dx;
        const y = Math.round(s.y - HALF) + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const d = Math.hypot(x + HALF - s.x, y + HALF - s.y);
        if (d > p.anchorSnapPx) continue;
        const i = y * width + x;
        const ridge = edges.ridge[i]!;
        if (ridge <= 0) continue;
        // Strength first, proximity as the tie-break — a marginally stronger
        // ridge 3px away must not beat the one his hand is sitting on.
        const score = ridge * Math.exp(-0.5 * (d / (p.anchorSnapPx / 1.5)) ** 2);
        if (score > bestScore) {
          bestScore = score;
          bestPx = i;
          bestStrength = ridge;
        }
      }
    }
    out.push({
      sample: si,
      pixel: bestPx,
      strength: Number(bestStrength.toFixed(2)),
      supported: bestStrength >= p.anchorMinStrength,
      corner: corners.has(si),
    });
  }
  return out;
}

function traceLoop(
  loopIndex: number,
  loop: Vec[],
  edges: EdgeMap,
  width: number,
  height: number,
  p: EdgeTraceParams,
  scale: number,
): { pts: Vec[]; reports: TraceSegmentReport[]; straightRuns: number; straightPx: number } {
  const corridor = buildCorridor(loop, width, height, p.corridorPx);
  const samples = corridor.samples;
  const total = samples.length;
  const ctx: LivewireCtx = { edges, corridor, width, height, p, scale };

  if (total < p.anchorSpacingPx * 3) {
    return {
      pts: loop,
      reports: [
        {
          loop: loopIndex,
          index: 0,
          action: 'kept',
          reason: `loop is only ${total}px around — too small to anchor, kept exactly as drawn`,
          handLengthPx: total,
          tracedLengthPx: null,
          meanRidge: null,
          meanMovePx: null,
          maxMovePx: null,
          anchorStrength: null,
        },
      ],
      straightRuns: 0,
      straightPx: 0,
    };
  }

  const anchors = computeAnchors(samples, edges, width, height, p);

  // ── Trace between consecutive anchors; keep his line where evidence fails ──
  const reports: TraceSegmentReport[] = [];
  const pieces: Vec[][] = [];
  /** Index range each report occupies in the concatenated path (for move stats). */
  const spans: { from: number; to: number }[] = [];
  const handBetween = (from: number, to: number): Vec[] => {
    const out: Vec[] = [];
    let i = from;
    for (let guard = 0; guard <= total; guard++) {
      out.push(samples[i]!);
      if (i === to) break;
      i = (i + 1) % total;
    }
    return out;
  };
  const pathLen = (pts: Vec[]): number => {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    return s;
  };

  for (let a = 0; a < anchors.length; a++) {
    const A = anchors[a]!;
    const B = anchors[(a + 1) % anchors.length]!;
    const hand = handBetween(A.sample, B.sample);
    const handLen = pathLen(hand);
    const base = {
      loop: loopIndex,
      index: a,
      handLengthPx: Number(handLen.toFixed(1)),
      anchorStrength: [A.strength, B.strength] as [number, number],
    };
    const push = (pts: Vec[]): void => {
      const from = pieces.reduce((n, q) => n + q.length, 0);
      pieces.push(pts);
      spans.push({ from, to: from + pts.length });
    };
    const keep = (reason: string): void => {
      push(hand.slice(0, -1));
      reports.push({
        ...base,
        action: 'kept',
        reason,
        tracedLengthPx: null,
        meanRidge: null,
        meanMovePx: null,
        maxMovePx: null,
      });
    };
    if (!A.supported || !B.supported) {
      keep(
        `no printed edge under his stroke at ${!A.supported ? 'the start' : 'the end'} of this stretch ` +
          `(ridge ${A.strength}/${B.strength} < ${p.anchorMinStrength}) — kept exactly as drawn`,
      );
      continue;
    }
    if (A.pixel === B.pixel) {
      // Two anchors that snapped to the same pixel (a hard corner earns several).
      // There is no stretch between them to trace; passing his own point through
      // is exact, not a refusal.
      keep('degenerate stretch — both anchors snapped to the same pixel');
      continue;
    }
    const slack = Math.ceil(p.anchorSpacingPx / 2);
    const px = livewire(ctx, A.pixel, B.pixel, A.sample, B.sample, slack);
    if (!px || px.length < 2) {
      keep('no path along a printed edge inside the corridor — kept exactly as drawn');
      continue;
    }
    const pts = px.map((i) => ({ x: (i % width) + 0.5, y: ((i / width) | 0) + 0.5 }));
    const tracedLen = pathLen(pts);
    if (tracedLen > handLen * p.segmentMaxDetourRatio && handLen > 4) {
      keep(
        `the best edge path detours ${(tracedLen / handLen).toFixed(2)}× his own span ` +
          `(> ${p.segmentMaxDetourRatio}) — that is a texture excursion, not his boundary`,
      );
      continue;
    }
    let ridgeSum = 0;
    for (const i of px) ridgeSum += edges.ridge[i]!;
    const meanRidge = ridgeSum / px.length;
    if (meanRidge < p.segmentMinRidge) {
      keep(`the best edge path carries only ${meanRidge.toFixed(1)} mean ridge (< ${p.segmentMinRidge}) — kept as drawn`);
      continue;
    }
    push(pts.slice(0, -1));
    reports.push({
      ...base,
      action: 'traced',
      reason: `traced the printed edge (mean ridge ${meanRidge.toFixed(1)}, anchors ${A.strength}/${B.strength})`,
      tracedLengthPx: Number(tracedLen.toFixed(1)),
      meanRidge: Number(meanRidge.toFixed(2)),
      meanMovePx: null,
      maxMovePx: null,
    });
  }

  const raw = pieces.flat();
  if (raw.length < 3) return { pts: loop, reports, straightRuns: 0, straightPx: 0 };

  // ── Sub-pixel, then crisp — with the corridor still enforced ──
  const capToCorridor = (v: Vec): Vec => {
    const i =
      Math.min(height - 1, Math.max(0, Math.round(v.y - 0.5))) * width +
      Math.min(width - 1, Math.max(0, Math.round(v.x - 0.5)));
    const d = corridor.dist[i]!;
    if (Number.isFinite(d)) return v;
    // Outside the corridor: pull back to the nearest of his samples.
    let best = v;
    let bestD = Infinity;
    for (const s of samples) {
      const dd = Math.hypot(s.x - v.x, s.y - v.y);
      if (dd < bestD) {
        bestD = dd;
        best = s;
      }
    }
    return best;
  };
  // Both passes are strictly index-preserving, so `spans` still addresses the
  // same stretches after refinement and crisping.
  const refined = refineSubpixel(raw, edges, p, capToCorridor);
  const crisped = crispStraightRuns(refined, p);

  // Per-segment movement, measured against HIS boundary — the honest number for
  // "how far did the machine move his line here".
  const nearestHand = (v: Vec): number => {
    let best = Infinity;
    for (const s of samples) {
      const d = (s.x - v.x) ** 2 + (s.y - v.y) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  for (const [i, rep] of reports.entries()) {
    if (rep.action !== 'traced') continue;
    const span = spans[i];
    if (!span) continue;
    let sum = 0;
    let max = 0;
    let n = 0;
    for (let k = span.from; k < Math.min(span.to, crisped.pts.length); k++) {
      const d = nearestHand(crisped.pts[k]!);
      sum += d;
      if (d > max) max = d;
      n++;
    }
    rep.meanMovePx = n ? Number((sum / n).toFixed(2)) : null;
    rep.maxMovePx = n ? Number(max.toFixed(2)) : null;
  }
  return { pts: crisped.pts, reports, straightRuns: crisped.runs, straightPx: crisped.straightPx };
}

// ── 7. Edge adherence — the number that settles the argument ───────────────

export interface AdherenceParams {
  /** Half-range of the normal search for the nearest edge maximum, px. */
  searchPx: number;
  /** Edge strength below which "there is no edge here" is the honest reading. */
  strengthFloor: number;
  /** Sample spacing along the boundary, px. */
  samplePx: number;
}

export const DEFAULT_ADHERENCE_PARAMS: AdherenceParams = { searchPx: 4, strengthFloor: 12, samplePx: 0.5 };

export interface Adherence {
  /** Total boundary length measured, px. */
  boundaryPx: number;
  /** Fraction of boundary with ANY edge ≥ floor within searchPx. */
  supportedFrac: number;
  /** Fraction of ALL boundary within 1px of a detected edge maximum. */
  within1px: number;
  /** Same, but as a fraction of the SUPPORTED boundary (adherence given evidence). */
  within1pxOfSupported: number;
  /** Mean |distance to nearest edge maximum| over supported boundary, px. */
  meanDistPx: number;
  p95DistPx: number;
  maxDistPx: number;
  /** Mean edge strength found at the nearest maximum, over supported boundary. */
  meanStrength: number;
}

/**
 * Marching squares at the alpha half-level: a SUB-PIXEL boundary that respects
 * the antialiasing, so a mask whose edge sits at 0.4px is not scored as if it
 * sat on the pixel lattice. All three masks are measured the same way.
 */
export function contourSegments(alpha: Uint8Array, width: number, height: number, level = 127.5): { a: Vec; b: Vec }[] {
  const segs: { a: Vec; b: Vec }[] = [];
  const at = (x: number, y: number): number => alpha[y * width + x]!;
  const lerp = (p0: Vec, p1: Vec, v0: number, v1: number): Vec => {
    const t = Math.abs(v1 - v0) < 1e-9 ? 0.5 : (level - v0) / (v1 - v0);
    return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
  };
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const v00 = at(x, y);
      const v10 = at(x + 1, y);
      const v11 = at(x + 1, y + 1);
      const v01 = at(x, y + 1);
      const code = (v00 >= level ? 1 : 0) | (v10 >= level ? 2 : 0) | (v11 >= level ? 4 : 0) | (v01 >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      // Pixel CENTRES are the lattice: (x+0.5, y+0.5).
      const P00 = { x: x + 0.5, y: y + 0.5 };
      const P10 = { x: x + 1.5, y: y + 0.5 };
      const P11 = { x: x + 1.5, y: y + 1.5 };
      const P01 = { x: x + 0.5, y: y + 1.5 };
      const top = (): Vec => lerp(P00, P10, v00, v10);
      const right = (): Vec => lerp(P10, P11, v10, v11);
      const bottom = (): Vec => lerp(P01, P11, v01, v11);
      const left = (): Vec => lerp(P00, P01, v00, v01);
      switch (code) {
        case 1: case 14: segs.push({ a: left(), b: top() }); break;
        case 2: case 13: segs.push({ a: top(), b: right() }); break;
        case 3: case 12: segs.push({ a: left(), b: right() }); break;
        case 4: case 11: segs.push({ a: right(), b: bottom() }); break;
        case 6: case 9: segs.push({ a: top(), b: bottom() }); break;
        case 7: case 8: segs.push({ a: left(), b: bottom() }); break;
        case 5: segs.push({ a: left(), b: top() }); segs.push({ a: right(), b: bottom() }); break;
        case 10: segs.push({ a: top(), b: right() }); segs.push({ a: left(), b: bottom() }); break;
      }
    }
  }
  return segs;
}

/**
 * line-snap's OWN luminance Sobel, packaged as an adherence probe.
 *
 * Deliberately not the operator edge-trace optimises: scoring a tracer with its
 * own edge map is how you get a number that means nothing. Using the previous
 * generator's operator puts the home-field advantage on the INCUMBENT.
 */
export function luminanceProbe(g: Gradient): (x: number, y: number, nx: number, ny: number) => number {
  return (x, y, nx, ny) =>
    Math.abs(
      sampleF(g.gx, g.width, g.height, x - HALF, y - HALF) * nx +
        sampleF(g.gy, g.width, g.height, x - HALF, y - HALF) * ny,
    );
}

/** The colour structure tensor as a probe — the secondary, chroma-aware reading. */
export function tensorProbe(t: Tensor): (x: number, y: number, nx: number, ny: number) => number {
  return (x, y, nx, ny) => edgeAlong(t, x, y, nx, ny);
}

/**
 * How well does this mask's boundary sit on the card's real printed edges?
 *
 * `probe(x, y, nx, ny)` is supplied by the caller so the metric can be run with
 * a DIFFERENT edge operator than the one a generator optimised — which is the
 * only way the number means anything. The comparisons in DECISIONS use
 * line-snap's own luminance Sobel, i.e. the operator that flatters line-snap.
 */
export function measureAdherence(
  alpha: Uint8Array,
  width: number,
  height: number,
  probe: (x: number, y: number, nx: number, ny: number) => number,
  p: AdherenceParams = DEFAULT_ADHERENCE_PARAMS,
): Adherence {
  const segs = contourSegments(alpha, width, height);
  let boundary = 0;
  let supported = 0;
  let within = 0;
  let withinSupported = 0;
  let distSum = 0;
  let strengthSum = 0;
  let maxDist = 0;
  const dists: { d: number; w: number }[] = [];
  for (const s of segs) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const n = Math.max(1, Math.ceil(len / p.samplePx));
    const w = len / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const px = s.a.x + dx * t;
      const py = s.a.y + dy * t;
      // NEAREST edge maximum, not the strongest in the band. "Is this boundary
      // sitting on a printed edge" is a question about the edge UNDER it; the
      // strongest ridge within ±4px is routinely a different edge (a card border
      // has two), and scoring against that measures the wrong thing.
      //
      // PLATEAUX ARE CENTRED, not read at their first sample. A step edge that
      // falls exactly between two pixel centres gives a symmetric gradient with
      // a flat two-pixel top; taking its first sample would report every such
      // edge as half a pixel away — for every mask, forever, invisibly.
      const step = 0.25;
      const prof: number[] = [];
      for (let d = -p.searchPx; d <= p.searchPx + 1e-9; d += step) prof.push(probe(px + nx * d, py + ny * d, nx, ny));
      const eps = 1e-6;
      let bestV = -1;
      let bestT = Infinity;
      for (let i = 1; i < prof.length - 1; i++) {
        const v = prof[i]!;
        if (v < p.strengthFloor || v < prof[i - 1]! - eps) continue;
        let j = i;
        while (j + 1 < prof.length - 1 && Math.abs(prof[j + 1]! - v) <= eps) j++;
        if (prof[j + 1]! > v + eps) {
          i = j;
          continue; // still climbing — this is a shoulder, not a maximum
        }
        const d = -p.searchPx + ((i + j) / 2) * step;
        if (Math.abs(d) < Math.abs(bestT)) {
          bestT = d;
          bestV = v;
        }
        i = j;
      }
      boundary += w;
      if (bestV < p.strengthFloor) continue;
      supported += w;
      strengthSum += bestV * w;
      const ad = Math.abs(bestT);
      distSum += ad * w;
      dists.push({ d: ad, w });
      if (ad > maxDist) maxDist = ad;
      if (ad <= 1) {
        within += w;
        withinSupported += w;
      }
    }
  }
  dists.sort((a, b) => a.d - b.d);
  let acc = 0;
  let p95 = 0;
  for (const e of dists) {
    acc += e.w;
    if (acc >= supported * 0.95) {
      p95 = e.d;
      break;
    }
  }
  const r4 = (v: number): number => Number(v.toFixed(4));
  return {
    boundaryPx: Number(boundary.toFixed(1)),
    supportedFrac: boundary ? r4(supported / boundary) : 0,
    within1px: boundary ? r4(within / boundary) : 0,
    within1pxOfSupported: supported ? r4(withinSupported / supported) : 0,
    meanDistPx: supported ? r4(distSum / supported) : 0,
    p95DistPx: Number(p95.toFixed(3)),
    maxDistPx: Number(maxDist.toFixed(3)),
    meanStrength: supported ? Number((strengthSum / supported).toFixed(2)) : 0,
  };
}

// ── 8. The entry point ─────────────────────────────────────────────────────

export interface EdgeTraceInput {
  /** His mask's alpha plane, width*height. Alpha IS the mask. */
  alpha: Uint8Array;
  width: number;
  height: number;
  /** The card scan at the same resolution. Null ⇒ it refuses to do anything. */
  artwork: RgbaImage | null;
  params?: Partial<EdgeTraceParams>;
}

export interface EdgeTraceResult {
  alpha: Uint8Array;
  params: EdgeTraceParams;
  segments: TraceSegmentReport[];
  dropped: DroppedComponent[];
  loops: { points: number; segments: number; traced: number; kept: number; area: number }[];
  /** Path length traced from the artwork, and length kept exactly as he drew it. */
  tracedPx: number;
  keptPx: number;
  straightRuns: number;
  straightPx: number;
  softness: { source: number; result: number };
  changedPx: number;
  changedFraction: number;
  agreementWithSource: number;
  edgeThresholds: { high: number; low: number };
  refused: string | null;
}

export function edgeTraceMask(input: EdgeTraceInput): EdgeTraceResult {
  const p: EdgeTraceParams = { ...DEFAULT_EDGE_TRACE_PARAMS, ...(input.params ?? {}) };
  const { width, height } = input;
  const empty = (refused: string): EdgeTraceResult => ({
    alpha: input.alpha,
    params: p,
    segments: [],
    dropped: [],
    loops: [],
    tracedPx: 0,
    keptPx: 0,
    straightRuns: 0,
    straightPx: 0,
    softness: { source: measureSoftness(input.alpha, width, height), result: measureSoftness(input.alpha, width, height) },
    changedPx: 0,
    changedFraction: 0,
    agreementWithSource: 1,
    edgeThresholds: { high: 0, low: 0 },
    refused,
  });
  if (!input.artwork) {
    return empty('no card scan was supplied — edge-trace has no geometry to trace and returns his mask untouched');
  }

  const bin0 = new Uint8Array(width * height);
  for (let i = 0; i < bin0.length; i++) bin0[i] = input.alpha[i]! >= FOIL ? 1 : 0;
  const { bin, dropped } = filterComponents(bin0, width, height, p.minComponentPx);

  const edges = buildEdgeMap(input.artwork, p);
  const scale = Math.max(edges.high, 1);
  const loops = traceLoops(bin, width, height);
  const segments: TraceSegmentReport[] = [];
  const rebuilt: Vec[][] = [];
  const loopStats: EdgeTraceResult['loops'] = [];
  let tracedPx = 0;
  let keptPx = 0;
  let straightRuns = 0;
  let straightPx = 0;

  for (const [li, loop] of loops.entries()) {
    const r = traceLoop(li, loop, edges, width, height, p, scale);
    segments.push(...r.reports);
    rebuilt.push(r.pts);
    straightRuns += r.straightRuns;
    straightPx += r.straightPx;
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    const traced = r.reports.filter((s) => s.action === 'traced');
    const kept = r.reports.filter((s) => s.action === 'kept');
    tracedPx += traced.reduce((a, s) => a + s.handLengthPx, 0);
    keptPx += kept.reduce((a, s) => a + s.handLengthPx, 0);
    loopStats.push({
      points: loop.length,
      segments: r.reports.length,
      traced: traced.length,
      kept: kept.length,
      area: Number((area / 2).toFixed(1)),
    });
  }

  let alpha = rasterizePolygons(rebuilt, width, height, p.supersample);
  const srcSoft = measureSoftness(input.alpha, width, height);
  const resSoft = measureSoftness(alpha, width, height);
  if (srcSoft > resSoft + 0.8) {
    // Match his airbrush character, exactly as line-snap does.
    const r = Math.max(1, Math.round((srcSoft - resSoft) * 0.8));
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
    alpha = out;
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
    tracedPx: Number(tracedPx.toFixed(1)),
    keptPx: Number(keptPx.toFixed(1)),
    straightRuns,
    straightPx,
    softness: { source: srcSoft, result: measureSoftness(alpha, width, height) },
    changedPx: changed,
    changedFraction: Number((changed / (width * height)).toFixed(6)),
    agreementWithSource: union === 0 ? 1 : Number((inter / union).toFixed(4)),
    edgeThresholds: { high: Number(edges.high.toFixed(2)), low: Number(edges.low.toFixed(2)) },
    refused: null,
  };
}
