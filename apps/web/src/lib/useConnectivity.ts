import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { deriveOffline, type ProbeOutcome } from './connectivity'

/** Past this, a hung probe proves nothing — see `connectivity.ts`'s
 *  "timed out" branch — so the caller stops waiting and falls back to the hint. */
const PROBE_TIMEOUT_MS = 3000

/**
 * While CONFIRMED offline, re-probe on this cadence rather than waiting for
 * another `online`/`offline`/`focus` event. A transient probe failure (a
 * dropped request, a server blip) with `navigator.onLine` staying `true` the
 * whole time fires none of those three — a focused tab that never loses
 * link-layer connectivity gets no event at all — so without this the banner
 * would show "Offline." forever after one bad request on an otherwise-fine
 * connection (Astra review, 2026-09-26). Self-limiting: only scheduled while
 * `offline` is true, and cancelled the moment a check clears it — never runs
 * at all on the common healthy path, so this is not the polling the rest of
 * this hook deliberately avoids.
 */
export const RETRY_WHILE_OFFLINE_MS = 5000

async function probe(): Promise<ProbeOutcome> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  try {
    await api.ping(signal)
    return 'settled'
  } catch {
    return signal.aborted ? 'timed-out' : 'errored'
  }
}

/**
 * Confirmed offline state for the offline banner ONLY — `lib/useOnline.ts`
 * stays the raw hint for the collection-write gate (CardDetail, CardTile,
 * TableView), which wants "offline → disable, online → let it try and
 * surface any real error" and is fine with an occasional false disable. The
 * banner makes a claim ("Offline.") the write-gate never does, so it earns
 * the extra round trip; see `connectivity.ts` for the decision table.
 *
 * Event-driven on the healthy path — mount, `online`, `offline`, window
 * regaining `focus` — so this costs nothing while the tab sits idle online.
 * The one exception is a bounded self-retry while CONFIRMED offline (see
 * `RETRY_WHILE_OFFLINE_MS`), which stops the instant a check clears it. A
 * `generation` counter drops a superseded probe's result rather than letting
 * a slow one win a race against a newer check — the flap protection: rapid
 * on/off/on only ever lands on the LATEST settled answer.
 */
export function useConnectivity(): boolean {
  const [offline, setOffline] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    let disposed = false
    let retryTimer: number | null = null
    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }
    const check = () => {
      const hintOffline = !navigator.onLine
      const gen = ++generation.current
      void probe().then((outcome) => {
        if (disposed || gen !== generation.current) return // superseded by a newer check
        const nextOffline = deriveOffline(hintOffline, outcome)
        setOffline(nextOffline)
        clearRetry()
        // See RETRY_WHILE_OFFLINE_MS: only self-schedules while confirmed
        // offline, so recovery doesn't depend on another browser event firing.
        if (nextOffline) retryTimer = window.setTimeout(check, RETRY_WHILE_OFFLINE_MS)
      })
    }
    check()
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    window.addEventListener('focus', check)
    return () => {
      disposed = true
      clearRetry()
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  return offline
}
