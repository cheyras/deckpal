import { useEffect, useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useParams, useSearch, useNavigate } from '@tanstack/react-router'
import { api } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill } from '../components/ui'
import { SetHeader } from '../components/SetHeader'
import { OwnershipStrip, SearchBox, SortChips, VariantLegend, ViewToggle } from '../components/FilterControls'
import { GridView, type GridReveal } from '../components/GridView'
import { BinderView } from '../components/BinderView'
import { TableView } from '../components/TableView'
import { CardSheet } from './CardDetail'
import { type CardSearch } from './setSearch'
import { useSignedIn } from '../lib/session'
import { DECKE_REVEAL_EVENT, type DeckeRevealDetail } from '../character/host/uiTools'
import { useLateEntrance } from '../lib/lateEntrance'

/**
 * How long a request for the same card is treated as the one already in flight.
 *
 * Deck-E repeats his ask every 400 ms while he waits (`REVEAL_RETRY_MS`), so
 * without a window here every retry would restart the scroll from wherever the
 * last one had got to and the page would crawl instead of travelling. Longer
 * than a browser's smooth scroll takes, and short enough that a SECOND, later
 * request for the same card — a reader who scrolled away and asked again — is
 * answered rather than swallowed. It is a dedupe, not a mute.
 */
const REVEAL_DEDUPE_MS = 2000

/**
 * The page's half of the reveal seam.
 *
 * The owner's spec, verbatim: *"bring up the set page … then scrolled down the
 * page for me to the specific card … so it looks like he's flying down the page
 * to the card."* Deck-E cannot do the middle step himself: the card grid is
 * virtualized, so a tile two thousand pixels below the fold is not merely
 * off-screen, it is ABSENT, and the wait he does for every other landmark can
 * never finish. `character/host/uiTools.ts` describes the whole handshake; this
 * is the end of it that knows what is on this page.
 *
 * ── WHY IT LIVES AT THE ROUTE, ABOVE THE GRID ────────────────────────────────
 *
 * Because the request usually arrives BEFORE there is a grid to answer it. The
 * common shape is a `goTo` that navigates here and then waits for a tile, so
 * the ask lands while the set query is still in the air and the page is a
 * spinner. This component is mounted for all of that, and the grid is not — so
 * the route remembers the request and the grid honours it whenever rows exist,
 * which is the same reason Deck-E's landmarks are marked at the route level too.
 *
 * ── AND WHY THE TEST IS THE SET PREFIX, NOT THE LOADED ROWS ──────────────────
 *
 * `me05-084` belongs to `me05` by construction (card ids are `<setId>-<number>`,
 * and the tiles' own count boxes already build them that way). Asking the
 * prefix rather than searching `cards` is what lets an empty, still-loading page
 * accept a request it cannot yet act on — and what makes a page for a DIFFERENT
 * set ignore it, silently and correctly, while it is still mounted mid-navigation.
 */
function useCardReveal(setId: string): GridReveal | null {
  const [reveal, setReveal] = useState<GridReveal | null>(null)
  useEffect(() => {
    const onReveal = (e: Event) => {
      const cardId = (e as CustomEvent<DeckeRevealDetail>).detail?.cardId
      if (!cardId || !cardId.startsWith(`${setId}-`)) return
      setReveal((prev) =>
        // The SAME object back is how a repeat is deduped: React bails out of
        // the update, and the grid's effect — which keys on this identity —
        // never re-runs, so a scroll already under way is left to finish.
        prev && prev.cardId === cardId && Date.now() - prev.at < REVEAL_DEDUPE_MS
          ? prev
          : { cardId, at: Date.now() },
      )
    }
    window.addEventListener(DECKE_REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(DECKE_REVEAL_EVENT, onReveal)
  }, [setId])
  return reveal
}

export function SetDetail() {
  const { series, set } = useParams({ from: '/series/$series/$set' })
  const search = useSearch({ from: '/series/$series/$set' })
  const navigate = useNavigate({ from: '/series/$series/$set' })
  // Logged out, the API omits every card's `ownership` block, so the Have/Need/
  // Dupes tabs and the goal selector have nothing to filter on. The sign-up
  // prompt lives in the header, where the progress bars were (SetHeader).
  const signedOut = useSignedIn() === false

  // Merge and navigate; the route's stripSearchParams middleware drops
  // default-valued keys so the canonical URL only carries deviations.
  const patch = (p: Partial<CardSearch>) => {
    const next: CardSearch = { ...search, ...p }
    if (p.sort || p.own || p.goal || p.q !== undefined) next.page = 1
    navigate({ search: next as never, resetScroll: false })
  }

  // Fetch the whole set once per (set, goal, sort, dir, q) with own=all. The
  // ownership strip counts and the have/need/dupes filter are computed
  // client-side so switching them is instant and all four counts stay visible.
  const params = new URLSearchParams({
    own: 'all',
    goal: search.goal,
    sort: search.sort,
    dir: search.dir,
    pageSize: '250',
  })
  if (search.q.trim()) params.set('q', search.q.trim())

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['set', set, search.goal, search.sort, search.dir, search.q.trim()],
    queryFn: ({ signal }) => api.set(set, params, signal),
    placeholderData: keepPreviousData,
  })
  // Issue #49: the wrapper entrance fires while this is still a spinner.
  const enter = useLateEntrance(isLoading && !data)

  const allCards = data?.cards ?? []
  const counts = useMemo(() => {
    let have = 0,
      need = 0,
      dupes = 0
    for (const c of allCards) {
      if (!c.ownership) continue
      if (c.ownership.have) have++
      if (c.ownership.need) need++
      if (c.ownership.dupe) dupes++
    }
    return { have, need, dupes }
  }, [allCards])

  // Deck-E asking for one card to be brought into view. See `useCardReveal`.
  const reveal = useCardReveal(set)

  const cards = useMemo(() => {
    if (search.own === 'all') return allCards
    return allCards.filter((c) =>
      c.ownership
        ? search.own === 'have'
          ? c.ownership.have
          : search.own === 'need'
            ? c.ownership.need
            : c.ownership.dupe
        : true,
    )
  }, [allCards, search.own])

  // THE OTHER TWO VIEWS, answered honestly rather than not at all. Only the
  // grid is virtualized, so only the grid needs a row index computed for it;
  // the table renders every row it has, which means a reveal there is the
  // ordinary browser problem of scrolling to an element that already exists.
  // Kept out of the grid's way by the view test — in grid view `GridView` owns
  // this, and two scrollers aiming at the same card would fight each other.
  // (The binder paginates rather than scrolls, so a card on another binder page
  // is still out of reach; it fails at the 6 s cap, politely, as before.)
  useEffect(() => {
    if (!reveal || search.view === 'grid') return
    let el: Element | null = null
    try {
      el = document.querySelector(`[data-decke-card="${CSS.escape(reveal.cardId)}"]`)
    } catch {
      el = null
    }
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [reveal, search.view, cards])

  return (
    <Content cap={1165}>
      <div className="mb-[16px]">
        <BackPill to="/series/$series" params={{ series }} label={data?.set.series.name ?? 'Series'} />
      </div>

      {isLoading && !data && <Spinner label="Loading set…" />}
      {error && <ErrorState message={(error as Error).message} className={enter} />}

      {data && (
        <>
          {/* Deck-E's landmarks are added at the ROUTE level wherever the route
              is what composes the piece — a wrapper here beats reaching into
              SetHeader, and it keeps the marking auditable from one file per
              page. The two exceptions on this page are the completion bar and
              the goal switcher, which live inside SetHeader and FilterControls
              respectively and cannot be addressed from out here at all. */}
          <div
            data-decke-set-header
            data-decke-landmark="[data-decke-set-header]"
            data-decke-label="the set header"
            data-decke-rank="container"
          >
            <SetHeader data={data} goal={search.goal} />
          </div>

          {/* filter bar */}
          <div className="mt-[24px] flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center gap-[16px]">
              <SearchBox value={search.q} onChange={(v) => patch({ q: v })} />
              {/* Full-width own row on mobile so the sort chips scroll within the
                  viewport instead of spilling off-page; shares the row on sm+. */}
              <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                <SortChips search={search} patch={patch} />
              </div>
            </div>
            {!signedOut && <OwnershipStrip search={search} patch={patch} counts={counts} />}
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              <VariantLegend />
              <div
                data-decke-view-toggle
                data-decke-landmark="[data-decke-view-toggle]"
                data-decke-label="the grid / table / binder view toggle"
              >
                <ViewToggle view={search.view} patch={patch} />
              </div>
            </div>
          </div>

          {/* active view */}
          <div
            className={`mt-[24px] ${enter}`}
            style={{ opacity: isFetching ? 0.6 : 1 }}
            data-decke-card-grid
            data-decke-landmark="[data-decke-card-grid]"
            data-decke-label="the card grid"
            data-decke-rank="container"
          >
            {cards.length === 0 ? (
              <div className="py-[60px] text-center text-[14px] text-text-muted">
                {allCards.length === 0 ? 'No cards in this set yet.' : 'No cards match this filter.'}
              </div>
            ) : search.view === 'grid' ? (
              <GridView cards={cards} seriesSlug={series} setId={set} reveal={reveal} />
            ) : search.view === 'binder' ? (
              <BinderView cards={cards} />
            ) : (
              <TableView cards={cards} seriesSlug={series} setId={set} />
            )}
          </div>
        </>
      )}

      {/* Card detail as a bottom-sheet driven by the ?card= search param. Rendering
          it here (rather than navigating to the card route) keeps SetDetail mounted,
          so scroll position + q/sort/goal/own filters survive an open→close cycle. */}
      {search.card && (
        <CardSheet
          series={series}
          set={set}
          number={search.card}
          onClose={() =>
            navigate({ search: ((prev: CardSearch) => ({ ...prev, card: undefined })) as never, resetScroll: false })
          }
        />
      )}
    </Content>
  )
}
