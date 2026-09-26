import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { deriveOffline, type ProbeOutcome } from './connectivity'

/** Past this, a hung probe proves nothing — see `connectivity.ts`'s
 *  "timed out" branch — so the caller stops waiting and falls back to the hint. */
const PROBE_TIMEOUT_MS = 3000

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
 * Event-driven only — mount, `online`, `offline`, window regaining `focus` —
 * never a poll, so this costs nothing while the tab sits idle either online
 * or off. A `generation` counter drops a superseded probe's result rather
 * than letting a slow one win a race against a newer check — the flap
 * protection: rapid on/off/on only ever lands on the LATEST settled answer.
 */
export function useConnectivity(): boolean {
  const [offline, setOffline] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    let disposed = false
    const check = () => {
      const hintOffline = !navigator.onLine
      const gen = ++generation.current
      void probe().then((outcome) => {
        if (disposed || gen !== generation.current) return // superseded by a newer check
        setOffline(deriveOffline(hintOffline, outcome))
      })
    }
    check()
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    window.addEventListener('focus', check)
    return () => {
      disposed = true
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  return offline
}
