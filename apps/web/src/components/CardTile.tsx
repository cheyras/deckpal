import { useEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CardRow, type TileVariant } from '../lib/api'
import { fmtPrice, fmtNumber, rarityGlyph } from '../lib/format'
import { useOnline } from '../lib/useOnline'
import { useSignedIn } from '../lib/session'
import { CardImage } from './CardImage'
import { Icon } from './Icon'
import type { CardSearch } from '../routes/setSearch'

// Per-variant accent colour + whether the filled chip needs dark text for
// legibility (yellow/normal does; purple/blue do not). Mirrors CardDetail's
// variantColor() + the VariantLegend so the grid counters read as the same system.
function variantMeta(v: TileVariant): { color: string; dark: boolean; order: number } {
  const k = v.kind.toLowerCase()
  if (v.tier === 'special') return { color: 'var(--color-variant-other)', dark: true, order: 3 }
  if (k.includes('reverse')) return { color: 'var(--color-variant-reverse-holo)', dark: false, order: 2 }
  if (k.includes('holo')) return { color: 'var(--color-variant-holofoil)', dark: false, order: 1 }
  return { color: 'var(--color-variant-normal)', dark: true, order: 0 }
}

// A single tappable count box (one main variant). Tap = +1, long-press or
// right-click = −1 (floored at 0 via the disabled state). Sits above the card
// image, so every handler stops propagation to keep the tile's link inert.
function CounterBox({
  label,
  color,
  dark,
  qty,
  disabled,
  onInc,
  onDec,
}: {
  label: string
  color: string
  dark: boolean
  qty: number
  disabled: boolean
  onInc: () => void
  onDec: () => void
}) {
  const timer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const clear = () => {
    if (timer.current != null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  useEffect(() => clear, [])

  const startPress = () => {
    longPressed.current = false
    clear()
    timer.current = window.setTimeout(() => {
      longPressed.current = true
      if (qty > 0) onDec()
    }, 500)
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${label}: ${qty} owned. Tap to add one, long-press to remove one.`}
      title={`${label} — ${qty} owned · tap +1, hold −1`}
      onPointerDown={(e) => {
        e.stopPropagation()
        startPress()
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (qty > 0) onDec()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (longPressed.current) {
          longPressed.current = false
          return
        }
        onInc()
      }}
      className="flex h-[24px] min-w-[22px] items-center justify-center rounded-[6px] px-[5px] text-[12px] font-extrabold leading-none tabular-nums shadow-panel transition-opacity enabled:hover:opacity-90 disabled:opacity-60"
      style={
        qty > 0
          ? { background: color, color: dark ? '#15181f' : '#fff' }
          : {
              background: 'var(--color-surface-tertiary-transparent)',
              color: 'var(--color-text-muted)',
              border: `2px solid ${color}`,
            }
      }
    >
      {qty > 0 ? qty : ''}
    </button>
  )
}

// Per-variant quantity counters (pkmn.gg's little count boxes).
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
// transform, no shadow (pkmn.gg's is completely inert). Only the name link
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
  // Optional owned-state rendering (species detail / signed-in grid, pkmn.gg captures
  // §15.2): dim un-owned cards, and stamp a quantity chip on owned ones. Omitted on
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
  // On the set page AND the species page the tile opens the detail as a bottom-sheet
  // (a ?card= search change that leaves the current page mounted → scroll/filter
  // preserved) instead of a full-page nav. Elsewhere (lists) it links to the card
  // route as before. "Current page" = the leaf route match; opening the sheet is only
  // a search-param change, so the leaf stays put and tiles remain in sheet mode. The
  // standalone card route ('/…/$set/$number') is a different leaf.
  //   • Set page keys ?card= by card NUMBER (SetDetail rebuilds the id from its set).
  //   • Species page spans many sets, so it keys ?card= by the full cardId.
  const leafId = useRouterState({ select: (s) => s.matches[s.matches.length - 1]?.routeId })
  const speciesId = useRouterState({
    select: (s) => (s.matches[s.matches.length - 1]?.params as { speciesId?: string } | undefined)?.speciesId,
  })
  const onSetPage = leafId === '/series/$series/$set'
  const onSpeciesPage = leafId === '/pokedex/$speciesId'

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
          <span className="absolute bottom-[8px] right-[8px] rounded-md bg-action-primary px-[7px] py-[2px] text-[12px] font-extrabold leading-[16px] text-action-primary-text shadow-panel">
            ×{qty}
          </span>
        )}
        {card.variantCount > 1 && (
          <span className="absolute bottom-[8px] left-[8px] rounded-md bg-surface-tertiary-transparent px-[8px] py-[3px] text-[12px] font-medium leading-[18px] text-text-muted backdrop-blur-sm">
            <span className="font-bold text-text-body">+{card.variantCount - 1}</span> Variants
          </span>
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
          <span className="truncate text-[16px] font-normal leading-[23px] text-text-primary">
            {card.name}
          </span>
          <span className="shrink-0 text-[16px] font-normal leading-[23px] text-change-positive">
            {fmtPrice(card.price)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] leading-[23px] text-text-muted">{fmtNumber(card.number)}</span>
          <span className="text-[13px] leading-[23px] text-text-secondary" title={card.rarity ?? ''}>
            {rarityGlyph(card.rarity)}
          </span>
        </div>
      </div>
    </>
  )

  // Set page: open the sheet via a scroll-preserving search-param change.
  if (onSetPage) {
    return (
      <Link
        to="/series/$series/$set"
        params={{ series, set }}
        search={((prev: CardSearch) => ({ ...prev, card: card.number })) as never}
        resetScroll={false}
        className="group block"
      >
        {inner}
      </Link>
    )
  }

  // Species page: same sheet, keyed by the full cardId (the page spans many sets).
  if (onSpeciesPage && speciesId) {
    return (
      <Link
        to="/pokedex/$speciesId"
        params={{ speciesId }}
        search={((prev: { card?: string }) => ({ ...prev, card: card.cardId })) as never}
        resetScroll={false}
        className="group block"
      >
        {inner}
      </Link>
    )
  }

  // Everywhere else: full navigation to the standalone card route.
  return (
    <Link
      to="/series/$series/$set/$number"
      params={{ series, set, number: card.number }}
      className="group block"
    >
      {inner}
    </Link>
  )
}
