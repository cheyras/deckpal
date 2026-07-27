import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { CardRow } from '../lib/api'
import { Icon } from './Icon'

// Binder view (UI-SPEC §3.25, AUTH-CAPTURES §15.3). 9-pocket 3×3.
//
// mode='set'  — the signed-out set-page look: single page, PRO upsell, blank
//               inside cover, every pocket scrimmed with a "Slot #N" overlay.
// mode='list' — a real, paged binder for a list: every page of 9 across the whole
//               list, an owned card renders at full brightness (no scrim), an
//               unowned pocket keeps the dimmed "Slot #N" treatment. No PRO gate.

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
  // In list mode an owned/bright card with routing links to the card page.
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
  mode,
  alwaysBright,
}: {
  cards: (CardRow | undefined)[]
  startSlot: number
  mode: 'set' | 'list'
  alwaysBright: boolean
}) {
  return (
    <div className="rounded-2xl bg-surface-primary" style={{ padding: '18px 17px 18px 44px' }}>
      <div className="grid grid-cols-3 gap-x-[17px] gap-y-[22px]">
        {Array.from({ length: 9 }).map((_, i) => {
          const card = cards[i]
          const bright = mode === 'list' && !!card && (alwaysBright || !!card.ownership?.have)
          return <Pocket key={i} card={card} slot={startSlot + i} bright={bright} seriesSlug={card?.seriesSlug ?? undefined} setId={card?.setId ?? undefined} />
        })}
      </div>
    </div>
  )
}

// alwaysBright: a static list is not collection-tracked, so every present card
// renders bright (no owned/needed dimming) — only dynamic/binder lists dim unowned.
export function BinderView({ cards, mode = 'set', alwaysBright = false }: { cards: CardRow[]; mode?: 'set' | 'list'; alwaysBright?: boolean }) {
  const [stackVariants, setStackVariants] = useState(true)
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(cards.length / 9))
  const pageCards = useMemo(() => cards.slice(page * 9, page * 9 + 9), [cards, page])
  // Set mode preserves the original single-page-of-9 signed-out look.
  const rightCards = mode === 'set' ? cards.slice(0, 9) : pageCards
  const startSlot = mode === 'set' ? 1 : page * 9 + 1

  return (
    <div>
      {/* pocket-layout tabs (UI-SPEC §3.25) */}
      <div className="mb-[16px] flex items-center gap-[24px] border-b border-divider-subtle">
        {['9-Pocket', '12-Pocket', '4-Pocket', '16-Pocket'].map((p, i) => (
          <button
            key={p}
            className={`pb-[3px] text-[14px] ${
              i === 0
                ? 'border-b-2 border-action-primary font-[650] text-text-primary'
                : 'font-medium text-text-muted'
            }`}
          >
            {p}
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
            className="h-[36px] rounded-lg bg-surface-tertiary px-[12px] text-[13px] text-text-secondary"
          >
            <option>Hide</option>
          </select>
          <span className="mt-[2px] text-[11px] text-text-muted">Additional Variants</span>
        </div>
      </div>

      {/* Two-page spread ≥1068; single page below */}
      <div className="flex justify-center gap-[5px]">
        {/* left inside cover — blank, desktop only */}
        <div className="hidden flex-1 rounded-2xl bg-surface-primary nav:block" style={{ maxWidth: 493 }} />
        <div className="w-full flex-1" style={{ maxWidth: 493 }}>
          <Page cards={rightCards} startSlot={startSlot} mode={mode} alwaysBright={alwaysBright} />
          {/* pager */}
          <div className="mt-[16px] flex items-center justify-end gap-[16px]">
            <span className="text-[14px] font-bold text-text-muted">
              Page {mode === 'set' ? 1 : page + 1}
              {mode === 'list' ? ` / ${pageCount}` : ''}
            </span>
            {mode === 'list' && (
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex h-[50px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[15px] text-[14px] font-bold text-text-secondary hover:bg-action-default-hover disabled:opacity-40"
              >
                <Icon name="chevron-left" size={16} /> Prev
              </button>
            )}
            <button
              onClick={() => mode === 'list' && setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={mode === 'list' && page >= pageCount - 1}
              className="flex h-[50px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[15px] text-[14px] font-bold text-text-secondary hover:bg-action-default-hover disabled:opacity-40"
            >
              Next <Icon name="chevron-right" size={16} />
            </button>
          </div>
          {mode === 'set' && (
            <p className="mt-[8px] text-right text-[14px] font-[650] text-text-primary">
              Unlock Binder View with <span className="text-pro-accent">PRO</span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
