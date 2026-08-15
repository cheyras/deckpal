// Top-bar treatment switch.
//
// 'cover' is the translucent binder-cover effect: content passing behind the
// header is blurred and darkened, and the bar carries its own grain over it.
// 'flat' is the pre-effect header — opaque surface, panel grain, no blur.
//
// Kept switchable because the two have to be compared on VALUE, not on
// impression: the bar's own grey must read the same in both, or the effect is
// silently lightening the chrome. Resolution mirrors lib/skin.ts —
// `?topbar=` → localStorage → DEFAULT_TOPBAR.

export type Topbar = 'cover' | 'flat'

/** Set to 'flat' to ship the pre-effect header without touching anything else. */
export const DEFAULT_TOPBAR: Topbar = 'cover'

const STORAGE_KEY = 'deckpal:topbar'

function isTopbar(v: string | null): v is Topbar {
  return v === 'cover' || v === 'flat'
}

export function readTopbar(): Topbar {
  if (typeof window === 'undefined') return DEFAULT_TOPBAR
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('topbar')
    if (isTopbar(fromUrl)) {
      window.localStorage.setItem(STORAGE_KEY, fromUrl)
      return fromUrl
    }
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isTopbar(stored)) return stored
  } catch {
    // Private-mode / disabled storage: fall back rather than break the app.
  }
  return DEFAULT_TOPBAR
}

export function applyTopbar(t: Topbar): void {
  document.documentElement.dataset.topbar = t
  window.dispatchEvent(new CustomEvent<Topbar>('deckpal:topbarchange', { detail: t }))
}

export function setTopbar(t: Topbar): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, t)
  } catch {
    // Non-persisted toggle still applies for this session.
  }
  applyTopbar(t)
}

export function initTopbar(): Topbar {
  const t = readTopbar()
  applyTopbar(t)
  return t
}
