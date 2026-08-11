/**
 * StatTile — stat display primitive with three visual variants.
 *
 * - `bare`: label above value, no box. Used in dense stat strips (SetHeader).
 * - `boxed`: centered label + value in a compact rounded box (Profile).
 * - `card`: large rounded card with a muted uppercase label header and
 *   rich body content via children (Insights dashboard cards).
 */
import type { ReactNode } from 'react'

export interface StatTileProps {
  variant?: 'bare' | 'boxed' | 'card'
  label: string
  /** The stat value. Ignored when `children` is provided. */
  value?: ReactNode
  /** Bare variant: render value in change-positive (green) for money values. */
  money?: boolean
  className?: string
  /** Card variant: custom body content that replaces the simple value. */
  children?: ReactNode
}

export function StatTile({
  variant = 'bare',
  label,
  value,
  money = false,
  className,
  children,
}: StatTileProps) {
  if (variant === 'card') {
    return (
      <div className={`rounded-2xl bg-surface-secondary p-[20px]${className ? ` ${className}` : ''}`}>
        <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">{label}</div>
        {children ?? (
          <div className="mt-[6px] text-[32px] font-extrabold leading-[40px] text-text-primary">{value}</div>
        )}
      </div>
    )
  }

  if (variant === 'boxed') {
    return (
      <div className={`rounded-lg bg-surface-tertiary p-[12px] text-center${className ? ` ${className}` : ''}`}>
        <div className="text-[22px] font-extrabold text-text-primary">{children ?? value}</div>
        <div className="text-[11px] text-text-muted">{label}</div>
      </div>
    )
  }

  // bare — label above value, no box
  return (
    <div className={`min-w-0${className ? ` ${className}` : ''}`}>
      <div className="truncate text-[14px] leading-[23px] text-text-muted">{label}</div>
      <div
        className={`truncate text-[14px] leading-[23px] ${money ? 'text-change-positive' : 'text-text-primary'}`}
      >
        {children ?? value}
      </div>
    </div>
  )
}
