import { useRef, useState } from 'react'
import type { ValuePoint } from '../lib/api'

// Hand-rolled SVG line chart (wiki: Frontend-Research §6: recharts REJECTED for bundle size).
// Zero charting dependency — a linear scale computed by hand is more than enough
// for a single yellow value series, and it degrades honestly at the cold start:
// with <2 points there is no trend to draw, so we render the single reading as a
// lone marker on a flat baseline and let the caller show the "not enough history"
// copy. We NEVER interpolate or pad the axis (matches pkmn.gg — pkmn.gg captures §14.4).

function money(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(v)
  } catch {
    return `${v} ${currency}`
  }
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return m && d ? `${Number(m)}/${Number(d)}` : iso
}

export function ValueChart({
  points,
  currency,
  height = 240,
}: {
  points: ValuePoint[]
  currency: string
  height?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  // Fixed viewBox; SVG scales to container width. Generous left pad for $ labels.
  const W = 640
  const H = height
  const padL = 64
  const padR = 16
  const padT = 16
  const padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const values = points.map((p) => p.value)
  const rawMin = values.length ? Math.min(...values) : 0
  const rawMax = values.length ? Math.max(...values) : 0
  // Pad the value axis so a flat/near-flat series isn't a hairline on the floor.
  const span = rawMax - rawMin
  const pad = span > 0 ? span * 0.15 : Math.max(rawMax * 0.05, 1)
  const yMin = rawMin - pad
  const yMax = rawMax + pad
  const yRange = yMax - yMin || 1

  const x = (i: number): number =>
    points.length <= 1 ? padL + plotW / 2 : padL + (i / (points.length - 1)) * plotW
  const y = (v: number): number => padT + (1 - (v - yMin) / yRange) * plotH

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ')
  const areaPath =
    points.length >= 2
      ? `${linePath} L ${x(points.length - 1)} ${padT + plotH} L ${x(0)} ${padT + plotH} Z`
      : ''

  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + (yRange * i) / ticks)

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (points.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    let best = 0
    let bestD = Infinity
    points.forEach((_, i) => {
      const d = Math.abs(x(i) - px)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    setHover(best)
  }

  const active = hover != null ? points[hover] : null

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Collection value over time"
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
                {money(t, currency)}
              </text>
            </g>
          )
        })}

        {areaPath && <path d={areaPath} fill="url(#valArea)" />}
        {points.length >= 2 && (
          <path d={linePath} fill="none" stroke="var(--color-action-primary)" strokeWidth={2.5} strokeLinejoin="round" />
        )}

        {/* markers */}
        {points.map((p, i) => (
          <circle
            key={p.date}
            cx={x(i)}
            cy={y(p.value)}
            r={hover === i ? 5 : points.length === 1 ? 5 : 3}
            fill="var(--color-action-primary)"
            stroke="var(--color-surface-primary)"
            strokeWidth={2}
          />
        ))}

        {/* x labels (thinned to ~6 across) */}
        {points.map((p, i) => {
          const stepEvery = Math.max(1, Math.ceil(points.length / 6))
          if (points.length > 1 && i % stepEvery !== 0 && i !== points.length - 1) return null
          return (
            <text
              key={`x${p.date}`}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fill="var(--color-text-muted)"
              fontSize={10}
            >
              {shortDate(p.date)}
            </text>
          )
        })}

        {active && (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={padT}
            y2={padT + plotH}
            stroke="var(--color-action-primary)"
            strokeWidth={1}
            strokeOpacity={0.4}
          />
        )}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute z-(--z-popover) -translate-x-1/2 rounded-lg border border-border-default bg-surface-secondary px-[10px] py-[6px] text-[14px] shadow-panel"
          style={{
            left: `${(x(hover!) / W) * 100}%`,
            top: 8,
          }}
        >
          <div className="flex items-center gap-[6px]">
            <span className="inline-block h-[8px] w-[8px] rounded-sm bg-action-primary" />
            <span className="font-semibold text-text-primary">{money(active.value, currency)}</span>
          </div>
          <div className="text-text-muted">{shortDate(active.date)}</div>
        </div>
      )}
    </div>
  )
}
