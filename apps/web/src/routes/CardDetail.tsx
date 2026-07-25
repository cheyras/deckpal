import { useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { api, type CardDetailResponse, type Progress, type SetDetailResponse, type Variant } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill, SetSymbolTile } from '../components/ui'
import { CardImage } from '../components/CardImage'
import { Icon } from '../components/Icon'
import { fmtPrice, fmtDate, fmtNumber, fmtRelative } from '../lib/format'
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
  return (
    <div className="flex items-center gap-[8px]">
      <button
        onClick={() => onAdjust(v.variantId, quantity - 1)}
        disabled={pending || quantity <= 0}
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
        disabled={pending}
        aria-label={`Add one ${v.displayName}`}
        className="flex h-[36px] w-[36px] items-center justify-center rounded-lg enabled:hover:opacity-90 disabled:opacity-50"
        style={{ background: owned ? color : 'var(--color-surface-tertiary)', color: owned ? '#fff' : color }}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}

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
      <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[10px]">
        <span className="inline-block h-[12px] w-[12px] shrink-0 rounded-[3px]" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-text-primary">{v.displayName}</div>
          {v.provenance && <div className="text-[12px] text-text-muted">{v.provenance}</div>}
        </div>
        {v.buyUrl && (
          <a
            href={v.buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[36px] items-center gap-[6px] rounded-lg bg-surface-secondary px-[12px] text-[12px] font-bold text-text-primary hover:bg-action-default-hover"
          >
            <Icon name="external" size={14} className="text-action-brand" /> TCGplayer
          </a>
        )}
        <div className="min-w-[70px] text-right">
          {price && price.market != null ? (
            <div className="text-[16px] font-medium text-change-positive">{fmtPrice(price)}</div>
          ) : (
            <div className="text-[14px] text-text-muted">No price</div>
          )}
          {price?.pricedAt && (
            <div className="text-[10px] text-text-muted">as of {fmtRelative(price.pricedAt)}</div>
          )}
        </div>
        <QtyStepper v={v} color={color} quantity={v.quantity} onAdjust={onAdjust} pending={pending} />
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

export function CardDetail() {
  const { series, set, number } = useParams({ from: '/series/$series/$set/$number' })
  const cardId = `${set}-${number}`
  const [tab, setTab] = useState<(typeof TABS)[number]>('Card')
  const [showAdditional, setShowAdditional] = useState(false)
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['card', cardId],
    queryFn: ({ signal }) => api.card(cardId, signal),
  })

  // Own/un-own a variant. Optimistic: the stepper + the three progress bars move
  // instantly (optimisticApply), roll back on error, and reconcile against the
  // server's authoritative recompute on settle by invalidating both queries.
  const mutation = useMutation({
    mutationFn: ({ variantId, newQty }: { variantId: number; newQty: number }) =>
      api.setVariantQuantity(variantId, Math.max(0, newQty)),
    onMutate: async ({ variantId, newQty }) => {
      await qc.cancelQueries({ queryKey: ['card', cardId] })
      await qc.cancelQueries({ queryKey: ['set', set] })
      const undo = optimisticApply(qc, cardId, set, variantId, Math.max(0, newQty))
      return { undo }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.undo()
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['card', cardId] })
      void qc.invalidateQueries({ queryKey: ['set', set] })
    },
  })
  const onAdjust = (variantId: number, newQty: number) => mutation.mutate({ variantId, newQty })

  return (
    <Content cap={1165}>
      <div className="mb-[16px]">
        <BackPill to="/series/$series/$set" params={{ series, set }} label={data?.card.set.name ?? 'Set'} />
      </div>

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
                <SetSymbolTile url={data.card.set.setId ? null : null} size={28} />
                <Link
                  to="/series/$series/$set"
                  params={{ series, set }}
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
    </Content>
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
        <div className="mb-[8px] flex items-center px-[16px] text-[12px] text-text-muted">
          <span className="flex-1">Variant</span>
          <span className="pr-[100px]">Market Price</span>
          <span>Quantity</span>
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
                      {a.cost.split(',').map((_, i) => (
                        <span
                          key={i}
                          className="inline-block h-[16px] w-[16px] rounded-full bg-action-primary"
                        />
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
              <Chip key={t}>{t}</Chip>
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
                {w.type} {w.value}
              </Chip>
            ))}
          </Attribute>
        )}
        {c.retreat != null && (
          <Attribute label="Retreat Cost">
            <Chip>{c.retreat === 0 ? '—' : '★'.repeat(c.retreat)}</Chip>
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
