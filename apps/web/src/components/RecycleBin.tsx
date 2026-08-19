import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from './Icon'

/**
 * Recently deleted — the browser half of soft delete (migration 038).
 *
 * Deleting a list or a deck used to be permanent, and for a deck it also took
 * every version snapshot and battle log with it. Now it is reversible, which is
 * only actually true if a person can reach the undo: an agent that can restore
 * something the user cannot is a worse deal, not a better one.
 *
 * So this sits under both indexes, collapsed and quiet when the bin is empty,
 * and it is also where "delete forever" lives — the one no-undo action in the
 * app, deliberately two steps away from the ordinary delete button and behind
 * its own confirmation.
 */

export interface BinEntry {
  id: string
  name: string
  detail: string
}

interface Props {
  /** 'list' | 'deck' — used in the copy and to key the query. */
  kind: 'list' | 'deck'
  load: (signal?: AbortSignal) => Promise<BinEntry[]>
  restore: (id: string) => Promise<unknown>
  purge: (id: string) => Promise<unknown>
  /** Query keys to refresh after a restore (the live index). */
  invalidate: string[]
}

export function RecycleBin({ kind, load, restore, purge, invalidate }: Props) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null)
  const binKey = [`${kind}s`, 'deleted']

  const { data, isLoading } = useQuery({ queryKey: binKey, queryFn: ({ signal }) => load(signal) })
  const entries = data ?? []

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: binKey })
    void qc.invalidateQueries({ queryKey: invalidate })
  }
  const doRestore = useMutation({ mutationFn: restore, onSuccess: refresh })
  const doPurge = useMutation({
    mutationFn: purge,
    onSuccess: () => {
      setConfirmPurge(null)
      refresh()
    },
  })

  // Nothing deleted, nothing to say. The section only appears when it is useful.
  if (isLoading || entries.length === 0) return null

  return (
    <section className="mt-[32px] rounded-xl border border-border-default bg-surface-tertiary">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-[8px] px-[16px] py-[14px] text-left"
      >
        <span className="flex min-w-0 items-center gap-[10px]">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} className="shrink-0 text-icon-muted" />
          <span className="whitespace-nowrap text-[16px] font-bold text-text-primary">Recently deleted</span>
          <span className="shrink-0 rounded-full bg-surface-quaternary px-[8px] py-[2px] text-[13px] font-bold text-text-secondary">
            {entries.length}
          </span>
        </span>
        {/* The reassurance is worth saying, but not worth crowding the title on
            a phone — below 640px the section header is the whole message. */}
        <span className="hidden text-[13px] text-text-muted sm:inline">kept until you delete them for good</span>
      </button>

      {open && (
        <ul className="flex flex-col gap-[2px] border-t border-border-default px-[16px] py-[12px]">
          {/* Stacked on a phone, side-by-side from 640px: two buttons and a name
              do not fit on one narrow row without truncating the name to
              nothing, and the name is the part you need to read. */}
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-[8px] py-[10px] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-[10px] sm:py-[8px]"
            >
              <span className="min-w-0 sm:flex-1">
                <span className="block truncate text-[15px] font-semibold text-text-primary">{e.name}</span>
                <span className="block text-[13px] text-text-muted">{e.detail}</span>
              </span>
              {confirmPurge === e.id ? (
                <span className="flex items-center gap-[8px]">
                  <span className="text-[13px] text-text-muted">Delete forever?</span>
                  <button
                    onClick={() => doPurge.mutate(e.id)}
                    disabled={doPurge.isPending}
                    className="h-[34px] rounded-full bg-action-danger px-[14px] text-[13px] font-bold text-action-danger-text hover:bg-action-danger-hover disabled:opacity-60"
                  >
                    {doPurge.isPending ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setConfirmPurge(null)}
                    className="h-[34px] rounded-full border border-border-default px-[14px] text-[13px] font-bold text-text-secondary"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <span className="flex items-center gap-[8px]">
                  <button
                    onClick={() => doRestore.mutate(e.id)}
                    disabled={doRestore.isPending}
                    className="h-[34px] rounded-full bg-action-primary px-[14px] text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover disabled:opacity-60"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => setConfirmPurge(e.id)}
                    className="h-[34px] rounded-full border border-border-default px-[14px] text-[13px] font-bold text-text-muted hover:text-text-secondary"
                  >
                    Delete forever
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
