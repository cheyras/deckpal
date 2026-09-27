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
