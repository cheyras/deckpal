import { useState } from 'react'
import type { CardRow } from '../lib/api'
import { Icon } from './Icon'

// Binder view (UI-SPEC §3.25, AUTH-CAPTURES §15.3). 9-pocket 3×3 two-page
// spread. Page 1's LEFT page is a blank inside cover; slots start on the right.
// Empty/not-owned pockets show the card art under an overlay-scrim-strong wash
// with a centred "Slot #N" label. Collection is empty in this MVP, so every
// pocket renders in its not-owned state — matching the signed-out reference.
// Page 2+ is Pro-gated on pkmn.gg; here Next is a stub.

function Pocket({ card, slot }: { card: CardRow | undefined; slot: number }) {
  return (
    <div className="relative" style={{ aspectRatio: '300 / 418' }}>
      {card ? (
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
      {/* not-owned scrim + Slot #N label */}
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
    </div>
  )
}

function Page({ cards, startSlot }: { cards: CardRow[]; startSlot: number }) {
  return (
    <div
      className="rounded-2xl bg-surface-primary"
      style={{ padding: '18px 17px 18px 44px' }}
    >
      <div className="grid grid-cols-3 gap-x-[17px] gap-y-[22px]">
        {Array.from({ length: 9 }).map((_, i) => (
          <Pocket key={i} card={cards[i]} slot={startSlot + i} />
        ))}
      </div>
    </div>
  )
}

export function BinderView({ cards }: { cards: CardRow[] }) {
  const [stackVariants, setStackVariants] = useState(true)
  // Page 1: left = inside cover (blank), right = slots 1–9.
  const rightCards = cards.slice(0, 9)

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
        <div
          className="hidden flex-1 rounded-2xl bg-surface-primary nav:block"
          style={{ maxWidth: 493 }}
        />
        <div className="w-full flex-1" style={{ maxWidth: 493 }}>
          <Page cards={rightCards} startSlot={1} />
          {/* pager */}
          <div className="mt-[16px] flex items-center justify-end gap-[16px]">
            <span className="text-[14px] font-bold text-text-muted">Page 1</span>
            <button className="flex h-[50px] items-center gap-[8px] rounded-lg bg-surface-tertiary px-[15px] text-[14px] font-bold text-text-secondary hover:bg-action-default-hover">
              Next <Icon name="chevron-right" size={16} />
            </button>
          </div>
          <p className="mt-[8px] text-right text-[14px] font-[650] text-text-primary">
            Unlock Binder View with <span className="text-pro-accent">PRO</span>
          </p>
        </div>
      </div>
    </div>
  )
}
