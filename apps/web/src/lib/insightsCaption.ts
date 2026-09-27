// Pure helper for Insights.tsx's value-over-time chart (issue #26: "Data doesn't
// change at all with the different time frames").
//
// Root cause (verified against the live DB, see DECISIONS.md): the range chips
// (30d/3m/6m/1y) and the backend filter (`collectionValue.ts` valueSeries()) are
// both correct — the bug is that most accounts have far less recorded history
// than even the shortest range implies, so every range resolves to the exact
// same handful of points and renders an identical-looking chart. The 0-point and
// 1-point cases already get an honest cold-start message in Insights.tsx ("No
// value snapshots recorded yet" / "Only one daily snapshot exists so far"); this
// fills the gap for the >=2-point case, which previously rendered a real chart
// with no explanation that it doesn't actually span the selected window.
//
// `rangeCoverageCaption` answers one question: does the recorded history reach
// back to the nominal start of the selected range? If not, say so instead of
// silently rendering the same-looking chart under four different button labels.

export type ValueRangeKey = '30d' | '3m' | '6m' | '1y' | '18m' | '2y'

export interface DatedPoint {
  date: string // YYYY-MM-DD
}

/**
 * Every range Insights.tsx offers, with its display label — the single source
 * for both the range chips and any other copy that names the selected range
 * (e.g. the delta card's heading). UXC-07: that heading used to hardcode
 * "Last 30 Days" regardless of which chip was active, because the label lived
 * as a literal string in the JSX instead of being read from the same list the
 * chips render from. Kept here, next to `ValueRangeKey`, rather than in
 * Insights.tsx, so it's covered by this file's pure unit tests.
 */
export const VALUE_RANGES: { key: ValueRangeKey; label: string }[] = [
  { key: '30d', label: '30 Days' },
  { key: '3m', label: '3 Months' },
  { key: '6m', label: '6 Months' },
  { key: '1y', label: '1 Year' },
  { key: '18m', label: '18 Months' },
  { key: '2y', label: '2 Years' },
]

/** Display label for a range key, e.g. for "{label} Change" headings. */
export function rangeLabel(range: ValueRangeKey): string {
  return VALUE_RANGES.find((r) => r.key === range)?.label ?? range
}

/**
 * YYYY-MM-DD for the VIEWER'S LOCAL calendar day (QUAL-07 — see the note below
 * on why this deliberately does not match the server).
 *
 * `d.toISOString().slice(0, 10)` reads `d`'s UTC calendar day, which runs up to
 * a full day ahead of the viewer's own clock for anyone west of UTC (worst
 * case: a US evening, where it's already tomorrow in UTC). That made the
 * chart's rightmost axis tick — built from `isoDate(new Date())` — show
 * tomorrow's date for roughly the back half of every local day. Build the
 * string from the Date's own local fields instead, the same "when did this
 * happen here" rule fmtDate/fmtCalendarDate (lib/format.ts) already apply to
 * timestamps.
 */
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * The nominal start of a range's window, anchored to the viewer's LOCAL
 * calendar day (see `isoDate` above) and offset by calendar months/years —
 * not a fixed day count — so a span like "3 months" reads the way a person
 * means it.
 *
 * This intentionally does NOT reuse the backend's own anchor.
 * `collection_value_point.observed_on` (what `points[].date` is read from) is
 * a UTC calendar day: the daily snapshot cron runs once, on a fixed UTC clock,
 * and stamps every account with the same global day regardless of where its
 * owner lives (Supabase and GitHub Actions both run `timezone = UTC` —
 * DECISIONS.md). That is the right anchor for a once-a-day, all-accounts
 * write. It is the wrong anchor for a chart AXIS a human is looking at right
 * now: "today" on the rightmost tick should read as today wherever the viewer
 * is sitting, not wherever the cron's clock is. Two coherent, deliberately
 * different definitions — storage keys off the cron's UTC day, the window
 * boundary keys off the viewer's local day — so this can disagree with the
 * server's own `CURRENT_DATE`-based window filter by up to a day at the
 * edges. That's immaterial: the chart only ever plots points that exist in
 * `points` (no interpolation), so a boundary that's a day "wider" than the
 * server's own filter just means the widest possible request, never a wrong
 * one — matching the calendar-month/year slop this function already accepts
 * (agrees with Postgres's `interval '3 months'` etc. to within a day at
 * month-length edge cases).
 */
export function rangeWindowStart(range: ValueRangeKey, from: Date): Date {
  const d = new Date(from.getTime())
  switch (range) {
    case '30d':
      d.setDate(d.getDate() - 30)
      break
    case '3m':
      d.setMonth(d.getMonth() - 3)
      break
    case '6m':
      d.setMonth(d.getMonth() - 6)
      break
    case '1y':
      d.setFullYear(d.getFullYear() - 1)
      break
    case '18m':
      d.setMonth(d.getMonth() - 18)
      break
    case '2y':
      d.setFullYear(d.getFullYear() - 2)
      break
  }
  return d
}

/**
 * Honest caption for the chart, or `null` when there's nothing to caveat.
 *
 * `null` cases:
 *  - Fewer than 2 points: the dedicated 0-point / 1-point cold-start states in
 *    Insights.tsx already explain those; this function only speaks for the
 *    "chart is real but short" case.
 *  - The earliest recorded point already reaches back to (or past) the range's
 *    nominal window start: the selected range is genuinely fully populated, so
 *    there's nothing dishonest about it.
 *
 * `points` must be sorted ascending by date (as the API returns them) — only
 * the first entry is read.
 */
export function rangeCoverageCaption(
  points: readonly DatedPoint[],
  range: ValueRangeKey,
  today: Date = new Date(),
): string | null {
  if (points.length < 2) return null
  const first = points[0]!.date
  const windowStart = isoDate(rangeWindowStart(range, today))
  if (first <= windowStart) return null
  return `Showing all ${points.length} days of recorded history (started ${first}).`
}

/**
 * The full window a range names, as ISO dates — the chart's x-axis DOMAIN.
 *
 * The axis used to be derived from the data, which made every range chip draw
 * an identical picture whenever recorded history was shorter than the window:
 * ten days of readings stretched edge-to-edge under a label saying "2 Years".
 * The caption explained it, but the picture still lied.
 *
 * Handing the chart the window instead means "2 Years" draws two years of axis
 * with the line occupying only the part that exists — which shows how much
 * history there is, rather than describing it underneath a chart that disagrees.
 */
export function rangeWindow(range: ValueRangeKey, now: Date = new Date()): { from: string; to: string } {
  return { from: isoDate(rangeWindowStart(range, now)), to: isoDate(now) }
}
