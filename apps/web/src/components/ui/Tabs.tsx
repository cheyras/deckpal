/**
 * Tabs — shared tab strip primitive.
 *
 * Two visual variants:
 *   - `underline` (default): a horizontal strip with a bottom-border indicator,
 *     used for page sections (Profile, CardDetail, DeckBuilder). With `fill`
 *     the tabs share the strip's width — for a strip that heads a panel, as
 *     CardDetail's does.
 *   - `pill`: a rounded segmented control, used for mode toggles (Insights).
 *     Supports `size: 'sm'` for compact/muted toggles (currency picker) and
 *     `size: 'md'` (default) for primary toggles.
 *
 * Tabs with a `to` prop render as router Links; otherwise as buttons when
 * `onChange` is provided, or as inert spans (e.g. not-yet-built nav items).
 */
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useScrollEdge } from '../../lib/useScrollEdge'

export interface TabItem {
  key: string
  label: ReactNode
  /** When present, the tab renders as a router Link. */
  to?: string
  params?: Record<string, string>
}

export interface TabsProps {
  variant?: 'underline' | 'pill'
  /** Pill variant only — `sm` for compact/muted, `md` for primary. Default `md`. */
  size?: 'sm' | 'md'
  items: readonly TabItem[]
  value: string
  onChange?: (key: string) => void
  className?: string
  /**
   * Underline variant only — share the strip's width equally between the tabs
   * instead of packing them at the start. For a strip that HEADS a panel (the
   * card detail's Card | Price | TCG), where the tabs are the panel's top edge
   * rather than a row of links floating above it.
   */
  fill?: boolean
}

export function Tabs({
  variant = 'underline',
  size = 'md',
  items,
  value,
  onChange,
  className,
  fill = false,
}: TabsProps) {
  // A strip wider than the screen (Profile's seven tabs at 390px) used to end
  // in a tab cut in half at the glass. It fades out under its edge instead,
  // the way /design's tab row does — and only once there is more to scroll to.
  const edge = useScrollEdge({ axis: 'x' })
  if (variant === 'pill') {
    const containerCls =
      size === 'sm'
        ? 'inline-flex rounded-full bg-surface-tertiary p-0.5'
        : 'inline-flex rounded-full bg-surface-secondary p-1'

    const itemBase =
      size === 'sm'
        ? // 28px, so it takes a 44px box under a thumb (`touch-hit`).
          'touch-hit h-[28px] rounded-full px-3 text-[12px] font-bold'
        : 'h-[36px] rounded-full px-5 text-[14px] font-semibold'

    return (
      <div className={`${containerCls}${className ? ` ${className}` : ''}`}>
        {items.map((item) => {
          const active = item.key === value
          const activeCls =
            size === 'sm'
              ? 'bg-surface-raised text-text-primary'
              : 'bg-action-primary text-action-primary-text'
          const cls = `${itemBase} ${active ? activeCls : 'text-text-muted hover:text-text-body'}`
          return (
            <button key={item.key} type="button" onClick={() => onChange?.(item.key)} className={cls}>
              {item.label}
            </button>
          )
        })}
      </div>
    )
  }

  // underline variant
  return (
    <div
      ref={edge}
      className={`scroll-x scroll-edge-x flex gap-1.5 border-b border-divider-subtle${className ? ` ${className}` : ''}`}
    >
      {items.map((item) => {
        const active = item.key === value
        const cls = `${fill ? 'flex-1 text-center' : 'shrink-0'} whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] ${
          active
            ? 'border-action-primary font-semibold text-text-primary'
            : 'border-transparent font-medium text-text-muted hover:text-text-body'
        }`

        if (item.to) {
          return (
            <Link key={item.key} to={item.to} params={item.params as never} className={cls}>
              {item.label}
            </Link>
          )
        }

        if (onChange) {
          return (
            <button key={item.key} type="button" onClick={() => onChange(item.key)} className={cls}>
              {item.label}
            </button>
          )
        }

        // Inert span — e.g. a not-yet-built navigation tab
        return (
          <span key={item.key} className={`${cls} cursor-default`}>
            {item.label}
          </span>
        )
      })}
    </div>
  )
}
