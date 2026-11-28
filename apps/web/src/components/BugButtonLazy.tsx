import { lazy, Suspense } from 'react'
import type { BugButtonProps } from './BugReport'

/**
 * The bug reporter, loaded off the critical path.
 *
 * `BugReport` renders its form in the `Modal` from ListModals, which carries the whole Sheet stack
 * (drag-to-dismiss physics, scroll edge, close control). The header shows the button to every
 * signed-in user, so a static import put all of that in front of the first paint — over the
 * critical-path budget once the sheet gained its gesture. The button now arrives with its own
 * chunk a moment after the header; until then nothing renders in its slot.
 *
 * `import type` above is erased at build, so nothing here pulls BugReport into the entry chunk.
 */
const BugButtonImpl = lazy(() => import('./BugReport').then((m) => ({ default: m.BugButton })))

export function BugButton(props: BugButtonProps) {
  return (
    <Suspense fallback={null}>
      <BugButtonImpl {...props} />
    </Suspense>
  )
}
