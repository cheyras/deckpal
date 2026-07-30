// Battles tab — the deck's battle-log list (PTCG Live paste + parse). Logs
// attach to the deck version they were played with; the header record and the
// list respect the version filter. Raw logs are fetched lazily on expand.

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AddBattleLogBody, type BattleLog, type BattleLogSummary, type BattleResult } from '../../lib/api'
import { Modal, ConfirmModal } from '../../components/ListModals'
import { Icon } from '../../components/Icon'
import { fmtDate } from '../../lib/format'
import { ResultBadge, SourceChip, VersionChip, RecordSpans } from './intelShared'

// ── One log row: summary line + chevron-expand to the raw log ─────────────────
function LogRow({ deckId, log, onDelete }: { deckId: string; log: BattleLogSummary; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['battle-log', deckId, log.id],
    queryFn: ({ signal }) => api.battleLog(deckId, log.id, signal),
    enabled: open,
  })
  return (
    <div className="rounded-xl border border-border-default bg-surface-secondary">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-[10px] p-[12px] text-left">
        <ResultBadge result={log.result} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
            <span className="truncate text-[14px] font-semibold text-text-primary">
              {log.opponent ? `vs ${log.opponent}` : 'Unknown opponent'}
            </span>
            {log.opponentDeck && <span className="truncate text-[12px] text-text-secondary">{log.opponentDeck}</span>}
            <VersionChip version={log.deckVersion} />
            <SourceChip source={log.source} />
          </div>
          <div className="mt-[2px] flex flex-wrap items-center gap-x-[10px] gap-y-[2px] text-[11px] text-text-muted">
            {log.turns != null && <span>{log.turns} turns</span>}
            {log.prizes && <span>prizes {log.prizes.me}–{log.prizes.opponent}</span>}
            <span>{fmtDate(log.playedAt)}</span>
          </div>
        </div>
        <Icon name="chevron-down" size={16} className={`shrink-0 text-icon-default ${open ? 'rotate-180' : ''}`} />
      </button>
      {log.notes && <div className="-mt-[4px] px-[12px] pb-[10px] text-[12px] leading-[17px] text-text-secondary">{log.notes}</div>}
      {open && (
        <div className="border-t border-divider-subtle p-[12px]">
          {!data && <div className="py-[16px] text-center text-[13px] text-text-muted">Loading log…</div>}
          {data && (
            <>
              <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-primary p-[12px] font-mono text-[12px] leading-[17px] text-text-secondary">
                {data.log.rawLog}
              </pre>
              <div className="mt-[10px] flex justify-end">
                <button
                  onClick={onDelete}
                  className="flex h-[36px] items-center gap-[6px] rounded-full bg-surface-tertiary px-[14px] text-[12px] font-bold text-action-danger hover:bg-action-danger hover:text-action-danger-text"
                >
                  <Icon name="close" size={14} /> Delete Log
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Log-a-Battle modal: paste → parse → parsed summary ────────────────────────
// On a 400 that mentions playerName (the parser couldn't tell which player owns
// this deck), the error is shown and a screen-name input is revealed for retry.
function LogBattleModal({ deckId, onClose, onLogged }: { deckId: string; onClose: () => void; onLogged: () => void }) {
  const [rawLog, setRawLog] = useState('')
  const [result, setResult] = useState<'auto' | BattleResult>('auto')
  const [opponentDeck, setOpponentDeck] = useState('')
  const [notes, setNotes] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [needPlayer, setNeedPlayer] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ log: BattleLog; attachedToVersion: number } | null>(null)

  const add = useMutation({
    mutationFn: (body: AddBattleLogBody) => api.addBattleLog(deckId, body),
    onSuccess: (r) => {
      setSaved(r)
      onLogged()
    },
    onError: (e) => {
      const msg = (e as Error).message
      setErr(msg)
      if (msg.includes('playerName')) setNeedPlayer(true)
    },
  })

  const submit = () => {
    setErr(null)
    const body: AddBattleLogBody = { rawLog }
    if (result !== 'auto') body.result = result
    if (opponentDeck.trim()) body.opponentDeck = opponentDeck.trim()
    if (notes.trim()) body.notes = notes.trim()
    if (playerName.trim()) body.playerName = playerName.trim()
    add.mutate(body)
  }

  if (saved) {
    const p = saved.log.parsed
    return (
      <Modal title="Battle Logged" onClose={onClose} wide>
        <div className="flex flex-col gap-[14px]">
          <div className="flex flex-wrap items-center gap-[10px]">
            <ResultBadge result={saved.log.result} />
            <span className="text-[16px] font-bold text-text-primary">
              {saved.log.opponent ? `vs ${saved.log.opponent}` : 'Opponent unknown'}
            </span>
            <VersionChip version={saved.attachedToVersion} />
          </div>
          {saved.log.opponentDeck && <div className="text-[13px] text-text-secondary">Opponent deck: {saved.log.opponentDeck}</div>}
          {p && (
            <div className="flex flex-wrap gap-x-[20px] gap-y-[4px] text-[13px] text-text-muted">
              <span>{p.totalTurns} turns</span>
              <span>Prizes {p.prizesTaken.me}–{p.prizesTaken.opponent}</span>
              {p.wentFirst && <span>You went {p.wentFirst === 'me' ? 'first' : 'second'}</span>}
            </div>
          )}
          <p className="text-[12px] text-text-muted">
            Attached to v{saved.attachedToVersion} — the card list this game was played with.
          </p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="h-[44px] rounded-full bg-action-primary px-[24px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Log a Battle" onClose={onClose} wide>
      <div className="flex flex-col gap-[14px]">
        <p className="text-[13px] text-text-muted">
          Paste the battle log from Pokémon TCG Live. Result, opponent and their deck are parsed automatically — override anything
          below.
        </p>
        <textarea
          autoFocus
          value={rawLog}
          onChange={(e) => setRawLog(e.target.value)}
          rows={10}
          placeholder={'Setup\nPlayerOne chose heads for the opening coin flip…'}
          className="rounded-lg border border-border-default bg-surface-primary px-[14px] py-[10px] font-mono text-[12.5px] leading-[18px] text-text-primary placeholder:text-text-muted"
        />
        <div className="flex flex-wrap gap-[12px]">
          <label className="flex flex-col gap-[6px]">
            <span className="text-[13px] font-semibold text-text-secondary">Result</span>
            <select
              value={result}
              onChange={(e) => setResult(e.target.value as 'auto' | BattleResult)}
              className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[12px] text-[14px] text-text-primary"
            >
              <option value="auto">Auto-detect</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="tie">Tie</option>
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-[6px]" style={{ minWidth: 180 }}>
            <span className="text-[13px] font-semibold text-text-secondary">Opponent deck (optional)</span>
            <input
              value={opponentDeck}
              onChange={(e) => setOpponentDeck(e.target.value)}
              maxLength={200}
              placeholder="Dragapult ex / Dusknoir"
              className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[14px] text-[14px] text-text-primary placeholder:text-text-muted"
            />
          </label>
        </div>
        <label className="flex flex-col gap-[6px]">
          <span className="text-[13px] font-semibold text-text-secondary">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Bricked turn 2, still stabilised on Dusknoir…"
            className="rounded-lg border border-border-default bg-surface-primary px-[14px] py-[10px] text-[14px] text-text-primary placeholder:text-text-muted"
          />
        </label>
        {needPlayer && (
          <label className="flex flex-col gap-[6px]">
            <span className="text-[13px] font-semibold text-text-secondary">Your screen name</span>
            <input
              autoFocus
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={100}
              placeholder="Exactly as it appears in the log"
              className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[14px] text-[14px] text-text-primary placeholder:text-text-muted"
            />
          </label>
        )}
        {err && <div className="text-[13px] text-error">{err}</div>}
        <div className="flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            className="h-[44px] rounded-full bg-surface-tertiary px-[20px] text-[14px] font-semibold text-text-primary hover:bg-action-default-hover"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={add.isPending || !rawLog.trim()}
            className="h-[44px] rounded-full bg-action-primary px-[24px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover disabled:opacity-50"
          >
            {add.isPending ? 'Saving…' : 'Save Battle'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Tab body ──────────────────────────────────────────────────────────────────
export function BattlesTab({ deckId, currentVersion }: { deckId: string; currentVersion: number }) {
  const qc = useQueryClient()
  const [version, setVersion] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [showLog, setShowLog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BattleLogSummary | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['battle-logs', deckId, version ?? 'all', page],
    queryFn: ({ signal }) => api.battleLogs(deckId, { version: version ?? undefined, page }, signal),
    placeholderData: keepPreviousData,
  })

  // Log writes can change the deck's record everywhere it is shown.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['battle-logs', deckId] })
    qc.invalidateQueries({ queryKey: ['deck-versions', deckId] })
    qc.invalidateQueries({ queryKey: ['deck', deckId] })
    qc.invalidateQueries({ queryKey: ['decks'] })
  }

  const deleteLog = useMutation({
    mutationFn: (logId: number) => api.deleteBattleLog(deckId, logId),
    onSuccess: () => {
      setDeleteTarget(null)
      invalidate()
    },
  })

  const totals = data?.totals
  const pageCount = data?.pagination.pageCount ?? 1

  return (
    <div className="mt-[18px] flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div className="flex items-baseline gap-[10px]">
          {totals && (
            <>
              <span className="text-[20px] font-bold">
                <RecordSpans wins={totals.wins} losses={totals.losses} ties={totals.ties} />
              </span>
              <span className="text-[12px] text-text-muted">
                {totals.total} game{totals.total === 1 ? '' : 's'} logged{version != null ? ` on v${version}` : ''}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-[10px]">
          <select
            value={version ?? 'all'}
            onChange={(e) => {
              setPage(1)
              setVersion(e.target.value === 'all' ? null : Number(e.target.value))
            }}
            aria-label="Filter by deck version"
            className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[10px] text-[13px] text-text-primary"
          >
            <option value="all">All versions</option>
            {Array.from({ length: currentVersion }, (_, i) => currentVersion - i).map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowLog(true)}
            className="flex h-[42px] items-center gap-[8px] rounded-full bg-action-primary px-[18px] text-[13px] font-bold text-action-primary-text hover:bg-action-primary-hover"
          >
            <Icon name="plus" size={16} /> Log a Battle
          </button>
        </div>
      </div>

      {isLoading && !data && <div className="py-[30px] text-center text-[14px] text-text-muted">Loading battles…</div>}
      {error && <div className="text-[13px] text-error">{(error as Error).message}</div>}

      {data && data.logs.length === 0 && (
        <div className="flex flex-col items-center gap-[10px] rounded-xl border border-dashed border-border-default px-[20px] py-[50px] text-center">
          <Icon name="shuffle" size={36} className="text-icon-muted" />
          <div className="text-[16px] font-bold text-text-primary">
            {version != null ? `No battles logged on v${version}` : 'No battles logged yet'}
          </div>
          <p className="max-w-[400px] text-[13px] leading-[19px] text-text-muted">
            Paste a Pokémon TCG Live battle log to start tracking this deck's record — each log attaches to the version it was
            played with.
          </p>
        </div>
      )}

      {data && data.logs.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          {data.logs.map((log) => (
            <LogRow key={log.id} deckId={deckId} log={log} onDelete={() => setDeleteTarget(log)} />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-[14px] text-[13px]">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex h-[34px] items-center gap-[4px] rounded-full bg-surface-tertiary px-[12px] font-bold text-text-primary hover:bg-action-default-hover disabled:opacity-40"
          >
            <Icon name="chevron-left" size={14} /> Prev
          </button>
          <span className="text-text-muted">
            Page {page} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            className="flex h-[34px] items-center gap-[4px] rounded-full bg-surface-tertiary px-[12px] font-bold text-text-primary hover:bg-action-default-hover disabled:opacity-40"
          >
            Next <Icon name="chevron-right" size={14} />
          </button>
        </div>
      )}

      {showLog && <LogBattleModal deckId={deckId} onClose={() => setShowLog(false)} onLogged={invalidate} />}
      {deleteTarget && (
        <ConfirmModal
          title="Delete battle log"
          message={`Delete this ${deleteTarget.result ?? 'unscored'} vs ${deleteTarget.opponent ?? 'unknown opponent'} (${fmtDate(deleteTarget.playedAt)})? This can't be undone.`}
          confirmLabel="Delete Log"
          busy={deleteLog.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteLog.mutate(deleteTarget.id)}
        />
      )}
    </div>
  )
}
