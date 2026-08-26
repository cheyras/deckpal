import { useState } from 'react'
import { directArtUrl } from './cardArt'

/**
 * The two-source ladder from `cardArt.ts`, for the image slots that are not card
 * art: species sprites (~320 on one Pokédex screen) and set logos/symbols.
 *
 * Same shape as `CardImage` implements inline: try the public object URL first,
 * fall back to `/deckpal/images/…` — which fills a cold asset and answers the
 * placeholder — and only then report failure to the caller, which decides what a
 * missing asset should look like (a hidden logo, a Poké-ball glyph, a skeleton).
 *
 * `CardImage` does not use this hook because it also has to swap a `srcSet` pair
 * in step with `src`; keeping that one inline is clearer than a hook that returns
 * four things two callers ignore.
 */
export interface ArtSrc {
  /** What to put on the <img>. Null once both sources have failed. */
  src: string | null
  /** Present only on the direct source, so the SW caches a real response. */
  crossOrigin?: 'anonymous'
  /** Advances to the next source, or reports failure once there is none left. */
  onError: () => void
  /** True once every source has failed — render your own fallback. */
  failed: boolean
  /** Changes when the source does, so callers can key the element on it. */
  step: number
}

export function useArtSrc(path: string): ArtSrc {
  const direct = directArtUrl(path)
  const [step, setStep] = useState(direct ? 0 : 1)

  // Derived-state reset — these components are recycled across list items.
  const [seen, setSeen] = useState(path)
  if (seen !== path) {
    setSeen(path)
    setStep(direct ? 0 : 1)
  }

  const failed = step > 1
  return {
    src: failed ? null : step === 0 ? direct : path,
    ...(step === 0 ? { crossOrigin: 'anonymous' as const } : {}),
    onError: () => setStep((s) => s + 1),
    failed,
    step,
  }
}
