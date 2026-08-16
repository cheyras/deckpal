import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { api, type SpeciesGridRow } from '../lib/api'
import { Content, Spinner, ErrorState, ProgressBar, useDismiss } from '../components/ui'
import { SpriteTile } from '../components/SpriteTile'
import { fmtNumber, typeColor } from '../lib/format'
import { useSignedIn } from '../lib/session'
import { SignInPrompt } from '../components/SignInPrompt'

type Own = 'all' | 'captured' | 'uncaptured'

const GENS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] // 0 = All

// Regional Pokédex name per generation (index = gen; 0 = National).
const REGION = ['National', 'Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea'] as const

const OWN_LABEL: Record<Own, string> = { all: 'All', captured: 'Captured', uncaptured: 'Uncaptured' }

// Virtualized species grid (wiki: Frontend-Research §B.2/§B.3.5: virtualize the 1025-species
// grid; sprites are the phone-killer if all rendered at once). One ResizeObserver
// drives the column count; rows are virtualized, row-major order preserved.
const GAP = 16
const NAME_FOOTER = 44

function SpeciesCard({ s }: { s: SpeciesGridRow }) {
  return (
    <Link to="/pokedex/$speciesId" params={{ speciesId: String(s.speciesId) }} className="group block">
      <div className="relative">
        {/* `captured` is absent for a logged-out visitor: the sprite then renders
            in its plain (un-dimmed) state — an unknown, not an uncaptured. */}
        <SpriteTile src={s.sprite.pixel} alt={s.name} captured={s.captured ?? true} />
        <span className="absolute left-[6px] top-[6px] rounded bg-surface-primary/70 px-[5px] py-[1px] text-[14px] font-bold text-text-muted backdrop-blur-sm">
          {fmtNumber(String(s.speciesId))}
        </span>
        {s.captured && (
          <span className="absolute right-[6px] top-[6px] rounded bg-action-primary px-[5px] py-[1px] text-[14px] font-extrabold text-action-primary-text">
            LVL {s.levelLabel}
          </span>
        )}
        {s.shiny && (
          <span className="absolute bottom-[6px] right-[6px] text-[14px] leading-none text-action-primary" title="Shiny (breadth)">
            ✦
          </span>
        )}
      </div>
      <div className="pt-[6px] text-center" style={{ minHeight: NAME_FOOTER }}>
        <div
          className={[
            'truncate text-[14px] font-medium leading-[18px]',
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

// Column count is width-driven, but the minimum tile size scales with the
// viewport: phones get big tiles (≈2 cols) so species names fit untruncated,
// desktops pack more. A wide fallback used to force 7 tiny columns on mobile
// (names truncated, rows spaced from a stale tile height) — the fallback is now
// the real viewport width so a 0/first-paint measurement can't over-columnize.
function columnsFor(w: number): number {
  const minTile = w < 420 ? 150 : w < 640 ? 132 : 120
  return Math.max(2, Math.min(8, Math.floor((w + GAP) / (minTile + GAP))))
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

  const measured = width || (typeof window !== 'undefined' ? window.innerWidth - 32 : 360)
  const cols = columnsFor(measured)
  const tileW = (measured - (cols - 1) * GAP) / cols
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
    <div ref={gridRef}>
      {/* keyed on cols so the virtualizer's absolute row positions reset cleanly
          when the column count changes; the measured wrapper above stays mounted. */}
      <div key={cols} style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
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

function OwnFilterMenu({ value, onChange }: { value: Own; onChange: (o: Own) => void }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const wrapRef = useDismiss<HTMLDivElement>(open, close)

  const active = value !== 'all'

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={`Filter: ${OWN_LABEL[value]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border',
          active
            ? 'border-action-primary bg-action-primary text-action-primary-text'
            : 'border-border-default bg-surface-primary text-text-body hover:bg-action-default-hover',
        ].join(' ')}
        title={`Filter: ${OWN_LABEL[value]}`}
      >
        {/* funnel / filter icon */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-[6px] w-[168px] overflow-hidden rounded-lg border border-border-default bg-surface-primary py-[4px] shadow-lg"
        >
          {(['all', 'captured', 'uncaptured'] as const).map((o) => (
            <button
              key={o}
              role="menuitemradio"
              aria-checked={value === o}
              onClick={() => {
                onChange(o)
                setOpen(false)
              }}
              className={[
                'flex w-full items-center justify-between px-[14px] py-[8px] text-left text-[14px] font-semibold',
                value === o ? 'bg-surface-secondary text-text-primary' : 'text-text-body hover:bg-action-default-hover',
              ].join(' ')}
            >
              {OWN_LABEL[o]}
              {value === o && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function PokedexIndex() {
  const [gen, setGen] = useState(0)
  const [own, setOwn] = useState<Own>('all')
  const [q, setQ] = useState('')
  const signedOut = useSignedIn() === false

  const params = new URLSearchParams({ pageSize: '1025', own })
  if (gen) params.set('generation', String(gen))
  if (q.trim()) params.set('q', q.trim())

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['dex', gen, own, q.trim()],
    queryFn: ({ signal }) => api.dex(params, signal),
    placeholderData: keepPreviousData,
  })

  // Completion is scoped to the selected generation, independent of the own/search
  // filters. We fetch the gen's full (own=all, no search) species list and count
  // captured locally — cached per gen, so toggling own or typing doesn't refetch.
  const compParams = new URLSearchParams({ pageSize: '1025', own: 'all' })
  if (gen) compParams.set('generation', String(gen))
  const { data: comp } = useQuery({
    queryKey: ['dex-completion', gen],
    queryFn: ({ signal }) => api.dex(compParams, signal),
    placeholderData: keepPreviousData,
  })

  const captured = comp ? comp.species.filter((s) => s.captured).length : 0
  const total = comp ? comp.species.length : gen ? 0 : 1025
  const pct = total ? Math.round((captured / total) * 1000) / 10 : 0
  const dexName = `${REGION[gen]} Dex`

  return (
    <Content cap={1100}>
      {/* completion header */}
      <div className="flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <h1 className="text-[32px] font-extrabold leading-[40px] text-text-primary">Pokédex</h1>
          <div className="mt-[2px] text-[14px] text-text-muted">
            {signedOut ? `${dexName} — every species, every card` : `${dexName} completion`}
          </div>
        </div>
        {/* Completion is a fact about a collector. Logged out, the same slot
            says how big the dex is and offers the account that would fill it. */}
        {signedOut ? (
          <SignInPrompt title="Capture your dex" detail={`${total.toLocaleString()} species to collect.`} />
        ) : (
          <div className="text-right">
            <div className="text-[24px] font-extrabold text-text-primary">
              {captured}
              <span className="text-[16px] font-normal text-text-muted"> / {total}</span>
            </div>
            <div className="text-[14px] text-action-primary">{pct}% captured</div>
          </div>
        )}
      </div>
      {!signedOut && (
        <div className="mt-[10px]">
          {/* Shared ProgressBar primitive (C4) — recessed track + brand gradient
              fill, same as SeriesIndex/SetDetail/ListDetail (issue #43). */}
          <ProgressBar pct={Math.max(pct, captured > 0 ? 0.5 : 0)} />
        </div>
      )}

      {/* filters */}
      <div className="mt-[20px] flex flex-col gap-[12px]">
        <div className="scroll-x flex gap-[8px]">
          {GENS.map((g) => (
            <button
              key={g}
              onClick={() => setGen(g)}
              className={[
                'h-[32px] shrink-0 rounded-full px-[14px] text-[14px] font-semibold',
                gen === g ? 'bg-action-primary text-action-primary-text' : 'bg-surface-tertiary text-text-body hover:bg-action-default-hover',
              ].join(' ')}
            >
              {g === 0 ? 'All' : `Gen ${g}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-[12px]">
          <label className="relative flex items-center" style={{ flex: 1, maxWidth: 320 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search species…"
              className="h-[38px] w-full rounded-lg border border-border-default bg-surface-primary px-[14px] text-[14px] text-text-primary placeholder:text-text-muted"
            />
          </label>
          {!signedOut && <OwnFilterMenu value={own} onChange={setOwn} />}
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
