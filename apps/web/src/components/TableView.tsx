import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { api, type CardRow } from '../lib/api'
import { useOwnedCounts } from '../lib/collectionWrites'
import { fmtPrice, fmtNumber } from '../lib/format'
import { useOnline } from '../lib/useOnline'
import { useSignedIn } from '../lib/session'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { CounterBox } from './ui/CounterBox'
import { Icon } from './Icon'
import { variantMeta } from '../lib/variantStyle'
import { CardLink } from './CardLink'
import { type GridReveal } from './GridView'

import { VariantChip } from './VariantChip'

// Per-variant quantity counters for a table row — the same mechanism as the grid
// tiles (CardTile.VariantCounters): read the card's variants from the shared
// ['card', cardId] query and write through lib/collectionWrites.
function RowCounters({ card, setId }: { card: { cardId: string; name: string }; setId: string }) {
  const online = useOnline()
  const owned = useOwnedCounts(setId)
  const { data } = useQuery({
    queryKey: ['card', card.cardId],
    queryFn: ({ signal }) => api.card(card.cardId, signal),
  })

  const standard = (data?.variants ?? [])
    .filter((v) => v.tier === 'standard')
    .map((v) => ({ v, meta: variantMeta(v), qty: owned.shown(v.variantId, v.quantity) }))
    .sort((a, b) => a.meta.order - b.meta.order)
  if (standard.length === 0) return null

  return (
    <div
      className="flex shrink-0 items-center gap-[4px]"
      title={online ? undefined : 'Offline — reconnect to change your collection'}
    >
      {standard.map(({ v, meta, qty }) => (
        <CounterBox
          key={v.variantId}
          label={v.displayName}
          color={meta.color}
          fill={meta.fill}
          dark={meta.dark}
          qty={qty}
          disabled={!online}
          onInc={() => owned.set({ setId, card, variant: v }, qty + 1)}
          onDec={() => owned.set({ setId, card, variant: v }, qty - 1)}
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
// How near the middle of the screen counts as "already shown" — same value
// and purpose as `GridView`'s `CENTRED_BAND`.
const REVEAL_CENTERED_BAND = 0.2

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
// afterward, because nothing here was ever released. Fixed with the same
// `useWindowVirtualizer` GridView already uses: only rows near the viewport
// are ever mounted, no matter how long the list is. The whole *page* scrolls
// here (there's no inner scroll container), so this reads the window's
// scroll position exactly like GridView does, offset by this element's own
// position on the page (`scrollMargin`).
//
// `reveal` (optional; `SetDetail` is the only caller that has one) is Deck-E
// asking for one specific card to be brought into view. Before virtualization
// that request was `SetDetail`'s own generic `document.querySelector(...)
// .scrollIntoView()` — "the table renders every row it has, so a reveal there
// is the ordinary browser problem of scrolling to something that already
// exists." That stopped being true the moment rows outside the viewport
// stopped being mounted, so this needs the same `scrollToIndex` handling
// `GridView` already does for the identical reason.
export function TableView({
  cards,
  seriesSlug,
  setId,
  reveal,
  activeCard,
}: {
  cards: CardRow[]
  seriesSlug: string
  setId: string
  reveal?: GridReveal | null
  activeCard?: string
}) {
  const signedIn = useSignedIn()
  const containerRef = useRef<HTMLDivElement>(null)
  const focusedRowRef = useRef<number | null>(null)
  const previousActiveCardRef = useRef<string | undefined>(activeCard)
  const measuredWidthRef = useRef<number | null>(null)
  const restoreFrameRef = useRef<number | null>(null)
  const visibleAnchorRef = useRef<{ index: number; top: number } | null>(null)
  const [offsetTop, setOffsetTop] = useState(0)

  // `getBoundingClientRect().top + scrollY`, NOT `.offsetTop` (Astra caught
  // this): `.offsetTop` is relative to the nearest ANCESTOR with a non-`none`
  // `transform`, not the document — and `lib/lateEntrance.ts`'s late-arriving
  // page entrance (`.px-enter`, premium skin's default) puts exactly that
  // kind of transform on an ancestor of this list for the length of its
  // rise-in animation. Measured with `.offsetTop` during that window, this
  // page's real scroll offset (everything above the table: nav, list header,
  // filters) went uncounted, so `scrollToIndex` landed a whole page-header's
  // height short of the requested row. `getBoundingClientRect()` is always
  // viewport-relative regardless of any ancestor's transform, so this is
  // correct whether or not that animation is still running — re-measured on
  // resize too, since a reflow elsewhere on the page (not just this element)
  // can move it without this element's own size changing.
  const virtualizer = useWindowVirtualizer({
    count: cards.length,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 12,
    gap: ROW_GAP,
    scrollMargin: offsetTop,
  })

  useLayoutEffect(() => {
    const visibleAnchor = () => {
      const row = [...(containerRef.current?.querySelectorAll<HTMLElement>('[role="listitem"]') ?? [])]
        .find((item) => item.getBoundingClientRect().bottom > 0 && item.getBoundingClientRect().top < window.innerHeight)
      return row ? { index: Number(row.dataset.index), top: row.getBoundingClientRect().top } : null
    }
    const rememberVisible = () => {
      if (!activeCard) visibleAnchorRef.current = visibleAnchor()
    }
    const measure = () => {
      const container = containerRef.current
      if (!container) return
      const width = container.getBoundingClientRect().width
      const widthChanged = measuredWidthRef.current !== null && measuredWidthRef.current !== width
      measuredWidthRef.current = width
      const anchor = !activeCard && widthChanged ? visibleAnchorRef.current ?? visibleAnchor() : null
      const anchorIndex = anchor?.index ?? null
      const anchorTop = anchor?.top ?? 0
      // Sheet pins the body and makes scrollY read zero. Its negative top is
      // the page position until it releases the lock.
      const scrollY = document.body.style.position === 'fixed'
        ? -parseFloat(document.body.style.top || '0')
        : window.scrollY
      setOffsetTop(container.getBoundingClientRect().top + scrollY)
      // Height-only resizes leave row sizes intact. A width change can reflow
      // every row, so discard sizes, then put the first visible row back at
      // its previous screen position instead of jumping to a different card.
      if (widthChanged) {
        if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current)
        virtualizer.measure()
        if (anchorIndex !== null) {
          virtualizer.scrollToIndex(anchorIndex, { align: 'start', behavior: 'auto' })
          const restoreAnchor = (attempts: number) => {
            const row = container.querySelector<HTMLElement>(`[data-index="${anchorIndex}"]`)
            if (row) window.scrollBy(0, row.getBoundingClientRect().top - anchorTop)
            if (attempts > 0) restoreFrameRef.current = requestAnimationFrame(() => restoreAnchor(attempts - 1))
            else {
              restoreFrameRef.current = null
              rememberVisible()
            }
          }
          restoreFrameRef.current = requestAnimationFrame(() => restoreAnchor(5))
        }
      }
    }
    measure()
    if (!visibleAnchorRef.current) restoreFrameRef.current = requestAnimationFrame(rememberVisible)
    window.addEventListener('scroll', rememberVisible, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', rememberVisible)
      window.removeEventListener('resize', measure)
      if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current)
    }
  }, [activeCard, virtualizer])

  useEffect(() => {
    const wasOpen = previousActiveCardRef.current
    previousActiveCardRef.current = activeCard
    if (!wasOpen || activeCard || focusedRowRef.current === null) return
    const index = focusedRowRef.current
    if (cards[index]?.cardId !== wasOpen) return
    // The opener may have been recycled while the sheet held focus. Recreate
    // its row before focusing the new anchor, after Sheet releases scroll lock.
    const frame = requestAnimationFrame(() => {
      const link = containerRef.current?.querySelector<HTMLElement>(`[data-index="${index}"] [data-decke-card]`)
      const box = link?.getBoundingClientRect()
      if (link && box && box.bottom > 0 && box.top < window.innerHeight) {
        link.focus({ preventScroll: true })
        return
      }
      virtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' })
      requestAnimationFrame(() => {
        containerRef.current?.querySelector<HTMLElement>(`[data-index="${index}"] [data-decke-card]`)
          ?.focus({ preventScroll: true })
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeCard, cards, virtualizer])

  // Mirrors `GridView`'s reveal effect exactly (down to the "already
  // centred, don't re-animate" check) — one row per index here instead of
  // one row per `cols` cards, since Table has no column count to divide by.
  useEffect(() => {
    if (!reveal) return
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
      if (centre > h * (0.5 - REVEAL_CENTERED_BAND) && centre < h * (0.5 + REVEAL_CENTERED_BAND)) return
    }
    virtualizer.scrollToIndex(index, {
      align: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [reveal, cards, virtualizer])

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
        <div className="w-[48px] shrink-0 md:w-[72px]" />
        <div className="flex flex-1 items-center gap-[8px] px-[8px] py-[10px] md:gap-[16px] md:px-[16px]">
          <span className="w-[32px] shrink-0 md:w-[48px]">#</span>
          <span className="flex-1">Name</span>
          {/* Fixed widths (110px/72px/128px), matched literally below on each
              row rather than computed — Tailwind's class generator only sees
              literal strings in source, so a shared JS constant interpolated
              into `w-[${n}px]` would silently never generate any CSS. These
              are what actually fixes Astra's finding: PERF-03 added this
              header on top of a row whose trailing content (variant badge,
              price, the counters `RowCounters` conditionally renders) was
              flex-flowing with no reserved width, so `Name`'s flex-1 grew or
              shrank per row depending on what happened to render after it —
              shifting Price's own position between rows, not just relative
              to this header. Fixed widths make every row's Price and
              Variant land at the same x regardless of that row's own
              variant/counter content.
              `md:` (768px), not `sm:` (640px) — Astra caught this too:
              turning BOTH reserved columns on at exactly 640px needs roughly
              658px of content width, which `Content`'s gutters don't hand
              back until well past that breakpoint (measured: 608px available
              at 640px). Between 640-690px the sum of fixed columns exceeded
              the available width and `Name` collapsed to zero again — the
              same failure as at 390px, just at a boundary my first pass
              didn't test empirically. `md:` leaves comfortable headroom;
              re-verified at 640/700/768/800/900px with none of the fixed
              columns ever pushing `Name` below a readable width. */}
          <span className="hidden w-[110px] shrink-0 truncate text-right md:block">Variant</span>
          <span className="w-[56px] shrink-0 text-right md:w-[72px]">Price</span>
          {/* `hidden md:block`, same as Variant above and for the same reason
              as its row-side comment: reserving the full 128px this needs for
              up to 4 counter chips (wiki: Frontend-Research, "1-4 badges")
              leaves less than nothing for Name below that width — measured,
              not guessed: the card's own NAME rendered at 0 width with this
              slot shown unconditionally, both below 640px AND in the
              640-690px band once Variant also turned on (see that comment).
              FLAGGED DECISION (see DECISIONS.md this date): Table view no
              longer offers quantity counters below `md` at all (previously
              shown, just unaligned, at every width) — switch to Grid or open
              the card sheet to edit quantities below a tablet-ish width.
              Reversible; a compact single "+" affordance opening a picker
              sheet instead of up to 4 inline chips was the alternative I
              considered but didn't build without a design call on it. */}
          {signedIn === true && <span className="hidden w-[128px] shrink-0 md:block" />}
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
                onFocus={() => { focusedRowRef.current = vRow.index }}
                className="group flex items-stretch overflow-hidden rounded-lg bg-surface-tertiary hover:bg-action-default-hover"
              >
                {/* Thumbnail: object-cover into a landscape window crops to the card's
                    art box — full card width, centred on the upper illustration. */}
                <div className="w-[48px] shrink-0 overflow-hidden bg-surface-secondary md:w-[72px]">
                  <img
                    src={card.images.low}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                    style={{ objectPosition: 'center 20%' }}
                  />
                </div>
                {/* `min-w-0`: this content div is ITSELF a flex item, a
                    sibling of the 72px thumbnail in `CardLink`'s row — the
                    same default-min-width issue `Name` has below applies one
                    level up too, and without it here the whole content div
                    refuses to shrink below its children's combined natural
                    width, overflowing the row rather than letting `Name`
                    (which already has its own `min-w-0`) actually give up
                    space. Confirmed empirically at 390px: without this, the
                    content div rendered ~100px wider than the row itself. */}
                <div className="flex min-w-0 flex-1 items-center gap-[8px] px-[8px] py-[12px] md:gap-[16px] md:px-[16px]">
                  <span className="w-[32px] shrink-0 text-[14px] text-text-muted md:w-[48px]">{fmtNumber(card.number)}</span>
                  {/* `min-w-0`: a flex item's default min-width is its own
                      content size, not 0 — without this, a long name refuses
                      to shrink for the fixed columns after it and pushes them
                      instead, which on a narrow viewport is exactly the same
                      row-to-row Price drift the fixed widths above exist to
                      prevent, just caused by Name overflowing rather than
                      Counters varying. Confirmed empirically: without this,
                      Price's x-position varied ±20px across rows at 390px
                      even with every column after it fixed-width. */}
                  <span className="font-display min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{card.name}</span>
                  {/* Same swap as the grid tile: on a list the reader wants the
                      printing THIS row is, not how many printings exist.
                      Fixed width + truncate, matching the header (see its
                      comment) and `Name` above — a long printing name
                      ("Special Illustration Rare") clips with an accessible
                      `title` rather than pushing every column after it. */}
                  <div className="hidden w-[110px] shrink-0 justify-end md:flex">
                    {card.variant ? (
                      <VariantChip variant={card.variant} className="min-w-0 truncate text-text-body" />
                    ) : (
                      card.variantCount > 1 && (
                        <span className="min-w-0 truncate text-[14px] text-text-muted">{card.variantCount} variants</span>
                      )
                    )}
                  </div>
                  <span className="w-[56px] shrink-0 text-right text-[14px] font-medium text-change-positive md:w-[72px]">
                    {fmtPrice(card.price)}
                  </span>
                  {/* Write affordance: hidden signed-out (the API sends no quantities
                      and there is nothing to write to) AND below `md` — see the
                      header's comment (FLAGGED DECISION) for why counters are
                      no longer offered below a tablet-ish width at all, not
                      just unaligned. Reserved whenever ANY row might show
                      counters, even one whose own card has none, so `Name`
                      doesn't grow or shrink per row depending on it — the
                      actual cause of Astra's first finding, per the header's
                      other comment. */}
                  {signedIn === true && (
                    <div className="hidden w-[128px] shrink-0 justify-end md:flex">
                      {set && <RowCounters card={{ cardId: `${set}-${card.number}`, name: card.name }} setId={set} />}
                    </div>
                  )}
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
