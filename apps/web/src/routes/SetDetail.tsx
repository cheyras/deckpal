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
import { type CardSearch } from './setSearch'

export function SetDetail() {
  const { series, set } = useParams({ from: '/series/$series/$set' })
  const search = useSearch({ from: '/series/$series/$set' })
  const navigate = useNavigate({ from: '/series/$series/$set' })

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
      if (c.ownership.have) have++
      if (c.ownership.need) need++
      if (c.ownership.dupe) dupes++
    }
    return { have, need, dupes }
  }, [allCards])

  const cards = useMemo(() => {
    if (search.own === 'all') return allCards
    return allCards.filter((c) =>
      search.own === 'have' ? c.ownership.have : search.own === 'need' ? c.ownership.need : c.ownership.dupe,
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
          <SetHeader data={data} goal={search.goal} />

          {/* filter bar */}
          <div className="mt-[24px] flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center gap-[16px]">
              <SearchBox value={search.q} onChange={(v) => patch({ q: v })} />
              <div className="min-w-0 flex-1">
                <SortChips search={search} patch={patch} />
              </div>
            </div>
            <OwnershipStrip search={search} patch={patch} counts={counts} />
            <div className="flex flex-wrap items-center justify-between gap-[12px]">
              <VariantLegend />
              <ViewToggle view={search.view} patch={patch} />
            </div>
          </div>

          {/* active view */}
          <div className="mt-[24px]" style={{ opacity: isFetching ? 0.6 : 1 }}>
            {cards.length === 0 ? (
              <div className="py-[60px] text-center text-[14px] text-text-muted">
                No cards match this filter.
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
    </Content>
  )
}
