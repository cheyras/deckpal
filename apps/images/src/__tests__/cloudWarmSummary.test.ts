import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffResidue, summarizeWarmResidue, type ResidueEntry } from '../cloudWarmSummary.js';

/**
 * The regression-detection half of issue #24's fix: `diffResidue` and
 * `summarizeWarmResidue` are what turns "MEP grew 60 -> 89 cards and nobody
 * re-warmed it" from a silent three-week gap into a number that changes in a
 * job summary the run after it happens. Pure, so the diff and the rendering are
 * provable without a deployment or a residue sweep of the live catalog.
 */

const mep87: ResidueEntry = {
  category: 'card',
  setId: 'mep',
  cardId: 'mep-087',
  key: '/deckpal/images/en/me/mep/087/low.webp',
  reason: 'upstream 404: HTTP 404',
};
const mep88: ResidueEntry = {
  category: 'card',
  setId: 'mep',
  cardId: 'mep-088',
  key: '/deckpal/images/en/me/mep/088/low.webp',
  reason: 'upstream 404: HTTP 404',
};
const svp223: ResidueEntry = {
  category: 'card',
  setId: 'svp',
  cardId: 'svp-223',
  key: '/deckpal/images/en/sv/svp/223/low.webp',
  reason: 'upstream 404: HTTP 404',
};

test('diffResidue: a key present nowhere before is a new gap', () => {
  const { newGaps, resolved } = diffResidue([], [mep87]);
  assert.deepEqual(newGaps, [mep87]);
  assert.deepEqual(resolved, []);
});

test('diffResidue: a key present before but not now is resolved', () => {
  const { newGaps, resolved } = diffResidue([mep87], []);
  assert.deepEqual(newGaps, []);
  assert.deepEqual(resolved, [mep87]);
});

test('diffResidue: unchanged keys are neither new nor resolved', () => {
  const { newGaps, resolved } = diffResidue([mep87, svp223], [mep87, svp223]);
  assert.deepEqual(newGaps, []);
  assert.deepEqual(resolved, []);
});

test('diffResidue: matches by key, not by array position or object identity', () => {
  const before = [{ ...mep87 }];
  const after = [{ ...mep87 }]; // a fresh object with the same key
  const { newGaps, resolved } = diffResidue(before, after);
  assert.deepEqual(newGaps, []);
  assert.deepEqual(resolved, []);
});

test('diffResidue: mixed run — one new, one resolved, one unchanged', () => {
  const before = [mep87, svp223];
  const after = [svp223, mep88]; // mep87 resolved, mep88 new, svp223 unchanged
  const { newGaps, resolved } = diffResidue(before, after);
  assert.deepEqual(newGaps, [mep88]);
  assert.deepEqual(resolved, [mep87]);
});

test('summarizeWarmResidue: no baseline reads as a snapshot, not a comparison', () => {
  const md = summarizeWarmResidue({ base: 'https://deckpal.app', current: [mep87, mep88] });
  assert.match(md, /No baseline for this run/);
  assert.doesNotMatch(md, /new gap/i);
  assert.match(md, /\*\*2\*\* asset\(s\)/);
});

test('summarizeWarmResidue: a baseline with no drift says so plainly', () => {
  const md = summarizeWarmResidue({
    base: 'https://deckpal.app',
    current: [mep87, mep88],
    baseline: [mep87, mep88],
  });
  assert.match(md, /No new gaps since the last recorded baseline/);
});

test('summarizeWarmResidue: new gaps are called out with a per-set breakdown', () => {
  const md = summarizeWarmResidue({
    base: 'https://deckpal.app',
    current: [mep87, mep88, svp223],
    baseline: [svp223],
  });
  assert.match(md, /⚠ 2 new gap\(s\) since the last baseline/);
  assert.match(md, /\| `mep` \| 2 \|/);
  assert.doesNotMatch(md, /\| `svp` \| \d \|.*new gap/s); // svp223 was already known, not counted as new
});

test('summarizeWarmResidue: resolved rows are reported, never silently dropped', () => {
  const md = summarizeWarmResidue({
    base: 'https://deckpal.app',
    current: [svp223],
    baseline: [mep87, svp223],
  });
  assert.match(md, /\*\*1\*\* resolved since then/);
});

test('summarizeWarmResidue: an empty current residue still renders (nothing to warn about)', () => {
  const md = summarizeWarmResidue({ base: 'https://deckpal.app', current: [] });
  assert.match(md, /\*\*0\*\* asset\(s\)/);
  assert.match(md, /_none_/);
});
