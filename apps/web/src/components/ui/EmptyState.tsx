import type { ReactNode } from 'react'
import { Icon, type IconName } from '../Icon'

/**
 * Empty-state placeholder — icon + title + optional body + optional CTA,
 * centered in a dashed-border container.
 *
 * The documented-but-previously-unbuilt `EmptyStateMessage` from
 * BEHAVIOR-SPEC (§12, quoting pkmn.gg's primitives-showcase).
 *
 * The `dashed` variant (default) matches the dashed-border pattern used at
 * DecksIndex "No Decks Yet" and ListDetail "This list is empty". Pass
 * `variant="plain"` for a plain centered layout without the border.
 */
export interface EmptyStateProps {
  icon: IconName
  title: string
  body?: string
  /** CTA slot — pass a <Button> or a row of buttons. */
  children?: ReactNode
  /** Default `dashed` renders the border-dashed container. `plain` renders
   *  a plain centered block. */
  variant?: 'dashed' | 'plain'
  className?: string
}

export function EmptyState({
  icon,
  title,
  body,
  children,
  variant = 'dashed',
  className,
}: EmptyStateProps) {
  const base =
    variant === 'dashed'
      ? 'flex flex-col items-center justify-center gap-[12px] rounded-xl border border-dashed border-border-default py-[80px] text-center'
      : 'flex flex-col items-center justify-center gap-[12px] py-[80px] text-center'

  return (
    <div className={`${base}${className ? ` ${className}` : ''}`}>
      <Icon name={icon} size={44} className="text-icon-muted" />
      <div className="font-display text-[20px] font-bold text-text-primary">{title}</div>
      {body && <p className="text-[14px] text-text-muted">{body}</p>}
      {children && <div className="mt-[4px] flex gap-[10px]">{children}</div>}
    </div>
  )
}
