import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProduct, planPrizePack, type PpCard, type PpSet, type PpVariant } from '../prizePack.js';
import type { TcgcsvPriceRow, TcgcsvProductRow } from '../types.js';
import { stampLabel } from '../../catalog/transform.js';

/**
 * Which card a TCGplayer Prize Pack product is, and which printing of it, without a database.
 * The fixtures are real products from group 22880 (2026-11-26) on the cards they reprint.
 */

const SETS: PpSet[] = [
  { setId: 1, tcgdexId: 'sv01', official: 198 },
  { setId: 2, tcgdexId: 'mee', official: 8 },
  { setId: 3, tcgdexId: 'sve', official: 16 },
  { setId: 4, tcgdexId: 'svp', official: null },
  { setId: 5, tcgdexId: 'swshp', official: null },
  { setId: 6, tcgdexId: 'sv06', official: 167 },
  { setId: 7, tcgdexId: 'swsh5', official: 163 },
  { setId: 8, tcgdexId: 'sv05', official: 162 },
  { setId: 9, tcgdexId: 'sv02', official: 193 },
];

let vid = 1;
const v = (kind: string, finish: string, over: Partial<PpVariant> = {}): PpVariant => ({
  id: vid++, kind, finish, foil: null, stamps: [], isPrimary: false, productId: null, printing: null, sortOrder: 0, ...over,
});
const card = (cardId: number, setId: number, localId: string, name: string, variants: PpVariant[]): PpCard => ({
  cardId, setId, localId, name,
  variants: variants.map((x, i) => ({ ...x, sortOrder: i, isPrimary: x.isPrimary || i === 0 })),
});
const plain = (cardId: number, setId: number, localId: string, name: string, primary = 'normal') =>
  card(cardId, setId, localId, name, [v(primary, primary), v('reverse', 'reverse')]);

const product = (productId: number, name: string, number?: string): TcgcsvProductRow => ({
  productId, name, url: `https://www.tcgplayer.com/product/${productId}`,
  extendedData: number == null ? [] : [{ name: 'Number', value: number }],
});
const price = (productId: number, subTypeName: string): TcgcsvPriceRow => ({
  productId, subTypeName, lowPrice: 0.1, midPrice: 0.2, highPrice: 1, marketPrice: 0.15, directLowPrice: null,
});

const codesOn = (plan: ReturnType<typeof planPrizePack>, cardId: number) =>
  plan.adds.filter((a) => a.cardId === cardId).map((a) => a.code).sort();

test('a sized number, its set size and the name pick exactly one card; each priced printing is a row', () => {
  const cards = [plain(10, 1, '181', 'Nest Ball')];
  const plan = planPrizePack(
    [product(515500, 'Nest Ball - 181/198', '181/198'), product(703878, 'Nest Ball - 181/198 (Cosmos Holo)', '181/198')],
    [price(515500, 'Normal'), price(703878, 'Holofoil')],
    SETS, cards,
  );
  assert.deepEqual(codesOn(plan, 10), ['holo-foil-cosmos-stamp-player-rewards-program', 'normal-stamp-player-rewards-program']);
  const normal = plan.adds.find((a) => a.code === 'normal-stamp-player-rewards-program')!;
  assert.equal(normal.productId, 515500);
  assert.equal(normal.printing, 'Normal');
  assert.equal(normal.displayName, 'Normal Play! Pokémon Stamp');
  assert.equal(normal.sortOrder, 2, 'after the printings the card already has');
  assert.equal(plan.adds.find((a) => a.productId === 703878)!.displayName, 'Cosmos Holofoil Play! Pokémon Stamp');
});

test('the owner\'s stamped Basic Water Energy: "MEE 003" names the set, "Basic" is not part of the name', () => {
  const cards = [plain(20, 2, '003', 'Water Energy'), plain(21, 3, '003', 'Basic Water Energy')];
  const plan = planPrizePack(
    [product(677424, 'Basic Water Energy - MEE 003', '003'), product(515644, 'Basic Water Energy - 003', '003')],
    [price(677424, 'Normal'), price(515644, 'Normal')],
    SETS, cards,
  );
  assert.deepEqual(plan.adds.map((a) => [a.cardId, a.productId]), [[21, 515644], [20, 677424]]);
});

test('an unsized promo number is looked up in the promo and energy sets only', () => {
  const cards = [card(30, 4, '016', 'Ampharos ex', [v('holo', 'holo')]), card(31, 6, '016', 'Ampharos ex', [v('holo', 'holo')])];
  const plan = planPrizePack([product(1, 'Ampharos ex - 016', '016')], [price(1, 'Holofoil')], SETS, cards);
  assert.deepEqual(plan.adds.map((a) => [a.cardId, a.code]), [[30, 'holo-stamp-player-rewards-program']]);
});

test('"SWSH149" is a Sword & Shield promo', () => {
  const cards = [card(40, 5, 'SWSH149', 'Flareon V', [v('holo', 'holo')])];
  const plan = planPrizePack([product(475984, 'Flareon V - SWSH149', 'SWSH149')], [price(475984, 'Holofoil')], SETS, cards);
  assert.equal(plan.adds[0]?.cardId, 40);
});

test('a printing the card already has is kept, and gains only a missing product id', () => {
  const stamped = (pid: number | null) =>
    v('normal-stamp-player-rewards-program', 'normal', { stamps: ['player-rewards-program'], productId: pid, printing: pid ? 'Normal' : null });
  const cards = [
    card(50, 1, '196', 'Ultra Ball', [v('normal', 'normal'), stamped(null)]),
    card(51, 1, '197', 'Super Rod', [v('normal', 'normal'), stamped(9999)]),
  ];
  const plan = planPrizePack(
    [product(515513, 'Ultra Ball - 196/198', '196/198'), product(515514, 'Super Rod - 197/198', '197/198')],
    [price(515513, 'Normal'), price(515514, 'Normal')],
    SETS, cards,
  );
  assert.equal(plan.adds.length, 0);
  assert.equal(plan.covered, 2);
  assert.deepEqual(plan.links.map((l) => [l.cardId, l.productId, l.printing]), [[50, 515513, 'Normal']]);
});

test('a cosmos stamp TCGdex filed as reverse still covers TCGplayer\'s cosmos holo', () => {
  const cards = [card(60, 9, '190', 'Jet Energy', [
    v('normal', 'normal'),
    v('reverse-foil-cosmos-stamp-player-rewards-program', 'reverse', { foil: 'cosmos', stamps: ['player-rewards-program'] }),
  ])];
  const plan = planPrizePack([product(703814, 'Jet Energy - 190/193 (Cosmos Holo)', '190/193')], [price(703814, 'Holofoil')], SETS, cards);
  assert.equal(plan.adds.length, 0);
  assert.equal(plan.links.length, 1);
});

test('the same printing sold as two products (Series 6 and 7) is one row, from the lower product id', () => {
  const cards = [card(70, 6, '025', 'Teal Mask Ogerpon ex', [v('holo', 'holo')])];
  const plan = planPrizePack(
    [
      product(684109, 'Teal Mask Ogerpon ex - 025/167 (Prize Pack Series 7)', '025/167'),
      product(619166, 'Teal Mask Ogerpon ex - 025/167 (Prize Pack Series 6)', '025/167'),
    ],
    [price(684109, 'Holofoil'), price(619166, 'Holofoil')],
    SETS, cards,
  );
  assert.deepEqual(plan.adds.map((a) => a.productId), [619166]);
  assert.equal(plan.collapsed, 1);
});

test('a product priced in both Normal and Holofoil is two printings', () => {
  const cards = [plain(80, 7, '037', 'Octillery')];
  const plan = planPrizePack(
    [product(475994, 'Octillery - 037/163', '037/163')], [price(475994, 'Holofoil'), price(475994, 'Normal')], SETS, cards,
  );
  assert.deepEqual(codesOn(plan, 80), ['holo-stamp-player-rewards-program', 'normal-stamp-player-rewards-program']);
});

test('an unpriced product takes the card\'s own finish, at a lower confidence', () => {
  const cards = [card(90, 5, 'SWSH197', 'Glaceon VSTAR', [v('holo', 'holo')])];
  const plan = planPrizePack([product(489300, 'Glaceon VSTAR - SWSH197', 'SWSH197')], [], SETS, cards);
  assert.deepEqual(plan.adds.map((a) => [a.code, a.printing, a.confidence]), [['holo-stamp-player-rewards-program', 'Holofoil', 80]]);
});

test('what it cannot place it refuses, and says why', () => {
  const cards = [
    plain(100, 8, '161', 'Mist Energy'),
    plain(101, 1, '010', 'Pikachu'), card(102, 1, '010', 'Pikachu', [v('holo', 'holo')]),
  ];
  const plan = planPrizePack(
    [
      product(1, 'Water Energy (Prize Pack Series 1)'),                 // unnumbered series energy
      product(2, 'Rillaboom - 014/072', '014/072'),                    // no such card here
      product(3, 'Pikachu - 010/198', '010/198'),                      // two cards answer
      product(4, 'Mist Energy - 161/162 (Staff)', '161/162'),          // a qualifier we do not know
    ],
    [price(1, 'Normal'), price(2, 'Normal'), price(3, 'Normal'), price(4, 'Normal')],
    SETS, cards,
  );
  assert.equal(plan.adds.length, 0);
  assert.deepEqual(plan.skipped.map((s) => [s.productId, s.reason]), [
    [1, 'no-number'], [2, 'no-card'], [3, 'ambiguous'], [4, 'unknown-qualifier'],
  ]);
});

test('a trainer-art bracket does not stop the name matching', () => {
  const cards = [plain(110, 9, '172', "Boss's Orders")];
  const plan = planPrizePack([product(538754, "Boss's Orders [Ghetsis] - 172/193", '172/193')], [price(538754, 'Normal')], SETS, cards);
  assert.equal(plan.adds[0]?.cardId, 110);
});

test('parseProduct reads number, set size, set code and cosmos', () => {
  assert.deepEqual(parseProduct(product(1, 'Basic Water Energy - MEE 003 (Cosmos Holo)', '003')), {
    key: 'water energy', cosmos: true, number: '3', setSize: null, prefix: 'mee', unknownQualifier: null,
  });
  assert.deepEqual(parseProduct(product(2, 'Zekrom ex - 034/086 (Left Stamp)', '034/086')), {
    key: 'zekrom ex', cosmos: false, number: '34', setSize: 86, prefix: null, unknownQualifier: null,
  });
});

test('the stamp reads as it is printed', () => {
  assert.equal(stampLabel('player-rewards-program'), 'Play! Pokémon Stamp');
  assert.equal(stampLabel('gamestop'), 'Gamestop Stamp');
});
