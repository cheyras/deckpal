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
