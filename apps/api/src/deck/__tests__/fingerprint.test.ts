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
