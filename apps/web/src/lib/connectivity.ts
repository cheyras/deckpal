/**
 * Shared reachability result for the offline banner and write gate.
 * `navigator.onLine` reports link state, not server reachability: iOS can
 * report false while requests succeed. Only a failed same-origin probe
 * confirms offline. A timeout is inconclusive, so writes try and report their
 * real outcome while the banner makes no offline claim.
 */
export type ProbeOutcome = 'settled' | 'timed-out' | 'errored'

// The banner and write gate share the latest probe result. A pending or timed
// out check cannot prove the browser is offline, so writes are allowed to try.
export type Connectivity = 'online' | 'offline' | 'unknown'
let connectivity: Connectivity = 'unknown'
const listeners = new Set<() => void>()

export function getConnectivity(): Connectivity { return connectivity }
export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function setConnectivity(outcome: ProbeOutcome | 'pending'): void {
  const next = outcome === 'settled' ? 'online' : outcome === 'errored' ? 'offline' : 'unknown'
  if (next === connectivity) return
  connectivity = next
  for (const listener of listeners) listener()
}

export function canAttemptWrite(): boolean { return connectivity !== 'offline' }

/** Only a failed reachability probe confirms an outage. */
export function deriveOffline(probe: ProbeOutcome): boolean { return probe === 'errored' }

// ── HOW OFTEN TO ASK (owner session 2026-11-27) ─────────────────────────────
//
// The probe is `GET /api/me` with no credentials on purpose (api.ts
// `pingReachable`), so every one of them is a 401 in a network trace — and the
// owner's scan session showed them again and again on /decks and /scan, which
// reads as a signed-out polling loop. It was not a loop on the 401; it was the
// hook asking on EVERY window `focus`, which iOS fires each time the page gets
// the screen back (a permission sheet, a native picker, the app switcher), plus
// a flat 5s re-ask while offline. A probe that settled a moment ago answers the
// question a focus asks, so a focus only re-asks once the last answer is stale,
// and while offline the re-asks back off.

/** A focus re-probes only if the last settled answer is older than this. */
export const FOCUS_RECHECK_MS = 60_000

/** Should a window `focus` probe again? Not while one is in flight, and not if
 *  a probe reached the server within `FOCUS_RECHECK_MS`. Anything less than a
 *  reachable answer (offline, timed out, never asked) is always worth a retry. */
export function shouldProbeOnFocus(last: { outcome: ProbeOutcome; at: number } | null, inFlight: boolean, now: number): boolean {
  if (inFlight) return false
  if (!last || last.outcome !== 'settled') return true
  return now - last.at >= FOCUS_RECHECK_MS
}

/** While confirmed offline: 5s, 10s, 20s, 40s, then every 60s. */
export function offlineRetryDelay(attempt: number, base = 5000, cap = 60_000): number {
  return Math.min(cap, base * 2 ** Math.max(0, attempt))
}
