// Pure unit test for rarity.ts — the printed rarity mark table and lookup.
//
// Pins the things that would actually break: that the table is exhaustive against
// the 30 live catalog strings, that the official SV star ladder is exactly right
// (count + tone), that rarityMark() is total for null / unknown / casing, and
// that no two rarities which print DIFFERENT marks collapse to the same spec
// (the only shared specs are the genuinely-identical printed marks).
//
// Mirrors the `node --import tsx --test` convention used by the other lib tests
// (see jsonContentType.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RARITY_MARKS, rarityMark, type RarityMarkSpec } from '../rarity.js';

// The 30 distinct `card_card.rarity` values from the live DeckPal English catalog
// (inputs/rarities.json), verbatim — including the upstream catalog's
// inconsistent capitalisation. These are the table's keys.
const CATALOG = [
  'Common',
  'Uncommon',
  'Rare',
  'Ultra Rare',
  'Promo',
  'Holo Rare',
  'Secret Rare',
  'None',
  'Illustration rare',
  'Double rare',
  'Shiny rare',
  'Holo Rare V',
  'Special illustration rare',
  'Rare Holo',
  'Holo Rare VMAX',
  'Hyper rare',
  'Rare Holo LV.X',
  'ACE SPEC Rare',
  'Holo Rare VSTAR',
  'Rare PRIME',
  'Classic Collection',
  'LEGEND',
  'Radiant Rare',
  'Shiny Ultra Rare',
  'Amazing Rare',
  'Shiny rare V',
  'Mega Hyper Rare',
  'Shiny rare VMAX',
  'Full Art Trainer',
  'Black White Rare',
] as const;

// A spec's visual identity: anything not in here (label / note) does not change
// what is drawn, so collisions are checked on these fields only.
function signature(spec: RarityMarkSpec): string {
  return JSON.stringify({ shape: spec.shape, count: spec.count, tone: spec.tone, word: spec.word ?? null });
}

test('the table is exhaustive against the 30 catalog strings — no more, no less', () => {
  const keys = Object.keys(RARITY_MARKS);
  assert.equal(keys.length, 30, `expected 30 rarity keys, got ${keys.length}`);
  assert.deepEqual([...keys].sort(), [...CATALOG].sort(), 'table keys must match the catalog strings exactly');
});

test('every catalog string resolves through rarityMark() to its table spec (not the fallback)', () => {
  for (const r of CATALOG) {
    const spec = rarityMark(r);
    assert.equal(spec, RARITY_MARKS[r], `${r} should resolve to its exact table entry`);
    assert.notEqual(spec.label, 'Unknown rarity', `${r} must not fall through to the unknown fallback`);
  }
});

test('count is an integer in 0..3 for every spec', () => {
  for (const [k, spec] of Object.entries(RARITY_MARKS)) {
    assert.ok(Number.isInteger(spec.count), `${k}: count must be an integer`);
    assert.ok(spec.count >= 0 && spec.count <= 3, `${k}: count ${spec.count} out of range 0..3`);
  }
});

test('the official SV star ladder is exactly right (shape + count + tone)', () => {
  // From Pokemon's own Scarlet & Violet rarity key — the contract this app's
  // marks must match. Hyper rare is THREE gold stars, not two.
  assert.deepEqual(rarityMark('Common'), { shape: 'circle', count: 1, tone: 'black', label: 'Common' });
  assert.deepEqual(rarityMark('Uncommon'), { shape: 'diamond', count: 1, tone: 'black', label: 'Uncommon' });
  assert.deepEqual(rarityMark('Rare'), { shape: 'star', count: 1, tone: 'black', label: 'Rare' });
  assert.deepEqual(rarityMark('Double rare'), { shape: 'star', count: 2, tone: 'black', label: 'Double rare' });
  assert.deepEqual(rarityMark('Ultra Rare'), { shape: 'star', count: 2, tone: 'silver', label: 'Ultra Rare' });
  assert.deepEqual(rarityMark('Illustration rare'), { shape: 'star', count: 1, tone: 'gold', label: 'Illustration rare' });
  assert.deepEqual(rarityMark('Special illustration rare'), { shape: 'star', count: 2, tone: 'gold', label: 'Special illustration rare' });
  assert.deepEqual(rarityMark('Hyper rare'), { shape: 'star', count: 3, tone: 'gold', label: 'Hyper rare' });
  assert.deepEqual(rarityMark('Mega Hyper Rare').shape, 'star-double-stroke');
  assert.deepEqual(rarityMark('Mega Hyper Rare').count, 1);
  assert.deepEqual(rarityMark('Mega Hyper Rare').tone, 'gold');
  assert.deepEqual(rarityMark('None'), { shape: 'none', count: 0, tone: 'black', label: 'None' });
});

test('Hyper rare is three stars — the correction that matters most', () => {
  const h = rarityMark('Hyper rare');
  assert.equal(h.count, 3, 'Hyper rare must be THREE stars (it was wrongly one)');
  assert.equal(h.tone, 'gold');
  // and it must not collide with the two-gold Special illustration rare
  assert.notEqual(rarityMark('Special illustration rare').count, h.count);
});

test('the classic three are a circle, a diamond, and a star — not three stars', () => {
  assert.equal(rarityMark('Common').shape, 'circle');
  assert.equal(rarityMark('Uncommon').shape, 'diamond');
  assert.equal(rarityMark('Rare').shape, 'star');
});

test('rarityMark() is total: never throws for null, undefined, or an unknown string', () => {
  assert.doesNotThrow(() => rarityMark(null));
  assert.doesNotThrow(() => rarityMark(undefined));
  assert.doesNotThrow(() => rarityMark(''));
  assert.doesNotThrow(() => rarityMark('Hyper Rare Banana'));
});

test('null / undefined resolve to no mark at all (the true no-rarity case)', () => {
  assert.equal(rarityMark(null).shape, 'none');
  assert.equal(rarityMark(undefined).shape, 'none');
  assert.equal(rarityMark(null).count, 0);
});

test('a novel string degrades to a visible neutral spec, not silence', () => {
  const unknown = rarityMark('Hyper Rare Banana');
  assert.notEqual(unknown.shape, 'none', 'an unknown non-null string should still render a mark');
  assert.equal(unknown.label, 'Unknown rarity');
});

test('a future catalog casing change degrades gracefully via a case-insensitive pass', () => {
  for (const r of CATALOG) {
    assert.equal(rarityMark(r.toUpperCase()), RARITY_MARKS[r], `${r} should match case-insensitively`);
  }
  // 'Hyper rare' is lowercase-r in the catalog; the old glyph treated it fine,
  // but a 'HYPER RARE' must still resolve to three gold stars.
  assert.equal(rarityMark('HYPER RARE').count, 3);
  assert.equal(rarityMark('hyper rare').count, 3);
});

test('no two rarities that print DIFFERENT marks collapse to the same spec', () => {
  // Group every catalog rarity by its visual signature. The only groups with
  // more than one member must be rarities that genuinely print the SAME mark —
  // the table never silently merges two visually-distinct tiers.
  const groups = new Map<string, string[]>();
  for (const r of CATALOG) {
    const sig = signature(rarityMark(r));
    const arr = groups.get(sig) ?? [];
    arr.push(r);
    groups.set(sig, arr);
  }
  const multi = [...groups.values()]
    .filter((arr) => arr.length > 1)
    .map((arr) => [...arr].sort())
    .sort((a, b) => a.join(',').localeCompare(b.join(',')));

  // The genuinely-identical printed marks (verified against card scans — see
  // the per-entry citations in rarity.ts):
  //   • The single solid black star group: Rare, Rare Holo, Holo Rare, Holo
  //     Rare V, Holo Rare VMAX, Holo Rare VSTAR, Rare Holo LV.X, Rare PRIME,
  //     Radiant Rare, Full Art Trainer. All of these print one plain black star
  //     (a holo finish or a V/PRIME/RADIANT variant is not a different shape);
  //     the old table wrongly rendered six of them as invented letter badges.
  //   • The no-mark group: None (no rarity string) and Shiny rare V
  //     (swsh45sv/SV105 prints no rarity symbol at all) — both render nothing.
  const allowed = [
    ['Full Art Trainer', 'Holo Rare', 'Holo Rare V', 'Holo Rare VMAX', 'Holo Rare VSTAR', 'Radiant Rare', 'Rare', 'Rare Holo', 'Rare Holo LV.X', 'Rare PRIME'],
    ['None', 'Shiny rare V'],
  ].sort((a, b) => a.join(',').localeCompare(b.join(',')));

  assert.deepEqual(multi, allowed, 'the only shared specs must be the genuinely-identical printed marks');
});

test('the distinct tiers of the star ladder do not collapse into each other', () => {
  const pairs: Array<[string, string]> = [
    ['Rare', 'Double rare'], // one vs two black
    ['Double rare', 'Ultra Rare'], // black vs silver
    ['Ultra Rare', 'Illustration rare'], // silver vs gold / two vs one
    ['Illustration rare', 'Special illustration rare'], // one vs two gold
    ['Special illustration rare', 'Hyper rare'], // two vs three gold
    ['Hyper rare', 'Mega Hyper Rare'], // plain star vs double-stroke
    ['Rare', 'Mega Hyper Rare'], // plain star must differ from the double-stroke
  ];
  for (const [a, b] of pairs) {
    assert.notDeepEqual(signature(rarityMark(a)), signature(rarityMark(b)), `${a} and ${b} must not collapse`);
  }
});
