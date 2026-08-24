/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT HE LEAVES BEHIND ON HIS WAY BACK TO HIS CORNER
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * *"He can kind of go back over into his chat bubble and maybe a little message
 * comes up that's like 'I'll be right here when you need me' — and we can have
 * that be a whole bunch of different kinds of little messages."*
 *
 * The words are in `deckeVoice.ts` (`FAREWELLS`, `pickFarewell`) with their own
 * rules and their own tests. This is the thing that draws one.
 *
 * ── WHY IT IS NOT `DeckeBubble` ──────────────────────────────────────────────
 *
 * `DeckeBubble` is the transcript's voice while he is out on the page: it is
 * anchored to his live rect, re-solved against whatever he is highlighting, and
 * it exists only while `travelling`. This is a different object — a fixed label
 * near where he is COMING TO REST, shown for a beat and then gone, that must not
 * take pointer events, must not move the layout, and must survive the panel
 * unmounting out from under it. Sharing a component would mean one of them
 * carrying flags for the other.
 *
 * ── WIRED, AND TO WHAT ────────────────────────────────────────────────────────
 *
 * `DeckeHost.tsx` mounts this beside `<DeckeBubble>` — the reason it isn't in
 * `DeckeChat` is unchanged: that panel returns `null` the instant `open` goes
 * false, the same tick this needs to appear. What changed is the rect it's
 * fed. It used to be `himRect`, his LIVE on-page position, sampled while he was
 * `travelling` — which is exactly wrong for a line spoken at arrival, because
 * by the time he's home that sampling has long since gone `null` (see the
 * repo's own recon of the sampling effect). `DeckeHost.tsx` now captures the
 * LAUNCHER CHIP's box instead, at the moment he tucks into it, and holds it in
 * `farewell.rect` alongside the picked line — a value that answers "where is
 * he becoming himself again" rather than "where was he last seen moving",
 * which is the rect this component actually wants. Its own null-check above
 * exists for the case that measurement fails, not because the host might skip
 * it on purpose.
 *
 * The words, the pool and the no-repeat rule stay in `deckeVoice.ts`; picking
 * happens at `seeYouOut()` (close) and this renders at arrival — see that
 * function's own comment for why those are two different ticks.
 */
import { useEffect, useState, type JSX } from 'react'

/** Where he is on screen, in CSS pixels. The same shape `DeckeBubble` takes. */
export type HimRect = { left: number; top: number; width: number; height: number }

/**
 * How long the line stays.
 *
 * Long enough to read fourteen characters at a glance and short enough that it
 * is gone before anybody wants it gone. The flight home is ~600ms, so the label
 * outlives the arrival by a beat, which is what makes it read as *he said that
 * as he went* rather than as a notification that appeared afterwards.
 */
export const FAREWELL_MS = 2600

/**
 * X1 — REDUCED MOTION SHIPS WITH THE MOTION, PER ELEMENT.
 *
 * The fade is `motion-safe:` and under `prefers-reduced-motion` the label simply
 * appears and disappears at full opacity. That is the correct trade here for the
 * reason `ToolRow`'s ring gives for its own: the motion carries no information —
 * the WORDS are the information — so removing it costs nothing. It is never a
 * blanket duration override.
 */

/** How far above the chip the line sits, in px. Small, because the chip it's
 *  quoting is only ~36px tall — the old GAP-less `-10` this replaces was tuned
 *  for the same distance, just unnamed. */
const GAP = 10
/** How close the label's centre may come to the viewport edge before it
 *  clamps, in px. Deliberately small: `himRect` used to be his full sprite
 *  wandering anywhere on the page, and a wide margin kept a large character
 *  from pushing the label off-screen. It is now the launcher chip, ~44px wide
 *  and parked ~24px from the corner — the old 96px margin clamped the label
 *  50-70px away from a chip that small, which is exactly the "horizontally
 *  aligned to it" the chip-anchor was supposed to deliver. 16px is enough to
 *  keep the label on-screen on a narrow phone without fighting the common
 *  case. */
const EDGE_MARGIN = 16
/** How far above the header band the label may not rise, so it never sits
 *  under the nav bar it would otherwise be able to reach on a short viewport.
 *  Unrelated to `EDGE_MARGIN` — this bound is vertical and the chip is always
 *  near the BOTTOM of the screen, so it rarely binds. */
const TOP_MARGIN = 72
/** Pop-in travel distance, in px — the same beat `DeckeBubble` gives its own
 *  entrance (`POP`/`ENTER_MS` there), so the two things he leaves behind on
 *  the page read as one family rather than two components that happened to
 *  animate near each other. */
const POP = 8
const ENTER_MS = 180

export function DeckeFarewell({
  text,
  himRect,
  onDone,
}: {
  text: string
  /** The launcher chip's box, captured the moment he tucked into it. The host
   *  never sets a farewell without one — see `DeckeHost.tsx`'s `farewell`
   *  state — but the type stays nullable because "no rect" is a real state a
   *  caller could reach, and there is nothing to speak FROM without one. */
  himRect: HimRect | null
  onDone: () => void
}): JSX.Element | null {
  const [gone, setGone] = useState(false)
  useEffect(() => {
    setGone(false)
    const t = window.setTimeout(() => {
      setGone(true)
      onDone()
    }, FAREWELL_MS)
    return () => window.clearTimeout(t)
    // Re-armed per LINE, so two dismissals in quick succession each get their
    // full beat rather than the second inheriting the first's remaining time.
  }, [text, onDone])

  // Plays the pop-in once per mount, mirroring `DeckeBubble` beat-for-beat —
  // including the bug fix: NO once-guard ref. StrictMode's dev mount runs
  // effect → cleanup → effect; a latched ref survived into the second run,
  // whose early-return meant the rAF the cleanup had just cancelled was never
  // rescheduled — `entered` stayed false and the farewell spent its whole
  // 2.6 s mounted at opacity 0. Caught by screenshotting the very frame the
  // DOM said the words were on screen. "Once per mount" is `key={farewell.at}`'s
  // job in the host, not a ref's.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!himRect || !text) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [himRect, text])

  // NO RECT, NO LINE. The old fallback put the words in the top-left corner
  // of the screen when `himRect` was null — the owner's reaction, verbatim,
  // was "What the fuck?" — because a line anchored to nothing reads as a
  // stray notification, not as him speaking. The host now only ever sets a
  // farewell once it has measured the chip, so null here means the words
  // have nowhere to come from, and nothing is the correct amount to show.
  if (gone || !text || !himRect) return null

  /*
    JUST ABOVE THE CHIP, RIGHT-ALIGNED TO IT.

    Anchored by its RIGHT edge, not centred: a centre + translate(-50%) at a
    chip parked in the corner pushes half the label past the viewport, and a
    CSS clamp on the centre cannot know the box's width to compensate —
    photographed as a line of text sliced off at the screen edge. The chip
    lives in a corner by design, so the honest anchor is the edge it shares
    with the corner: the label's right edge sits on the chip's right edge and
    the words grow leftward, into the screen, always fully visible. `GAP` is
    the breathing room between the label's bottom edge and the chip's top.
  */
  // `window` is guarded because the farewell renders in node too — its own
  // test renders through `react-dom/server`, where the honest answer to
  // "how far from the right edge" is simply the margin.
  const viewportW = typeof window === 'undefined' ? 0 : window.innerWidth
  const right = Math.max(
    EDGE_MARGIN,
    Math.round(viewportW - (himRect.left + himRect.width)),
  )
  const top = himRect.top - GAP

  return (
    <div
      // `aria-live="polite"`: it is a courtesy, not information, and it must
      // never interrupt. A screen-reader user who has just closed the panel is
      // being returned to the page, and this rides along behind that.
      role="status"
      aria-live="polite"
      className={[
        // POINTER-TRANSPARENT, ALWAYS. It sits over a page the reader has just
        // asked to get back to; a label that eats the first click after a
        // dismissal would be worse than no label at all.
        // `w-max`: a fixed element's auto width shrink-wraps against the
        // VIEWPORT edge before the transform is applied, so a label whose
        // `left` sits near the right edge resolved to ~40px and wrapped one
        // word per line (photographed). `max-content` makes the words size
        // the box and the translate centre it, edge or no edge.
        'pointer-events-none fixed z-[26] w-max max-w-[220px]',
        // `surface-secondary`, NOT `surface-raised`, for the reason `theme.css`
        // gives at the composer card: "raised" is stone-500, sized for a small
        // circular button where a light disc reads as lifted, and at label width
        // over a near-black page it photographs as a pale grey slab. A card over
        // a dark page is lifted by its border and its shadow.
        'rounded-[12px] border border-surface-tertiary bg-surface-secondary/95 px-[11px] py-[6px]',
        'text-[12.5px] leading-[18px] text-text-body shadow-lg backdrop-blur-sm',
        // A transition, not a keyframe: the centring/lift transform above is
        // computed per-render alongside the pop-in offset, and a keyframe's
        // literal `transform` would clobber it for the animation's duration —
        // the exact bug this replaces (see `DeckeBubble.tsx` for the same
        // fix, done first there). `motion-reduce:transition-none` makes the
        // pop-in instant under reduced motion per X1 above; the position is
        // still correct on the first frame either way.
        'motion-safe:transition-[opacity,transform] motion-safe:ease-[cubic-bezier(0.2,0.9,0.3,1)]',
        'motion-reduce:transition-none',
      ].join(' ')}
      style={{
        right: `${right}px`,
        top: `max(${TOP_MARGIN}px, ${Math.round(top)}px)`,
        // The pop-in travels straight down (toward the chip below it) rather
        // than `DeckeBubble`'s direction-of-him vector: the chip is always
        // beneath this label, never to a side, so there is only one direction
        // "toward him" ever means here.
        transform: `translateY(-100%) translateY(${entered ? 0 : POP}px) scale(${entered ? 1 : 0.94})`,
        opacity: entered ? 1 : 0,
        transitionDuration: `${ENTER_MS}ms`,
      }}
    >
      {text}
    </div>
  )
}
