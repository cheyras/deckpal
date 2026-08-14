/**
 * useDismiss — outside-click + Escape dismissal hook.
 *
 * Returns a ref to attach to the wrapper element. While `open` is true,
 * mousedown outside the wrapper or pressing Escape calls `onClose`.
 *
 * Usage:
 *   const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false))
 *   return <div ref={ref}>…</div>
 */
import { useEffect, useRef, type RefObject } from 'react'

export function useDismiss<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
): RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return ref
}
