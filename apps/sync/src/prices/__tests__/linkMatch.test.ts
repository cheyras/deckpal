import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptGroup, candidateGroups, foldName, linkablePrintings, numberKey, planSetLinks,
  productCardName, type GroupScore, type LinkCard, type PlanResult,
} from '../linkMatch.js';
import type { TcgcsvPriceRow, TcgcsvProductRow } from '../types.js';

/**
 * The link pass decides which TCGplayer product a catalog card IS. A wrong answer is worse than no
 * answer — it quotes a stranger's price with full confidence — so most of what is pinned here is
 * REFUSAL: the cases where the matcher must leave a card unpriced.
 */

const product = (productId: number, name: string, number: string | null): TcgcsvProductRow => ({
  productId, name, url: `https://tcgplayer.test/${productId}`,
  extendedData: number == null ? [] : [{ name: 'Number', value: number }],
});
const price = (productId: number, subTypeName: string): TcgcsvPriceRow => ({
  productId, subTypeName, marketPrice: 1, lowPrice: null, midPrice: null, highPrice: null, directLowPrice: null,
});
const card = (cardId: number, localId: string, name: string, ...kinds: string[]): LinkCard => ({
  cardId, localId, name,
  variants: kinds.map((kind, i) => ({ id: cardId * 10 + i, kind, productId: null, printing: null })),
});

// ── name and number folding ──────────────────────────────────────────────────

test('foldName ignores case, accents, quote style, gender signs and spacing', () => {
  assert.equal(foldName('Poké Pad'), 'poke pad');
  assert.equal(foldName("Farfetch’d"), "farfetch'd");
  assert.equal(foldName('Nidoran♀'), 'nidoran f');
  assert.equal(foldName('Nidoran F'), 'nidoran f');
  assert.equal(foldName('Terapagos & Friends'), 'terapagos and friends');
  assert.equal(foldName('  Mr.   Mime '), 'mr mime');
});

test('numberKey drops leading zeros and the "/total", and keeps alpha prefixes', () => {
  assert.equal(numberKey('085'), '85');
  assert.equal(numberKey('085/198'), '85');
  assert.equal(numberKey('TG03/TG30'), 'TG3');
  assert.equal(numberKey('swsh133'), 'SWSH133');
  assert.equal(numberKey('50a'), '50A');
  assert.equal(numberKey(''), null);
  assert.equal(numberKey(undefined), null);
});

test('productCardName strips the number and qualifiers, in TCGplayer\'s real order', () => {
  assert.deepEqual(productCardName(product(1, 'Charizard ex - 125/197', '125')), { key: 'charizard ex', qualifiers: [] });
  assert.deepEqual(productCardName(product(2, 'Pikachu with Grey Felt Hat', '085')), { key: 'pikachu with grey felt hat', qualifiers: [] });
  // The number comes BEFORE the qualifiers: a regex that only stripped a trailing number saw
  // "pawmot 006" here and refused 62 SVP cards as "name mismatch".
  assert.deepEqual(
    productCardName(product(3, 'Pawmot - 006 (Prerelease) [Staff]', '006')),
    { key: 'pawmot', qualifiers: ['prerelease', 'staff'] },
  );
});

// ── planning links ───────────────────────────────────────────────────────────

test('links on number AND name, picking the printing the variant kind means', () => {
  const plan = planSetLinks(
    [card(1, '002', 'Bar', 'normal', 'reverse')],
    [product(6000, 'Bar - 002/100', '002/100')],
    [price(6000, 'Normal'), price(6000, 'Reverse Holofoil')],
  );
  assert.deepEqual(plan.links.map((l) => [l.productId, l.printing, l.source, l.confidence]), [
    [6000, 'Normal', 'number_match', 100],
    [6000, 'Reverse Holofoil', 'number_match', 100],
  ]);
});

test('a card with the right number but a different name is NOT linked', () => {
  const plan = planSetLinks([card(1, '005', 'Quaquaval', 'normal')], [product(1, 'Some Other Mon - 005', '005')], [price(1, 'Normal')]);
  assert.equal(plan.links.length, 0);
  assert.equal(plan.skipped[0]!.reason, 'name-mismatch');
});

test('sealed product (no Number) can never match a card', () => {
  const plan = planSetLinks([card(1, '001', 'Booster Box', 'normal')], [product(1, 'Booster Box', null)], [price(1, 'Normal')]);
  assert.equal(plan.links.length, 0);
  assert.equal(plan.numberedProducts, 0);
});

test('a product TCGplayer does not price is not a candidate', () => {
  const plan = planSetLinks([card(1, '001', 'Foo', 'normal')], [product(1, 'Foo - 001', '001')], []);
  assert.equal(plan.links.length, 0);
});

test('a stamped-only product is refused (Prerelease / Staff are different cards)', () => {
  const plan = planSetLinks(
    [card(1, '006', 'Pawmot', 'normal')],
    [product(1, 'Pawmot - 006 (Prerelease)', '006'), product(2, 'Pawmot - 006 (Prerelease) [Staff]', '006')],
    [price(1, 'Normal'), price(2, 'Normal')],
  );
  assert.equal(plan.links.length, 0);
  assert.equal(plan.skipped[0]!.reason, 'ambiguous-product');
  assert.equal(plan.cardsAgreeing, 1, 'it still AGREES on identity — that is evidence for the group');
});

test('a single stamp-qualified product is refused even when it is the only one', () => {
  const plan = planSetLinks([card(1, '006', 'Pawmot', 'normal')], [product(1, 'Pawmot - 006 (Prerelease)', '006')], [price(1, 'Normal')]);
  assert.equal(plan.links.length, 0);
});

test('a lone finish-descriptor product ("Cosmos Holo") is accepted at 80, with its own printing name', () => {
  const plan = planSetLinks([card(1, '025', 'Tinkatink', 'normal')], [product(1, 'Tinkatink - 025 (Cosmos Holo)', '025')], [price(1, 'Holofoil')]);
  assert.deepEqual(plan.links.map((l) => [l.printing, l.confidence]), [['Holofoil', 80]]);
});

test('when an unqualified product exists it beats the qualified ones', () => {
  const plan = planSetLinks(
    [card(1, '027', 'Pikachu', 'normal')],
    [product(1, 'Pikachu - 027 (Prerelease)', '027'), product(2, 'Pikachu - 027', '027')],
    [price(1, 'Normal'), price(2, 'Normal')],
  );
  assert.equal(plan.links[0]!.productId, 2);
});

test('two unqualified products at one number and name are ambiguous, not a coin toss', () => {
  const plan = planSetLinks(
    [card(1, '027', 'Pikachu', 'normal')],
    [product(1, 'Pikachu - 027', '027'), product(2, 'Pikachu - 027', '027')],
    [price(1, 'Normal'), price(2, 'Normal')],
  );
  assert.equal(plan.links.length, 0);
  assert.equal(plan.skipped[0]!.reason, 'ambiguous-product');
});

test('name-only fallback needs a name unique on BOTH sides, and carries confidence 70', () => {
  const unique = planSetLinks([card(1, 'CC9', 'Rare Thing', 'normal')], [product(1, 'Rare Thing - 012', '012')], [price(1, 'Normal')]);
  assert.deepEqual(unique.links.map((l) => [l.source, l.confidence]), [['name_match', 70]]);
  const dupCards = planSetLinks(
    [card(1, 'CC8', 'Pikachu', 'normal'), card(2, 'CC9', 'Pikachu', 'normal')],
    [product(1, 'Pikachu - 012', '012')], [price(1, 'Normal')],
  );
  assert.equal(dupCards.links.length, 0, 'two cards share the name, so the name proves nothing');
  const dupProducts = planSetLinks(
    [card(1, 'CC9', 'Pikachu', 'normal')],
    [product(1, 'Pikachu - 012', '012'), product(2, 'Pikachu - 013', '013')], [price(1, 'Normal'), price(2, 'Normal')],
  );
  assert.equal(dupProducts.links.length, 0);
});

test('special kinds are never linked: a stamp, a jumbo and a cosmos foil are not number+name identifiable', () => {
  const plan = planSetLinks(
    [card(1, '003', 'Baz', 'normal', 'holo-stamp-prerelease', 'holo-foil-cosmos', 'normal-jumbo')],
    [product(7000, 'Baz - 003/100', '003/100')], [price(7000, 'Normal'), price(7000, 'Holofoil')],
  );
  assert.deepEqual(plan.links.map((l) => l.variantId), [10]);
  assert.equal(plan.skipped.filter((s) => s.reason === 'special-variant').length, 3);
});

test('WotC-era printing names: Unlimited and 1st Edition map by kind', () => {
  assert.deepEqual(linkablePrintings('holo'), ['Holofoil', 'Unlimited Holofoil']);
  const plan = planSetLinks(
    [card(1, '3', 'Flareon', 'holo', 'holo-stamp-1st-edition')],
    [product(9, 'Flareon - 3/64', '3/64')],
    [price(9, 'Unlimited Holofoil'), price(9, '1st Edition Holofoil')],
  );
  assert.deepEqual(plan.links.map((l) => l.printing), ['Unlimited Holofoil', '1st Edition Holofoil']);
});

test('a variant whose printing the product lacks is skipped — unless it is the card\'s only variant', () => {
  const multi = planSetLinks(
    [card(1, '001', 'Foo', 'normal', 'reverse')], [product(1, 'Foo - 001', '001')], [price(1, 'Holofoil')],
  );
  assert.equal(multi.links.length, 0, 'two variants and one foil name: which is which is a guess');
  assert.ok(multi.skipped.every((s) => s.reason === 'no-printing'));
  const sole = planSetLinks([card(1, '001', 'Foo', 'normal')], [product(1, 'Foo - 001', '001')], [price(1, 'Holofoil')]);
  assert.deepEqual(sole.links.map((l) => [l.printing, l.confidence]), [['Holofoil', 85]]);
});

test('an existing id is authoritative: never planned over, and its (product, printing) is reserved', () => {
  const owned: LinkCard = {
    cardId: 1, localId: '001', name: 'Foo',
    variants: [
      { id: 10, kind: 'normal', productId: 5000, printing: 'Normal' },
      { id: 11, kind: 'reverse', productId: null, printing: null },
    ],
  };
  const other = card(2, '002', 'Foo', 'normal'); // same name, would otherwise want product 5000 Normal
  const plan = planSetLinks(
    [owned, other],
    [product(5000, 'Foo - 001', '001'), product(5001, 'Foo - 002', '002')],
    [price(5000, 'Normal'), price(5000, 'Reverse Holofoil'), price(5001, 'Normal')],
  );
  assert.deepEqual(plan.links.map((l) => [l.variantId, l.productId, l.printing]), [
    [11, 5000, 'Reverse Holofoil'], // found the normal way, and the plain sibling agrees
    [20, 5001, 'Normal'],
  ]);
});

test('the id of a SPECIAL sibling is not identity evidence (the Umbreon shape: Poké Ball pattern $3.69, base $0.47)', () => {
  const umbreon: LinkCard = {
    cardId: 1, localId: '059', name: 'Umbreon',
    variants: [
      { id: 10, kind: 'reverse', productId: null, printing: null },
      { id: 11, kind: 'holo', productId: null, printing: null },
      { id: 12, kind: 'reverse-foil-pokeball', productId: 610578, printing: 'Reverse Holofoil' },
    ],
  };
  const plan = planSetLinks(
    [umbreon],
    [product(610414, 'Umbreon - 059/131', '059/131'), product(610578, 'Umbreon (Poke Ball Pattern) - 059/131', '059/131')],
    [price(610414, 'Holofoil'), price(610414, 'Reverse Holofoil'), price(610578, 'Holofoil')],
  );
  // Both plain variants resolve to the plain product — never to the pattern's 610578.
  assert.deepEqual(plan.links.map((l) => [l.variantId, l.productId, l.printing]), [
    [10, 610414, 'Reverse Holofoil'],
    [11, 610414, 'Holofoil'],
  ]);
});

test('a PLAIN sibling that already holds a different product than the one we found blocks the link', () => {
  const c: LinkCard = {
    cardId: 1, localId: '044', name: 'Charmander',
    variants: [
      { id: 10, kind: 'holo', productId: 477182, printing: 'Holofoil' }, // upstream says another card entirely
      { id: 11, kind: 'normal', productId: null, printing: null },
    ],
  };
  const plan = planSetLinks([c], [product(500, 'Charmander - 044', '044')], [price(500, 'Normal')]);
  assert.equal(plan.links.length, 0, 'upstream and we disagree about which card this is');
});

test('name-only fallback: refuses qualified products, same-scheme numbers and numbers owned by another card', () => {
  // (Prerelease) is a different printing than the plain card.
  assert.equal(
    planSetLinks([card(1, '023', 'Metang', 'normal')], [product(1, 'Metang (Delta Species) - 49/113 (Prerelease)', '49/113')], [price(1, 'Normal')]).links.length,
    0,
  );
  // "Pikachu #027" is not "Pikachu - 088": two plain-digit numbers that differ are contrary evidence.
  const sameScheme = planSetLinks(
    [card(1, '027', 'Pikachu', 'normal'), card(2, '088', 'Pikachu ex', 'normal')],
    [product(9, 'Pikachu - 088', '088')], [price(9, 'Normal')],
  );
  assert.equal(sameScheme.links.length, 0);
  // A product numbered like ANOTHER of our cards is that card.
  const owned = planSetLinks(
    [card(1, 'CC020', 'Rare Thing', 'normal'), card(2, '12', 'Other', 'normal')],
    [product(9, 'Rare Thing - 12', '12'), product(10, 'Other - 12', '12')], [price(9, 'Normal'), price(10, 'Normal')],
  );
  assert.equal(owned.links.find((l) => l.cardId === 1), undefined);
  // The legitimate use: a different numbering SCHEME (CC-prefixed vs the original set's digits).
  const cc = planSetLinks([card(1, 'CC020', 'Rare Thing', 'normal')], [product(9, 'Rare Thing - 020/102', '020/102')], [price(9, 'Normal')]);
  assert.deepEqual(cc.links.map((l) => [l.productId, l.source]), [[9, 'name_match']]);
});

test('the lone-variant relabel never crosses an edition or a foil family', () => {
  const edition = planSetLinks([card(1, '8', 'Machamp', 'holo')], [product(1, 'Machamp - 8/102', '8/102')], [price(1, '1st Edition Holofoil')]);
  assert.equal(edition.links.length, 0, 'an Unlimited holo must not take a 1st Edition price');
  const reverse = planSetLinks([card(1, '8', 'Machamp', 'reverse')], [product(1, 'Machamp - 8/102', '8/102')], [price(1, 'Holofoil')]);
  assert.equal(reverse.links.length, 0, 'a reverse is not relabelled to a holo');
});

test('two variants can never be planned onto one (product, printing)', () => {
  const plan = planSetLinks(
    [card(1, '001', 'Foo', 'normal', 'normal-jumbo'), card(2, '001', 'Foo', 'normal')],
    [product(1, 'Foo - 001', '001')], [price(1, 'Normal')],
  );
  assert.equal(plan.links.length, 1);
  assert.ok(plan.skipped.some((s) => s.reason === 'duplicate-target'));
});

// ── choosing a group ─────────────────────────────────────────────────────────

const GROUPS = [
  { groupId: 22872, name: 'SV: Scarlet & Violet Promo Cards', abbreviation: 'SVP' },
  { groupId: 23286, name: 'SV04: Paradox Rift', abbreviation: 'PAR' },
  { groupId: 635, name: 'Jungle', abbreviation: 'JU' },
  { groupId: 1, name: 'Unrelated', abbreviation: null },
];

test('candidateGroups matches on the printed set code or the group name minus its era prefix', () => {
  const svp = candidateGroups({ tcgdexId: 'svp', name: 'SVP Black Star Promos', abbreviation: 'SVP', ptcglCode: null }, GROUPS);
  assert.deepEqual(svp.map((g) => g.groupId), [22872]);
  const par = candidateGroups({ tcgdexId: 'sv04', name: 'Paradox Rift', abbreviation: 'PAR', ptcglCode: 'PAR' }, GROUPS);
  assert.deepEqual(par.map((g) => g.groupId), [23286]);
  const jungle = candidateGroups({ tcgdexId: 'base2', name: 'Jungle', abbreviation: null, ptcglCode: null }, GROUPS);
  assert.deepEqual(jungle.map((g) => g.groupId), [635], 'by name when there is no code');
  assert.deepEqual(candidateGroups({ tcgdexId: 'zz', name: 'Nothing', abbreviation: null, ptcglCode: null }, GROUPS), []);
});

const plan = (agreeing: number, numbered: number): PlanResult =>
  ({ links: [], skipped: [], cardsMatched: agreeing, cardsAgreeing: agreeing, cardsConsidered: numbered, numberedProducts: numbered });
const scored = (groupId: number, agreeing: number, numbered: number): GroupScore => ({ groupId, plan: plan(agreeing, numbered) });

test('acceptGroup takes a group whose cards agree, refuses a weak or tied one', () => {
  assert.deepEqual(acceptGroup([scored(1, 95, 100)], 100), { groupId: 1, plan: plan(95, 100) });
  assert.deepEqual(acceptGroup([], 100), { rejected: 'no-candidate' });
  assert.deepEqual(acceptGroup([scored(1, 50, 100)], 100), { rejected: 'weak-agreement' });
  assert.deepEqual(acceptGroup([scored(1, 2, 2)], 200), { rejected: 'weak-agreement' }, 'two coincidences are not evidence');
  assert.deepEqual(acceptGroup([scored(1, 95, 100), scored(2, 95, 100)], 100), { rejected: 'tie' });
  const best = acceptGroup([scored(1, 92, 100), scored(2, 99, 100)], 100);
  assert.ok('groupId' in best && best.groupId === 2);
});

test('a tiny set can be accepted on its own size, a big one cannot on three coincidences', () => {
  assert.ok('groupId' in acceptGroup([scored(1, 2, 2)], 2));
  assert.deepEqual(acceptGroup([scored(1, 3, 3)], 300), { rejected: 'weak-agreement' });
});
