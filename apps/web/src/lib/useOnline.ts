import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

// navigator.onLine is a coarse signal (it reports link state, not reachability),
// but it's the right hint for "should we let the user attempt a collection write":
// offline → disable, online → let it try and surface any real error.
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true, // SSR/first paint: assume online
  )
}
