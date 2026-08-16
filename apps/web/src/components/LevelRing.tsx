import type { ReactNode } from 'react'

// The segmented Trainer-Level ring (pkmn.gg captures §13): CARDS_PER_LEVEL=10 arcs,
// gold for the cards already held toward the next level (`intoLevel`), dark for
// the remainder. A subtle white cap marks the current position. Center holds the
// avatar; the level badge sits at the lower edge. Purely presentational — the
// numbers come straight from the insights backend, never recomputed here.
const SEGMENTS = 10
const GAP_DEG = 6 // gap between arcs, in degrees

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, startDeg)
  const [x2, y2] = polar(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

export function LevelRing({
  level,
  intoLevel,
  size = 96,
  stroke = 6,
  children,
  showBadge = true,
}: {
  level: number
  intoLevel: number
  size?: number
  stroke?: number
  children?: ReactNode
  showBadge?: boolean
}) {
  const cx = size / 2
  const cy = size / 2
  const r = (size - stroke) / 2 - 1
  const per = 360 / SEGMENTS
  const filled = Math.max(0, Math.min(SEGMENTS, intoLevel))

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        {Array.from({ length: SEGMENTS }).map((_, i) => {
          const start = i * per + GAP_DEG / 2
          const end = (i + 1) * per - GAP_DEG / 2
          const on = i < filled
          return (
            <path
              key={i}
              d={arcPath(cx, cy, r, start, end)}
              fill="none"
              strokeLinecap="round"
              strokeWidth={stroke}
              stroke={on ? 'var(--color-action-primary)' : 'var(--color-surface-tertiary)'}
            />
          )
        })}
      </svg>
      {/* Avatar disc inside the ring */}
      {/* `position` is set inline, not by the `absolute` utility, because the
          premium skin has an unlayered sheen rule on `.bg-surface-tertiary
          .rounded-full` that forces `position: relative` — and unlayered CSS
          beats @layer utilities whatever the specificity. Inline wins over
          both. Without it the disc offsets by `inset` instead of filling. */}
      <div
        className="absolute overflow-hidden rounded-full bg-surface-tertiary"
        style={{ position: 'absolute', inset: stroke + 4 }}
      >
        {children}
      </div>
      {showBadge && (
        <span
          className="absolute left-1/2 -translate-x-1/2 rounded-full bg-action-primary px-[8px] py-[1px] text-[12px] font-extrabold leading-[15px] text-action-primary-text shadow-panel"
          style={{ bottom: -6 }}
        >
          {level}
        </span>
      )}
    </div>
  )
}
