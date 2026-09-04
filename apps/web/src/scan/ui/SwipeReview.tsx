// Card-by-card review — Tinder-like, per the owner's direction: one entry at
// a time, swipe right to confirm, swipe left to correct (never a silent
// delete). Pointer events drive a real drag with rotation and a WAAPI
// spring-back/fling-out (motion.ts); `prefers-reduced-motion` swaps the drag
// for two plain buttons; desktop gets ArrowLeft/ArrowRight. The stack always
// reviews `queue[0]` — the first entry not yet `verified` — so there is no
// separate index to keep in sync with corrections/removals happening
// elsewhere in the feed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CardImage } from '../../components/CardImage'
import { VariantChip } from '../../components/VariantChip'
import { RarityMark } from '../../components/RarityMark'
import { Icon } from '../../components/Icon'
import { fmtNumber } from '../../lib/format'
import type { ScanMatch } from '../../lib/api'
import { flingOut, prefersReducedMotion, springBack } from './motion'
import type { FeedEntry } from './types'

const SWIPE_THRESHOLD = 110

export function SwipeReview({
  entries,
  onQuantityChange,
  onVariantChange,
  onConfirm,
  onCorrect,
  onSkip,
  onOpenDetail,
}: {
  /** The WHOLE feed, in list order — used for the "3 of 12" progress readout,
   *  not just the unreviewed remainder. */
  entries: FeedEntry[]
  onQuantityChange: (id: string, quantity: number) => void
  onVariantChange: (id: string, variantId: number) => void
  /** Swipe right / press → or the confirm button: mark this row verified. */
  onConfirm: (id: string) => void
  /** A correction was picked from the reject flow: apply it AND mark verified
   *  (the reader just explicitly resolved it). */
  onCorrect: (id: string, match: ScanMatch) => void
  /** "Needs attention, move on" from the reject flow — leaves the row exactly
   *  as it was (never verified), just advances the queue. */
  onSkip: (id: string) => void
  onOpenDetail: (cardId: string) => void
}) {
  const total = entries.length
  const verifiedCount = entries.filter((e) => e.verified).length
  // "None of these — leave it flagged" (CorrectionPanel) must ADVANCE past a
  // card without marking it verified — it is still genuinely unresolved. A
  // queue derived purely from `!verified` would keep re-surfacing that same
  // card forever, so deferrals are tracked locally (this component's own
  // session, not the shared `FeedEntry` — a fresh swipe-review pass is
  // supposed to offer a deferred card again).
  const [deferredIds, setDeferredIds] = useState<Set<string>>(new Set())
  const queue = useMemo(
    () => entries.filter((e) => !e.verified && !deferredIds.has(e.id)),
    [entries, deferredIds],
  )
  const current = queue[0]
  const next = queue[1]
  const [phase, setPhase] = useState<'card' | 'correcting'>('card')
  const reduced = prefersReducedMotion()

  // A fresh card under review always starts on its front face, never
  // mid-correction from whatever the PREVIOUS card left behind.
  useEffect(() => {
    setPhase('card')
  }, [current?.id])

  const cardRef = useRef<HTMLDivElement>(null)
  const likeRef = useRef<HTMLDivElement>(null)
  const nopeRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ dragging: boolean; startX: number; startY: number; pointerId: number } | null>(null)
  const [resolving, setResolving] = useState(false)

  const resolve = useCallback(
    async (dir: -1 | 1) => {
      if (!current || resolving) return
      setResolving(true)
      const el = cardRef.current
      if (el) await flingOut(el, dir, window.innerWidth)
      setResolving(false)
      // A "needs attention" row has no identified card to confirm — swiping
      // right on one would mark it `verified` with `cardId` still null,
      // which reads as resolved in the list but still cannot commit. Route
      // EITHER direction to the correction picker for it; only a matched
      // row's right-swipe actually confirms.
      if (dir === 1 && current.matched) onConfirm(current.id)
      else setPhase('correcting')
    },
    [current, resolving, onConfirm],
  )

  // ── drag (pointer events — one code path for mouse, touch, pen) ──────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (reduced || resolving || !cardRef.current) return
    cardRef.current.setPointerCapture(e.pointerId)
    dragState.current = { dragging: true, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragState.current
    if (!ds?.dragging || !cardRef.current) return
    const dx = e.clientX - ds.startX
    const dy = (e.clientY - ds.startY) * 0.15
    const rot = dx / 18
    cardRef.current.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`
    const t = Math.max(-1, Math.min(1, dx / SWIPE_THRESHOLD))
    if (likeRef.current) likeRef.current.style.opacity = String(Math.max(0, t))
    if (nopeRef.current) nopeRef.current.style.opacity = String(Math.max(0, -t))
  }
  const endDrag = (e: React.PointerEvent) => {
    const ds = dragState.current
    if (!ds?.dragging || !cardRef.current) return
    dragState.current = null
    cardRef.current.releasePointerCapture(e.pointerId)
    const dx = e.clientX - ds.startX
    if (likeRef.current) likeRef.current.style.opacity = '0'
    if (nopeRef.current) nopeRef.current.style.opacity = '0'
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      void resolve(dx > 0 ? 1 : -1)
    } else {
      void springBack(cardRef.current)
    }
  }

  // ── keyboard (desktop) — arrows act on the CURRENT card only while its
  //    front face is showing; the correction list has its own key handling
  //    (arrow-key navigation inside a listbox-shaped picker). ──
  useEffect(() => {
    if (!current || phase !== 'card') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') void resolve(1)
      else if (e.key === 'ArrowLeft') void resolve(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, phase, resolve])

  if (!current) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-[10px] px-[24px] text-center">
        <Icon name="check-circle" size={36} className="text-change-positive" />
        <div className="text-[16px] font-bold text-text-primary">All caught up</div>
        <div className="text-[13px] text-text-muted">
          {verifiedCount} of {total} confirmed. Switch to the list to double-check anything, or add them to your
          collection below.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-[14px] overflow-hidden px-[16px] py-[12px]">
      <div className="flex items-center justify-center gap-[8px]">
        <div className="h-[4px] w-full max-w-[220px] overflow-hidden rounded-full bg-surface-tertiary">
          <div
            className="h-full rounded-full bg-action-primary transition-[width]"
            style={{ width: `${(verifiedCount / Math.max(1, total)) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-[12px] font-bold tabular-nums text-text-muted">
          {Math.min(verifiedCount + 1, total)} of {total}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {next && <SwipeCardFace entry={next} peek className="absolute inset-0 mx-auto" />}

        {phase === 'card' ? (
          <div
            // Keyed by entry id, deliberately: `cardRef` is mutated OUTSIDE
            // React's render cycle (drag writes `style.transform` directly,
            // and `flingOut`'s WAAPI animation reverts to whatever that
            // inline style last was, not to identity, when it's cancelled on
            // finish). Reusing one DOM node across entries would carry a
            // flung-away transform onto the NEXT card; a fresh key forces a
            // fresh node — and a fresh `cardRef.current` — every card.
            key={current.id}
            ref={cardRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="absolute inset-0 mx-auto touch-none select-none"
            style={{ willChange: 'transform' }}
          >
            <SwipeCardFace entry={current} onOpenDetail={onOpenDetail} />
            <div
              ref={likeRef}
              className="pointer-events-none absolute left-[16px] top-[16px] rotate-[-14deg] rounded-lg border-[3px] border-change-positive px-[10px] py-[3px] text-[18px] font-black uppercase tracking-wider text-change-positive opacity-0"
            >
              Confirm
            </div>
            <div
              ref={nopeRef}
              className="pointer-events-none absolute right-[16px] top-[16px] rotate-[14deg] rounded-lg border-[3px] border-error px-[10px] py-[3px] text-[18px] font-black uppercase tracking-wider text-error opacity-0"
            >
              Wrong
            </div>
          </div>
        ) : (
          <CorrectionPanel
            entry={current}
            onPick={(m) => {
              onCorrect(current.id, m)
            }}
            onSkip={() => {
              setDeferredIds((prev) => new Set(prev).add(current.id))
              onSkip(current.id)
            }}
            onCancel={() => setPhase('card')}
          />
        )}
      </div>

      {phase === 'card' && (
        <>
          <QuantityAndVariant entry={current} onQuantityChange={onQuantityChange} onVariantChange={onVariantChange} />
          <div className="flex items-center justify-center gap-[24px]">
            <button
              type="button"
              disabled={resolving}
              aria-label="Wrong card"
              onClick={() => void resolve(-1)}
              className="flex h-[56px] w-[56px] items-center justify-center rounded-full border-2 border-error text-error hover:bg-error/10 disabled:opacity-50"
            >
              <Icon name="close" size={26} />
            </button>
            <button
              type="button"
              disabled={resolving}
              aria-label="Confirm card"
              onClick={() => void resolve(1)}
              className="flex h-[56px] w-[56px] items-center justify-center rounded-full border-2 border-change-positive text-change-positive hover:bg-change-positive/10 disabled:opacity-50"
            >
              <Icon name="check" size={26} />
            </button>
          </div>
          <p className="text-center text-[11px] text-text-muted">
            Swipe, tap, or use the arrow keys — right to confirm, left to correct.
          </p>
        </>
      )}
    </div>
  )
}

// ── the card face — shared by the interactive front card and the static peek ──
function SwipeCardFace({
  entry,
  peek = false,
  className = '',
  onOpenDetail,
}: {
  entry: FeedEntry
  peek?: boolean
  className?: string
  onOpenDetail?: (cardId: string) => void
}) {
  const selectedVariant = entry.variants.find((v) => v.variantId === entry.variantId)
  const owned = selectedVariant?.ownedQuantity ?? 0
  const resultingTotal = owned + entry.quantity
  const variantsLoading = entry.matched && entry.variants.length === 0

  return (
    <div
      className={`flex h-full w-full max-w-[300px] flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-secondary shadow-elevated ${className}`}
      style={peek ? { transform: 'scale(0.94) translateY(12px)', opacity: 0.55 } : undefined}
      aria-hidden={peek || undefined}
    >
      <div
        className={`min-h-0 flex-1 bg-surface-tertiary ${!peek && entry.cardId ? 'cursor-pointer' : ''}`}
        onClick={() => !peek && entry.cardId && onOpenDetail?.(entry.cardId)}
      >
        {entry.matched && entry.images ? (
          <CardImage low={entry.images.low} high={entry.images.high} alt={entry.name} radius={0} className="h-full" />
        ) : (
          <img src={entry.capturePreviewUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-[6px] p-[14px]">
        <div className="truncate font-display text-[18px] font-semibold text-text-primary">
          {entry.matched ? entry.name : 'Needs attention'}
        </div>
        <div className="flex items-center gap-[6px] text-[12px] text-text-muted">
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
            <span>No confident match</span>
          )}
        </div>
        {selectedVariant && (
          <VariantChip
            variant={{
              kind: selectedVariant.kind,
              displayName: selectedVariant.displayName,
              tier: selectedVariant.tier,
              isPrimary: selectedVariant.isPrimary,
            }}
          />
        )}
        <div className="mt-[2px] flex items-center justify-between rounded-lg bg-surface-primary px-[10px] py-[8px] text-[13px]">
          <span className="text-text-muted">You'll have</span>
          {variantsLoading ? (
            <span className="text-text-muted">…</span>
          ) : (
            <span className="font-bold text-text-primary tabular-nums">
              {owned} <span className="font-normal text-text-muted">+ {entry.quantity} →</span>{' '}
              <span className="text-action-primary-strong">{resultingTotal}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function QuantityAndVariant({
  entry,
  onQuantityChange,
  onVariantChange,
}: {
  entry: FeedEntry
  onQuantityChange: (id: string, quantity: number) => void
  onVariantChange: (id: string, variantId: number) => void
}) {
  if (!entry.matched) return null
  return (
    <div className="flex items-center justify-center gap-[14px]">
      {entry.variants.length > 1 && (
        <select
          value={entry.variantId ?? ''}
          aria-label={`Printing of ${entry.name}`}
          onChange={(ev) => onVariantChange(entry.id, Number(ev.target.value))}
          className="h-[32px] rounded-full border border-border-default bg-surface-secondary px-[10px] text-[13px] text-text-body"
        >
          {entry.variants.map((v) => (
            <option key={v.variantId} value={v.variantId}>
              {v.displayName}
            </option>
          ))}
        </select>
      )}
      <div className="inline-flex h-[32px] items-center overflow-hidden rounded-full border border-border-default bg-surface-secondary">
        <button
          type="button"
          aria-label="One fewer"
          onClick={() => onQuantityChange(entry.id, entry.quantity - 1)}
          className="grid h-[30px] w-[32px] place-items-center text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
        >
          −
        </button>
        <span className="min-w-[30px] text-center text-[14px] font-bold tabular-nums text-text-primary">{entry.quantity}</span>
        <button
          type="button"
          aria-label="One more"
          onClick={() => onQuantityChange(entry.id, entry.quantity + 1)}
          className="grid h-[30px] w-[32px] place-items-center text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
        >
          +
        </button>
      </div>
    </div>
  )
}

// ── reject flow: correct the card identity, or leave it flagged ──────────
function CorrectionPanel({
  entry,
  onPick,
  onSkip,
  onCancel,
}: {
  entry: FeedEntry
  onPick: (m: ScanMatch) => void
  onSkip: () => void
  onCancel: () => void
}) {
  return (
    <div className="absolute inset-0 mx-auto flex max-w-[300px] flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-secondary shadow-elevated">
      <div className="flex shrink-0 items-center justify-between border-b border-border-default px-[14px] py-[10px]">
        <span className="text-[13px] font-bold text-text-primary">
          {entry.alternates.length > 0 ? 'Pick the right card' : 'No guesses to pick from'}
        </span>
        <button type="button" onClick={onCancel} aria-label="Cancel, go back" className="text-icon-muted hover:text-icon-hover">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-[8px]">
        {entry.alternates.map((m) => (
          <button
            key={m.cardId}
            type="button"
            disabled={m.cardId === entry.cardId}
            onClick={() => onPick(m)}
            className={`flex w-full items-center gap-[10px] rounded-lg p-[8px] text-left ${
              m.cardId === entry.cardId ? 'bg-halo-neutral' : 'hover:bg-surface-tertiary'
            }`}
          >
            <div className="w-[34px] shrink-0">
              <CardImage low={m.images.low} high={m.images.high} alt="" radius={4} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold text-text-primary">{m.name}</div>
              <div className="truncate text-[11px] text-text-muted">
                {m.setName} · {fmtNumber(m.number)}
              </div>
            </div>
            <span className="shrink-0 text-[12px] font-extrabold tabular-nums text-text-secondary">
              {Math.round(m.confidence * 100)}%
            </span>
          </button>
        ))}
      </div>
      <div className="shrink-0 border-t border-border-default p-[10px]">
        <button
          type="button"
          onClick={onSkip}
          className="flex h-[38px] w-full items-center justify-center rounded-full bg-surface-tertiary text-[13px] font-bold text-text-primary hover:bg-action-default-hover"
        >
          None of these — leave it flagged
        </button>
      </div>
    </div>
  )
}
