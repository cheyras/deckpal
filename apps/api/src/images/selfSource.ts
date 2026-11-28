import sharp from 'sharp';
import {
  SELF_SOURCE_POLICY,
  SLOT_SIZE,
  cardArtProduct,
  fetchSourceBytes,
  productMatchesCard,
  productImageUrl,
  type CardRef,
  type ProductRecord,
  type Quality,
} from '@deckpal/storage';

/**
 * The self-source fallback for card art (@deckpal/storage `self-source.ts`): the linked product's
 * image of the card's plainest printing, re-encoded to the slot the tier serves — resized
 * (Lanczos, centre crop to the slot's aspect), WebP q82, no metadata carried over.
 */

/** Below this a source is not a usable card image (the smallest real ones are ~200×278). */
const MIN_NATIVE_HEIGHT = 250;
/** A card is ~1.40 tall per wide; anything far off is a banner, a sealed product or a placeholder. */
const MIN_ASPECT = 1.25;
const MAX_ASPECT = 1.55;
const cardShaped = (tallPerWide: number): boolean => tallPerWide >= MIN_ASPECT && tallPerWide <= MAX_ASPECT;

/**
 * Turning a sideways card upright, in sharp's clockwise degrees: 270 is a quarter turn
 * counter-clockwise. A sideways card (BREAK, the two halves of a LEGEND) is a portrait card with
 * its content printed turned, the card's top edge running up its left side, so the name reads
 * bottom to top and the HP sits in the top-left corner. TCGdex shows every BREAK and LEGEND card
 * that way, and a landscape picture of one becomes that card by this turn.
 */
export const SIDEWAYS_TURN = 270;

export type SlotEncodeResult =
  | { ok: true; bytes: Buffer; native: { width: number; height: number }; rotated: boolean }
  | { ok: false; reason: string };

/**
 * Re-encode a source image to one card slot, or refuse it. Pure: no network.
 *
 * A landscape source that is card-shaped once turned is a sideways card that only exists as a
 * landscape picture: it is turned upright (`SIDEWAYS_TURN`) and then encoded like any other, its
 * content sideways on the card as printed. A source that is card-shaped neither way stays refused.
 */
export async function encodeToSlot(source: Buffer, quality: Quality): Promise<SlotEncodeResult> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(source, { failOn: 'error' }).metadata();
  } catch (err) {
    return { ok: false, reason: `undecodable: ${(err as Error).message.slice(0, 80)}` };
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const rotated = width > height && cardShaped(width / Math.max(1, height));
  // The card as it stands upright: a sideways source's width is its height.
  const [uprightWidth, uprightHeight] = rotated ? [height, width] : [width, height];
  if (uprightHeight < MIN_NATIVE_HEIGHT) return { ok: false, reason: `too small: ${width}x${height}` };
  if (!cardShaped(uprightHeight / Math.max(1, uprightWidth))) return { ok: false, reason: `not card-shaped: ${width}x${height}` };
  const slot = SLOT_SIZE[quality];
  // Turned in its own pass, so the resize below sees the upright card whatever sharp's own
  // ordering of the two operations.
  const upright = rotated ? await sharp(source).rotate(SIDEWAYS_TURN).png().toBuffer() : source;
  const bytes = await sharp(upright)
    .resize(slot.width, slot.height, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .webp({ quality: 82 })
    .toBuffer();
  return { ok: true, bytes, native: { width, height }, rotated };
}

export type SelfSourceResult =
  | { ok: true; bytes: Buffer; sourceUrl: string; etag: string | null }
  | { ok: false; reason: string };

/**
 * Every product in a group (TCGCSV), memoised per warm instance so a set's worth of fills reads it
 * once — the identity check's input. The URL is a constant host plus an integer, never input.
 */
/** A generic client name: TCGCSV refuses an anonymous `node` agent. */
export const GROUP_FETCH_USER_AGENT = 'DeckPal image tier';
const GROUP_TTL_MS = 60 * 60 * 1000;
const groups = new Map<number, { at: number; products: Map<number, ProductRecord> }>();

export async function groupProducts(groupId: number): Promise<Map<number, ProductRecord> | null> {
  const hit = groups.get(groupId);
  if (hit && Date.now() - hit.at < GROUP_TTL_MS) return hit.products;
  if (!Number.isSafeInteger(groupId) || groupId <= 0) return null;
  // TCGCSV answers 401 to Node's default `node` user agent (measured 2026-11-27, the first live
  // fill: every card came back "group unreadable"). Any named client is served.
  const res = await fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`, {
    headers: { 'user-agent': GROUP_FETCH_USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    results?: { productId: number; name: string; extendedData?: { name: string; value: string }[] }[];
  };
  const products = new Map<number, ProductRecord>();
  for (const p of body.results ?? []) {
    const number = p.extendedData?.find((e) => e.name === 'Number')?.value ?? null;
    products.set(p.productId, { name: p.name, number });
  }
  groups.set(groupId, { at: Date.now(), products });
  return products;
}

/**
 * Fetch and encode the self-sourced art for one card slot. Refuses unless the product's record,
 * in the card's set's group, names this card at this number.
 */
export async function selfSourceCardArt(ref: CardRef, quality: Quality): Promise<SelfSourceResult> {
  const card = await cardArtProduct(ref);
  if (!card) return { ok: false, reason: 'no linked product' };
  if (card.groupId == null) return { ok: false, reason: 'set has no product group to check against' };
  const products = await groupProducts(card.groupId);
  if (!products) return { ok: false, reason: `product group ${card.groupId} unreadable` };
  const record = products.get(card.productId);
  if (!record) return { ok: false, reason: `product ${card.productId} is not in the set's group` };
  if (!productMatchesCard(record, card)) {
    return { ok: false, reason: `product ${card.productId} is "${record.name}" ${record.number ?? ''}, not this card`.trim() };
  }
  const url = productImageUrl(card.productId);
  const fetched = await fetchSourceBytes(url, 12_000, SELF_SOURCE_POLICY);
  if (!fetched.ok) return { ok: false, reason: `product image ${fetched.httpStatus}: ${fetched.reason}` };
  const encoded = await encodeToSlot(fetched.bytes, quality);
  if (!encoded.ok) return { ok: false, reason: `product image refused: ${encoded.reason}` };
  return { ok: true, bytes: encoded.bytes, sourceUrl: url, etag: fetched.etag };
}
