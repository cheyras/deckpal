import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUpstreamUrl, IMAGE_SOURCE_POLICY } from '../upstream.js';
import {
  SELF_SOURCE_POLICY,
  PRODUCT_IMAGE_HOST,
  isSelfSourced,
  pickArtProduct,
  productMatchesCard,
  productImageUrl,
} from '../self-source.js';

/**
 * Self-sourced card art (self-source.ts), without a network: which recorded sources count as
 * self-sourced, which printing's product is the card's art, and whether the product's record
 * is the card. The identity cases are real ones.
 */

test('a recorded source off the approved ladder is self-sourced; an approved one is not', () => {
  assert.equal(isSelfSourced('https://assets.tcgdex.net/en/sv/sv01/001/high.webp'), false);
  assert.equal(isSelfSourced('https://images.pokemontcg.io/sve/1_hires.png'), false);
  assert.equal(isSelfSourced('https://product-images.tcgplayer.com/685510.jpg'), true);
  assert.equal(isSelfSourced('https://archives.bulbagarden.net/media/upload/a/ab/x.jpg'), true);
  assert.equal(isSelfSourced('self-sourced:owner scan of a sealed pack'), true);
  assert.equal(isSelfSourced(null), false);
});

test('the product-image host is fetchable only under the self-source policy, never the default one', async () => {
  const url = productImageUrl(685510);
  assert.equal(url, `https://${PRODUCT_IMAGE_HOST}/685510.jpg`);
  const offline = { ...SELF_SOURCE_POLICY, allowPrivateAddresses: true };
  assert.equal((await checkUpstreamUrl(url, offline)).ok, true);
  const refused = await checkUpstreamUrl(url, { ...IMAGE_SOURCE_POLICY, allowPrivateAddresses: true });
  assert.equal(refused.ok, false, 'a recorded self-sourced URL can never be refetched and stored raw');
  assert.equal((await checkUpstreamUrl('https://assets.tcgdex.net/en/a.webp', offline)).ok, false);
  assert.throws(() => productImageUrl(0));
});

const v = (pid: number | null, kind: string, primary: boolean, sort: number) =>
  ({ tcgplayer_product_id: pid, variant_kind_code: kind, is_primary: primary, sort_order: sort });

test('the art product is the primary plain printing, ahead of any stamped one', () => {
  assert.equal(pickArtProduct([v(1, 'normal-stamp-player-rewards-program', false, 2), v(2, 'reverse', false, 1), v(3, 'normal', true, 0)]), 3);
  assert.equal(pickArtProduct([v(null, 'holo', true, 0), v(9, 'reverse', false, 1)]), 9);
  assert.equal(pickArtProduct([]), null);
});

test('a card printed only with a stamp is its stamped print, the least-marked one', () => {
  // My First Battle: every printing carries the deck's stamp.
  assert.equal(pickArtProduct([v(523984, 'normal-blue-border-stamp-bulbasaur-stamp-pokeball', false, 1), v(523985, 'normal-stamp-bulbasaur', true, 0)]), 523985);
  // Mega Evolution Energy 009: only the 30th-anniversary stamped print exists.
  assert.equal(pickArtProduct([v(713248, 'holo-stamp-30th-anniversary', true, 0)]), 713248);
  // A jumbo is a last resort.
  assert.equal(pickArtProduct([v(1, 'holo-jumbo', false, 1), v(2, 'holo-stamp-mcdonalds', true, 0)]), 2);
});

test('a card with an unlinked plain printing gets no stamped art', () => {
  // MEP promo: the plain holo has no product; its set-logo stamped print would be the wrong art.
  assert.equal(pickArtProduct([v(null, 'holo', true, 0), v(685494, 'holo-stamp-set-logo', false, 1)]), null);
});

test('the product\'s record must name the card at its number', () => {
  const card = (name: string, localId: string, printedTotal: number | null = null) => ({ name, localId, printedTotal });
  assert.equal(productMatchesCard({ name: 'Mega Gardevoir ex', number: '032' }, card('Mega Gardevoir ex', '032')), true);
  assert.equal(productMatchesCard({ name: 'Flareon V - SWSH149', number: 'SWSH149' }, card('Flareon V', 'SWSH149')), true);
  assert.equal(productMatchesCard({ name: "Boss's Orders [Ghetsis]", number: '172/193' }, card("Boss's Orders", '172', 193)), true);
  assert.equal(productMatchesCard({ name: 'Water Energy', number: null }, card('Water Energy', '10', 30)), true);
  assert.equal(productMatchesCard({ name: 'Decidueye', number: '001/015' }, card('Decidueye', '1', 15)), true);
});

test('the Unown "!" and "?" match their records by printed number, not the catalog\'s %3F', () => {
  // The product records as listed in the set's group; the catalog spells "?" as TCGdex does.
  const unown = (localId: string) => ({ name: 'Unown', localId, printedTotal: 28 });
  assert.equal(productMatchesCard({ name: 'Unown (!)', number: '!/28' }, unown('!')), true);
  assert.equal(productMatchesCard({ name: 'Unown (?)', number: '?/28' }, unown('%3F')), true);
  // And they stay two different cards.
  assert.equal(productMatchesCard({ name: 'Unown (?)', number: '?/28' }, unown('!')), false);
  assert.equal(productMatchesCard({ name: 'Unown (!)', number: '!/28' }, unown('%3F')), false);
  assert.equal(productMatchesCard({ name: 'Unown (A)', number: 'A/28' }, unown('%3F')), false);
});

test('a reprint set prints the original\'s number, so only the name is held to it', () => {
  // Classic Collection: Charizard is printed 4/102 in a 30-card set.
  assert.equal(productMatchesCard({ name: 'Charizard', number: '4/102' }, { name: 'Charizard', localId: '001', printedTotal: 30 }), true);
});

test('a link to another card is refused, however close', () => {
  // Aquapolis 103b linked to 103a's product: same base number, different card.
  assert.equal(productMatchesCard({ name: 'Porygon (103a)', number: '103a/147' }, { name: 'Porygon', localId: '103b', printedTotal: 147 }), false);
  // Celebrations Classic Collection Reshiram linked to the main Celebrations Reshiram.
  assert.equal(productMatchesCard({ name: 'Reshiram', number: '002/025' }, { name: 'Reshiram', localId: 'CC020', printedTotal: 25 }), false);
  // A different card altogether.
  assert.equal(productMatchesCard({ name: 'Potion (Pikachu)', number: null }, { name: 'Switch', localId: '34', printedTotal: 34 }), false);
  // A name that only contains the card's as part of a word.
  assert.equal(productMatchesCard({ name: 'Pikachuu', number: '004' }, { name: 'Pikachu', localId: '004', printedTotal: null }), false);
});
