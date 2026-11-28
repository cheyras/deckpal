import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parseImagePath, type ParsedImage } from '@deckpal/storage';
import { resolveSourceFromManifest } from '../handler.js';
import { encodeToSlot } from '../selfSource.js';

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
