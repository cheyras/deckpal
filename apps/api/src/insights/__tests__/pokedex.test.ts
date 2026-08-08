import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capturesSpecies,
  capturedSpeciesSet,
  countCapturedSpecies,
  speciesLevel,
  shinyBreadth,
  isShiny,
  speciesSprite,
  type OwnedCardForCapture,
} from '../pokedex.js';

// ── the category='Pokemon' gate — the load-bearing rule (DEX-DATA §A.3, §D.2) ──
test('gate — a Trainer card with dexIds does NOT capture', () => {
  // "Tropical Tidal Wave" is a real Trainer carrying dexId [25,183,54,187].
  const trainer: OwnedCardForCapture = { category: 'Trainer', quantity: 3, dexIds: [25, 183, 54, 187] };
  assert.equal(capturesSpecies(trainer), false);
  assert.equal(countCapturedSpecies([trainer]), 0);
});

test('gate — Energy card with a stray dexId does NOT capture', () => {
  const energy: OwnedCardForCapture = { category: 'Energy', quantity: 1, dexIds: [25] };
  assert.equal(capturesSpecies(energy), false);
});

test('gate — a Trainer next to a Pokémon: only the Pokémon captures', () => {
  const cards: OwnedCardForCapture[] = [
    { category: 'Trainer', quantity: 3, dexIds: [25, 183, 54, 187] }, // captures nothing
    { category: 'Pokemon', quantity: 1, dexIds: [6] }, // captures Charizard
  ];
  assert.deepEqual([...capturedSpeciesSet(cards)].sort((a, b) => a - b), [6]);
});

test('capture — Pokémon at quantity 0 (a "Need" row) does NOT capture', () => {
  assert.equal(capturesSpecies({ category: 'Pokemon', quantity: 0, dexIds: [6] }), false);
});

test('capture — a tag-team card captures every species in its dexId array', () => {
  // Pikachu & Zekrom GX → [25, 644]
  const cards: OwnedCardForCapture[] = [{ category: 'Pokemon', quantity: 1, dexIds: [25, 644] }];
  assert.deepEqual([...capturedSpeciesSet(cards)].sort((a, b) => a - b), [25, 644]);
});

test('capture — duplicate species across cards counted once', () => {
  const cards: OwnedCardForCapture[] = [
    { category: 'Pokemon', quantity: 1, dexIds: [6] },
    { category: 'Pokemon', quantity: 2, dexIds: [6] },
  ];
  assert.equal(countCapturedSpecies(cards), 1);
});

test('capture — matches the live 4-card demo (base1 Alakazam/Venusaur/Blastoise/Charizard)', () => {
  const cards: OwnedCardForCapture[] = [
    { category: 'Pokemon', quantity: 2, dexIds: [65] }, // Alakazam
    { category: 'Pokemon', quantity: 1, dexIds: [3] }, // Venusaur
    { category: 'Pokemon', quantity: 1, dexIds: [9] }, // Blastoise
    { category: 'Pokemon', quantity: 1, dexIds: [6] }, // Charizard
  ];
  assert.equal(countCapturedSpecies(cards), 4);
});

// ── per-species level: set-LVL ladder over the species card pool ───────────────
test('speciesLevel — reuses the set-LVL bands over the species pool', () => {
  assert.equal(speciesLevel(0, 40), 0); // own none
  assert.equal(speciesLevel(1, 40), 1); // 2.5% → L1
  assert.equal(speciesLevel(5, 8), 3); // 62.5% → L3 (same shape as ME:Energy)
  assert.equal(speciesLevel(40, 40), 5); // fully owned → Max
  assert.equal(speciesLevel(3, 0), 0); // no pool → 0, no divide-by-zero
});

// ── shiny: DOCUMENTED breadth model (threshold unobserved — flagged) ───────────
test('shinyBreadth — distinct cards beyond the first', () => {
  assert.equal(shinyBreadth(0), 0);
  assert.equal(shinyBreadth(1), 0);
  assert.equal(shinyBreadth(2), 1);
  assert.equal(shinyBreadth(5), 4);
});

test('isShiny — own ≥2 distinct cards of the species (default threshold)', () => {
  assert.equal(isShiny(1), false);
  assert.equal(isShiny(2), true);
});

test('speciesSprite — pure function of dex id, pixel + art + shiny paths', () => {
  const s = speciesSprite(6);
  assert.equal(s.pixel, '/deckscout/images/sprites/pixel/6.png');
  assert.equal(s.pixelShiny, '/deckscout/images/sprites/pixel/shiny/6.png');
  assert.equal(s.art, '/deckscout/images/sprites/art/6.png');
  assert.equal(s.artShiny, '/deckscout/images/sprites/art/shiny/6.png');
});
