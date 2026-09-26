import { useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { api, type CardDetailResponse, type CardRow, type Variant } from '../lib/api'
import { fmtPrice, fmtNumber } from '../lib/format'
import { useOnline } from '../lib/useOnline'
import { useSignedIn } from '../lib/session'
import { CounterBox } from './ui/CounterBox'
import { Icon } from './Icon'
import { variantMeta } from '../lib/variantStyle'
import { CardLink } from './CardLink'

import { VariantChip } from './VariantChip'

// Per-variant quantity counters for a table row — the same mechanism as the grid
// tiles (CardTile.VariantCounters): read the card's variants from the shared
// ['card', cardId] query and write through the existing collection endpoints with
// an optimistic update; the ['set', setId] invalidation reconciles progress.
function RowCounters({ cardId, setId }: { cardId: string; setId: string }) {
  const qc = useQueryClient()
  const online = useOnline()
  const { data } = useQuery({
    queryKey: ['card', cardId],
    queryFn: ({ signal }) => api.card(cardId, signal),
  })

  const mutation = useMutation({
    mutationFn: ({ variantId, delta }: { variantId: number; delta: number }) =>
      api.incrementVariant(variantId, delta),
    onMutate: async ({ variantId, delta }) => {
      await qc.cancelQueries({ queryKey: ['card', cardId] })
      const prevCard = qc.getQueryData<CardDetailResponse>(['card', cardId])
      qc.setQueryData<CardDetailResponse>(['card', cardId], (old) =>
        old
          ? {
              ...old,
              variants: old.variants.map((v) =>
                v.variantId === variantId ? { ...v, quantity: Math.max(0, (v.quantity ?? 0) + delta) } : v,
              ),
            }
          : old,
      )
      return { prevCard }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevCard) qc.setQueryData(['card', cardId], ctx.prevCard)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['card', cardId] })
      void qc.invalidateQueries({ queryKey: ['set', setId] })
    },
  })

  const standard = (data?.variants ?? [])
    .filter((v) => v.tier === 'standard')
    .map((v) => ({ v, meta: variantMeta(v) }))
    .sort((a, b) => a.meta.order - b.meta.order)
  if (standard.length === 0) return null

  return (
    <div
      className="flex shrink-0 items-center gap-[4px]"
      title={online ? undefined : 'Offline — reconnect to change your collection'}
    >
      {standard.map(({ v, meta }) => (
        <CounterBox
          key={v.variantId}
          label={v.displayName}
          color={meta.color}
          fill={meta.fill}
          dark={meta.dark}
          qty={v.quantity ?? 0}
          disabled={!online || mutation.isPending}
          onInc={() => mutation.mutate({ variantId: v.variantId, delta: 1 })}
          onDec={() => mutation.mutate({ variantId: v.variantId, delta: -1 })}
        />
      ))}
    </div>
  )
}

// Rough pre-measurement guess (PERF-03) — corrected per row by `measureElement`
// below, the first time each row actually paints. Unlike GridView's tile, a
// table row's height isn't a pure function of viewport width (the counters
// strip only renders once `signedIn` resolves, and can be taller than a bare
// name/price line), so there's no exact formula to compute it up front — this
// only has to be close enough that the scrollbar doesn't jump on first paint.
const ROW_ESTIMATE = 76
// Matches the old `flex flex-col gap-[20px]` wrapper's spacing exactly — the
// virtualizer's own `gap` option reproduces it without baking it into each
// row's measured height, which would double-count it on every remeasure.
const ROW_GAP = 20

// Table view (UI-SPEC §3.26; wiki: Frontend-Research §virtualization). No
// <table>: a flex column of per-card rows, each a cropped art thumbnail, the
// number/name, the representative price, and per-variant "have" counters on
// the far right.
//
// PERF-03: rendering all of `cards` at once put ~29,000 DOM nodes on the page
// and blocked the main thread for multiple seconds to mount (3-7s depending on
// machine load — measured 3.0-3.5s under this repo's own scale-profiling
// fixture, DECISIONS.md this date), at 3,200 rows, on both mobile and desktop
// viewports — and (unlike Grid's virtualized scroll cost) it never recovered
// afterward, because nothing here was ever released. Fixed
// with the same `useWindowVirtualizer` GridView already uses: only rows near
// the viewport are ever mounted, no matter how long the list is. The whole
// *page* scrolls here (there's no inner scroll container), so this reads the
// window's scroll position exactly like GridView does, offset by this
// element's own position on the page (`scrollMargin`).
export function TableView({
  cards,
  seriesSlug,
  setId,
}: {
  cards: CardRow[]
  seriesSlug: string
  setId: string
}) {
  const signedIn = useSignedIn()
  const containerRef = useRef<HTMLDivElement>(null)
  const [offsetTop, setOffsetTop] = useState(0)

  useLayoutEffect(() => {
    if (containerRef.current) setOffsetTop(containerRef.current.offsetTop)
  }, [])

  const virtualizer = useWindowVirtualizer({
    count: cards.length,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 12,
    gap: ROW_GAP,
    scrollMargin: offsetTop,
  })

  return (
    <div ref={containerRef}>
      {/* Column header. `aria-hidden`: every row already speaks its own
          number, name and price as text, in that order — a screen reader user
          gets nothing from a second announcement of the same three words, so
          this is a sighted-only legend.
          NOT `position: sticky`, on purpose, though it visually invites it:
          measured (real wheel scroll + computed styles, not a guess) that
          `<body>` resolves to `overflow-y: auto` here even though actual page
          scroll happens on `<html>` (`document.scrollingElement`) — so `body`
          registers as the nearer CSS scroll container, sticky pins to ITS
          (always-0, never-moving) scrollTop, and the element just rides away
          with the page instead of pinning. Root cause: `theme.css:315-324`
          sets `overflow-x: hidden` on `html, body` (deliberately, to stop
          sideways drift) but never sets `overflow-y` — and per the CSS
          Overflow spec, pairing an explicit non-`visible` x with an unset y
          computes that y as `auto`, not `visible`. That's a page-level,
          pre-existing condition, not something this row markup controls, and
          it very likely also silently defeats the other page-level `sticky`
          elements already shipped (e.g. `DeckBuilder`'s sidebar, `CardDetail`'s
          image column) — flagged separately rather than papered over here. A
          static legend is still strictly more useful than the none it
          replaces, so it stays, honestly non-sticky. */}
      <div
        aria-hidden="true"
        className="mb-[8px] flex items-stretch overflow-hidden rounded-t-lg bg-surface-tertiary text-[12px] font-bold uppercase tracking-wide text-text-muted"
      >
        <div className="w-[72px] shrink-0" />
        <div className="flex flex-1 items-center gap-[16px] px-[16px] py-[10px]">
          <span className="w-[48px] shrink-0">#</span>
          <span className="flex-1">Name</span>
          <span className="hidden sm:inline">Variant</span>
          <span>Price</span>
          <span className="w-[16px] shrink-0" />
        </div>
      </div>

      {/* `role="list"`/`"listitem"` plus `aria-setsize`/`aria-posinset` — the
          ARIA pair meant for exactly this case, a set whose members aren't
          all present in the DOM at once (WAI-ARIA §5.9/§5.11) — announce a
          screen reader's true position ("42 of 3,200") even though only a
          couple dozen rows are ever mounted. `role="table"`/`"row"`/`"cell"`
          was the other candidate (and is what a documented alternative to
          aria-rowcount/aria-rowindex usually means), but every row here is a
          single link — one focus stop, not per-cell navigation — so forcing a
          grid shape onto it would invent structure that isn't there rather
          than describe what is. This is also why sort keeps working for
          free: `ListDetail` sorts `cards` itself before it ever reaches this
          component, so nothing here reorders or re-derives it — virtualizing
          the render is a pure windowing change over whatever order it's
          handed. */}
      <div
        role="list"
        aria-label={`${cards.length.toLocaleString()} ${cards.length === 1 ? 'card' : 'cards'}`}
        style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}
      >
        {virtualizer.getVirtualItems().map((vRow) => {
          const card = cards[vRow.index]
          const series = card.seriesSlug ?? seriesSlug
          const set = card.setId ?? setId
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              role="listitem"
              aria-setsize={cards.length}
              aria-posinset={vRow.index + 1}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vRow.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <CardLink
                key={(card as { itemId?: string }).itemId ?? card.cardId}
                card={card}
                seriesSlug={series}
                setId={set}
                className="group flex items-stretch overflow-hidden rounded-lg bg-surface-tertiary hover:bg-action-default-hover"
              >
                {/* Thumbnail: object-cover into a landscape window crops to the card's
                    art box — full card width, centred on the upper illustration. */}
                <div className="w-[72px] shrink-0 overflow-hidden bg-surface-secondary">
                  <img
                    src={card.images.low}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                    style={{ objectPosition: 'center 20%' }}
                  />
                </div>
                <div className="flex flex-1 items-center gap-[16px] px-[16px] py-[12px]">
                  <span className="w-[48px] shrink-0 text-[14px] text-text-muted">{fmtNumber(card.number)}</span>
                  <span className="font-display flex-1 truncate text-[14px] font-medium text-text-primary">{card.name}</span>
                  {/* Same swap as the grid tile: on a list the reader wants the
                      printing THIS row is, not how many printings exist. */}
                  {card.variant ? (
                    <VariantChip variant={card.variant} className="hidden text-text-body sm:inline-flex" />
                  ) : (
                    card.variantCount > 1 && (
                      <span className="hidden text-[14px] text-text-muted sm:inline">{card.variantCount} variants</span>
                    )
                  )}
                  <span className="text-[14px] font-medium text-change-positive">{fmtPrice(card.price)}</span>
                  {/* Write affordance: hidden signed-out (the API sends no quantities
                      and there is nothing to write to). The header carries the CTA. */}
                  {set && signedIn === true && <RowCounters cardId={`${set}-${card.number}`} setId={set} />}
                  <Icon name="chevron-right" size={16} className="text-icon-muted" />
                </div>
              </CardLink>
            </div>
          )
        })}
      </div>
    </div>
  )
}
