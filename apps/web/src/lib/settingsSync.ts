/**
 * Account settings ⇄ device cache.
 *
 * Five UI preferences grew up in localStorage — Deck-E visibility, the skin,
 * the top bar, the Series index's sort/grouping — which made every one of
 * them a per-device promise ("signing in elsewhere shows him again", as the
 * profile card had to admit). Migration 049 gave them columns on
 * `user_settings`; this module is the client half of the move.
 *
 * The shape of it:
 *
 *   • THE ACCOUNT IS THE SOURCE OF TRUTH. On boot (and on sign-in) the
 *     server's values are applied down into the same localStorage keys the
 *     synchronous readers already use. Those readers keep working untouched,
 *     before any request resolves — localStorage is demoted from "the
 *     preference" to "the offline cache of the preference".
 *   • WRITES GO BOTH WAYS AT ONCE. A toggle applies locally (instant, works
 *     offline) and PATCHes the account. A failed PATCH keeps the local value;
 *     the next boot re-applies whatever the server last accepted.
 *   • ONE-TIME UPWARD MIGRATION. The first hydration on a device that already
 *     has local choices pushes them up, so nobody's existing "hide Deck-E"
 *     silently un-hides the day this ships. Marked by a flag key; the flag is
 *     only set after a successful round trip, so a failed first sync retries.
 *
 * Everything here is fire-and-forget from the caller's point of view: a
 * settings sync must never block boot, and its failures are console noise,
 * not UI.
 */
import { api, type UserSettings } from './api'
import { readSession } from './authSession'
import { isCloudMode, supabase } from './supabase'
import { deckeHidden, setDeckeHidden } from '../character/deckePreference'
import { readStoredSkin, setSkin } from './skin'
import { readStoredTopbar, setTopbar } from './topbar'

const PUSHED_FLAG = 'deckpal.settings.pushed.v1'
/** The Series index's existing cache key — hydration writes it, the page reads it. */
const SERIES_PREFS_KEY = 'deckpal.series.prefs'

/** Fired after server values have been applied locally, for screens that read
 *  their preference once in a useState initializer (SeriesIndex). */
export const SETTINGS_HYDRATED_EVENT = 'deckpal:settings-hydrated'

function flagged(): boolean {
  try {
    return window.localStorage.getItem(PUSHED_FLAG) === '1'
  } catch {
    return true // no storage → nothing local to migrate up anyway
  }
}

function setFlag(): void {
  try {
    window.localStorage.setItem(PUSHED_FLAG, '1')
  } catch {
    /* no storage — the "migration" was vacuous */
  }
}

interface SeriesPrefsCache {
  sortKey?: string
  sortDir?: string
  groupByOwned?: boolean
}

function readSeriesPrefs(): SeriesPrefsCache | null {
  try {
    const raw = window.localStorage.getItem(SERIES_PREFS_KEY)
    return raw ? (JSON.parse(raw) as SeriesPrefsCache) : null
  } catch {
    return null
  }
}

/** Build the one-time upward patch: local choices the server doesn't know yet. */
function upwardPatch(server: UserSettings): Partial<UserSettings> {
  const patch: Partial<UserSettings> = {}
  if (deckeHidden() && !server.deckeHidden) patch.deckeHidden = true
  const skin = readStoredSkin()
  if (skin && server.skin === null) patch.skin = skin
  const topbar = readStoredTopbar()
  if (topbar && server.topbar === null) patch.topbar = topbar
  const prefs = readSeriesPrefs()
  if (prefs) {
    if (prefs.sortKey === 'recency' || prefs.sortKey === 'az' || prefs.sortKey === 'pct') patch.seriesSortKey = prefs.sortKey
    if (prefs.sortDir === 'asc' || prefs.sortDir === 'desc') patch.seriesSortDir = prefs.sortDir
    if (typeof prefs.groupByOwned === 'boolean') patch.seriesGroupOwned = prefs.groupByOwned
  }
  return patch
}

/** Apply the account's values into the local caches the sync readers use. */
function applyDown(s: UserSettings): void {
  if (deckeHidden() !== s.deckeHidden) setDeckeHidden(s.deckeHidden)
  // null means "no explicit choice — follow the app default": leave the local
  // cache alone rather than erase a value the account never overrode.
  if (s.skin === 'premium' || s.skin === 'classic') setSkin(s.skin)
  if (s.topbar === 'cover' || s.topbar === 'flat') setTopbar(s.topbar)
  try {
    window.localStorage.setItem(
      SERIES_PREFS_KEY,
      JSON.stringify({ sortKey: s.seriesSortKey, sortDir: s.seriesSortDir, groupByOwned: s.seriesGroupOwned }),
    )
  } catch {
    /* no storage — the page falls back to its defaults */
  }
  try {
    window.dispatchEvent(new CustomEvent(SETTINGS_HYDRATED_EVENT, { detail: s }))
  } catch {
    /* no CustomEvent — screens correct themselves on next load */
  }
}

let syncing = false

async function sync(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    if (isCloudMode) {
      const { session } = await readSession()
      if (!session) return // signed out: nothing to fetch, nothing to apply
    }
    let { settings } = await api.settings()
    if (!flagged()) {
      const up = upwardPatch(settings)
      if (Object.keys(up).length) {
        settings = (await api.updateSettings(up)).settings
      }
      setFlag()
    }
    applyDown(settings)
  } catch (e) {
    // Offline, expired session, server trouble: the local cache carries on.
    console.warn('settings sync skipped:', e)
  } finally {
    syncing = false
  }
}

/**
 * One call from main.tsx. Syncs now (if signed in) and again on every
 * SIGNED_IN — so signing in on a fresh device picks the account's
 * preferences up without a reload.
 */
export function initSettingsSync(): void {
  void sync()
  if (isCloudMode) {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') void sync()
    })
  }
}

/**
 * Write-through for the UI controls: the caller has already applied the value
 * locally (setDeckeHidden / setSkin / …); this records it on the account.
 * Fire-and-forget — a failed push leaves the device ahead of the account,
 * which the next successful sync resolves in the account's favour.
 */
export function pushSettings(patch: Partial<UserSettings>): void {
  api.updateSettings(patch).catch((e) => console.warn('settings push failed:', e))
}
