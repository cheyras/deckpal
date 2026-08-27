/**
 * A deadline for the auth-session read — the one await that used to be able to
 * hold the whole app on a blank screen forever.
 *
 * ── WHAT WENT WRONG (issue #75) ──────────────────────────────────────────────
 *
 * `supabase.auth.getSession()` is documented and commented throughout this
 * codebase as "reads the persisted session out of localStorage, so the common
 * case resolves in a tick without a network round-trip". That is true only
 * while the stored access token is more than `EXPIRY_MARGIN_MS` (90 s) from
 * expiry. Inside that window — and on every load where the token has already
 * expired, which is every load after a couple of hours away — the client
 * refreshes first:
 *
 *   getSession()
 *     └─ await initializePromise            (created in the GoTrueClient ctor)
 *          └─ _initialize → _recoverAndRefresh
 *               └─ _callRefreshToken → POST /auth/v1/token?grant_type=refresh_token
 *
 * `@supabase/auth-js` attaches no `AbortSignal` and no timeout to that fetch
 * (verified by reading `dist/module/lib/fetch.js` in 2.112.3: there is no
 * `AbortController` anywhere in its request path). Its retry ladder only runs
 * for a fetch that FAILS. A fetch that never settles — a socket stranded by a
 * network change, a sleep/resume, a captive portal, a stalled H2 connection —
 * simply never settles, and `initializePromise` never resolves.
 *
 * Everything downstream inherits that: `main.tsx`'s index route awaits it in
 * `beforeLoad` (so the router renders nothing), `AuthGuard` awaits it (infinite
 * spinner), and `api.ts`'s `authHeaders()` awaits it before EVERY request (so
 * even the public catalog renders chrome and no content). Measured against a
 * dev build with an auth endpoint that accepts and never answers: `#root` had
 * **0 children** 15 s in, and the inline "Loading DeckPal" first-paint state
 * from #87 was gone — React's first commit had already replaced it. A blank
 * dark-grey page, indefinitely. That is the reported bug.
 *
 * ── THE PROPERTY THIS FILE EXISTS TO GUARANTEE ───────────────────────────────
 *
 * **First paint can never be blocked indefinitely by the auth-session read.**
 * Not "the one trigger we found is fixed" — the read is bounded, so no trigger
 * of any kind can hold it open. `apps/web/scripts/check-auth-deadlines.mjs`
 * fails the build if a raw `auth.getSession()` / `auth.refreshSession()` call
 * reappears outside `lib/authSession.ts`, because a bound that one call site
 * can opt out of is not a bound.
 *
 * This module is deliberately PURE — no `./supabase` import, no
 * `import.meta.env` — so `node --import tsx --test` can exercise it. See
 * `__tests__/sessionDeadline.test.ts`. `lib/authSession.ts` is the thin layer
 * that binds it to the real client.
 */

/**
 * How long any auth-session read may take before the app stops waiting on it.
 *
 * Four seconds, and the trade is asymmetric in a way that makes the exact
 * number unimportant. Overshooting costs a signed-in visitor on a genuinely
 * slow connection one extra beat and then a NON-DESTRUCTIVE fallback (see the
 * call sites: `/` routes to the public catalog, `AuthGuard` says "still
 * checking" rather than signing anyone out). Undershooting costs nothing at
 * all in the common case, because a warm read never touches the network. What
 * it must not be is absent, which is what it was.
 */
export const SESSION_DEADLINE_MS = 4000

export interface DeadlineResult<T> {
  /** The work's value, or `null` if the deadline passed first. */
  value: T | null
  /** True when the deadline passed — `value: null` then means UNKNOWN, not "no". */
  timedOut: boolean
}

/**
 * Race `work` against `ms`.
 *
 * - `work` settles first → `{ value, timedOut: false }`.
 * - the deadline passes first → `{ value: null, timedOut: true }`, and `onLate`
 *   is called if and when `work` eventually resolves. That callback is what
 *   makes a timeout RECOVERABLE rather than a decision: a caller that showed a
 *   "still checking" state can quietly settle into the real answer whenever it
 *   turns up, without a reload.
 *
 * A rejection BEFORE the deadline rejects this promise (the caller asked, and
 * an error is an answer). A rejection AFTER it is swallowed: the caller has
 * already been told `timedOut`, and an unhandled rejection helps nobody.
 */
export function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  onLate?: (value: T) => void,
): Promise<DeadlineResult<T>> {
  return new Promise<DeadlineResult<T>>((resolve, reject) => {
    let answered = false

    const timer = setTimeout(() => {
      if (answered) return
      answered = true
      resolve({ value: null, timedOut: true })
    }, ms)

    work.then(
      (value) => {
        if (answered) {
          onLate?.(value)
          return
        }
        answered = true
        clearTimeout(timer)
        resolve({ value, timedOut: false })
      },
      (err: unknown) => {
        if (answered) return // already answered `timedOut`; nobody is listening
        answered = true
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}

/** The shape of anything that can hand back a session — i.e. `auth.getSession`. */
export type SessionSource<S> = () => Promise<{ data: { session: S | null } }>

export interface SessionRead<S> {
  /**
   * The session, or `null`. **`null` with `timedOut: true` means UNKNOWN.** No
   * caller may read that as "signed out": treating a stalled network as a
   * sign-out is how a flaky connection turns into a logout, which is a worse
   * bug than the one this file fixes.
   */
  session: S | null
  timedOut: boolean
}

/**
 * A bounded session read. Never rejects — a client-side auth error is
 * indistinguishable from "no session" for every caller in this app, and a
 * throw here would land in a `beforeLoad` or a render.
 */
export async function readWithDeadline<S>(
  getSession: SessionSource<S>,
  ms: number = SESSION_DEADLINE_MS,
  onLate?: (session: S | null) => void,
): Promise<SessionRead<S>> {
  const work = (async () => {
    try {
      const { data } = await getSession()
      return data.session ?? null
    } catch {
      return null
    }
  })()

  const { value, timedOut } = await withDeadline(work, ms, onLate)
  return { session: timedOut ? null : value, timedOut }
}
