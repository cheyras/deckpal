import { useEffect, useState } from 'react'
import { readSkin, type Skin } from './skin'

/**
 * React view of the skin attribute. Only components that need different
 * *markup* per skin (the animated nav icons) should reach for this — anything
 * expressible in CSS belongs in premium.css under `[data-skin='premium']`,
 * where it costs nothing and reverts with the attribute.
 */
export function useSkin(): Skin {
  const [skin, setSkinState] = useState<Skin>(() => readSkin())
  useEffect(() => {
    const onChange = (e: Event) => setSkinState((e as CustomEvent<Skin>).detail)
    window.addEventListener('deckpal:skinchange', onChange)
    return () => window.removeEventListener('deckpal:skinchange', onChange)
  }, [])
  return skin
}
