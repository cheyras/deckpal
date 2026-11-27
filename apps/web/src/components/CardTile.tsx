import { useQuery } from '@tanstack/react-query'
import { api, type CardRow, type TileVariant } from '../lib/api'
import { useOwnedCounts } from '../lib/collectionWrites'
import { fmtPrice, fmtNumber } from '../lib/format'
import { RarityMark } from './RarityMark'
import { useOnline } from '../lib/useOnline'
import { useSignedIn } from '../lib/session'
import { CardImage } from './CardImage'
import { CounterBox } from './ui/CounterBox'
import { Icon } from './Icon'
import { variantMeta } from '../lib/variantStyle'
import { CardLink } from './CardLink'

import { VariantChip } from './VariantChip'

// ── The footer, and why its height is a constant ─────────────────────────────
//
// GridView virtualizes rows and never measures a tile: it computes a row's
// height as art + CARD_TILE_FOOTER_H + gap. So the footer is a FIXED-height box
// (set from this constant, not left to its content) and GridView imports the
// number from here — the tile and the row arithmetic cannot disagree.
//
//   pt 10 + name/price 23 + number/rarity 23 + strip (mt 6 + 24) = 86
//
// The strip is the last line: the "+N Variants" note (or, on a list, which
// printing this row is) on the left, the per-variant count boxes (or an owned
// total) on the right. All of those used to be absolutely positioned OVER THE
// BOTTOM OF THE CARD ART — exactly where a card prints its collector number,
// rarity mark, set code, weakness/retreat and the end of its attack text. The
// owner (2026-11-27): "the number and the rarity get covered up". On the page's
// own surface they cover nothing, and an empty count box reads as an empty slot
// instead of a hole through the card (the "half-hidden" Tropius chip: an
// outlined, transparent box with card art showing through it).
//
// The strip is reserved on every tile, filled or not, so a row's names and
// numbers line up and every row is the same height.
const STRIP_H = 24
export const CARD_TILE_FOOTER_H = 10 + 23 + 23 + 6 + STRIP_H

// Per-variant quantity counters — the small count boxes under each tile.
//
// `seed` is the card's standard-tier variants as served inline by /sets/:setId.
// When it is present this component issues NO request at all. It used to always
// open its own ['card', cardId] query, which meant the set grid fired one
// GET /cards/:id per rendered tile — 18 requests at 1440px, ~900 ms each, and
// none of them started until the set response had landed. Tiles rendered outside
// a set response (lists, search) have no seed and still fetch.
//
// Reads come straight from `seed` rather than from a react-query cache so the
// grid can never disagree with the set response that painted it. Writes go
// through lib/collectionWrites: a tap shows at once, a tap made while the last
// one is still saving is kept rather than refused, and the server's answer is
// written back into that same set response.
function VariantCounters({ card, setId, seed }: { card: { cardId: string; name: string }; setId: string; seed?: TileVariant[] }) {
  const online = useOnline()
  const owned = useOwnedCounts(setId)
  const { data: fetched } = useQuery({
    queryKey: ['card', card.cardId],
    queryFn: ({ signal }) => api.card(card.cardId, signal),
    enabled: seed === undefined,
  })
  const variants: TileVariant[] | undefined = seed ?? fetched?.variants

  if (!variants) return null
  const standard = variants
    .filter((v) => v.tier === 'standard')
    .map((v) => ({ v, meta: variantMeta(v), qty: owned.shown(v.variantId, v.quantity) }))
    .sort((a, b) => a.meta.order - b.meta.order)
  if (standard.length === 0) return null

  return (
    <div
      // `px-card-counters` is no longer needed for its premium.css z-index (the
      // boxes are off the art now) but is the hook tests/browser/writes.mjs
      // finds the counters by.
      className="px-card-counters flex shrink-0 items-center gap-[4px]"
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

// The signature component (UI-SPEC §3.2). The tile is INERT — no hover
// transform, no shadow. A tile is a link, not a control, and a grid of a hundred
// animating tiles is noise. Only the name link
// carries the focus ring. Footer is a fixed-height block for uniform rows.
// On list pages a card carries its own series/set (a list spans many sets) and
// may render a remove affordance; both fall back to the set-page props.
export function CardTile({
  card,
  seriesSlug,
  setId,
  eager = false,
  onRemove,
  badge,
  ownership,
}: {
  card: CardRow
  seriesSlug: string
  setId: string
  eager?: boolean
  onRemove?: () => void
  badge?: string
  // Optional owned-state rendering (species detail / signed-in grid): dim un-owned
  // cards, and stamp a quantity chip on owned ones. Omitted on
  // the set page, which is unaffected.
  ownership?: boolean
}) {
  const series = card.seriesSlug ?? seriesSlug
  const set = card.setId ?? setId
  const owned = ownership ? card.ownership?.have : undefined
  const qty = card.ownership?.totalQuantity ?? 0
  // The count boxes are a write affordance. Logged out there is no collection to
  // write to and the API sends no quantities, so the tile stays a clean piece of
  // catalog — the page-level prompt (SetHeader) is where the ask lives.
  const signedIn = useSignedIn()
  // Per-variant count boxes only make sense on the plain set catalog: skip them
  // when the tile already renders an ownership total, a badge, or a remove button
  // (their lower-right corner is spoken for) or has no real set to resolve.
  const showCounters = signedIn === true && !ownership && !badge && !onRemove && Boolean(set)
  // Where a click goes is `CardLink`'s decision, not this component's — see the
  // header there for why it stopped being three separate decisions.

  const inner = (
    <>
      <div className="relative" style={owned === false ? { opacity: 0.5, filter: 'grayscale(0.6)' } : undefined}>
        <CardImage
          low={card.images.low}
          high={card.images.high}
          alt={`${card.name} — ${fmtNumber(card.number)}`}
          eager={eager}
        />
        {/* The one control still ON the art: a list's remove button, top-right,
            clear of the number and rarity at the bottom. */}
        {onRemove && (
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`Remove ${card.name}`}
            // `px-card-badge`: not a badge, but it earns the premium-skin rule
            // (premium.css §"Counters and overlay badges sit at z-index 2") —
            // the card-art lift on hover/focus (premium.css §"Card art")
            // promotes `.px-card-art` to z-index 1, and without a matching
            // z-index this button sat BELOW that lifted layer despite being
            // later in the DOM: on a real mouse, hovering far enough to see the
            // (formerly invisible) button also covered it, so it was unclickable
            // in the premium skin whether or not it was visible.
            className="px-card-badge absolute right-[8px] top-[8px] flex h-[28px] w-[28px] items-center justify-center rounded-full bg-action-danger-fill text-action-danger-text hover:bg-action-danger-fill-hover"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {/* Footer block — fixed height (CARD_TILE_FOOTER_H, see the top of this
          file), uniform for virtualization. */}
      <div className="flex flex-col pt-[10px]" style={{ height: CARD_TILE_FOOTER_H }}>
        <div className="flex items-baseline justify-between gap-[8px]">
          <span className="font-display truncate text-[16px] font-normal leading-[23px] text-text-primary">
            {card.name}
          </span>
          <span className="shrink-0 text-[16px] font-normal leading-[23px] text-change-positive">
            {fmtPrice(card.price)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[14px] leading-[23px] text-text-muted">{fmtNumber(card.number)}</span>
          <span className="text-[14px] leading-[23px] text-text-secondary" title={card.rarity ?? ''}>
            <RarityMark rarity={card.rarity} />
          </span>
        </div>
        {/* The strip: what is said ABOUT the card, under it rather than on it. */}
        <div className="mt-[6px] flex min-w-0 items-center justify-between gap-[8px]" style={{ height: STRIP_H }}>
          {/* THE SPECIFIC PRINTING WINS OVER THE CATALOGUE COUNT.
              `card.variant` is present only on list rows, where the reader is
              asking "which printing did I add?" — and `+N Variants` answers "how
              many other printings exist", which is a different question and was
              being mistaken for the first one (2026-08-29 walkthrough). On the
              set page there is no `card.variant`, every printing is on screen
              anyway, and the count is the useful fact. */}
          {card.variant ? (
            <VariantChip variant={card.variant} className="min-w-0 text-text-secondary" />
          ) : card.variantCount > 1 ? (
            <span className="min-w-0 truncate text-[12px] font-medium leading-[18px] text-text-muted">
              <span className="font-bold text-text-secondary">+{card.variantCount - 1}</span>{' '}
              {card.variantCount - 1 === 1 ? 'Variant' : 'Variants'}
            </span>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex shrink-0 items-center gap-[6px]">
            {owned === true && qty > 0 && (
              <span className="rounded-md bg-action-primary px-[7px] py-[2px] text-[14px] font-extrabold leading-[16px] text-action-primary-text shadow-panel">
                ×{qty}
              </span>
            )}
            {badge && (
              <span className="rounded-md bg-action-primary-strong px-[8px] py-[3px] text-[12px] font-bold leading-[18px] text-action-primary-strong-text">
                {badge}
              </span>
            )}
            {showCounters && (
              <VariantCounters card={{ cardId: `${set}-${card.number}`, name: card.name }} setId={set} seed={card.standardVariants} />
            )}
          </div>
        </div>
      </div>
    </>
  )

  return (
    <CardLink card={card} seriesSlug={series} setId={set} className="group block">
      {inner}
    </CardLink>
  )
}
