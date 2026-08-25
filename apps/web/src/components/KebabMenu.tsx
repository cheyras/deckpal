import { useState } from 'react'
import { Icon, type IconName } from './Icon'
import { useDismiss } from './ui/useDismiss'

// Reusable kebab (⋮) trigger + dismissible dropdown menu (GitHub #34) — replaces
// standalone, always-visible danger-icon-buttons that sat next to an entity's
// title (deck/list "Delete" button). Outside-click + Escape dismiss come from
// the shared `useDismiss` hook (ui/useDismiss.ts) — the same mechanism
// PokedexIndex's OwnFilterMenu uses — rather than a new approach or a dep.
//
// Built to hold more than one item even though today's two call sites each pass
// exactly one — that's the point of the ask (a real menu, not a delete-button
// in a costume). The menu itself is neutral; only a `danger: true` item gets
// destructive coloring.
type KebabMenuItem = {
  key: string
  label: string
  icon?: IconName
  onSelect: () => void
  danger?: boolean
}

export function KebabMenu({
  items,
  ariaLabel = 'More options',
  size = 40,
  className,
}: {
  items: KebabMenuItem[]
  ariaLabel?: string
  size?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useDismiss<HTMLDivElement>(open, () => setOpen(false))

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${className ?? ''}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ height: size, width: size }}
        className="flex items-center justify-center rounded-full bg-surface-tertiary text-text-primary hover:bg-action-default-hover"
      >
        <Icon name="kebab" size={18} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-[6px] w-[180px] overflow-hidden rounded-lg border border-border-default bg-surface-primary py-[4px] shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={[
                'flex w-full items-center gap-[8px] px-[14px] py-[8px] text-left text-[13px] font-semibold',
                item.danger
                  ? 'text-action-danger hover:bg-action-danger hover:text-action-danger-text'
                  : 'text-text-body hover:bg-action-default-hover',
              ].join(' ')}
            >
              {item.icon && <Icon name={item.icon} size={15} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
