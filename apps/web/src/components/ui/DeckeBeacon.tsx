/**
 * The off-screen beacon chip — the DOM half of `character/decke/beacon.ts`.
 *
 * The character keeps scrolling with the element he is presenting, so he can
 * leave the viewport with it. This is what says he is still there and where:
 * "if he goes off the screen, I was thinking we'd give him a small indicator,
 * like they do in Smash Bros... it's actually pointing at where he is, and it
 * shows what he's actually doing in here."
 *
 * IT IS A HOLE, NOT A PICTURE. The chip draws a ring, a pointer and a backdrop,
 * and nothing in the middle — the character himself is rendered into that
 * rectangle by the WebGL canvas, which sits ABOVE this layer (z-30 against
 * z-25, the same stacking `elementHighlight.ts` uses). So the chip is page
 * chrome and the thing inside it is the live scene; that is what makes it show
 * what he is actually doing rather than a frozen icon.
 *
 * The border is the same three brand hues as the highlight ring, read from the
 * design tokens for the same reason — but STATIC rather than chasing. The ring
 * says "something is happening at this element" and has to catch the eye; the
 * beacon says "he is over there" and must not. Same family, different volume.
 *
 * NO GALLERY ENTRY, DELIBERATELY, and its neighbours in this folder all have
 * one. `HighlightRing` is a design-system primitive — anything that needs to say
 * *this element* can use it, and the gallery is how someone finds that out. This
 * is not: it is one half of a character feature, and the half that matters is
 * drawn by a WebGL canvas that only exists on the character's route. A gallery
 * card for it would show an empty ring pinned to the corner of the design page,
 * which would teach the reader something false about what it is.
 */
import { useEffect, useRef } from 'react'
import { BEACON, beaconRect, type Beacon } from '../../character/beacon'

export type DeckeBeaconProps = {
  /** Null when he is on screen, which is when there is nothing to draw. */
  beacon: Beacon | null
  /** Bring him back. The controller does the scrolling; see
   *  `DeckE.scrollIntoView`. */
  onClick: () => void
  className?: string
}

export function DeckeBeacon({ beacon, onClick, className }: DeckeBeaconProps) {
  const ref = useRef<HTMLButtonElement | null>(null)

  // The hues come from the tokens rather than from three hex literals, so the
  // chip restyles with the theme. Same three the highlight ring sweeps: brand
  // primary is cyan, secondary is rose, tertiary is amber — read one step
  // lighter, because amber-400 drops out against this surface.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const css = getComputedStyle(document.documentElement)
    const hue = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback
    el.style.setProperty('--decke-hue-1', hue('--color-brand-primary-400', '#00d3f3'))
    el.style.setProperty('--decke-hue-2', hue('--color-brand-secondary-400', '#fb64b6'))
    el.style.setProperty('--decke-hue-3', hue('--color-brand-tertiary-300', '#ffd230'))
  }, [beacon !== null])

  if (!beacon) return null
  const top = beacon.edge === 'top'
  const s = BEACON.size

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={`Deck-E is off screen ${top ? 'above' : 'below'} — scroll to him`}
      className={
        'pointer-events-auto fixed z-[25] flex items-center justify-center ' +
        (className ?? '')
      }
      style={{
        left: beacon.x,
        // TOP-ANCHORED, FROM `beaconRect`, NEVER CSS `bottom`.
        //
        // `beaconRect` is what the renderer draws the inset at, and its comment
        // says "one function so the two can never disagree by a pixel" — which
        // stopped being true the moment the canvas was pinned to `100svh`. A
        // `fixed` element's `bottom` resolves against the LAYOUT viewport, which
        // on an iPhone is the large one; the canvas is the small one. With
        // Safari's toolbar hidden, that is 82px of daylight between the hole in
        // the chip and the character drawn into it, and no way to close it —
        // the canvas ends above where the chip is. Top-anchored, both come from
        // `viewHeight()` and the claim in that comment holds again.
        top: beaconRect(beacon).y,
        width: s,
        height: s,
        transform: 'translateX(-50%)',
        // A hairline of the three hues, and a surface behind him so he reads
        // against whatever the page happens to be showing there.
        borderRadius: '9999px',
        background:
          'radial-gradient(circle at 50% 38%, var(--color-surface-raised, #2a2724) 0%, var(--color-surface-primary, #1b1917) 100%)',
        boxShadow:
          '0 0 0 1.5px color-mix(in srgb, var(--decke-hue-1) 70%, transparent), 0 6px 18px rgb(0 0 0 / 0.35)',
        // The pointer is part of the chip, drawn outside it — "I would make this
        // triangle here be part of the thing, but it's actually pointing at
        // where he is."
        ...(top
          ? { marginTop: 0 }
          : { marginBottom: 0 }),
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          // IT POINTS AT HIM, not away from the edge. He is past the top when
          // the chip is pinned to the top, so the pointer goes ABOVE the chip
          // and points up. Getting this the natural-looking way round — arrow on
          // the far side from the edge — aims it at the middle of the page,
          // which is the one place he is not.
          [top ? 'top' : 'bottom']: -BEACON.arrow,
          width: 0,
          height: 0,
          borderLeft: `${BEACON.arrow - 1}px solid transparent`,
          borderRight: `${BEACON.arrow - 1}px solid transparent`,
          ...(top
            ? { borderBottom: `${BEACON.arrow}px solid var(--decke-hue-2)` }
            : { borderTop: `${BEACON.arrow}px solid var(--decke-hue-2)` }),
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: -2,
          borderRadius: '9999px',
          padding: 2,
          background:
            'conic-gradient(from 210deg, var(--decke-hue-1), var(--decke-hue-2), var(--decke-hue-3), var(--decke-hue-1))',
          // A ring, not a disc: the middle has to stay clear for the canvas to
          // draw him into.
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          maskComposite: 'exclude',
          opacity: 0.85,
        }}
      />
    </button>
  )
}
