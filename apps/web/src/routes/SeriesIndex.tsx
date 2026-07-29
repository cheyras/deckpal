import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api, type SeriesSummary } from '../lib/api'
import { Content, Spinner, ErrorState, setAssetUrl, McdonaldsMark } from '../components/ui'
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
const PREFS_KEY = 'pokedex.series.prefs'
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

function SeriesCard({ s }: { s: SeriesSummary }) {
  const pct = Math.min(100, s.progress.pct)
  return (
    <Link
      to="/series/$series"
      params={{ series: s.slug }}
      className="flex flex-col justify-between rounded-lg border border-border-default bg-surface-tertiary p-[20px] hover:border-surface-quaternary"
      style={{ minHeight: 178 }}
    >
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
      {/* Overall series completion (issue yscpfd) — owned cards / total cards across
          the series. Bar styling matches the set-page progress bar. */}
      <div className="mt-[16px]">
        <div className="mb-[6px] flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Completion</span>
          <span className="text-[11px] text-text-muted">
            {s.progress.owned.toLocaleString()}/{s.progress.total.toLocaleString()} · {s.progress.pct}%
          </span>
        </div>
        <div className="h-[4px] w-full overflow-hidden rounded-full bg-[#1a1d24]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--color-action-danger), var(--color-action-primary-strong))',
            }}
          />
        </div>
      </div>
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

// Compact toolbar — wraps cleanly at 390px, right-aligned beside the header.
function Controls({
  prefs,
  onChange,
  onSave,
  saved,
}: {
  prefs: Prefs
  onChange: (p: Prefs) => void
  onSave: () => void
  saved: boolean
}) {
  const ctrl =
    'h-[34px] rounded-md border border-border-default bg-surface-tertiary px-[10px] text-[13px] text-text-primary hover:border-surface-quaternary'
  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      <label className="sr-only" htmlFor="series-sort">
        Sort by
      </label>
      <select
        id="series-sort"
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

export function SeriesIndex() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['series'],
    queryFn: ({ signal }) => api.series(signal),
  })

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [savedFlash, setSavedFlash] = useState(false)
  const [showOthers, setShowOthers] = useState(false)

  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 1600)
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
      <div className="mb-[24px] flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h1 className="mb-[4px] text-[24px] font-bold leading-[36px] text-text-primary">Series</h1>
          <p className="text-[14px] text-text-muted">
            Every Pokémon TCG (English) era.{' '}
            <span className="text-link">{data?.series.length ?? 0} series</span>.
          </p>
        </div>
        {data && <Controls prefs={prefs} onChange={setPrefs} onSave={savePrefs} saved={savedFlash} />}
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
