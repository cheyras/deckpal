import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api, type SeriesSummary } from '../lib/api'
import { Content, Spinner, ErrorState, SetSymbolTile, ProgressRing, useDismiss } from '../components/ui'
import { SetLogo } from '../components/SetLogo'
import { Icon } from '../components/Icon'
import { fmtDate } from '../lib/format'
import { useSignedIn } from '../lib/session'
import { SignInPrompt } from '../components/SignInPrompt'
import { tailwindGradientStops } from '../lib/gradientPalette'
import { useLateEntrance } from '../lib/lateEntrance'

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
const PREFS_KEY = 'deckpal.series.prefs'
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
  // `progress` is absent for a logged-out visitor; the '% Collected' sort and
  // the group-by-owned split are hidden in that state, so this is belt and
  // braces for a stale saved preference rather than a live code path.
  if (key === 'pct') return (a.progress?.pct ?? 0) - (b.progress?.pct ?? 0)
  const ad = a.firstReleaseOn ? Date.parse(a.firstReleaseOn) : Number.NEGATIVE_INFINITY
  const bd = b.firstReleaseOn ? Date.parse(b.firstReleaseOn) : Number.NEGATIVE_INFINITY
  return ad - bd
}

function sortSeries(list: SeriesSummary[], key: SortKey, dir: SortDir): SeriesSummary[] {
  const sorted = [...list].sort((a, b) => compare(a, b, key))
  return dir === 'asc' ? sorted : sorted.reverse()
}

// Overall series completion (issues yscpfd + hln3d0) — owned cards / total cards
// across the series, drawn as a small ring on the card's right side. Uses the
// same derived two-hue-away gradient the set-page progress bar uses (see
// lib/gradientPalette); the gradient def itself lives once at the page root
// (see RING_GRADIENT_ID) so cards can share it.
const RING_GRADIENT_ID = 'series-ring-grad'
// action-primary-strong is cyan-300 (theme.css) — keep this in sync if that
// token's hue family changes.
const [RING_GRADIENT_FROM, RING_GRADIENT_TO] = tailwindGradientStops('cyan', '300')

function CompletionRing({ owned, total, pct }: { owned: number; total: number; pct: number }) {
  return (
    <ProgressRing
      pct={pct}
      gradientId={RING_GRADIENT_ID}
      label={`Completion: ${owned.toLocaleString()} of ${total.toLocaleString()} cards (${pct}%)`}
      className="self-center"
    >
      <span className="text-[14px] font-bold leading-none text-text-primary">{pct}%</span>
    </ProgressRing>
  )
}

function SeriesCard({ s }: { s: SeriesSummary }) {
  return (
    <Link
      to="/series/$series"
      params={{ series: s.slug }}
      className="flex items-stretch justify-between gap-[16px] rounded-lg border border-border-default bg-surface-tertiary p-[20px] hover:border-surface-quaternary"
      style={{ minHeight: 178 }}
      // Deck-E can fly to and ring this card. The selector he is handed is the
      // one written here, so it must be UNIQUE on the page and must not depend
      // on class names or DOM position — both of which this file has already
      // rewritten more than once. It keys off the series SLUG, which is a
      // catalog identifier; the series NAME goes in the label instead, because
      // the label is prose he says out loud and the selector is a capability.
      //
      // PRESSABLE, and reviewed as such — the second authorisation on top of
      // the landmark (`resolveClickTarget`, `character/host/uiTools.ts`):
      //   1. NO WRITE. The whole card is one `<Link>` with no `onClick`, no
      //      mutation and no request of its own.
      //   2. ALLOWLISTED. It resolves to `/series/<slug>`, and `/series` is on
      //      `ROUTE_ALLOWLIST`. The slug is a catalog identifier from the API,
      //      not free text, and `resolveClickTarget` re-checks the resolved
      //      `href` against the same allowlist and origin at press time.
      //   3. NOT AUTH. No token, sign-out, billing or destructive surface is
      //      anywhere in this subtree.
      //   4. GENUINE NAVIGATION — the hop from /series to a series page is the
      //      middle leg of the journey this attribute exists to make possible.
      data-decke-series={s.slug}
      data-decke-landmark={`[data-decke-series="${s.slug}"]`}
      data-decke-clickable
      data-decke-label={`the ${s.name} series card`}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          {/* representative set logo — the series' base/namesake set (e.g. the
              "Scarlet & Violet" set for the Scarlet & Violet era). Three series
              (McDonald's Collection, Trainer kits, Miscellaneous) have no upstream
              logo for *any* of their sets, so the API picks their rep set by symbol
              instead and we show that real set symbol on its white tile rather than
              a blank band (issue #15). Falls back to nothing — the name below always
              shows — when neither asset exists or the fetch fails. */}
          <div className="mb-[12px] flex h-[48px] items-center">
            {s.repSetId &&
              (s.repHasLogo ? (
                <SetLogo setId={s.repSetId} imgClassName="max-h-[48px] max-w-[180px]" />
              ) : (
                <SetSymbolTile setId={s.repSetId} name={s.name} size={48} />
              ))}
          </div>
          <div className="font-display text-[18px] font-semibold leading-[27px] text-text-primary">{s.name}</div>
          <div className="mt-[2px] text-[14px] text-text-muted">First released {fmtDate(s.firstReleaseOn)}</div>
        </div>
        <div className="mt-[16px] flex gap-[24px]">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Sets</div>
            <div className="text-[18px] font-bold text-text-primary">{s.setCount}</div>
          </div>
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Cards</div>
            <div className="text-[18px] font-bold text-text-primary">{s.cardCount.toLocaleString()}</div>
          </div>
        </div>
      </div>
      {s.progress && <CompletionRing owned={s.progress.owned} total={s.progress.total} pct={s.progress.pct} />}
    </Link>
  )
}

/**
 * `group` is not decoration — it is what keeps the grid's landmark selector
 * unique. This page renders CardGrid up to TWICE (collected above, the rest
 * below the "show all" disclosure), so a bare `[data-decke-series-grid]` would
 * match two elements and Deck-E would fly to whichever one `querySelector`
 * happened to return first. `data-decke-rank="container"` puts the grid ahead of
 * its own cards when the per-turn landmark budget has to drop some of them
 * (see `collectLandmarks` in `character/host/useDeckeChat.ts`).
 */
function CardGrid({ list, group, label, className = '' }: { list: SeriesSummary[]; group: string; label: string; className?: string }) {
  return (
    <div
      className={`grid gap-[24px] [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] ${className}`}
      data-decke-series-grid={group}
      data-decke-landmark={`[data-decke-series-grid="${group}"]`}
      data-decke-label={label}
      data-decke-rank="container"
    >
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
  /** Hides the two controls that sort/group on ownership. */
  signedOut: boolean
}

function Controls({ prefs, onChange, onSave, saved, signedOut, stacked = false }: ControlsProps & { stacked?: boolean }) {
  const ctrl =
    'h-[34px] rounded-md border border-border-default bg-surface-tertiary px-[10px] text-[14px] text-text-primary hover:border-surface-quaternary'
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
        {SORT_KEYS.filter((k) => !(signedOut && k === 'pct')).map((k) => (
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
      {/* Both of these sort/group on ownership the visitor doesn't have yet. */}
      {!signedOut && (
        <button
          type="button"
          className={[ctrl, prefs.groupByOwned ? 'text-action-primary' : ''].join(' ')}
          aria-pressed={prefs.groupByOwned}
          onClick={() => onChange({ ...prefs, groupByOwned: !prefs.groupByOwned })}
        >
          {prefs.groupByOwned ? '✓ ' : ''}Group by owned
        </button>
      )}
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
  const close = useCallback(() => setOpen(false), [])
  const wrapRef = useDismiss<HTMLDivElement>(open, close)

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
  const enter = useLateEntrance(isLoading)
  const signedIn = useSignedIn()
  const signedOut = signedIn === false

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

  const groupByOwned = prefs.groupByOwned && !signedOut
  const { owned, others, flat } = useMemo(() => {
    const series = data?.series ?? []
    const sorted = sortSeries(series, prefs.sortKey, prefs.sortDir)
    if (!groupByOwned) return { owned: [], others: [], flat: sorted }
    return {
      owned: sorted.filter((s) => (s.progress?.owned ?? 0) > 0),
      others: sorted.filter((s) => (s.progress?.owned ?? 0) <= 0),
      flat: [],
    }
  }, [data, prefs.sortKey, prefs.sortDir, groupByOwned])

  return (
    <Content cap={1200}>
      {/* Shared stroke gradient for the per-card completion rings — same
          derived two-hue-away ramp as the set-page progress bar (lib/gradientPalette). */}
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={RING_GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={RING_GRADIENT_FROM} />
            <stop offset="100%" stopColor={RING_GRADIENT_TO} />
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
              <Controls prefs={prefs} onChange={setPrefs} onSave={savePrefs} saved={savedFlash} signedOut={signedOut} />
            </div>
            <MobileControls prefs={prefs} onChange={setPrefs} onSave={savePrefs} saved={savedFlash} signedOut={signedOut} />
          </>
        )}
      </div>

      {isLoading && <Spinner label="Loading series…" />}
      {error && <ErrorState message={(error as Error).message} className={enter} />}

      {/* Where the collection rings would be. One prompt for the page, not one
          per card — 21 sign-up buttons is an advert, not an affordance. */}
      {signedOut && (
        <div className="mb-[24px]">
          <SignInPrompt
            variant="banner"
            title="Track what you own"
            detail="Sign in to see how much of each era you've collected, set by set."
          />
        </div>
      )}

      {data && !groupByOwned && <CardGrid list={flat} group="all" label="the series grid" className={enter} />}

      {data && groupByOwned && (
        <div className={`flex flex-col gap-[24px] ${enter}`}>
          {owned.length > 0 ? (
            <CardGrid list={owned} group="owned" label="the grid of series you have collected" />
          ) : (
            <p className="text-[14px] text-text-muted">No series collected yet — expand below to browse them all.</p>
          )}

          {/* Revealing the uncollected series is one-way, and the control does not
              become its own undo (issue #51): once you have asked for the rest of
              the catalog, the button and the rule that introduced it have said
              everything they had to say, and leaving a "Hide" in their place put a
              row of chrome between the two groups for the rest of the session. The
              top-level split by collected/not-collected is unchanged — it is the
              24px group gap that carries it, not the divider. */}
          {others.length > 0 &&
            (showOthers ? (
              <CardGrid list={others} group="others" label="the grid of series you have not started" />
            ) : (
              <div className="border-t border-border-default pt-[20px]">
                <button
                  type="button"
                  onClick={() => setShowOthers(true)}
                  className="flex w-full items-center justify-between rounded-lg border border-border-default bg-surface-tertiary px-[16px] py-[12px] text-[14px] font-semibold text-text-primary hover:border-surface-quaternary"
                  // Marked because of what browser verification found: on an
                  // account that has collected nothing — a brand-new user, and
                  // the QA account the gates run as — the owned grid is replaced
                  // by a sentence and every other series is behind this button.
                  // The page then has NO landmarks at all, and Deck-E asked
                  // about a series on the series page can only shrug. This is
                  // the one thing on the page worth pointing at in that state.
                  //
                  // PRESSABLE, and reviewed as such.
                  //
                  // `data-decke-clickable` is a SECOND authorisation on top of
                  // the landmark, because pointable is not pressable. This one
                  // earns it: its handler is `setShowAll(true)` and nothing
                  // else — pure local disclosure, no request, no write, no
                  // navigation away.
                  //
                  // It matters most on THIS page. For a collector who owns
                  // nothing — every new account, and the QA account the gates
                  // run as — every series on /series is behind this button, so
                  // without it he can see nothing on the page most likely to be
                  // asked about.
                  data-decke-show-others
                  data-decke-landmark="[data-decke-show-others]"
                  data-decke-clickable
                  data-decke-label="the button that reveals the series you have not collected"
                >
                  <span>Show {others.length} series with no cards collected</span>
                  <span className="text-text-muted">▼</span>
                </button>
              </div>
            ))}
        </div>
      )}
    </Content>
  )
}
