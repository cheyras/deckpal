/**
 * The route the server picked for this turn, echoed back on its continuation
 * legs.
 *
 * The first leg of a turn is triaged (Haiku names the pathway, code picks the
 * tier and effort) and the server streams the result as a transient
 * `data-decke-route` part. Every later leg of the SAME turn — an approval
 * answer, a browser tool's result, a reserved approval leg — carries it back as
 * `tierRoute` in the POST body, so the server continues on the tier it chose
 * instead of triaging the half-finished turn again.
 *
 * Never on a new reader message: a new message is a new request and is routed
 * fresh. The hook keeps the echo in a per-turn variable, so a new send starts
 * without one by construction.
 *
 * `tierRoute`, not `route`: the body's `route` is the page path the reader is
 * on, and the server reads it for the prompt.
 */
export type TierRoute = {
  tier: 'quick' | 'standard'
  pathways: string[]
  effort: 'low' | 'medium' | 'high'
}

const TIERS = new Set(['quick', 'standard'])
const EFFORTS = new Set(['low', 'medium', 'high'])
/** Pathway names are snake_case identifiers (`deck_build`, `battle_review`). */
const PATHWAY = /^[a-z][a-z0-9_]{0,39}$/
/**
 * One or two, distinct — the server's own echo schema (`readRouteEcho` in
 * `apps/api/src/decke/routeEcho.ts`), which re-checks every name against its
 * pathway list and re-triages on anything it refuses. Matching it here means
 * the browser never carries an echo the server would throw away.
 */
const MAX_PATHWAYS = 2

/**
 * The streamed part's `data`, validated, or null.
 *
 * Rebuilt rather than passed through, so nothing the stream added beyond the
 * three fields can ride along into the next request.
 */
export function readTierRoute(data: unknown): TierRoute | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { tier, pathways, effort } = data as Record<string, unknown>
  if (typeof tier !== 'string' || !TIERS.has(tier)) return null
  if (typeof effort !== 'string' || !EFFORTS.has(effort)) return null
  if (!Array.isArray(pathways) || pathways.length < 1 || pathways.length > MAX_PATHWAYS) return null
  if (!pathways.every((name) => typeof name === 'string' && PATHWAY.test(name))) return null
  if (new Set(pathways).size !== pathways.length) return null
  return {
    tier: tier as TierRoute['tier'],
    pathways: [...pathways] as string[],
    effort: effort as TierRoute['effort'],
  }
}
