import type { CardRef, Quality } from './paths.js';
import { IMAGE_SOURCE_HOSTS, type UpstreamPolicy } from './upstream.js';
import { restGet } from './manifest.js';

/**
 * SELF-SOURCED card art: bytes from outside the approved upstream ladder, which the image tier
 * never stores as fetched. It re-encodes them to the slot it serves (`SLOT_SIZE`) and always
 * prefers TCGdex: a self-sourced card is refilled from TCGdex first, and `?refresh=tcgdex` swaps
 * one in place once TCGdex has it.
 *
 * Two ways in: the image tier's fallback for a card no approved source has (the linked product's
 * image, fetched only under `SELF_SOURCE_POLICY` — not on `IMAGE_SOURCE_HOSTS`, so a recorded URL
 * of it is never refetched and stored raw), and `pnpm --filter deckpal-api art:self-source`.
 *
 * `image_asset.source_url` is the URL the bytes were fetched from; it is what marks a card as
 * self-sourced for the tier and the swap job.
 */

export const PRODUCT_IMAGE_HOST = 'product-images.tcgplayer.com';

export function productImageUrl(productId: number): string {
  if (!Number.isSafeInteger(productId) || productId <= 0) {
    throw new Error(`[self-source] not a product id: ${productId}`);
  }
  return `https://${PRODUCT_IMAGE_HOST}/${productId}.jpg`;
}

/** The one host the self-source fallback may fetch from, under its own policy. */
export const SELF_SOURCE_POLICY: UpstreamPolicy = {
  originFor(host: string): string | null {
    return host === PRODUCT_IMAGE_HOST ? `https://${PRODUCT_IMAGE_HOST}` : null;
  },
  allowPrivateAddresses: false,
};

/**
 * A recorded source is self-sourced when it is not on the approved ladder, including a
 * `self-sourced:` note for art recorded by hand with no URL.
 */
export function isSelfSourced(sourceUrl: string | null | undefined): boolean {
  if (!sourceUrl) return false;
  let host: string;
  try {
    host = new URL(sourceUrl).hostname;
  } catch {
    return true;
  }
  return !IMAGE_SOURCE_HOSTS.includes(host);
}

/** The two card slots the app serves (DATA-LAYER §3.4), as TCGdex ships them. */
export const SLOT_SIZE: Record<Quality, { width: number; height: number }> = {
  low: { width: 245, height: 337 },
  high: { width: 600, height: 825 },
};

/** Self-sourced objects are cached for a week, not a year, so a TCGdex swap reaches browsers. */
export const SELF_SOURCED_CACHE_CONTROL = 'max-age=604800';

interface VariantRow {
  tcgplayer_product_id: number | null;
  is_primary: boolean;
  variant_kind_code: string;
  sort_order: number;
}

/** Stamps and jumbo sizes a printing carries: a printing with none is the card's plain print. */
const marks = (code: string): number => (code.match(/stamp/g)?.length ?? 0) + (code.includes('jumbo') ? 1 : 0);

/**
 * The linked product whose image is this card's art: the plainest printing we link. Primary
 * first, then the earliest-sorted. A stamped or jumbo printing only when the card HAS no plain
 * printing — a card printed only with a stamp (a theme deck's, a promotion's) is its stamped
 * print — and then the one with the fewest marks. A card with an unlinked plain printing gets
 * none: a stamp it does not carry would be the wrong art.
 */
export function pickArtProduct(rows: VariantRow[]): number | null {
  const order = (x: VariantRow, y: VariantRow): number =>
    marks(x.variant_kind_code) - marks(y.variant_kind_code)
    || Number(y.is_primary) - Number(x.is_primary)
    || x.sort_order - y.sort_order;
  const linked = rows.filter((r) => r.tcgplayer_product_id != null).sort(order);
  const best = linked[0];
  if (!best) return null;
  if (marks(best.variant_kind_code) === 0) return best.tcgplayer_product_id;
  return rows.every((r) => marks(r.variant_kind_code) > 0) ? best.tcgplayer_product_id : null;
}

/** What the tier needs to know about a card to self-source and check its art. */
export interface ArtCard {
  name: string;
  localId: string;
  productId: number;
  groupId: number | null;
  printedTotal: number | null;
}

interface CardRow {
  name: string;
  local_id: string;
  card_set: { tcgdex_id: string; tcgplayer_group_id: number | null; card_count_official: number | null };
  card_variant: VariantRow[];
}

/** Look the card and its art product up in the catalog (PostgREST, service role). */
export async function cardArtProduct(ref: CardRef, lang = 'en'): Promise<ArtCard | null> {
  const rows = await restGet<CardRow>(
    'card?select=name,local_id,' +
      'card_set!inner(tcgdex_id,tcgplayer_group_id,card_count_official),' +
      'card_variant(tcgplayer_product_id,is_primary,variant_kind_code,sort_order)' +
      `&local_id=eq.${encodeURIComponent(ref.localId)}` +
      `&lang=eq.${encodeURIComponent(lang)}` +
      `&card_set.tcgdex_id=eq.${encodeURIComponent(ref.set)}&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  const productId = pickArtProduct(row.card_variant ?? []);
  if (productId == null) return null;
  return {
    name: row.name,
    localId: row.local_id,
    productId,
    groupId: row.card_set.tcgplayer_group_id,
    printedTotal: row.card_set.card_count_official,
  };
}

/** The product's record (TCGCSV), the slice the identity check reads. */
export interface ProductRecord {
  name: string;
  /** extendedData "Number", e.g. '103a/147', '032', 'SWSH149'; null when none is listed. */
  number: string | null;
}

const fold = (s: string): string =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, "'")
    .replace(/\[[^[\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** '050a' -> '50a', 'SWSH149' -> 'swsh149', 'XY39' -> 'xy39', '003' -> '3'. */
const numberKey = (s: string): string => s.trim().toLowerCase().replace(/^([a-z-]*)0+(?=\d)/, '$1');

/**
 * Is this product the card? Its name must contain the card's, and its number must be the card's —
 * unless the product's printed denominator is not this set's size, which is how a reprint set
 * prints the ORIGINAL card's number (Classic Collection prints Charizard as 4/102). A letter suffix
 * is part of the number: Aquapolis 103a and 103b are different cards.
 */
export function productMatchesCard(product: ProductRecord, card: Pick<ArtCard, 'name' | 'localId' | 'printedTotal'>): boolean {
  const pName = ` ${fold(product.name)} `;
  const cName = fold(card.name);
  if (!cName || !pName.includes(` ${cName} `)) return false;
  if (!product.number) return true;
  const [num, total] = product.number.split('/');
  if (total && card.printedTotal && Number(total) !== card.printedTotal) return true;
  return numberKey(num ?? '') === numberKey(card.localId);
}
