import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bucketDayLabel, bucketRangeLabel, chartPoints, grainCaption, shortDay, shortMonth,
  type PriceHistoryPoint,
} from '../priceGrain'

/**
 * The Price tab's grain handling.
 *
 * The chart now draws three tiers as one line, and the failure mode is not a
 * crash: a caption that names the wrong grain, or a band drawn from the wrong
 * pair of numbers, produces a chart that looks entirely plausible and is wrong
 * about what the market did.
 */

const day = (d: string, v: number): PriceHistoryPoint => ({
  grain: 'day', start: d, end: d, open: v, high: v, low: v, close: v,
  highOn: d, lowOn: d, mean: v, median: v, n: 1,
})

const week = (start: string, o: number, h: number, l: number, c: number): PriceHistoryPoint => ({
  grain: 'week', start, end: start.slice(0, 8) + String(Number(start.slice(8)) + 6).padStart(2, '0'),
  open: o, high: h, low: l, close: c, highOn: start, lowOn: start, mean: (h + l) / 2, median: c, n: 7,
})

const month = (start: string, o: number, h: number, l: number, c: number): PriceHistoryPoint => ({
  grain: 'month', start, end: '2026-01-31',
  open: o, high: h, low: l, close: c, highOn: '2026-01-09', lowOn: '2026-01-22',
  mean: (h + l) / 2, median: c, n: 30,
})

// ── Chart geometry ─────────────────────────────────────────────────────────

test('a point is placed at the bucket END, where its close actually happened', () => {
  const [p] = chartPoints([week('2026-02-02', 100, 140, 90, 120)])
  assert.equal(p!.date, '2026-02-08')
  assert.equal(p!.value, 120, 'the line is the CLOSE, not the open or the mean')
})

test('a day point is a degenerate bucket: the band has zero height', () => {
  const [p] = chartPoints([day('2026-08-15', 42)])
  assert.deepEqual(p, { date: '2026-08-15', value: 42, low: 42, high: 42 })
})

test('every point carries a band, so the polygon is continuous across the seam', () => {
  // The alternative — omitting low/high on day points — splits the band into
  // runs and needs a special case exactly where the tiers meet.
  const pts = chartPoints([week('2026-06-01', 1, 3, 1, 2), day('2026-08-15', 5)])
  assert.ok(pts.every((p) => p.low != null && p.high != null))
})

test('the band uses the bucket low and high, never the open and close', () => {
  const [p] = chartPoints([week('2026-02-02', 100, 140, 90, 120)])
  assert.equal(p!.low, 90)
  assert.equal(p!.high, 140)
})

// ── The caption ────────────────────────────────────────────────────────────

test('a mixed series names every grain, newest first', () => {
  const pts = [
    month('2026-01-01', 10, 14, 9, 12),
    week('2026-02-23', 12, 13, 11, 12),
    day('2026-07-30', 12),
  ]
  assert.equal(grainCaption(pts), 'daily since Jul 30 · weekly to Feb · monthly before')
})

test('an all-daily series gets NO caption', () => {
  // Captioning it "daily since Jul 30" would imply coarser history exists
  // before that date. On a young account it does not.
  assert.equal(grainCaption([day('2026-07-30', 1), day('2026-07-31', 2)]), null)
})

test('a series with no monthly tier says "weekly before", not "weekly to"', () => {
  const pts = [week('2026-06-01', 1, 2, 1, 2), day('2026-07-30', 3)]
  assert.equal(grainCaption(pts), 'daily since Jul 30 · weekly before')
})

test('a series of only old buckets still captions the tiers it has', () => {
  const pts = [month('2026-01-01', 1, 2, 1, 2), week('2026-03-02', 1, 2, 1, 2)]
  assert.equal(grainCaption(pts), 'weekly to Mar · monthly before')
})

test('an empty series has nothing to caption', () => {
  assert.equal(grainCaption([]), null)
})

// ── The tooltip's honesty line ─────────────────────────────────────────────

const usd = (v: number) => `$${v.toFixed(2)}`

test('a bucket tooltip names WHERE the extremes fell, not just what they were', () => {
  // The whole point: "$4.00–$6.20" invites the reader to imagine the path
  // between them. highOn/lowOn are the only day-level facts a bucket licenses.
  const p = month('2026-01-01', 5, 6.2, 4, 5.5)
  assert.equal(bucketRangeLabel(p, usd), 'low $4.00 Jan 22 · high $6.20 Jan 9')
})

test('a day point has no range line — it is one reading', () => {
  assert.equal(bucketRangeLabel(day('2026-08-15', 3), usd), null)
  assert.equal(bucketDayLabel(day('2026-08-15', 3)), null)
})

test('a bucket says how many days it actually observed', () => {
  assert.equal(bucketDayLabel(month('2026-01-01', 1, 2, 1, 2)), '30 days observed')
  assert.equal(bucketDayLabel({ ...week('2026-02-02', 1, 2, 1, 2), n: 1 }), '1 day observed')
})

// ── Date formatting ────────────────────────────────────────────────────────

test('dates format without leading zeros and without locale drift', () => {
  assert.equal(shortDay('2026-07-30'), 'Jul 30')
  assert.equal(shortDay('2026-01-05'), 'Jan 5')
  assert.equal(shortMonth('2026-02-23'), 'Feb')
  assert.equal(shortMonth('2026-12-01'), 'Dec')
})
