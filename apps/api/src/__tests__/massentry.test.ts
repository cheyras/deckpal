import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildCart, buildUrls, productIdLine, tokenLine, type CartInput } from '../tcgplayer/massentry.js';

/**
 * Mass Entry line building.
 *
 * The behaviour under test was established by probing TCGplayer's live
 * `addtocartandretrieve` endpoint on 2026-08-19 (recorded in DECISIONS.md).
 * The two findings that matter:
 *
 *   1. `<qty>-<productId>` resolves exactly. 40 Pitch Black cards in that form:
 *      40 added, 0 errors. The same 40 as `<qty> <name> [PBL]`: 0 added,
 *      11 InvalidProduct.
 *   2. Mass Entry is ALL-OR-NOTHING. `['1 Tropius [PBL]']` adds 1;
 *      `['1 Tropius [PBL]', '1 Fomantis [PBL]']` adds 0.
 *
 * (2) is why exact and best-effort lines must never share a URL, and (1) is why
 * a card with no product id is reported rather than guessed at.
 */

const card = (over: Partial<CartInput> = {}): CartInput => ({
  quantity: 1,
  productId: 704758,
  name: 'Tropius',
  number: '001',
  setId: 'me05',
  ...over,
});

test('a product id becomes an exact line', () => {
  assert.equal(productIdLine(2, 704758), '2-704758');
});

test('a stored token keeps its own text and takes the new quantity', () => {
  assert.equal(tokenLine(3, '1 Pikachu - 025/165 [MEW]'), '3 Pikachu - 025/165 [MEW]');
});

test('variants sharing one product id aggregate onto a single line', () => {
  // 12,671 product ids in the shipped catalog map to exactly two variants (the
  // normal/reverse pair). Two missing printings genuinely are two copies to
  // buy, and Mass Entry cannot preselect a printing per line anyway.
  const build = buildCart([card(), card({ name: 'Tropius (reverse)' })]);
  assert.deepEqual(build.exact.lines, ['2-704758']);
  assert.equal(build.exact.items, 2);
});

test('input order is preserved by first appearance', () => {
  const build = buildCart([
    card({ productId: 111 }),
    card({ productId: 222 }),
    card({ productId: 111 }),
    card({ productId: 333 }),
  ]);
  assert.deepEqual(build.exact.lines, ['2-111', '1-222', '1-333']);
});

test('a card with no product id is unlinkable, never a name guess', () => {
  const build = buildCart([card(), card({ productId: null, name: 'Some Promo', number: 'SWSH123', setId: 'swshp' })]);
  assert.deepEqual(build.exact.lines, ['1-704758']);
  assert.equal(build.bestEffort.lines.length, 0);
  assert.deepEqual(build.unlinkable, [{ name: 'Some Promo', number: 'SWSH123', setId: 'swshp', variant: null }]);
  assert.match(build.warnings.join(' '), /no TCGplayer product id/);
});

test('best-effort lines get their own URLs so a miss cannot void the exact cart', () => {
  const build = buildCart([card(), card({ productId: null, token: '1 Weird Card [XYZ]' })]);
  assert.equal(build.exact.urls.length, 1);
  assert.equal(build.bestEffort.urls.length, 1);
  assert.notEqual(build.exact.urls[0], build.bestEffort.urls[0]);
  // urls is exact-first, so the caller opens the certain cart before the guess.
  assert.deepEqual(build.urls, [...build.exact.urls, ...build.bestEffort.urls]);
  assert.match(build.warnings.join(' '), /separate link/);
});

test('zero and negative quantities are dropped, not emitted', () => {
  const build = buildCart([card({ quantity: 0 }), card({ productId: 999, quantity: -3 }), card({ productId: 42, quantity: 2 })]);
  assert.deepEqual(build.exact.lines, ['2-42']);
});

test('an empty cart is empty, not a URL with no payload', () => {
  const build = buildCart([]);
  assert.deepEqual(build.urls, []);
  assert.equal(build.text, '');
  assert.equal(build.needed.items, 0);
});

test('URLs chunk under the length cap and every line survives', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `1-${700000 + i}`);
  const urls = buildUrls(lines);
  assert.ok(urls.length > 1, 'expected chunking');
  for (const u of urls) {
    const payload = u.slice(u.indexOf('&c=') + 3);
    assert.ok(payload.length <= 1800, `chunk too long: ${payload.length}`);
  }
  const rebuilt = urls.flatMap((u) => decodeURIComponent(u.slice(u.indexOf('&c=') + 3)).split('||'));
  assert.deepEqual(rebuilt, lines);
});

test('spaces encode as + and separators as %7C%7C (the observed TCGplayer format)', () => {
  const url = buildUrls(['1 Pikachu - 025/165 [MEW]', '2-704758'])[0]!;
  assert.ok(url.includes('1+Pikachu'), url);
  assert.ok(url.includes('%7C%7C'), url);
});

test('the note states the all-or-nothing behaviour', () => {
  // A cart that silently adds nothing is the reported symptom. The caller has
  // to be able to tell the user why, so this is contractual text.
  assert.match(buildCart([card()]).note, /all-or-nothing/i);
});
