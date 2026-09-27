import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateOwnedPrints, basicEnergyType, loadOwnedCandidates, type OwnedCandidate, type OwnedSlot } from '../ownedPrints.js';
import type { Queryable } from '@deckpal/db';
import { cardLegality } from '../cardLegality.js';
import type { CardFacts } from '../types.js';

const slot = (over: Partial<OwnedSlot> = {}): OwnedSlot => ({
  cardId: 1, variantId: 11, variantKind: 'normal', quantity: 2, group: 'same-text',
  basicEnergyType: null, isPromo: false, isStamped: false, pinExact: false, ...over,
});
const owned = (over: Partial<OwnedCandidate> = {}): OwnedCandidate => ({
  card_id: '2', variant_id: '22', variant_kind_code: 'normal', quantity: '2',
  identical_print_group: 'same-text', is_promo: false, is_stamped: false,
  energy_type: null, set_id: 'sv10', local_id: '024', ...over,
});
const count = (slots: OwnedSlot[], copies: OwnedCandidate[], legal = new Set([2])) =>
  allocateOwnedPrints(slots, copies, legal);

test('a legal identical-text ordinary reprint satisfies a deck slot', () => {
  const result = count([slot()], [owned()]).get(11)!;
  assert.equal(result.owned, 2);
  assert.equal(result.ownedAs[0]?.quantity, 2);
});

test('a gameplay-identical print illegal in the selected format does not count', () => {
  // GLC rejects Classic Collection Blastoise even if an oracle finds a reprint.
  const classic: CardFacts = {
    id: 2, tcgdexId: 'cel25cc-2', setTcgdexId: 'cel25cc', localId: 'CC2', localIdNumeric: null,
    name: 'Blastoise', normalizedName: 'blastoise', category: 'Pokemon', stage: 'Stage2',
    suffix: null, trainerType: null, energyType: null, hp: 100, retreat: 3,
    regulationMark: null, evolveFrom: 'Wartortle', types: ['Water'],
  };
  const legal = cardLegality(classic, { isInFormatByReprint: () => true })
    .formats.find((f) => f.format === 'glc')!.legal;
  assert.equal(legal, false);
  assert.equal(count([slot()], [owned()], new Set(legal ? [2] : [])).get(11)!.owned, 0);
});

test('basic Energy uses its type across set and art, but never another type', () => {
  const energy = slot({ group: null, basicEnergyType: 'Grass', variantKind: 'reverse' });
  const result = count([energy], [owned({ identical_print_group: null, energy_type: 'Grass' }),
    owned({ variant_id: '33', card_id: '3', energy_type: 'Fire' })], new Set([2, 3])).get(11)!;
  assert.equal(result.owned, 2);
  assert.equal(result.ownedAs.length, 1);
});

test('Basic Energy names supply the type when card_type is absent', async () => {
  assert.equal(basicEnergyType('Basic Fire Energy', null), 'Fire');
  assert.equal(basicEnergyType('Fire Energy', null), 'Fire');
  assert.equal(basicEnergyType('Special Fire Energy', null), null);
  let query = '';
  let params: unknown[] | undefined;
  const db = { query: async (sql: string, values: unknown[]) => {
    query = sql;
    params = values;
    return { rows: [{ ...owned({ identical_print_group: null }), basic_energy_name: 'Basic Fire Energy' }] };
  } } as unknown as Queryable;
  const candidates = await loadOwnedCandidates(db, 'user', [slot({ group: null, basicEnergyType: 'Fire' })]);
  assert.equal(candidates[0]?.energy_type, 'Fire');
  assert.match(query, /c\.name = ANY\(\$5::text\[\]\)/, 'candidate lookup includes Basic Energy without card_type');
  assert.deepEqual(params?.[4], ['Fire Energy', 'Basic Fire Energy']);
  assert.equal(count([slot({ group: null, basicEnergyType: 'Fire' })], candidates).get(11)?.owned, 2);
});

test('pin exact requires the selected printing, including when an equivalent is owned', () => {
  const result = count([slot({ pinExact: true })], [owned(), owned({ card_id: '1', variant_id: '11', quantity: '1' })]).get(11)!;
  assert.equal(result.owned, 1);
  assert.deepEqual(result.ownedAs, []);
});

test('stamped, promo, different-finish and different-text versions stay distinct', () => {
  const copies = [
    owned({ variant_id: '21', is_stamped: true }),
    owned({ variant_id: '22', is_promo: true }),
    owned({ variant_id: '23', variant_kind_code: 'reverse' }),
    owned({ variant_id: '24', identical_print_group: 'different-text' }),
  ];
  assert.equal(count([slot()], copies).get(11)!.owned, 0);
  assert.equal(count([slot({ group: null, basicEnergyType: 'Grass', isStamped: true })],
    [owned({ identical_print_group: null, energy_type: 'Grass' })]).get(11)!.owned, 0);
});

test('one owned copy is allocated once even when two deck rows accept it', () => {
  const first = slot({ quantity: 1 });
  const second = slot({ cardId: 3, variantId: 33, quantity: 1 });
  const result = count([first, second], [owned({ quantity: '1' })]);
  assert.equal(result.get(11)!.owned + result.get(33)!.owned, 1);
});
