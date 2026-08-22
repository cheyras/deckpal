import { useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useParams, useSearch, useNavigate } from '@tanstack/react-router'
import { api } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill } from '../components/ui'
import { SetHeader } from '../components/SetHeader'
import { OwnershipStrip, SearchBox, SortChips, VariantLegend, ViewToggle } from '../components/FilterControls'
import { GridView } from '../components/GridView'
import { BinderView } from '../components/BinderView'
import { TableView } from '../components/TableView'
import { CardSheet } from './CardDetail'
import { type CardSearch } from './setSearch'
import { useSignedIn } from '../lib/session'

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

  return (
    <Content cap={1165}>
      <div className="mb-[16px]">
        <BackPill to="/series/$series" params={{ series }} label={data?.set.series.name ?? 'Series'} />
      </div>

      {isLoading && !data && <Spinner label="Loading set…" />}
      {error && <ErrorState message={(error as Error).message} />}

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
            className="mt-[24px]"
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
              <GridView cards={cards} seriesSlug={series} setId={set} />
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
