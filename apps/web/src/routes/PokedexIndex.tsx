import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { api, type SpeciesGridRow } from '../lib/api'
import { Content, Spinner, ErrorState } from '../components/ui'
import { SpriteTile } from '../components/SpriteTile'
import { fmtNumber, typeColor } from '../lib/format'

type Own = 'all' | 'captured' | 'uncaptured'

const GENS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] // 0 = All

// Virtualized species grid (FRONTEND.md §B.2/§B.3.5: virtualize the 1025-species
// grid; sprites are the phone-killer if all rendered at once). One ResizeObserver
// drives the column count; rows are virtualized, row-major order preserved.
const MIN_TILE = 110
const GAP = 16
const NAME_FOOTER = 44

function SpeciesCard({ s }: { s: SpeciesGridRow }) {
  return (
    <Link to="/pokedex/$speciesId" params={{ speciesId: String(s.speciesId) }} className="group block">
      <div className="relative">
        <SpriteTile src={s.sprite.pixel} alt={s.name} captured={s.captured} />
        <span className="absolute left-[6px] top-[6px] rounded bg-surface-primary/70 px-[5px] py-[1px] text-[10px] font-bold text-text-muted backdrop-blur-sm">
          {fmtNumber(String(s.speciesId))}
        </span>
        {s.captured && (
          <span className="absolute right-[6px] top-[6px] rounded bg-action-primary px-[5px] py-[1px] text-[10px] font-extrabold text-action-primary-text">
            LVL {s.levelLabel}
          </span>
        )}
        {s.shiny && (
          <span className="absolute bottom-[6px] right-[6px] text-[13px] leading-none text-action-primary" title="Shiny (breadth)">
            ✦
          </span>
        )}
      </div>
      <div className="pt-[6px] text-center" style={{ minHeight: NAME_FOOTER }}>
        <div
          className={[
            'truncate text-[13px] font-medium leading-[18px]',
            s.captured ? 'text-text-primary' : 'text-text-muted',
          ].join(' ')}
        >
          {s.name}
        </div>
        <div className="mt-[2px] flex justify-center gap-[3px]">
          {s.types.map((t) => (
            <span
              key={t}
              className="h-[7px] w-[7px] rounded-full"
              style={{ background: typeColor(t), opacity: s.captured ? 1 : 0.4 }}
              title={t}
            />
          ))}
        </div>
      </div>
    </Link>
  )
}

function VirtualGrid({ species }: { species: SpeciesGridRow[] }) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const cols = Math.max(2, Math.floor((width || 900 + GAP) / (MIN_TILE + GAP)))
  const tileW = width ? (width - (cols - 1) * GAP) / cols : MIN_TILE
  const rowH = Math.round(tileW + NAME_FOOTER + GAP) // square sprite + name footer + gap
  const rowCount = Math.ceil(species.length / cols)

  const [offsetTop, setOffsetTop] = useState(0)
  useEffect(() => {
    if (gridRef.current) setOffsetTop(gridRef.current.offsetTop)
  }, [width, cols])

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowH,
    overscan: 4,
    scrollMargin: offsetTop,
  })

  return (
    <div ref={gridRef} key={cols}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const start = vRow.index * cols
          const rowItems = species.slice(start, start + cols)
          return (
            <div
              key={vRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vRow.start - virtualizer.options.scrollMargin}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                columnGap: GAP,
                height: rowH,
              }}
            >
              {rowItems.map((s) => (
                <SpeciesCard key={s.speciesId} s={s} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PokedexIndex() {
  const [gen, setGen] = useState(0)
  const [own, setOwn] = useState<Own>('all')
  const [q, setQ] = useState('')

  const params = new URLSearchParams({ pageSize: '1025', own })
  if (gen) params.set('generation', String(gen))
  if (q.trim()) params.set('q', q.trim())

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['dex', gen, own, q.trim()],
    queryFn: ({ signal }) => api.dex(params, signal),
    placeholderData: keepPreviousData,
  })

  const captured = data?.completion.captured ?? 0
  const total = data?.completion.total ?? 1025
  const pct = total ? Math.round((captured / total) * 1000) / 10 : 0

  return (
    <Content cap={1100}>
      {/* completion header */}
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <h1 className="text-[32px] font-extrabold leading-[40px] text-text-primary">Pokédex</h1>
          <div className="mt-[2px] text-[14px] text-text-muted">National Dex completion</div>
        </div>
        <div className="text-right">
          <div className="text-[24px] font-extrabold text-text-primary">
            {captured}
            <span className="text-[16px] font-normal text-text-muted"> / {total}</span>
          </div>
          <div className="text-[13px] text-action-primary">{pct}% captured</div>
        </div>
      </div>
      <div className="mt-[10px] h-[6px] w-full overflow-hidden rounded-full bg-surface-tertiary">
        <div className="h-full rounded-full bg-action-primary" style={{ width: `${Math.max(pct, captured > 0 ? 0.5 : 0)}%` }} />
      </div>

      {/* filters */}
      <div className="mt-[20px] flex flex-col gap-[12px]">
        <div className="scroll-x flex gap-[8px]">
          {GENS.map((g) => (
            <button
              key={g}
              onClick={() => setGen(g)}
              className={[
                'h-[32px] shrink-0 rounded-full px-[14px] text-[13px] font-semibold',
                gen === g ? 'bg-action-primary text-action-primary-text' : 'bg-surface-tertiary text-text-body hover:bg-action-default-hover',
              ].join(' ')}
            >
              {g === 0 ? 'All' : `Gen ${g}`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-[12px]">
          <label className="relative flex items-center" style={{ maxWidth: 280, flex: 1 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search species…"
              className="h-[38px] w-full rounded-lg border border-border-default bg-surface-primary px-[14px] text-[14px] text-text-primary placeholder:text-text-muted"
            />
          </label>
          <div className="inline-flex rounded-full bg-surface-secondary p-[3px]">
            {(['all', 'captured', 'uncaptured'] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOwn(o)}
                className={[
                  'h-[30px] rounded-full px-[12px] text-[12px] font-semibold capitalize',
                  own === o ? 'bg-surface-raised text-text-primary' : 'text-text-muted',
                ].join(' ')}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && !data && <Spinner label="Loading Pokédex…" />}
      {error && <ErrorState message={(error as Error).message} />}

      {data && (
        <div className="mt-[20px]" style={{ opacity: isFetching ? 0.6 : 1 }}>
          {data.species.length === 0 ? (
            <div className="py-[60px] text-center text-[14px] text-text-muted">No species match this filter.</div>
          ) : (
            <VirtualGrid species={data.species} />
          )}
        </div>
      )}
    </Content>
  )
}
