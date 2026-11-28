// Per-device cache of derived deck art, keyed by a hash of the deck's state.
//
// A spec is ~400 bytes of JSON, and deriving one costs a deck-detail request
// plus up to FACTS_FOR_TOP card lookups. Caching it by (deck id, version,
// updated-at, card count, DERIVE_VERSION) means a deck pays that once per
// device and then renders its art synchronously on every later visit — the
// first paint of /decks is the finished art, not a placeholder.
//
// localStorage, not IndexedDB: the whole map is a few KB, is read once, and a
// synchronous read is exactly what lets the first render be the final one.
// Every access is guarded: private mode, a full quota or a disabled store all
// degrade to "derive it again", never to an error.

import { DERIVE_VERSION, type DeckArtSpec } from './derive'

const STORAGE_KEY = 'deckpal:deck-art'

interface Entry {
  k: string
  s: DeckArtSpec
}

let mem: Map<string, Entry> | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null

/** The state a spec was derived from. Any change re-derives it. */
export function artKey(deck: { version: number; updatedAt: string; totalCount: number }): string {
  return `${DERIVE_VERSION}|${deck.version}|${deck.updatedAt}|${deck.totalCount}`
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function load(): Map<string, Entry> {
  if (mem) return mem
  mem = new Map()
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, Entry>
      for (const [id, e] of Object.entries(obj)) {
        if (e && typeof e.k === 'string' && e.s && e.s.v === DERIVE_VERSION) mem.set(id, e)
      }
    }
  } catch {
    // corrupt or unreadable: start empty
  }
  return mem
}

function scheduleWrite() {
  if (writeTimer) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(load())))
    } catch {
      // quota or disabled — the in-memory copy still serves this session
    }
  }, 400)
}

export function readSpec(deckId: string, key: string): DeckArtSpec | null {
  const e = load().get(deckId)
  return e && e.k === key ? e.s : null
}

export function writeSpec(deckId: string, key: string, spec: DeckArtSpec): void {
  load().set(deckId, { k: key, s: spec })
  scheduleWrite()
}

/** Drop entries for decks that no longer exist, so the map stays bounded by the deck list. */
export function pruneSpecs(liveIds: ReadonlySet<string>): void {
  const m = load()
  let changed = false
  for (const id of m.keys()) {
    if (!liveIds.has(id)) {
      m.delete(id)
      changed = true
    }
  }
  if (changed) scheduleWrite()
}

/**
 * Forget every spec on this device. Called on sign-out: a spec names the
 * featured cards of someone's decks, which is theirs, not the next person's
 * to find in this browser's storage.
 */
export function clearSpecs(): void {
  mem = new Map()
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    // nothing stored, or storage disabled
  }
}

/** Test seam. */
export function resetSpecCacheForTests(): void {
  mem = null
}
