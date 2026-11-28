import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parseImagePath, type ArtCard, type ParsedImage, type ProductRecord } from '@deckpal/storage';
import { resolveSourceFromManifest } from '../handler.js';
import { artProductGroup, checkArtProduct, encodeToSlot, verifiedArtLink } from '../selfSource.js';

/**
 * The self-source rules in the image tier, without a network: how a self-sourced card resolves,
 * and what our own encode of a source image is. Run: pnpm --filter deckpal-api test:images
 */

type CardAsset = Extract<ParsedImage, { kind: 'card' }>;
function card(path: string): CardAsset {
  const r = parseImagePath(path);
  assert.ok(r.ok && r.asset.kind === 'card');
  return r.asset as CardAsset;
}

test('a self-sourced card resolves to TCGdex first, and a TCGdex success replaces its provenance', () => {
  const a = card('en/me/mep/032/high.webp');
  const r = resolveSourceFromManifest(a, { source_url: 'https://product-images.tcgplayer.com/685510.jpg' });
  assert.deepEqual(r, { url: a.canonicalSourceUrl, provenanceWasUnknown: false, replacesSelfSourced: true });
});

test('an approved recorded source still wins, and a card with none still derives TCGdex', () => {
  const a = card('en/sv/sve/001/high.webp');
  assert.deepEqual(resolveSourceFromManifest(a, { source_url: 'https://images.pokemontcg.io/sve/1_hires.png' }),
    { url: 'https://images.pokemontcg.io/sve/1_hires.png', provenanceWasUnknown: false });
  assert.deepEqual(resolveSourceFromManifest(a, null), { url: a.canonicalSourceUrl, provenanceWasUnknown: true });
});

const scan = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .withMetadata({ exif: { IFD0: { Copyright: 'some marketplace', Artist: 'scanner' } } })
    .jpeg()
    .toBuffer();

test('a source is re-encoded to each slot as WebP, with nothing of its metadata', async () => {
  const src = await scan(733, 1024);
  for (const [quality, w, h] of [['low', 245, 337], ['high', 600, 825]] as const) {
    const r = await encodeToSlot(src, quality);
    assert.ok(r.ok);
    const meta = await sharp(r.bytes).metadata();
    assert.equal(meta.format, 'webp');
    assert.deepEqual([meta.width, meta.height], [w, h]);
    assert.equal(meta.exif, undefined, 'no EXIF carried over');
    assert.deepEqual(r.native, { width: 733, height: 1024 });
    assert.notDeepEqual(r.bytes, src);
  }
});

test('a small scan is upscaled to the slot, a tiny or non-card image is refused', async () => {
  const small = await encodeToSlot(await scan(200, 278), 'high');
  assert.ok(small.ok);
  assert.equal(small.rotated, false);
  assert.deepEqual([(await sharp(small.bytes).metadata()).height], [825]);
  assert.deepEqual(await encodeToSlot(await scan(120, 167), 'low'), { ok: false, reason: 'too small: 120x167' });
  const junk = await encodeToSlot(Buffer.from('<html>not found</html>'), 'low');
  assert.equal(junk.ok, false);
});

/**
 * A landscape picture of a sideways card, as the BREAK sources come (920×660): grey, with a red
 * band along the card's top edge and a green block in its top-right corner, where the HP is.
 */
const sidewaysCard = (width: number, height: number) => {
  const band = Math.round(height / 10);
  const corner = Math.round(height / 6);
  return sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .composite([
      { input: { create: { width, height: band, channels: 3, background: { r: 230, g: 20, b: 20 } } }, left: 0, top: 0 },
      { input: { create: { width: corner, height: corner, channels: 3, background: { r: 20, g: 200, b: 20 } } }, left: width - corner, top: 0 },
    ])
    .jpeg({ quality: 95 })
    .toBuffer();
};

async function pixel(bytes: Buffer, x: number, y: number): Promise<'red' | 'green' | 'grey' | string> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
  if (r > 180 && g < 80 && b < 80) return 'red';
  if (g > 150 && r < 80 && b < 80) return 'green';
  if (Math.abs(r - 128) < 30 && Math.abs(g - 128) < 30 && Math.abs(b - 128) < 30) return 'grey';
  return `rgb(${r},${g},${b})`;
}

test('a landscape picture of a sideways card is turned upright, its top edge down the left side', async () => {
  const src = await sidewaysCard(920, 660);
  for (const [quality, w, h] of [['low', 245, 337], ['high', 600, 825]] as const) {
    const r = await encodeToSlot(src, quality);
    assert.ok(r.ok, r.ok ? '' : r.reason);
    assert.equal(r.rotated, true);
    assert.deepEqual(r.native, { width: 920, height: 660 });
    const meta = await sharp(r.bytes).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['webp', w, h]);
    // A quarter turn counter-clockwise, as TCGdex shows BREAK cards: the top edge (red) runs
    // down the left side, the top-right corner (green, the HP) lands top-left, and the right
    // side stays the card's body.
    assert.equal(await pixel(r.bytes, 3, Math.round(h * 0.6)), 'red', 'the top edge is the left side');
    assert.equal(await pixel(r.bytes, w - 4, Math.round(h * 0.6)), 'grey', 'the bottom edge is the right side');
    assert.equal(await pixel(r.bytes, 10, 10), 'green', 'the HP corner is top-left');
    assert.equal(await pixel(r.bytes, 10, h - 10), 'red', 'and not bottom-left, which a mirrored turn gives');
  }
});

test('a source that is not card-shaped either way is still refused', async () => {
  // A wide placeholder picture (1920×1100) is 1.75 wide per tall: no card, turned or not.
  assert.deepEqual(await encodeToSlot(await scan(1920, 1100), 'low'), { ok: false, reason: 'not card-shaped: 1920x1100' });
  // A square, and a banner, likewise.
  assert.deepEqual(await encodeToSlot(await scan(800, 800), 'low'), { ok: false, reason: 'not card-shaped: 800x800' });
  assert.deepEqual(await encodeToSlot(await scan(400, 1000), 'low'), { ok: false, reason: 'not card-shaped: 400x1000' });
  // A sideways card too small once upright (its upright height is the source's width).
  assert.deepEqual(await encodeToSlot(await scan(240, 172), 'low'), { ok: false, reason: 'too small: 240x172' });
});

test('the product-list read names its client (TCGCSV refuses Node\'s default agent)', async () => {
  const { groupProducts, GROUP_FETCH_USER_AGENT } = await import('../selfSource.js');
  const real = globalThis.fetch;
  let sent: Headers | null = null;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent = new Headers(init?.headers);
    return new Response(JSON.stringify({ results: [{ productId: 7, name: 'Decidueye', extendedData: [{ name: 'Number', value: '001/015' }] }] }));
  }) as typeof fetch;
  try {
    const products = await groupProducts(987654);
    assert.equal(sent!.get('user-agent'), GROUP_FETCH_USER_AGENT);
    assert.deepEqual(products?.get(7), { name: 'Decidueye', number: '001/015' });
  } finally {
    globalThis.fetch = real;
  }
});

// ── the identity check of a card's linked product (pure: no catalog, no network) ─────────────

const artCard = (over: Partial<ArtCard> & Pick<ArtCard, 'name' | 'localId' | 'productId'>): ArtCard =>
  ({ groupId: null, printedTotal: null, ...over });
const records = (...rows: [number, string, string | null][]): Map<number, ProductRecord> =>
  new Map(rows.map(([id, name, number]) => [id, { name, number }]));

test('a verified link whose record lists the wrong number now passes; without it the same record is refused', () => {
  // tk-xy-n-29 Switch: its record lists 4/30, which is the deck's Bunnelby.
  const card = artCard({ name: 'Switch', localId: '29', productId: 98024, printedTotal: 30, groupId: 1532 });
  const deck = records([98024, 'Switch (Noivern)', '4/30'], [97999, 'Bunnelby', '4/30']);
  const verified = verifiedArtLink('tk-xy-n', card);
  assert.equal(verified?.productId, 98024);
  assert.deepEqual(checkArtProduct(card, verified, deck), { ok: true });
  assert.deepEqual(checkArtProduct(card, null, deck),
    { ok: false, reason: 'product 98024 is "Switch (Noivern)" 4/30, not this card' });

  // tk-sm-r-3 Lightning Energy: its record lists 2/30, the #2 card's number.
  const energy = artCard({ name: 'Lightning Energy', localId: '3', productId: 152852, printedTotal: 30, groupId: 2069 });
  const kit = records([152852, 'Lightning Energy (#3)', '2/30'], [152851, 'Lightning Energy (#2)', '2/30']);
  assert.deepEqual(checkArtProduct(energy, verifiedArtLink('tk-sm-r', energy), kit), { ok: true });
  assert.equal(checkArtProduct(energy, null, kit).ok, false);
});

test("a verified link is checked in its own group, not the set's", () => {
  // sm10-195a and mep-Museum are listed outside their sets' groups.
  const cases = [
    { set: 'sm10', group: 1938, record: [216699, 'Dedenne GX - 195a/214', '195a/214'] as [number, string, string | null],
      card: artCard({ name: 'Dedenne GX', localId: '195a', productId: 216699, printedTotal: 214, groupId: 1919 }) },
    { set: 'mep', group: 1528, record: [678659, 'Pikachu at the Museum', null] as [number, string, string | null],
      card: artCard({ name: 'Pikachu at the Museum', localId: 'Museum', productId: 678659, groupId: 24451 }) },
  ];
  for (const { set, group, record, card } of cases) {
    const verified = verifiedArtLink(set, card);
    assert.equal(artProductGroup(card, verified), group, `${set}-${card.localId}`);
    assert.deepEqual(checkArtProduct(card, verified, records(record)), { ok: true });
    // The set's own group does not list it, which is what refused it before.
    assert.equal(artProductGroup(card, null), card.groupId);
    assert.deepEqual(checkArtProduct(card, null, records()),
      { ok: false, reason: `product ${card.productId} is not in the set's group` });
  }
});

test("a verified link still needs its product in its group, and the product's name to name the card", () => {
  const card = artCard({ name: 'Switch', localId: '29', productId: 98024, printedTotal: 30, groupId: 1532 });
  const verified = verifiedArtLink('tk-xy-n', card);
  assert.ok(verified);
  assert.deepEqual(checkArtProduct(card, verified, records([97999, 'Bunnelby', '4/30'])),
    { ok: false, reason: 'product 98024 is not in its verified group' });
  assert.deepEqual(checkArtProduct(card, verified, records([98024, 'Potion (Noivern)', '4/30'])),
    { ok: false, reason: 'product 98024 is "Potion (Noivern)" 4/30, not this card' });
});

test('a verified link counts only for its own product, set, number and name', () => {
  const base = { name: 'Switch', localId: '29', productId: 98024 };
  assert.ok(verifiedArtLink('tk-xy-n', base));
  // Another product on the same card (a relink upstream) gets the ordinary check.
  assert.equal(verifiedArtLink('tk-xy-n', { ...base, productId: 97999 }), null);
  // The card renamed, renumbered or moved: the entry no longer describes it.
  assert.equal(verifiedArtLink('tk-xy-n', { ...base, name: 'Switch Cart' }), null);
  assert.equal(verifiedArtLink('tk-xy-n', { ...base, localId: '28' }), null);
  assert.equal(verifiedArtLink('tk-xy-sy', base), null);
  // A card no entry covers.
  assert.equal(verifiedArtLink('sv01', { name: 'Pikachu', localId: '63', productId: 1 }), null);
  // The pin compares names folded, so the catalog's curly apostrophe still matches.
  assert.ok(verifiedArtLink('xya', { name: 'Trainers’ Mail', localId: '92a', productId: 133815 }));
});

test('every card without a verified link keeps the full name and number check', () => {
  // Aquapolis a/b: the twin's product is refused on the letter.
  const porygon = artCard({ name: 'Porygon', localId: '103b', productId: 88306, printedTotal: 147, groupId: 1397 });
  assert.equal(verifiedArtLink('ecard2', porygon), null);
  assert.equal(checkArtProduct(porygon, null, records([88306, 'Porygon (103a)', '103a/147'])).ok, false);
  // The main-set product on a reprint card is refused on the number it carries.
  const reshiram = artCard({ name: 'Reshiram', localId: 'CC020', productId: 250301, printedTotal: 25, groupId: 2931 });
  assert.equal(verifiedArtLink('cel25cc', reshiram), null);
  assert.equal(checkArtProduct(reshiram, null, records([250301, 'Reshiram', '002/025'])).ok, false);
  // A product of another card is refused on the name.
  const sw = artCard({ name: 'Switch', localId: '33', productId: 524028, printedTotal: 48, groupId: 23330 });
  assert.equal(checkArtProduct(sw, null, records([524028, 'Potion (Pikachu)', null])).ok, false);
  // The right product still passes the ordinary check.
  const unown = artCard({ name: 'Unown', localId: '%3F', productId: 90167, printedTotal: 28, groupId: 1398 });
  assert.deepEqual(checkArtProduct(unown, null, records([90167, 'Unown (?)', '?/28'])), { ok: true });
  // No group at all stays a refusal.
  assert.equal(artProductGroup(artCard({ name: 'Unown', localId: '!', productId: 90166 }), null), null);
});
