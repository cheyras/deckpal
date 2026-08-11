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

export type ValueRangeKey = '30d' | '3m' | '6m' | '1y'

export interface DatedPoint {
  date: string // YYYY-MM-DD
}

/** YYYY-MM-DD in UTC, matching the `to_char(observed_on, 'YYYY-MM-DD')` shape the API returns. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * The nominal start of a range's window, mirroring the backend's
 * `CURRENT_DATE - interval` filter (collectionValue.ts RANGE_INTERVAL) closely
 * enough for a UI caption — exact calendar-month/year semantics, not a fixed day
 * count, so this agrees with Postgres's `interval '3 months'` etc. to within a
 * day at month-length edge cases, which is immaterial here.
 */
function rangeWindowStart(range: ValueRangeKey, from: Date): Date {
  const d = new Date(from.getTime())
  switch (range) {
    case '30d':
      d.setUTCDate(d.getUTCDate() - 30)
      break
    case '3m':
      d.setUTCMonth(d.getUTCMonth() - 3)
      break
    case '6m':
      d.setUTCMonth(d.getUTCMonth() - 6)
      break
    case '1y':
      d.setUTCFullYear(d.getUTCFullYear() - 1)
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
