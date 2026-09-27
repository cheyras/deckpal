/** A page-owned request for Deck-E to stand at the import dialog's bay. */
let active = false
const listeners = new Set<() => void>()

export const deckeErrandActive = () => active
export const subscribeDeckeErrand = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function startDeckeErrand(): void {
  if (active) return
  active = true
  listeners.forEach((listener) => listener())
}

export function endDeckeErrand(): void {
  if (!active) return
  active = false
  listeners.forEach((listener) => listener())
}
