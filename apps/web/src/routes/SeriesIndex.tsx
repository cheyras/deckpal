import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api, type SeriesSummary } from '../lib/api'
import { Content, Spinner, ErrorState, setAssetUrl, McdonaldsMark } from '../components/ui'
import { Icon } from '../components/Icon'
import { fmtDate } from '../lib/format'

// ── Sort / group preferences (issue 14i8ys) ────────────────────────────────
// Persisted to localStorage only when the user hits "Save as default"; otherwise
// changes are session-local. Default = most-recent-first, grouped by owned.
type SortKey = 'recency' | 'az' | 'pct'
type SortDir = 'asc' | 'desc'
interface Prefs {
  sortKey: SortKey
  sortDir: SortDir
  groupByOwned: boolean
}
const DEFAULT_PREFS: Prefs = { sortKey: 'recency', sortDir: 'desc', groupByOwned: true }
const PREFS_KEY = 'deckscout.series.prefs'
const SORT_KEYS: SortKey[] = ['recency', 'az', 'pct']
const SORT_DIRS: SortDir[] = ['asc', 'desc']

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>
      return {
        sortKey: SORT_KEYS.includes(p.sortKey as SortKey) ? (p.sortKey as SortKey) : DEFAULT_PREFS.sortKey,
        sortDir: SORT_DIRS.includes(p.sortDir as SortDir) ? (p.sortDir as SortDir) : DEFAULT_PREFS.sortDir,
        groupByOwned: typeof p.groupByOwned === 'boolean' ? p.groupByOwned : DEFAULT_PREFS.groupByOwned,
      }
    }
  } catch {
    /* ignore malformed/absent storage */
  }
  return DEFAULT_PREFS
}

const SORT_LABEL: Record<SortKey, string> = { recency: 'Recency', az: 'A–Z', pct: '% Collected' }

function compare(a: SeriesSummary, b: SeriesSummary, key: SortKey): number {
  if (key === 'az') return a.name.localeCompare(b.name)
  if (key === 'pct') return a.progress.pct - b.progress.pct
  const ad = a.firstReleaseOn ? Date.parse(a.firstReleaseOn) : Number.NEGATIVE_INFINITY
  const bd = b.firstReleaseOn ? Date.parse(b.firstReleaseOn) : Number.NEGATIVE_INFINITY
  return ad - bd
}

function sortSeries(list: SeriesSummary[], key: SortKey, dir: SortDir): SeriesSummary[] {
  const sorted = [...list].sort((a, b) => compare(a, b, key))
  return dir === 'asc' ? sorted : sorted.reverse()
}

// Overall series completion (issues yscpfd + hln3d0) — owned cards / total cards
// across the series, drawn as a small ring on the card's right side. Uses the same
// danger→primary gradient the set-page progress bar uses; the gradient def itself
// lives once at the page root (see RING_GRADIENT_ID) so cards can share it.
const RING_GRADIENT_ID = 'series-ring-grad'

function CompletionRing({ owned, total, pct }: { owned: number; total: number; pct: number }) {
  const size = 56
  const stroke = 5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, pct))
  const label = `Completion: ${owned.toLocaleString()} of ${total.toLocaleString()} cards (${pct}%)`
  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className="relative shrink-0 self-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a1d24" strokeWidth={stroke} />
        {clamped > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${RING_GRADIENT_ID})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped / 100)}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold leading-none text-text-primary">
        {pct}%
      </span>
    </div>
  )
}

function SeriesCard({ s }: { s: SeriesSummary }) {
  return (
    <Link
      to="/series/$series"
      params={{ series: s.slug }}
      className="flex items-stretch justify-between gap-[16px] rounded-lg border border-border-default bg-surface-tertiary p-[20px] hover:border-surface-quaternary"
      style={{ minHeight: 178 }}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          {/* representative set logo — the series' base/namesake set (e.g. the
              "Scarlet & Violet" set for the Scarlet & Violet era). Falls back to
              nothing (the name below always shows) if absent or the fetch fails. */}
          <div className="mb-[12px] flex h-[48px] items-center">
            {/mc ?donald/i.test(s.name) ? (
              <McdonaldsMark size={48} />
            ) : (
              s.repSetId && (
                <img
                  src={setAssetUrl(s.repSetId, 'logo')}
                  alt=""
                  className="max-h-[48px] max-w-[180px] object-contain"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              )
            )}
          </div>
          <div className="text-[18px] font-semibold leading-[27px] text-text-primary">{s.name}</div>
          <div className="mt-[2px] text-[12px] text-text-muted">First released {fmtDate(s.firstReleaseOn)}</div>
        </div>
        <div className="mt-[16px] flex gap-[24px]">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Sets</div>
            <div className="text-[18px] font-bold text-text-primary">{s.setCount}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Cards</div>
            <div className="text-[18px] font-bold text-text-primary">{s.cardCount.toLocaleString()}</div>
          </div>
        </div>
      </div>
      <CompletionRing owned={s.progress.owned} total={s.progress.total} pct={s.progress.pct} />
    </Link>
  )
}

function CardGrid({ list }: { list: SeriesSummary[] }) {
  return (
    <div className="grid gap-[24px] [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
      {list.map((s) => (
        <SeriesCard key={s.slug} s={s} />
      ))}
    </div>
  )
}

// Compact toolbar — inline beside the header on ≥sm; stacked inside the mobile
// popover (issue h09o57) when `stacked`.
interface ControlsProps {
  prefs: Prefs
  onChange: (p: Prefs) => void
  onSave: () => void
  saved: boolean
}

function Controls({ prefs, onChange, onSave, saved, stacked = false }: ControlsProps & { stacked?: boolean }) {
  const ctrl =
    'h-[34px] rounded-md border border-border-default bg-surface-tertiary px-[10px] text-[13px] text-text-primary hover:border-surface-quaternary'
  // Inline + stacked variants can be mounted at once (mobile popover vs ≥sm
  // toolbar), so the select id must differ between them.
  const sortId = stacked ? 'series-sort-mobile' : 'series-sort'
  return (
    <div className={stacked ? 'flex flex-col items-stretch gap-[8px]' : 'flex flex-wrap items-center gap-[8px]'}>
      <label className="sr-only" htmlFor={sortId}>
        Sort by
      </label>
      <select
        id={sortId}
        className={ctrl}
        value={prefs.sortKey}
        onChange={(e) => onChange({ ...prefs, sortKey: e.target.value as SortKey })}
      >
        {SORT_KEYS.map((k) => (
          <option key={k} value={k}>
            {SORT_LABEL[k]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={ctrl}
        aria-label={prefs.sortDir === 'asc' ? 'Ascending' : 'Descending'}
        onClick={() => onChange({ ...prefs, sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' })}
      >
        {prefs.sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
      </button>
      <button
        type="button"
        className={[ctrl, prefs.groupByOwned ? 'text-action-primary' : ''].join(' ')}
        aria-pressed={prefs.groupByOwned}
        onClick={() => onChange({ ...prefs, groupByOwned: !prefs.groupByOwned })}
      >
        {prefs.groupByOwned ? '✓ ' : ''}Group by owned
      </button>
      <button type="button" className={ctrl} onClick={onSave}>
        {saved ? 'Saved ✓' : 'Save as default'}
      </button>
    </div>
  )
}

// Mobile-only (<sm) collapse of the toolbar into a single icon button on the
// heading row that opens a popover (issue h09o57). Dismissal mirrors the
// OwnFilterMenu pattern in PokedexIndex: tap-outside + Escape.
function MobileControls(props: ControlsProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative sm:hidden">
      <button
        type="button"
        aria-label="Sort & group options"
        aria-haspopup="true"
        aria-expanded={open}
        title="Sort & group options"
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex h-[38px] w-[38px] items-center justify-center rounded-lg border',
          open
            ? 'border-action-primary bg-surface-tertiary text-text-primary'
            : 'border-border-default bg-surface-tertiary text-text-body hover:border-surface-quaternary',
        ].join(' ')}
      >
        <Icon name="sliders" size={18} />
      </button>
      {open && (
        <div
          role="group"
          aria-label="Sort & group options"
          className="absolute right-0 z-20 mt-[6px] w-[210px] rounded-lg border border-border-default bg-surface-primary p-[10px] shadow-lg"
        >
          <Controls {...props} stacked />
        </div>
      )}
    </div>
  )
}

export function SeriesIndex() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['series'],
    queryFn: ({ signal }) => api.series(signal),
  })

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [savedFlash, setSavedFlash] = useState(false)
  const [showOthers, setShowOthers] = useState(false)
  const savedFlashTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (savedFlashTimer.current != null) clearTimeout(savedFlashTimer.current)
    }
  }, [])

  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
      setSavedFlash(true)
      if (savedFlashTimer.current != null) clearTimeout(savedFlashTimer.current)
      savedFlashTimer.current = window.setTimeout(() => setSavedFlash(false), 1600)
    } catch {
      /* storage may be unavailable (private mode); no-op */
    }
  }

  const { owned, others, flat } = useMemo(() => {
    const series = data?.series ?? []
    const sorted = sortSeries(series, prefs.sortKey, prefs.sortDir)
    if (!prefs.groupByOwned) return { owned: [], others: [], flat: sorted }
    return {
      owned: sorted.filter((s) => s.progress.owned > 0),
      others: sorted.filter((s) => s.progress.owned <= 0),
      flat: [],
    }
  }, [data, prefs.sortKey, prefs.sortDir, prefs.groupByOwned])

  return (
    <Content cap={1200}>
      {/* Shared stroke gradient for the per-card completion rings — same
          danger→primary ramp as the set-page progress bar. */}
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={RING_GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-action-danger)" />
            <stop offset="100%" stopColor="var(--color-action-primary-strong)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="mb-[24px] flex flex-wrap items-start justify-between gap-[16px]">
        <div className="min-w-0">
          <h1 className="mb-[4px] text-[24px] font-bold leading-[36px] text-text-primary">Series</h1>
          <p className="text-[14px] text-text-muted">
            Every Pokémon TCG (English) era.{' '}
            <span className="text-link">{data?.series.length ?? 0} series</span>.
          </p>
        </div>
        {data && (
          <>
            <div className="hidden sm:block">
              <Controls prefs={prefs} onChange={setPrefs} onSave={savePrefs} saved={savedFlash} />
            </div>
            <MobileControls prefs={prefs} onChange={setPrefs} onSave={savePrefs} saved={savedFlash} />
          </>
        )}
      </div>

      {isLoading && <Spinner label="Loading series…" />}
      {error && <ErrorState message={(error as Error).message} />}

      {data && !prefs.groupByOwned && <CardGrid list={flat} />}

      {data && prefs.groupByOwned && (
        <div className="flex flex-col gap-[24px]">
          {owned.length > 0 ? (
            <CardGrid list={owned} />
          ) : (
            <p className="text-[14px] text-text-muted">No series collected yet — expand below to browse them all.</p>
          )}

          {others.length > 0 && (
            <div className="border-t border-border-default pt-[20px]">
              <button
                type="button"
                onClick={() => setShowOthers((v) => !v)}
                aria-expanded={showOthers}
                className="flex w-full items-center justify-between rounded-lg border border-border-default bg-surface-tertiary px-[16px] py-[12px] text-[14px] font-semibold text-text-primary hover:border-surface-quaternary"
              >
                <span>
                  {showOthers ? 'Hide' : 'Show'} {others.length} series with no cards collected
                </span>
                <span className="text-text-muted">{showOthers ? '▲' : '▼'}</span>
              </button>
              {showOthers && (
                <div className="mt-[24px]">
                  <CardGrid list={others} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Content>
  )
}
