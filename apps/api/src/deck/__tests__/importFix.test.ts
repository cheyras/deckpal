import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Queryable } from '@deckpal/db';
import { choosePrint, finishImportFix, importFixPrompt, prepareImportFix, selectedOptions, verifiedImportFix, type ImportFixOption } from '../importFix.js';

const option = (lineIndex: number, key: string): ImportFixOption => ({
  key, lineIndex, replacement: '4 Boss\'s Orders PAL 172',
  card: { id: 'sv02-172', name: "Boss's Orders", set: 'PAL', number: '172', image: '/image' },
  reason: 'Boss is short for Boss\'s Orders.',
});

test('model can select catalogue keys only, once per physical line', () => {
  const options = [option(0, 'l0c0'), option(0, 'l0c1'), option(2, 'l2c0')];
  assert.deepEqual(selectedOptions('{"choices":[{"key":"fake"},{"key":"l0c1"},{"key":"l0c0"},{"key":"l2c0"}]}', options),
    [options[1], options[2]]);
  assert.deepEqual(selectedOptions('{"choices":[{"cardId":"sv02-172"}]}', options), []);
  assert.deepEqual(selectedOptions('not JSON', options), []);
});

test('duplicate raw lines retain distinct positions and only a chosen position is fixed', () => {
  const text = '4 Boss\n1 Iono PAL 185\n4 Boss';
  const prepared = { options: [option(0, 'l0c0'), option(2, 'l2c0')], unfixed: ['4 Boss', '4 Boss'] };
  const result = finishImportFix(text, prepared, '{"choices":[{"key":"l2c0"}]}');
  assert.deepEqual(result.fixes.map(f => f.lineIndex), [2]);
  assert.deepEqual(result.unfixed, ['4 Boss']);
  assert.match(importFixPrompt(text, prepared.options), /l2c0/);
});

test('printing order prefers owned, then legal regular, then newest', () => {
  const row = (id: string, owned: string, mark: string | null, rarity: string, released: string) => ({
    id, tcgdex_id: id, name: 'Iono', name_normalized: 'iono', category: 'Trainer' as const, local_id: '185',
    set_tcgdex_id: 'sv02', serie_tcgdex_id: 'sv', regulation_mark: mark,
    released_on: released, rarity, playable_fingerprint: 'abc', owned,
  });
  const owned = row('owned', '1', 'G', 'Ultra Rare', '2024-01-01');
  const legalRegular = row('legal', '0', 'J', 'Uncommon', '2025-01-01');
  const legalRare = row('rare', '0', 'J', 'Special illustration rare', '2026-01-01');
  assert.equal(choosePrint([legalRare, owned, legalRegular], 'standard')?.tcgdex_id, 'owned');
  assert.equal(choosePrint([{ ...legalRegular, local_id: '184' }, { ...legalRare, local_id: '186' }], 'standard',
    { number: '186' } as never)?.tcgdex_id, 'rare');
  assert.equal(choosePrint([legalRare, legalRegular], 'standard')?.tcgdex_id, 'legal');
  const older = row('older', '0', 'J', 'Uncommon', '2023-06-09');
  const newer = row('newer', '0', 'J', 'Uncommon', '2024-01-26');
  assert.equal(choosePrint([{ ...older, released_on: new Date('2023-06-09') },
    { ...newer, released_on: new Date('2024-01-26') }], 'standard')?.tcgdex_id, 'newer');
});

test('a suggested fix is admitted only if the ordinary resolver lands on that catalogue card', async () => {
  const card = {
    id: '172', tcgdex_id: 'sv02-172', set_tcgdex_id: 'sv02', serie_tcgdex_id: 'sv',
    local_id: '172', local_id_numeric: 172, name: "Boss's Orders (Ghetsis)",
    name_normalized: "boss's orders (ghetsis)", category: 'Trainer',
    stage: null, suffix: null, trainer_type: 'Supporter', energy_type: null,
    hp: null, retreat: null, regulation_mark: 'G', evolve_from: null,
    released_on: '2023-06-09', rarity: 'Rare', playable_fingerprint: 'same', owned: '0',
  };
  let exactId = card.tcgdex_id;
  const db = { query: async (sql: string) => {
    if (sql.includes('SELECT c.name_normalized, max(')) return { rows: [{ name_normalized: "boss's orders (ghetsis)" }] };
    if (sql.includes('coalesce((SELECT sum(ci.quantity)')) return { rows: [card] };
    if (sql.includes('c.local_id_numeric =')) return { rows: [{ ...card, tcgdex_id: exactId }] };
    if (sql.includes('FROM card_type')) return { rows: [] };
    return { rows: [] };
  } } as unknown as Queryable;
  const good = await prepareImportFix(db, '4 Boss', 'standard', 'user');
  assert.equal(good.options.length, 1);
  assert.equal(good.options[0]!.replacement, "4 Boss's Orders PAL 172");
  const chosen = '{"choices":[{"key":"l0c0"}]}';
  assert.deepEqual((await verifiedImportFix(db, 'standard', '4 Boss', good, chosen)).unfixed, []);
  exactId = 'sv02-999';
  const bad = await prepareImportFix(db, '4 Boss', 'standard', 'user');
  assert.equal(bad.options.length, 1, 'the candidate remains available for model selection');
  const refused = await verifiedImportFix(db, 'standard', '4 Boss', bad, chosen);
  assert.deepEqual(refused.fixes, [], 'the selected option is discarded after re-resolution');
  assert.deepEqual(refused.unfixed, ['4 Boss']);
});

test('a stated set establishes gameplay identity before owned-print preference', async () => {
  const row = (id: string, set: string, fingerprint: string, owned: string) => ({
    id, tcgdex_id: id, name: 'Charizard ex', name_normalized: 'charizard ex',
    category: 'Pokemon', local_id: id.split('-').at(-1), set_tcgdex_id: set,
    serie_tcgdex_id: 'sv', regulation_mark: 'G', released_on: '2023-01-01',
    rarity: 'Rare', playable_fingerprint: fingerprint, owned,
  });
  const obf = row('sv03-125', 'sv03', 'obf-gameplay', '0');
  const mew = row('sv03.5-006', 'sv03.5', 'mew-gameplay', '3');
  const db = { query: async (sql: string) => {
    if (sql.includes('SELECT c.name_normalized, max(')) return { rows: [{ name_normalized: 'charizard ex' }] };
    if (sql.includes('coalesce((SELECT sum(ci.quantity)')) return { rows: [obf, mew] };
    return { rows: [] };
  } } as unknown as Queryable;
  const hinted = await prepareImportFix(db, '1 Charizrd ex OBF 999', 'standard', 'user');
  assert.deepEqual(hinted.options.map(option => option.card.id), ['sv03-125']);
  const ambiguous = await prepareImportFix(db, '1 Charizrd ex', 'standard', 'user');
  assert.deepEqual(ambiguous.options, [], 'without a set, different game texts are left for manual review');
});
