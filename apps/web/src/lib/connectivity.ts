/**
 * Pure decision logic for the offline banner's confirmed status (DECISIONS.md
 * 2026-09-26). Kept framework- and fetch-free — no React, no `./api` — so
 * `node --import tsx --test` can exercise every branch directly; see
 * `useConnectivity.ts` for the thin layer that wires this to real browser
 * events and the reachability probe in `lib/api.ts`.
 *
 * ── WHY A HINT ISN'T A VERDICT ────────────────────────────────────────────────
 *
 * `navigator.onLine` reports link state, not reachability. Observed false:
 * the iOS Simulator reports it `false` while every fetch succeeds — the
 * banner said "Offline" over a working connection and never corrected itself,
 * because nothing ever asked it to. It can also report `true` on a captive
 * portal or a VPN mid-handshake. A banner that repeats a wrong hint erodes
 * trust in every other status the app shows, so every transition is
 * CONFIRMED with a cheap same-origin probe before the displayed state moves:
 *
 *   probe settled  → the round trip completed — PROBE WINS outright, in
 *                     either direction, over a hint that has no comparable
 *                     evidence behind it.
 *   probe errored  → a real network failure (not a timeout): the request
 *                     could not even leave the browser. That is stronger
 *                     evidence than a stale `navigator.onLine === true`, so
 *                     this reports OFFLINE regardless of the hint.
 *   probe timed out → INCONCLUSIVE. A slow response proves nothing either
 *                     way — flipping the banner on it would trade "wrong
 *                     hint" for "wrong on a slow network" — so this falls
 *                     back to the hint rather than guessing.
 */
export type ProbeOutcome = 'settled' | 'timed-out' | 'errored'

/** Confirmed offline state for the given hint + probe outcome. See the table above. */
export function deriveOffline(hintOffline: boolean, probe: ProbeOutcome): boolean {
  if (probe === 'settled') return false
  if (probe === 'errored') return true
  return hintOffline
}
