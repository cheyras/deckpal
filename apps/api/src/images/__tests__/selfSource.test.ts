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
  assert.deepEqual([(await sharp(small.bytes).metadata()).height], [825]);
  assert.deepEqual(await encodeToSlot(await scan(120, 167), 'low'), { ok: false, reason: 'too small: 120x167' });
  assert.deepEqual(await encodeToSlot(await scan(920, 660), 'low'), { ok: false, reason: 'not card-shaped: 920x660' });
  const junk = await encodeToSlot(Buffer.from('<html>not found</html>'), 'low');
  assert.equal(junk.ok, false);
});
