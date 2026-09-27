import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Queryable } from '@deckpal/db';
import { loadByName } from '../db.js';

const card = (id: number, name: string) => ({
  id: String(id), tcgdex_id: `test-${id}`, set_tcgdex_id: 'test',
  local_id: String(id), local_id_numeric: id, name, category: 'Pokemon',
  stage: 'Basic', suffix: null, trainer_type: null, energy_type: null,
  hp: 40, retreat: 1, regulation_mark: 'H', evolve_from: null,
  released_on: '2024-01-01',
});

function looseLookup(rows: ReturnType<typeof card>[]): Queryable {
  return { query: async (sql: string) => {
    if (sql.includes('name_normalized LIKE')) return { rows: [] };
    if (sql.includes('name_normalized %')) return { rows };
    if (sql.includes('FROM card_type')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as Queryable;
}

test('loose name lookup preserves gender and other identity marks', async () => {
  const db = looseLookup([card(1, 'Nidoran♀'), card(2, 'Nidoran♂')]);
  assert.deepEqual((await loadByName(db, 'Nidoran ♀')).map(c => c.tcgdexId), ['test-1']);
  assert.deepEqual((await loadByName(db, 'Nidoran')).map(c => c.tcgdexId), []);
});

test('loose lookup folds accents but declines ambiguous printed names', async () => {
  assert.deepEqual((await loadByName(looseLookup([card(3, 'PokéStop')]), 'PokeStop'))
    .map(c => c.tcgdexId), ['test-3']);
  assert.deepEqual((await loadByName(looseLookup([card(4, 'Mr. Mime'), card(5, 'Mr Mime')]), 'Mr Mime'))
    .map(c => c.tcgdexId), []);
});
