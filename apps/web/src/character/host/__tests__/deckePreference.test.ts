/**
 * The dismissal exists because being unremovable is a measured product failure
 * (Snapchat My AI: 3.05 -> 1.67 stars, one-star share 35% -> 75%, over being
 * pinned rather than over answer quality).
 *
 * The interesting tests here are the ones about storage THROWING. Reading
 * `localStorage` does not return null in a browser set to block site data — it
 * raises — and an unwrapped read would take the whole character host down on
 * precisely the privacy-conscious setup most likely to want the character gone.
 * That is a fault that would be invisible in every normal browser and total in
 * the one that matters.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

type Store = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void }

/** A DOM stub, because these run under `node:test` with no browser. */
function install(storage: Store | (() => never)) {
  const listeners = new Map<string, Set<(e: unknown) => void>>()
  const win = {
    get localStorage() {
      if (typeof storage === 'function') return storage()
      return storage
    },
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set())
      listeners.get(t)!.add(fn)
    },
    removeEventListener: (t: string, fn: (e: unknown) => void) => listeners.get(t)?.delete(fn),
    dispatchEvent: (e: { type: string }) => {
      for (const fn of listeners.get(e.type) ?? []) fn(e)
      return true
    },
    CustomEvent: class {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    },
  }
  ;(globalThis as Record<string, unknown>).window = win
  ;(globalThis as Record<string, unknown>).CustomEvent = win.CustomEvent
  return { listeners, count: (t: string) => listeners.get(t)?.size ?? 0 }
}

function memoryStore(initial: Record<string, string> = {}): Store {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

let mod: typeof import('../../deckePreference')

beforeEach(async () => {
  install(memoryStore())
  // Fresh import per test so no module-level state leaks between them.
  mod = await import(`../../deckePreference?t=${Math.random()}`)
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window
  delete (globalThis as Record<string, unknown>).CustomEvent
})

test('he ships visible — an absent preference is not a hidden one', () => {
  assert.equal(mod.deckeHidden(), false)
})

test('hiding him sticks, and bringing him back clears it', () => {
  mod.setDeckeHidden(true)
  assert.equal(mod.deckeHidden(), true)
  mod.setDeckeHidden(false)
  assert.equal(mod.deckeHidden(), false)
})

test('storage that THROWS on read shows him rather than taking the page down', async () => {
  install(() => {
    throw new Error('SecurityError: site data blocked')
  })
  const m = await import(`../../deckePreference?t=${Math.random()}`)
  // Not "does not throw" alone — the ANSWER matters. A reader who cannot
  // persist a preference has not asked for anything, so showing him is the
  // correct failure; silently hiding a feature because storage threw would be
  // the worse guess.
  assert.equal(m.deckeHidden(), false)
})

test('storage that THROWS on write still updates this tab', async () => {
  const notified: string[] = []
  install(() => {
    throw new Error('SecurityError: site data blocked')
  })
  const m = await import(`../../deckePreference?t=${Math.random()}`)
  m.onDeckeVisibilityChange(() => notified.push('changed'))
  m.setDeckeHidden(true)
  // The choice cannot be remembered, but the control must still respond —
  // a button that does nothing at all reads as broken.
  assert.deepEqual(notified, ['changed'])
})

test('a same-tab change notifies, because `storage` alone would not', () => {
  // The native `storage` event fires only in OTHER tabs. Without the custom
  // event the reader presses "hide", nothing moves, and the setting looks
  // broken until a reload.
  let hits = 0
  mod.onDeckeVisibilityChange(() => hits++)
  mod.setDeckeHidden(true)
  assert.equal(hits, 1)
})

test('a storage event from ANOTHER tab notifies, including a whole-store clear', () => {
  let hits = 0
  mod.onDeckeVisibilityChange(() => hits++)
  const fire = (key: string | null) =>
    window.dispatchEvent(Object.assign(new (globalThis as never as { CustomEvent: typeof CustomEvent }).CustomEvent('storage'), { key }) as never)
  fire(mod.DECKE_HIDDEN_KEY)
  assert.equal(hits, 1)
  fire(null) // "clear site data" can change our answer too
  assert.equal(hits, 2)
  fire('some.other.key')
  assert.equal(hits, 2, 'an unrelated key must not wake the host')
})

test('unsubscribing removes BOTH listeners, not one of the two', () => {
  // Two listeners registered in one call is exactly how a half-removal leaks.
  const probe = install(memoryStore())
  // Re-import against the fresh window so the listeners land on the probe.
  return import(`../../deckePreference?t=${Math.random()}`).then((m) => {
    const off = m.onDeckeVisibilityChange(() => {})
    assert.equal(probe.count(m.DECKE_VISIBILITY_EVENT), 1)
    assert.equal(probe.count('storage'), 1)
    off()
    assert.equal(probe.count(m.DECKE_VISIBILITY_EVENT), 0)
    assert.equal(probe.count('storage'), 0)
  })
})
