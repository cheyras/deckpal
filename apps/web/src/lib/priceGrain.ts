// Pure helpers for the card modal's Price tab, now that a price series arrives
// at three GRAINS instead of one.
//
// `GET /cards/:id/prices` used to return `{date, value}` and now returns an OHLC
// bucket per point — daily for the last ~30 days, weekly for ~6 months, monthly
// before that (`apps/sync/src/prices/rollup.ts`, migration 048). The reader
// hands every tier over in ONE shape, a day being a degenerate bucket with
// `open = high = low = close` and `n = 1`, so a caller that only wants a line
// reads `close` and never branches.
//
// This module holds the two things that are worth testing without a browser:
// how those points become chart geometry, and how the chart says out loud which
// part of the line is which grain. Runtime-import-free (same rule as
// `insightsCaption.ts`), so `api.ts` can re-export the types from here.

export type PriceGrain = 'day' | 'week' | 'month'

/**
 * One point of price history.
 *
 * The extremes are the part worth being careful about: `highOn` and `lowOn` are
 * TRUE DAILY FACTS that survive the rollup, so they are the only day-level
 * claims a bucket licenses. Everything between them is genuinely gone — see the
 * contract in the endpoint's JSDoc (`apps/api/src/routes/cards.ts`).
 */
export interface PriceHistoryPoint {
  grain: PriceGrain
  /** First day of the bucket. Equal to `end` for a day point. */
  start: string
  /** Last day of the bucket. */
  end: string
  open: number
  high: number
  low: number
  close: number
  /** The day the high was observed — the EARLIEST such day if it repeated. */
  highOn: string
  lowOn: string
  mean: number
  median: number
  /** Distinct days observed in the bucket. 1 for a day point. */
  n: number
}

/** What `ValueChart` consumes: a close line, plus an optional high-low band. */
export interface ChartPoint {
  date: string
  value: number
  low?: number
  high?: number
}

/**
 * Bucket points → chart geometry.
 *
 * The x is the bucket's END, not its start. A bucket's `close` is the value AT
 * its end, so pairing them is the honest placement; it also makes the daily
 * tail continuous, since a day point's start and end are the same date. The
 * high and low did happen somewhere INSIDE the bucket rather than at its end —
 * which is exactly why `highOn`/`lowOn` are carried into the tooltip instead of
 * being implied by the band's position.
 *
 * Day points get a band too, of zero height (low = high = close), so the band
 * polygon is one continuous shape that simply narrows to the line where the
 * data is daily. That is cheaper than splitting the series into runs, and it
 * renders the seam correctly for free.
 */
export function chartPoints(points: readonly PriceHistoryPoint[]): ChartPoint[] {
  return points.map((p) => ({ date: p.end, value: p.close, low: p.low, high: p.high }))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-07-30` → `Jul 30`. Fixed table rather than Intl: no locale drift, and
 *  the caption has to line up with the axis labels, which are also hand-rolled. */
export function shortDay(iso: string): string {
  const [, m, d] = iso.split('-')
  const mi = Number(m) - 1
  return MONTHS[mi] && d ? `${MONTHS[mi]} ${Number(d)}` : iso
}

/** `2026-02-23` → `Feb`. */
export function shortMonth(iso: string): string {
  const mi = Number(iso.split('-')[1]) - 1
  return MONTHS[mi] ?? iso
}

/**
 * "daily since Jul 30 · weekly to Feb · monthly before", or `null`.
 *
 * `null` when there is nothing to explain — a series that is entirely one grain
 * is just a chart, and captioning it "daily since Jul 30" would imply history
 * exists before that date at a coarser grain when it does not.
 *
 * Written newest-first because that is the direction a reader scans a price
 * chart from: today is the part they came for, and the caption's job is to say
 * how much detail they lose as their eye travels left.
 */
export function grainCaption(points: readonly PriceHistoryPoint[]): string | null {
  const firstOf = (g: PriceGrain) => points.find((p) => p.grain === g)
  const day = firstOf('day')
  const week = firstOf('week')
  const month = firstOf('month')
  const kinds = [day, week, month].filter(Boolean).length
  if (kinds < 2) return null

  const parts: string[] = []
  if (day) parts.push(`daily since ${shortDay(day.start)}`)
  if (week) parts.push(month ? `weekly to ${shortMonth(week.start)}` : 'weekly before')
  if (month) parts.push('monthly before')
  return parts.join(' · ')
}

/**
 * The tooltip's second line for a bucket, or `null` for a day.
 *
 * Naming the days the extremes fell on is not decoration: it is the difference
 * between what this data supports and what it does not. "$4.00–$6.20" invites
 * the reader to imagine the path between them; "low $4.00 on Feb 12 · high
 * $6.20 on Feb 9" states the two facts that are actually recorded.
 */
export function bucketRangeLabel(
  p: PriceHistoryPoint,
  fmt: (v: number) => string,
): string | null {
  if (p.grain === 'day') return null
  return `low ${fmt(p.low)} ${shortDay(p.lowOn)} · high ${fmt(p.high)} ${shortDay(p.highOn)}`
}

/** How many days a grain covers, for the "n of N days observed" reading. */
export function bucketDayLabel(p: PriceHistoryPoint): string | null {
  if (p.grain === 'day') return null
  return `${p.n} day${p.n === 1 ? '' : 's'} observed`
}
