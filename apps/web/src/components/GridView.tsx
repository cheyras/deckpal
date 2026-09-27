import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { defaultRangeExtractor, useWindowVirtualizer } from '@tanstack/react-virtual'
import type { CardRow } from '../lib/api'
import { CardTile } from './CardTile'
import { ConfirmModal } from './ListModals'
import { CARD_ASPECT_RATIO_INVERSE } from '../lib/cardGeometry'

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
// The art-height ratio for row-height arithmetic — height / width, the exact
// reciprocal of CardImage's aspect (lib/cardGeometry.ts). MEASUREMENT-CRITICAL:
// if this disagrees with the painted aspect, virtualised rows overlap, total
// scroll height is mis-sized, and scrollToIndex centres on the wrong row.
const IMG_RATIO = CARD_ASPECT_RATIO_INVERSE

function colsFor(width: number): { cols: number; small: boolean } {
  const small = width < 567
  const minTile = small ? MIN_TILE_SM : MIN_TILE
  const gap = small ? GAP_X_SM : GAP_X
  const cols = Math.max(1, Math.floor((width + gap) / (minTile + gap)))
  return { cols, small }
}

/**
 * A card the page has been asked to have ready for Deck-E, and when it was
 * asked. See `SetDetail`, which mints these from `decke:reveal`.
 */
export type GridReveal = { cardId: string; at: number }

export function GridView({
  cards,
  seriesSlug,
  setId,
  onRemove,
  ownership,
  reveal,
}: {
  cards: CardRow[]
  seriesSlug: string
  setId: string
  onRemove?: (card: CardRow) => void
  // When true, tiles render owned/dimmed state from card.ownership (species detail).
  ownership?: boolean
  // A card whose row must stay mounted, when the page that owns this grid has been asked for one.
  reveal?: GridReveal | null
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // Keep the selected card above the virtual rows: opening Sheet locks body
  // scroll, which can unmount a tile far down the list.
  const [confirmRemove, setConfirmRemove] = useState<CardRow | null>(null)

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

  // ── BRINGING ONE CARD INTO VIEW: MOUNT IT, DO NOT SCROLL TO IT ──────────────
  //
  // The owner's spec, verbatim: *"bring up the set page … then scrolled down
  // the page for me to the specific card … so it looks like he's flying down
  // the page to the card."*
  //
  // A card id says nothing about where a card IS — position is a function of
  // the filter, the sort and the column count, all three of which live here —
  // and the tile does not exist until the window reaches its row, which is why
  // Deck-E asks (`decke:reveal`, see `character/host/uiTools.ts`).
  //
  // This used to answer by SCROLLING there itself, with the virtualizer's own
  // smooth `scrollToIndex`, and that was half of what made "show me" feel
  // broken: the page raced 18,500 px down on its own while he sat still, then
  // his flight scrolled it a second time to centre the card — two scrolls, two
  // owners, and the character arriving late to a page that had already moved.
  // The answer now is the one thing only the grid can give: the row, MOUNTED
  // at its true offset even though it is off screen. The tile is then a real,
  // measurable element, and his flight drives the one scroll that brings it in,
  // on the flight's own clock (`DeckE.flyTo` with `scrollWith`).
  //
  // The rows are fixed-height (`estimateSize` is exact here and nothing is
  // measured), so a row mounted out of the window sits exactly where it will be
  // when the window arrives — there is no correction later for him to chase.
  const revealIndex = reveal ? cards.findIndex((c) => c.cardId === reveal.cardId) : -1
  // `width` gates it: at width 0 the column count is a guess and the row would
  // be the wrong one. The ask repeats while he waits, so nothing is lost.
  const revealRow = revealIndex >= 0 && width ? Math.floor(revealIndex / cols) : -1

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowH,
    overscan: 3,
    scrollMargin: offsetTop,
    rangeExtractor: (range) => {
      const rows = defaultRangeExtractor(range)
      if (revealRow < 0 || revealRow >= rowCount || rows.includes(revealRow)) return rows
      return [...rows, revealRow].sort((a, b) => a - b)
    },
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
                // `alignItems: 'start'` — WITHOUT it, CSS Grid's default `stretch`
                // makes each CardTile's outer `<Link className="group block">`
                // (the element `data-decke-card` sits on) fill the whole row
                // track, i.e. `rowH`, which BAKES IN the 30px `GAP_Y` that is
                // meant to be empty space *between* rows. So the Link's measured
                // box ran 30px past its own visible content (art + 74px footer),
                // and `elementHighlight`'s halo adds another 6px outward on top of
                // that (`INSET = -6` in `ui/elementHighlight.ts`) — landing the
                // ring's bottom edge 6px INSIDE the next row's tile. That is the
                // reported defect verbatim: "his highlight extends way down below
                // the card's info and even slightly into the card below." Making
                // grid items content-height instead makes the 30px gap real empty
                // space again, so the ring's 6px halo lands in it with 24px to
                // spare — pinned in `ui/__tests__/elementHighlight.test.ts`.
                //
                // Checked before taking this fix: every GridView caller
                // (SearchResults, ListDetail, SetDetail, SpeciesDetail) renders
                // only CardTile into these cells, across all three Link branches
                // CardTile can take (set-page sheet, species-page sheet, plain
                // nav). Nothing inside CardTile depends on the Link filling the
                // row — the remove button, the "+N Variants" badge, the owned-qty
                // chip and VariantCounters are all absolutely positioned against
                // the inner `<div className="relative">` that wraps just the art,
                // not against the Link, so none of them shift. TableView (the
                // 'binder' view) is a separate sibling of GridView, never rendered
                // into this grid, so it is untouched. The only observable change
                // is that the Link's click/hover target stops extending into the
                // 30px gap below the footer — that gap has no background or
                // border today, so it never looked clickable; losing it reads as
                // a fix, not a regression.
                alignItems: 'start',
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
                  onRemove={onRemove ? () => setConfirmRemove(card) : undefined}
                  ownership={ownership}
                />
              ))}
            </div>
          )
        })}
      </div>
      {confirmRemove && onRemove && (
        <ConfirmModal
          title="Remove card"
          message={`Remove ${confirmRemove.name} from this list?`}
          confirmLabel="Remove"
          onClose={() => setConfirmRemove(null)}
          onConfirm={() => {
            const card = confirmRemove
            setConfirmRemove(null)
            onRemove(card)
          }}
        />
      )}
    </div>
  )
}
