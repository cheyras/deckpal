import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { CardRow } from '../lib/api'
import { Icon } from './Icon'

// Binder view (UI-SPEC §3.25, pkmn.gg captures §15.3).
//
// A real, paged binder. Pockets are laid out per the selected layout tab
// (9 / 12 / 4 / 16 per page). An owned card renders at full brightness; an
// unowned pocket keeps the dimmed "Slot #N" treatment so it reads as a "need".
//
// This is a single-user, self-hosted app: there is no paid tier and no PRO
// gate — every mode gets the same fully-functional binder.
//
// mode is retained only so `alwaysBright` (static lists, which aren't
// collection-tracked) can force every present card bright; otherwise ownership
// drives per-pocket brightness in every mode.

// Pocket layouts. `cols` drives the CSS grid; `perPage = cols * rows`.
const LAYOUTS = [
  { label: '9-Pocket', cols: 3, rows: 3 },
  { label: '12-Pocket', cols: 4, rows: 3 },
  { label: '4-Pocket', cols: 2, rows: 2 },
  { label: '16-Pocket', cols: 4, rows: 4 },
] as const

function Pocket({
  card,
  slot,
  bright,
  seriesSlug,
  setId,
}: {
  card: CardRow | undefined
  slot: number
  bright: boolean
  seriesSlug?: string
  setId?: string
}) {
  const inner = (
    <div className="relative h-full w-full" style={{ aspectRatio: '300 / 418' }}>
      {card && card.images.low ? (
        <img
          src={card.images.low}
          srcSet={`${card.images.low} 245w, ${card.images.high} 600w`}
          sizes="140px"
          alt={`Slot ${slot}: ${card.name}`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full rounded-[6px] object-cover"
        />
      ) : (
        <div className="absolute inset-0 rounded-[6px] bg-surface-tertiary" />
      )}
      {!bright && (
        <>
          <div
            className="absolute inset-0 rounded-[6px]"
            style={{ background: 'var(--color-overlay-scrim-strong)', zIndex: 1 }}
          />
          <div
            className="absolute inset-0 flex flex-col items-center justify-center leading-none"
            style={{ zIndex: 2 }}
          >
            <span className="text-[15px] font-medium text-text-secondary">Slot</span>
            <span className="text-[26px] font-bold text-text-primary">#{slot}</span>
          </div>
        </>
      )}
    </div>
  )
  // An owned/bright card links through to its card page when we have routing keys.
  if (bright && card && seriesSlug && setId && card.number) {
    return (
      <Link
        to="/series/$series/$set/$number"
        params={{ series: card.seriesSlug ?? seriesSlug, set: card.setId ?? setId, number: card.number }}
        className="relative block"
        style={{ aspectRatio: '300 / 418' }}
      >
        {inner}
      </Link>
    )
  }
  return (
    <div className="relative" style={{ aspectRatio: '300 / 418' }}>
      {inner}
    </div>
  )
}

function Page({
  cards,
  startSlot,
  cols,
  perPage,
  alwaysBright,
}: {
  cards: (CardRow | undefined)[]
  startSlot: number
  cols: number
  perPage: number
  alwaysBright: boolean
}) {
  return (
    <div className="rounded-2xl bg-surface-primary" style={{ padding: '18px 17px 18px 44px' }}>
      <div
        className="grid gap-x-[17px] gap-y-[22px]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: perPage }).map((_, i) => {
          const card = cards[i]
          const bright = !!card && (alwaysBright || !!card.ownership?.have)
          return (
            <Pocket
              key={i}
              card={card}
              slot={startSlot + i}
              bright={bright}
              seriesSlug={card?.seriesSlug ?? undefined}
              setId={card?.setId ?? undefined}
            />
          )
        })}
      </div>
    </div>
  )
}

// alwaysBright: a static list is not collection-tracked, so every present card
// renders bright (no owned/needed dimming) — only dynamic/binder lists and set
// pages dim unowned pockets.
export function BinderView({
  cards,
  mode = 'set',
  alwaysBright = false,
}: {
  cards: CardRow[]
  mode?: 'set' | 'list'
  alwaysBright?: boolean
}) {
  void mode // retained for call-site compatibility; behavior is now uniform
  const [stackVariants, setStackVariants] = useState(true)
  const [layoutIdx, setLayoutIdx] = useState(0)
  const [page, setPage] = useState(0)

  const layout = LAYOUTS[layoutIdx]
  const perPage = layout.cols * layout.rows
  const pageCount = Math.max(1, Math.ceil(cards.length / perPage))
  // Clamp the page when a layout change shrinks the number of pages.
  const safePage = Math.min(page, pageCount - 1)
  const pageCards = useMemo(
    () => cards.slice(safePage * perPage, safePage * perPage + perPage),
    [cards, safePage, perPage],
  )
  const startSlot = safePage * perPage + 1

  return (
    <div>
      {/* pocket-layout tabs (UI-SPEC §3.25) */}
      <div className="mb-[16px] flex items-center gap-[24px] border-b border-divider-subtle">
        {LAYOUTS.map((l, i) => (
          <button
            key={l.label}
            onClick={() => {
              setLayoutIdx(i)
              setPage(0)
            }}
            aria-pressed={i === layoutIdx}
            className={`pb-[3px] text-[14px] ${
              i === layoutIdx
                ? 'border-b-2 border-action-primary font-[650] text-text-primary'
                : 'font-medium text-text-muted'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* Stack Variants + Additional Variants controls */}
      <div className="mb-[16px] flex flex-wrap items-center gap-[24px]">
        <label className="flex items-center gap-[10px] text-[14px] font-semibold text-text-primary">
          Stack Variants:
          <button
            onClick={() => setStackVariants((v) => !v)}
            className="relative h-[22px] w-[38px] rounded-full transition-colors"
            style={{ background: stackVariants ? 'var(--color-completion-grandmaster)' : 'var(--color-surface-quaternary)' }}
            aria-pressed={stackVariants}
          >
            <span
              className="absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white transition-all"
              style={{ left: stackVariants ? 19 : 3 }}
            />
          </button>
        </label>
        <div className="flex flex-col">
          <select
            disabled
            className="h-[36px] rounded-lg bg-surface-tertiary px-[12px] text-[14px] text-text-secondary"
          >
            <option>Hide</option>
          </select>
          <span className="mt-[2px] text-[14px] text-text-muted">Additional Variants</span>
        </div>
      </div>

      {/* Two-page spread ≥1068; single page below */}
      <div className="flex justify-center gap-[5px]">
        {/* left inside cover — blank, desktop only */}
        <div className="hidden flex-1 rounded-2xl bg-surface-primary nav:block" style={{ maxWidth: 493 }} />
        <div className="w-full flex-1" style={{ maxWidth: 493 }}>
          <Page
            cards={pageCards}
            startSlot={startSlot}
            cols={layout.cols}
            perPage={perPage}
            alwaysBright={alwaysBright}
          />
          {/* pager */}
          <div className="mt-[16px] flex items-center justify-end gap-[16px]">
            <span className="text-[14px] font-bold text-text-muted">
              Page {safePage + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage(() => Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="flex h-[50px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[15px] text-[14px] font-bold text-text-secondary hover:bg-action-default-hover disabled:opacity-40"
            >
              <Icon name="chevron-left" size={16} /> Prev
            </button>
            <button
              onClick={() => setPage(() => Math.min(pageCount - 1, safePage + 1))}
              disabled={safePage >= pageCount - 1}
              className="flex h-[50px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[15px] text-[14px] font-bold text-text-secondary hover:bg-action-default-hover disabled:opacity-40"
            >
              Next <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
