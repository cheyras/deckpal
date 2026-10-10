// Battles tab — the deck's battle-log list. A log is a pasted PTCG Live game or
// one the reader told Deck-E about in person (migration 084); both attach to the
// deck version they were played with, and the header record and the list
// respect the version filter. A row expands to the game's detail: the digest's
// prize race and turning points (Live logs, fetched on open), Deck-E's review,
// and the raw log behind "View log" (fetched only when asked for).

import { lazy, Suspense, useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type AddBattleLogBody, type BattleLog, type BattleLogSummary, type BattleResult } from '../../lib/api'
import { Modal, ConfirmModal } from '../../components/ListModals'
import { Icon } from '../../components/Icon'
import { fmtDate } from '../../lib/format'
import { ResultBadge, SourceChip, VersionChip, RecordSpans } from './intelShared'
import { writeFailureText } from '../../lib/writes'
import { DigestView, MostFacedSummary, SECTION_HEADING } from './BattleLogParts'
import {
  archetypeLabel,
  extraOpponentDeck,
  hasGuaranteedGameLog,
  hasReview,
  logOrigin,
  mayHaveGameLog,
  mostFacedArchetypes,
  noGameLogText,
  ORIGIN_LABEL,
  rowArchetypeText,
} from './battleLogView'

// The review renders through the same hardened markdown view as the strategy
// guide (model output: no remote images, no odd URL schemes, raw HTML escaped),
// in its own chunk so react-markdown stays out of the deck page's bundle.
const loadMarkdownView = () => import('./MarkdownView')
const MarkdownView = lazy(loadMarkdownView)

function PanelLoading() {
  return <div className="py-[16px] text-center text-[14px] text-text-muted">Loading game…</div>
}

// ── One log row: summary line + chevron-expand to the game's detail ───────────
function LogRow({ deckId, log, onDelete }: { deckId: string; log: BattleLogSummary; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const origin = logOrigin(log)
  const panelId = `battle-log-${log.id}`
  const wantsDigest = mayHaveGameLog(origin)
  const digest = useQuery({
    queryKey: ['battle-digest', deckId, log.id],
    queryFn: ({ signal }) => api.battleDigest(deckId, log.id, signal),
    enabled: open && wantsDigest,
    // A 404 is an answer (this game has no log), not a blip to retry; any other
    // failure simply leaves the digest out. The detail never shows an error for it.
    retry: false,
  })
  const raw = useQuery({
    queryKey: ['battle-log', deckId, log.id],
    queryFn: ({ signal }) => api.battleLog(deckId, log.id, signal),
    enabled: open && showRaw,
  })
  const noGameLog = !wantsDigest || (digest.error instanceof ApiError && digest.error.status === 404)
  // "View log": always for Live (a CHECK constraint guarantees the text), never
  // in person, and for `other` unless the digest has already said there is none.
  const offerLog = hasGuaranteedGameLog(origin) || !noGameLog
  // Hold the panel on one loading line until the digest settles, so the digest
  // never arrives late and shoves the review and the buttons down.
  const settled = !wantsDigest || !digest.isPending
  const deckText = rowArchetypeText(log)
  const extraDeck = extraOpponentDeck(log)

  return (
    <li className="rounded-xl border border-border-default bg-surface-secondary">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-[10px] rounded-xl p-[12px] text-left"
      >
        <ResultBadge result={log.result} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
            <span className="truncate text-[14px] font-semibold text-text-primary">
              {log.opponent ? `vs ${log.opponent}` : 'Unknown opponent'}
            </span>
            {deckText && <span className="min-w-0 truncate text-[14px] text-text-secondary">{deckText}</span>}
            <VersionChip version={log.deckVersion} />
            <SourceChip source={log.source} />
          </div>
          <div className="mt-[2px] flex flex-wrap items-center gap-x-[10px] gap-y-[2px] text-[14px] text-text-muted">
            <span>{ORIGIN_LABEL[origin]}</span>
            {log.turns != null && <span>{log.turns} turns</span>}
            {log.prizes && <span>prizes {log.prizes.me}–{log.prizes.opponent}</span>}
            <span>{fmtDate(log.playedAt)}</span>
          </div>
        </div>
        <Icon name="chevron-down" size={16} className={`shrink-0 text-icon-default ${open ? 'rotate-180' : ''}`} />
      </button>
      {log.notes && <div className="-mt-[4px] px-[12px] pb-[10px] text-[14px] leading-[17px] text-text-secondary">{log.notes}</div>}
      {open && (
        <div id={panelId} className="border-t border-divider-subtle p-[12px]">
          <Suspense fallback={<PanelLoading />}>
            {!settled ? (
              <PanelLoading />
            ) : (
              <div className="flex flex-col gap-[14px]">
                {(log.opponentArchetype || extraDeck) && (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-[12px] gap-y-[2px] text-[14px] leading-[20px]">
                    {log.opponentArchetype && (
                      <>
                        <dt className="text-text-muted">Archetype</dt>
                        <dd className="text-text-primary [overflow-wrap:anywhere]">
                          {archetypeLabel(log.opponentArchetype, [log.opponentDeck])}
                        </dd>
                      </>
                    )}
                    {extraDeck && (
                      <>
                        <dt className="text-text-muted">Their deck</dt>
                        <dd className="text-text-secondary [overflow-wrap:anywhere]">{extraDeck}</dd>
                      </>
                    )}
                  </dl>
                )}
                {digest.data && <DigestView digest={digest.data.digest} result={log.result} idBase={panelId} />}
                {hasReview(log.reviewMd) && (
                  <section aria-labelledby={`${panelId}-review`}>
                    <h3 id={`${panelId}-review`} className={SECTION_HEADING}>
                      Deck-E's review
                    </h3>
                    <div className="mt-[6px] min-w-0 [overflow-wrap:anywhere]">
                      <MarkdownView markdown={log.reviewMd} compact />
                    </div>
                  </section>
                )}
                <div className="flex flex-wrap items-center justify-between gap-[8px]">
                  {offerLog ? (
                    <button
                      type="button"
                      onClick={() => setShowRaw((s) => !s)}
                      aria-expanded={showRaw}
                      aria-controls={`${panelId}-raw`}
                      className="flex h-[36px] items-center gap-[6px] rounded-full text-[12px] font-semibold text-text-secondary hover:text-text-primary"
                    >
                      <Icon name="chevron-down" size={14} className={showRaw ? 'rotate-180' : ''} />
                      {showRaw ? 'Hide log' : 'View log'}
                    </button>
                  ) : (
                    <span className="text-[12px] text-text-muted">{noGameLogText(origin)}</span>
                  )}
                  <button
                    type="button"
                    onClick={onDelete}
                    className="ml-auto flex h-[36px] items-center gap-[6px] rounded-full bg-surface-tertiary px-[14px] text-[14px] font-bold text-action-danger hover:bg-action-danger-fill hover:text-action-danger-text"
                  >
                    <Icon name="close" size={14} /> Delete Log
                  </button>
                </div>
                {offerLog && showRaw && (
                  <div id={`${panelId}-raw`}>
                    {raw.data ? (
                      // `rawLog` is NULL for an in-person game and may be for
                      // `other`: say which, never paint an empty <pre>.
                      raw.data.log.rawLog?.trim() ? (
                        <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-primary p-[12px] font-mono text-[14px] leading-[17px] text-text-secondary [overflow-wrap:anywhere]">
                          {raw.data.log.rawLog}
                        </pre>
                      ) : (
                        <div className="text-[14px] text-text-muted">{noGameLogText(logOrigin(raw.data.log))}</div>
                      )
                    ) : raw.isError ? (
                      <div className="text-[14px] text-error">{(raw.error as Error).message}</div>
                    ) : (
                      <div className="py-[16px] text-center text-[14px] text-text-muted">Loading log…</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Suspense>
        </div>
      )}
    </li>
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
          {saved.log.opponentDeck && <div className="text-[14px] text-text-secondary">Opponent deck: {saved.log.opponentDeck}</div>}
          {p && (
            <div className="flex flex-wrap gap-x-[20px] gap-y-[4px] text-[14px] text-text-muted">
              <span>{p.totalTurns} turns</span>
              <span>Prizes {p.prizesTaken.me}–{p.prizesTaken.opponent}</span>
              {p.wentFirst && <span>You went {p.wentFirst === 'me' ? 'first' : 'second'}</span>}
            </div>
          )}
          <p className="text-[14px] text-text-muted">
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
        <p className="text-[14px] text-text-muted">
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
            <span className="text-[14px] font-semibold text-text-secondary">Result</span>
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
            <span className="text-[14px] font-semibold text-text-secondary">Opponent deck (optional)</span>
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
          <span className="text-[14px] font-semibold text-text-secondary">Notes (optional)</span>
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
            <span className="text-[14px] font-semibold text-text-secondary">Your screen name</span>
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
        {err && <div className="text-[14px] text-error">{err}</div>}
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
  // Scoped by the version the DATA was loaded for (the response echoes it), not
  // the select: under keepPreviousData the two differ while a new filter loads.
  const mostFaced = data ? mostFacedArchetypes({ logs: data.logs, archetypes: data.archetypes, version: data.version }) : null

  // Fetch the markdown chunk as soon as there is a review to open, so opening
  // one does not wait on a network round trip behind the loading line.
  const anyReview = data?.logs.some((l) => hasReview(l.reviewMd)) ?? false
  useEffect(() => {
    if (anyReview) void loadMarkdownView()
  }, [anyReview])

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
            className="h-[42px] rounded-lg border border-border-default bg-surface-primary px-[10px] text-[14px] text-text-primary"
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
            className="flex h-[42px] items-center gap-[8px] rounded-full bg-action-primary px-[18px] text-[14px] font-bold text-action-primary-text hover:bg-action-primary-hover"
          >
            <Icon name="plus" size={16} /> Log a Battle
          </button>
        </div>
      </div>

      {isLoading && !data && <div className="py-[30px] text-center text-[14px] text-text-muted">Loading battles…</div>}
      {error && <div className="text-[14px] text-error">{(error as Error).message}</div>}

      {data && data.logs.length === 0 && (
        <div className="flex flex-col items-center gap-[10px] rounded-xl border border-dashed border-border-default px-[20px] py-[50px] text-center">
          <Icon name="shuffle" size={36} className="text-icon-muted" />
          <div className="text-[16px] font-bold text-text-primary">
            {version != null ? `No battles logged on v${version}` : 'No battles logged yet'}
          </div>
          <p className="max-w-[400px] text-[14px] leading-[19px] text-text-muted">
            Paste a Pokémon TCG Live battle log, or tell Deck-E about a game you played in person, to start tracking this
            deck's record — each game attaches to the version it was played with.
          </p>
        </div>
      )}

      {data && data.logs.length > 0 && mostFaced && (
        <MostFacedSummary
          summary={mostFaced}
          version={data.version}
          partial={mostFaced.scope === 'loaded' && pageCount > 1}
        />
      )}

      {data && data.logs.length > 0 && (
        <section aria-labelledby="battles-games">
          <h2 id="battles-games" className="sr-only">
            Games
          </h2>
          <ul className="flex flex-col gap-[8px]">
            {data.logs.map((log) => (
              <LogRow key={log.id} deckId={deckId} log={log} onDelete={() => setDeleteTarget(log)} />
            ))}
          </ul>
        </section>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-[14px] text-[14px]">
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
          error={deleteLog.isError ? writeFailureText("Couldn't delete this battle log.", deleteLog.error) : null}
          onClose={() => {
            setDeleteTarget(null)
            deleteLog.reset()
          }}
          onConfirm={() => deleteLog.mutate(deleteTarget.id)}
        />
      )}
    </div>
  )
}
