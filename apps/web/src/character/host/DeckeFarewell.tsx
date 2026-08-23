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
 * ── WHY IT IS NOT WIRED, AND EXACTLY WHAT WIRING IT IS ───────────────────────
 *
 * **IT IS NOT MOUNTED BY ANYTHING TODAY.** That is stated first because this
 * repository has a bad history with it: `CardRows`, `onRemoveCard` and
 * `resetDeckeEntitlement` were all built and never wired, and the last of them
 * meant Deck-E never appeared for a signed-in reader. A component with no call
 * site is a defect wearing a feature's clothes, and this comment is the record
 * of which one it is.
 *
 * The reason is ownership rather than design: the dismissal and the flight home
 * live in `DeckeHost.tsx`, which belongs to another lane of this pass. The panel
 * cannot mount it — `DeckeChat` returns `null` the moment `open` goes false,
 * which is the same tick the farewell would need to appear.
 *
 * `DeckeHost.tsx` needs, in its `onClose`:
 *
 *     const [bye, setBye] = useState<{ text: string; at: number } | null>(null)
 *     const byeIdRef = useRef<string | null>(null)
 *     // …inside onClose, before setChatOpen(false):
 *     const f = pickFarewell({ avoid: byeIdRef.current })
 *     byeIdRef.current = f.id
 *     setBye({ text: f.text, at: Date.now() })
 *
 * and, beside `<DeckeBubble>`:
 *
 *     {bye ? <DeckeFarewell text={bye.text} himRect={himRect} onDone={() => setBye(null)} /> : null}
 *
 * The `avoid` id should be persisted through `writeLastSaid(store, { farewellId })`
 * so the no-repeat rule survives a reload; `LastSaid` already carries the field.
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
export function DeckeFarewell({
  text,
  himRect,
  onDone,
}: {
  text: string
  /** His rect, if the host has one. Without it the label sits in the corner. */
  himRect?: HimRect | null
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

  if (gone || !text) return null

  /*
    ABOVE HIS HEAD, CLAMPED INTO THE VIEWPORT.

    `translate(-50%, -100%)` centres the label on him and lifts it clear, and the
    clamp is what stops it leaving the screen when he is parked in a corner —
    which is the only place he is ever parked. Without it the phone case puts
    half the sentence off the left edge, which is the same class of defect as the
    bubble that had to learn to slide away from his bolts.
  */
  const left = himRect ? himRect.left + himRect.width / 2 : 72
  const top = himRect ? himRect.top - 10 : 0

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
        'pointer-events-none fixed z-[26] max-w-[220px] -translate-x-1/2 -translate-y-full',
        // `surface-secondary`, NOT `surface-raised`, for the reason `theme.css`
        // gives at the composer card: "raised" is stone-500, sized for a small
        // circular button where a light disc reads as lifted, and at label width
        // over a near-black page it photographs as a pale grey slab. A card over
        // a dark page is lifted by its border and its shadow.
        'rounded-[12px] border border-surface-tertiary bg-surface-secondary/95 px-[11px] py-[6px]',
        'text-[12.5px] leading-[18px] text-text-body shadow-lg backdrop-blur-sm',
        'motion-safe:animate-[decke-chat-in_220ms_cubic-bezier(0.2,0.9,0.3,1)_backwards]',
      ].join(' ')}
      style={{
        left: `clamp(96px, ${Math.round(left)}px, calc(100vw - 96px))`,
        top: `max(72px, ${Math.round(top)}px)`,
      }}
    >
      {text}
    </div>
  )
}
