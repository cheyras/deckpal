// Pure tests for mask provenance (sidecar v3). No DB, no server, no fixtures
// on disk beyond a scratch dir — safe for CI.
//
// What these lock down, because each is a promise that would rot silently:
//   1. v1/v2 sidecars keep loading, and Chey's pre-v3 masks stay `hand`.
//   2. The five methods map to fixed authorship/review/exemplar semantics.
//   3. ANTI-FEEDBACK-COLLAPSE: unreviewed `ai` masks can never be exemplars.
//   4. The write path stamps the method the PIXELS support, not the claim:
//      an unpainted window bake is `layout-flatten`, painting on it promotes
//      to `hand-refined`, and painting on an `ai` mask yields `ai-corrected`
//      WITH a correction record — even if the client forgets to say so.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodePng } from '../png.js';
import { rasterizePriorAlpha, type MaskPrior } from '../mask-artifacts.js';
import {
  AUTHORSHIP_BY_METHOD,
  EXEMPLAR_WEIGHT,
  REVIEW_BY_METHOD,
  normalizeSidecar,
  writeMaskRecord,
  type GeneratorIdentity,
} from '../provenance.js';
import { buildReport, readCorpus, selectExemplars, trainingTuples } from '../mask-corpus.js';

const W = 64;
const H = 88;

const PRIOR: MaskPrior = {
  source: 'layout',
  eraId: 'wotc',
  scope: 'window',
  rect: [0.1, 0.45, 0.8, 0.42],
  radius: 0.004,
  invert: false,
  feather: 0.008,
  resolverVersion: 5,
};

/** Encode an alpha plane as the RGBA PNG the mask pipeline stores. */
function maskPng(alpha: Uint8Array): Buffer {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < alpha.length; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 45;
    rgba[i * 4 + 2] = 100;
    rgba[i * 4 + 3] = alpha[i]!;
  }
  return encodePng({ width: W, height: H, rgba });
}

const scratch = (): string => mkdtempSync(join(tmpdir(), 'foil-prov-'));

// ── 1. Legacy sidecars ─────────────────────────────────────────────────────

void test('v2 sidecars load unchanged and stay labelled hand', () => {
  // Verbatim shape of data/foil-masks/base1-8/32.json (Chey's Machamp mask).
  const v2 = {
    version: 2,
    cardId: 'base1-8',
    variantId: 32,
    width: 490,
    height: 674,
    channel: 'alpha',
    derivation_method: 'hand',
    savedAt: '2026-08-01T22:35:48.527Z',
    artworkKey: 'base1-8',
    prior: { source: 'layout', eraId: 'wotc', scope: 'window', rect: [0.103, 0.48, 0.802, 0.418], radius: 0.004, invert: false, feather: 0.008, resolverVersion: 1 },
    priorPng: '32.prior.png',
    diffPng: '32.diff.png',
    diff: { addedPx: 13, removedPx: 39643, unchangedPx: 70788, agreement: 0.6409 },
  };
  const s = normalizeSidecar(v2);
  assert.ok(s);
  assert.equal(s.derivation_method, 'hand');
  assert.equal(s.authorship, 'human');
  assert.equal(s.reviewStatus, 'human-authored');
  assert.equal(s.artworkKey, 'base1-8');
  assert.equal(s.diff?.agreement, 0.6409, 'the recorded rule score must survive migration');
  assert.deepEqual(s.prior.rect, [0.103, 0.48, 0.802, 0.418]);
});

void test('v1 sidecars (no prior) still load and are treated as hand', () => {
  const s = normalizeSidecar({ cardId: 'base1-4', variantId: 15, width: 490, height: 674, channel: 'alpha', derivation_method: 'hand', savedAt: '2026-07-30T00:00:00.000Z' });
  assert.ok(s);
  assert.equal(s.derivation_method, 'hand');
  assert.equal(s.version, 1);
});

void test('derived provenance is recomputed on read — a stale file cannot lie', () => {
  const s = normalizeSidecar({
    cardId: 'x-1', variantId: 1, width: 8, height: 8, channel: 'alpha',
    derivation_method: 'ai', savedAt: '2026-08-07T00:00:00.000Z',
    // A hand-edited file claiming an AI mask is human-authored:
    authorship: 'human', reviewStatus: 'human-authored',
  });
  assert.ok(s);
  assert.equal(s.authorship, 'machine');
  assert.equal(s.reviewStatus, 'unreviewed');
});

// ── 2/3. Taxonomy + the anti-collapse safeguard ────────────────────────────

void test('taxonomy: authorship, review status and exemplar weight per method', () => {
  assert.deepEqual(AUTHORSHIP_BY_METHOD, {
    'layout-flatten': 'machine', hand: 'human', 'hand-refined': 'human', ai: 'machine', 'ai-corrected': 'mixed',
  });
  assert.deepEqual(REVIEW_BY_METHOD, {
    'layout-flatten': 'human-adjusted', hand: 'human-authored', 'hand-refined': 'human-authored',
    ai: 'unreviewed', 'ai-corrected': 'human-authored',
  });
  // The safeguard, as data: machine output is worth nothing as training input.
  assert.equal(EXEMPLAR_WEIGHT.ai, 0);
  assert.equal(EXEMPLAR_WEIGHT['layout-flatten'], 0);
  assert.equal(EXEMPLAR_WEIGHT.hand, 1);
  assert.equal(EXEMPLAR_WEIGHT['hand-refined'], 1);
  assert.ok(EXEMPLAR_WEIGHT['ai-corrected'] > 0 && EXEMPLAR_WEIGHT['ai-corrected'] < 1);
});

void test('selectExemplars refuses unreviewed ai masks and bare bakes', async () => {
  const dir = scratch();
  try {
    const full = new Uint8Array(W * H).fill(255);
    const rect = rasterizePriorAlpha(W, H, PRIOR);
    const gen: GeneratorIdentity = {
      name: 'test-gen', version: 1, modelId: null, runId: 'r1', params: {}, exemplars: [], confidence: 0.4,
      generatedAt: new Date().toISOString(),
    };
    // A human mask, an unreviewed AI mask, and a bare window bake.
    await writeMaskRecord({ masksDir: dir, cardId: 'zz-1', variantId: '1', png: maskPng(full), width: W, height: H, prior: PRIOR, startedFrom: 'layout' });
    await writeMaskRecord({ masksDir: dir, cardId: 'zz-2', variantId: '1', png: maskPng(full), width: W, height: H, prior: PRIOR, startedFrom: 'layout', machine: gen });
    await writeMaskRecord({ masksDir: dir, cardId: 'zz-3', variantId: '1', png: maskPng(rect), width: W, height: H, prior: PRIOR, startedFrom: 'layout' });

    const corpus = await readCorpus(dir);
    assert.equal(corpus.length, 3);
    const sel = selectExemplars(corpus);
    assert.deepEqual(sel.chosen.map((e) => e.cardId), ['zz-1']);
    const reasons = Object.fromEntries(sel.rejected.map((r) => [r.cardId, r.method]));
    assert.equal(reasons['zz-2'], 'ai');
    assert.equal(reasons['zz-3'], 'layout-flatten');
    assert.ok(sel.rejected.find((r) => r.cardId === 'zz-2')?.reason.includes('anti-feedback-collapse'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. The write path stamps what the pixels support ───────────────────────

void test('an unpainted window bake stamps layout-flatten, painting promotes to hand-refined', async () => {
  const dir = scratch();
  try {
    const withWindow: MaskPrior = { ...PRIOR, window: { rect: [0.12, 0.5, 0.76, 0.36], radius: 0.004 } };
    const baked = rasterizePriorAlpha(W, H, { ...withWindow, rect: withWindow.window!.rect, radius: withWindow.window!.radius });

    const flat = await writeMaskRecord({
      masksDir: dir, cardId: 'zz-4', variantId: '7', png: maskPng(baked), width: W, height: H,
      prior: withWindow, startedFrom: 'window-bake',
    });
    assert.equal(flat.derivation_method, 'layout-flatten', 'a bare bake is machine geometry, not hand work');
    assert.equal(flat.reviewStatus, 'human-adjusted');
    assert.equal(flat.prior.source, 'window');
    assert.equal(flat.correction, undefined);

    // Now paint on it: flip a block of pixels.
    const painted = Uint8Array.from(baked);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) painted[y * W + x] = 255 - painted[y * W + x]!;
    const refined = await writeMaskRecord({
      masksDir: dir, cardId: 'zz-4', variantId: '7', png: maskPng(painted), width: W, height: H,
      prior: withWindow, startedFrom: 'mask', parentRef: { cardId: 'zz-4', variantId: 7 },
    });
    assert.equal(refined.derivation_method, 'hand-refined');
    assert.equal(refined.reviewStatus, 'human-authored');
    assert.ok(refined.correction, 'correcting an existing mask must record the diff');
    assert.equal(refined.correction.parent.method, 'layout-flatten');
    assert.ok(refined.correction.changedPx > 0);
    assert.equal(refined.correction.grid.cells.length, refined.correction.grid.size ** 2);
    // The parent's pixels are kept so the pair is reconstructable.
    await readFile(join(dir, 'zz-4', '7.parent.png'));
    await readFile(join(dir, 'zz-4', '7.parent.diff.png'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('a bake whose only differences are the rasterizer seam is still layout-flatten', async () => {
  const dir = scratch();
  try {
    // Simulate the real client/server rasterizer mismatch: the editor's canvas
    // roundRect and this module's SDF disagree ONLY in the 1px antialiasing
    // band (measured 389/330260 px on the WOTC window). Flip every such seam
    // pixel and the save must still read as an unpainted bake.
    const seed = rasterizePriorAlpha(W, H, PRIOR);
    const seam = Uint8Array.from(seed);
    let flipped = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        let hi = 0;
        let lo = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) (seed[(y + dy) * W + x + dx]! >= 128 ? hi++ : lo++);
        if (hi > 0 && lo > 0) {
          seam[i] = seed[i]! >= 128 ? 0 : 255;
          flipped++;
        }
      }
    }
    assert.ok(flipped > 100, 'the fixture must actually exercise a seam');
    const s = await writeMaskRecord({ masksDir: dir, cardId: 'zz-8', variantId: '1', png: maskPng(seam), width: W, height: H, prior: PRIOR, startedFrom: 'layout' });
    assert.equal(s.derivation_method, 'layout-flatten');

    // …but a real brush stroke in the middle of the window is NOT seam noise.
    const stroke = Uint8Array.from(seam);
    for (let y = 45; y < 52; y++) for (let x = 20; x < 40; x++) stroke[y * W + x] = 255 - stroke[y * W + x]!;
    const s2 = await writeMaskRecord({ masksDir: dir, cardId: 'zz-9', variantId: '1', png: maskPng(stroke), width: W, height: H, prior: PRIOR, startedFrom: 'layout' });
    assert.equal(s2.derivation_method, 'hand');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('painting from the era rect with no parent is plain hand', async () => {
  const dir = scratch();
  try {
    const alpha = rasterizePriorAlpha(W, H, PRIOR);
    for (let i = 0; i < 400; i++) alpha[i] = 255;
    const s = await writeMaskRecord({ masksDir: dir, cardId: 'zz-5', variantId: '2', png: maskPng(alpha), width: W, height: H, prior: PRIOR, startedFrom: 'layout' });
    assert.equal(s.derivation_method, 'hand');
    assert.equal(s.prior.source, 'layout');
    assert.equal(s.correction, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('correcting an AI mask yields ai-corrected + carries the generator forward — even if the client forgets the parent', async () => {
  const dir = scratch();
  try {
    const gen: GeneratorIdentity = {
      name: 'window-artgate', version: 1, modelId: null, runId: 'trial-1', params: { gate: 'x' },
      exemplars: [{ cardId: 'base1-8', variantId: 32, savedAt: '2026-08-01T22:35:48.527Z', method: 'hand', weight: 1 }],
      confidence: 0.33, generatedAt: new Date().toISOString(),
    };
    const proposal = rasterizePriorAlpha(W, H, PRIOR);
    const ai = await writeMaskRecord({
      masksDir: dir, cardId: 'zz-6', variantId: '3', png: maskPng(proposal), width: W, height: H,
      prior: PRIOR, startedFrom: 'layout', machine: gen,
    });
    assert.equal(ai.derivation_method, 'ai');
    assert.equal(ai.reviewStatus, 'unreviewed');
    assert.equal(ai.prior.source, 'ai');
    assert.equal(ai.prior.generator?.runId, 'trial-1');

    const fixed = Uint8Array.from(proposal);
    for (let y = 40; y < 60; y++) for (let x = 5; x < 40; x++) fixed[y * W + x] = 255 - fixed[y * W + x]!;
    // The client LIES: claims it started from the layout rect with no parent.
    const corrected = await writeMaskRecord({
      masksDir: dir, cardId: 'zz-6', variantId: '3', png: maskPng(fixed), width: W, height: H,
      prior: PRIOR, startedFrom: 'layout', parentRef: null,
    });
    assert.equal(corrected.derivation_method, 'ai-corrected', 'AI ancestry must not be launderable into hand');
    assert.equal(corrected.prior.source, 'ai');
    assert.equal(corrected.prior.generator?.runId, 'trial-1', 'the generator identity rides forward onto the correction');
    assert.ok(corrected.correction);
    assert.equal(corrected.correction.parent.method, 'ai');
    assert.equal(corrected.correction.parent.generator?.name, 'window-artgate');
    assert.ok(corrected.lineage && corrected.lineage.length >= 2);
    assert.deepEqual(corrected.lineage.map((l) => l.method), ['ai', 'ai-corrected']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('a machine label requires a generator identity — HTTP callers cannot claim it', async () => {
  const dir = scratch();
  try {
    // Same pixels, no `machine` block: it can only ever be a human/geometry label.
    const s = await writeMaskRecord({ masksDir: dir, cardId: 'zz-7', variantId: '1', png: maskPng(new Uint8Array(W * H).fill(255)), width: W, height: H, prior: PRIOR, startedFrom: 'layout' });
    assert.notEqual(s.derivation_method, 'ai');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Report + tuples ────────────────────────────────────────────────────────

void test('report and training manifest describe the corpus honestly', async () => {
  const dir = scratch();
  try {
    const gen: GeneratorIdentity = {
      name: 'g', version: 2, modelId: 'm', runId: 'r', params: {}, exemplars: [], confidence: null,
      generatedAt: new Date().toISOString(),
    };
    const full = new Uint8Array(W * H).fill(255);
    await writeMaskRecord({ masksDir: dir, cardId: 'base1-8', variantId: '32', png: maskPng(full), width: W, height: H, prior: PRIOR, startedFrom: 'layout', card: { setId: 'base1', seriesSlug: 'base', name: 'Machamp', number: '8' } });
    await writeMaskRecord({ masksDir: dir, cardId: 'base1-4', variantId: '15', png: maskPng(rasterizePriorAlpha(W, H, PRIOR)), width: W, height: H, prior: PRIOR, startedFrom: 'layout', machine: gen });

    const corpus = await readCorpus(dir);
    const r = buildReport(corpus);
    assert.equal(r.total, 2);
    assert.equal(r.byMethod.hand, 1);
    assert.equal(r.byMethod.ai, 1);
    assert.equal(r.exemplarsAvailable.total, 1, 'only the human mask is learnable');
    assert.equal(r.awaitingReview.length, 1);
    assert.equal(r.awaitingReview[0]!.cardId, 'base1-4');
    assert.equal(r.byEra.wotc?.n, 2);
    assert.equal(r.bySet.base1?.n, 2);

    const m = trainingTuples(corpus);
    assert.equal(m.counts.total, 2);
    assert.equal(m.counts.exemplars, 1);
    assert.equal(m.counts.unreviewedAi, 1);
    assert.ok(m.contract.length > 0, 'the manifest must document how to read itself');
    const ai = m.tuples.find((t) => t.method === 'ai')!;
    assert.equal(ai.exemplarWeight, 0);
    assert.equal(ai.files.mask, 'data/foil-masks/base1-4/15.png');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
