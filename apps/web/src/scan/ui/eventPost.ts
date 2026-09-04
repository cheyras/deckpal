// The scan recorder's POSTING POLICY — who is allowed to record, and what stops
// a refused client from asking forever.
//
// Deliberately in its own module, with NO static import of `lib/api`: that
// module reads `import.meta.env` at evaluation time, which does not exist under
// node, so a policy living next to it could not be unit-tested at all. The real
// transport is reached through a dynamic import inside the default poster, so it
// is loaded only when a post actually happens — never in a test that injects its
// own.
//
// ── WHO DECIDES, AND WHY IT IS NOT THIS FILE ────────────────────────────────
//
// The first version of the recorder asked `/me` for `owner` and stayed silent
// unless the answer was yes, failing CLOSED on any error. That gate was wrong,
// and it cost an entire field-test session: the owner tested build obb0xud59
// signed into the QA ACCOUNT — which AGENTS.md B12 REQUIRES them to use — so
// `owner` was false and the whole session recorded nothing. The one session the
// instrumentation existed for is the one it silently threw away.
//
// The authority is `/api/dev/scan-flags` itself (apps/api/src/dev/scanFlags.ts),
// and it already answers a strictly better question than `owner`: NON-PRODUCTION
// deployments (preview, self-host, local `pnpm dev`) pass unconditionally,
// because they sit behind Vercel SSO or have no auth boundary at all; production
// additionally requires the verified JWT subject to be the owner. That is
// exactly the policy wanted, it is enforced where it cannot be spoofed, and
// duplicating a WEAKER approximation of it in the client only created a way for
// the two to disagree — which is precisely what happened. So: attempt the post,
// and let the endpoint rule on it.
//
// ── WHAT STOPS A PRODUCTION USER SPAMMING IT ────────────────────────────────
//
// A backoff, not a pre-flight check. A production non-owner's attempts are
// refused, and after MAX_CONSECUTIVE_FAILURES refusals in a row the recorder
// switches itself off for the rest of the tab. The cost of being wrong is
// bounded at three requests per session rather than one per capture; the cost of
// being right is zero. Any success resets the counter, so a transient blip on a
// legitimately-recording session cannot permanently disable it.

export const MAX_CONSECUTIVE_FAILURES = 3

let consecutiveFailures = 0

/** True once the endpoint has refused us often enough that we stop asking. */
export function recorderSuspended(): boolean {
  return consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
}

/** The single network seam. */
export type FlagPoster = (png: string, meta: Record<string, unknown>) => Promise<unknown>

const realPoster: FlagPoster = async (png, meta) => {
  // Dynamic so `lib/api` (and its `import.meta.env` read) is never evaluated
  // just because something imported this policy.
  const { api } = await import('../../lib/api')
  return api.scanFlag(png, meta)
}

let poster: FlagPoster = realPoster

/**
 * Post one event, honouring the backoff. Resolves to whether it landed; never
 * throws, because instrumentation that can break a capture is worse than none.
 */
export async function postEvent(png: string, meta: Record<string, unknown>): Promise<boolean> {
  if (recorderSuspended()) return false
  try {
    await poster(png, meta)
    consecutiveFailures = 0
    return true
  } catch {
    consecutiveFailures += 1
    return false
  }
}

/** TEST SEAM: swap the transport and clear the backoff. Pass null to restore. */
export function __setFlagPoster(p: FlagPoster | null): void {
  poster = p ?? realPoster
  consecutiveFailures = 0
}
