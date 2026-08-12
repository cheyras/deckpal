// Typeface switch — a temporary evaluation harness, not a permanent feature.
//
// Same shape as lib/skin.ts: an attribute on <html> that a stylesheet keys off,
// resolved from `?type=` → localStorage → DEFAULT_TYPEFACE. It exists so the
// candidate pairings can be judged on REAL screens at the app's real type sizes
// (the bulk of this UI is 11–15px, which is where font choices actually
// succeed or fail) rather than from a specimen sheet.
//
// WHEN A WINNER IS PICKED: delete typefaces.css, this file, useTypeface.ts and
// TypefaceToggle.tsx, drop the three losing packages from package.json, and set
// the winner directly on --font-sans / --font-display in theme.css. Everything
// is deliberately in one place so that teardown is mechanical.

export type Typeface = 'inter' | 'fraunces' | 'bricolage' | 'jakarta'

/** Current shipping look. Leaving this as 'inter' means nothing changes until you toggle. */
export const DEFAULT_TYPEFACE: Typeface = 'inter'

const STORAGE_KEY = 'deckscout:typeface'

export const TYPEFACES: readonly { id: Typeface; label: string; note: string }[] = [
  { id: 'inter', label: 'Inter', note: 'Current — Inter for everything' },
  { id: 'fraunces', label: 'Fraunces + Figtree', note: 'Soft-serif headers, warm UI body' },
  { id: 'bricolage', label: 'Bricolage + Inter', note: 'Characterful grotesque headers, Inter body' },
  { id: 'jakarta', label: 'Plus Jakarta', note: 'One friendly geometric for both' },
]

function isTypeface(v: string | null): v is Typeface {
  return v === 'inter' || v === 'fraunces' || v === 'bricolage' || v === 'jakarta'
}

export function readTypeface(): Typeface {
  if (typeof window === 'undefined') return DEFAULT_TYPEFACE
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('type')
    if (isTypeface(fromUrl)) {
      window.localStorage.setItem(STORAGE_KEY, fromUrl)
      return fromUrl
    }
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isTypeface(stored)) return stored
  } catch {
    // Private-mode / disabled storage: fall back rather than break the app over
    // a cosmetic preference.
  }
  return DEFAULT_TYPEFACE
}

export function applyTypeface(t: Typeface): void {
  document.documentElement.dataset.type = t
  window.dispatchEvent(new CustomEvent<Typeface>('deckscout:typefacechange', { detail: t }))
}

export function setTypeface(t: Typeface): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, t)
  } catch {
    // Non-persisted toggle still applies for this session.
  }
  applyTypeface(t)
}

export function initTypeface(): Typeface {
  const t = readTypeface()
  applyTypeface(t)
  return t
}
