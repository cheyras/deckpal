/**
 * TCGplayer Mass Entry building blocks, shared by the set route
 * (GET /sets/:setId/massentry), the deck routes (GET /decks/:id/massentry,
 * GET /decks/:id/pricing) and — through them — deckpal-mcp.
 *
 * What TCGplayer Mass Entry actually supports for Pokémon
 * (empirically verified 2026-08-16 against the live addtocartandretrieve API;
 * the documented `qty Name [CODE] number` grammar works for MTG but NOT for
 * Pokémon — see issue #37):
 *
 *   - URL:  https://www.tcgplayer.com/massentry?productline=Pokemon&c=<lines>
 *     with lines separated by `||` (%7C%7C) and spaces as `+`.
 *
 *   - The name in a line must match TCGplayer's **product name** exactly:
 *       • Most sets (all pre-SV + most SV):  product name = card name only.
 *         Line format: `<qty> <name> [CODE]`
 *         Example:     `1 Boltund V [SWSH08]`
 *       • Some SV-era sets (see NUMBERED_GROUP_IDS): product name includes the
 *         zero-padded collector number and set total.
 *         Line format: `<qty> <name> - <NNN>/<TTT> [CODE]`
 *         Example:     `1 Pikachu - 025/165 [MEW]`
 *
 *     Appending a bare collector number *after* the set code (the format MTG
 *     uses) always fails for Pokémon — TCGplayer treats it as part of the
 *     product-name lookup and finds nothing.
 *
 *   - NOT supported per line or per URL: printing (normal/foil/reverse) and
 *     condition (NM/LP/…) — both are chosen in the Mass Entry page's own
 *     preferences panel after the list is parsed. We therefore never encode them.
 *   - Long URLs 414 — the `c` payload is chunked (~1800 encoded chars) into an
 *     ordered list of URLs; opening each adds to the same cart.
 */

const MASSENTRY_BASE = 'https://www.tcgplayer.com/massentry?productline=Pokemon&c=';
/** Max encoded chars for one URL's `c` payload — well under common 414 limits. */
const MAX_C_CHARS = 1800;

/** The printing/condition caveat every Mass Entry response carries. */
export const MASSENTRY_NOTE =
  'Printing (normal/foil/reverse) and condition (NM/LP/…) cannot be preselected by link — ' +
  "choose them in the preferences panel on TCGplayer's Mass Entry page.";

// ── TCGplayer set abbreviations ───────────────────────────────────────────────
// The catalog stores card_set.tcgplayer_group_id but not the group's
// abbreviation (the Mass Entry set-code vocabulary). TCGCSV's groups endpoint
// (already our price feed upstream) carries it; fetched lazily, cached
// in-process for 24h, 5-minute negative cache, and every failure degrades to
// bare-name lines rather than an error.
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

// ── Numbered-product-name sets ────────────────────────────────────────────────
// Some TCGplayer Pokémon sets include the collector number in the product name
// (e.g. "Pikachu - 025/165") while most use the bare card name ("Pikachu").
// Mass Entry matches by product name, so lines for numbered sets must include
// the number as part of the name.  This set was determined empirically
// (2026-08-16) and must be extended when TCGplayer names a new set's products
// with collector numbers.  To test a new set: try both `1 <card> [CODE]` and
// `1 <card> - <NNN>/<TTT> [CODE]` on https://www.tcgplayer.com/massentry —
// whichever returns SUCCESS is the format for that group.
const NUMBERED_GROUP_IDS: ReadonlySet<number> = new Set([
  23237,  // SV: Scarlet & Violet 151 (MEW)
  23353,  // SV: Paldean Fates (PAF)
  23651,  // SV08: Surging Sparks (SSP)
]);

/** True when TCGplayer's product names for this set include the collector number. */
export function isNumberedSet(groupId: number | null): boolean {
  return groupId !== null && NUMBERED_GROUP_IDS.has(groupId);
}

// ── Line + URL builders ───────────────────────────────────────────────────────

/** Zero-pad a numeric localId to 3 digits ("6" → "006", "25" → "025"). */
function padLocalId(localId: string): string {
  return /^\d+$/.test(localId) ? localId.padStart(3, '0') : localId;
}

/**
 * One Mass Entry line.
 *
 * Priority: stored per-variant token → composed line → bare name.
 *
 * `setCardCount` is required for numbered sets (product name includes the
 * collector number, e.g. "Pikachu - 025/165") — pass `card_set.card_count_official`.
 * For un-numbered sets it is ignored.
 */
export function meLine(
  qty: number,
  name: string,
  token: string | null,
  setCode: string | null,
  localId: string,
  groupId?: number | null,
  setCardCount?: number | null,
): string {
  if (token) return `${qty}${token.replace(/^\d+/, '')}`;
  if (setCode) {
    if (isNumberedSet(groupId ?? null) && setCardCount) {
      // Numbered sets: product name = "Name - NNN/TTT"
      const num = padLocalId(localId);
      const total = String(setCardCount).padStart(3, '0');
      return `${qty} ${name} - ${num}/${total} [${setCode}]`;
    }
    // Default: bare name + set code (works for pre-SV and most SV sets)
    return `${qty} ${name} [${setCode}]`;
  }
  return `${qty} ${name}`; // no set code available — matches any printing/set
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
