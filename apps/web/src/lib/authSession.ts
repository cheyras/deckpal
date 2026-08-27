/**
 * The ONE place the app reads the Supabase auth session.
 *
 * Everything about why lives in `sessionDeadline.ts`; this file is the seam
 * where the deadline meets the real client, and it is a choke point on purpose.
 * `apps/web/scripts/check-auth-deadlines.mjs` fails the build if
 * `auth.getSession()` or `auth.refreshSession()` is called anywhere else, for
 * the same reason `check-precache.mjs` exists: the bug was not that one call
 * site forgot a timeout, it was that nothing made a missing timeout visible.
 */
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import {
  readWithDeadline,
  withDeadline,
  SESSION_DEADLINE_MS,
  type SessionRead,
} from './sessionDeadline'

export { SESSION_DEADLINE_MS }
export type AuthSessionRead = SessionRead<Session>

/**
 * How long a known-stalled read stays known-stalled.
 *
 * The refresh underneath every reader is ONE shared promise
 * (`initializePromise` in the GoTrue client), so once it has missed its
 * deadline it will miss it for every caller. Without this memo, a page with
 * seven queries pays seven four-second waits on the way to the same answer.
 * Thirty seconds is long enough to cover a page load and short enough that a
 * network coming back is noticed almost immediately; a successful read clears
 * it outright.
 */
const STALL_MEMO_MS = 30_000
let stalledAt: number | null = null

function stallKnown(): boolean {
  return stalledAt !== null && Date.now() - stalledAt < STALL_MEMO_MS
}

/**
 * Instrumentation, not decoration.
 *
 * A stalled session read is invisible in production today — the page simply
 * does not paint and nothing says why. This leaves two traces for whoever looks
 * next: a `performance.mark` (so a User Timing trace shows the stall against
 * the rest of the load) and one console error naming the deadline. If issue #75
 * recurs after this ships, that console line is the first thing to ask for.
 *
 * Once per stall episode, not once per caller — an error repeated eight times
 * on one page load reads as eight problems.
 */
function markStall(ms: number): void {
  try {
    performance.mark('deckpal:auth-session-stalled')
    console.error(
      `[deckpal] auth session read exceeded ${ms}ms — continuing without it. ` +
        'The app is NOT signed out; this is an unfinished network call to the auth endpoint.',
    )
  } catch {
    /* User Timing or console unavailable — never worth failing a render over */
  }
}

/**
 * Read the session, bounded.
 *
 * `onLate` fires if the read eventually completes AFTER the deadline, so a
 * caller that rendered a provisional state can settle into the real answer
 * without a reload.
 */
export async function readSession(
  onLate?: (session: Session | null) => void,
): Promise<AuthSessionRead> {
  if (stallKnown()) return { session: null, timedOut: true }

  const result = await readWithDeadline<Session>(
    () => supabase.auth.getSession(),
    SESSION_DEADLINE_MS,
    (session) => {
      // It arrived after all: the stall is over, and whoever asked still wants
      // the answer.
      stalledAt = null
      onLate?.(session)
    },
  )
  if (result.timedOut) {
    if (!stallKnown()) markStall(SESSION_DEADLINE_MS)
    stalledAt = Date.now()
  } else {
    stalledAt = null
  }
  return result
}

/**
 * Refresh the session, bounded.
 *
 * `api.ts`'s 401 retry is the only caller. A 401 proves the network was alive a
 * moment ago, so this is far less likely to stall than the load-time read — but
 * it is the same unbounded fetch underneath, and an unbounded retry parks a
 * query on a spinner forever instead of showing an error. `timedOut` is
 * deliberately NOT an auth failure: the caller must not redirect to /auth on it.
 */
export async function refreshSessionBounded(): Promise<{
  error: Error | null
  timedOut: boolean
}> {
  try {
    const { value, timedOut } = await withDeadline(
      supabase.auth.refreshSession(),
      SESSION_DEADLINE_MS,
    )
    if (timedOut) {
      markStall(SESSION_DEADLINE_MS)
      return { error: null, timedOut: true }
    }
    return { error: value?.error ?? null, timedOut: false }
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)), timedOut: false }
  }
}
