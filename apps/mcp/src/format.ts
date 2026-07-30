/**
 * Output formatting helpers. Context-window discipline is a correctness
 * requirement (SPEC §4): compact one-row-per-line output, never JSON dumps,
 * and every truncated list states the total and how to page.
 */

// Mirrors apps/api/src/db.ts MINOR_UNIT semantics exactly: prices are stored
// as integer minor units; unknown currencies fall back to 2 decimal places.
const MINOR_UNIT: Record<string, number> = { USD: 2, EUR: 2, JPY: 0 };

/** minor int → major-unit number, or null. e.g. (80043,'USD') → 800.43 */
export function toMajor(minor: number | null | undefined, currency: string): number | null {
  if (minor === null || minor === undefined) return null;
  const unit = MINOR_UNIT[currency.trim().toUpperCase()] ?? 2;
  return minor / 10 ** unit;
}

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };

/**
 * Render a minor-unit price for humans: (312,'USD') → "$3.12".
 * NULL means "no price" and renders as "unpriced" — NEVER $0 (SPEC §3).
 */
export function money(minor: number | null | undefined, currency = 'USD'): string {
  const major = toMajor(minor, currency);
  if (major === null) return 'unpriced';
  const cur = currency.trim().toUpperCase();
  const unit = MINOR_UNIT[cur] ?? 2;
  const sym = SYMBOL[cur];
  const rendered = major.toFixed(unit);
  return sym ? `${sym}${rendered}` : `${rendered} ${cur}`;
}

/** One compact row: cells joined with ' | ', null/undefined/'' cells dropped. */
export function row(...cells: ReadonlyArray<string | number | null | undefined>): string {
  return cells
    .filter((c): c is string | number => c !== null && c !== undefined && c !== '')
    .map(String)
    .join(' | ');
}

/** Many compact rows, one per line. */
export function table(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((r) => row(...r)).join('\n');
}

/** Battle record footer: {wins:3, losses:1, ties:0} → "3W–1L–0T". */
export function winLoss(r: { wins: number; losses: number; ties: number }): string {
  return `${r.wins}W–${r.losses}L–${r.ties}T`;
}

/**
 * Paging footer for list-returning tools, e.g.
 * "showing 1–50 of 312 — page 2 for more". States the total on every
 * truncated response (SPEC §4).
 */
export function pagingFooter(page: number, pageSize: number, total: number): string {
  if (total === 0) return 'no results';
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  if (page === 1 && to >= total) return `showing all ${total}`;
  const more = to < total ? ` — page ${page + 1} for more` : '';
  return `showing ${from}–${to} of ${total}${more}`;
}
