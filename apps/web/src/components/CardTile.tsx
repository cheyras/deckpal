import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CardRow, type TileVariant } from '../lib/api'
import { fmtPrice, fmtNumber } from '../lib/format'
import { RarityMark } from './RarityMark'
import { useOnline } from '../lib/useOnline'
import { useSignedIn } from '../lib/session'
import { CardImage } from './CardImage'
import { CounterBox } from './ui/CounterBox'
import { Icon } from './Icon'
import { variantMeta } from '../lib/variantStyle'
import { CardLink } from './CardLink'

import { VariantBadge } from './VariantChip'

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
// grid can never disagree with the set response that painted it. Optimistic
// writes live in a local overlay that clears the moment fresh server data
// arrives; the ['set', setId] invalidation on settle is what delivers it.
function VariantCounters({ cardId, setId, seed }: { cardId: string; setId: string; seed?: TileVariant[] }) {
  const qc = useQueryClient()
  const online = useOnline()
  const { data: fetched } = useQuery({
    queryKey: ['card', cardId],
    queryFn: ({ signal }) => api.card(cardId, signal),
    enabled: seed === undefined,
  })
  const variants: TileVariant[] | undefined = seed ?? fetched?.variants

  const [pending, setPending] = useState<Record<number, number>>({})
  // Fresh server data supersedes any optimistic value. `variants` keeps a stable
  // identity between refetches, so this fires exactly when new data lands.
  useEffect(() => {
    setPending((p) => (Object.keys(p).length ? {} : p))
  }, [variants])

  const shown = variants?.map((v) =>
    pending[v.variantId] !== undefined ? { ...v, quantity: pending[v.variantId]! } : v,
  )

  const mutation = useMutation({
    mutationFn: ({ variantId, delta }: { variantId: number; delta: number }) =>
      api.incrementVariant(variantId, delta),
    onMutate: ({ variantId, delta }) => {
      const current = shown?.find((v) => v.variantId === variantId)?.quantity ?? 0
      const prev = pending[variantId]
      setPending((p) => ({ ...p, [variantId]: Math.max(0, current + delta) }))
      return { variantId, prev }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      setPending((p) => {
        const next = { ...p }
        if (ctx.prev === undefined) delete next[ctx.variantId]
        else next[ctx.variantId] = ctx.prev
        return next
      })
    },
    onSettled: () => {
      // CardDetail shares the ['card', cardId] cache; the set query carries both
      // the progress bars and (now) the quantities these boxes render.
      void qc.invalidateQueries({ queryKey: ['card', cardId] })
      void qc.invalidateQueries({ queryKey: ['set', setId] })
    },
  })

  if (!shown) return null
  const standard = shown
    .filter((v) => v.tier === 'standard')
    .map((v) => ({ v, meta: variantMeta(v) }))
    .sort((a, b) => a.meta.order - b.meta.order)
  if (standard.length === 0) return null

  return (
    <div
      className="absolute bottom-[8px] right-[8px] flex items-center gap-[4px]"
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
        {owned === true && qty > 0 && (
          <span className="absolute bottom-[8px] right-[8px] rounded-md bg-action-primary px-[7px] py-[2px] text-[14px] font-extrabold leading-[16px] text-action-primary-text shadow-panel">
            ×{qty}
          </span>
        )}
        {/* This badge sits on ARBITRARY card art, so it cannot rely on a
            half-transparent grey the way a badge on a known surface can:
            rgb(64 64 64 / 0.5) behind text-text-muted (#7f8596) disappears over
            the bright half of a card and reads as text spilling off its own
            background. A dark scrim plus body-weight text holds up over both a
            black holo border and a pale green frame. */}
        {/* THE SPECIFIC PRINTING WINS OVER THE CATALOGUE COUNT.
            `card.variant` is present only on list rows, where the reader is
            asking "which printing did I add?" — and `+N Variants` answers "how
            many other printings exist", which is a different question and was
            being mistaken for the first one (2026-08-29 walkthrough). On the set
            page there is no `card.variant`, every printing is on screen anyway,
            and the count is the useful fact, so nothing there changes. */}
        {card.variant ? (
          <VariantBadge variant={card.variant} />
        ) : (
          card.variantCount > 1 && (
            <span className="absolute bottom-[8px] left-[8px] rounded-md bg-overlay-scrim-strong px-[8px] py-[3px] text-[12px] font-medium leading-[18px] text-text-body backdrop-blur-sm">
              <span className="font-bold text-text-primary">+{card.variantCount - 1}</span> Variants
            </span>
          )
        )}
        {badge && (
          <span className="absolute bottom-[8px] right-[8px] rounded-md bg-action-primary-strong px-[8px] py-[3px] text-[12px] font-bold leading-[18px] text-action-primary-strong-text">
            {badge}
          </span>
        )}
        {onRemove && (
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`Remove ${card.name}`}
            className="absolute right-[8px] top-[8px] flex h-[28px] w-[28px] items-center justify-center rounded-full bg-action-danger text-action-danger-text opacity-0 transition-opacity hover:bg-action-danger-hover group-hover:opacity-100"
          >
            <Icon name="close" size={16} />
          </button>
        )}
        {showCounters && (
          <VariantCounters cardId={`${set}-${card.number}`} setId={set} seed={card.standardVariants} />
        )}
      </div>
      {/* Footer block — 74px, uniform for virtualization */}
      <div className="pt-[10px]">
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
      </div>
    </>
  )

  return (
    <CardLink card={card} seriesSlug={series} setId={set} className="group block">
      {inner}
    </CardLink>
  )
}
