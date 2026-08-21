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
 */
import { useEffect, useRef, useState } from 'react'

export function DeckeButton({
  onOpen,
  onWarm,
  hidden,
}: {
  onOpen: () => void
  /** Called on first hover/touch so the runtime can start downloading. */
  onWarm: () => void
  hidden: boolean
}) {
  const warmed = useRef(false)
  const [dozing, setDozing] = useState(false)

  // "He dozes off now and then." A long, irregular cycle rather than a metronome
  // — a predictable blink-every-8s reads as a loading spinner, not a character.
  useEffect(() => {
    if (hidden) return
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
  }, [hidden])

  const warm = () => {
    if (warmed.current) return
    warmed.current = true
    onWarm()
  }

  if (hidden) return null

  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={warm}
      onTouchStart={warm}
      onFocus={warm}
      aria-label="Chat with Deck-E"
      className={[
        'group fixed bottom-[20px] right-[20px] z-(--z-chrome)',
        'flex h-[56px] w-[56px] items-center justify-center rounded-full',
        'border border-border-default bg-surface-raised shadow-lg',
        'transition-transform duration-200 hover:scale-[1.06] active:scale-95',
        'motion-safe:animate-[decke-button-in_320ms_cubic-bezier(0.2,0.9,0.3,1)_both]',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'decke-chip',
          dozing ? 'decke-chip--doze' : 'motion-safe:animate-[decke-bob_3200ms_ease-in-out_infinite]',
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
