import { useSyncExternalStore } from 'react'

/**
 * The app's one transient message: a save that failed, or a destructive change
 * that can still be undone. Rendered by `Toaster` (components/ui/Toast.tsx).
 *
 * One at a time, newest wins. Two toasts stacked up are two messages nobody
 * reads, and the newest is always about the thing the person just did.
 * Kept out of React, like pwa.ts, so a write that settles after its page has
 * unmounted can still report.
 */
export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  /** `error` is announced assertively and stays up longer. */
  tone: 'error' | 'info'
  message: string
  action?: ToastAction
}

let current: Toast | null = null
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

export function showToast(toast: Omit<Toast, 'id'>): number {
  current = { ...toast, id: nextId++ }
  emit()
  return current.id
}

/** Dismiss the toast with this id — or whatever is showing, without one. A stale
 *  id is ignored, so a timer can never close the toast that replaced its own. */
export function dismissToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return
  current = null
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useToast(): Toast | null {
  return useSyncExternalStore(subscribe, () => current, () => null)
}
