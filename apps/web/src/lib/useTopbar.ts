import { useEffect, useState } from 'react'
import { readTopbar, type Topbar } from './topbar'

/** React view of the top-bar attribute — used only by the dev toggle. */
export function useTopbar(): Topbar {
  const [t, setT] = useState<Topbar>(() => readTopbar())
  useEffect(() => {
    const onChange = (e: Event) => setT((e as CustomEvent<Topbar>).detail)
    window.addEventListener('deckpal:topbarchange', onChange)
    return () => window.removeEventListener('deckpal:topbarchange', onChange)
  }, [])
  return t
}
