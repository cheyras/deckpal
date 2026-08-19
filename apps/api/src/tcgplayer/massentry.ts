/**
 * TCGplayer Mass Entry building blocks, shared by the set route
 * (GET /sets/:setId/massentry), the list route (GET /lists/:id/massentry), the
 * ad-hoc route (POST /massentry), the deck routes (GET /decks/:id/massentry,
 * GET /decks/:id/pricing) and — through all of them — deckpal-mcp.
 *
 * ## What Mass Entry actually does (probed live 2026-08-19, see DECISIONS.md)
 *
 * The page posts to `POST https://mpgateway.tcgplayer.com/v1/cart/massentry/
 * addtocartandretrieve` with `{products: [{quantity, productId, name, setCode,
 * cardNumber}], selectedProductLineId, selectedPrintings, selectedConditions,
 * …}`. Its own parser (`MassEntryExpressions` in the site bundle) is:
 *
 *   ByProductSetAndNumber  ^(\d+)(\s+(\S.*)|-(\d+))\s+\[(.+)\]\s+(.+)$
 *   ByProductAndSet        ^(\d+)(\s+(\S.*)|-(\d+))\s+\[(.+)\]$
 *   ByProduct              ^(\d+)(\s+(\S.*)|-(\d+))$
 *
 * Note the second alternative in every branch: **`<qty>-<productId>`**. That is
 * an exact catalog reference — no name matching, no set code, no punctuation to
 * get wrong — and it is what this module emits whenever we know the product id.
 *
 * ### Why name lines were the wrong contract
 *
 * A name line only resolves when the name is UNIQUE inside the TCGplayer group.
 * TCGplayer disambiguates a repeated name by appending the collector number to
 * the *product* name, so within one set both forms coexist:
 *
 *   "Tropius"                (unique)      → `1 Tropius [PBL]`          resolves
 *   "Fomantis - 003/084"     (repeats)     → `1 Fomantis [PBL]`         FAILS
 *
 * That is a per-PRODUCT property, not a per-set one, so the old
 * `NUMBERED_GROUP_IDS` allow-list could not model it and is gone. Every modern
 * set reprints base-card names as Illustration / Special Illustration / hyper
 * rares, so a large fraction of name lines miss.
 *
 * ### And why one miss is fatal
 *
 * Mass Entry is **all-or-nothing**: a single unresolvable line makes the whole
 * submission add nothing. Measured: `['1 Tropius [PBL]']` adds 1;
 * `['1 Tropius [PBL]', '1 Fomantis [PBL]']` adds 0. A 40-line Pitch Black cart
 * in the old name format added 0/40; the same cards as `<qty>-<productId>`
 * added 40/40.
 *
 * The consequence for this module: lines we can PROVE (product id) and lines we
 * are GUESSING (a stored `tcgplayer_mass_entry` token) are never mixed into the
 * same URL, so a guess can never void the verified cart.
 *
 * ### What still cannot be encoded
 *
 * Printing (normal/foil/reverse) and condition are chosen page-wide in Mass
 * Entry's own preferences panel, never per line. Two missing printings of one
 * card are therefore two copies of one product id on one line, and the buyer
 * picks the printing on the page. Duplicate product-id lines are merged and
 * summed by TCGplayer (verified), so aggregation here is a courtesy, not a
 * requirement.
 */

const MASSENTRY_BASE = 'https://www.tcgplayer.com/massentry?productline=Pokemon&c=';
/** Max encoded chars for one URL's `c` payload — well under common 414 limits. */
const MAX_C_CHARS = 1800;

/** The caveats every Mass Entry response carries. */
export const MASSENTRY_NOTE =
  'Printing (normal/foil/reverse) and condition (NM/LP/…) cannot be preselected by link — ' +
  "choose them in the preferences panel on TCGplayer's Mass Entry page. Mass Entry is " +
  'all-or-nothing: if any single line fails to match a product, NOTHING is added to the ' +
  'cart, which is why proven product-id lines are never mixed with best-effort ones.';

// ── TCGplayer set abbreviations ───────────────────────────────────────────────
// The catalog stores card_set.tcgplayer_group_id but not the group's
// abbreviation (the Mass Entry set-code vocabulary). TCGCSV's groups endpoint
// (already our price feed upstream) carries it; fetched lazily, cached
// in-process for 24h, 5-minute negative cache, and every failure degrades to
// a missing code rather than an error.
//
// Product-id lines need no set code at all, so callers only reach for this when
// they have a best-effort line to build or a code to report — which keeps an
// external HTTP dependency off the normal cart path entirely.
const ABBREV_TTL_MS = 24 * 60 * 60 * 1000;
const ABBREV_NEG_TTL_MS = 5 * 60 * 1000;
let abbrevCache: { at: number; ok: boolean; map: Map<number, string> } | null = null;
let abbrevInFlight: Promise<Map<number, string>> | null = null;

async function fetchAbbrevMap(): Promise<Map<number, string>> {
  const res = await fetch('https://tcgcsv.com/tcgplayer/3/groups', {
    // TCGCSV blocks generic/missing UAs — same identity apps/sync uses.
    headers: { 'User-Agent': 'deckpal/1.0 (+cheyras@gmail.com)', Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`tcgcsv groups → ${res.status}`);
  const body = (await res.json()) as { results?: Array<{ groupId?: number; abbreviation?: string | null }> };
  const map = new Map<number, string>();
  for (const g of body.results ?? []) {
    if (typeof g.groupId === 'number' && typeof g.abbreviation === 'string' && g.abbreviation) {
      map.set(g.groupId, g.abbreviation);
    }
  }
  if (map.size === 0) throw new Error('tcgcsv groups: empty abbreviation map');
  return map;
}

/** TCGplayer set abbreviation for a TCGCSV group id (null when unknown/unavailable). */
export async function tcgplayerAbbrev(groupId: number | null): Promise<string | null> {
  if (groupId === null) return null;
  const now = Date.now();
  if (abbrevCache && now - abbrevCache.at < (abbrevCache.ok ? ABBREV_TTL_MS : ABBREV_NEG_TTL_MS)) {
    return abbrevCache.map.get(groupId) ?? null;
  }
  abbrevInFlight ??= fetchAbbrevMap()
    .then((map) => {
      abbrevCache = { at: Date.now(), ok: true, map };
      return map;
    })
    .catch((err: unknown) => {
      console.error('[deckpal-api] tcgcsv abbreviation fetch failed:', (err as Error).message);
      // Keep a stale successful map if we ever had one; else negative-cache.
      abbrevCache = abbrevCache?.ok ? { ...abbrevCache, at: Date.now() } : { at: Date.now(), ok: false, map: new Map() };
      return abbrevCache.map;
    })
    .finally(() => {
      abbrevInFlight = null;
    });
  const map = await abbrevInFlight;
  return map.get(groupId) ?? null;
}

// ── Line + URL builders ───────────────────────────────────────────────────────

/**
 * The exact line: `<qty>-<productId>`. TCGplayer resolves this against its
 * catalog directly, so it cannot be defeated by a repeated card name, an
 * apostrophe, a colon, a hyphen, or a missing set code.
 */
export function productIdLine(qty: number, productId: number): string {
  return `${qty}-${productId}`;
}

/**
 * A stored `tcgplayer_mass_entry` token rendered for `qty` copies. The token
 * carries its own leading quantity, which is replaced. Best-effort only: the
 * column is NULL for every row in the shipped catalog, so this exists for forks
 * that populate it and for hand-curated overrides.
 */
export function tokenLine(qty: number, token: string): string {
  return `${qty}${token.replace(/^\d+/, '')}`;
}

/** Encode one line for the `c` param: URL-encoded, spaces as `+` (observed TCGplayer format). */
function encodeLine(line: string): string {
  return encodeURIComponent(line).replace(/%20/g, '+');
}

/** Chunk encoded lines into complete massentry URLs, each `c` ≤ MAX_C_CHARS. */
export function buildUrls(lines: string[]): string[] {
  const SEP = '%7C%7C';
  const urls: string[] = [];
  let cur = '';
  for (const line of lines) {
    const enc = encodeLine(line);
    if (cur && cur.length + SEP.length + enc.length > MAX_C_CHARS) {
      urls.push(MASSENTRY_BASE + cur);
      cur = enc;
    } else {
      cur = cur ? cur + SEP + enc : enc;
    }
  }
  if (cur) urls.push(MASSENTRY_BASE + cur);
  return urls;
}

// ── The cart builder ──────────────────────────────────────────────────────────

/** One thing the buyer needs, already resolved to a catalog row. */
export interface CartInput {
  /** Copies to buy. Merged with any other input carrying the same product id. */
  quantity: number;
  /** `card_variant.tcgplayer_product_id` — the only field that matches exactly. */
  productId: number | null;
  /** `card_variant.tcgplayer_mass_entry`, when a fork has curated one. */
  token?: string | null;
  /** Reporting only (unlinkable list, human text). */
  name: string;
  number: string;
  setId: string;
  variant?: string | null;
}

export interface CartGroup {
  lines: string[];
  urls: string[];
  /** Physical copies represented (Σ quantities), not lines. */
  items: number;
}

export interface UnlinkableEntry {
  name: string;
  number: string;
  setId: string;
  variant: string | null;
}

export interface CartBuild {
  /** Product-id lines. These resolve deterministically. */
  exact: CartGroup;
  /**
   * Curated-token lines. Kept in their OWN urls: Mass Entry is all-or-nothing,
   * so a guess that misses must not be able to void the exact cart.
   */
  bestEffort: CartGroup;
  /** No TCGplayer identity at all — buy elsewhere. Never emitted as a guess. */
  unlinkable: UnlinkableEntry[];
  /** Every url to open, exact first. Each adds to the same cart. */
  urls: string[];
  /** Plain-text fallback for tcgplayer.com/massentry, exact lines first. */
  text: string;
  needed: { lines: number; items: number; exactLines: number; bestEffortLines: number; unlinkable: number };
  warnings: string[];
  note: string;
}

/**
 * Turn resolved catalog rows into Mass Entry lines and URLs.
 *
 * Aggregation is by product id (several variants of one card legitimately share
 * one TCGplayer product — 12 671 product ids in the shipped catalog map to
 * exactly two variants, the normal/reverse pair — and two missing printings
 * really are two copies to buy). Input order is preserved by first appearance
 * so the cart reads in catalog order.
 */
export function buildCart(inputs: readonly CartInput[]): CartBuild {
  const byProduct = new Map<number, number>();
  const byToken = new Map<string, number>();
  const unlinkable: UnlinkableEntry[] = [];

  for (const it of inputs) {
    const qty = Math.max(0, Math.trunc(it.quantity));
    if (qty === 0) continue;
    if (it.productId !== null && it.productId !== undefined) {
      byProduct.set(it.productId, (byProduct.get(it.productId) ?? 0) + qty);
      continue;
    }
    if (it.token) {
      byToken.set(it.token, (byToken.get(it.token) ?? 0) + qty);
      continue;
    }
    unlinkable.push({ name: it.name, number: it.number, setId: it.setId, variant: it.variant ?? null });
  }

  const exactLines = [...byProduct.entries()].map(([pid, qty]) => productIdLine(qty, pid));
  const bestEffortLines = [...byToken.entries()].map(([token, qty]) => tokenLine(qty, token));
  const exactItems = [...byProduct.values()].reduce((s, n) => s + n, 0);
  const bestEffortItems = [...byToken.values()].reduce((s, n) => s + n, 0);

  const exact: CartGroup = { lines: exactLines, urls: buildUrls(exactLines), items: exactItems };
  const bestEffort: CartGroup = { lines: bestEffortLines, urls: buildUrls(bestEffortLines), items: bestEffortItems };

  const warnings: string[] = [];
  if (bestEffortLines.length > 0) {
    warnings.push(
      `${bestEffortLines.length} line(s) use a curated Mass Entry token rather than a TCGplayer product id and may not ` +
        'resolve. They are in separate link(s) so a miss cannot void the exact cart.',
    );
  }
  if (unlinkable.length > 0) {
    warnings.push(
      `${unlinkable.length} needed item(s) have no TCGplayer product id and are not in any cart link — buy them elsewhere.`,
    );
  }

  return {
    exact,
    bestEffort,
    unlinkable,
    urls: [...exact.urls, ...bestEffort.urls],
    text: [...exactLines, ...bestEffortLines].join('\n'),
    needed: {
      lines: exactLines.length + bestEffortLines.length,
      items: exactItems + bestEffortItems,
      exactLines: exactLines.length,
      bestEffortLines: bestEffortLines.length,
      unlinkable: unlinkable.length,
    },
    warnings,
    note: MASSENTRY_NOTE,
  };
}
