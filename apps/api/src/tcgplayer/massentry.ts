/**
 * TCGplayer Mass Entry building blocks, shared by the set route
 * (GET /sets/:setId/massentry), the deck routes (GET /decks/:id/massentry,
 * GET /decks/:id/pricing) and — through them — rotom-mcp.
 *
 * What TCGplayer Mass Entry actually supports (research 2026-07-30, TCGplayer
 * help S11 in research/DECK-FORMATS.md §1.9 + live URL checks):
 *   - URL:  https://www.tcgplayer.com/massentry?productline=Pokemon&c=<lines>
 *     with lines separated by `||` (%7C%7C) and spaces as `+`.
 *   - Line: `<qty> <name> [<SETCODE>] <number>` — set code is TCGplayer's own
 *     abbreviation vocabulary (e.g. PBL for "ME05: Pitch Black"), number is the
 *     collector number without leading zeros.
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
    headers: { 'User-Agent': 'deckscout/1.0 (+cheyras@gmail.com)', Accept: 'application/json' },
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
      console.error('[deckscout-api] tcgcsv abbreviation fetch failed:', (err as Error).message);
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

/** Collector number as Mass Entry expects it: leading zeros stripped ("013" → "13"). */
export function meNumber(localId: string): string {
  return /^\d+$/.test(localId) ? String(Number(localId)) : localId;
}

/** One Mass Entry line. A stored per-variant token wins (re-quantified); else composed. */
export function meLine(qty: number, name: string, token: string | null, setCode: string | null, localId: string): string {
  if (token) return `${qty}${token.replace(/^\d+/, '')}`;
  if (setCode) return `${qty} ${name} [${setCode}] ${meNumber(localId)}`;
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
