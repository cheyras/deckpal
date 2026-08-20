// "Has anybody ever been signed in on this browser?" — persisted, so it survives
// the page load on which the answer is needed.
//
// Why it exists: someone who signed in weeks ago, whose session has since
// lapsed, types deckpal.app and gets the marketing page — a pitch to create the
// account they already have (issue #50). The obvious fix, "did we hold a
// session?", is what AuthGuard's `hadSession` ref answers, and a ref is useless
// here: the visit in question is a COLD load, so nothing is in memory yet.
//
// Supabase's own storage key is not a substitute. When a refresh token is
// rejected, supabase-js deletes the persisted session, so by the time
// `getSession()` has resolved to null the evidence that there ever was one is
// gone. This marker is written on our side and outlives that.
//
// It is a hint about routing, never about authorization: it says which page to
// show a signed-out visitor, and nothing in the app may read it as "signed in".
// It holds no identity — no email, no user id, no token — just a bit.
const KEY = 'deckpal.returning'

// localStorage throws in Safari private mode and when storage is disabled, and
// a marketing page that white-screens is a worse bug than the one being fixed.
function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Record that a session existed here. Idempotent; called on every auth change. */
export function markReturningVisitor(): void {
  try {
    safeStorage()?.setItem(KEY, '1')
  } catch {
    /* quota or disabled storage — the marker is an optimisation, not a contract */
  }
}

/**
 * Forget this browser. Called ONLY from the explicit "Sign out" control — not
 * from AuthGuard's expiry path, which also ends in a signed-out state but means
 * the opposite thing. Deliberately signing out is how you say "stop assuming I
 * have an account here"; a session timing out says nothing of the kind.
 */
export function forgetReturningVisitor(): void {
  try {
    safeStorage()?.removeItem(KEY)
  } catch {
    /* see above */
  }
}

/** True when a session has existed in this browser and was not signed out of. */
export function isReturningVisitor(): boolean {
  try {
    return safeStorage()?.getItem(KEY) === '1'
  } catch {
    return false
  }
}
