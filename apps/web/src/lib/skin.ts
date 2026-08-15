// Skin switch — the one lever that turns the premium visual pass on and off.
//
// Everything the premium pass adds is authored under `[data-skin='premium']`
// in premium.css, and the handful of components that need different *markup*
// (the animated nav icons) branch on `useSkin()`. So flipping this attribute
// flips the entire look, live, with no rebuild — which is the point: the pass
// has to be trivially reversible while it is being judged.
//
// Resolution order: `?skin=` in the URL (one-shot, also persisted) → the
// localStorage preference → DEFAULT_SKIN.

export type Skin = 'premium' | 'classic'

/** Change this to 'classic' to ship the pre-pass look without touching anything else. */
export const DEFAULT_SKIN: Skin = 'premium'

const STORAGE_KEY = 'deckpal:skin'

function isSkin(v: string | null): v is Skin {
  return v === 'premium' || v === 'classic'
}

export function readSkin(): Skin {
  if (typeof window === 'undefined') return DEFAULT_SKIN
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('skin')
    if (isSkin(fromUrl)) {
      window.localStorage.setItem(STORAGE_KEY, fromUrl)
      return fromUrl
    }
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isSkin(stored)) return stored
  } catch {
    // Private-mode / disabled storage: fall through to the default rather than
    // taking the whole app down over a cosmetic preference.
  }
  return DEFAULT_SKIN
}

/** Writes the attribute the CSS keys off. Called once at boot and on every toggle. */
export function applySkin(skin: Skin): void {
  document.documentElement.dataset.skin = skin
  window.dispatchEvent(new CustomEvent<Skin>('deckpal:skinchange', { detail: skin }))
}

export function setSkin(skin: Skin): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, skin)
  } catch {
    // Non-persisted toggle still applies for this session.
  }
  applySkin(skin)
}

export function initSkin(): Skin {
  const skin = readSkin()
  applySkin(skin)
  return skin
}
