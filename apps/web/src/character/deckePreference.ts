/**
 * Whether this reader wants Deck-E on their screen at all.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * Deck-E currently cannot be removed. There is no dismissal anywhere: the
 * launcher is mounted on every signed-in page and the only control on it opens
 * him.
 *
 * That is the exact shape of the best-documented assistant backlash there is.
 * Snapchat pinned My AI to the top of every user's chat list with no way to
 * remove it: the App Store rating went **3.05 → 1.67**, one-star reviews went
 * **35% → 75%**, and review volume rose fivefold. The complaint analysis is
 * unambiguous that the anger was about the assistant being **pinned and
 * unremovable**, not about the quality of its answers. Deck-E is genuinely good
 * and that is not protection — My AI's problem was never that it was bad.
 *
 * Load-on-intent already means someone who never opens him pays no bytes
 * (`vite.config.ts`'s `Decke-runtime` chunk is not fetched until intent). This
 * finishes the same thought: **someone who does not want him should be able to
 * say so once and have it stick.**
 *
 * ── PER-VIEWER, PER-BROWSER, AND HONEST ABOUT IT ────────────────────────────
 *
 * `localStorage`, not the account. This is a display preference about one
 * screen, it must work before any request resolves — the launcher renders
 * immediately — and it must not become a column that needs a migration, an API
 * and a sync path. The cost is that hiding him on a laptop leaves him on a
 * phone, which is the ordinary behaviour of a per-device UI preference.
 *
 * **Every access is wrapped.** Reading `localStorage` THROWS, not returns null,
 * in a browser set to block site data, and in some embedded contexts. An
 * unwrapped read here would take down the whole character host on exactly the
 * privacy-conscious setup most likely to want the character gone.
 */

const KEY = 'deckpal.decke.hidden'

/**
 * Broadcast so the toggle and the launcher never disagree.
 *
 * The native `storage` event fires only in OTHER tabs, so a same-tab toggle
 * would leave the launcher showing until a reload — the reader presses "hide",
 * nothing happens, and the setting looks broken. This is listened for
 * alongside `storage`, which then covers other tabs for free.
 */
const CHANGED = 'deckpal:decke-visibility'

/** Is Deck-E hidden for this reader? Defaults to false — he ships visible. */
export function deckeHidden(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    // Storage blocked. Showing him is the right failure: a reader who cannot
    // persist a preference has not asked for anything, and silently hiding a
    // feature because storage threw would be the worse guess.
    return false
  }
}

/** Hide him, or bring him back. */
export function setDeckeHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(KEY, '1')
    else window.localStorage.removeItem(KEY)
  } catch {
    /* Nothing to persist to. The event below still updates this tab, so the
       control responds even where the choice cannot be remembered. */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGED, { detail: { hidden } }))
  } catch {
    /* No CustomEvent (very old or exotic host). The next render still reads the
       stored value, so this degrades to "correct after a reload". */
  }
}

/**
 * Subscribe to changes, from this tab or another one.
 *
 * Returns its own unsubscribe, so a caller cannot half-remove one listener and
 * leak the other — which is the bug two listeners in one function invites.
 */
export function onDeckeVisibilityChange(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    // `key === null` is a whole-storage clear, which can change our answer.
    if (e.key === KEY || e.key === null) fn()
  }
  window.addEventListener(CHANGED, fn)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGED, fn)
    window.removeEventListener('storage', onStorage)
  }
}

/** Exported for tests, so they pin the real key rather than a copy of it. */
export const DECKE_HIDDEN_KEY = KEY
export const DECKE_VISIBILITY_EVENT = CHANGED
