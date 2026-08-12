import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CardDetailResponse, type CardRow, type Variant } from '../lib/api'
import { fmtPrice, fmtNumber } from '../lib/format'
import { useOnline } from '../lib/useOnline'
import { useSignedIn } from '../lib/session'
import { CounterBox } from './ui/CounterBox'
import { Icon } from './Icon'
import { variantMeta } from '../lib/variantStyle'

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
          <Link
            key={(card as { itemId?: string }).itemId ?? card.cardId}
            to="/series/$series/$set/$number"
            params={{ series, set, number: card.number }}
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
              <span className="w-[48px] shrink-0 text-[12px] text-text-muted">{fmtNumber(card.number)}</span>
              <span className="font-display flex-1 truncate text-[14px] font-medium text-text-primary">{card.name}</span>
              {card.variantCount > 1 && (
                <span className="hidden text-[12px] text-text-muted sm:inline">{card.variantCount} variants</span>
              )}
              <span className="text-[14px] font-medium text-change-positive">{fmtPrice(card.price)}</span>
              {/* Write affordance: hidden signed-out (the API sends no quantities
                  and there is nothing to write to). The header carries the CTA. */}
              {set && signedIn === true && <RowCounters cardId={`${set}-${card.number}`} setId={set} />}
              <Icon name="chevron-right" size={16} className="text-icon-muted" />
            </div>
          </Link>
        )
      })}
    </div>
  )
}
