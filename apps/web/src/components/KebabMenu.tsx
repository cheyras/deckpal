import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // Opened from the keyboard (a click with `detail === 0`), focus goes into the
  // menu, as a menu button promises; a pointer open leaves it where it was.
  const fromKeyboard = useRef(false)
  const wrapRef = useDismiss<HTMLDivElement>(open, () => {
    // Escape from inside the menu must not strand focus on <body>.
    const hadFocus = !!menuRef.current?.contains(document.activeElement)
    setOpen(false)
    if (hadFocus) triggerRef.current?.focus()
  })
  useEffect(() => {
    if (open && fromKeyboard.current) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])
  const moveFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const at = rows.indexOf(document.activeElement as HTMLElement)
    rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
  }

  return (
    <div ref={wrapRef} className={`relative shrink-0 ${className ?? ''}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        ref={triggerRef}
        onClick={(e) => {
          fromKeyboard.current = e.detail === 0
          setOpen((v) => !v)
        }}
        style={{ height: size, width: size }}
        className="flex items-center justify-center rounded-full bg-surface-tertiary text-text-primary hover:bg-action-default-hover"
      >
        <Icon name="kebab" size={18} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={moveFocus}
          // `popover-in`: it grows out of the ⋮ instead of being there on the
          // next frame (theme.css, motion tokens).
          className="popover-in absolute right-0 z-20 mt-1.5 w-[180px] overflow-hidden rounded-lg border border-border-default bg-surface-primary py-1 shadow-lg"
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
                // 36px under a mouse; a full 44px row under a thumb.
                'flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] font-semibold pointer-coarse:min-h-hit',
                item.danger
                  ? 'text-action-danger hover:bg-action-danger-fill hover:text-action-danger-text'
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
