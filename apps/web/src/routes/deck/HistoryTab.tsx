// History tab — the deck's version timeline, newest first. Each row shows the
// snapshot metadata + per-version W/L and the card diff vs the previous version
// (version details are fetched eagerly — the timeline is short by construction:
// versions only bump once the current one has battle logs). Revert applies an
// old snapshot as a NEW version — history is never deleted.

import { useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type DeckDetail, type DeckVersionDetail, type DeckVersionSummary, type RevertResult } from '../../lib/api'
import { ConfirmModal } from '../../components/ListModals'
import { Icon } from '../../components/Icon'
import { fmtDate } from '../../lib/format'
import { FORMAT_META } from '../deckShared'
import { SourceChip, VersionChip, RecordSpans } from './intelShared'

// Additions take the brand primary, removals the secondary (rose). These are
// edits to a list, not wins and losses, so they read in brand colour rather than
// the status green/red those tokens are reserved for.
const DIFF_ADD = 'var(--color-action-primary)'
const DIFF_REMOVE = 'var(--color-brand-secondary-400)'

function VersionRow({
  v,
  detail,
  onRevert,
}: {
  v: DeckVersionSummary
  detail: DeckVersionDetail | undefined
  onRevert: () => void
}) {
  const [open, setOpen] = useState(false)
  const diff = detail?.diff ?? null
  const diffEmpty =
    diff !== null &&
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0 &&
    (diff.printings?.length ?? 0) === 0
  return (
    <div className="rounded-xl border border-border-default bg-surface-secondary p-[14px]">
      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <VersionChip version={v.version} current={v.isCurrent} />
        {v.isCurrent && <span className="text-[14px] font-bold uppercase tracking-wide text-action-primary">Current</span>}
        <span className="text-[14px] text-text-muted">{fmtDate(v.createdAt)}</span>
        <span className="text-[14px] text-text-muted">· {FORMAT_META[v.formatCode].short}</span>
        <SourceChip source={v.source} />
        <span className="ml-auto text-[14px] text-text-muted">{v.cardCount} cards</span>
      </div>
      {v.note && <div className="mt-[6px] text-[14px] leading-[19px] text-text-secondary">{v.note}</div>}
      <div className="mt-[8px] text-[14px] font-semibold">
        {v.battleLogs.total > 0 ? (
          <>
            <RecordSpans wins={v.battleLogs.wins} losses={v.battleLogs.losses} ties={v.battleLogs.ties} />
            <span className="ml-[8px] font-normal text-text-muted">
              {v.battleLogs.total} battle{v.battleLogs.total === 1 ? '' : 's'} on this version
            </span>
          </>
        ) : (
          <span className="font-normal text-text-muted">No battles logged on this version</span>
        )}
      </div>

      {/* The diff is the app's own voice, not a terminal: it takes the brand's
          primary for additions and secondary (rose) for removals, rather than
          the stark status green/red, and it is set in the UI face. `tabular-nums`
          keeps the leading counts in a column, which is the only thing the
          monospace face was really buying. The W/L record above keeps its
          status colours — that IS a win/loss statement. */}
      {diff && !diffEmpty && (
        <div className="tabular-nums mt-[10px] flex flex-col gap-[2px] border-t border-divider-subtle pt-[10px] text-[14px] leading-[19px]">
          {diff.added.map((c) => (
            <div key={`a-${c.tcgdexId}`} style={{ color: DIFF_ADD }}>
              +{c.quantity} {c.name}
            </div>
          ))}
          {diff.changed.map((c) => (
            <div key={`c-${c.tcgdexId}`} style={{ color: c.to > c.from ? DIFF_ADD : DIFF_REMOVE }}>
              {c.to > c.from ? '+' : '−'}
              {Math.abs(c.to - c.from)} {c.name} ({c.from}→{c.to})
            </div>
          ))}
          {diff.removed.map((c) => (
            <div key={`r-${c.tcgdexId}`} style={{ color: DIFF_REMOVE }}>
              −{c.quantity} {c.name}
            </div>
          ))}
          {/* Printing swaps: same card, same count, different mix. Neutral
              colour — nothing entered or left the deck. */}
          {(diff.printings ?? []).map((c) => (
            <div key={`p-${c.tcgdexId}`} className="text-text-muted">
              ⇄ {c.name}: {c.from} → {c.to}
            </div>
          ))}
        </div>
      )}
      {diffEmpty && (
        <div className="mt-[10px] border-t border-divider-subtle pt-[10px] text-[12px] text-text-muted">
          No card changes vs v{v.version - 1}.
        </div>
      )}

      <div className="mt-[10px] flex flex-wrap items-center justify-between gap-[8px] border-t border-divider-subtle pt-[10px]">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-[6px] text-[12px] font-semibold text-text-secondary hover:text-text-primary"
        >
          <Icon name="chevron-down" size={14} className={open ? 'rotate-180' : ''} />
          {open ? 'Hide card list' : `Show card list (${v.cardCount})`}
        </button>
        {!v.isCurrent && (
          <button
            onClick={onRevert}
            className="flex h-[34px] items-center gap-[6px] rounded-full bg-surface-tertiary px-[14px] text-[12px] font-bold text-text-primary hover:bg-action-default-hover"
          >
            <Icon name="history" size={14} /> Revert to v{v.version}
          </button>
        )}
      </div>

      {open &&
        (detail ? (
          <div
            className="mt-[10px] grid gap-x-[16px] gap-y-[3px] rounded-lg bg-surface-primary p-[12px] text-[12.5px]"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
          >
            {detail.cards.map((c) => (
              <div key={c.tcgdexId} className="flex gap-[6px] text-text-body">
                <span className="w-[18px] shrink-0 text-right font-bold text-text-primary">{c.quantity}</span>
                <span className="truncate">{c.name}</span>
              </div>
            ))}
            {detail.cards.length === 0 && <span className="text-text-muted">Empty deck</span>}
          </div>
        ) : (
          <div className="mt-[10px] text-[12px] text-text-muted">Loading snapshot…</div>
        ))}
    </div>
  )
}

export function HistoryTab({
  deckId,
  onReverted,
}: {
  deckId: string
  onReverted: (d: DeckDetail & { revert: RevertResult }) => void
}) {
  const qc = useQueryClient()
  const [revertTo, setRevertTo] = useState<number | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['deck-versions', deckId],
    queryFn: ({ signal }) => api.deckVersions(deckId, signal),
  })
  const versions = data?.versions ?? []

  // Per-version details carry the diff + snapshot; the timeline is short (a
  // version only bumps once the previous one has battle logs), so fetch eagerly.
  const details = useQueries({
    queries: versions.map((v) => ({
      queryKey: ['deck-versions', deckId, v.version],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.deckVersion(deckId, v.version, signal),
    })),
  })

  const revert = useMutation({
    mutationFn: (toVersion: number) => api.revertDeck(deckId, { toVersion }),
    onSuccess: (d) => {
      setRevertTo(null)
      qc.invalidateQueries({ queryKey: ['deck-versions', deckId] })
      qc.invalidateQueries({ queryKey: ['battle-logs', deckId] })
      qc.invalidateQueries({ queryKey: ['decks'] })
      onReverted(d)
    },
  })

  return (
    <div className="mt-[18px] flex flex-col gap-[10px]">
      {isLoading && !data && <div className="py-[30px] text-center text-[14px] text-text-muted">Loading history…</div>}
      {error && <div className="text-[14px] text-error">{(error as Error).message}</div>}
      {revert.isError && <div className="text-[14px] text-error">{(revert.error as Error).message}</div>}

      {versions.map((v, i) => (
        <VersionRow key={v.version} v={v} detail={details[i]?.data} onRevert={() => setRevertTo(v.version)} />
      ))}

      {revertTo != null && (
        <ConfirmModal
          title={`Revert to v${revertTo}`}
          message={`Apply v${revertTo}'s card list to this deck? This creates a new version — nothing is lost, and you can revert back at any time. The strategy guide from v${revertTo} is restored too.`}
          confirmLabel="Revert"
          busy={revert.isPending}
          onClose={() => setRevertTo(null)}
          onConfirm={() => revert.mutate(revertTo)}
        />
      )}
    </div>
  )
}
