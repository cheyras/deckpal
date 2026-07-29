import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { api, type CardDetailResponse, type Progress, type SetDetailResponse, type Variant } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill, SetSymbolTile } from '../components/ui'
import { CardImage } from '../components/CardImage'
import { Icon } from '../components/Icon'
import { EnergyIcon } from '../components/EnergyIcon'
import { fmtPrice, fmtDate, fmtNumber, fmtRelative } from '../lib/format'
import { useOnline } from '../lib/useOnline'
import { CARD_SEARCH_DEFAULTS } from './setSearch'

// Map a variant kind to its accent colour (AUTH-CAPTURES §12.3).
function variantColor(v: Variant): string {
  const k = v.kind.toLowerCase()
  if (v.tier === 'special') return 'var(--color-variant-other)'
  if (k.includes('reverse')) return 'var(--color-variant-reverse-holo)'
  if (k.includes('holo')) return 'var(--color-variant-holofoil)'
  return 'var(--color-variant-normal)'
}

// ── Optimistic progress maths — mirrors the server recompute (SCHEMA §5.3/§9.2)
// so the three bars move instantly, then reconcile against the authoritative
// server numbers on settle. Given a card's variant list, how many goal-units it
// contributes: complete (0/1 card), master ((card,standard-variant) pairs owned),
// grandmaster ((card,any-variant) pairs owned).
type OwnBits = { tier: 'standard' | 'special'; isPrimary: boolean; quantity: number }
function cardOwnedUnits(variants: OwnBits[]): { complete: number; master: number; grand: number } {
  const anyOwned = variants.some((v) => v.quantity >= 1)
  const hasStd = variants.some((v) => v.tier === 'standard')
  const masterReq = hasStd ? variants.filter((v) => v.tier === 'standard') : variants.filter((v) => v.isPrimary)
  return {
    complete: anyOwned ? 1 : 0,
    master: masterReq.filter((v) => v.quantity >= 1).length,
    grand: variants.filter((v) => v.quantity >= 1).length,
  }
}

function pct(owned: number, total: number): number {
  if (!owned || !total) return 0
  return Math.round((owned / total) * 1000) / 10
}

function setLevelFor(owned: number, total: number): number {
  if (owned === 0 || total === 0) return 0
  return 1 + Math.min(4, Math.floor(((owned * 100) / total) / 25))
}

/**
 * Optimistically fold a single variant's quantity change into every cached
 * ['card', cardId] and ['set', setId, …] query, and return an undo closure.
 * total_required is never touched (catalog-fixed); only owned + totalQuantity + pct move.
 */
function optimisticApply(
  qc: QueryClient,
  cardId: string,
  setId: string,
  variantId: number,
  newQty: number,
): () => void {
  const cardKey = ['card', cardId] as const
  const prevCard = qc.getQueryData<CardDetailResponse>(cardKey)
  const prevSets = qc.getQueriesData<SetDetailResponse>({ queryKey: ['set', setId] })

  if (!prevCard) return () => undefined
  const before = prevCard.variants.map<OwnBits>((v) => ({ tier: v.tier, isPrimary: v.isPrimary, quantity: v.quantity }))
  const changed = prevCard.variants.find((v) => v.variantId === variantId)
  const oldQty = changed?.quantity ?? 0
  const clampedNew = Math.max(0, newQty)
  const after = prevCard.variants.map<OwnBits>((v) => ({
    tier: v.tier,
    isPrimary: v.isPrimary,
    quantity: v.variantId === variantId ? clampedNew : v.quantity,
  }))
  const b = cardOwnedUnits(before)
  const a = cardOwnedUnits(after)
  const dOwned = { complete: a.complete - b.complete, master: a.master - b.master, grand: a.grand - b.grand }
  const qtyDelta = clampedNew - oldQty
  const wasMasterReq = (() => {
    const hasStd = before.some((v) => v.tier === 'standard')
    return changed ? (hasStd ? changed.tier === 'standard' : changed.isPrimary) : false
  })()

  // Card query: just the one variant's quantity.
  qc.setQueryData<CardDetailResponse>(cardKey, (old) =>
    old
      ? { ...old, variants: old.variants.map((v) => (v.variantId === variantId ? { ...v, quantity: clampedNew } : v)) }
      : old,
  )

  // Every cached set view: shift progress owned/pct/totalQuantity + the card row.
  qc.setQueriesData<SetDetailResponse>({ queryKey: ['set', setId] }, (old) => {
    if (!old) return old
    const p = old.progress
    const nextProgress: Progress = {
      complete: {
        ...p.complete,
        owned: p.complete.owned + dOwned.complete,
        pct: pct(p.complete.owned + dOwned.complete, p.complete.total),
        totalQuantity: (p.complete.totalQuantity ?? 0) + qtyDelta,
        setLevel: setLevelFor(p.complete.owned + dOwned.complete, p.complete.total),
      },
      master: {
        ...p.master,
        owned: p.master.owned + dOwned.master,
        pct: pct(p.master.owned + dOwned.master, p.master.total),
        totalQuantity: (p.master.totalQuantity ?? 0) + (wasMasterReq ? qtyDelta : 0),
      },
      grandmaster: {
        ...p.grandmaster,
        owned: p.grandmaster.owned + dOwned.grand,
        pct: pct(p.grandmaster.owned + dOwned.grand, p.grandmaster.total),
        totalQuantity: (p.grandmaster.totalQuantity ?? 0) + qtyDelta,
      },
    }
    const cards = old.cards.map((c) => {
      if (c.cardId !== cardId) return c
      const newTotal = c.ownership.totalQuantity + qtyDelta
      return {
        ...c,
        ownership: { ...c.ownership, totalQuantity: newTotal, have: newTotal >= 1, need: newTotal === 0, dupe: newTotal >= 2 },
      }
    })
    return { ...old, progress: nextProgress, cards }
  })

  return () => {
    qc.setQueryData(cardKey, prevCard)
    for (const [key, data] of prevSets) qc.setQueryData(key, data)
  }
}

function QtyStepper({
  v,
  color,
  quantity,
  onAdjust,
  pending,
}: {
  v: Variant
  color: string
  quantity: number
  onAdjust: (variantId: number, newQty: number) => void
  pending: boolean
}) {
  const owned = quantity > 0
  // Collection writes are network-only (hard rule — no offline write queue). When
  // offline, disable the steppers with a clear reason rather than letting a tap fail.
  const online = useOnline()
  const offlineTitle = online ? undefined : 'Offline — reconnect to change your collection'
  return (
    <div className="flex items-center gap-[8px]" title={offlineTitle}>
      <button
        onClick={() => onAdjust(v.variantId, quantity - 1)}
        disabled={pending || !online || quantity <= 0}
        aria-label={`Remove one ${v.displayName}`}
        className="flex h-[36px] w-[36px] items-center justify-center rounded-lg bg-surface-tertiary text-icon-default enabled:hover:bg-action-default-hover disabled:text-icon-disabled"
      >
        <Icon name="minus" size={16} />
      </button>
      <span
        className={`w-[20px] text-center text-[16px] font-bold ${owned ? 'text-text-primary' : 'text-text-muted'}`}
      >
        {quantity}
      </span>
      <button
        onClick={() => onAdjust(v.variantId, quantity + 1)}
        disabled={pending || !online}
        aria-label={`Add one ${v.displayName}`}
        className="flex h-[36px] w-[36px] items-center justify-center rounded-lg enabled:hover:opacity-90 disabled:opacity-50"
        style={{ background: owned ? color : 'var(--color-surface-tertiary)', color: owned ? '#fff' : color }}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}

// Shared column template for the variant table header + every row, so the three
// columns (Variant · Market Price · Quantity) line up on one grid at any width
// instead of two independent flex layouts drifting apart. Fixed price/qty tracks
// keep the header labels sitting directly above their data; the variant track
// (minmax(0,1fr)) absorbs the rest and its min-w-0 lets long names/URLs wrap
// rather than blow the column out of bounds.
const VARIANT_GRID = 'grid grid-cols-[minmax(0,1fr)_84px_108px] gap-x-[12px] nav:gap-x-[16px]'

function VariantRow({
  v,
  onAdjust,
  pending,
}: {
  v: Variant
  onAdjust: (variantId: number, newQty: number) => void
  pending: boolean
}) {
  const color = variantColor(v)
  const price = v.prices.find((p) => p.currency === 'USD') ?? v.prices[0] ?? null
  return (
    <div className="rounded-lg bg-surface-tertiary p-[16px]" data-owned={v.quantity > 0 ? 'true' : 'false'}>
      <div className={`${VARIANT_GRID} items-center`}>
        {/* Variant column */}
        <div className="flex min-w-0 items-start gap-[8px]">
          <span
            className="mt-[5px] inline-block h-[12px] w-[12px] shrink-0 rounded-[3px]"
            style={{ background: color }}
          />
          <div className="min-w-0">
            <div className="break-words text-[14px] font-bold text-text-primary">{v.displayName}</div>
            {v.provenance && <div className="break-words text-[12px] text-text-muted">{v.provenance}</div>}
            {v.buyUrl && (
              <a
                href={v.buyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-[8px] inline-flex h-[30px] max-w-full items-center gap-[6px] rounded-lg bg-surface-secondary px-[8px] text-[12px] font-bold text-text-primary hover:bg-action-default-hover"
              >
                <Icon name="external" size={14} className="shrink-0 text-action-brand" />
                <span className="truncate">TCGplayer</span>
              </a>
            )}
          </div>
        </div>

        {/* Market Price column */}
        <div className="min-w-0 text-right">
          {price && price.market != null ? (
            <div className="text-[16px] font-medium text-change-positive">{fmtPrice(price)}</div>
          ) : (
            <div className="text-[14px] text-text-muted">No price</div>
          )}
          {price?.pricedAt && (
            <div className="text-[10px] leading-[14px] text-text-muted">as of {fmtRelative(price.pricedAt)}</div>
          )}
        </div>

        {/* Quantity column */}
        <div className="flex justify-end">
          <QtyStepper v={v} color={color} quantity={v.quantity} onAdjust={onAdjust} pending={pending} />
        </div>
      </div>
    </div>
  )
}

function Attribute({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[6px] text-[12px] text-text-muted">{label}</div>
      <div className="flex flex-wrap gap-[8px]">{children}</div>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[34px] items-center rounded-lg bg-surface-tertiary px-[12px] text-[14px] text-text-primary">
      {children}
    </span>
  )
}

const TABS = ['Card', 'Price', 'TCG'] as const

// Standalone route (deep links / direct navigation to /series/$series/$set/$number).
// Renders the shared body inside the page Content column; on the set page the same
// body is rendered inside CardSheet instead.
export function CardDetail() {
  const { series, set, number } = useParams({ from: '/series/$series/$set/$number' })
  return (
    <Content cap={1165}>
      <CardDetailBody cardId={`${set}-${number}`} backTo={{ series, set }} />
    </Content>
  )
}

// The card-detail body (hero art + variant table on a shared grid). Reused by both
// the standalone route above and the bottom-sheet below. It is keyed solely by
// `cardId`; the authoritative series-slug + set-id come from the card fetch, so any
// entry point (set page, species page, scanner) can open it without knowing the
// route params up front. `inSheet` swaps the standalone BackPill for sheet chrome.
export function CardDetailBody({
  cardId,
  inSheet = false,
  backTo,
}: {
  cardId: string
  inSheet?: boolean
  // Optional immediate BackPill target for the standalone route, used only until
  // the card fetch resolves the authoritative series/set. Never passed in-sheet.
  backTo?: { series: string; set: string }
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Card')
  const [showAdditional, setShowAdditional] = useState(false)
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['card', cardId],
    queryFn: ({ signal }) => api.card(cardId, signal),
  })

  // Series slug + set id are resolved from the fetched card (authoritative),
  // falling back to any caller-supplied hint before the fetch settles. Both feed
  // the internal links + the ['set', setId] progress invalidation on mutation.
  const seriesSlug = data?.card.series.slug ?? backTo?.series ?? ''
  const setId = data?.card.set.setId ?? backTo?.set ?? ''

  // Own/un-own a variant. Optimistic: the stepper + the three progress bars move
  // instantly (optimisticApply), roll back on error, and reconcile against the
  // server's authoritative recompute on settle by invalidating both queries.
  const mutation = useMutation({
    mutationFn: ({ variantId, newQty }: { variantId: number; newQty: number }) =>
      api.setVariantQuantity(variantId, Math.max(0, newQty)),
    onMutate: async ({ variantId, newQty }) => {
      await qc.cancelQueries({ queryKey: ['card', cardId] })
      await qc.cancelQueries({ queryKey: ['set', setId] })
      const undo = optimisticApply(qc, cardId, setId, variantId, Math.max(0, newQty))
      return { undo }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.undo()
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['card', cardId] })
      void qc.invalidateQueries({ queryKey: ['set', setId] })
    },
  })
  const onAdjust = (variantId: number, newQty: number) => mutation.mutate({ variantId, newQty })

  return (
    <>
      {!inSheet && (
        <div className="mb-[16px]">
          <BackPill to="/series/$series/$set" params={{ series: seriesSlug, set: setId }} label={data?.card.set.name ?? 'Set'} />
        </div>
      )}

      {isLoading && <Spinner label="Loading card…" />}
      {error && <ErrorState message={(error as Error).message} />}

      {data && (
        <div className="relative">
          {/* blurred hero art behind everything */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 -z-[1] h-[400px]"
            style={{
              background: `linear-gradient(to bottom, var(--color-banner-gradient-top) 40%, var(--color-surface-primary)), url(${data.card.images.high}) center top/cover`,
              filter: 'blur(24px)',
              opacity: 0.5,
            }}
          />
          <div className="flex flex-col gap-[32px] nav:flex-row">
            {/* hero image */}
            <div className="mx-auto w-full max-w-[396px] shrink-0 nav:mx-0">
              <CardImage low={data.card.images.low} high={data.card.images.high} alt={data.card.name} eager />
            </div>

            {/* detail column */}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-[16px]">
                <h1 className="text-[40px] font-bold leading-[44px] text-text-primary">{data.card.name}</h1>
                <button className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:bg-action-default-hover">
                  <Icon name="link" size={16} />
                </button>
              </div>
              <div className="mt-[10px] flex items-center gap-[10px]">
                <SetSymbolTile setId={data.card.set.setId} hasSymbol={Boolean(data.card.set.symbolUrl)} size={28} />
                <Link
                  to="/series/$series/$set"
                  params={{ series: seriesSlug, set: setId }}
                  search={CARD_SEARCH_DEFAULTS}
                  className="text-[16px] text-link hover:text-link-hover"
                >
                  {data.card.set.name}
                </Link>
              </div>
              <div className="mt-[6px] text-[14px] text-text-muted">
                {fmtNumber(data.card.number)}
                {data.card.printedTotal ? `/${data.card.printedTotal}` : ''}
              </div>

              {/* tabs */}
              <div className="mt-[20px] flex gap-[32px] border-b border-divider-subtle">
                {TABS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`pb-[8px] text-[14px] ${
                      tab === t
                        ? 'border-b border-action-primary font-semibold text-text-primary'
                        : 'font-medium text-text-muted'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {tab === 'Card' && (
                <CardTab
                  data={data}
                  showAdditional={showAdditional}
                  setShowAdditional={setShowAdditional}
                  onAdjust={onAdjust}
                  pending={mutation.isPending}
                />
              )}
              {tab === 'Price' && (
                <div className="py-[40px] text-center text-[14px] text-text-muted">
                  Price history — coming soon.
                </div>
              )}
              {tab === 'TCG' && (
                <div className="py-[40px] text-center text-[14px] text-text-muted">
                  Format legality — coming soon.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Bottom-sheet wrapper ───────────────────────────────────────────────────────
// Card detail as a sheet that slides up over the set page (mobile) / a centred
// dialog (desktop). Mirrors ListModals' Modal for scrim / Escape / scroll-lock,
// adds an enter+exit slide animation. Closing is a route-search change owned by
// the caller (onClose) — SetDetail never unmounts, so its scroll/filter survive.
export function CardSheet({
  cardId,
  set,
  number,
  onClose,
}: {
  // Two ways to key the sheet, both resolving to one cardId:
  //  • cardId  — species page / scanner, which carry the full id directly.
  //  • set + number — the set page, whose ?card= param is just the card number.
  // `series` is still accepted (the set page passes it) but no longer needed:
  // CardDetailBody resolves the series slug from the card fetch itself.
  cardId?: string
  series?: string
  set?: string
  number?: string
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)

  // Animate in on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Animate out, then hand back to the caller to drop the ?card= param.
  const requestClose = useCallback(() => {
    setOpen(false)
    const t = window.setTimeout(onClose, 240)
    return () => window.clearTimeout(t)
  }, [onClose])

  // Escape to close + scroll-lock the page behind the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && requestClose()
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [requestClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center overflow-hidden p-0 nav:items-start nav:p-[16px] nav:pt-[64px]"
      style={{
        background: open ? 'var(--color-overlay-scrim-strong)' : 'transparent',
        transition: 'background 240ms ease',
      }}
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label="Card details"
    >
      <div
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border-default bg-surface-primary shadow-xl nav:max-h-[86vh] nav:max-w-[920px] nav:rounded-2xl"
        style={{
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header: mobile grab handle + always-present close button */}
        <div className="relative flex h-[44px] shrink-0 items-center justify-center">
          <span className="h-[4px] w-[40px] rounded-full bg-surface-tertiary nav:hidden" />
          <button
            onClick={requestClose}
            aria-label="Close"
            className="absolute right-[10px] top-[6px] flex h-[40px] w-[40px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:bg-action-default-hover"
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        {/* scrollable content */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[16px] pb-[24px] nav:px-[24px]"
          style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}
        >
          <CardDetailBody cardId={cardId ?? `${set}-${number}`} inSheet />
        </div>
      </div>
    </div>
  )
}

function CardTab({
  data,
  showAdditional,
  setShowAdditional,
  onAdjust,
  pending,
}: {
  data: import('../lib/api').CardDetailResponse
  showAdditional: boolean
  setShowAdditional: (v: boolean) => void
  onAdjust: (variantId: number, newQty: number) => void
  pending: boolean
}) {
  const c = data.card
  const standard = data.variants.filter((v) => v.tier === 'standard')
  const special = data.variants.filter((v) => v.tier === 'special')
  const buyUrl = data.variants.find((v) => v.buyUrl)?.buyUrl ?? null

  return (
    <>
      {/* variant table */}
      <div className="mt-[16px]">
        <div className={`${VARIANT_GRID} mb-[8px] items-center px-[16px] text-[12px] text-text-muted`}>
          <span>Variant</span>
          <span className="text-right">Market Price</span>
          <span className="text-right">Quantity</span>
        </div>
        <div className="flex flex-col gap-[10px]">
          {standard.map((v) => (
            <VariantRow key={v.variantId} v={v} onAdjust={onAdjust} pending={pending} />
          ))}
        </div>

        {special.length > 0 && (
          <div className="mt-[10px]">
            <button
              onClick={() => setShowAdditional(!showAdditional)}
              className="flex w-full items-center gap-[8px] py-[10px] text-[14px] font-semibold text-text-primary"
            >
              <Icon name="chevron-down" size={18} className={showAdditional ? '' : '-rotate-90'} />
              Additional Variants ({special.length})
            </button>
            {showAdditional && (
              <div className="flex flex-col gap-[10px]">
                {special.map((v) => (
                  <VariantRow key={v.variantId} v={v} onAdjust={onAdjust} pending={pending} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* buy + freshness */}
      {buyUrl && (
        <a
          href={buyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-[16px] inline-flex h-[40px] items-center gap-[8px] rounded-lg bg-action-brand px-[16px] text-[13px] font-bold text-action-brand-text hover:opacity-90"
        >
          <Icon name="external" size={16} /> Buy on TCGplayer
        </a>
      )}
      <p className="mt-[10px] text-[12px] text-text-muted">
        Prices reflect the latest daily sync. Self-hosted feed — no affiliate relationship.
      </p>

      {/* attacks */}
      {c.attacks.length > 0 && (
        <div className="mt-[24px] border-t border-divider-subtle pt-[16px]">
          {c.attacks.map((a) => (
            <div key={a.name} className="mb-[16px]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-[8px]">
                  {a.cost && (
                    <span className="flex gap-[2px]">
                      {a.cost.split(',').map((t, i) => (
                        <EnergyIcon key={i} type={t.trim()} size={18} />
                      ))}
                    </span>
                  )}
                  <span className="text-[16px] font-semibold text-text-primary">{a.name}</span>
                </div>
                {a.damage && (
                  <span className="text-[16px] font-bold text-text-primary">
                    <span className="mr-[8px] text-[12px] font-normal text-text-muted">Damage</span>
                    {a.damage}
                  </span>
                )}
              </div>
              {a.effect && <p className="mt-[4px] text-[14px] text-text-body">{a.effect}</p>}
            </div>
          ))}
        </div>
      )}

      {/* attribute grid */}
      <div className="mt-[24px] grid grid-cols-2 gap-x-[40px] gap-y-[32px] border-t border-divider-subtle pt-[24px]">
        {c.types.length > 0 && (
          <Attribute label="Type">
            {c.types.map((t) => (
              <Chip key={t}>
                <EnergyIcon type={t} size={18} className="mr-[6px]" />
                {t}
              </Chip>
            ))}
          </Attribute>
        )}
        {c.hp != null && (
          <Attribute label="HP">
            <Chip>{c.hp}</Chip>
          </Attribute>
        )}
        {c.weaknesses.length > 0 && (
          <Attribute label="Weaknesses">
            {c.weaknesses.map((w) => (
              <Chip key={w.type}>
                <EnergyIcon type={w.type} size={18} className="mr-[6px]" />
                {w.value}
              </Chip>
            ))}
          </Attribute>
        )}
        {c.resistances.length > 0 && (
          <Attribute label="Resistances">
            {c.resistances.map((r) => (
              <Chip key={r.type}>
                <EnergyIcon type={r.type} size={18} className="mr-[6px]" />
                {r.value}
              </Chip>
            ))}
          </Attribute>
        )}
        {c.retreat != null && (
          <Attribute label="Retreat Cost">
            <Chip>
              {c.retreat === 0 ? (
                '—'
              ) : (
                <span className="flex gap-[2px]">
                  {Array.from({ length: c.retreat }).map((_, i) => (
                    <EnergyIcon key={i} type="colorless" size={18} />
                  ))}
                </span>
              )}
            </Chip>
          </Attribute>
        )}
        {c.evolvesFrom && (
          <Attribute label="Evolves From">
            <Chip>{c.evolvesFrom}</Chip>
          </Attribute>
        )}
        {c.artist && (
          <Attribute label="Illustrated By">
            <Chip>{c.artist}</Chip>
          </Attribute>
        )}
        {c.species.length > 0 && (
          <Attribute label="National Pokédex #">
            {c.species.map((s) => (
              <Chip key={s.speciesId}>{s.speciesId}</Chip>
            ))}
          </Attribute>
        )}
        {c.tags.length > 0 && (
          <Attribute label="Tags">
            {c.tags.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </Attribute>
        )}
        {c.rarity && (
          <Attribute label="Rarity">
            <Chip>{c.rarity}</Chip>
          </Attribute>
        )}
        <Attribute label="Release Date">
          <Chip>{fmtDate(c.releasedOn)}</Chip>
        </Attribute>
      </div>
    </>
  )
}
