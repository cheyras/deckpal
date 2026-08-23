/**
 * The launcher vanished for every signed-in reader, and the cause was a cache
 * that remembered a failure.
 *
 * `DeckeHost` mounts app-wide, so its entitlement effect runs on `/auth` too —
 * hooks run before the early return that makes it render nothing there. Signed
 * out, that call is a 401; `deckeEntitled` fails CLOSED by design and caches the
 * result, so `cached` became a resolved `false`. Signing in is a client-side
 * navigation, so the module survived and every later caller was answered from
 * memory. **Deck-E never appeared until a hard refresh**, while `/api/me`
 * happily returned `decke: true` to anyone who asked it directly.
 *
 * Written against the CACHE SEMANTICS rather than the React effect: that is
 * where the defect lived, and a test needing a renderer would not run in this
 * suite at all (importing a component under `tsx` throws before any test does).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('a signed-out failure must not be the answer forever', async () => {
  // The bug in miniature, against a local replica of the exact caching rule
  // `entitlement.ts` uses — cache the promise, swallow the error as `false`.
  let cached: Promise<boolean> | null = null
  let answer: () => Promise<{ decke?: boolean; owner?: boolean }> = async () => ({ decke: true })

  const entitled = () =>
    (cached ??= answer()
      .then((me) => me.decke ?? me.owner === true)
      .catch(() => false))
  const reset = () => {
    cached = null
  }

  // 1. Signed out on `/auth`: the host's effect still runs, and 401s.
  answer = async () => {
    throw new Error('401 unauthorized')
  }
  assert.equal(await entitled(), false)

  // 2. The reader signs in. Same page, no reload, module still alive.
  answer = async () => ({ decke: true })

  // 3. WITHOUT the reset this is STILL false. That is the whole defect.
  assert.equal(await entitled(), false, 'the stale cache is what hid the launcher')

  // 4. With it, the next ask reaches the server again.
  reset()
  assert.equal(await entitled(), true)
})

test('the cache falls back to `owner` only when `decke` is absent', async () => {
  // A stale API that predates the field can keep the gate where it was; it must
  // never be able to OPEN it. `decke: false` has to win over `owner: true`.
  const read = async (me: { decke?: boolean; owner?: boolean }) => me.decke ?? me.owner === true
  assert.equal(await read({ decke: true }), true)
  assert.equal(await read({ decke: false, owner: true }), false, 'decke:false must win')
  assert.equal(await read({ owner: true }), true, 'no decke field: fall back to owner')
  assert.equal(await read({}), false)
})

test('an identity change clears the cache, and a token refresh does not', () => {
  // The subscription itself needs a browser, so this pins the two rules that
  // make it correct. `resetDeckeEntitlement` existed with its purpose written
  // in its own comment and NO caller — that is how the defect survived, so the
  // caller is what these assert.
  const src = readFileSync(new URL('../entitlement.ts', import.meta.url), 'utf8')
  assert.match(src, /onAuthStateChange/, 'nothing re-asks after sign-in')
  assert.match(src, /resetDeckeEntitlement\(\)/, 'the subscription no longer clears the cache')
  assert.match(src, /TOKEN_REFRESHED/, 'a token refresh would now cost a request an hour')
})

// NO TEST IMPORTS `../entitlement` HERE, and that is a property of the suite
// rather than an omission: the module reaches `lib/supabase`, which reads
// `import.meta.env` — `undefined` under `node --import tsx` — so the import
// throws before any assertion runs. The same reason the other pure modules in
// this directory are siblings of their components rather than the components
// themselves. The rules above are therefore pinned by reading the source, which
// is the trade this harness already makes for `CLIENT_TOOLS`.
