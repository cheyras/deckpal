// Pure tests for the hand-mask straightener (foil/line-snap.ts). No DB, no
// disk, no fixtures — synthetic "cards" with edges we know the coordinates of.
//
// What these lock down, because each is a promise that would rot silently:
//   1. Contours: a rect with a hole gives two loops with OPPOSITE winding, so
//      the nonzero rasterizer reproduces holes without special-casing them.
//   2. Stray marks (a slipped stylus dot, a pinhole) are filtered, not traced.
//   3. THE FEATURE: a wobbly hand line over a crisp printed edge lands ON the
//      printed edge, dead straight, to sub-pixel.
//   4. THE HONESTY BAR, which matters more: with NO printed edge to trace, it
//      straightens only to the human's own fit and invents nothing; a
//      deliberately curved stretch survives untouched; and an ambiguous band of
//      edges is refused rather than guessed.
//   5. Corners between two straightened lines actually meet.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_STRAIGHTEN_PARAMS,
  filterComponents,
  loopArea,
  rasterizePolygons,
  straightenMask,
  traceLoops,
  type SegmentReport,
} from '../line-snap.js';
import type { RgbaImage } from '../png.js';

const W = 200;
const H = 250;

/** Solid-fill helper: paint rect [x0,x1) × [y0,y1) with `v` into an alpha plane. */
function fillRect(a: Uint8Array, x0: number, x1: number, y0: number, y1: number, v: number): void {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) a[y * W + x] = v;
  }
}

/** A grey card with one crisp bright rectangle — edges at exactly these coords. */
function printedCard(x0: number, x1: number, y0: number, y1: number): RgbaImage {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const y = (i / W) | 0;
    const v = x >= x0 && x < x1 && y >= y0 && y < y1 ? 225 : 45;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return { width: W, height: H, rgba };
}

function flatCard(): RgbaImage {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 120;
    rgba[i * 4 + 3] = 255;
  }
  return { width: W, height: H, rgba };
}

/**
 * A hand-drawn attempt at the rect [x0,x1)×[y0,y1): every boundary wanders by
 * a couple of px, exactly the way a stylus does.
 */
function wobblyRect(x0: number, x1: number, y0: number, y1: number): Uint8Array {
  const a = new Uint8Array(W * H);
  const wob = (t: number, phase: number): number => Math.round(2 * Math.sin(t * 0.37 + phase) + Math.sin(t * 0.11 + phase));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside =
        x >= x0 + wob(y, 0) && x < x1 + wob(y, 1.3) && y >= y0 + wob(x, 0.4) && y < y1 + wob(x, 2.6);
      if (inside) a[y * W + x] = 255;
    }
  }
  return a;
}

/** First/last foil pixel per row (or column), over an interior span. */
function edgeProfile(alpha: Uint8Array, axis: 'left' | 'right' | 'top' | 'bottom', from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) {
    let found = -1;
    if (axis === 'left' || axis === 'right') {
      const range = axis === 'left' ? [...Array(W).keys()] : [...Array(W).keys()].reverse();
      for (const x of range) if (alpha[i * W + x]! >= 128) { found = x; break; }
    } else {
      const range = axis === 'top' ? [...Array(H).keys()] : [...Array(H).keys()].reverse();
      for (const y of range) if (alpha[y * W + i]! >= 128) { found = y; break; }
    }
    out.push(found);
  }
  return out;
}

const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
const longRuns = (segs: SegmentReport[]): SegmentReport[] => segs.filter((s) => s.lengthPx >= DEFAULT_STRAIGHTEN_PARAMS.minSegmentPx);

// ── 1. Contours ────────────────────────────────────────────────────────────

test('a region with a hole traces two loops with opposite winding', () => {
  const bin = new Uint8Array(W * H);
  fillRect(bin, 30, 170, 40, 210, 1);
  fillRect(bin, 70, 130, 80, 150, 0);
  const loops = traceLoops(bin, W, H);
  assert.equal(loops.length, 2, 'outer boundary + hole boundary');
  const areas = loops.map(loopArea).sort((a, b) => a - b);
  assert.ok(areas[0]! < 0 && areas[1]! > 0, `outer and hole must wind oppositely, got ${areas.join(',')}`);
  assert.equal(Math.abs(areas[0]!), 140 * 170, 'outer loop area is the rect');
  assert.equal(areas[1]!, 60 * 70, 'hole loop area is the hole');
});

test('rasterizing traced loops round-trips the region, holes included', () => {
  const bin = new Uint8Array(W * H);
  fillRect(bin, 30, 170, 40, 210, 1);
  fillRect(bin, 70, 130, 80, 150, 0);
  const alpha = rasterizePolygons(traceLoops(bin, W, H), W, H, 4);
  for (let i = 0; i < bin.length; i++) {
    assert.equal(alpha[i]! >= 128 ? 1 : 0, bin[i], `pixel ${i % W},${(i / W) | 0} round-trips`);
  }
});

// ── 2. Stray marks ─────────────────────────────────────────────────────────

test('stray specks and pinholes are filtered, not traced as geometry', () => {
  const bin = new Uint8Array(W * H);
  fillRect(bin, 30, 170, 40, 210, 1);
  fillRect(bin, 0, 5, 0, 5, 1); // slipped stylus in the corner
  fillRect(bin, 80, 88, 100, 108, 0); // pinhole
  const { bin: clean, dropped } = filterComponents(bin, W, H, DEFAULT_STRAIGHTEN_PARAMS.minComponentPx);
  assert.equal(dropped.length, 2);
  assert.deepEqual(dropped.map((d) => d.kind).sort(), ['foil', 'hole']);
  assert.equal(clean[0], 0, 'the speck is gone');
  assert.equal(clean[100 * W + 80], 1, 'the pinhole is filled');
  assert.equal(traceLoops(clean, W, H).length, 1, 'one clean loop remains');
});

// ── 3. The feature ─────────────────────────────────────────────────────────

test('a wobbly hand line lands on the printed edge it was tracing, dead straight', () => {
  const alpha = wobblyRect(40, 160, 50, 200);
  const before = edgeProfile(alpha, 'left', 80, 170);
  assert.ok(spread(before) >= 3, `the input must actually wobble (spread ${spread(before)})`);

  const r = straightenMask({ alpha, width: W, height: H, artwork: printedCard(40, 160, 50, 200), windowRects: [] });
  const runs = longRuns(r.segments);
  assert.equal(runs.length, 4, 'four sides');
  for (const s of runs) assert.equal(s.action, 'artwork', `${s.axis} run should snap to the print: ${s.reason}`);

  for (const [axis, want] of [["left", 40], ["right", 159], ["top", 50], ["bottom", 199]] as const) {
    const [from, to] = axis === 'left' || axis === 'right' ? [80, 170] : [60, 150];
    const prof = edgeProfile(r.alpha, axis, from, to);
    assert.equal(spread(prof), 0, `${axis} edge is perfectly straight (got ${JSON.stringify([...new Set(prof)])})`);
    assert.ok(Math.abs(prof[0]! - want) <= 1, `${axis} edge sits on the print (${prof[0]} vs ${want})`);
  }
});

test('corners between two straightened lines actually meet', () => {
  // A hand mask whose top-left corner was never closed — the exact defect on
  // Chey's Tropius: a diagonal shortcut where two edges should meet.
  const alpha = wobblyRect(40, 160, 50, 200);
  for (let y = 50; y < 90; y++) for (let x = 40; x < 40 + (90 - y); x++) alpha[y * W + x] = 0;

  const r = straightenMask({ alpha, width: W, height: H, artwork: printedCard(40, 160, 50, 200), windowRects: [] });
  assert.ok(r.cornersClosed >= 3, `corners were closed (got ${r.cornersClosed})`);
  const prof = edgeProfile(r.alpha, 'left', 52, 170);
  assert.equal(spread(prof), 0, 'the left edge runs unbroken through the corner that was missing');
});

// ── 4. The honesty bar ─────────────────────────────────────────────────────

test('with no printed edge to trace, it straightens to HIS line and invents nothing', () => {
  const alpha = wobblyRect(40, 160, 50, 200);
  const r = straightenMask({ alpha, width: W, height: H, artwork: flatCard(), windowRects: [] });
  const runs = longRuns(r.segments);
  assert.equal(runs.length, 4);
  for (const s of runs) {
    assert.equal(s.action, 'self', `no scan evidence ⇒ self-straighten only: ${s.reason}`);
    assert.ok(s.edge === null || s.edge.score < DEFAULT_STRAIGHTEN_PARAMS.edgeMinStrength, 'and it says the scan was blank');
    // Its own fit must stay where his hand was, on average.
    assert.ok(Math.abs((s.newPos ?? 0) - (s.handPos ?? 0)) < 1.5, `${s.axis} line stays where he drew it`);
  }
  assert.equal(spread(edgeProfile(r.alpha, 'left', 60, 120)), 0, 'but it IS straight now');
});

test('a deliberately curved stretch is left exactly as drawn', () => {
  const alpha = wobblyRect(40, 160, 50, 200);
  // Bite a big smooth arc out of the right edge — shape, not slop.
  const cy = 125;
  const cx = 160;
  for (let y = cy - 35; y < cy + 35; y++) {
    const dx = Math.round(Math.sqrt(Math.max(0, 35 * 35 - (y - cy) ** 2)));
    for (let x = cx - dx; x < W; x++) if (x >= 0) alpha[y * W + x] = 0;
  }
  const r = straightenMask({ alpha, width: W, height: H, artwork: printedCard(40, 160, 50, 200), windowRects: [] });
  const curved = r.segments.filter((s) => s.action === 'kept' && s.axis === 'free' && s.lengthPx > 30);
  assert.ok(curved.length >= 1, 'the arc is recognised as freehand, not a failed line');

  // And it is still an arc afterwards: the deepest bite survives.
  let deepest = W;
  for (let y = cy - 25; y < cy + 25; y++) {
    const prof = edgeProfile(r.alpha, 'right', y, y + 1)[0]!;
    if (prof < deepest) deepest = prof;
  }
  assert.ok(deepest <= cx - 28, `the arc kept its depth (rightmost foil reached x=${deepest})`);
});

test('an ambiguous band cannot RELOCATE his line, only nudge it', () => {
  // Two equally strong printed edges, 4px either side of where he drew. The
  // scan says "you were near an edge", not "you meant THAT edge" — so a
  // multi-pixel move is a guess and must be refused.
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const v = x < 36 ? 40 : x < 44 ? 145 : 250;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  const r = straightenMask({
    alpha: wobblyRect(40, 160, 50, 200),
    width: W,
    height: H,
    artwork: { width: W, height: H, rgba },
    windowRects: [],
  });
  const left = longRuns(r.segments).find((s) => s.axis === 'V' && (s.handPos ?? 0) < 80);
  assert.ok(left, 'the left run was analysed');
  assert.notEqual(left.action, 'artwork', `ambiguous band must not relocate him: ${left.reason}`);
  assert.ok(/comparable edges/.test(left.reason), `and it must say why: ${left.reason}`);
  assert.ok(Math.abs((left.newPos ?? 0) - (left.handPos ?? 0)) < 1.5, 'his line stays where he put it');
  assert.equal(spread(edgeProfile(r.alpha, 'left', 80, 170)), 0, 'straightened, just not moved');
});

test('with no scan at all it degrades to self-straightening and says so', () => {
  const r = straightenMask({ alpha: wobblyRect(40, 160, 50, 200), width: W, height: H, artwork: null, windowRects: [] });
  for (const s of longRuns(r.segments)) {
    assert.equal(s.edge, null);
    assert.ok(/no scan/.test(s.reason), s.reason);
  }
});
