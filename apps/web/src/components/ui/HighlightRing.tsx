/**
 * HighlightRing — the declarative half of `elementHighlight.ts`.
 *
 * Wrap something and set `active` to ring it: "this is the element being talked
 * about". The chasing multi-hue edge is deliberately unlike every other border
 * treatment in the system — focus, selection, error and hover are all static —
 * so it reads as *something is happening here* rather than as a state the user
 * put the element into.
 *
 * Use this when the thing to ring is in your own tree. When it is not — an agent
 * holding a CSS selector, a tour step pointing at page chrome you do not own —
 * call `highlightElement()` from `elementHighlight.ts` directly; the imperative
 * form is the primary one and this is a thin wrapper over it.
 *
 * Only ONE element is ringed at a time, application-wide. Two rings read as a
 * multi-select, which is a different idea, and the singleton is enforced in the
 * imperative layer rather than by convention here.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { clearHighlight, highlightElement, highlighted } from './elementHighlight'

export interface HighlightRingProps {
  /** Ring the wrapped element. Setting it false releases the ring. */
  active: boolean
  /** Release automatically after this long. */
  durationMs?: number
  /** Corner radius in px. Defaults to the wrapped element's own. */
  radius?: number
  className?: string
  children: ReactNode
}

export function HighlightRing({
  active,
  durationMs,
  radius,
  className,
  children,
}: HighlightRingProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (active) {
      highlightElement(el, { durationMs, radius })
    } else if (highlighted() === el) {
      // Only release OUR ring. Another element may have claimed the singleton in
      // between, and stealing its release is how one component's unmount blanks
      // a highlight some other part of the page is still relying on.
      clearHighlight()
    }
    return () => {
      if (highlighted() === el) clearHighlight()
    }
  }, [active, durationMs, radius])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
