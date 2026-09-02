// Sticky footer — "Add N cards", one collectionBatch write via commit.ts.
import { Icon } from '../../components/Icon'
import { Spinner } from '../../components/ui'

export function CommitBar({
  count,
  committing,
  onCommit,
}: {
  /** Sum of every commitable row's quantity (a "needs attention" row not yet
   *  corrected does not count — it cannot resolve to a variant). */
  count: number
  committing: boolean
  onCommit: () => void
}) {
  if (count === 0) return null
  return (
    <div className="sticky bottom-0 z-[8] border-t border-divider-subtle bg-surface-secondary/95 px-[14px] py-[10px] backdrop-blur">
      <button
        type="button"
        disabled={committing}
        onClick={onCommit}
        className="flex h-[44px] w-full items-center justify-center gap-[8px] rounded-full bg-action-primary text-[15px] font-bold text-action-primary-text hover:bg-action-primary-hover disabled:opacity-60"
      >
        {committing ? (
          <>
            <Spinner inline size={18} /> Adding…
          </>
        ) : (
          <>
            <Icon name="plus" size={18} /> Add {count} card{count === 1 ? '' : 's'}
          </>
        )}
      </button>
    </div>
  )
}
