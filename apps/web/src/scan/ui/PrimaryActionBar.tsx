// The sticky bottom action bar — one slot, two jobs depending on the step
// (Scan.tsx's state machine): "Verify (N)" advances Step 1 → Step 2; "Add N
// cards" on the Verify screen is the actual commitFeed() write. Replaces
// CommitBar.tsx, which only ever knew about the commit half.
import { Icon, type IconName } from '../../components/Icon'
import { Spinner } from '../../components/ui'

export function PrimaryActionBar({
  label,
  icon,
  count,
  busy,
  onClick,
}: {
  label: string
  icon: IconName
  /** Hides the bar entirely at 0 — there is nothing to verify or commit yet. */
  count: number
  busy?: boolean
  onClick: () => void
}) {
  if (count === 0) return null
  return (
    <div
      className="shrink-0 border-t border-divider-subtle bg-surface-secondary px-[14px] pt-[10px]"
      style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}
    >
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className="flex h-[44px] w-full items-center justify-center gap-[8px] rounded-full bg-action-primary text-[15px] font-bold text-action-primary-text hover:bg-action-primary-hover disabled:opacity-60"
      >
        {busy ? (
          <>
            <Spinner inline size={18} /> Adding…
          </>
        ) : (
          <>
            <Icon name={icon} size={18} /> {label}
          </>
        )}
      </button>
    </div>
  )
}
