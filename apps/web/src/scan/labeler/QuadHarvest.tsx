// The harvest view — what the corpus actually contains, as a grid.
//
// ── WHY IT EXISTS (owner request, 2026-09-08) ───────────────────────────────
//
// Labels have been written to `card-art/dev-flags/` since the labeler shipped
// and there has never been a way to look at them. A corpus you cannot see is
// one you cannot audit: a run where the reader was pressing the wrong reason
// chip, or where every row came back `seededFrom: 'default'` because the model
// never loaded, is invisible until a training run fails weeks later and
// somebody goes digging in a bucket.
//
// Same register as the labeler — dark, instrument-grade, no product chrome —
// because it is the same tool and the reader moves between them mid-session.
//
// ── DELETE IS PERMANENT AND THE UI IS WHERE THAT IS MADE CLEAR ─────────────
//
// There is no recycle bin behind this (see the DELETE route's own comment for
// why not), so the confirmation lives here, on a row the reader can see, rather
// than in a flag on a URL. Two taps, and the second one is labelled with what
// it destroys.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ScanFlag } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { REASON_BY_VALUE, type InvalidReason } from './types'
import {
  SORT_LABELS,
  filterFlags,
  sortFlags,
  verdictCounts,
  verdictsPresent,
  type HarvestSort,
} from './harvest'

/** How many rows to ask for. Every row costs the server one sidecar fetch
 *  (`meta=1`), so this is a real cost and not just a response size — 300 is
 *  several sessions' worth and still one quick request. */
const PAGE = 300

const VERDICT_TONE: Record<string, string> = {
  positive: 'bg-emerald-400/15 text-emerald-300',
  back: 'bg-violet-400/15 text-violet-300',
  negative: 'bg-red-400/15 text-red-300',
  unknown: 'bg-white/10 text-white/40',
}

const STAGE_TONE: Record<string, string> = {
  locked: 'text-emerald-300',
  tracked: 'text-cyan-300',
  gated: 'text-amber-300',
  proposed: 'text-rose-300',
  none: 'text-white/35',
}

function reasonLabel(reason: string | null): string | null {
  if (!reason) return null
  return REASON_BY_VALUE[reason as InvalidReason]?.label ?? reason
}

export function QuadHarvest() {
  const [flags, setFlags] = useState<ScanFlag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<HarvestSort>('newest')
  const [verdicts, setVerdicts] = useState<Set<string>>(new Set())
  /** The row awaiting its second tap. One at a time — a grid with several armed
   *  delete buttons is a grid where the wrong one gets hit. */
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null)
    try {
      const res = await api.scanFlagList({ limit: PAGE, meta: true }, signal)
      setFlags(res.flags)
    } catch (e) {
      if (signal?.aborted) return
      setError(e instanceof Error ? e.message : 'the harvest could not be read')
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  const shown = useMemo(() => (flags ? sortFlags(filterFlags(flags, verdicts), sort) : []), [flags, verdicts, sort])
  const counts = useMemo(() => (flags ? verdictCounts(flags) : {}), [flags])
  const present = useMemo(() => (flags ? verdictsPresent(flags) : []), [flags])

  const remove = useCallback(async (id: number) => {
    setBusy(id)
    try {
      await api.scanFlagDelete(id)
      // Dropped from local state rather than re-fetching the whole listing:
      // a re-fetch costs 300 sidecar reads to learn one thing we already know,
      // and it would scroll the reader back to the top mid-review.
      setFlags((cur) => (cur ? cur.filter((f) => f.id !== id) : cur))
      setConfirming(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : `could not delete ${id}`)
    } finally {
      setBusy(null)
    }
  }, [])

  const toggleVerdict = (v: string) =>
    setVerdicts((cur) => {
      const next = new Set(cur)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })

  return (
    <div
      className="flex flex-col overflow-hidden bg-neutral-950 text-white"
      // Same height arithmetic as QuadLabeler: this route renders inside
      // AppShell, which pins a header above it and pads `.app-content` down by
      // exactly that much. See that file's comment for the measurement.
      style={{ height: 'calc(100dvh - var(--app-header-h, 0px) - env(safe-area-inset-top, 0px))' }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-[8px] border-b border-white/10 px-[12px] py-[7px]">
        <Icon name="camera" size={15} className="shrink-0 text-cyan-300" />
        <span className="shrink-0 text-[12px] font-bold">Quad harvest</span>
        <span className="shrink-0 font-mono text-[11px] text-white/40">
          {flags ? `${shown.length}/${flags.length}` : '…'}
        </span>
        <div className="flex-1" />
        <label className="flex shrink-0 items-center gap-[5px] text-[11px] text-white/50">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as HarvestSort)}
            className="h-[32px] rounded bg-white/10 px-[8px] text-[11px] font-bold text-white"
          >
            {(Object.keys(SORT_LABELS) as HarvestSort[]).map((k) => (
              <option key={k} value={k} className="bg-neutral-900">
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="h-[32px] shrink-0 rounded-full bg-white/10 px-[12px] text-[11px] font-bold text-white/70 hover:bg-white/15"
        >
          Refresh
        </button>
      </div>

      {/* The verdict filter. Chips are offered only for verdicts the corpus
          actually contains, so there is never a chip that filters to nothing. */}
      {present.length > 1 && (
        <div className="flex shrink-0 flex-wrap items-center gap-[5px] border-b border-white/10 px-[12px] py-[6px]">
          {present.map((v) => {
            const on = verdicts.has(v)
            return (
              <button
                key={v}
                type="button"
                onClick={() => toggleVerdict(v)}
                aria-pressed={on}
                className={`h-[30px] rounded-full px-[10px] text-[11px] font-bold ${
                  on ? 'bg-cyan-400 text-cyan-950' : `${VERDICT_TONE[v] ?? VERDICT_TONE.unknown} hover:brightness-125`
                }`}
              >
                {v} <span className="opacity-60">{counts[v] ?? 0}</span>
              </button>
            )
          })}
          {verdicts.size > 0 && (
            <button
              type="button"
              onClick={() => setVerdicts(new Set())}
              className="h-[30px] rounded-full px-[10px] text-[11px] font-bold text-white/50 hover:text-white/80"
            >
              clear
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="shrink-0 bg-red-500/15 px-[12px] py-[6px] text-[11px] leading-[15px] text-red-200">{error}</div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-[10px]">
        {!flags && !error && (
          <div className="flex h-full items-center justify-center gap-[10px] text-white/50">
            <span className="h-[22px] w-[22px] animate-spin rounded-full border-2 border-white/20 border-t-cyan-300" />
            <span className="text-[12px]">Reading the harvest…</span>
          </div>
        )}
        {flags && !shown.length && (
          <div className="flex h-full items-center justify-center px-[20px] text-center text-[12px] text-white/50">
            {flags.length ? 'Nothing matches that filter.' : 'No labels saved yet.'}
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-[10px]">
          {shown.map((f) => {
            const verdict = f.label?.verdict ?? 'unknown'
            const reason = reasonLabel(f.label?.reason ?? null)
            const armed = confirming === f.id
            return (
              <div
                key={f.id}
                className="flex flex-col overflow-hidden rounded-[8px] bg-white/5 ring-1 ring-white/10"
              >
                <div className="relative aspect-square bg-black">
                  {f.files.includes('png') ? (
                    <img
                      src={api.scanFlagFileUrl(f.id, 'png')}
                      alt={`label ${f.id}`}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-white/30">no frame</div>
                  )}
                  <span
                    className={`pointer-events-none absolute left-[4px] top-[4px] rounded px-[5px] py-[1px] text-[9px] font-bold uppercase tracking-wide ${
                      VERDICT_TONE[verdict] ?? VERDICT_TONE.unknown
                    }`}
                  >
                    {verdict}
                  </span>
                  {f.label?.sweepStage && (
                    <span
                      className={`pointer-events-none absolute right-[4px] top-[4px] rounded bg-black/70 px-[5px] py-[1px] font-mono text-[9px] font-bold ${
                        STAGE_TONE[f.label.sweepStage] ?? 'text-white/50'
                      }`}
                      title="How far the LIVE pipeline got with this frame when the shutter fired"
                    >
                      {f.label.sweepStage}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-[2px] px-[6px] py-[5px] text-[10px] leading-[13px]">
                  {reason && <span className="truncate text-red-300">{reason}</span>}
                  <div className="flex items-center gap-[5px] text-white/40">
                    <span className="font-mono">
                      {new Date(f.uploadedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {f.label?.hasObj != null && (
                      <span className="font-mono" title="Presence head on the frozen frame at seed time">
                        {f.label.hasObj.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {f.label?.seededFrom === 'default' && (
                    <span
                      className="truncate text-amber-300/80"
                      title="The detector did not seed this row — either it found nothing, or it never ran"
                    >
                      unseeded
                    </span>
                  )}
                  {f.comment && <span className="truncate text-white/50">{f.comment}</span>}
                </div>

                <div className="flex items-center gap-[4px] border-t border-white/10 px-[6px] py-[4px]">
                  <a
                    href={api.scanFlagFileUrl(f.id, 'json')}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-white/45 hover:text-cyan-300"
                  >
                    json
                  </a>
                  <div className="flex-1" />
                  {armed ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="rounded px-[6px] py-[2px] text-[10px] font-bold text-white/60 hover:text-white"
                      >
                        cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy === f.id}
                        onClick={() => void remove(f.id)}
                        className="rounded bg-red-500 px-[7px] py-[2px] text-[10px] font-bold text-white disabled:opacity-40"
                      >
                        {busy === f.id ? '…' : 'delete forever'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(f.id)}
                      aria-label={`Delete label ${f.id}`}
                      className="rounded px-[6px] py-[2px] text-[10px] font-bold text-white/45 hover:bg-red-500/20 hover:text-red-300"
                    >
                      delete
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
