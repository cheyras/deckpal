import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { api, type CardDetailResponse, type Progress, type SetDetailResponse, type ValueRange, type Variant } from '../lib/api'
import { Content, Spinner, ErrorState, BackPill, SetSymbolTile, Tabs } from '../components/ui'
import { CardImage } from '../components/CardImage'
import { Icon } from '../components/Icon'
import { EnergyIcon } from '../components/EnergyIcon'
import { fmtPrice, fmtDate, fmtNumber, fmtRelative } from '../lib/format'
import { useOnline } from '../lib/useOnline'
import { CARD_SEARCH_DEFAULTS } from './setSearch'
import { variantMeta } from '../lib/variantStyle'
import { ValueChart } from '../components/ValueChart'
import { Sheet, useSheetClose } from '../components/ui/Sheet'
import { useLateEntrance } from '../lib/lateEntrance'

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
  // Quantities are absent on an anonymous read, but this whole optimistic path
  // only runs behind a stepper, and steppers only render when signed in.
  const before = prevCard.variants.map<OwnBits>((v) => ({ tier: v.tier, isPrimary: v.isPrimary, quantity: v.quantity ?? 0 }))
  const changed = prevCard.variants.find((v) => v.variantId === variantId)
  const oldQty = changed?.quantity ?? 0
  const clampedNew = Math.max(0, newQty)
  const after = prevCard.variants.map<OwnBits>((v) => ({
    tier: v.tier,
    isPrimary: v.isPrimary,
    quantity: v.variantId === variantId ? clampedNew : v.quantity ?? 0,
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
    // Both are absent on an anonymous read of the set page; there is then no
    // cached progress to shift and no ownership to re-derive.
    const p = old.progress
    if (!p) return old
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
      if (c.cardId !== cardId || !c.ownership) return c
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
  fill,
  quantity,
  onAdjust,
  pending,
}: {
  v: Variant
  /** Solid accent — the idle "+" glyph colour. */
  color: string
  /** Gradient for the owned/filled state. */
  fill: string
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
        style={{
          background: owned ? fill : 'var(--color-surface-tertiary)',
          // The variant fills are all light now (white, cyan-400, rose-400), so a
          // white glyph on them measures as low as 1.8:1. Dark on the fill is ~10:1.
          color: owned ? 'var(--color-surface-primary)' : color,
        }}
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
// The fixed tracks shrink below the `gap` breakpoint (567px). At 320px the
// 84px+108px pair plus gaps left the minmax(0,1fr) variant track just 20px
// wide, so "Found in Booster Packs" wrapped down 9 lines, two characters at a
// time. Narrower price/qty tracks there give the name column ~84px, which
// wraps on word boundaries like prose instead of shattering.
const VARIANT_GRID =
  'grid grid-cols-[minmax(0,1fr)_64px_92px] gap-x-[8px] gap:grid-cols-[minmax(0,1fr)_84px_108px] gap:gap-x-[12px] nav:gap-x-[16px]'

function VariantRow({
  v,
  onAdjust,
  pending,
}: {
  v: Variant
  onAdjust: (variantId: number, newQty: number) => void
  pending: boolean
}) {
  const meta = variantMeta(v)
  const price = v.prices.find((p) => p.currency === 'USD') ?? v.prices[0] ?? null
  return (
    <div
      className="rounded-lg bg-surface-tertiary p-[16px]"
      data-owned={(v.quantity ?? 0) > 0 ? 'true' : 'false'}
      // The variant id is a database key, so it is unique on the page and is
      // not text anybody upstream can choose — which is the whole test a
      // landmark selector has to pass. The variant's DISPLAY NAME goes in the
      // label, where being prose is the point.
      //
      // The stepper inside this row is a WRITE control. Marking the row lets
      // Deck-E point at it and say "this is the reverse holo you own two of";
      // it does not and must not let him press anything (SPEC §9.2).
      data-decke-variant={v.variantId}
      data-decke-landmark={`[data-decke-variant="${v.variantId}"]`}
      data-decke-label={`the ${v.displayName} variant row`}
    >
      <div className={`${VARIANT_GRID} items-center`}>
        {/* Variant column */}
        <div className="flex min-w-0 items-start gap-[8px]">
          <span
            className="mt-[5px] inline-block h-[12px] w-[12px] shrink-0 rounded-[3px]"
            style={{ background: meta.fill }}
          />
          <div className="min-w-0">
            <div className="break-words text-[14px] font-bold text-text-primary">{v.displayName}</div>
            {v.provenance && <div className="break-words text-[14px] text-text-muted">{v.provenance}</div>}
            {/* "TCGplayer" is a single unbreakable word, so `truncate` here could
                only ever clip it to "TCGpl…" — which it did at 390px, where the
                variant column squeezes this to 54px against a 62px label. A short
                button label has no useful truncated form, so it keeps its ~98px
                intrinsic width instead of shrinking. */}
            {v.buyUrl && (
              <a
                href={v.buyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-[8px] inline-flex h-[30px] w-fit shrink-0 items-center gap-[6px] whitespace-nowrap rounded-lg bg-surface-secondary px-[8px] text-[14px] font-bold text-text-primary hover:bg-action-default-hover"
              >
                <Icon name="external" size={14} className="shrink-0 text-action-brand" />
                <span>TCGplayer</span>
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
            <div className="text-[14px] leading-[14px] text-text-muted">as of {fmtRelative(price.pricedAt)}</div>
          )}
        </div>

        {/* Quantity column. Logged out there is no quantity and nothing to
            adjust, so the stepper is replaced by the reason it is missing. */}
        <div className="flex justify-end">
          {v.quantity === undefined ? (
            <Link
              to="/auth"
              search={{ mode: 'signup' } as never}
              className="flex h-[34px] items-center whitespace-nowrap rounded-lg border border-border-default px-[12px] text-[14px] font-semibold text-text-body hover:border-surface-quaternary hover:text-text-primary"
            >
              Sign in to track
            </Link>
          ) : (
            <QtyStepper v={v} color={meta.color} fill={meta.fill} quantity={v.quantity} onAdjust={onAdjust} pending={pending} />
          )}
        </div>
      </div>
    </div>
  )
}

function Attribute({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[6px] text-[14px] text-text-muted">{label}</div>
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

const TABS = [
  { key: 'Card', label: 'Card' },
  { key: 'Price', label: 'Price' },
  { key: 'TCG', label: 'TCG' },
] as const

// The deck-scoped view is a TAB to the LEFT of Card, not a panel stacked above
// the card body. As a panel it repeated the card art and the name/set line that
// the body already shows a few hundred pixels below — the same card twice, once
// small and once large.
const DECK_TAB = { key: 'In this deck', label: 'In this deck' } as const

const PRICE_RANGES: { key: ValueRange; label: string }[] = [
  { key: '30d', label: '30D' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: '18m', label: '18M' },
  { key: '2y', label: '2Y' },
]

/**
 * Observed market price over time, one line per PRINTING.
 *
 * Per printing, not per card, because "what is this worth" has a different
 * answer for the Normal and the Reverse Holofoil — collapsing them into one
 * line is the same conflation the `+N Variants` badge was making elsewhere.
 *
 * This tab read "Price history — coming soon" from the day it shipped while
 * `price_observation` accumulated the data the whole time; what was missing was
 * a reader, and (until 2026-08-29) a scheduled job to keep filling it.
 */
function PriceTab({ cardId }: { cardId: string }) {
  const [range, setRange] = useState<ValueRange>('3m')
  const { data, isLoading, error } = useQuery({
    queryKey: ['card-prices', cardId, range],
    queryFn: ({ signal }) => api.cardPriceHistory(cardId, range, 'USD', signal),
  })

  const series = (data?.series ?? [])
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      label: s.displayName,
      color: variantMeta({ kind: s.kind, tier: s.tier }).color,
      points: s.points,
    }))
  const total = series.reduce((n, s) => n + s.points.length, 0)

  return (
    <div className="mt-[16px]">
      <div className="flex flex-wrap gap-[6px]">
        {PRICE_RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={[
              'h-[28px] rounded-full px-[12px] text-[14px] font-semibold',
              range === r.key
                ? 'bg-action-primary text-action-primary-text'
                : 'bg-surface-tertiary text-text-body hover:bg-action-default-hover',
            ].join(' ')}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="mt-[14px]">
        {isLoading && !data ? (
          <Spinner label="Loading prices…" />
        ) : error ? (
          <ErrorState message={(error as Error).message} />
        ) : total >= 2 ? (
          <>
            <ValueChart series={series} currency={data!.currency} height={200} />
            {/* One legend entry per printing. With a single printing the line
                needs no label — the card above it is the label. */}
            {series.length > 1 && (
              <div className="mt-[10px] flex flex-wrap gap-x-[14px] gap-y-[4px]">
                {series.map((s) => (
                  <span key={s.label} className="flex items-center gap-[6px] text-[14px] text-text-muted">
                    <span className="inline-block h-[8px] w-[8px] rounded-sm" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          // Honest about WHICH kind of nothing this is: a card nobody has ever
          // priced looks identical to a feed that has stopped, and the second is
          // a bug worth reporting while the first is not.
          <p className="py-[40px] text-center text-[14px] text-text-muted">
            {total === 1
              ? 'Only one price reading so far — a trend needs a second day.'
              : 'No recorded price history for this card in this window.'}
          </p>
        )}
      </div>
    </div>
  )
}

const FORMAT_LABEL: Record<string, string> = {
  standard: 'Standard',
  expanded: 'Expanded',
  glc: 'Gym Leader Challenge',
  unlimited: 'Unlimited',
}

/**
 * Format legality for one card.
 *
 * Fetched lazily — this is a tab, and the endpoint costs a catalogue round trip
 * for the reprint oracle that the other two tabs have no use for.
 *
 * The verified-on date is not decoration. The rules behind this are vendored
 * JSON with an `as_of` stamp (`apps/api/src/deck/data/_provenance.json`), and
 * rotation moves them roughly every April. A legality answer that does not say
 * how old its rulebook is invites being trusted past its expiry, which is the
 * exact failure the vendoring decision was made to avoid.
 */
function TcgTab({ cardId }: { cardId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['card-legality', cardId],
    queryFn: ({ signal }) => api.cardLegality(cardId, signal),
  })

  if (isLoading) return <Spinner label="Checking formats…" />
  if (error) return <ErrorState message={(error as Error).message} />
  if (!data) return null

  return (
    <div className="mt-[16px]">
      <ul className="flex flex-col gap-[8px]">
        {data.formats.map((f) => (
          <li
            key={f.format}
            className="flex flex-wrap items-center justify-between gap-[8px] rounded-lg bg-surface-secondary px-[14px] py-[10px]"
          >
            <span className="text-[15px] font-semibold text-text-primary">
              {FORMAT_LABEL[f.format] ?? f.format}
            </span>
            {f.legal ? (
              <span className="flex items-center gap-[6px] text-[14px] font-bold text-change-positive">
                <Icon name="check" size={14} /> Legal
              </span>
            ) : (
              <span className="text-[14px] font-bold text-text-muted">Not legal</span>
            )}
            {/* The reason sits on its own line so a long ban citation does not
                squeeze the verdict off the row at 390px. */}
            {f.reasons.length > 0 && (
              <p className="w-full text-[14px] leading-[20px] text-text-muted">{f.reasons.join(' ')}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-[12px] text-[14px] text-text-muted">
        Format rules verified {data.checkedAt.slice(0, 10)}.
      </p>
    </div>
  )
}


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
function CardDetailBody({
  cardId,
  inSheet = false,
  backTo,
  deckSlot,
}: {
  cardId: string
  inSheet?: boolean
  // Optional immediate BackPill target for the standalone route, used only until
  // the card fetch resolves the authoritative series/set. Never passed in-sheet.
  backTo?: { series: string; set: string }
  // Deck-scoped content for this card, supplied by the deck builder. When
  // present it becomes the leading tab and the tab strip opens on it — the deck
  // is why you opened the card from a deck list.
  deckSlot?: ReactNode
}) {
  const tabs = deckSlot ? [DECK_TAB, ...TABS] : TABS
  const [tab, setTab] = useState(deckSlot ? DECK_TAB.key : 'Card')
  const [showAdditional, setShowAdditional] = useState(false)
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['card', cardId],
    queryFn: ({ signal }) => api.card(cardId, signal),
  })
  // Issue #49: the wrapper entrance fires while this is still a spinner.
  const enter = useLateEntrance(isLoading)

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
      {error && <ErrorState message={(error as Error).message} className={enter} />}

      {data && (
        <div className={`relative ${enter}`}>
          {/* blurred hero art behind everything */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-(--z-art) h-[400px]"
            style={{
              background: `linear-gradient(to bottom, var(--color-banner-gradient-top) 40%, var(--color-surface-primary)), url(${data.card.images.high}) center top/cover`,
              filter: 'blur(24px)',
              opacity: 0.5,
            }}
          />
          <div className="flex flex-col gap-[32px] nav:flex-row">
            {/* Hero image. On the two-column (desktop) layout it sticks to the
                top while the detail column scrolls — `self-start` is required or
                the flex row stretches the item and sticky has no slack to move
                in. True of every modal built on this body, not just the deck's. */}
            <div
              className="mx-auto w-full max-w-[396px] shrink-0 nav:mx-0 nav:sticky nav:top-0 nav:self-start"
              data-decke-card-image
              data-decke-landmark="[data-decke-card-image]"
              data-decke-label="the card image"
            >
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
              <Tabs items={tabs} value={tab} onChange={setTab} className="mt-[20px]" />

              {tab === DECK_TAB.key && deckSlot}
              {tab === 'Card' && (
                <CardTab
                  data={data}
                  showAdditional={showAdditional}
                  setShowAdditional={setShowAdditional}
                  onAdjust={onAdjust}
                  pending={mutation.isPending}
                />
              )}
              {tab === 'Price' && <PriceTab cardId={cardId} />}
              {tab === 'TCG' && <TcgTab cardId={cardId} />}
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
  contextSlot,
  ariaLabel = 'Card details',
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
  // Optional caller-supplied panel rendered above the shared card body, so a
  // surface can frame the card in its own terms (the deck builder shows copies,
  // shortfall and deck cost) without forking the sheet.
  contextSlot?: ReactNode
  ariaLabel?: string
}) {
  // Positioning, scroll-lock, focus, Escape and both animations all live in
  // Sheet now. This component keeps only its own header (a grab handle plus a
  // floating close button, which the shared header does not draw) and the body.
  return (
    <Sheet
      title="Card details"
      ariaLabel={ariaLabel}
      onClose={onClose}
      size="full"
      headerSlot={<CardSheetHeader />}
      contentClassName="!px-[16px] !pt-[4px] nav:!px-[24px]"
    >
      <CardDetailBody cardId={cardId ?? `${set}-${number}`} inSheet deckSlot={contextSlot} />
    </Sheet>
  )
}

// Split out so it can call useSheetClose(), which only exists under a <Sheet>.
// The card art is the heading here, so this row carries no title — just the
// grab handle and a close button. Laid out with a matching-width spacer rather
// than absolute positioning, so the handle stays optically centred without
// depending on which skin's CSS happens to win on `position`.
function CardSheetHeader() {
  const close = useSheetClose()
  return (
    <div className="flex h-[44px] shrink-0 items-center justify-between px-[10px]">
      <span aria-hidden className="h-[40px] w-[40px]" />
      <span className="h-[4px] w-[40px] rounded-full bg-surface-tertiary nav:hidden" />
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-surface-tertiary text-icon-default hover:bg-action-default-hover"
      >
        <Icon name="close" size={22} />
      </button>
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
      <div
        className="mt-[16px]"
        data-decke-variant-table
        data-decke-landmark="[data-decke-variant-table]"
        data-decke-label="the variant rows"
        data-decke-rank="container"
      >
        <div className={`${VARIANT_GRID} mb-[8px] items-center px-[16px] text-[14px] text-text-muted`}>
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
              // PRESSABLE, and reviewed as such: the handler toggles one piece
              // of local state and does nothing else. The variant ROWS this
              // reveals contain quantity steppers, which are writes and are
              // deliberately not marked — revealing a control is not the same
              // capability as operating it.
              data-decke-additional-variants
              data-decke-landmark="[data-decke-additional-variants]"
              data-decke-label="the Additional Variants disclosure"
              data-decke-clickable
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

      {/* buy + freshness — the page's price block, and the one thing on it a
          reader asks about by name ("is this one worth anything"). Wrapped so
          there is something to point AT: the market figures themselves are one
          column of the variant grid above and have no element of their own, so
          without this Deck-E could only ever ring a whole row. */}
      <div
        data-decke-price-block
        data-decke-landmark="[data-decke-price-block]"
        data-decke-label="the price and buying block"
        data-decke-rank="container"
      >
        {buyUrl && (
          <a
            href={buyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-[16px] inline-flex h-[40px] items-center gap-[8px] rounded-lg bg-action-brand px-[16px] text-[14px] font-bold text-action-brand-text hover:opacity-90"
          >
            <Icon name="external" size={16} /> Buy on TCGplayer
          </a>
        )}
        <p className="mt-[10px] text-[14px] text-text-muted">
          Prices reflect the latest daily sync. Self-hosted feed — no affiliate relationship.
        </p>
      </div>

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
                  <span className="font-display text-[16px] font-semibold text-text-primary">{a.name}</span>
                </div>
                {a.damage && (
                  <span className="text-[16px] font-bold text-text-primary">
                    <span className="mr-[8px] text-[14px] font-normal text-text-muted">Damage</span>
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
