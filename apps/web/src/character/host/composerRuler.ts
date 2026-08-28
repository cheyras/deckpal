/**
 * The composer height Deck-E is RULED OFF — which is not the composer's height.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * He is sized from the composer card he stands beside; `DeckeHost`'s
 * `characterHeightBeside` says why, and that decision is not in question here.
 * The composer, though, is a textarea that GROWS — deliberately, so a long card
 * list stays readable while you type it — and feeding its live height into a
 * multiplier made his size a function of how much the reader had typed.
 *
 * MEASURED, on the 2026-08-24 review recording: at 13:20 the composer is one
 * row and he is one size; at 13:23 the reader's draft wraps to a second row and
 * he is 1.4x bigger and has shifted down and to the left; at 13:34 the message
 * is sent, the composer collapses, and he snaps back. Fourteen tagged instances
 * of that pair, described by the owner as "he all of a sudden just grew in size
 * for no reason", "sudden scale back down. same bullshit", and eventually "I'm
 * sure there are more after this but I'm going to stop labeling them". It is the
 * single most frequent defect on the tape and it is this one number.
 *
 * The composer MOVING is a real event he should answer — a taller composer sits
 * higher, and he should go up with it, which is what `markWatch` is for. The
 * composer moving is not a reason for him to be a different size.
 *
 * ── WHY A LATCH RATHER THAN A FORMULA ────────────────────────────────────────
 *
 * The resting height could be computed — 8px of padding, a 40px row, 8px more —
 * and every one of those numbers is a Tailwind class in a sibling component that
 * nobody would think to keep in step with this file. The composer at rest is
 * simply the SHORTEST it is ever seen at, so that is what this remembers. It
 * needs no knowledge of the composer's construction and it cannot drift from it.
 *
 * The latch is keyed to the viewport, because a real resize legitimately changes
 * the resting height and the old minimum would pin him to a stale one.
 *
 * ── WHY A `.ts` SIBLING ──────────────────────────────────────────────────────
 *
 * Same reason as `markWatch.ts`: a `.tsx` throws under `node --import tsx` on
 * `import.meta.env`, so a decision that lives inside the component cannot be
 * tested. This pass has a defect list of its own making because that lesson was
 * learned once already; the decision lives here and the component calls it.
 */

/** What the latch remembers between samples. `null` before the first one. */
export type ComposerRuler = {
  /** The viewport this resting height was measured against. */
  w: number
  h: number
  /** The shortest the composer has been seen at, at this viewport. */
  resting: number
}

/**
 * Fold one composer measurement into the ruler.
 *
 * A NON-POSITIVE SAMPLE IS NOT A MEASUREMENT. The composer is absent from the
 * DOM whenever the panel is showing a past transcript or the out-of-credits
 * notice, and it reads zero for a frame while the panel is still laying out.
 * Treating that as "the composer is very short indeed" would latch him to
 * nothing; the previous ruler is kept instead, and the caller decides what to do
 * with a run that has no ruler at all.
 *
 * A CHANGE OF VIEWPORT STARTS AGAIN. Not `Math.min` across a resize: a window
 * dragged narrower gives the composer more rows for the same text, and carrying
 * the wide window's minimum forward would rule him off a composer that no longer
 * exists at that height.
 */
export function ruleComposer(
  prev: ComposerRuler | null,
  sample: { composerH: number; w: number; h: number },
): ComposerRuler | null {
  const { composerH, w, h } = sample
  if (!(composerH > 0)) return prev
  if (!prev || prev.w !== w || prev.h !== h) return { w, h, resting: composerH }
  return composerH < prev.resting ? { w, h, resting: composerH } : prev
}

/**
 * The ruler to use for a sample, or `null` if there is nothing honest to use.
 *
 * `null` means "do not change his height" — NOT "fall back to the full-page
 * formula". That fallback is up to 300px against a composer-ruled ~160px, so
 * substituting it for a composer that is merely unmeasurable this instant is a
 * near-2x pop, which is the same defect this file exists to remove arriving by a
 * different door. Keeping the last good height until the composer can be read
 * again is the only answer that cannot be wrong on screen.
 *
 * When the chat is CLOSED there is no composer to be ruled off and the full-page
 * formula is correct rather than a fallback, so the caller takes that branch
 * without consulting this at all.
 */
export function rulerFor(ruler: ComposerRuler | null, sample: { composerH: number; w: number; h: number }): number | null {
  const next = ruleComposer(ruler, sample)
  if (!next) return null
  if (next.w !== sample.w || next.h !== sample.h) return null
  return next.resting
}

/**
 * How many pixels of height change are worth acting on.
 *
 * ── THE LOOP THIS BREAKS ─────────────────────────────────────────────────────
 *
 * His height is not a leaf. It sets `parkW`, which sets the transcript's
 * `--decke-gutter`, which re-wraps every bubble beside him, which changes what
 * the layout does under the composer — and `DeckeHost`'s mark watch is looking
 * straight at that. So a one-pixel re-measure is not one pixel of anything: it
 * is a re-wrap, a moved mark, a debounce and a re-park, whose own `measure()`
 * can land one pixel off again.
 *
 * That is the other half of the slow drift `MARK_HOP_MIN_PX` describes. The
 * threshold there stops a small move being FLOWN; this stops it being
 * GENERATED, and the two are worth having separately because either one alone
 * still leaves a cut being made several times a second for nothing.
 *
 * 3 px is under the smallest change anybody can see on a ~200 px character and
 * comfortably over the rounding boundaries a `getBoundingClientRect` on a
 * fractional-DPR phone lands on.
 */
export const HEIGHT_EPS = 3

/**
 * The height to apply, given the one already applied.
 *
 * ZERO IS ALWAYS APPLIED, in both directions. `0` means "he has no size yet" on
 * the way in and "the panel is gone" on the way out; treating either as a small
 * change would leave him at a stale size with nothing to correct it.
 */
export function steadyHeight(applied: number, next: number): number {
  if (!applied || !next) return next
  return Math.abs(next - applied) < HEIGHT_EPS ? applied : next
}
