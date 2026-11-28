import { Link } from '@tanstack/react-router'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './ui/Button'
import { Icon } from './Icon'

// Re-export new primitives from ui/ so existing `import { X } from '../components/ui'`
// call sites keep working without a mass import-rewrite.
export { Button, buttonClass } from './ui/Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './ui/Button'
export { CounterBox } from './ui/CounterBox'
export { ProgressBar, ProgressRing } from './ui/Progress'
export type { ProgressBarProps, ProgressRingProps } from './ui/Progress'
export { EmptyState } from './ui/EmptyState'
export type { EmptyStateProps } from './ui/EmptyState'
export { Tabs } from './ui/Tabs'
export type { TabsProps, TabItem } from './ui/Tabs'
export { SelectableCard } from './ui/SelectableCard'
export type { SelectableCardProps } from './ui/SelectableCard'
export { StatTile } from './ui/StatTile'
export type { StatTileProps } from './ui/StatTile'
export { useDismiss } from './ui/useDismiss'
export { DataTable, DataTableToolbar } from './ui/DataTable'
export type { DataTableProps, DataTableColumn, DataTablePagination, DataTableSort, DataTableToolbarProps } from './ui/DataTable'
export { Field } from './ui/Field'
export type { FieldProps } from './ui/Field'
export { FormAlert } from './ui/FormAlert'
export type { FormAlertProps } from './ui/FormAlert'
export { StatusPanel } from './ui/StatusPanel'
export type { StatusPanelProps } from './ui/StatusPanel'

// Content column: proportional gutters with a per-page max-width cap, centred
// (UI-SPEC §4.1 — gutters are proportional, not fixed).
export function Content({ children, cap = 1165 }: { children: ReactNode; cap?: number }) {
  // At ≥1068 the content column is 85% of MAIN (the 7.5% gutters ARE the
  // padding) — no extra horizontal padding at desktop, or the card grid loses a
  // column (UI-SPEC §4.1: 4×207.81 + 3×53 = 990.25 = 85% of 1165).
  //
  // The `max(…, min(…))` is a FLOOR under that 85%, and it exists because the
  // 85% is measured against MAIN — which is the viewport MINUS the 275px
  // sidebar. The two compound: crossing 1067→1068px, where the sidebar appears,
  // MAIN drops to 793 and 85% of that is 674px. Measured, the catalog grid went
  // from 4 columns at 1067px to 2 columns at 1068px, and the set page from
  // 22,403px tall to 56,439px — the content column got NARROWER as the viewport
  // got wider, which is the one thing a responsive rule must never do.
  //
  // The floor is "whatever fits with mobile's 16px gutters, but never more than
  // the 990px the grid actually wants". That leaves the documented behaviour at
  // and above the 1165 cap byte-identical (85% of 1165 = 990.25 still wins) and
  // only widens the starved 1068–1400 band.
  return (
    <div className="px-[16px] py-[24px] nav:px-0">
      <div
        className="mx-auto w-full nav:w-[max(85%,min(100%_-_32px,990px))]"
        style={{ maxWidth: cap }}
      >
        {children}
      </div>
    </div>
  )
}

// TCGdex asset URLs omit the file extension; append one so <img> resolves.
export function assetUrl(url: string | null | undefined, ext = 'png'): string | undefined {
  if (!url) return undefined
  return /\.(png|webp|jpg|jpeg|svg)$/i.test(url) ? url : `${url}.${ext}`
}

// Local set logo/symbol served by deckpal-images from the WebP cache. The path is
// a pure function of the set's tcgdex_id; the service 404s when a set lacks that
// asset, so callers gate on known presence AND handle onError for a clean fallback.
export function setAssetUrl(setId: string, kind: 'logo' | 'symbol'): string {
  return `/deckpal/images/sets/${encodeURIComponent(setId)}/${kind}.webp`
}

// ── Back plate geometry ──────────────────────────────────────────────────────
// All in CSS px against a fixed 28px-tall control. Only the two horizontal runs
// depend on the width, so the point's angle and every corner radius are the same
// on every back link regardless of label length — which is why the width is
// measured rather than the path being stretched to fit.
const PLATE_H = 28
const PLATE_R = 5 // right-hand corners
const NOSE_W = 12 // how far the point reaches left of the shoulders
const SHOULDER = 2.5 // rounding where each slant meets the top/bottom edge
const TIP_BACK = 5.5 // how far back ALONG THE SLANT the point's rounding starts

// The slant's unit vector, from the point out to a shoulder. Both curves are
// derived from it so their endpoints sit exactly ON the slants — eyeballing the
// offsets instead leaves a kink at each end of the curve, which is what made the
// point read as sharp even though it was nominally rounded.
const SLANT_LEN = Math.hypot(NOSE_W, PLATE_H / 2)
const UX = NOSE_W / SLANT_LEN
const UY = PLATE_H / 2 / SLANT_LEN

// Where each curve leaves the slant. Control points are the true vertices, so
// every curve is tangent to both edges it joins.
const SHOULDER_X = NOSE_W - UX * SHOULDER
const SHOULDER_Y = UY * SHOULDER
const TIP_X = UX * TIP_BACK
const TIP_Y = UY * TIP_BACK

const n = (v: number) => v.toFixed(2)

/** The complete silhouette as one closed path: top edge → rounded right corners
 *  → bottom edge → rounded bottom shoulder → slant → rounded point → slant →
 *  rounded top shoulder. */
function platePath(w: number): string {
  const mid = PLATE_H / 2
  return [
    `M ${n(NOSE_W + SHOULDER)} 0`,
    `L ${n(w - PLATE_R)} 0`,
    `A ${PLATE_R} ${PLATE_R} 0 0 1 ${n(w)} ${PLATE_R}`,
    `L ${n(w)} ${PLATE_H - PLATE_R}`,
    `A ${PLATE_R} ${PLATE_R} 0 0 1 ${n(w - PLATE_R)} ${PLATE_H}`,
    `L ${n(NOSE_W + SHOULDER)} ${PLATE_H}`,
    `Q ${NOSE_W} ${PLATE_H} ${n(SHOULDER_X)} ${n(PLATE_H - SHOULDER_Y)}`,
    `L ${n(TIP_X)} ${n(mid + TIP_Y)}`,
    `Q 0 ${mid} ${n(TIP_X)} ${n(mid - TIP_Y)}`,
    `L ${n(SHOULDER_X)} ${n(SHOULDER_Y)}`,
    `Q ${NOSE_W} 0 ${n(NOSE_W + SHOULDER)} 0`,
    'Z',
  ].join(' ')
}

// The single back control for the whole app. See theme.css `.back-plate` for why
// the silhouette is one drawn path and not a clipped box. Left padding clears the
// nose so the chevron never crowds the point.
export function BackPill({ to, params, label }: { to: string; params?: Record<string, string>; label: string }) {
  const uid = useId()
  const clipId = `back-plate-${uid}`
  const ref = useRef<HTMLAnchorElement>(null)
  // Measured, not stretched: a viewBox with preserveAspectRatio="none" would make
  // the point shallower on "Mega Evolution" than on "My Lists" and turn the
  // corner arcs into ellipses.
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.offsetWidth)
    const ro = new ResizeObserver(() => setW(el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const d = w > NOSE_W + SHOULDER * 2 + PLATE_R ? platePath(w) : null

  return (
    <Link
      ref={ref}
      to={to}
      params={params as never}
      className="back-plate inline-flex h-[28px] items-center gap-[4px] pr-[13px] pl-[21px] text-[12px] font-bold text-text-primary"
    >
      {d && (
        <svg aria-hidden="true" className="back-plate-shape" width={w} height={PLATE_H}>
          <defs>
            <clipPath id={clipId}>
              <path d={d} />
            </clipPath>
          </defs>
          <path className="back-face" d={d} />
          {/* Two copies of the SAME path, nudged and clipped back inside it, so
              each survives only as a band hugging the silhouette. Kept fine and
              low-contrast on purpose: the groove should be felt at a glance, not
              read as a drawn outline. Half the clipped stroke is discarded, so
              the visible band is half these widths. */}
          <g clipPath={`url(#${clipId})`} fill="none" style={{ filter: 'blur(0.4px)' }}>
            <path d={d} transform="translate(0 1.4)" stroke="rgb(0 0 0 / 0.34)" strokeWidth="1.5" />
            <path d={d} transform="translate(0 -1)" stroke="rgb(255 255 255 / 0.1)" strokeWidth="1" />
          </g>
        </svg>
      )}
      <span className="relative">
        <Icon name="chevron-left" size={14} />
      </span>
      <span className="relative">{label}</span>
    </Link>
  )
}

// SetSymbolTile lives in ./SetSymbolTile.tsx, not here: this file is on the
// critical path (the shell imports it), and the tile's printed-mark outlines
// are only needed by the pages that show a set. Import it from there directly —
// re-exporting it from this file would put it back in the entry chunk.

/**
 * Spinner — the one shared loading indicator.
 *
 * `inline` renders a bare ring element suitable for embedding inside text,
 * buttons (see Button `loading` prop), or horizontal layouts. The ring
 * colour inherits from `currentColor` so it adapts to any context.
 *
 * Without `inline` the spinner is a block-level, vertically-centred element
 * with an optional text label — the page/section loading state.
 */
export function Spinner({
  label,
  size,
  inline = false,
  className,
}: {
  label?: string
  /** Ring diameter in pixels. Defaults to 40 (block) or 16 (inline). */
  size?: number
  /** Render just the ring, no centering/padding — for inline contexts. */
  inline?: boolean
  className?: string
}) {
  const s = size ?? (inline ? 16 : 40)

  if (inline) {
    return (
      <span
        className={`shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent${className ? ` ${className}` : ''}`}
        style={{ width: s, height: s }}
        aria-hidden="true"
      />
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-[12px] py-[80px] text-text-muted">
      <div
        className="animate-spin rounded-full border-2 border-surface-tertiary border-t-action-primary"
        style={{ width: s, height: s }}
      />
      {label && <span className="text-[14px]">{label}</span>}
    </div>
  )
}

export function ErrorState({
  message,
  className = '',
  onRetry,
}: {
  message: string
  className?: string
  /** Optional Retry action. Omit it and this renders exactly as before. */
  onRetry?: () => void
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-[8px] py-[80px] text-center ${className}`}>
      <div className="text-[24px] font-bold text-text-primary">Something went wrong</div>
      <div className="text-[14px] text-text-muted">{message}</div>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-[4px]" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}
