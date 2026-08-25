import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { CardRow } from '../lib/api'
import { CardTile } from './CardTile'
import { prefersReducedMotion } from '../lib/reducedMotion'

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

/**
 * A card the page has been asked to bring into view, and when it was asked.
 *
 * `at` is the identity, not decoration: the effect below fires on a CHANGE of
 * this object, so a page that keeps handing back the same one is a page saying
 * "still the same request, you are already acting on it". See `SetDetail`,
 * which mints these from `decke:reveal`.
 */
export type GridReveal = { cardId: string; at: number }

/** How near the middle of the screen counts as "already shown". */
const CENTRED_BAND = 0.2

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
  // A card to scroll to, when the page that owns this grid has been asked for one.
  reveal?: GridReveal | null
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

  // ── BRINGING ONE CARD INTO VIEW ────────────────────────────────────────────
  //
  // The owner's spec, verbatim: *"bring up the set page … then scrolled down
  // the page for me to the specific card … so it looks like he's flying down
  // the page to the card."*
  //
  // This is the half of that only the grid can do. A card id says nothing about
  // where a card IS — position is a function of the filter, the sort and the
  // column count, all three of which live here — and the tile itself does not
  // exist until the window has scrolled to its row, which is the whole reason
  // Deck-E could not address a tile before. So he asks (`decke:reveal`, see
  // `character/host/uiTools.ts`), the page routes the ask to the grid that owns
  // the card, and the grid answers in the only currency it has: a row index.
  //
  // The virtualizer's own `scrollToIndex` rather than an element scroll,
  // because there is no element — that is the point. `align: 'center'` clamps
  // to the document's real range on its own, so a card in the first or last row
  // simply gets as centred as the page allows, and native `behavior: 'smooth'`
  // is what `DeckE.scrollIntoView` already uses for the same reason the
  // engine's own `driveScroll` gives up the moment `scrollY` disagrees with it:
  // a browser's smooth scroll is abandoned by the reader's next wheel tick, and
  // a scroll that fights the reader is worse than no scroll at all.
  //
  // Two guards, because the ask REPEATS while he waits (the page may not have
  // been mounted for the first one):
  //
  //   - a request that has not changed identity does not re-run the effect at
  //     all, which is the dedupe for the retries during a scroll already in
  //     flight;
  //   - a tile already sitting near the middle of the screen is left alone, so
  //     a repeat that outlives the dedupe window — or a card that was on screen
  //     the whole time — costs nothing and jerks nothing.
  //
  // `width` gates the whole thing: at width 0 the column count is a guess and
  // the row would be the wrong one. A reveal that arrives that early is not
  // lost, because the ask repeats.
  useEffect(() => {
    if (!reveal || !width) return
    const index = cards.findIndex((c) => c.cardId === reveal.cardId)
    if (index < 0) return
    let already: Element | null = null
    try {
      already = document.querySelector(`[data-decke-card="${CSS.escape(reveal.cardId)}"]`)
    } catch {
      already = null
    }
    if (already) {
      const box = already.getBoundingClientRect()
      const centre = box.top + box.height / 2
      const h = window.innerHeight
      if (centre > h * (0.5 - CENTRED_BAND) && centre < h * (0.5 + CENTRED_BAND)) return
    }
    virtualizer.scrollToIndex(Math.floor(index / cols), {
      align: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [reveal, cards, cols, width, virtualizer])

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
