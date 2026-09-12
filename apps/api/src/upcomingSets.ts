/**
 * UPCOMING SETS — announced expansions that upstream has not published yet.
 *
 * A set reaches the catalog through one path only: TCGdex compiled JSON, pulled
 * by `scripts/refresh-catalog.sh` and written by `apps/sync/src/catalog/import.ts`
 * (which is also what fills `tcgplayer_group_id`, `logo_url` and `symbol_url`).
 * TCGdex publishes a set at or after its street date, so for the days between an
 * announcement and the refresh that picks it up, a set that every collector knows
 * is coming is simply absent from the series page.
 *
 * This table is the acknowledgement. Each entry renders as ONE non-clickable row
 * in the series list, badged "Coming Soon" — the set is visible and dated, and
 * there is nothing to click into because there is nothing behind it yet.
 *
 * ── WHY THIS IS NOT A CATALOG ROW ────────────────────────────────────────────
 *
 * The obvious implementation — insert `card_set` with zero cards — does not
 * work, and should not be made to. `routes/series.ts` ends its set query with
 * `HAVING count(c.id) > 0`, which deliberately hides zero-card sets so catalogue
 * artifacts (`base/wp`, `miscellaneous/jumbo`) do not render empty set pages.
 * Relaxing that guard to admit this one row would bring those back.
 *
 * A speculative catalog row is also a data hazard of its own. The importer's
 * upsert is keyed on `(series_id, tcgdex_id)`, and **the real TCGdex id is not
 * knowable before upstream publishes it** — Celebrations became `cel25`, its
 * subset `cel25cc`, neither derivable from the set's name. Guessing wrong leaves
 * a permanent duplicate set in the production catalog that only a hand-written
 * DELETE removes. `placeholderId` below is therefore deliberately NOT in TCGdex's
 * namespace: it never reaches the database, and it cannot collide with the id
 * upstream eventually chooses.
 *
 * ── HOW AN ENTRY GOES AWAY ───────────────────────────────────────────────────
 *
 * Two independent suppressions, because either one alone fails open:
 *
 *   1. NAME MATCH. Once the catalog holds a set in this series whose name
 *      matches `name` (normalised), the real row exists and the placeholder is
 *      redundant. This is the path that fires in the normal case.
 *   2. `expiresOn`. Upstream may name the set something other than what was
 *      announced, in which case the name match never fires and the row would
 *      claim "Coming Soon" about a set that has been on shelves for a month.
 *      After this date the entry stops being served whatever the catalog says.
 *
 * Neither is a substitute for deleting the entry, which is the actual cleanup —
 * they bound the damage when nobody gets round to it. An expired entry is a
 * no-op, not an error, so a stale table degrades to the pre-existing behaviour.
 */

export interface UpcomingSet {
  /**
   * Identifies the row to the client. NOT a TCGdex id and never written to the
   * database — see the header. Prefixed so it is obvious in a DOM inspector
   * that this is not a catalog identifier.
   */
  placeholderId: string;
  /** `series.slug` this set belongs to. */
  seriesSlug: string;
  /** As announced. Also the key the name-match suppression compares on. */
  name: string;
  /** Street date, ISO `YYYY-MM-DD`. */
  releasedOn: string;
  /** Printed (non-secret) count, when the announcement is specific about it. */
  printedCount: number | null;
  /**
   * Path to the logo, served by `apps/web` out of `public/`. A real set's logo
   * comes from the image tier via `setAssetUrl()`, which 404s for a set the
   * catalog has never heard of — so the placeholder carries its own asset and
   * the client renders a plain <img> rather than <SetLogo>.
   */
  logoAssetPath: string;
  /** Hard stop for serving this entry, ISO `YYYY-MM-DD`. See the header. */
  expiresOn: string;
}

/**
 * The live table. Expected to be EMPTY most of the time — an entry exists only
 * in the window between an announcement and the catalog refresh that lands it.
 *
 * Adding one is three facts and an asset: the series it belongs to, the street
 * date, the logo, and an `expiresOn` far enough out to cover a couple of weekly
 * refreshes but not a quarter.
 */
export const UPCOMING_SETS: readonly UpcomingSet[] = [
  {
    // Mega Evolution, not a series of its own: TCGplayer files both 30th
    // Celebration products under the same `ME:` prefix as ME01-ME06, and the
    // direct precedent is Celebrations — the 25th anniversary set — which
    // TCGdex files as `serie: swsh`, inside Sword & Shield. There is no
    // anniversary series in TCGdex's 21.
    placeholderId: 'upcoming-pokemon-30th-celebration',
    seriesSlug: 'mega-evolution',
    name: '30th Celebration',
    releasedOn: '2026-09-16',
    // 128 printed; TCGCSV's presale listing runs to #158, so there are secrets
    // on top. The printed number is the one that is certain, and the row shows
    // a count rather than a completion bar, so an approximate total would read
    // as a fact it is not.
    printedCount: 128,
    logoAssetPath: '/brand/pokemon-30th-celebration-logo.webp',
    // ~6 weeks: the catalog refresh is weekly (Sunday 04:30, see
    // .github/workflows/catalog-refresh.yml), so this covers six chances for
    // upstream to publish before the row stops being served regardless.
    expiresOn: '2026-10-31',
  },
];

/** Collapse the incidental differences between an announced name and a catalog one. */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The upcoming entries to append to a series' set list.
 *
 * @param seriesSlug   the series being rendered
 * @param existingNames  names of the sets the catalog already returned for it
 * @param today        ISO `YYYY-MM-DD`; injected so this is testable without clocks
 * @param table        injected so the suppression rules can be tested against a
 *                     fixture. `UPCOMING_SETS` is expected to be empty most of
 *                     the year, and rules only exercised when someone happens to
 *                     have announced a set are rules that rot.
 */
export function upcomingSetsFor(
  seriesSlug: string,
  existingNames: readonly string[],
  today: string,
  table: readonly UpcomingSet[] = UPCOMING_SETS,
): UpcomingSet[] {
  const known = new Set(existingNames.map(normaliseName));
  return table.filter(
    (u) =>
      u.seriesSlug === seriesSlug &&
      today <= u.expiresOn &&
      !known.has(normaliseName(u.name)),
  );
}

/** `YYYY-MM-DD` for the current UTC day. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The API shape of an upcoming-set placeholder row. Mirrors the catalog-set
 * summary from `routes/series.ts` minus `progress` (there is nothing to
 * complete yet) and plus `upcoming`/`logoAssetPath`. Exported so the series
 * route and its tests share ONE mapping rather than the tests carrying a copy
 * that can drift.
 */
export interface PlaceholderSetSummary {
  setId: string;
  slug: string;
  name: string;
  releasedOn: string;
  isPromo: boolean;
  printedCount: number;
  secretCount: number;
  cardCountTotal: number;
  logoUrl: null;
  symbolUrl: null;
  upcoming: true;
  logoAssetPath: string;
}

/**
 * Map an `UpcomingSet` to the placeholder API shape. No `progress` key: a 0/0
 * bar would read as "you own none of it" rather than "it does not exist yet"
 * (see the series-route comment). Pure and dependency-free so the route and the
 * tests call the same function.
 */
export function mapUpcomingPlaceholder(u: UpcomingSet): PlaceholderSetSummary {
  return {
    setId: u.placeholderId,
    slug: u.placeholderId,
    name: u.name,
    releasedOn: u.releasedOn,
    isPromo: false,
    printedCount: u.printedCount ?? 0,
    secretCount: 0,
    cardCountTotal: u.printedCount ?? 0,
    logoUrl: null,
    symbolUrl: null,
    upcoming: true,
    logoAssetPath: u.logoAssetPath,
  };
}

/**
 * The sort the series route applies to the combined catalog + placeholder list.
 * Mirrors the SQL `ORDER BY released_on DESC NULLS LAST, name` kept in step by
 * hand because only one of the two lists comes from the database. Exported so
 * the route and its tests share ONE comparator rather than a copy that drifts.
 */
export function compareSetOrder(
  a: { releasedOn: string | null; name: string },
  b: { releasedOn: string | null; name: string },
): number {
  if (a.releasedOn !== b.releasedOn) {
    if (a.releasedOn === null) return 1;
    if (b.releasedOn === null) return -1;
    return a.releasedOn < b.releasedOn ? 1 : -1;
  }
  return a.name.localeCompare(b.name);
}
