// Card-by-card review — Tinder-like, per the owner's direction: one entry at
// a time, swipe right to confirm, swipe left to correct (never a silent
// delete). Pointer events drive a real drag with rotation; `prefers-reduced-
// motion` swaps the drag for two plain buttons; desktop gets ArrowLeft/
// ArrowRight. The stack always reviews `queue[0]` — the first entry not yet
// `verified` — so there is no separate index to keep in sync with corrections/
// removals happening elsewhere in the feed.
//
// ── THE STACK IS ONE KEYED LIST (owner session 2026-11-26) ──────────────────
//
// It used to be a front card keyed by entry plus an unkeyed "peek" behind it.
// Confirming flung the front card off screen, then CANCELLED the animation,
// which drops its fill, so the node snapped back to wherever the drag had left
// it (the right edge, at full opacity) before React swapped in the next entry
// at centre, with no entrance. The owner saw the card he had just swiped come
// back in from the right: "very disorienting ... it almost made me unconfident
// in what I was seeing".
//
// Now the top STACK_DEPTH cards are one list keyed by entry id, each placed by
// its depth (DEPTH_POSE). A confirmed card leaves on a layer of its own
// (`LeavingCard`) that flies off and is removed without ever being cancelled,
// and the moment it goes the card behind it, the SAME DOM node, is promoted:
// it grows from the peek pose into the front while the old one is still in
// flight. "Wrong" opens the correction picker in place of the front card.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CardImage } from '../../components/CardImage'
import { VariantChip } from '../../components/VariantChip'
import { RarityMark } from '../../components/RarityMark'
import { Icon } from '../../components/Icon'
import { fmtNumber } from '../../lib/format'
import type { ScanMatch } from '../../lib/api'
import type { RunningOwned } from './feed'
import { toPickedMatch } from './identity'
import { EASE, prefersReducedMotion, springBack } from './motion'
import type { FeedEntry } from './types'

const SWIPE_THRESHOLD = 110
/** How many cards of the queue are on the table: the front one, the one behind
 *  it, and one more waiting invisibly so it fades in rather than pops. */
const STACK_DEPTH = 3
/** Where a card sits at each depth. The last is invisible: it is the pose a
 *  card arrives from. */
const DEPTH_POSE: ReadonlyArray<{ transform: string; opacity: number }> = [
  { transform: 'none', opacity: 1 },
  { transform: 'translateY(14px) scale(0.94)', opacity: 0.6 },
  { transform: 'translateY(26px) scale(0.88)', opacity: 0 },
]
/** The card behind growing into the front, while the confirmed one flies. */
const PROMOTE_MS = 280
const LEAVE_MS = 300

interface Leaving {
  key: number
  entry: FeedEntry
  owned: RunningOwned | undefined
  dir: -1 | 1
  /** Where the card was when it was let go: the drag's transform, or none. */
  from: string
}

export function SwipeReview({
  entries,
  owned,
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
  /** Each row's owned count with the earlier copies in this scan counted
   *  (feed.ts runningOwned, over the feed in scan order). */
  owned?: ReadonlyMap<string, RunningOwned>
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
  const stack = queue.slice(0, STACK_DEPTH)
  // The correction picker belongs to ONE card. Derived, not reset in an effect:
  // the effect ran a render late, so the next card showed the previous card's
  // picker for a frame.
  const [correctingId, setCorrectingId] = useState<string | null>(null)
  const phase: 'card' | 'correcting' = current && correctingId === current.id ? 'correcting' : 'card'
  const reduced = prefersReducedMotion()

  const cardRef = useRef<HTMLDivElement | null>(null)
  const likeRef = useRef<HTMLDivElement>(null)
  const nopeRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ dragging: boolean; startX: number; startY: number; pointerId: number } | null>(null)
  const [leaving, setLeaving] = useState<Leaving[]>([])
  const leaveSeq = useRef(0)

  const resolve = useCallback(
    (dir: -1 | 1) => {
      if (!current) return
      // A "needs attention" row has no identified card to confirm — swiping
      // right on one would mark it `verified` with `cardId` still null,
      // which reads as resolved in the list but still cannot commit. Route
      // EITHER direction to the correction picker for it; only a matched
      // row's right-swipe actually confirms.
      if (dir === 1 && current.matched) {
        const from = cardRef.current?.style.transform || 'none'
        setLeaving((l) => [...l, { key: ++leaveSeq.current, entry: current, owned: owned?.get(current.id), dir, from }])
        onConfirm(current.id)
        return
      }
      if (cardRef.current) cardRef.current.style.transform = ''
      setCorrectingId(current.id)
    },
    [current, owned, onConfirm],
  )

  // ── depth changes animate: the card behind grows into the front ──────────
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const lastDepth = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const seen = new Map<string, number>()
    stack.forEach((e, depth) => {
      seen.set(e.id, depth)
      const el = nodes.current.get(e.id)
      const was = lastDepth.current.get(e.id)
      if (!el || reduced || was === depth) return
      // A card new to the table arrives from the invisible pose behind the
      // stack (and one arriving AT that pose has nothing to animate); a card
      // moving up animates from the pose it held.
      if (was === undefined && depth === STACK_DEPTH - 1) return
      const from = DEPTH_POSE[Math.min(was ?? STACK_DEPTH - 1, STACK_DEPTH - 1)]!
      el.animate([from, DEPTH_POSE[depth]!], { duration: PROMOTE_MS, easing: EASE.spring })
    })
    lastDepth.current = seen
  })

  // ── drag (pointer events — one code path for mouse, touch, pen) ──────────
  const onPointerDown = (e: React.PointerEvent) => {
    const el = cardRef.current
    if (reduced || !el) return
    // A drag takes the card from wherever it is, including mid-promotion or
    // mid-spring-back: an animation left running would override the finger.
    for (const a of el.getAnimations?.() ?? []) a.cancel()
    el.setPointerCapture(e.pointerId)
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
    if (Math.abs(dx) > SWIPE_THRESHOLD) resolve(dx > 0 ? 1 : -1)
    else void springBack(cardRef.current)
  }

  // ── keyboard (desktop) — arrows act on the CURRENT card only while its
  //    front face is showing; the correction list has its own key handling
  //    (arrow-key navigation inside a listbox-shaped picker). ──
  useEffect(() => {
    if (!current || phase !== 'card') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') resolve(1)
      else if (e.key === 'ArrowLeft') resolve(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, phase, resolve])

  const leavingLayer = leaving.map((l) => (
    <LeavingCard key={`leaving-${l.key}`} item={l} onDone={() => setLeaving((xs) => xs.filter((x) => x.key !== l.key))} />
  ))

  if (!current) {
    return (
      <div className="relative flex flex-1 flex-col items-center justify-center gap-[10px] px-[24px] text-center">
        {leavingLayer}
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
            // scaleX, not width: a width transition re-lays-out the bar every frame.
            className="h-full w-full origin-left rounded-full bg-action-primary transition-transform duration-300"
            style={{ transform: `scaleX(${verifiedCount / Math.max(1, total)})` }}
          />
        </div>
        <span className="shrink-0 text-[12px] font-bold tabular-nums text-text-muted">
          {Math.min(verifiedCount + 1, total)} of {total}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {stack.map((e, depth) => {
          const front = depth === 0
          const live = front && phase === 'card'
          return (
            <div
              key={e.id}
              ref={(el) => {
                if (el) nodes.current.set(e.id, el)
                else nodes.current.delete(e.id)
                if (front) cardRef.current = el
              }}
              onPointerDown={live ? onPointerDown : undefined}
              onPointerMove={live ? onPointerMove : undefined}
              onPointerUp={live ? endDrag : undefined}
              onPointerCancel={live ? endDrag : undefined}
              // A mouse drag on the card's <img> otherwise starts the browser's
              // native image drag, which cancels the pointer after one move: the
              // swipe never got past a few pixels with a mouse.
              onDragStart={(ev) => ev.preventDefault()}
              aria-hidden={!front || undefined}
              className={`absolute inset-0 mx-auto max-w-[300px] select-none ${front ? 'touch-none' : 'pointer-events-none'}`}
              style={{ ...DEPTH_POSE[depth], zIndex: STACK_DEPTH - depth, willChange: 'transform' }}
            >
              {front && phase === 'correcting' ? (
                <CorrectionPanel
                  entry={e}
                  onPick={(m) => onCorrect(e.id, m)}
                  onSkip={() => {
                    setDeferredIds((prev) => new Set(prev).add(e.id))
                    onSkip(e.id)
                  }}
                  onCancel={() => setCorrectingId(null)}
                />
              ) : (
                <>
                  <SwipeCardFace entry={e} owned={owned?.get(e.id)} onOpenDetail={front ? onOpenDetail : undefined} />
                  {front && (
                    <>
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
                    </>
                  )}
                </>
              )}
            </div>
          )
        })}
        {leavingLayer}
      </div>

      {/* Always laid out, so the card above never resizes as the controls
          come and go between a named card and the correction picker. */}
      <div className={`flex flex-col gap-[14px] ${phase === 'card' ? '' : 'invisible'}`} aria-hidden={phase !== 'card' || undefined}>
        <div className="flex h-[32px] items-center justify-center">
          <QuantityAndVariant entry={current} onQuantityChange={onQuantityChange} onVariantChange={onVariantChange} />
        </div>
        <div className="flex items-center justify-center gap-[24px]">
          <button
            type="button"
            aria-label="Wrong card"
            onClick={() => resolve(-1)}
            className="flex h-[56px] w-[56px] items-center justify-center rounded-full border-2 border-error text-error hover:bg-error/10 disabled:opacity-50"
          >
            <Icon name="close" size={26} />
          </button>
          <button
            type="button"
            aria-label="Confirm card"
            onClick={() => resolve(1)}
            className="flex h-[56px] w-[56px] items-center justify-center rounded-full border-2 border-change-positive text-change-positive hover:bg-change-positive/10 disabled:opacity-50"
          >
            <Icon name="check" size={26} />
          </button>
        </div>
        <p className="text-center text-[11px] text-text-muted">Swipe, tap, or use the arrow keys — right to confirm, left to correct.</p>
      </div>
    </div>
  )
}

/** A confirmed card on its way out: flies off from where it was let go and is
 *  removed when it lands. Never cancelled, so it never snaps back. */
function LeavingCard({ item, onDone }: { item: Leaving; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(onDone)
  done.current = onDone
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = prefersReducedMotion()
    const dx = item.dir * (window.innerWidth * 0.9 + 200)
    const anim = reduced
      ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' })
      : el.animate(
          [
            { transform: item.from, opacity: 1 },
            { transform: `translate(${dx}px, -10px) rotate(${item.dir * 24}deg)`, opacity: 0 },
          ],
          { duration: LEAVE_MS, easing: EASE.swift, fill: 'forwards' },
        )
    let alive = true
    const finish = () => {
      if (alive) done.current()
    }
    anim.finished.then(finish, finish)
    return () => {
      alive = false
    }
  }, [item])
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 mx-auto max-w-[300px]"
      style={{ transform: item.from, zIndex: STACK_DEPTH + 1 }}
    >
      <SwipeCardFace entry={item.entry} owned={item.owned} />
    </div>
  )
}

// ── the card face — shared by the interactive front card and the static peek ──
function SwipeCardFace({
  entry,
  owned: running,
  onOpenDetail,
}: {
  entry: FeedEntry
  /** feed.ts runningOwned's entry for this row: earlier copies in this scan counted. */
  owned?: RunningOwned
  /** Only the front card opens the detail; the cards behind and a leaving one don't. */
  onOpenDetail?: (cardId: string) => void
}) {
  const selectedVariant = entry.variants.find((v) => v.variantId === entry.variantId)
  const owned = running?.before ?? selectedVariant?.ownedQuantity ?? 0
  const resultingTotal = running?.after ?? owned + entry.quantity
  const variantsLoading = entry.matched && entry.variants.length === 0
  const peek = !onOpenDetail

  return (
    <div
      className="flex h-full w-full max-w-[300px] flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-secondary shadow-elevated"
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
          {entry.matched ? entry.name : 'Needs your input'}
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
          <span className="text-text-muted">
            You'll have
            {running && running.copies > 1 && (
              <span className="ml-[6px] text-[11px] font-bold text-text-secondary">
                copy {running.copy} of {running.copies}
              </span>
            )}
          </span>
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
    <div className="absolute inset-0 mx-auto flex max-w-[300px] flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-secondary shadow-elevated motion-safe:animate-[sheet-panel-in_200ms_cubic-bezier(0.22,0.61,0.36,1)_both]">
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
            // The row's dialect, not the wire's — see `toPickedMatch`. A
            // candidate the resolve ladder found by name has no phash distance,
            // and `-1`/`0` is what this feed has always written for that.
            onClick={() => onPick(toPickedMatch(m))}
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
            {/* No percentage for a candidate no hash ever saw: 0 % would read
                as "certainly not this one" about a card the printed name found. */}
            {m.confidence != null && (
              <span className="shrink-0 text-[12px] font-extrabold tabular-nums text-text-secondary">
                {Math.round(m.confidence * 100)}%
              </span>
            )}
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
