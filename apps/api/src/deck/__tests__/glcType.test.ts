import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferGlcType } from '../glcType.js';
import { validateDeck } from '../formats.js';
import type { DeckEntry, PokemonType } from '../types.js';
import { mkCard } from './fixtures.js';

function pokemon(name: string, types: PokemonType[]): DeckEntry {
  return {
    card: mkCard({ name, category: 'Pokemon', stage: 'Basic', types, setTcgdexId: 'sv06' }),
    quantity: 1,
    section: 'pokemon',
  };
}

test('GLC import infers Water from its own Pokémon and validates without a Grass mismatch', () => {
  const entries = [pokemon('Wailmer', ['Water'])];
  const glcType = inferGlcType(entries);
  assert.equal(glcType, 'Water');
  const result = validateDeck({ formatCode: 'glc', glcType, entries });
  assert.equal(result.violations.some(({ code }) => code === 'TYPE_MISMATCH'), false);
});

test('GLC import infers Grass from its own Pokémon', () => {
  const entries = [pokemon('Sprigatito', ['Grass'])];
  const glcType = inferGlcType(entries);
  assert.equal(glcType, 'Grass');
  const result = validateDeck({ formatCode: 'glc', glcType, entries });
  assert.equal(result.violations.some(({ code }) => code === 'TYPE_MISMATCH'), false);
});

test('ambiguous or missing Pokémon types remain unknown while definitive rules still run', () => {
  const entries = [pokemon('Wailmer', ['Water']), pokemon('Sprigatito V', ['Grass'])];
  const glcType = inferGlcType(entries);
  assert.equal(glcType, null);
  const result = validateDeck({ formatCode: 'glc', glcType, entries });
  assert.equal(result.violations.some(({ code }) => code === 'TYPE_MISMATCH'), false);
  assert.equal(result.violations.some(({ code }) => code === 'RULE_BOX_FORBIDDEN'), true);
  assert.equal(inferGlcType([pokemon('Unknown', [])]), null);
  assert.equal(inferGlcType([]), null);
});

test('two-type Pokémon resolves only when the deck has one shared type; explicit type still validates', () => {
  const entries = [pokemon('Dual', ['Water', 'Grass']), pokemon('Wailmer', ['Water'])];
  assert.equal(inferGlcType(entries), 'Water');
  assert.equal(inferGlcType([entries[0]!]), null);
  const explicitGrass = validateDeck({ formatCode: 'glc', glcType: 'Grass', entries });
  assert.equal(explicitGrass.violations.some(({ code, subject }) => code === 'TYPE_MISMATCH' && subject === 'Wailmer'), true);
});
