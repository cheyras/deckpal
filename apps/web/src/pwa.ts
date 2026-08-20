// PWA client wiring: SW registration, iOS-eviction mitigation, and the update
// signal that PwaUi renders as a toast. Kept out of React so main.tsx can fire it
// once on load, independent of the router mounting.
import { registerSW } from 'virtual:pwa-register'

type Listener = () => void
const refreshListeners = new Set<Listener>()
let updateSW: ((reload?: boolean) => Promise<void>) | null = null

/** True once the SW has a waiting update ready to activate. */
export let needRefresh = false

/** Subscribe to update-available changes (returns an unsubscribe fn). */
export function onNeedRefresh(l: Listener): () => void {
  refreshListeners.add(l)
  return () => refreshListeners.delete(l)
}

/** Accept the pending update: activate the waiting SW and reload. */
export function applyUpdate(): void {
  void updateSW?.(true)
}

/** How long to wait for a newly-installed worker to reach `waiting`. Past this
 *  the caller reloads anyway: a plain reload is still the right move, it just
 *  may need a second one. */
const ACTIVATE_TIMEOUT_MS = 4000

/**
 * Pull the newest service worker forward, without waiting to be asked.
 *
 * `applyUpdate` is the polite path — it activates a worker that is ALREADY
 * waiting, because the user pressed the toast. This is the unpolite one, for
 * when the running shell has demonstrably gone stale (see `lib/lazyRoute.ts`):
 * check the server for a new `sw.js` first, then skip the wait.
 *
 * It resolves rather than reloading, so the caller decides — the caller is
 * already reloading and a second one from here would be a race.
 */
export async function activateLatest(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return
    // Fetches sw.js; if the deploy changed it, this installs a new worker and
    // parks it in `waiting`.
    await reg.update()
    const waiting = reg.waiting ?? (await waitForWaiting(reg))
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' })
      // The controller changes once the new worker takes over; from that moment
      // a navigation gets the NEW precached shell, which is the whole point.
      const took = await new Promise<'changed' | 'timeout'>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve('changed'), {
          once: true,
        })
        setTimeout(() => resolve('timeout'), ACTIVATE_TIMEOUT_MS)
      })
      if (took === 'changed') return
    }
    // NO NEW WORKER, OR IT WOULD NOT COME FORWARD. Reloading now would be served
    // the same stale shell by the same worker and fail exactly as before, so the
    // caller's one retry would be spent on a certainty. Unregistering makes the
    // next navigation go to the network, which is the only thing guaranteed to
    // be current; `registerPwa` puts the worker back on the very next load, so
    // the cost is one cold cache rather than a lost offline mode.
    await reg.unregister()
  } catch {
    // Nothing here is worth blocking a reload over.
  }
}

function waitForWaiting(reg: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
  return new Promise((resolve) => {
    const installing = reg.installing
    if (!installing) return resolve(null)
    const t = setTimeout(() => resolve(reg.waiting ?? null), ACTIVATE_TIMEOUT_MS)
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        clearTimeout(t)
        resolve(reg.waiting ?? null)
      }
    })
  })
}

function emitRefresh(): void {
  needRefresh = true
  refreshListeners.forEach((l) => l())
}

// iOS ITP evicts all script-writable storage + the SW after 7 days without user
// interaction (wiki: Frontend-Research §C.4). Home-Screen install and persistent-storage grant
// are the two documented escapes; we use both because neither is sufficient alone.
// The brief asks for persist() on load, so we ask immediately; iOS grants it more
// readily once running standalone, so we re-ask on the first standalone launch too.
async function requestPersistence(): Promise<void> {
  if (!navigator.storage?.persist) return
  try {
    if (await navigator.storage.persisted()) return
    const granted = await navigator.storage.persist()
    // If false, the offline cache is best-effort; PwaUi's offline copy stays honest
    // about that rather than promising durability we can't guarantee.
    if (import.meta.env.DEV) console.info('[pwa] storage.persist() →', granted)
  } catch {
    /* not fatal — offline still works, just without an eviction guarantee */
  }
}

export function registerPwa(): void {
  if (!('serviceWorker' in navigator)) return
  updateSW = registerSW({
    onNeedRefresh: emitRefresh,
    onOfflineReady: () => {
      if (import.meta.env.DEV) console.info('[pwa] app shell cached — offline ready')
    },
  })
  void requestPersistence()
}
