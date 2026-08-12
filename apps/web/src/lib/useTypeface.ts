import { useEffect, useState } from 'react'
import { readTypeface, type Typeface } from './typeface'

/** React view of the typeface attribute — used only by the dev toggle. */
export function useTypeface(): Typeface {
  const [t, setT] = useState<Typeface>(() => readTypeface())
  useEffect(() => {
    const onChange = (e: Event) => setT((e as CustomEvent<Typeface>).detail)
    window.addEventListener('deckscout:typefacechange', onChange)
    return () => window.removeEventListener('deckscout:typefacechange', onChange)
  }, [])
  return t
}
