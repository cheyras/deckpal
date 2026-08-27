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

// ── The mutating auth calls ───────────────────────────────────────────────────
//
// `getSession()` was the one that produced issue #75's grey screen, because it
// is awaited before first paint. These are not: every one of them is behind a
// button the reader pressed, with a busy state next to it. That is why the
// first pass deliberately left them alone.
//
// It is still the wrong place to stop. `@supabase/auth-js` puts no
// `AbortSignal` and no timeout on ANY of its fetches — the same fact that made
// the read hang forever — so a stalled connection here does not produce an
// error a reader can act on, it produces a button that spins until the tab is
// closed. For sign-out that is the worst of the set: the one action whose whole
// point is to stop being signed in, on a machine that may not be yours, has no
// way to tell you it did not happen.
//
// So they get a deadline too, with two differences from the read. The wait is
// longer, because a person who just pressed a button will accept several
// seconds and these are writes worth being patient for. And a timeout here
// SURFACES — it becomes an ordinary `error` the existing form code already
// knows how to display — rather than falling back to a quiet default, because
// there is no safe assumption to make about whether a write landed.

/**
 * How long a user-initiated auth write may take before it is reported as
 * failed. Deliberately much longer than `SESSION_DEADLINE_MS`: nothing is
 * blocked on it except the button that started it.
 */
export const AUTH_ACTION_DEADLINE_MS = 15_000

/** What the reader is told when one of these runs out of time. */
function timeoutError(action: string): Error {
  return new Error(
    `${action} did not finish in ${Math.round(AUTH_ACTION_DEADLINE_MS / 1000)}s. ` +
      'The network did not answer — check your connection and try again.',
  )
}

/**
 * Run one Supabase auth write under a deadline.
 *
 * Supabase resolves these with an `{ error }` shape rather than rejecting, so a
 * timeout is expressed the same way and every existing call site handles it
 * without changing shape. A throw is normalised into the same shape for the
 * same reason.
 */
async function bounded<T extends { error: unknown }>(
  work: Promise<T>,
  action: string,
): Promise<{ error: Error | null }> {
  try {
    const { value, timedOut } = await withDeadline(work, AUTH_ACTION_DEADLINE_MS)
    if (timedOut) {
      markStall(AUTH_ACTION_DEADLINE_MS)
      return { error: timeoutError(action) }
    }
    const err = value?.error ?? null
    return { error: err instanceof Error ? err : err ? new Error(String(err)) : null }
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) }
  }
}

export function signInWithPasswordBounded(
  email: string,
  password: string,
): Promise<{ error: Error | null }> {
  return bounded(supabase.auth.signInWithPassword({ email, password }), 'Signing in')
}

export function signUpBounded(
  email: string,
  password: string,
  options?: { emailRedirectTo?: string },
): Promise<{ error: Error | null }> {
  return bounded(supabase.auth.signUp({ email, password, options }), 'Creating your account')
}

export function resetPasswordForEmailBounded(
  email: string,
  options?: { redirectTo?: string },
): Promise<{ error: Error | null }> {
  return bounded(supabase.auth.resetPasswordForEmail(email, options), 'Sending the reset email')
}

export function updatePasswordBounded(password: string): Promise<{ error: Error | null }> {
  return bounded(supabase.auth.updateUser({ password }), 'Updating your password')
}

/**
 * Sign out, bounded.
 *
 * `scope: 'local'` clears the stored session without waiting on the server, and
 * is what `SignedOut` wants: the local state is the part that matters there.
 * The default global scope revokes the refresh token server-side, which is the
 * part worth waiting for on a shared machine — and the part that can stall.
 */
export function signOutBounded(scope?: 'local' | 'global' | 'others'): Promise<{
  error: Error | null
}> {
  return bounded(supabase.auth.signOut(scope ? { scope } : undefined), 'Signing out')
}
