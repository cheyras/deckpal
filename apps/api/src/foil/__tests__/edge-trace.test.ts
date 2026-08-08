// Pure tests for the edge tracer (foil/edge-trace.ts). No DB, no disk, no
// fixtures — synthetic "cards" whose printed geometry we know exactly, so
// "did it land on the edge" is a arithmetic question, not a judgement call.
//
// What these lock down, because each is a promise that would rot silently:
//   1. THE PREMISE: a hand boundary near a printed edge is pulled ONTO it, to
//      sub-pixel, and that is measurable as edge adherence going up.
//   2. THE THING LINE-SNAP COULD NOT DO: a printed ROUNDED CORNER is traced as
//      a curve, not squared off by two intersecting lines.
//   3. THE HONESTY BAR: with no printed edge to trace, nothing moves; a
//      corridor bound no trace may cross; and a flattened feature is a
//      regression the straightness rule must refuse (the MAD-trim trap).
//   4. The adherence metric measures what it says: a boundary sitting exactly
//      on a synthetic edge scores 100% within 1px, and one deliberately 3px off
//      does not.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_EDGE_TRACE_PARAMS,
  buildEdgeMap,
  contourSegments,
  edgeTraceMask,
  luminanceProbe,
  measureAdherence,
  resampleClosed,
  tensorProbe,
} from '../edge-trace.js';
import { gradientOf } from '../line-snap.js';
import { edgeTraceGenerator } from '../generator.js';
import type { RgbaImage } from '../png.js';

const W = 200;
const H = 200;

/** A grey card with one crisp bright shape, drawn by a coverage function. */
function printedCard(inside: (x: number, y: number) => number): RgbaImage {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const y = (i / W) | 0;
    const c = Math.max(0, Math.min(1, inside(x + 0.5, y + 0.5)));
    const v = Math.round(45 + c * 180);
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

/** Signed distance to a rounded rect [x0,x1]×[y0,y1] with radius r (negative inside). */
function roundedRectSdf(x: number, y: number, x0: number, x1: number, y0: number, y1: number, r: number): number {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2 - r;
  const hh = (y1 - y0) / 2 - r;
  const qx = Math.abs(x - cx) - hw;
  const qy = Math.abs(y - cy) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Fill an alpha plane from a signed-distance function, 1px antialiased. */
function alphaFromSdf(sdf: (x: number, y: number) => number): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      a[y * W + x] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - sdf(x + 0.5, y + 0.5))));
    }
  }
  return a;
}

/** A hand-drawn attempt: the same shape, wandering by a couple of px, hard-edged. */
function wobbly(sdf: (x: number, y: number) => number): Uint8Array {
  const a = new Uint8Array(W * H);
  const wob = (x: number, y: number): number => 1.6 * Math.sin(x * 0.21 + y * 0.13) + 0.9 * Math.sin(y * 0.37);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      a[y * W + x] = sdf(x + 0.5, y + 0.5) + wob(x, y) < 0 ? 255 : 0;
    }
  }
  return a;
}

const P = DEFAULT_EDGE_TRACE_PARAMS;

// ── 1. The premise: the boundary is pulled onto the printed edge ───────────

test('a wobbly hand boundary is traced onto the printed edge, and adherence proves it', () => {
  const sdf = (x: number, y: number): number => roundedRectSdf(x, y, 40, 160, 40, 160, 0);
  const art = printedCard((x, y) => 0.5 - sdf(x, y));
  const hand = wobbly(sdf);
  const r = edgeTraceMask({ alpha: hand, width: W, height: H, artwork: art });
  assert.equal(r.refused, null);

  const probe = luminanceProbe(gradientOf(art));
  const before = measureAdherence(hand, W, H, probe);
  const after = measureAdherence(r.alpha, W, H, probe);
  assert.ok(
    after.meanDistPx < before.meanDistPx * 0.5,
    `mean distance to the printed edge must at least halve: ${before.meanDistPx} → ${after.meanDistPx}`,
  );
  assert.ok(after.within1px > 0.95, `nearly all of the traced boundary sits within 1px of the edge (got ${after.within1px})`);
  assert.ok(r.segments.some((s) => s.action === 'traced'), 'it actually traced');
});

// ── 2. What line-snap structurally could not do ────────────────────────────

test('a printed ROUNDED corner is traced as a curve, not squared off', () => {
  const R = 18;
  const sdf = (x: number, y: number): number => roundedRectSdf(x, y, 40, 160, 40, 160, R);
  const art = printedCard((x, y) => 0.5 - sdf(x, y));
  const hand = wobbly(sdf);
  const r = edgeTraceMask({ alpha: hand, width: W, height: H, artwork: art });

  // Sample the traced boundary inside the top-left corner's quarter-disc and
  // check every point sits on the true arc, not on either straight edge.
  const centre = { x: 40 + R, y: 40 + R };
  let checked = 0;
  let worst = 0;
  for (const s of contourSegments(r.alpha, W, H)) {
    const m = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
    if (m.x > centre.x || m.y > centre.y) continue; // strictly the corner quadrant
    const err = Math.abs(Math.hypot(m.x - centre.x, m.y - centre.y) - R);
    worst = Math.max(worst, err);
    checked++;
  }
  assert.ok(checked > 15, `the corner quadrant must have boundary in it (got ${checked} samples)`);
  assert.ok(worst < 1.5, `every corner sample must sit on the printed arc, worst error ${worst.toFixed(2)}px`);
});

test('a small feature hanging off a long straight edge is NOT flattened by the straight fit', () => {
  // The MAD-trim trap: a robust fit discards the feature as an outlier, reports
  // "straight to 0.2px RMS", and crisping then erases the very thing it ignored.
  const notch = (x: number, y: number): boolean => x >= 96 && x <= 104 && y >= 92 && y < 100;
  const sdf = (x: number, y: number): number =>
    notch(x, y) ? Math.max(roundedRectSdf(x, y, 40, 160, 100, 160, 0), -(100 - y)) - 8 : roundedRectSdf(x, y, 40, 160, 100, 160, 0);
  const art = printedCard((x, y) => (notch(x, y) ? 1 : 0.5 - sdf(x, y)));
  const hand = alphaFromSdf((x, y) => (notch(x, y) ? -1 : roundedRectSdf(x, y, 40, 160, 100, 160, 0)));
  const r = edgeTraceMask({ alpha: hand, width: W, height: H, artwork: art });

  // The notch must survive: column 100 has foil above the straight edge at y=100.
  let top = -1;
  for (let y = 0; y < H; y++) {
    if (r.alpha[y * W + 100]! >= 128) {
      top = y;
      break;
    }
  }
  assert.ok(top >= 0 && top <= 95, `the notch must survive tracing; foil starts at y=${top}, expected <= 95`);
});

// ── 3. The honesty bar ─────────────────────────────────────────────────────

test('with no printed edge to trace, nothing moves', () => {
  const sdf = (x: number, y: number): number => roundedRectSdf(x, y, 40, 160, 40, 160, 0);
  const hand = wobbly(sdf);
  const r = edgeTraceMask({ alpha: hand, width: W, height: H, artwork: flatCard() });
  assert.ok(
    r.segments.every((s) => s.action === 'kept'),
    'a blank card supports no anchor, so every stretch is his hand exactly as drawn',
  );
  assert.ok(r.agreementWithSource > 0.99, `his mask survives essentially intact (Jaccard ${r.agreementWithSource})`);
});

test('with no scan at all it refuses outright and hands the mask straight back', () => {
  const hand = wobbly((x, y) => roundedRectSdf(x, y, 40, 160, 40, 160, 0));
  const r = edgeTraceMask({ alpha: hand, width: W, height: H, artwork: null });
  assert.ok(r.refused, 'it says why');
  assert.equal(r.alpha, hand, 'and returns his pixels, not a re-rasterization of them');
  assert.equal(r.changedPx, 0);
});

test('a strong edge outside the corridor cannot pull the boundary onto it', () => {
  // Two parallel printed edges: a faint one where his hand is, a much stronger
  // one 20px away — well past corridorPx. Intent bounds the tracer, hard.
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const v = x < 60 ? 60 : x < 80 ? 80 : 240;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  const art: RgbaImage = { width: W, height: H, rgba };
  const hand = new Uint8Array(W * H);
  for (let y = 20; y < 180; y++) for (let x = 0; x < 60; x++) hand[y * W + x] = 255;
  const r = edgeTraceMask({ alpha: hand, width: W, height: H, artwork: art });
  for (let y = 60; y < 140; y++) {
    let right = -1;
    for (let x = W - 1; x >= 0; x--) {
      if (r.alpha[y * W + x]! >= 128) {
        right = x;
        break;
      }
    }
    assert.ok(
      right < 60 + P.corridorPx + 1,
      `row ${y}: boundary reached x=${right}; the corridor caps it at 60+${P.corridorPx}`,
    );
  }
});

// ── 4. The metric measures what it claims ──────────────────────────────────

test('adherence: a boundary exactly on the printed edge scores ~100%, one 3px off does not', () => {
  const art = printedCard((x, y) => 0.5 - roundedRectSdf(x, y, 40, 160, 40, 160, 0));
  const probe = luminanceProbe(gradientOf(art));
  const onEdge = alphaFromSdf((x, y) => roundedRectSdf(x, y, 40, 160, 40, 160, 0));
  const off = alphaFromSdf((x, y) => roundedRectSdf(x, y, 43, 157, 43, 157, 0));
  const a = measureAdherence(onEdge, W, H, probe);
  const b = measureAdherence(off, W, H, probe);
  assert.ok(a.within1pxOfSupported > 0.98, `on-edge scores ${a.within1pxOfSupported}`);
  assert.ok(a.meanDistPx < 0.15, `on-edge mean distance ${a.meanDistPx}px`);
  assert.ok(b.within1pxOfSupported < 0.15, `3px-off must NOT score as adherent (${b.within1pxOfSupported})`);
  assert.ok(b.meanDistPx > 2.5, `3px-off mean distance ${b.meanDistPx}px`);
});

test('contourSegments is sub-pixel: a half-covered edge row reads as a half pixel', () => {
  // A vertical edge whose true position is x = 100.25: pixel 100 is 75% covered.
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) a[y * W + x] = x < 100 ? 255 : x === 100 ? Math.round(255 * 0.75) : 0;
  }
  const segs = contourSegments(a, W, H).filter((s) => Math.abs(s.a.y - 100) < 2);
  assert.ok(segs.length > 0);
  const xs = segs.flatMap((s) => [s.a.x, s.b.x]);
  const mean = xs.reduce((p, q) => p + q, 0) / xs.length;
  // 127.5 lies between 191.25 (pixel 100) and 0 (pixel 101): centres 100.5 and
  // 101.5, so the crossing is at 100.5 + 191.25-127.5 over 191.25 → ~100.83.
  assert.ok(Math.abs(mean - 100.83) < 0.1, `sub-pixel crossing at ${mean.toFixed(3)}, expected ~100.83`);
});

test('the two probes agree that a colour-only edge exists and the luminance one does not see it', () => {
  // Green field against a silver border of the SAME luminance: the case that
  // motivated the colour structure tensor in the first place.
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const [r, g, b] = x < 100 ? [120, 190, 60] : [166, 166, 166];
    rgba[i * 4] = r!;
    rgba[i * 4 + 1] = g!;
    rgba[i * 4 + 2] = b!;
    rgba[i * 4 + 3] = 255;
  }
  const art: RgbaImage = { width: W, height: H, rgba };
  const lum = luminanceProbe(gradientOf(art));
  const ten = tensorProbe(buildEdgeMap(art, P).tensor);
  const n = { x: 1, y: 0 };
  const atEdge = (probe: (x: number, y: number, nx: number, ny: number) => number): number => {
    let best = 0;
    for (let t = -3; t <= 3; t += 0.25) best = Math.max(best, probe(100 + t, 100, n.x, n.y));
    return best;
  };
  assert.ok(atEdge(lum) < 8, `luminance barely sees it (${atEdge(lum).toFixed(2)})`);
  assert.ok(atEdge(ten) > 40, `the colour tensor sees it clearly (${atEdge(ten).toFixed(2)})`);
});

test('resampleClosed keeps a closed loop closed and evenly spaced', () => {
  const loop = [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 70 },
    { x: 10, y: 70 },
  ];
  const s = resampleClosed(loop, 1);
  assert.equal(s.length, 280, 'perimeter 2*(80+60) = 280 samples at 1px');
  for (let i = 1; i < s.length; i++) {
    const d = Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y);
    assert.ok(d > 0.5 && d < 1.5, `sample ${i} spacing ${d}`);
  }
});

// ── 5. THE RULE-SEED LIMIT (2026-08-08) ────────────────────────────────────
//
// Measured on the one card with ground truth (Tropius me05-001, DECISIONS
// 2026-08-08 "rule-seeding is unsound for modern-sv/sheet"): seeding edge-trace
// from the era LAYOUT RECTANGLE instead of a hand mask closed ZERO of the gap
// to Chey's intent (IoU 0.7084 → 0.7080), and widening `corridorPx` from 5 to
// 48 changed nothing at all. These two tests pin WHY, because the tempting
// "fix" — widen the corridor — is the thing that does not work, and the next
// person to try it should hit a failing test instead of a plausible-looking
// mask.

/** Fine vertical stripes left of `edgeX`, one strong printed edge AT `edgeX`. */
function texturedCard(edgeX: number): RgbaImage {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    // Texture is real signal — it is what an illustration looks like to an
    // edge detector — but it is not the boundary anybody meant.
    const v = x >= edgeX ? 235 : 70 + (Math.floor(x / 4) % 2) * 34;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return { width: W, height: H, rgba };
}

/** Rightmost foil pixel on a row — where the mask's boundary actually ended up. */
function rightEdgeAt(alpha: Uint8Array, y: number): number {
  for (let x = W - 1; x >= 0; x--) if (alpha[y * W + x]! >= 128) return x;
  return -1;
}

test('a RULE seed 40px from the true boundary stays 40px off — widening corridorPx does not rescue it', () => {
  const art = texturedCard(140);
  // The "rule": a rectangle whose right edge sits at x=100, deep inside the
  // texture, 40px short of the printed edge at x=140.
  const rule = alphaFromSdf((x, y) => roundedRectSdf(x, y, 20, 100, 20, 180, 0));
  for (const corridorPx of [5, 12, 24, 48]) {
    const r = edgeTraceMask({ alpha: rule, width: W, height: H, artwork: art, params: { corridorPx } });
    assert.equal(r.params.corridorPx, corridorPx, 'the override is honoured and reported back');
    for (const y of [60, 100, 140]) {
      const got = rightEdgeAt(r.alpha, y);
      assert.ok(
        got < 120,
        `corridorPx ${corridorPx}, row ${y}: boundary landed at x=${got}; a rule line does NOT walk to the ` +
          'real edge at 140 just because the corridor is wide — anchorSnapPx governs, and that is by design',
      );
    }
  }
});

test('a rule line inside a texture SCORES WELL on adherence while being wrong — the metric cannot tell', () => {
  const art = texturedCard(140);
  // 98, deliberately BETWEEN two stripe edges, so the tracer has something to
  // gain — exactly the situation on a real card, where the rule rectangle lands
  // in the middle of an illustration full of perfectly real edges.
  const rule = alphaFromSdf((x, y) => roundedRectSdf(x, y, 20, 98, 20, 180, 0));
  const probe = luminanceProbe(gradientOf(art));
  const traced = edgeTraceMask({ alpha: rule, width: W, height: H, artwork: art });
  const before = measureAdherence(rule, W, H, probe);
  const after = measureAdherence(traced.alpha, W, H, probe);
  assert.ok(after.within1px > before.within1px, `adherence goes UP (${before.within1px} → ${after.within1px})`);
  // The whole point: a boundary 40px from the one edge that matters can still
  // sit within a pixel of AN edge, because a picture is full of edges. Edge
  // adherence measures PRECISION, never CORRECTNESS. Do not read it as approval.
  assert.ok(after.within1px > 0.5, `and it reads as a good mask (${(after.within1px * 100).toFixed(1)}% within 1px)`);
  assert.ok(rightEdgeAt(traced.alpha, 100) < 120, 'while still being nowhere near the edge that mattered');
});

test('edge-trace params are overridable per run and reported back verbatim', () => {
  const art = printedCard((x, y) => 0.5 - roundedRectSdf(x, y, 40, 160, 40, 160, 8));
  const hand = wobbly((x, y) => roundedRectSdf(x, y, 40, 160, 40, 160, 8));
  const r = edgeTraceMask({ alpha: hand, width: W, height: H, artwork: art, params: { anchorSnapPx: 9, corridorPx: 17 } });
  assert.equal(r.params.anchorSnapPx, 9);
  assert.equal(r.params.corridorPx, 17);
  assert.equal(r.params.anchorSpacingPx, P.anchorSpacingPx, 'everything not overridden keeps the default');
});

test('a RULE-seeded generator run says so on the mask, and halves its own confidence', () => {
  const art = printedCard((x, y) => 0.5 - roundedRectSdf(x, y, 40, 160, 40, 160, 8));
  const alpha = wobbly((x, y) => roundedRectSdf(x, y, 40, 160, 40, 160, 8));
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = alpha[i]!;
  const target = {
    cardId: 'x-1', variantId: 1, eraId: 'modern-sv', scope: 'sheet' as const,
    rect: [0.075, 0.527, 0.85, 0.315] as [number, number, number, number], radius: 0.006, invert: true,
    window: null, artwork: art, artworkUrl: null, width: W, height: H, setId: 'x', seriesSlug: null,
  };
  const src = (method: 'hand' | 'layout-flatten') => ({
    ref: { cardId: 'x-1', variantId: 1, savedAt: null, method, weight: 0, sha256: 'a'.repeat(64) },
    alpha, image: { width: W, height: H, rgba }, method,
  });
  const fromHand = edgeTraceGenerator.generate({ target, exemplars: [], source: src('hand') });
  const fromRule = edgeTraceGenerator.generate({ target, exemplars: [], source: src('layout-flatten') });
  assert.ok(!fromHand.notes.includes('RULE-SEEDED'), 'a hand source is not labelled a rule');
  assert.ok(fromRule.notes.startsWith('RULE-SEEDED'), 'a rule source announces itself FIRST, before any number');
  assert.ok(
    fromRule.notes.includes('cannot add or remove a region'),
    'and states the limit that the numbers below it will not reveal',
  );
  assert.ok(
    (fromRule.confidence ?? 1) < (fromHand.confidence ?? 0),
    `a rule seed is less believable than a human one (${String(fromRule.confidence)} < ${String(fromHand.confidence)})`,
  );
});
