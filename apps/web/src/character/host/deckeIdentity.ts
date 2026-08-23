/**
 * What he calls you.
 *
 * ── WHY THIS IS ITS OWN FILE AND ITS OWN REQUEST ─────────────────────────────
 *
 * *"This language — I want it to be like he's actually greeting the user. So
 * 'hey username, what's up'."* The username is real and reachable: `GET /me`
 * returns `app_user.username`, which migration 021's trigger guarantees is
 * populated — falling back to the email's local part when no metadata name was
 * supplied — so it is never empty for a real account.
 *
 * `entitlement.ts` already calls `/me` and throws everything away but a boolean.
 * Reading the name from there would be the tidy answer and it is not available:
 * that file belongs to another lane of this pass. So this memoises its own call,
 * which costs one extra request per SESSION — not per mount, not per panel
 * opening — and both promises are in flight at the same moment anyway.
 *
 * **If the two are ever merged, merge them here, not by widening the
 * entitlement cache's return type in place** — that cache is consulted from a
 * render path and its `catch(() => false)` shape is load-bearing.
 *
 * ── IT FAILS TO NOTHING, AND NOTHING IS A REAL ANSWER ────────────────────────
 *
 * `null` is the honest result for "not back yet", "signed out", "self-host with
 * no account", and "the request failed". Every greeting in `deckeVoice.ts` is
 * written twice — with a name and without — precisely so that `null` produces a
 * sentence somebody wrote rather than "Hey , what's next?". There is no
 * placeholder name here and there must never be one: "Hey there, trainer" is a
 * fabricated identity on the surface whose whole job this pass is to make
 * truthful.
 */
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

let cached: Promise<string | null> | null = null

/** The signed-in account's username, or null. One request per session. */
export function deckeUserName(): Promise<string | null> {
  if (cached) return cached
  cached = api
    .me()
    .then((me) => {
      const name = typeof me.username === 'string' ? me.username.trim() : ''
      return name.length > 0 ? name : null
    })
    .catch(() => null)
  return cached
}

/**
 * Test seam, and the escape hatch for a signed-out → signed-in transition.
 *
 * The same hole that broke `resetDeckeEntitlement` for every signed-in reader
 * applies here in a much smaller way: without a reset, signing in as somebody
 * else in the same tab would keep greeting the previous account by name. Called
 * from nowhere today, and that is a known gap rather than an oversight — the
 * cost is a stale first name on the empty state, not an absent character.
 */
export function resetDeckeUserName(): void {
  cached = null
}

/**
 * The name, for a component.
 *
 * Starts `null` and stays `null` if the request never lands, which is exactly
 * what the anonymous greeting is for. It does NOT hold the empty state back
 * waiting: a starting screen that waits on a request is a starting screen that
 * is sometimes blank, and the nameless greeting is a good greeting.
 */
export function useDeckeUserName(): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void deckeUserName().then((n) => {
      if (live) setName(n)
    })
    return () => {
      live = false
    }
  }, [])
  return name
}
