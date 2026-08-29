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

/** One line. `color` is any CSS colour; the caller owns the palette. */
export interface ChartSeries {
  label: string
  color: string
  points: readonly { date: string; value: number }[]
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return m && d ? `${Number(m)}/${Number(d)}` : iso
}

/** Days since epoch — the x scale's unit. */
function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)
}

export function ValueChart({
  points,
  series,
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
  const values = all.map((p) => p.value)
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
  const xMin = days.length ? Math.min(...days) : 0
  const xMax = days.length ? Math.max(...days) : 0
  const xRange = xMax - xMin || 1

  // Centre when there is nothing to spread across — one point, or several
  // series that all report on the SAME day (the state the cloud tier passes
  // through after its first archive day). Keyed on the date span rather than
  // the point count, or multi-series same-day data pins every marker to the
  // left edge.
  const x = (iso: string): number =>
    xMax === xMin ? padL + plotW / 2 : padL + ((dayNumber(iso) - xMin) / xRange) * plotW
  const y = (v: number): number => padT + (1 - (v - yMin) / yRange) * plotH

  const pathFor = (l: ChartSeries): string =>
    l.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.date)} ${y(p.value)}`).join(' ')

  const single = lines.length === 1
  const areaPath =
    single && lines[0]!.points.length >= 2
      ? `${pathFor(lines[0]!)} L ${x(lines[0]!.points[lines[0]!.points.length - 1]!.date)} ${padT + plotH} L ${x(lines[0]!.points[0]!.date)} ${padT + plotH} Z`
      : ''

  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + (yRange * i) / ticks)

  // Every distinct date across every series, for the x labels and hit-testing.
  const dates = [...new Set(all.map((p) => p.date))].sort()

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
        {lines.map((l) =>
          l.points.map((p) => (
            <circle
              key={`${l.label}-${p.date}`}
              cx={x(p.date)}
              cy={y(p.value)}
              r={hover === p.date ? 5 : all.length === 1 ? 5 : 3}
              fill={l.color}
              stroke="var(--color-surface-primary)"
              strokeWidth={2}
            />
          )),
        )}

        {/* x labels (thinned to ~6 across) */}
        {dates.map((d, i) => {
          const stepEvery = Math.max(1, Math.ceil(dates.length / 6))
          if (dates.length > 1 && i % stepEvery !== 0 && i !== dates.length - 1) return null
          return (
            <text
              key={`x${d}`}
              x={x(d)}
              y={H - 8}
              textAnchor="middle"
              fill="var(--color-text-muted)"
              fontSize={10}
            >
              {shortDate(d)}
            </text>
          )
        })}

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
          <div className="text-text-muted">{shortDate(hover)}</div>
        </div>
      )}
    </div>
  )
}
