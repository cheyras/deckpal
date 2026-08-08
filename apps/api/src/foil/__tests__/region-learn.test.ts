// Pure tests for the region policy (foil/region-learn.ts). No DB, no disk, no
// fixtures — synthetic "cards" whose printing we lay out ourselves, so "did it read
// the right policy" is arithmetic rather than judgement.
//
// What these lock down, because each is a promise that would rot silently:
//
//   1. THE POLICY IS READ, NOT ASSUMED. The same code, given a `sheet`-style mask
//      and a `window`-style mask over the same synthetic card, comes back with
//      OPPOSITE foil classes. If someone ever hard-codes "modern cards foil the
//      frame", this test keeps passing while the claim becomes a lie — so it also
//      asserts the votes, not just the verdict.
//   2. DISAGREEMENT IS REPORTED, NOT AVERAGED. Two exemplars that split on a class
//      must surface in `disagreements` with both numbers. At n=3 an averaged
//      disagreement is a rule nobody stated.
//   3. ANTI-FEEDBACK-COLLAPSE. Unreviewed `ai` masks are never exemplars — at any
//      corpus size, under any flag. Locked at the weight table AND at
//      `selectExemplars`, and then again on the shape a learner actually consumes.
//   4. THE BEVEL SIDE. An illustration box is framed by TWO parallel printed lines.
//      Which one the boundary sits on depends on which side the foil is, and taking
//      "the strongest" picks between them at random, card by card.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CLASS_INDEX,
  DEFAULT_REGION_LEARN_PARAMS,
  applyPolicy,
  boundaryDistance,
  detectWindow,
  iou,
  learnPolicy,
  partitionCard,
  type PolicyExemplar,
  type WindowRect,
} from '../region-learn.js';
import { EXEMPLAR_WEIGHT, isExemplarEligible, type MaskSidecarV3 } from '../provenance.js';
import { selectExemplars, type CorpusEntry } from '../mask-corpus.js';
import type { RgbaImage } from '../png.js';

const W = 240;
const H = 330;

/** Pixel geometry of the synthetic card, shared by every test below. */
const CARD = {
  border: 12, // achromatic ring around the card
  win: { x0: 30, y0: 60, x1: 210, y1: 190 } as WindowRect,
  bevel: 4, // the illustration's printed frame: TWO parallel lines, this far apart
  strip: { x0: 24, y0: 190, x1: 216, y1: 208 }, // achromatic "species strip"
  tag: { x0: 14, y0: 14, x1: 70, y1: 34 }, // achromatic "stage tag"
};

/**
 * A synthetic Pokémon-shaped card:
 *   grey border ring · coloured frame body · bevelled illustration box holding a
 *   uniform background and a bright off-centre "subject" · grey species strip ·
 *   grey stage tag.
 * `frame` and `bg` are the two coloured fields, so a test can make them differ.
 */
function syntheticCard(frame: [number, number, number], bg: [number, number, number], subject: [number, number, number]): RgbaImage {
  const rgba = new Uint8Array(W * H * 4);
  const put = (i: number, c: number[]): void => {
    rgba[i * 4] = c[0]!;
    rgba[i * 4 + 1] = c[1]!;
    rgba[i * 4 + 2] = c[2]!;
    rgba[i * 4 + 3] = 255;
  };
  const grey = [176, 176, 176];
  const bevelInk = [232, 232, 232];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const b = CARD.border;
      if (x < b || y < b || x >= W - b || y >= H - b) { put(i, grey); continue; }
      const w = CARD.win;
      const inOuter = x >= w.x0 && x < w.x1 && y >= w.y0 && y < w.y1;
      const inInner =
        x >= w.x0 + CARD.bevel && x < w.x1 - CARD.bevel && y >= w.y0 + CARD.bevel && y < w.y1 - CARD.bevel;
      if (inOuter && !inInner) { put(i, bevelInk); continue; } // the bevel ring
      if (inInner) {
        const sub = x >= 110 && x < 175 && y >= 95 && y < 165;
        put(i, sub ? subject : bg);
        continue;
      }
      const s = CARD.strip;
      if (x >= s.x0 && x < s.x1 && y >= s.y0 && y < s.y1) { put(i, grey); continue; }
      const t = CARD.tag;
      if (x >= t.x0 && x < t.x1 && y >= t.y0 && y < t.y1) { put(i, grey); continue; }
      put(i, frame);
    }
  }
  return { width: W, height: H, rgba };
}

/** foil = the coloured frame body only (a reverse-holo `sheet`). */
function sheetMask(): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const b = CARD.border;
      if (x < b || y < b || x >= W - b || y >= H - b) continue;
      const w = CARD.win;
      if (x >= w.x0 && x < w.x1 && y >= w.y0 && y < w.y1) continue;
      const s = CARD.strip;
      if (x >= s.x0 && x < s.x1 && y >= s.y0 && y < s.y1) continue;
      const t = CARD.tag;
      if (x >= t.x0 && x < t.x1 && y >= t.y0 && y < t.y1) continue;
      a[y * W + x] = 255;
    }
  }
  return a;
}

/** foil = inside the illustration, minus the subject (a classic `window` holo). */
function windowMask(): Uint8Array {
  const a = new Uint8Array(W * H);
  const w = CARD.win;
  for (let y = w.y0 + CARD.bevel; y < w.y1 - CARD.bevel; y++) {
    for (let x = w.x0 + CARD.bevel; x < w.x1 - CARD.bevel; x++) {
      if (x >= 110 && x < 175 && y >= 95 && y < 165) continue; // the subject
      a[y * W + x] = 255;
    }
  }
  return a;
}

const PRIOR: WindowRect = { x0: 33, y0: 63, x1: 207, y1: 187 }; // a deliberately-wrong era rect

function exemplar(card: string, art: RgbaImage, alpha: Uint8Array, foilInside: boolean, weight = 1): PolicyExemplar {
  return { card, alpha, partition: partitionCard(art, PRIOR, DEFAULT_REGION_LEARN_PARAMS, foilInside), weight };
}

// ── 1. The policy is READ off the pixels ───────────────────────────────────

test('the same code reads OPPOSITE policies from a sheet mask and a window mask', () => {
  const art = syntheticCard([60, 190, 90], [40, 60, 170], [240, 220, 200]);

  const sheet = learnPolicy('synth', 'sheet', [
    exemplar('a/1', art, sheetMask(), false),
    exemplar('b/1', art, sheetMask(), false),
  ]);
  assert.deepEqual(sheet.foilClasses, ['frameBody'], 'a reverse-holo mask must teach "the coloured frame carries foil"');

  const win = learnPolicy('synth', 'window', [
    exemplar('a/1', art, windowMask(), true),
    exemplar('b/1', art, windowMask(), true),
  ]);
  assert.deepEqual(win.foilClasses, ['windowBackground'], 'a classic holo mask must teach "the illustration background carries foil"');

  // The verdict alone could be produced by a hard-coded table. The VOTES are what
  // prove it was read: each policy must show the other's winning class as excluded.
  const share = (p: typeof sheet, cls: string): number => p.votes.find((v) => v.cls === cls)?.mean ?? -1;
  assert.ok(share(sheet, 'frameBody') > 0.9, `sheet frameBody share ${share(sheet, 'frameBody')}`);
  assert.ok(share(sheet, 'windowBackground') < 0.1, `sheet must EXCLUDE the illustration (${share(sheet, 'windowBackground')})`);
  assert.ok(share(win, 'windowBackground') > 0.9, `window windowBackground share ${share(win, 'windowBackground')}`);
  assert.ok(share(win, 'frameBody') < 0.1, `window must EXCLUDE the frame body (${share(win, 'frameBody')})`);
});

test('the silver furniture and the border ring are read as EXCLUDED, not guessed', () => {
  const art = syntheticCard([60, 190, 90], [40, 60, 170], [240, 220, 200]);
  const p = learnPolicy('synth', 'sheet', [exemplar('a/1', art, sheetMask(), false), exemplar('b/1', art, sheetMask(), false)]);
  const border = p.votes.find((v) => v.cls === 'border');
  const furniture = p.votes.find((v) => v.cls === 'furniture');
  assert.ok(border && border.shares.length > 0, 'the border ring must actually cast a vote (it exists on this card)');
  assert.ok(border.mean < 0.1, `border foil share ${String(border.mean)} — the ring must read as excluded`);
  assert.ok(furniture && furniture.mean < 0.3, `furniture foil share ${String(furniture?.mean)} — the strip/tag must read as excluded`);
  assert.ok(!p.foilClasses.includes('border'));
  assert.ok(!p.foilClasses.includes('furniture'));
});

test('applying a learned policy reproduces the mask it was learned from', () => {
  const art = syntheticCard([60, 190, 90], [40, 60, 170], [240, 220, 200]);
  const truth = sheetMask();
  const p = learnPolicy('synth', 'sheet', [exemplar('a/1', art, truth, false), exemplar('b/1', art, truth, false)]);
  const got = applyPolicy(art, PRIOR, p);
  assert.ok(iou(got.alpha, truth) > 0.95, `IoU ${iou(got.alpha, truth)} — the policy must round-trip its own evidence`);
  const bnd = boundaryDistance(got.alpha, truth, W, H);
  assert.ok(bnd.mean < 3, `boundary mean ${bnd.mean}px`);
});

// ── 2. Disagreement is reported, never averaged away ───────────────────────

test('exemplars that split on a class are REPORTED as disputed, with both numbers', () => {
  const art = syntheticCard([60, 190, 90], [40, 60, 170], [240, 220, 200]);
  // One "human" foils the frame body; the other also foils the species strip and tag.
  const generous = sheetMask();
  for (let y = CARD.strip.y0; y < CARD.strip.y1; y++)
    for (let x = CARD.strip.x0; x < CARD.strip.x1; x++) generous[y * W + x] = 255;
  for (let y = CARD.tag.y0; y < CARD.tag.y1; y++)
    for (let x = CARD.tag.x0; x < CARD.tag.x1; x++) generous[y * W + x] = 255;

  const p = learnPolicy('synth', 'sheet', [
    exemplar('strict/1', art, sheetMask(), false),
    exemplar('generous/1', art, generous, false),
  ]);
  const furniture = p.votes.find((v) => v.cls === 'furniture')!;
  assert.ok(furniture.spread > DEFAULT_REGION_LEARN_PARAMS.disagreeSpread, `spread ${furniture.spread} must exceed the threshold`);
  assert.equal(furniture.disputed, true);
  assert.equal(furniture.shares.length, 2, 'both exemplars must be listed individually, not collapsed to a mean');
  assert.ok(p.disagreements.some((d) => d.startsWith('furniture')), `disagreements: ${p.disagreements.join(' | ')}`);
  assert.ok(p.statement.includes('DISPUTED'), 'the plain-language statement must carry the dispute forward');
});

// ── 3. Anti-feedback-collapse: `ai` is never an exemplar ───────────────────

function fakeEntry(cardId: string, method: MaskSidecarV3['derivation_method']): CorpusEntry {
  const sidecar = {
    version: 3,
    cardId,
    variantId: '1',
    artworkKey: cardId,
    width: W,
    height: H,
    channel: 'alpha',
    derivation_method: method,
    savedAt: '2026-08-08T00:00:00.000Z',
    prior: { source: 'layout', eraId: 'synth', scope: 'sheet', rect: [0, 0, 1, 1], radius: 0, invert: false, feather: 0, resolverVersion: 5 },
  } as unknown as MaskSidecarV3;
  return {
    cardId,
    variantId: 1,
    sidecar,
    files: { mask: '', sidecar: '', prior: null, diff: null, parent: null, parentDiff: null },
  };
}

test('unreviewed `ai` masks can never become exemplars — weight, selection, and reason', () => {
  // The weight table is the root of the rule; nothing downstream can override it.
  assert.equal(EXEMPLAR_WEIGHT.ai, 0, 'unreviewed machine output is weight 0, permanently');
  assert.equal(EXEMPLAR_WEIGHT['layout-flatten'], 0);
  assert.equal(isExemplarEligible('ai'), false);

  const corpus = [
    fakeEntry('hand-1', 'hand'),
    fakeEntry('ai-1', 'ai'),
    fakeEntry('ai-2', 'ai'),
    fakeEntry('ai-3', 'ai'),
    fakeEntry('flat-1', 'layout-flatten'),
    fakeEntry('corrected-1', 'ai-corrected'),
  ];
  const sel = selectExemplars(corpus, { eraId: 'synth', scope: 'sheet' });
  assert.deepEqual(sel.chosen.map((c) => c.cardId).sort(), ['corrected-1', 'hand-1']);
  // Outnumbering the humans 3:1 changes nothing — this is not a majority rule.
  for (const id of ['ai-1', 'ai-2', 'ai-3']) {
    const r = sel.rejected.find((x) => x.cardId === id);
    assert.ok(r, `${id} must appear in rejected`);
    assert.match(r.reason, /anti-feedback-collapse/);
  }
  // A human correction still ranks BELOW an unanchored human mask.
  assert.ok(sel.chosen[0]!.weight > sel.chosen[1]!.weight || sel.chosen[0]!.cardId === 'hand-1');
  assert.equal(sel.chosen.find((c) => c.cardId === 'hand-1')!.weight, 1);
  assert.equal(sel.chosen.find((c) => c.cardId === 'corrected-1')!.weight, 0.6);
});

test('a policy learned from a selection weights an `ai-corrected` mask below a `hand` one', () => {
  const art = syntheticCard([60, 190, 90], [40, 60, 170], [240, 220, 200]);
  // The human says the strip is NOT foil; a corrected-AI mask says it is. The weights
  // decide, and the human must win — a 0.6 mask cannot outvote a 1.0 one.
  const generous = sheetMask();
  for (let y = CARD.strip.y0; y < CARD.strip.y1; y++)
    for (let x = CARD.strip.x0; x < CARD.strip.x1; x++) generous[y * W + x] = 255;
  const p = learnPolicy('synth', 'sheet', [
    exemplar('hand/1', art, sheetMask(), false, EXEMPLAR_WEIGHT.hand),
    exemplar('corrected/1', art, generous, false, EXEMPLAR_WEIGHT['ai-corrected']),
  ]);
  assert.deepEqual(p.foilClasses, ['frameBody']);
  const furniture = p.votes.find((v) => v.cls === 'furniture')!;
  assert.ok(furniture.mean < 0.5, `weighted furniture share ${furniture.mean} — the hand mask must dominate`);
});

// ── 4. The bevel side ──────────────────────────────────────────────────────

test('the window edge is taken on the FOIL side of the bevel, not at the strongest line', () => {
  const art = syntheticCard([60, 190, 90], [40, 60, 170], [240, 220, 200]);
  const inner = detectWindow(art, PRIOR, DEFAULT_REGION_LEARN_PARAMS, true).window;
  const outer = detectWindow(art, PRIOR, DEFAULT_REGION_LEARN_PARAMS, false).window;
  // foil inside ⇒ the box shrinks to the bevel's inner line; foil outside ⇒ it grows
  // to the outer line. Same card, same code, opposite picks.
  assert.ok(inner.x0 > outer.x0, `inner.x0 ${inner.x0} must be right of outer.x0 ${outer.x0}`);
  assert.ok(inner.x1 < outer.x1, `inner.x1 ${inner.x1} must be left of outer.x1 ${outer.x1}`);
  assert.ok(inner.y0 > outer.y0 && inner.y1 < outer.y1);
  // …and each lands on the printed line it claims, within a pixel.
  assert.ok(Math.abs(outer.x0 - CARD.win.x0) <= 1, `outer left ${outer.x0} vs printed ${CARD.win.x0}`);
  assert.ok(Math.abs(inner.x0 - (CARD.win.x0 + CARD.bevel)) <= 1, `inner left ${inner.x0} vs printed ${CARD.win.x0 + CARD.bevel}`);
});

test('a window edge with no printed evidence keeps the prior and says so', () => {
  // A blank card: no illustration box at all, so there is nothing to detect.
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = 60; rgba[i * 4 + 1] = 190; rgba[i * 4 + 2] = 90; rgba[i * 4 + 3] = 255; }
  const blank: RgbaImage = { width: W, height: H, rgba };
  const r = detectWindow(blank, PRIOR, DEFAULT_REGION_LEARN_PARAMS, false);
  assert.deepEqual(r.window, PRIOR, 'with no edge under it, the prior must survive untouched');
  assert.ok(r.evidence.every((e) => !e.accepted), 'and every edge must be reported as REFUSED');
});

test('a detected edge further than windowMaxMovePx from the prior is refused as a different feature', () => {
  const art = syntheticCard([60, 190, 90], [40, 60, 170], [240, 220, 200]);
  const far: WindowRect = { x0: PRIOR.x0, y0: PRIOR.y0, x1: PRIOR.x1, y1: PRIOR.y1 + 60 };
  const r = detectWindow(art, far, { ...DEFAULT_REGION_LEARN_PARAMS, windowMaxMovePx: 6 }, false);
  const bottom = r.evidence.find((e) => e.edge === 'bottom')!;
  assert.equal(bottom.accepted, false);
  assert.equal(bottom.foundPx, far.y1, 'a refused edge reports the prior it kept, not the peak it saw');
});

// ── The partition itself ───────────────────────────────────────────────────

test('the five classes partition the face exactly once, and each one is found', () => {
  const art = syntheticCard([60, 190, 90], [40, 60, 170], [240, 220, 200]);
  const part = partitionCard(art, PRIOR, DEFAULT_REGION_LEARN_PARAMS, false);
  assert.equal(part.counts.reduce((a, b) => a + b, 0), W * H, 'every pixel gets exactly one class');
  for (const cls of ['border', 'furniture', 'frameBody', 'windowBackground', 'windowSubject'] as const) {
    assert.ok(part.counts[CLASS_INDEX[cls]]! > 200, `${cls} should be present on this card (got ${part.counts[CLASS_INDEX[cls]]})`);
  }
  // The subject really is the bright block we drew, not a slice of background.
  const subjectPx = part.counts[CLASS_INDEX.windowSubject]!;
  assert.ok(subjectPx > 3000 && subjectPx < 8000, `windowSubject ${subjectPx}px vs the 65×70 block we printed`);
});

test('a chromatic island marooned inside silver furniture is not frame body', () => {
  // The sprite inside an evolution medallion is coloured, but it is not the frame.
  const art = syntheticCard([60, 190, 90], [40, 60, 170], [240, 220, 200]);
  const cx = 40;
  const cy = 240;
  for (let y = cy - 18; y < cy + 18; y++)
    for (let x = cx - 18; x < cx + 18; x++) {
      const i = y * W + x;
      const inSprite = Math.abs(x - cx) < 7 && Math.abs(y - cy) < 7;
      art.rgba[i * 4] = inSprite ? 220 : 176;
      art.rgba[i * 4 + 1] = inSprite ? 40 : 176;
      art.rgba[i * 4 + 2] = inSprite ? 40 : 176;
    }
  const part = partitionCard(art, PRIOR, DEFAULT_REGION_LEARN_PARAMS, false);
  let spriteFrame = 0;
  for (let y = cy - 6; y < cy + 6; y++)
    for (let x = cx - 6; x < cx + 6; x++) if (part.cls[y * W + x] === CLASS_INDEX.frameBody) spriteFrame++;
  assert.equal(spriteFrame, 0, 'the marooned coloured sprite must not be classed as frame body');
});
