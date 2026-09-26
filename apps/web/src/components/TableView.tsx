import { useQuery } from '@tanstack/react-query'
import { api, type CardRow } from '../lib/api'
import { useOwnedCounts } from '../lib/collectionWrites'
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

// Table view (UI-SPEC §3.26). No <table>: a flex column of per-card rows, each a
// header bar with a cropped art thumbnail, the number/name, the representative
// price, and per-variant "have" counters on the far right.
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
  return (
    <div className="flex flex-col gap-[20px]">
      {cards.map((card) => {
        const series = card.seriesSlug ?? seriesSlug
        const set = card.setId ?? setId
        return (
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
              {set && signedIn === true && <RowCounters card={{ cardId: `${set}-${card.number}`, name: card.name }} setId={set} />}
              <Icon name="chevron-right" size={16} className="text-icon-muted" />
            </div>
          </CardLink>
        )
      })}
    </div>
  )
}
