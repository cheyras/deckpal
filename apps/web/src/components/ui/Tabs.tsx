/**
 * Tabs — shared tab strip primitive.
 *
 * Two visual variants:
 *   - `underline` (default): a horizontal strip with a bottom-border indicator,
 *     used for page sections (Profile, CardDetail, DeckBuilder).
 *   - `pill`: a rounded segmented control, used for mode toggles (Insights).
 *     Supports `size: 'sm'` for compact/muted toggles (currency picker) and
 *     `size: 'md'` (default) for primary toggles.
 *
 * Tabs with a `to` prop render as router Links; otherwise as buttons when
 * `onChange` is provided, or as inert spans (e.g. not-yet-built nav items).
 */
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

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
}

export function Tabs({
  variant = 'underline',
  size = 'md',
  items,
  value,
  onChange,
  className,
}: TabsProps) {
  if (variant === 'pill') {
    const containerCls =
      size === 'sm'
        ? 'inline-flex rounded-full bg-surface-tertiary p-[3px]'
        : 'inline-flex rounded-full bg-surface-secondary p-[4px]'

    const itemBase =
      size === 'sm'
        ? 'h-[28px] rounded-full px-[12px] text-[12px] font-bold'
        : 'h-[36px] rounded-full px-[20px] text-[14px] font-semibold'

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
            <button key={item.key} onClick={() => onChange?.(item.key)} className={cls}>
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
      className={`scroll-x flex gap-[6px] border-b border-divider-subtle${className ? ` ${className}` : ''}`}
    >
      {items.map((item) => {
        const active = item.key === value
        const cls = `shrink-0 whitespace-nowrap border-b-2 px-[12px] pb-[10px] text-[14px] ${
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
            <button key={item.key} onClick={() => onChange(item.key)} className={cls}>
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
