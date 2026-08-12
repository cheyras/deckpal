// Strategy tab — rendered markdown guide with an edit-in-place mono textarea.
// Strategy edits never bump the deck version (LOCKED semantics): the guide is
// updated on the deck AND snapshotted into the current version in place.

import { lazy, Suspense, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, type DeckDetail } from '../../lib/api'
import { Icon } from '../../components/Icon'

const MarkdownView = lazy(() => import('./MarkdownView'))

const STRATEGY_MAX = 40_000

export function StrategyTab({
  deckId,
  strategyMd,
  onSaved,
}: {
  deckId: string
  strategyMd: string | null
  onSaved: (d: DeckDetail) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const save = useMutation({
    mutationFn: (md: string) => api.setDeckStrategy(deckId, md.trim() ? md : null),
    onSuccess: (d) => {
      setEditing(false)
      onSaved(d)
    },
  })

  if (editing) {
    return (
      <div className="mt-[18px] flex flex-col gap-[12px]">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={STRATEGY_MAX}
          placeholder={'# Game plan\n\nHow this deck wins, key lines, matchup notes…'}
          className="min-h-[380px] rounded-lg border border-border-default bg-surface-primary px-[14px] py-[12px] font-mono text-[14px] leading-[19px] text-text-primary placeholder:text-text-muted"
        />
        {save.isError && <div className="text-[14px] text-error">{(save.error as Error).message}</div>}
        <div className="flex flex-wrap items-center justify-between gap-[10px]">
          <span className="text-[14px] text-text-muted">
            Markdown (GFM tables and lists supported). Strategy edits never create a new deck version.
          </span>
          <div className="flex gap-[10px]">
            <button
              onClick={() => setEditing(false)}
              className="h-[44px] rounded-full bg-surface-tertiary px-[20px] text-[14px] font-semibold text-text-primary hover:bg-action-default-hover"
            >
              Cancel
            </button>
            <button
              onClick={() => save.mutate(draft)}
              disabled={save.isPending}
              className="h-[44px] rounded-full bg-action-primary px-[24px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save Strategy'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!strategyMd) {
    return (
      <div className="mt-[18px] flex flex-col items-center gap-[10px] rounded-xl border border-dashed border-border-default px-[20px] py-[60px] text-center">
        <Icon name="book" size={40} className="text-icon-muted" />
        <div className="text-[16px] font-bold text-text-primary">No strategy guide yet</div>
        <p className="max-w-[400px] text-[14px] leading-[19px] text-text-muted">
          Write one, or let an agent add it — the guide travels with the deck and is snapshotted into each version.
        </p>
        <button
          onClick={() => {
            setDraft('')
            setEditing(true)
          }}
          className="mt-[4px] flex h-[44px] items-center gap-[8px] rounded-full bg-action-primary px-[24px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover"
        >
          <Icon name="plus" size={16} /> Write Strategy Guide
        </button>
      </div>
    )
  }

  return (
    <div className="mt-[18px] flex flex-col gap-[10px]">
      <div className="flex justify-end">
        <button
          onClick={() => {
            setDraft(strategyMd)
            setEditing(true)
          }}
          className="flex h-[36px] items-center gap-[6px] rounded-full bg-surface-tertiary px-[16px] text-[12px] font-bold text-text-primary hover:bg-action-default-hover"
        >
          <Icon name="book" size={14} /> Edit
        </button>
      </div>
      <div className="rounded-xl border border-border-default bg-surface-secondary p-[20px]">
        <Suspense fallback={<div className="py-[30px] text-center text-[14px] text-text-muted">Loading guide…</div>}>
          <MarkdownView markdown={strategyMd} />
        </Suspense>
      </div>
    </div>
  )
}
