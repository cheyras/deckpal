import { useLayoutEffect, useRef, useState } from 'react'
import { fmtMoney } from '../lib/format'

// Hand-rolled SVG line chart (wiki: Frontend-Research §6: recharts REJECTED for bundle size).
// Zero charting dependency — a linear scale computed by hand is more than enough
// for a value series, and it degrades honestly at the cold start:
// with <2 points there is no trend to draw, so we render the single reading as a
// lone marker on a flat baseline and let the caller show the "not enough history"
// copy. We NEVER interpolate or pad the axis (matches pkmn.gg — pkmn.gg captures §14.4).
//
// ── One chart, two callers ─────────────────────────────────────────────────
// Insights draws ONE series (collection value). The card modal's Price tab draws
// one per PRINTING, because "what is this card worth" has a different answer for
// the Normal and the Reverse Holofoil and showing one number for both is the
// same conflation the `+N Variants` badge was making. Rather than fork a second
// chart, `series` is the general shape and `points` is the one-series shorthand.
//
// ── The band ───────────────────────────────────────────────────────────────
// A point may carry `low`/`high` as well as `value`. That is how price history
// past its daily window arrives: since the retention tiers landed (migration
// 048) an old point is a WEEK or a MONTH summarised as OHLC, and drawing only
// its close would state a single price for a period that moved — 46.8% of real
// weekly buckets close at or near an extreme of their own range, so the close
// alone misleads the reader almost half the time.
//
// Daily points carry a band too, of zero height. That is deliberate: the band
// is then ONE continuous polygon per series that simply narrows to the line
// where the data is daily, instead of a special case at the seam.

/** One line. `color` is any CSS colour; the caller owns the palette. */
export interface ChartSeries {
  label: string
  color: string
  points: readonly {
    date: string
    value: number
    /** Low/high of the period this point summarises. Omit for a plain series. */
    low?: number
    high?: number
    /** Extra tooltip line — the caller's words, e.g. where the extremes fell. */
    note?: string
  }[]
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return m && d ? `${Number(m)}/${Number(d)}` : iso
}

/**
 * Axis label for a tick, at a scale that stays unambiguous.
 *
 * `8/29` repeated across a two-year axis says nothing about WHICH August. Past
 * roughly six months the day stops mattering and the year starts to, so the
 * label becomes month + 2-digit year.
 */
function axisLabel(iso: string, spanDays: number): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  if (spanDays > 180) return `${Number(m)}/${y.slice(2)}`
  return `${Number(m)}/${Number(d)}`
}

/** `n` evenly spaced day-numbers across [a, b], inclusive of both ends. */
function spread(a: number, b: number, n: number): number[] {
  if (b <= a) return [a]
  const step = (b - a) / (n - 1)
  return Array.from({ length: n }, (_, i) => Math.round(a + step * i))
}

function isoOfDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

/** Days since epoch — the x scale's unit. */
function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
}

export function ValueChart({
  points,
  series,
  domain,
  currency,
  height = 240,
}: {
  /**
   * One-series shorthand. Ignored when `series` is given.
   *
   * Typed by what this component READS, not by `ValuePoint` — it never touches
   * `valueMinor`, and demanding it would force every caller with a plain
   * date/value series (the price history) to invent one.
   */
  points?: readonly { date: string; value: number }[]
  series?: readonly ChartSeries[]
  /**
   * The x-axis window, as ISO dates. Without it the axis fits the DATA, which
   * makes every range chip draw the same picture when recorded history is
   * shorter than the window — ten days stretched edge-to-edge under a label
   * saying "2 Years". With it, the axis is the window the reader chose and the
   * line occupies only the part that exists, so the gap IS the message.
   *
   * The data extent is unioned in, so a point outside the window is never
   * clipped silently.
   */
  domain?: { from: string; to: string }
  currency: string
  height?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<string | null>(null)

  // ── WHY THE WIDTH IS MEASURED RATHER THAN FIXED ────────────────────────────
  //
  // This used to be `viewBox="0 0 640 H"` with `width="100%"` and
  // `preserveAspectRatio="none"`, which is a non-uniform scale: at a 1300px
  // container the x-axis is stretched 2.03x while y is left at 1x. Every glyph
  // came out elongated and every `<circle>` rendered as an ellipse. The tell,
  // spotted in the 2026-08-29 walkthrough, was that the hover tooltip looked
  // fine while everything else did not — the tooltip is an HTML div outside the
  // SVG, so it was the one element the transform never touched.
  //
  // Measuring the container and using those pixels as the viewBox makes the
  // mapping 1:1, so `preserveAspectRatio` has nothing left to do. 640 is kept
  // only as the pre-measure value for the first paint.
  const [measured, setMeasured] = useState(0)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setMeasured(e.contentRect.width))
    ro.observe(el)
    setMeasured(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const lines: ChartSeries[] =
    series && series.length
      ? [...series]
      : [{ label: 'Your Collection', color: 'var(--color-action-primary)', points: points ?? [] }]

  const W = Math.max(320, Math.round(measured) || 640)
  const H = height
  const padL = 64
  const padR = 16
  const padT = 16
  const padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const all = lines.flatMap((l) => l.points)
  // The band, not just the line, decides the axis: an axis fitted to the closes
  // would clip the very highs and lows the band exists to show.
  const values = all.flatMap((p) => [p.value, ...(p.low != null ? [p.low] : []), ...(p.high != null ? [p.high] : [])])
  const rawMin = values.length ? Math.min(...values) : 0
  const rawMax = values.length ? Math.max(...values) : 0
  // Pad the value axis so a flat/near-flat series isn't a hairline on the floor.
  //
  // The flat-series pad used to floor at 1 CURRENCY UNIT, which is sized for a
  // collection total and absurd for a single card: a bulk common flat at $0.08
  // got an axis from -$0.92 to $1.08 — negative price labels, and the line
  // floating meaninglessly in the middle. Proportional first, with an absolute
  // floor small enough not to swamp a ten-cent card.
  const span = rawMax - rawMin
  const pad = span > 0 ? span * 0.15 : Math.max(Math.abs(rawMax) * 0.05, 0.01)
  // Money does not go below zero, so neither does the axis. A series that is
  // genuinely near zero should sit near the floor of the chart — that IS the
  // information — rather than be centred over an impossible negative gridline.
  const yMin = Math.max(0, rawMin - pad)
  const yMax = rawMax + pad
  const yRange = yMax - yMin || 1

  // ── THE X AXIS IS TIME, NOT POSITION ───────────────────────────────────────
  //
  // It used to be the point's INDEX. That is indistinguishable from a date scale
  // while readings are daily and unbroken, and wrong the moment they are not:
  // the three-week ingest outage in August 2026 rendered as a single step of the
  // same width as a one-day move, which is a chart quietly reporting that
  // nothing happened for twenty days. It also cannot place two series whose
  // observation dates differ, which is every card with more than one printing.
  const days = all.map((p) => dayNumber(p.date))
  const dataMin = days.length ? Math.min(...days) : 0
  const dataMax = days.length ? Math.max(...days) : 0
  // Union, not replacement: the caller's window governs, but a reading outside
  // it still has to be drawable rather than silently clipped.
  const xMin = domain ? Math.min(dayNumber(domain.from), days.length ? dataMin : Infinity) : dataMin
  const xMax = domain ? Math.max(dayNumber(domain.to), days.length ? dataMax : -Infinity) : dataMax
  const xRange = xMax - xMin || 1

  // Centre when there is nothing to spread across — one point, or several
  // series that all report on the SAME day (the state the cloud tier passes
  // through after its first archive day). Keyed on the date span rather than
  // the point count, or multi-series same-day data pins every marker to the
  // left edge.
  const x = (iso: string): number =>
    xMax === xMin ? padL + plotW / 2 : padL + ((dayNumber(iso) - xMin) / xRange) * plotW
  // With a window far wider than the data, a single reading is one dot in a lot
  // of empty axis. That is the honest picture, so it is drawn rather than
  // special-cased away.
  const y = (v: number): number => padT + (1 - (v - yMin) / yRange) * plotH

  const pathFor = (l: ChartSeries): string =>
    l.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.date)} ${y(p.value)}`).join(' ')

  // A closed polygon: the highs left-to-right, then the lows back again.
  const bandFor = (l: ChartSeries): string => {
    const b = l.points.filter((p) => p.low != null && p.high != null)
    if (b.length < 2 || !b.some((p) => p.high! > p.low!)) return ''
    const top = b.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.date)} ${y(p.high!)}`).join(' ')
    const bottom = [...b].reverse().map((p) => `L ${x(p.date)} ${y(p.low!)}`).join(' ')
    return `${top} ${bottom} Z`
  }
  const bands = lines.map((l) => ({ l, d: bandFor(l) })).filter((b) => b.d)

  const single = lines.length === 1
  // The gradient area is a single-series flourish and reads as a second band
  // when there is a real one underneath it. The band wins: it means something.
  const areaPath =
    single && !bands.length && lines[0]!.points.length >= 2
      ? `${pathFor(lines[0]!)} L ${x(lines[0]!.points[lines[0]!.points.length - 1]!.date)} ${padT + plotH} L ${x(lines[0]!.points[0]!.date)} ${padT + plotH} Z`
      : ''

  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + (yRange * i) / ticks)

  // Hit-testing uses the DATA's dates — only a real reading can be hovered.
  const dates = [...new Set(all.map((p) => p.date))].sort()

  // Axis ticks are a different question from hit-testing. With an explicit
  // window they must span the WINDOW (otherwise a 2-year axis is labelled with
  // six dates from one week in August); without one they thin the data dates as
  // before.
  const tickDates = domain
    ? spread(xMin, xMax, 6).map(isoOfDay)
    : dates.filter((_, i) => {
        const stepEvery = Math.max(1, Math.ceil(dates.length / 6))
        return dates.length <= 1 || i % stepEvery === 0 || i === dates.length - 1
      })

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (dates.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    let best = dates[0]!
    let bestD = Infinity
    for (const d of dates) {
      const dist = Math.abs(x(d) - px)
      if (dist < bestD) {
        bestD = dist
        best = d
      }
    }
    setHover(best)
  }

  // What each series was worth on the hovered date, skipping series with no
  // reading that day rather than interpolating one.
  const readings = hover
    ? lines
        .map((l) => ({ line: l, point: l.points.find((p) => p.date === hover) }))
        .filter((r) => r.point !== undefined)
    : []

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={single ? 'Value over time' : 'Market price over time, by printing'}
      >
        <defs>
          <linearGradient id="valArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-action-primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-action-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* gridlines + y labels */}
        {yTicks.map((t, i) => {
          const yy = y(t)
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={W - padR}
                y1={yy}
                y2={yy}
                stroke="var(--color-divider-subtle)"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <text
                x={padL - 8}
                y={yy + 3}
                textAnchor="end"
                fill="var(--color-text-muted)"
                fontSize={10}
              >
                {fmtMoney(t, currency, 2)}
              </text>
            </g>
          )
        })}

        {/* The filled area is a single-series flourish. With several printings
            on one chart, overlapping translucent fills read as a third colour
            that means nothing. */}
        {areaPath && <path d={areaPath} fill="url(#valArea)" />}

        {/* Bands sit UNDER the lines: the close is the reading, the band is the
            context it sat in. Low opacity so two printings' bands overlapping
            stay readable as two bands rather than a third colour. */}
        {bands.map(({ l, d }) => (
          <path key={`band-${l.label}`} d={d} fill={l.color} fillOpacity={0.16} stroke="none" />
        ))}

        {lines.map((l) =>
          l.points.length >= 2 ? (
            <path
              key={`line-${l.label}`}
              d={pathFor(l)}
              fill="none"
              stroke={l.color}
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
          ) : null,
        )}

        {/* markers */}
        {/* Markers only where they can be read. A two-year range at weekly
            grain is ~100 points per printing, and a dot on every one over a
            band is a solid bar. Thinned ONLY for banded series: a plain series
            (the Insights value chart) keeps every marker it has always had.  */}
        {lines.map((l) =>
          l.points.map((p) =>
            hover === p.date || !bands.length || all.length <= 60 ? (
              <circle
                key={`${l.label}-${p.date}`}
                cx={x(p.date)}
                cy={y(p.value)}
                r={hover === p.date ? 5 : all.length === 1 ? 5 : 3}
                fill={l.color}
                stroke="var(--color-surface-primary)"
                strokeWidth={2}
              />
            ) : null,
          ),
        )}

        {/* x labels — ~6 across the window (or across the data, with no window) */}
        {tickDates.map((d, i) => (
          <text
            key={`x${d}-${i}`}
            x={x(d)}
            y={H - 8}
            // The first and last ticks sit ON the plot edges; centring them
            // there pushes half the glyph outside the viewBox and it clips.
            textAnchor={i === 0 ? 'start' : i === tickDates.length - 1 ? 'end' : 'middle'}
            fill="var(--color-text-muted)"
            fontSize={10}
          >
            {axisLabel(d, xRange)}
          </text>
        ))}

        {hover && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padT}
            y2={padT + plotH}
            stroke="var(--color-action-primary)"
            strokeWidth={1}
            strokeOpacity={0.4}
          />
        )}
      </svg>

      {hover && readings.length > 0 && (
        <div
          className="pointer-events-none absolute z-(--z-popover) -translate-x-1/2 rounded-lg border border-border-default bg-surface-secondary px-[10px] py-[6px] text-[14px] shadow-panel"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            top: 8,
          }}
        >
          {readings.map(({ line, point }) => (
            <div key={line.label} className="flex items-center gap-[6px] whitespace-nowrap">
              <span
                className="inline-block h-[8px] w-[8px] shrink-0 rounded-sm"
                style={{ background: line.color }}
              />
              {!single && <span className="text-text-muted">{line.label}</span>}
              <span className="font-semibold text-text-primary">
                {fmtMoney(point!.value, currency, 2)}
              </span>
            </div>
          ))}
          {/* The caller's note — for price history, WHERE the extremes fell.
              Without it a band invites the reader to imagine the path between
              its edges, which is the one thing a bucket cannot support. */}
          {readings.map(({ line, point }) =>
            point!.note ? (
              <div key={`note-${line.label}`} className="whitespace-nowrap text-text-muted">
                {point!.note}
              </div>
            ) : null,
          )}
          <div className="text-text-muted">{shortDate(hover)}</div>
        </div>
      )}
    </div>
  )
}
