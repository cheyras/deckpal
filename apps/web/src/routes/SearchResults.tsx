import { useEffect, useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useSearch, useNavigate } from '@tanstack/react-router'
import { api, type CardRow, type SearchCard } from '../lib/api'
import { Content, Spinner, ErrorState } from '../components/ui'
import { SortChipStrip } from '../components/FilterControls'
import { Icon } from '../components/Icon'
import { GridView } from '../components/GridView'
import { type GlobalSearch, type GlobalSortKey } from './globalSearch'

const PAGE_SIZE = 60

const SORTS: { key: GlobalSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'number', label: 'Number' },
  { key: 'rarity', label: 'Rarity' },
  { key: 'price', label: 'Price' },
  { key: 'released', label: 'Released' },
]

// The catalog search endpoint returns no collection state — ownership is filled
// in per-tile by CardTile's VariantCounters, which fetch ['card', cardId] for the
// rows actually on screen. These zeroes are structural padding to satisfy CardRow
// and are never rendered: GridView is called without `ownership`, so CardTile
// leaves `owned` undefined and reads quantities from its own query instead.
const NO_OWNERSHIP = {
  totalQuantity: 0,
  requiredCount: 0,
  ownedRequired: 0,
  have: false,
  need: false,
  dupe: false,
}

function toCardRow(c: SearchCard): CardRow {
  return {
    cardId: c.cardId,
    number: c.number,
    numberSort: c.number,
    name: c.name,
    category: c.category,
    rarity: c.rarity,
    artist: c.artist,
    variantCount: c.variantCount,
    images: c.images,
    price: c.price,
    ownership: NO_OWNERSHIP,
    // Results span every set, so each tile routes off its own series/set — the
    // same mechanism list pages use.
    seriesSlug: c.series.slug,
    setId: c.set.setId,
  }
}

export function SearchResults() {
  const search = useSearch({ from: '/search' })
  const navigate = useNavigate({ from: '/search' })

  const patch = (p: Partial<GlobalSearch>) => {
    const next: GlobalSearch = { ...search, ...p }
    if (p.q !== undefined || p.sort || p.dir) next.page = 1
    navigate({ search: next as never, resetScroll: false })
  }

  // Local input state so typing stays responsive; the URL is the source of
  // truth and is updated on a debounce. Re-syncs when the URL changes from
  // elsewhere (header search, back button).
  const [term, setTerm] = useState(search.q)
  useEffect(() => setTerm(search.q), [search.q])
  useEffect(() => {
    if (term === search.q) return
    const t = setTimeout(() => patch({ q: term }), 300)
    return () => clearTimeout(t)
  }, [term])

  const trimmed = search.q.trim()
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['globalSearch', trimmed, search.sort, search.dir, search.page],
    queryFn: ({ signal }) => {
      const p = new URLSearchParams({
        q: trimmed,
        sort: search.sort,
        dir: search.dir,
        page: String(search.page),
        pageSize: String(PAGE_SIZE),
      })
      return api.searchCards(p, signal)
    },
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
  })

  const cards = useMemo(() => (data?.cards ?? []).map(toCardRow), [data])
  const total = data?.pagination.total ?? 0
  const pageCount = data?.pagination.pageCount ?? 0

  return (
    <Content cap={1165}>
      <h1 className="mb-[16px] text-[24px] font-bold text-text-primary">Search</h1>

      <label className="relative flex h-[48px] w-full items-center">
        <span className="pointer-events-none absolute left-[14px] text-icon-default">
          <Icon name="search" size={20} />
        </span>
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search every card by name or number…"
          className="h-[48px] w-full rounded-lg border border-border-default bg-surface-primary pl-[44px] pr-[12px] text-[16px] text-text-primary placeholder:text-text-muted"
        />
      </label>

      {trimmed.length > 0 && (
        <SortChipStrip
          items={SORTS}
          activeKey={search.sort}
          activeDir={search.dir}
          onSort={(key, dir) => patch({ sort: key as GlobalSortKey, dir })}
          className="mt-[16px]"
        />
      )}

      {trimmed.length === 0 ? (
        <div className="py-[60px] text-center text-[14px] text-text-muted">
          Type a card name or number to search the whole catalog.
        </div>
      ) : (
        <>
          {isLoading && !data && <Spinner label="Searching…" />}
          {error && <ErrorState message={(error as Error).message} />}

          {data && (
            <>
              <div className="mt-[20px] text-[14px] text-text-muted">
                {total === 0
                  ? `No cards match “${trimmed}”.`
                  : `${total.toLocaleString()} card${total === 1 ? '' : 's'} match “${trimmed}”`}
              </div>

              {cards.length > 0 && (
                <div className="mt-[24px]" style={{ opacity: isFetching ? 0.6 : 1 }}>
                  <GridView cards={cards} seriesSlug="" setId="" />
                </div>
              )}

              {pageCount > 1 && (
                <div className="mt-[24px] flex items-center justify-center gap-[12px]">
                  <button
                    disabled={search.page <= 1}
                    onClick={() => navigate({ search: { ...search, page: search.page - 1 } as never })}
                    className="h-[44px] rounded-lg bg-surface-tertiary px-[16px] text-[14px] font-bold text-text-muted disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-[14px] text-text-muted">
                    Page {search.page} of {pageCount}
                  </span>
                  <button
                    disabled={search.page >= pageCount}
                    onClick={() => navigate({ search: { ...search, page: search.page + 1 } as never })}
                    className="h-[44px] rounded-lg bg-surface-tertiary px-[16px] text-[14px] font-bold text-text-muted disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Content>
  )
}
