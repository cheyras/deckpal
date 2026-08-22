/**
 * The entry point — a small floating button, bottom-right, on every page.
 *
 * WHAT IT DOES *NOT* DO is mount the 3D runtime. The character costs 5.7 MB of
 * assets plus ~945 kB of three.js, and two of those assets cannot be shrunk:
 * the glb must not be quantized (`riders.ts` overwrites node TRS, so the
 * de-quantisation transform is destroyed) and the SDF atlas must stay 16-bit
 * (the eye shader's edge band is 0.0035 wide, narrower than one 8-bit step).
 * Paying that on every cold load, on every page, for a button nobody has
 * clicked, is not a trade worth making.
 *
 * So the button is a cheap 2D stand-in that warms the real runtime on intent —
 * pointer-enter or touch — and the live character takes over during the
 * chat-open transition, which is already a big animated moment and hides the
 * handoff.
 *
 * The stand-in is CSS, not a sprite sheet, for now. A sprite rendered from the
 * real rig is the better answer and is a separate commit: it needs an
 * owner-run script with a GPU, since CI has no GL and `vite build` has no
 * WebGL context. What is here reads as "him" — the silhouette, the brand hues,
 * the idle bob and the doze — without pretending to be a render.
 *
 * ── IT IS NOW LOAD-BEARING, NOT DECORATION ───────────────────────────────────
 *
 * The character used to be fetched on an idle timer, so by the time anyone
 * pressed this the runtime was usually already in memory and the button's only
 * job was to look like him. That timer is gone (see `DeckeHost`): he downloads
 * on intent and on nothing else.
 *
 * A phone has no hover, and `touchstart` beats `click` by about 100 ms — so on
 * a phone this button is now the ONLY thing standing between the tap and the
 * character's arrival, for as long as seven megabytes take. That is a
 * deliberate trade, and the whole of it lands here: **the chip must read as
 * "coming", never as "broken", and must not look stalled on a slow link.**
 *
 * Three decisions follow from that, and each of them was a bug waiting to be
 * written the other way:
 *
 *  1. **It does not unmount the moment the chat opens.** It used to, which
 *     would have made the loading state a 100 ms flash and left the panel
 *     standing empty for the rest of the download. It now stays until the
 *     character is genuinely ready to take over.
 *  2. **It rises above the overlay while it is standing in.** The phone scrim
 *     is `z-[24]` and the panel `z-[25]`, against this button's usual
 *     `--z-chrome: 20` — so a chip left at its resting depth would spend the
 *     entire wait invisible underneath the thing it is covering for. It goes to
 *     `z-[26]`, under the character's own canvas at `z-30`, which is exactly
 *     the place the character is about to appear.
 *  3. **A load that FAILS says so here, and offers the way back.** Making the
 *     wait visible makes the failure visible; before, a failed load happened in
 *     the background and nobody was waiting on it. A spinner that never resolves
 *     is a dead end, and a dead end that needs a page reload is the failure mode
 *     this pass exists to remove.
 */
import { useEffect, useRef, useState } from 'react'

export function DeckeButton({
  onOpen,
  onWarm,
  onRetry,
  hidden,
  loading = false,
  failed = false,
  overChat = false,
}: {
  onOpen: () => void
  /** Called on first hover/touch so the runtime can start downloading. */
  onWarm: () => void
  /** Try the download again after it failed. */
  onRetry?: () => void
  hidden: boolean
  /** The runtime is downloading right now. */
  loading?: boolean
  /** The runtime failed to download. */
  failed?: boolean
  /** The chat is open and this chip is standing in for the absent character. */
  overChat?: boolean
}) {
  const warmed = useRef(false)
  const [dozing, setDozing] = useState(false)

  // "He dozes off now and then." A long, irregular cycle rather than a metronome
  // — a predictable blink-every-8s reads as a loading spinner, not a character.
  //
  // NOT WHILE HE IS ON HIS WAY. A chip that closes its eyes halfway through a
  // seven-megabyte download is the single clearest way to make "coming" read as
  // "broken", and the doze timer is irregular by design, so it would happen
  // sometimes and not others — the worst kind of bug to be told about.
  useEffect(() => {
    if (hidden || loading || failed) {
      setDozing(false)
      return
    }
    let timer: number
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        setDozing((d) => {
          const next = !d
          // Awake for 12-30s, asleep for 4-9s.
          schedule(next ? 4000 + Math.random() * 5000 : 12000 + Math.random() * 18000)
          return next
        })
      }, delay)
    }
    schedule(14000 + Math.random() * 10000)
    return () => window.clearTimeout(timer)
  }, [hidden, loading, failed])

  const warm = () => {
    if (warmed.current) return
    warmed.current = true
    onWarm()
  }

  if (hidden) return null

  const press = () => {
    if (failed) {
      // A retry has to clear the latch as well as ask again, or the second
      // attempt never starts: `warmed` exists to make `onWarm` fire once, and
      // after a failure firing it once more is the entire point.
      warmed.current = false
      onRetry?.()
      return
    }
    // Belt and braces on the warm. In practice a click is always preceded by a
    // pointer-enter, a touch-start or a focus — but "in practice" is doing real
    // work in that sentence, and a click that opens the panel without having
    // started the download leaves the panel waiting on nothing at all.
    warm()
    onOpen()
  }

  return (
    <button
      type="button"
      onClick={press}
      onPointerEnter={warm}
      onTouchStart={warm}
      onFocus={warm}
      // THE ACCESSIBLE NAME DOES NOT CHANGE WHILE HE IS LOADING, and that is
      // deliberate rather than lazy. A control that renames itself mid-task is
      // hard to follow with a screen reader and impossible to address reliably
      // in automation — both the gate suite and the visual harness find this
      // button by exactly this string. `aria-busy` is the attribute that means
      // "this control is working", so it is the one used.
      aria-label={failed ? 'Deck-E could not load — try again' : 'Chat with Deck-E'}
      aria-busy={loading || undefined}
      className={[
        'group fixed bottom-[20px] right-[20px]',
        // Above the phone scrim (24) and panel (25) while standing in for the
        // character, who will appear on the canvas above at 30. At rest, back
        // down to ordinary page chrome.
        overChat ? 'z-[26]' : 'z-(--z-chrome)',
        'flex h-[56px] w-[56px] items-center justify-center rounded-full',
        'border border-border-default bg-surface-raised shadow-lg',
        'transition-transform duration-200 hover:scale-[1.06] active:scale-95',
        'motion-safe:animate-[decke-button-in_320ms_cubic-bezier(0.2,0.9,0.3,1)_both]',
        loading ? 'decke-button--waking' : '',
        failed ? 'decke-button--failed' : '',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'decke-chip',
          failed ? 'decke-chip--failed' : '',
          loading ? 'decke-chip--wake' : '',
          dozing ? 'decke-chip--doze' : '',
          // The bob is his resting idle. It keeps running while he loads —
          // a chip that goes rigid the instant you tap it reads as a freeze,
          // which is the exact impression the sweep exists to prevent.
          dozing || failed ? '' : 'motion-safe:animate-[decke-bob_3200ms_ease-in-out_infinite]',
        ].join(' ')}
      >
        {/* The deck box: a rounded body, two eyes, a mouth line. Recognisably
            him at 32px without loading a megabyte to say so. */}
        <span className="decke-chip__eye decke-chip__eye--l" />
        <span className="decke-chip__eye decke-chip__eye--r" />
        <span className="decke-chip__mouth" />
      </span>
    </button>
  )
}
