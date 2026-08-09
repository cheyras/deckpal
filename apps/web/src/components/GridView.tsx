import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { CardRow } from '../lib/api'
import { CardTile } from './CardTile'

// Fluid grid + window virtualization (wiki: Frontend-Research §B.2). ONE ResizeObserver is
// the source of truth for column count; we virtualize ROWS (row-major reading
// order preserved), not lanes. Row height is computed arithmetically from the
// measured tile width, so no per-item measurement is needed.

const MIN_TILE = 200
const MAX_TILE = 300
const MIN_TILE_SM = 150
const GAP_X = 53
const GAP_X_SM = 23
const GAP_Y = 30
const FOOTER = 74
const IMG_RATIO = 337 / 245

function colsFor(width: number): { cols: number; small: boolean } {
  const small = width < 567
  const minTile = small ? MIN_TILE_SM : MIN_TILE
  const gap = small ? GAP_X_SM : GAP_X
  const cols = Math.max(1, Math.floor((width + gap) / (minTile + gap)))
  return { cols, small }
}

export function GridView({
  cards,
  seriesSlug,
  setId,
  onRemove,
  ownership,
}: {
  cards: CardRow[]
  seriesSlug: string
  setId: string
  onRemove?: (card: CardRow) => void
  // When true, tiles render owned/dimmed state from card.ownership (species detail).
  ownership?: boolean
}) {
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

  const { cols, small } = colsFor(width || 990)
  const gap = small ? GAP_X_SM : GAP_X
  const rawTile = width ? (width - (cols - 1) * gap) / cols : MIN_TILE
  const tileW = Math.min(MAX_TILE, rawTile)
  const rowH = Math.round(tileW * IMG_RATIO + FOOTER + GAP_Y)
  const rowCount = Math.ceil(cards.length / cols)

  const [offsetTop, setOffsetTop] = useState(0)
  useEffect(() => {
    if (gridRef.current) setOffsetTop(gridRef.current.offsetTop)
  }, [width, cols])

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowH,
    overscan: 3,
    scrollMargin: offsetTop,
  })

  return (
    <div ref={gridRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const start = vRow.index * cols
          const rowCards = cards.slice(start, start + cols)
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
                gridTemplateColumns: `repeat(${cols}, minmax(0, ${MAX_TILE}px))`,
                justifyContent: 'space-between',
                columnGap: gap,
                height: rowH,
              }}
            >
              {rowCards.map((card, i) => (
                <CardTile
                  key={(card as { itemId?: string }).itemId ?? card.cardId}
                  card={card}
                  seriesSlug={seriesSlug}
                  setId={setId}
                  eager={vRow.index === 0 && i < cols}
                  onRemove={onRemove ? () => onRemove(card) : undefined}
                  ownership={ownership}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
