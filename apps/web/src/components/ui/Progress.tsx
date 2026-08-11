/**
 * Progress primitives — ProgressBar (linear) and ProgressRing (circular).
 *
 * Both use `--color-track-subtle` for the background track (promoted from the
 * 7 hardcoded #1a1d24 occurrences into theme.css by this same commit).
 *
 * The default fill is derived from action-primary-strong's Tailwind hue via
 * `tailwindGradient` (two hue families back, same shade) rather than paired
 * with an unrelated token — see lib/gradientPalette.ts. Pass a solid `fill`
 * colour to override.
 */
import { tailwindGradient } from '../../lib/gradientPalette'

// ── ProgressBar ──────────────────────────────────────────────────────────

export interface ProgressBarProps {
  /** Percentage (0–100). Clamped internally. */
  pct: number
  /** Track height in pixels. Default 6. */
  height?: number
  /** Fill colour or gradient CSS. Default: the derived two-hue-away gradient (see lib/gradientPalette). */
  fill?: string
  /** Milestone dots at specified percentages (e.g. [25, 50, 75]). */
  milestones?: number[]
  /** Passed pct for each milestone that should render as a star instead of a dot. */
  milestonePassed?: (m: number) => boolean
  className?: string
}

// action-primary-strong is teal-300 (theme.css) — keep this in sync if that
// token's hue family changes.
const DEFAULT_GRADIENT = tailwindGradient('teal', '300')

export function ProgressBar({
  pct,
  height = 6,
  fill = DEFAULT_GRADIENT,
  milestones,
  milestonePassed,
  className,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, pct))
  const hasMilestones = milestones && milestones.length > 0

  return (
    <div
      className={`relative w-full overflow-visible rounded-full bg-track-subtle${className ? ` ${className}` : ''}`}
      style={{ height }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${clamped}%`, background: fill }}
      />
      {hasMilestones &&
        milestones.map((m) => {
          const passed = milestonePassed ? milestonePassed(m) : clamped >= m
          return (
            <span
              key={m}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] leading-none"
              style={{
                left: `${m}%`,
                color: passed
                  ? 'var(--color-action-primary-strong)'
                  : 'var(--color-text-muted)',
              }}
            >
              {passed ? '★' : '●'}
            </span>
          )
        })}
    </div>
  )
}

// ── ProgressRing ─────────────────────────────────────────────────────────

export interface ProgressRingProps {
  /** Percentage (0–100). Clamped internally. */
  pct: number
  /** Outer diameter in pixels. Default 56. */
  size?: number
  /** Ring thickness in pixels. Default 5. */
  stroke?: number
  /** SVG gradient id for the fill stroke. The gradient def must exist in
   *  a parent SVG or the page (see SeriesIndex's shared def). Alternatively
   *  pass `fillColor` for a solid stroke. */
  gradientId?: string
  /** Solid stroke colour. Ignored if `gradientId` is set. Default: action-primary. */
  fillColor?: string
  /** Accessible label override. */
  label?: string
  /** Content rendered inside the ring (e.g. the % text). */
  children?: React.ReactNode
  className?: string
}

export function ProgressRing({
  pct,
  size = 56,
  stroke = 5,
  gradientId,
  fillColor = 'var(--color-action-primary)',
  label,
  children,
  className,
}: ProgressRingProps) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, pct))
  const strokeVal = gradientId ? `url(#${gradientId})` : fillColor

  return (
    <div
      role="img"
      aria-label={label ?? `${clamped}%`}
      title={label}
      className={`relative shrink-0${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="block -rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-track-subtle)"
          strokeWidth={stroke}
        />
        {clamped > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={strokeVal}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped / 100)}
          />
        )}
      </svg>
      {children && (
        <span className="absolute inset-0 flex items-center justify-center">
          {children}
        </span>
      )}
    </div>
  )
}
