// One verify-feed row — card image, name, setName · number, variant chip,
// confidence meter, quantity stepper, "wrong card? / pick a match" popover,
// and a small report affordance. Ported from prototype.html's
// `buildFeedEntry` + `openAlternates`.
import { useEffect, useRef, useState } from 'react'
import { CardImage } from '../../components/CardImage'
import { VariantChip } from '../../components/VariantChip'
import { RarityMark } from '../../components/RarityMark'
import { Icon } from '../../components/Icon'
import { ProgressBar } from '../../components/ui'
import { fmtNumber } from '../../lib/format'
import type { ScanMatch } from '../../lib/api'
import { bump, DURATION, revealEntry, staggerReveal } from './motion'
import type { FeedEntry } from './types'
import { AlternatesPopover } from './AlternatesPopover'

export function FeedEntryCard({
  entry,
  onQuantityChange,
  onVariantChange,
  onCorrect,
  onRemove,
  onReport,
  onOpenDetail,
  registerThumbNode,
}: {
  entry: FeedEntry
  onQuantityChange: (id: string, quantity: number) => void
  /** The reader says which PRINTING (same card, different variant) — not to
   *  be confused with `onCorrect`, which replaces the card identity itself. */
  onVariantChange: (id: string, variantId: number) => void
  onCorrect: (id: string, match: ScanMatch) => void
  /** Drop the row outright. The quantity stepper reaching 0 does this too for
   *  a matched row, but an unmatched "needs attention" row has no stepper —
   *  and, if `/scan` returned zero guesses, no "pick a match" popover either
   *  — so without an explicit remove it could be un-clearable. */
  onRemove: (id: string) => void
  onReport: (entry: FeedEntry) => Promise<void>
  onOpenDetail: (cardId: string) => void
  registerThumbNode: (id: string, el: HTMLDivElement | null) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const mountedTick = useRef(entry.mergeTick)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  // The entry's own open reveal — a stable `key={entry.id}` (see VerifyFeed)
  // means this component instance mounts exactly once, when the row is new;
  // an existing row that re-renders (quantity change, variant pick, …) never
  // remounts, so this never replays for it. That is the whole reason no
  // separate "isNew" prop is threaded down from Scan.tsx.
  useEffect(() => {
    if (rootRef.current) {
      void revealEntry(rootRef.current)
      staggerReveal(rootRef.current, '.fe-name,.fe-set,.fe-chips,.fe-conf,.fe-row')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Duplicate-merge bump — fires only when `mergeTick` actually advances (a
  // re-presentation landed here), never for the reader's own +/- taps.
  useEffect(() => {
    if (entry.mergeTick === mountedTick.current) return
    mountedTick.current = entry.mergeTick
    if (rootRef.current) void bump(rootRef.current, 1.05, DURATION.dupBump)
    if (countRef.current) void bump(countRef.current, 1.3, DURATION.dupBump)
  }, [entry.mergeTick])

  const pct = Math.round(entry.confidence * 100)
  const hasVariantChoice = entry.variants.length > 1
  const selectedVariant = entry.variants.find((v) => v.variantId === entry.variantId)

  const report = async () => {
    setReportState('sending')
    try {
      await onReport(entry)
      setReportState('sent')
    } catch {
      setReportState('error')
    }
  }

  return (
    <div
      ref={rootRef}
      data-entry-state={entry.matched ? 'identified' : 'needs-attention'}
      data-verified={entry.verified || undefined}
      className={`relative flex gap-[10px] rounded-xl border p-[10px] ${
        entry.verified
          ? 'border-change-positive/50 bg-surface-secondary'
          : entry.matched
            ? 'border-border-default bg-surface-secondary'
            : 'border-warning/50 bg-surface-secondary'
      }`}
    >
      <button
        type="button"
        aria-label={`Remove ${entry.matched ? entry.name : 'this capture'}`}
        onClick={() => onRemove(entry.id)}
        className="absolute right-[6px] top-[6px] z-[1] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-black/35 text-white/70 hover:bg-black/55 hover:text-white"
      >
        <Icon name="close" size={12} />
      </button>

      <div
        ref={(el) => registerThumbNode(entry.id, el)}
        className="relative w-[60px] shrink-0 cursor-pointer overflow-hidden rounded-md shadow-panel"
        onClick={() => entry.cardId && onOpenDetail(entry.cardId)}
      >
        {entry.matched && entry.images ? (
          <CardImage low={entry.images.low} high={entry.images.high} alt={entry.name} radius={6} />
        ) : (
          <img
            src={entry.capturePreviewUrl}
            alt="Captured card, not yet identified"
            className="block w-full"
            style={{ aspectRatio: '63 / 88', objectFit: 'cover' }}
          />
        )}
        {entry.verified && (
          <span
            className="absolute bottom-[3px] right-[3px] flex h-[16px] w-[16px] items-center justify-center rounded-full bg-change-positive text-surface-primary shadow-panel"
            title="Confirmed in swipe review"
          >
            <Icon name="check" size={10} strokeWidth={3} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="fe-name truncate font-display text-[15px] font-semibold leading-[19px] text-text-primary">
          {entry.matched ? entry.name : 'Needs attention'}
        </div>
        <div className="fe-set flex items-center gap-[6px] text-[12px] text-text-muted">
          {entry.matched ? (
            <>
              <span className="truncate">
                {entry.setName} · {fmtNumber(entry.number)}
              </span>
              {entry.rarity && (
                <span className="inline-flex shrink-0 items-center gap-[4px] text-text-secondary">
                  <RarityMark rarity={entry.rarity} decorative /> {entry.rarity}
                </span>
              )}
            </>
          ) : (
            <span>No confident match — pick one below</span>
          )}
        </div>

        {/* WHICH PRINTING — shown only when there is a real choice (same
            reasoning the old rip-mode list carried: a select with one option
            is furniture that teaches the reader to stop reading the row). */}
        {entry.matched && hasVariantChoice && (
          <div className="fe-chips mt-[3px]">
            <select
              value={entry.variantId ?? ''}
              aria-label={`Printing of ${entry.name}`}
              onChange={(ev) => onVariantChange(entry.id, Number(ev.target.value))}
              className="h-[26px] rounded-full border border-border-default bg-surface-primary px-[8px] text-[12px] text-text-body"
            >
              {entry.variants.map((v) => (
                <option key={v.variantId} value={v.variantId}>
                  {v.displayName}
                </option>
              ))}
            </select>
          </div>
        )}
        {entry.matched && !hasVariantChoice && selectedVariant && (
          <div className="fe-chips mt-[3px]">
            <VariantChip
              variant={{
                kind: selectedVariant.kind,
                displayName: selectedVariant.displayName,
                tier: selectedVariant.tier,
                isPrimary: selectedVariant.isPrimary,
              }}
            />
          </div>
        )}

        {entry.matched && (
          <div className="fe-conf mt-[4px]">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted">Match</span>
              <span className="font-extrabold text-text-primary">
                {pct}% <span className="font-normal text-text-muted">· dist {entry.distance}</span>
              </span>
            </div>
            <ProgressBar pct={pct} height={5} fill={pct >= 95 ? 'var(--color-change-positive)' : 'var(--color-action-brand)'} />
          </div>
        )}

        <div className="fe-row mt-[6px] flex items-center justify-between gap-[8px]">
          <div className="flex items-center gap-[10px]">
            {entry.alternates.length > 0 && (
              <button
                type="button"
                onClick={() => setPopoverOpen((o) => !o)}
                className="text-[12px] font-semibold text-link underline decoration-1 underline-offset-2 hover:text-link-hover"
              >
                {entry.matched ? 'wrong card?' : 'pick a match'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void report()}
              disabled={reportState === 'sending' || reportState === 'sent'}
              title="Flag this capture for review"
              className="flex items-center gap-[3px] text-[11px] text-text-muted hover:text-text-secondary disabled:opacity-70"
            >
              <Icon name="bug" size={12} />
              {reportState === 'sent' ? 'reported' : reportState === 'sending' ? 'sending…' : reportState === 'error' ? 'retry' : 'report'}
            </button>
          </div>
          {entry.matched && (
            <div className="inline-flex h-[28px] items-center overflow-hidden rounded-full border border-border-default bg-surface-primary">
              <button
                type="button"
                aria-label={`One fewer ${entry.name}`}
                onClick={() => onQuantityChange(entry.id, entry.quantity - 1)}
                className="grid h-[26px] w-[28px] place-items-center text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
              >
                −
              </button>
              <span ref={countRef} className="min-w-[26px] text-center text-[14px] font-bold tabular-nums text-text-primary">
                {entry.quantity}
              </span>
              <button
                type="button"
                aria-label={`One more ${entry.name}`}
                onClick={() => onQuantityChange(entry.id, entry.quantity + 1)}
                className="grid h-[26px] w-[28px] place-items-center text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
              >
                +
              </button>
            </div>
          )}
        </div>
      </div>

      {popoverOpen && (
        <AlternatesPopover
          matches={entry.alternates}
          currentCardId={entry.cardId}
          onPick={(m) => {
            onCorrect(entry.id, m)
            setPopoverOpen(false)
          }}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </div>
  )
}
