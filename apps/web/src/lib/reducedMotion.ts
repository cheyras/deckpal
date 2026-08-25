/**
 * `prefers-reduced-motion`, asked the same way everywhere.
 *
 * One probe for the app-layer callers (Sheet, Landing, GridView), keeping the
 * most defensive of the copies it replaced: `window` is absent during SSR-ish
 * tooling, `matchMedia` is absent under test and in some embedded webviews, so
 * the whole read is wrapped and optional-chained. Erring toward the animation
 * (`false`) on failure matches every caller in this app.
 *
 * The character/ layer keeps its own copies on purpose — see the rationale in
 * DeckeChat's `prefersReducedMotion` for why it stays private there.
 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return false
  }
}
