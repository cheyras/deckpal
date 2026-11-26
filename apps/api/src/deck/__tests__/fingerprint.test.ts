import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playableFingerprint, hasFullGameplayData, type FingerprintInput } from '../fingerprint.js';

const baseCharizard: FingerprintInput = {
  name: 'Charizard ex',
  category: 'Pokemon',
  hp: 330,
  types: ['Fire'],
  stage: 'Stage2',
  suffix: 'ex',
  evolveFrom: 'Charmeleon',
  attacks: [
    { name: 'Burning Darkness', cost: 'Fire,Fire', damage: '180', effect: 'plus 30 more per prize taken' },
  ],
  abilities: [{ kind: 'Ability', name: 'Infernal Reign', effect: 'attach 3 Fire Energy from deck' }],
  retreat: 2,
};

test('reprint equivalence: same gameplay, different print -> same fingerprint', () => {
  // OBF 125 vs 151 006 — identical playable card, different set/number (ignored)
  const fpA = playableFingerprint(baseCharizard);
  const fpB = playableFingerprint({ ...baseCharizard }); // print fields aren't even inputs
  assert.equal(fpA, fpB);
  assert.equal(fpA?.length, 64);
});

test('different rule text -> different fingerprint (Rainbow Energy CES vs TR, §2.1.5)', () => {
  const cesRainbow: FingerprintInput = {
    name: 'Rainbow Energy', category: 'Energy', energyType: 'Special',
    effect: 'Provides every type of Energy. Put 1 damage counter on this Pokémon when you attach it.',
  };
  const trRainbow: FingerprintInput = {
    name: 'Rainbow Energy', category: 'Energy', energyType: 'Special',
    effect: 'Provides every type of Energy. This Pokémon does 10 damage to itself when you attach it.',
  };
  assert.notEqual(playableFingerprint(cesRainbow), playableFingerprint(trRainbow));
});

test('case/whitespace normalisation collides', () => {
  const a = playableFingerprint({ ...baseCharizard, name: 'CHARIZARD  EX' });
  const b = playableFingerprint({ ...baseCharizard, name: 'Charizard ex' });
  assert.equal(a, b);
});

test('thin data refuses to fingerprint (guard)', () => {
  const listOnly: FingerprintInput = { name: 'Pidgey', category: 'Pokemon', hp: null };
  assert.equal(hasFullGameplayData(listOnly), false);
  assert.equal(playableFingerprint(listOnly), null);
});

test('basic Energy (no text) still fingerprints', () => {
  const fire: FingerprintInput = { name: 'Fire Energy', category: 'Energy', energyType: 'Normal' };
  assert.equal(hasFullGameplayData(fire), true);
  assert.ok(playableFingerprint(fire));
});

// ── Energy symbols in rules text (2026-11-17) ─────────────────────────────────
//
// TCGdex writes "{R}" in some printings and "Fire" in others for the same card.
// Rules text is hashed with symbols spelled out, so a reprint stays one card.

const delphox = (flaringMagic: string): FingerprintInput => ({
  name: 'Delphox', category: 'Pokemon', hp: 150, types: ['Fire'], stage: 'Stage2', evolveFrom: 'Braixen',
  attacks: [{ name: 'Energized Storm', cost: 'Fire,Fire', damage: '30×', effect: 'This attack does 30 damage for each Energy attached to all Pokémon.' }],
  abilities: [{ kind: 'Ability', name: 'Flaring Magic', effect: flaringMagic }],
  weaknesses: [{ type: 'Water', value: '×2' }],
  retreat: 2,
});

test('Delphox me04-013 ({R}) and mep-074 (Fire) are one card', () => {
  const me04 = delphox('Once during your turn, you may discard a Basic {R} Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand.');
  const mep = delphox('Once during your turn, you may discard a Basic Fire Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand.');
  assert.equal(playableFingerprint(me04), playableFingerprint(mep));
});

test('Moltres 30th-011 (Fire) and mep-096 ({R}) are one card; attack-effect and trainer text fold too', () => {
  const moltres = (energy: string): FingerprintInput => ({
    name: 'Moltres', category: 'Pokemon', hp: 120, types: ['Fire'],
    attacks: [{ name: 'Fire Spin', cost: 'Fire,Fire,Colorless', damage: '130', effect: `Discard 2 ${energy} Energy from this Pokémon.` }],
    abilities: [{ kind: 'Ability', name: 'Fiery Flapping', effect: `Attach a Basic ${energy} Energy card from your hand to this Pokémon.` }],
  });
  assert.equal(playableFingerprint(moltres('Fire')), playableFingerprint(moltres('{R}')));
  const trainer = (t: string): FingerprintInput => ({ name: 'Energy Search', category: 'Trainer', trainerType: 'Item', effect: `Search your deck for a Basic ${t} Energy card.` });
  assert.equal(playableFingerprint(trainer('{L}')), playableFingerprint(trainer('Lightning')));
  assert.equal(
    playableFingerprint(trainer('<span class="energy-symbol Lightning" title="Lightning">Lightning</span>')),
    playableFingerprint(trainer('{L}')),
  );
});

test('a different Energy TYPE is still a different card', () => {
  const t = (x: string): FingerprintInput => ({ name: 'X', category: 'Trainer', effect: `Attach a Basic ${x} Energy card.` });
  assert.notEqual(playableFingerprint(t('{R}')), playableFingerprint(t('Water')));
  assert.notEqual(playableFingerprint(t('{R}')), playableFingerprint(t('{W}')));
});

test('names and costs are not folded: "Basic {R} Energy" and "Basic Fire Energy" stay distinct names', () => {
  const a: FingerprintInput = { name: 'Basic {R} Energy', category: 'Energy', energyType: 'Normal' };
  const b: FingerprintInput = { name: 'Basic Fire Energy', category: 'Energy', energyType: 'Normal' };
  assert.notEqual(playableFingerprint(a), playableFingerprint(b));
  const cost = (c: string): FingerprintInput => ({ ...baseCharizard, attacks: [{ name: 'A', cost: c, damage: '10', effect: null }] });
  assert.notEqual(playableFingerprint(cost('{R}')), playableFingerprint(cost('Fire')));
});

test('a card with no Energy symbol and no HTML tag keeps the exact hash it had before the fold', () => {
  // Computed with the pre-2026-11-17 fingerprint.ts. If this moves, `fingerprint:index --all` would
  // rewrite every row instead of only the ones that carry a `{X}` symbol or an HTML tag. (Text with
  // a tag DOES move — see the <em> test below — and that is intended.)
  assert.equal(playableFingerprint(baseCharizard), '658408e964b252ddac30aab3c3428a0fc2c4dc0f3b3837a5046b4cc90caf89af');
});

test('tagged reminder text (30th Celebration <em>) hashes the same as the untagged printing', () => {
  // Every tag is dropped, not only the energy-symbol span, so this hash differs from the
  // pre-2026-11-17 one for the tagged printing: the two printings now group as one card.
  const reminder = (r: string): FingerprintInput => ({
    ...baseCharizard,
    attacks: [{ name: 'Burning Darkness', cost: 'Fire,Fire', damage: '180', effect: `plus 30 more per prize taken ${r}` }],
  });
  const tagged = reminder('<em>(You can\'t use more than 1 GX attack in a game.)</em>');
  const plain = reminder('(You can\'t use more than 1 GX attack in a game.)');
  assert.equal(playableFingerprint(tagged), playableFingerprint(plain));
});

test('an empty energy-symbol span still hashes as its type, never as nothing', () => {
  const t = (type: string): FingerprintInput => ({
    name: 'X', category: 'Trainer', effect: `Attach a Basic <span class="energy-symbol ${type}" title="${type}"></span> Energy card.`,
  });
  assert.notEqual(playableFingerprint(t('Fire')), playableFingerprint(t('Water')));
  assert.equal(playableFingerprint(t('Fire')), playableFingerprint({ name: 'X', category: 'Trainer', effect: 'Attach a Basic {R} Energy card.' }));
});
