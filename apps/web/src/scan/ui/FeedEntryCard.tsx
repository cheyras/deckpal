// One verify-feed row — card image, name, setName · number, variant chip,
// confidence meter, quantity stepper, "wrong card? / pick a match" popover,
// and a small report affordance. Ported from prototype.html's
// `buildFeedEntry` + `openAlternates`.
//
// ── THE NEEDS-INPUT ROW (owner ruling, 2026-09-06) ──────────────────────────
//
// "If the resolution is 'needs your input' they should still go down to the
// list." So a capture nothing could name arrives HERE, not on the camera, and
// this row is where the question gets asked:
//
//   * amber, and marked as a question rather than a card — the reader scanning
//     the list has to be able to see which rows are still owed an answer without
//     reading any of them;
//   * showing the CAPTURE, because the picture is the whole of what the reader
//     has to work with;
//   * carrying the same picker the stack used to open — the tie-gated
//     candidates, the OCR read as a hint chip, and the way out — opened by
//     tapping the capture itself or the "pick a match" link, in place, without
//     leaving the list;
//   * and never a quantity stepper, because a row that is not a card yet cannot
//     be two of it (`feed.ts`: an unresolved row merges with nothing).
//
// Resolving one turns it into an ordinary row through `feed.resolveRow` — the
// same merge a confident capture of that card would have taken — and the
// printing slot picks up from there.
import { useEffect, useRef, useState } from 'react'
import { CardImage } from '../../components/CardImage'
import { VariantChip } from '../../components/VariantChip'
import { RarityMark } from '../../components/RarityMark'
import { Icon } from '../../components/Icon'
import { ProgressBar, Spinner } from '../../components/ui'
import { fmtNumber } from '../../lib/format'
import type { ScanMatch } from '../../lib/api'
import { ocrHintLabel } from './identity'
import { bump, DURATION, revealEntry, staggerReveal } from './motion'
import { printingState } from './printing'
import type { FeedEntry } from './types'
import { AlternatesPopover } from './AlternatesPopover'

export function FeedEntryCard({
  entry,
  onQuantityChange,
  onVariantChange,
  onCorrect,
  onRemove,
  onDiscard,
  onReport,
  onOpenDetail,
  onPickerOpenChange,
  registerThumbNode,
}: {
  entry: FeedEntry
  onQuantityChange: (id: string, quantity: number) => void
  /** The reader says which PRINTING (same card, different variant) — not to
   *  be confused with `onCorrect`, which replaces the card identity itself. */
  onVariantChange: (id: string, variantId: number) => void
  onCorrect: (id: string, match: ScanMatch) => void
  /** Drop the row outright. The quantity stepper reaching 0 does this too for
   *  a matched row, but an unresolved row has no stepper, so without an
   *  explicit remove it could be un-clearable. */
  onRemove: (id: string) => void
  /**
   * "Discard and retake" from the needs-input row's own picker.
   *
   * NOT `onRemove`. Both drop the row; only this one is the reader saying "that
   * capture was no good, let me scan it again", which also has to release the
   * engine's refractory hold on the track so the same card presenting again is
   * a capture rather than a suppression. Falls back to `onRemove` when the
   * caller has nothing to release (the upload path).
   */
  onDiscard?: (entry: FeedEntry) => void
  onReport: (entry: FeedEntry) => Promise<void>
  onOpenDetail: (cardId: string) => void
  /**
   * The picker on this row opened or closed.
   *
   * Reported up because a late OCR narrowing must not rename a row the reader
   * is mid-decision on — the rule `identity.ts` used to enforce with `engaged`
   * while the picker hung off a stack thumbnail. The popover's own open state
   * stays local; only the fact of it travels.
   */
  onPickerOpenChange?: (id: string, open: boolean) => void
  registerThumbNode: (id: string, el: HTMLDivElement | null) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const mountedTick = useRef(entry.mergeTick)
  const [popoverOpen, setPopoverOpenState] = useState(false)
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const popoverOpenRef = useRef(false)
  const setPopoverOpen = (open: boolean) => {
    popoverOpenRef.current = open
    setPopoverOpenState(open)
    onPickerOpenChange?.(entry.id, open)
  }
  // A resolved row is a DIFFERENT row — `feed.resolveRow` gives it the card's id
  // and React remounts it — so a picker open at that moment never gets its own
  // close. Report it from the unmount instead, or the guard upstairs keeps
  // protecting a row that no longer exists.
  useEffect(
    () => () => {
      if (popoverOpenRef.current) onPickerOpenChange?.(entry.id, false)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

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
  const selectedVariant = entry.variants.find((v) => v.variantId === entry.variantId)
  // THE PRINTING SLOT (printing.ts). Three states, one policy, and the one the
  // row is in is decided there rather than by a `variants.length > 1` buried in
  // the JSX — which is where the rule used to live, unnamed and untested.
  const printing = printingState(entry)
  // A row the PRINTED-NUMBER ladder named has no phash distance (`-1`), and a
  // meter reading "0% · dist -1" would be inventing a measurement that was never
  // taken. It gets a provenance line instead of a bar.
  const hasPhashOpinion = entry.distance >= 0
  // THE ROW IS A QUESTION, not a card. One test, `feed.isUnresolved`'s, so the
  // amber the reader sees and the row `commit.ts` will skip cannot disagree.
  const needsInput = !entry.matched
  const ocrHint = ocrHintLabel(entry.identity?.read ?? null)

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
      data-entry-state={needsInput ? 'needs-input' : 'identified'}
      data-verified={entry.verified || undefined}
      className={`relative flex gap-[10px] rounded-xl border p-[10px] ${
        entry.verified
          ? 'border-change-positive/50 bg-surface-secondary'
          : needsInput
            ? 'border-warning bg-warning/5'
            : 'border-border-default bg-surface-secondary'
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

      {/* THE CAPTURE IS THE TAP TARGET on a needs-input row — "tapping opens the
          picker in place in the list". On a named row the same square opens the
          card's detail sheet, which is what it has always done; the two never
          collide, because a row has an identity or a question, never both. */}
      <div
        ref={(el) => registerThumbNode(entry.id, el)}
        role={needsInput ? 'button' : undefined}
        tabIndex={needsInput ? 0 : undefined}
        aria-label={needsInput ? 'Identify this capture, or discard it' : undefined}
        className={`relative w-[60px] shrink-0 cursor-pointer overflow-hidden rounded-md shadow-panel ${
          needsInput ? 'ring-2 ring-warning' : ''
        }`}
        onClick={() => (needsInput ? setPopoverOpen(!popoverOpen) : entry.cardId && onOpenDetail(entry.cardId))}
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
        <div className="fe-name flex items-center gap-[6px] truncate font-display text-[15px] font-semibold leading-[19px] text-text-primary">
          {entry.matched ? (
            entry.name
          ) : (
            <>
              <span className="inline-flex shrink-0 items-center gap-[3px] rounded-full bg-warning px-[6px] py-[2px] text-[9px] font-extrabold uppercase tracking-wide text-surface-primary">
                <Icon name="alert" size={9} /> you
              </span>
              <span className="truncate">Needs your input</span>
            </>
          )}
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
            <span className="truncate">
              {/* WHAT THE SCANNER GOT, in the reader's own terms. The OCR read is
                  the single most useful thing to hand them here — it is printed
                  on the card they are holding and they can check it in a second
                  — so it leads when there is one, quoted as evidence rather
                  than stated as a finding (`ocrHintLabel`). */}
              {ocrHint ? `Tap to identify · ${ocrHint}` : 'No confident match — tap to identify'}
            </span>
          )}
        </div>

        {/* WHICH PRINTING — the slot the 2026-09-05 ruling puts on the row:
            "variant resolve happens there". `detecting` is the state the
            server-side variant pass will land in and nothing enters it today
            (printing.ts); `needs-pick` is where every multi-printing row starts,
            because nothing in the scanner can tell a reverse holo from its
            normal printing; `resolved` is the chip, and a single printing goes
            straight there — a select with one option is furniture that teaches
            the reader to stop reading the row. */}
        {entry.matched && printing === 'detecting' && (
          <div
            data-printing="detecting"
            className="fe-chips mt-[3px] inline-flex h-[26px] items-center gap-[6px] rounded-full bg-surface-tertiary px-[9px] text-[12px] text-text-muted"
          >
            <Spinner inline size={12} /> Detecting printing…
          </div>
        )}
        {entry.matched && printing === 'needs-pick' && (
          <div data-printing="needs-pick" className="fe-chips mt-[3px] flex items-center gap-[6px]">
            <select
              value={entry.variantId ?? ''}
              aria-label={`Printing of ${entry.name}`}
              onChange={(ev) => onVariantChange(entry.id, Number(ev.target.value))}
              className="h-[26px] rounded-full border border-warning/60 bg-surface-primary px-[8px] text-[12px] text-text-body"
            >
              {entry.variants.map((v) => (
                <option key={v.variantId} value={v.variantId}>
                  {v.displayName}
                </option>
              ))}
            </select>
            <span className="text-[11px] font-semibold text-warning">pick a printing</span>
          </div>
        )}
        {entry.matched && printing === 'resolved' && selectedVariant && (
          <div data-printing="resolved" className="fe-chips mt-[3px]">
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

        {entry.matched && hasPhashOpinion && (
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
        {entry.matched && !hasPhashOpinion && (
          <div className="fe-conf mt-[4px] text-[11px] text-text-muted">Matched from the printed number</div>
        )}

        <div className="fe-row mt-[6px] flex items-center justify-between gap-[8px]">
          <div className="flex items-center gap-[10px]">
            {/* A needs-input row ALWAYS offers this, even when `/scan` came back
                with nothing to offer: the picker is also where "discard and
                retake" lives, and a capture with no candidates is exactly the
                one the reader most needs a way out of. A named row only offers
                it when there is something to swap to. */}
            {(needsInput || entry.alternates.length > 0) && (
              <button
                type="button"
                onClick={() => setPopoverOpen(!popoverOpen)}
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
          // THE SAME PICKER THE STACK USED TO OPEN, in the place the capture now
          // lives. Same component, same three slots — title, the OCR hint chip,
          // and the way out — so the ask cannot drift between the two rulings.
          title={needsInput ? 'Which card is this?' : undefined}
          hint={
            needsInput && ocrHint ? (
              <div className="mx-[6px] mb-[6px] inline-flex items-center gap-[5px] rounded-full bg-surface-tertiary px-[8px] py-[3px] text-[11px] font-semibold text-text-secondary">
                <Icon name="search" size={11} /> {ocrHint}
              </div>
            ) : null
          }
          footer={
            needsInput ? (
              <div className="mt-[4px] border-t border-divider-subtle pt-[6px]">
                {entry.alternates.length === 0 && (
                  <p className="px-[6px] pb-[6px] text-[11px] text-text-muted">
                    The matcher had no guesses for this one.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPopoverOpen(false)
                    if (onDiscard) onDiscard(entry)
                    else onRemove(entry.id)
                  }}
                  className="flex w-full items-center justify-center gap-[6px] rounded-lg p-[7px] text-[12px] font-semibold text-text-muted hover:bg-surface-tertiary hover:text-text-primary"
                >
                  <Icon name="close" size={12} /> Discard and retake
                </button>
              </div>
            ) : null
          }
        />
      )}
    </div>
  )
}
