// Locks the claims this lane actually makes, in the order they matter:
//   1. the vector-ness measure points the right way, and is not measuring the tracer;
//   2. vector -> raster -> vector is faithful;
//   3. the optional element is DISCOVERED, not asserted;
//   4. the me05-014 sliver ruling — his correction, encoded;
//   5. anti-collapse: no unreviewed `ai` mask can ever reach the fitter.
//
// 4 and 5 read the real corpus. If the corpus moves, these should move with it — that is
// the point of a corpus test, and they fail loudly rather than silently drifting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../png.js';
import { alphaOf, EXEMPLAR_WEIGHT } from '../provenance.js';
import { readCorpus, selectExemplars } from '../mask-corpus.js';
import {
  vectorizeLoop, vectorness, rasterizeTemplate, flattenPath, subpixelLoops,
  discoverOptionalElement, fitTemplate, probeOptional, toBin01,
  DEFAULT_VECTOR_FIT_PARAMS, type VectorTemplate, type Prim, type VPath,
} from '../vector-template.js';
import { traceLoops } from '../line-snap.js';
import { iou } from '../region-learn.js';

const ROOT = join(import.meta.dirname, '../../../../..');
const MASKS_DIR = join(ROOT, 'data/foil-masks');
const TEMPLATE_FILE = join(ROOT, 'apps/web/src/foil/vector-templates.json');
const W = 490;
const H = 674;

// ── helpers ────────────────────────────────────────────────────────────────

/** A filled rounded rectangle, antialiased by 4x4 supersampling — a clean vector shape. */
function roundedRect(w: number, h: number, x0: number, y0: number, x1: number, y1: number, r: number): Uint8Array {
  const a = new Uint8Array(w * h);
  const ss = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const px = x + (sx + 0.5) / ss, py = y + (sy + 0.5) / ss;
        const cx = Math.min(Math.max(px, x0 + r), x1 - r);
        const cy = Math.min(Math.max(py, y0 + r), y1 - r);
        const inside = px >= x0 && px <= x1 && py >= y0 && py <= y1 && Math.hypot(px - cx, py - cy) <= r + 1e-9;
        if (inside) hit++;
      }
      a[y * w + x] = Math.round((hit / (ss * ss)) * 255);
    }
  }
  return a;
}

/** The same shape with its boundary pushed around by a deterministic ±1px wobble. */
function wobbled(w: number, h: number, x0: number, y0: number, x1: number, y1: number, r: number): Uint8Array {
  const a = new Uint8Array(w * h);
  const jitter = (y: number): number => (Math.sin(y * 1.7) + Math.sin(y * 0.53)) * 0.9;
  for (let y = 0; y < h; y++) {
    const j = jitter(y);
    const base = roundedRect(w, 1, x0 + j, y0 - y, x1 + j, y1 - y, r);
    for (let x = 0; x < w; x++) a[y * w + x] = base[x]!;
  }
  return a;
}

const loadTemplate = (): VectorTemplate => JSON.parse(readFileSync(TEMPLATE_FILE, 'utf8')).templates[0];

const shareIn = (a: Uint8Array, x0: number, y0: number, x1: number, y1: number): number => {
  let f = 0, t = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { t++; if (a[y * W + x]! >= 128) f++; }
  return f / t;
};

// ── 1. the measure points the right way, and measures the MASK ─────────────

test('vectorness: a clean vector shape needs far fewer primitives than a wobbly one', () => {
  const clean = roundedRect(200, 200, 20, 20, 180, 180, 18);
  const noisy = wobbled(200, 200, 20, 20, 180, 180, 18);
  const vc = vectorness(clean, 200, 200);
  const vn = vectorness(noisy, 200, 200);

  assert.ok(vc.primitivesPerKpx < vn.primitivesPerKpx,
    `clean ${vc.primitivesPerKpx} should need fewer primitives/kpx than wobbly ${vn.primitivesPerKpx}`);
  assert.ok(vc.explainedLong > vn.explainedLong,
    `clean ${vc.explainedLong} should carry more length in long primitives than wobbly ${vn.explainedLong}`);
  assert.ok(vc.residualPx < vn.residualPx,
    `clean ${vc.residualPx}px residual should be under wobbly ${vn.residualPx}px`);
});

test('vectorness measures the MASK, not the tracer: a diagonal is not "axis aligned"', () => {
  // THE TRAP THIS LOCKS: `traceLoops` is crack-following, so its contour is a rectilinear
  // staircase and EVERY run comes out exactly horizontal or vertical. Measured on that, a
  // 45-degree edge scores 100% axis-aligned and 0px residual — the measure would be
  // reporting the tracer. `vectorness` uses the sub-pixel half-level contour instead.
  const w = 160, h = 160;
  const diag = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = (x - y) / Math.SQRT2;               // signed distance to the 45-degree line
    diag[y * w + x] = Math.round(Math.min(1, Math.max(0, 0.5 - d)) * 255);
  }
  const v = vectorness(diag, w, h);
  assert.ok(v.axisAlignedFrac < 0.5,
    `a 45-degree boundary must not read as axis-aligned; got ${v.axisAlignedFrac}`);

  // And prove the staircase really would have lied, so this test cannot rot into a tautology.
  const staircase = traceLoops(toBin01(diag), w, h);
  assert.ok(staircase.length > 0, 'traceLoops should still find the shape');
  const steps = staircase[0]!;
  const axisOnly = steps.every((p, i) => {
    const q = steps[(i + 1) % steps.length]!;
    return p.x === q.x || p.y === q.y;
  });
  assert.ok(axisOnly, 'traceLoops is a rectilinear staircase — that is exactly why it must not be the measure');
});

// ── 2. round trip ──────────────────────────────────────────────────────────

test('vector -> raster round trip is faithful on a shape that IS lines and arcs', () => {
  const src = roundedRect(220, 180, 25, 22, 195, 158, 20);
  const loops = subpixelLoops(src, 220, 180);
  assert.equal(loops.length, 1, 'one closed boundary');
  const fit = vectorizeLoop(loops[0]!, DEFAULT_VECTOR_FIT_PARAMS);
  assert.ok(fit, 'the loop vectorises');
  assert.ok(fit!.arcs >= 4, `a rounded rect should fit at least 4 arcs, got ${fit!.arcs}`);
  assert.ok(fit!.primitives <= 24, `and stay economical, got ${fit!.primitives} primitives`);

  const tpl: VectorTemplate = {
    id: 't', version: 1, eraId: 'x', scope: 'sheet',
    space: { width: 220, height: 180 },
    outer: {
      start: [fit!.path.start[0] / 220, fit!.path.start[1] / 180],
      prims: fit!.path.prims.map((p): Prim =>
        p.k === 'line'
          ? { k: 'line', to: [p.to[0] / 220, p.to[1] / 180] }
          : { k: 'arc', to: [p.to[0] / 220, p.to[1] / 180], r: p.r / 220, sweep: p.sweep }),
    },
    holes: [],
    provenance: {
      generator: { name: 'test', version: 1, modelId: null, runId: 'test' },
      exemplars: [], fittedAt: '', params: DEFAULT_VECTOR_FIT_PARAMS, statement: '',
    },
  };
  const back = rasterizeTemplate(tpl, 220, 180, { evolves: false });
  assert.ok(iou(back, src) >= 0.99, `round trip IoU ${iou(back, src)} should be >= 0.99`);
});

test('arc flattening honours its sagitta bound', () => {
  const path: VPath = { start: [0, 0], prims: [
    { k: 'arc', to: [100, 100], r: 100, sweep: 1 },
    { k: 'line', to: [0, 0] },
  ] };
  const coarse = flattenPath(path, 1.0);
  const fine = flattenPath(path, 0.02);
  assert.ok(fine.length > coarse.length, 'a tighter sagitta means more chords');

  // Every flattened vertex must lie on ONE common circle of radius 100. Deriving the centre
  // here with the same formula the implementation uses would only prove it agrees with
  // itself, so recover the centre from the flattened points instead (perpendicular
  // bisectors of two chords) and check the radius that falls out.
  const arcPts = fine.slice(0, -1);                       // drop the closing line's endpoint
  const [a, b, c] = [arcPts[0]!, arcPts[Math.floor(arcPts.length / 2)]!, arcPts[arcPts.length - 1]!];
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
  const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
  assert.ok(Math.abs(Math.hypot(a.x - ux, a.y - uy) - 100) < 0.05, 'the recovered radius is the one asked for');
  for (const p of arcPts) {
    assert.ok(Math.abs(Math.hypot(p.x - ux, p.y - uy) - 100) < 0.05,
      `flattened point (${p.x.toFixed(2)},${p.y.toFixed(2)}) should lie on the arc`);
  }
});

// ── 3. the optional element is discovered, not asserted ────────────────────

test('discoverOptionalElement finds the one blob two groups differ by, and ignores edge noise', () => {
  const w = 120, h = 120;
  const make = (withBlob: boolean, seed: number): Uint8Array => {
    const a = new Uint8Array(w * h);
    for (let y = 12; y < 108; y++) for (let x = 12; x < 108; x++) a[y * w + x] = 255;
    // ±1px registration noise along the left edge — the thing that must NOT be found.
    const j = seed % 2;
    for (let y = 12; y < 108; y++) a[y * w + 12 + j] = 255;
    if (!withBlob) return a;
    for (let y = 20; y < 45; y++) for (let x = 20; x < 45; x++) a[y * w + x] = 0;
    return a;
  };
  const masks = [
    { cardId: 'a', alpha: make(false, 0) }, { cardId: 'b', alpha: make(false, 1) },
    { cardId: 'c', alpha: make(true, 0) }, { cardId: 'd', alpha: make(true, 1) },
  ];
  const opt = discoverOptionalElement(masks, w, h);
  assert.ok(opt, 'an optional element should be found');
  assert.ok(opt!.separation > 0.5, `the split should be decisive, got ${opt!.separation}`);
  assert.ok(opt!.px > 400 && opt!.px < 800, `the region should be the 25x25 blob, got ${opt!.px}px`);
  const has = opt!.shares.filter((s) => s.share < opt!.split).map((s) => s.cardId).sort();
  assert.deepEqual(has, ['c', 'd'], 'exactly the two masks with the blob');
});

test('a corpus with no optional element does not invent one', () => {
  const w = 90, h = 90;
  const plain = (j: number): Uint8Array => {
    const a = new Uint8Array(w * h);
    for (let y = 10; y < 80; y++) for (let x = 10 + (j % 2); x < 80; x++) a[y * w + x] = 255;
    return a;
  };
  const opt = discoverOptionalElement([0, 1, 2, 3].map((j) => ({ cardId: `m${j}`, alpha: plain(j) })), w, h);
  assert.equal(opt, null, 'boundary registration noise alone is not an optional element');
});

// ── 4. THE SLIVER RULING — his correction, encoded ─────────────────────────

test("the me05-014 sliver ruling: the colour trapped by the medallion IS foil", () => {
  // codified/modern-sv.md pass 1 flagged this as the open question: region-learn@1 dropped a
  // narrow coloured sliver pinched between the evolution medallion and the border ring
  // because it was "not part of the largest coloured component", and recorded that "Chey has
  // never ruled on that sliver". He has now — he added it back on every Stage-1 card he
  // corrected. This test is that ruling.
  if (!existsSync(TEMPLATE_FILE)) return;                      // template not fitted yet
  const box = { x0: 20, y0: 43, x1: 44, y1: 58 };
  const tpl = loadTemplate();

  const withEl = shareIn(rasterizeTemplate(tpl, W, H, { evolves: true }), box.x0, box.y0, box.x1, box.y1);
  const without = shareIn(rasterizeTemplate(tpl, W, H, { evolves: false }), box.x0, box.y0, box.x1, box.y1);

  // On a card with no medallion the whole box is coloured frame, so it is all foil.
  assert.ok(without > 0.95, `basic layout should be solid foil in this box, got ${without.toFixed(3)}`);

  // On a card WITH the medallion the box is part sliver, part medallion. Chey's four
  // corrected Stage-1 masks all sit at 35-40%; region-learn@1 sat at 0.0%. The template
  // must be with him, and must NOT be at zero.
  assert.ok(withEl > 0.20, `the sliver must survive the medallion cut-out — got ${withEl.toFixed(3)}, region-learn@1 scored 0.000 here`);
  assert.ok(withEl < 0.60, `but the medallion itself must still be cut — got ${withEl.toFixed(3)}`);

  for (const [card, vid] of [['me05-006', '37193'], ['me05-010', '37200'], ['me05-014', '37207'], ['me05-024', '37225']]) {
    const p = join(MASKS_DIR, card!, `${vid}.png`);
    if (!existsSync(p)) continue;
    const his = alphaOf(decodePng(readFileSync(p)));
    const hisShare = shareIn(his, box.x0, box.y0, box.x1, box.y1);
    assert.ok(Math.abs(hisShare - withEl) < 0.12,
      `${card}: template ${withEl.toFixed(3)} should track his ${hisShare.toFixed(3)} in the sliver box`);
  }
});

// ── 5. anti-collapse ───────────────────────────────────────────────────────

test('no unreviewed `ai` mask can reach the template fitter', async () => {
  const corpus = await readCorpus(MASKS_DIR);
  const sel = selectExemplars(corpus, { eraId: 'modern-sv', scope: 'sheet' });
  assert.ok(sel.chosen.length > 0, 'the modern-sv sheet corpus should not be empty');
  for (const e of sel.chosen) {
    assert.notEqual(e.sidecar.derivation_method, 'ai', `${e.cardId}/${e.variantId} is unreviewed machine output`);
    assert.ok(EXEMPLAR_WEIGHT[e.sidecar.derivation_method] > 0, 'every chosen exemplar has positive weight');
  }
  // And the rejection is reported, not silent.
  const aiInCorpus = corpus.filter((c) => c.sidecar.derivation_method === 'ai');
  for (const a of aiInCorpus) {
    assert.ok(sel.rejected.some((r) => r.cardId === a.cardId && r.variantId === a.variantId),
      `${a.cardId}/${a.variantId} is 'ai' and must appear in rejected[] with a reason`);
  }
});

test('fitTemplate refuses when no exemplar shows the base layout', () => {
  const w = 60, h = 60;
  const a = new Uint8Array(w * h).fill(255);
  assert.throws(
    () => fitTemplate({
      exemplars: [{ cardId: 'x', variantId: 1, method: 'hand', weight: 1, alpha: a, evolves: true }],
      width: w, height: h, eraId: 'e', scope: 'sheet', runId: 'r',
    }),
    /no non-evolving exemplar/,
    'a corpus that is all evolvers cannot define the unconditional layout',
  );
});

test('probeOptional reads the element off the artwork: colour = absent, silver = present', () => {
  const w = 40, h = 40;
  const region = new Uint8Array(w * h);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) region[y * w + x] = 255;
  const paint = (r: number, g: number, b: number): { width: number; height: number; rgba: Uint8Array } => {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255; }
    return { width: w, height: h, rgba };
  };
  assert.equal(probeOptional(paint(220, 90, 40), region).hasElement, false, 'a coloured frame means no medallion');
  assert.equal(probeOptional(paint(180, 182, 181), region).hasElement, true, 'silver means the medallion is there');
});
