import { useSyncExternalStore } from 'react'
import { canAttemptWrite, subscribeConnectivity } from './connectivity'

// Only confirmed offline disables the counters. Unknown lets a write try; its
// lane reports a save or rolls back and explains the real failure.
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeConnectivity,
    canAttemptWrite,
    () => true, // SSR/first paint: assume online
  )
}
