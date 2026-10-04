import { useDesktopTable } from '../lib/useDesktopTable'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useParams, useSearch, useNavigate } from '@tanstack/react-router'
import { api, ApiError, type SetDetailResponse } from '../lib/api'
import { fmtCalendarDate } from '../lib/format'
import { usePageMeta, type PageMeta } from '../lib/seo'
import { Content, Spinner, ErrorState, BackPill } from '../components/ui'
import { SetHeader } from '../components/SetHeader'
import { OwnershipStrip, SearchBox, SortChips, VariantLegend, ViewToggle } from '../components/FilterControls'
import { GridView, type GridReveal } from '../components/GridView'
import { BinderView } from '../components/BinderView'
import { TableView } from '../components/TableView'
import { CardSheet } from './CardDetail'
import { type CardSearch } from './setSearch'
import { useSignedIn } from '../lib/session'
import {
  DECKE_REVEAL_EVENT,
  DECKE_REVEAL_MISS_EVENT,
  pendingReveal,
  type DeckeRevealDetail,
  type DeckeRevealMissDetail,
} from '../character/host/uiTools'
import { useLateEntrance } from '../lib/lateEntrance'

/**
 * How long a request for the same card is treated as the one already in flight.
 *
 * Deck-E repeats his ask every 400 ms while he waits (`REVEAL_RETRY_MS`), and
 * handing the grid a new request object on every retry would re-render it for
 * nothing. Short enough that a SECOND, later request for the same card — a
 * reader who scrolled away and asked again — is answered rather than
 * swallowed. It is a dedupe, not a mute.
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
  // Seeded from an ask already in flight: the page usually mounts just AFTER he
  // asked, and waiting for his next retry left its header on screen for up to
  // 400 ms before the grid could answer. See `pendingReveal`.
  const [reveal, setReveal] = useState<GridReveal | null>(() => {
    const p = pendingReveal()
    return p?.cardId?.startsWith(`${setId}-`) ? { cardId: p.cardId, at: Date.now() } : null
  })
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

/** Search results cut a title off at about this many characters. */
const TITLE_MAX = 65

/**
 * This page's title and description, from the set header's own facts.
 *
 * "and prices" is only claimed when the set has a market value, which is the
 * header's sign that its cards are priced; an unpriced set (old promos, a set
 * released this week) is described by what its tiles do show. The title drops
 * the series, then the prices, when a long set name would run it past the cut.
 */
function setMeta(data: SetDetailResponse): PageMeta {
  const { name, series, cardCountTotal, releasedOn, marketValueUsd } = data.set
  const priced = marketValueUsd != null
  const listed = priced ? `${name} card list and prices` : `${name} card list`
  const titles = [name === series.name ? listed : `${listed} · ${series.name}`, listed, `${name} card list`]
  const date = fmtCalendarDate(releasedOn)
  const cards =
    cardCountTotal === 1
      ? `The one card in ${name}`
      : cardCountTotal > 0
        ? `All ${cardCountTotal.toLocaleString('en-US')} cards in ${name}`
        : `The ${name} card list`
  const released = releasedOn && date !== '—' ? `, released ${date}` : ''
  const shows = priced ? ', with TCGplayer market prices, updated daily.' : ", with each card's number and rarity."
  return {
    title: titles.find((t) => t.length <= TITLE_MAX) ?? titles[titles.length - 1]!,
    description: `${cards} from the ${series.name} series${released}${shows}`,
  }
}

export function SetDetail() {
  const { series, set } = useParams({ from: '/series/$series/$set' })
  const search = useSearch({ from: '/series/$series/$set' })
  const navigate = useNavigate({ from: '/series/$series/$set' })
  // Logged out, the API omits every card's `ownership` block, so the Have/Need/
  // Dupes tabs and the goal selector have nothing to filter on. The sign-up
  // prompt lives in the header, where the progress bars were (SetHeader).
  const signedOut = useSignedIn() === false
  const desktopTable = useDesktopTable()
  const effectiveView = search.view === 'table' && !desktopTable ? 'grid' : search.view

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
  // `pageSize: '250'` is the API's cap, not a promise the set fits in one
  // request — `api.setAllCards` follows `pagination.pageCount` past it for
  // the 9 sets that don't (UXC-01), under this one query key so filters stay
  // client-side and instant either way.
  const params = new URLSearchParams({
    own: 'all',
    goal: search.goal,
    sort: search.sort,
    dir: search.dir,
    pageSize: '250',
  })
  if (search.q.trim()) params.set('q', search.q.trim())

  const { data, isLoading, error, isPlaceholderData } = useQuery({
    queryKey: ['set', set, search.goal, search.sort, search.dir, search.q.trim()],
    queryFn: ({ signal }) => api.setAllCards(set, params, signal),
    placeholderData: keepPreviousData,
  })
  // Issue #49: the wrapper entrance fires while this is still a spinner.
  const enter = useLateEntrance(isLoading && !data)

  // `keepPreviousData` holds the LAST set's rows while the next set loads, so a
  // placeholder from a different set is not this page's to describe. A filter
  // or sort change keeps the same set and keeps its title. The ?card= sheet
  // sets nothing: this page stays the one being described underneath it.
  const described = data && !(isPlaceholderData && data.set.setId !== set) ? data : null
  usePageMeta(
    described
      ? setMeta(described)
      : error
        ? { title: error instanceof ApiError && error.status === 404 ? 'Set not found' : 'Set unavailable', noindex: true }
        : null,
  )

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

  // NO VIEW SCROLLS FOR HIM. The grid mounts the requested row (see
  // `GridView`); the table and the binder already have every tile of theirs in
  // the document. In all three the tile existing is the whole answer, and his
  // flight drives the one scroll that brings it in — a page that also scrolled
  // "to help" was the second scroll owner that made the trip lurch twice.
  //
  // What only this page can add is a FAST NO. Once the set has loaded, a card
  // that is not in the rows on screen is never going to appear, and waiting out
  // his 6 s cap in a "loading" pose to discover that is dead air. So the page
  // says why, at once, in words he can repeat.
  const loaded = !!data && !isPlaceholderData
  useEffect(() => {
    if (!reveal || !loaded) return
    if (cards.some((c) => c.cardId === reveal.cardId)) return
    // What the page can honestly say depends on what it filtered. The have /
    // need / dupes filter runs here, over the whole set, so a card it hides is
    // known to exist. A search runs on the SERVER, so rows it left out say
    // nothing about the set — only that the search is hiding it or it is not
    // there, and the reader can tell which by clearing the box.
    const filtered = allCards.some((c) => c.cardId === reveal.cardId)
    const searching = !!search.q.trim()
    window.dispatchEvent(
      new CustomEvent<DeckeRevealMissDetail>(DECKE_REVEAL_MISS_EVENT, {
        detail: {
          cardId: reveal.cardId,
          reason: filtered
            ? 'that card is in this set, but the filter at the top is hiding it'
            : searching
              ? 'the search at the top of the page is hiding it, or it is not in this set'
              : 'that card is not in this set',
        },
      }),
    )
  }, [reveal, loaded, cards, allCards, search.q])

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
              the goal switcher, which both live inside SetHeader and cannot be
              addressed from out here at all. */}
          <div
            data-decke-set-header
            data-decke-landmark="[data-decke-set-header]"
            data-decke-label="the set header"
            data-decke-rank="container"
          >
            <SetHeader data={data} goal={search.goal} onGoalChange={(goal) => patch({ goal })} />
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
                data-decke-label={desktopTable ? 'the grid / table / binder view toggle' : 'the grid / binder view toggle'}
              >
                <ViewToggle view={effectiveView} patch={patch} />
              </div>
            </div>
          </div>

          {/* active view */}
          <div
            className={`mt-[24px] ${enter}`}
            // Dimmed only while it shows the PREVIOUS view's cards (a filter,
            // sort or goal change in flight). A background re-read after
            // logging (lib/collectionWrites) is not something to wait for, and
            // dimming for it greyed the grid after every tap (UXC-02).
            style={{ opacity: isPlaceholderData ? 0.6 : 1 }}
            data-decke-card-grid
            data-decke-landmark="[data-decke-card-grid]"
            data-decke-label="the card grid"
            data-decke-rank="container"
          >
            {cards.length === 0 ? (
              <div className="py-[60px] text-center text-[14px] text-text-muted">
                {allCards.length === 0 ? 'No cards in this set yet.' : 'No cards match this filter.'}
              </div>
            ) : effectiveView === 'grid' ? (
              <GridView cards={cards} seriesSlug={series} setId={set} reveal={reveal} />
            ) : effectiveView === 'binder' ? (
              <BinderView cards={cards} />
            ) : (
              <TableView cards={cards} seriesSlug={series} setId={set} reveal={reveal} activeCard={search.card ? `${set}-${search.card}` : undefined} />
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
