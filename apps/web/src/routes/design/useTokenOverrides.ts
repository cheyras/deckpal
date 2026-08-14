/**
 * Token-override store: holds live CSS custom-property overrides that
 * propagate instantly to every var() consumer in the app.
 *
 * Overrides are applied via document.documentElement.style.setProperty()
 * and removed via removeProperty(). Because inline styles on the root
 * element out-specify :root-level declarations, every var() reference
 * re-resolves immediately without any build step.
 *
 * The store is ephemeral — nothing persists unless explicitly saved via
 * the /__design/tokens/apply endpoint. Reset clears overrides; disk was
 * never touched.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

export interface TokenOverrideStore {
  /** Current overrides: tokenName -> overrideValue */
  overrides: Map<string, string>
  /** Number of active overrides */
  count: number
  /** Set an override for a single token */
  set: (name: string, value: string) => void
  /** Remove the override for a single token (disk value shows through) */
  reset: (name: string) => void
  /** Clear all overrides */
  resetAll: () => void
  /** Called after a successful save — removes the override since disk now matches */
  savedAck: (name: string) => void
  /** Check if a specific token has an active override */
  has: (name: string) => boolean
  /** Get the override value for a token (undefined if not overridden) */
  get: (name: string) => string | undefined
}

export function useTokenOverrides(): TokenOverrideStore {
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map())
  const prevRef = useRef<Map<string, string>>(new Map())

  // Sync overrides to the DOM: setProperty for new/changed, removeProperty for removed
  useEffect(() => {
    const prev = prevRef.current
    const root = document.documentElement

    // Apply new/changed overrides
    for (const [name, value] of overrides) {
      if (prev.get(name) !== value) {
        root.style.setProperty(name, value)
      }
    }

    // Remove overrides that were cleared
    for (const name of prev.keys()) {
      if (!overrides.has(name)) {
        root.style.removeProperty(name)
      }
    }

    prevRef.current = new Map(overrides)
  }, [overrides])

  // Clean up all overrides on unmount
  useEffect(() => {
    return () => {
      const root = document.documentElement
      for (const name of prevRef.current.keys()) {
        root.style.removeProperty(name)
      }
    }
  }, [])

  const set = useCallback((name: string, value: string) => {
    setOverrides((prev) => {
      const next = new Map(prev)
      next.set(name, value)
      return next
    })
  }, [])

  const reset = useCallback((name: string) => {
    setOverrides((prev) => {
      const next = new Map(prev)
      next.delete(name)
      return next
    })
  }, [])

  const resetAll = useCallback(() => {
    setOverrides(new Map())
  }, [])

  const savedAck = useCallback((name: string) => {
    // After a successful save, the disk value now matches, so remove the override
    setOverrides((prev) => {
      const next = new Map(prev)
      next.delete(name)
      return next
    })
  }, [])

  const has = useCallback((name: string) => overrides.has(name), [overrides])

  const get = useCallback((name: string) => overrides.get(name), [overrides])

  return {
    overrides,
    count: overrides.size,
    set,
    reset,
    resetAll,
    savedAck,
    has,
    get,
  }
}
