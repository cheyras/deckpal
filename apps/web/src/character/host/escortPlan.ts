/**
 * Building the walk, so the model does not have to.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `journey.ts` argues for one-plan-not-four-turns by pointing out that the path
 * is deterministic: "the selectors are constructible from ids the data tools
 * return BEFORE anything moves. Given `seriesSlug: mega-evolution, setId: me05`,
 * the whole path — nav row, series card, set row — can be written down without
 * having seen any of those pages."
 *
 * It then handed that deterministic construction to the model anyway, and the
 * model paid for it: measured, it emits a `journey` 2 times in 10 and describes
 * the destination the other 8, while `goTo` — one route string — measures 100%.
 * The barrier was never willingness. It was that an escort cost it a compiled
 * program and a description cost it two sentences.
 *
 * So this is the twenty lines the header implied. `escort` takes the two ids
 * `search_cards` already returned and this writes the steps.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────
 *
 * **No narration of its own beyond `opener`.** A templated line before every hop
 * would be identical on every walk, and canned warmth is the one thing the
 * research says is worth under half a percent. His own reply carries the rest.
 *
 * **No step list, ever.** A macro that grew one would be `journey` again with
 * extra syntax, and would hand back the compilation cost this exists to remove.
 *
 * **No validation.** The steps are correct by construction; `escortPlan.test.ts`
 * pins that against the server's own schema rather than trusting the claim.
 */
import { JOURNEY_MAX_STEPS, type JourneyStep } from './journey'

/**
 * Mirrors `ADDRESSING_LINES` in `apps/api/src/decke/prompt.ts`, the same way
 * `uiTools.ts` mirrors `CLIENT_TOOLS`: `deckpal-web` does not depend on
 * `deckpal-api`, so the agreement is pinned by a test that reads that source
 * rather than by an import.
 */
export const seriesLandmark = (seriesSlug: string) => `[data-decke-series="${seriesSlug}"]`
export const setLandmark = (setId: string) => `[data-decke-set="${setId}"]`

/**
 * The disclosure every series with nothing collected yet sits behind.
 *
 * For a NEW COLLECTOR that is all of them, which is precisely the reader this
 * walk is for — the cueing evidence says signalling helps low-prior-knowledge
 * users and is redundant for experts. Getting this step wrong therefore fails
 * exactly the person the feature exists to serve, which is why it is
 * unconditional: `ensure` presses only if the landmark is missing, so planning
 * it costs a collector who owns the series nothing.
 */
export const SHOW_OTHERS = '[data-decke-show-others]'

export type EscortInput = { seriesSlug: string; setId?: string; opener?: string }

/**
 * The whole way there, from two ids.
 *
 * `/series` is reached with `goTo` rather than a click because there is no
 * `[data-decke-nav="/series"]` to press — that sidebar row is an expandable
 * parent rendered as a toggle, carrying neither landmark attribute. It is the
 * one hop of an "escort" that cannot be a press, and it is why the prompt's
 * "point at what to press, press it, arrive" needed reconciling.
 */
export function buildEscortSteps({ seriesSlug, setId, opener }: EscortInput): JourneyStep[] {
  const series = seriesLandmark(seriesSlug)
  const steps: JourneyStep[] = []

  const line = opener?.trim()
  if (line) steps.push({ verb: 'say', text: line })

  steps.push({ verb: 'goTo', route: '/series' })
  steps.push({ verb: 'ensure', landmark: series, byClicking: SHOW_OTHERS })
  steps.push({ verb: 'click', landmark: series })

  if (setId) {
    const set = setLandmark(setId)
    // `flyTo` with `point` puts him beside it looking at it; `highlight` is what
    // the reader actually sees ring. Both, because the deixis IS the product —
    // the cueing meta-analyses (d=0.52) measure the pointing, not the mascot.
    steps.push({ verb: 'flyTo', landmark: set, point: true })
    steps.push({ verb: 'highlight', landmark: set })
  }

  // Six steps at the longest. The cap is asserted rather than assumed because a
  // plan over it is refused whole, and this is the one place that could grow.
  if (steps.length > JOURNEY_MAX_STEPS) {
    throw new Error(`escort built ${steps.length} steps, over the ${JOURNEY_MAX_STEPS} cap`)
  }
  return steps
}
