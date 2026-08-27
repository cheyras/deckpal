/**
 * Who gets Deck-E.
 *
 * ONE CHOKE POINT, deliberately. Every entry point to the character — the
 * floating button, the chat overlay, the scan augmentation — asks this and
 * nothing else. When the paid tier exists, this file changes and they do not.
 *
 * IT IS AN EXPERIMENTAL FEATURE ON PRODUCTION, and this pair of gates is the
 * flag that makes that true. Verified on production 2026-08-23:
 * `deckeEntitlement: { status: "owner-plus-list", extraAccounts: 1 }`, the owner
 * being `cheyras` and the one extra being the QA account (`/api/me` returns
 * `decke: true, owner: false` for it). Nobody else can reach him, and the refusal
 * is `POST /api/chat`'s rather than this file's — this only decides whether to
 * draw a button.
 *
 * Widening it is a configuration change and not a code change: add an id to
 * `DECKE_ENTITLED_USER_IDS`. The panel also SAYS it is experimental, beside his
 * name, because a feature two accounts can reach and that changes weekly should
 * not rely on those two remembering.
 *
 * IT REUSES THE OWNER GATE rather than inventing a flag. That is not laziness, it is contract B11: a feature whose behaviour
 * depends on a new environment variable owes that variable a declaration in
 * `DEPLOYMENT.md`, a boot warning and a `/health` field, in the commit that
 * reads it. `DESIGN_EDITOR_USER_ID` already has all three (`ownerGateStatus()`
 * in `apps/api/src/routes/me.ts`), already fails closed, and is already the gate
 * `/dev/decke` is verified against — so a temporary launch flag would be a
 * second thing to keep true about production for no gain.
 *
 * There is no entitlement, subscription or plan concept in the schema — checked
 * across all 38 migrations, zero matches. So this cannot consult one yet, and
 * pretending otherwise would be worse than saying so.
 */
import { api } from '../../lib/api'
import { isCloudMode, supabase } from '../../lib/supabase'

/** Cached across callers: `/me` is one request per session, not one per mount. */
let cached: Promise<boolean> | null = null

/**
 * May the signed-in account use Deck-E?
 *
 * Fails CLOSED on every error path. A network blip, a lapsed session or a
 * missing `DESIGN_EDITOR_USER_ID` all resolve to `false`, which shows no button
 * at all — the same posture the design gate takes, and the one the B11
 * postmortem concluded was right (the bug there was invisibility, not
 * fail-closed).
 */
export function deckeEntitled(): Promise<boolean> {
  if (cached) return cached
  cached = resolve().catch(() => false)
  return cached
}

async function resolve(): Promise<boolean> {
  // Local dev is the owner's own machine against their own session; gating it
  // would mean nobody can build the feature they are building.
  if (import.meta.env.DEV) return true
  // ── Self-host: NOT entitled, because there is nothing to talk to ───────────
  //
  // This used to `return true`, reasoning that self-host has exactly one user
  // behind their own reverse proxy — the same reasoning the `/dev/decke` route
  // guard uses. That reasoning is about PERMISSION, and it is still correct:
  // the single self-host operator is obviously allowed to use their own copy.
  //
  // But permission is not the question this function actually answers. It
  // decides whether to draw the button, and a button has to lead somewhere.
  // Deck-E's turn endpoint is `POST /api/chat`, which exists ONLY as the Vercel
  // serverless function in `api/chat.mjs`. `apps/api` has no Express route for
  // it, so on a self-host deployment `useDeckeChat`'s `fetch('/api/chat')` hits
  // the SPA fallback and gets HTML back — the same shape of failure issue #89
  // produced for Purchase Set, and it surfaces only after the reader has opened
  // the chat and typed something.
  //
  // So the honest answer for that tier is "no", and it is a fail-CLOSED no,
  // which is the posture the rest of this file already takes. If a self-host
  // turn endpoint ever ships, this is the line to revisit — and the condition
  // to write then is "does the endpoint exist", not "is this cloud".
  if (!isCloudMode) return false
  const me = await api.me()
  // `decke`, NOT `owner`. The endpoint gates on the owner PLUS
  // `DECKE_ENTITLED_USER_IDS`; reusing `owner` here made the two gates
  // disagree, and the disagreement was invisible from either side alone —
  // `/api/chat` would answer a turn for an entitled non-owner while this
  // function refused to draw them a button.
  //
  // Found on the deployed preview: the QA account was entitled server-side
  // (health reported `owner-plus-list`) and Deck-E simply did not appear. That
  // would have made every browser gate unrunnable by the one account permitted
  // to run them, which is the exact hole §13.1 of the spec exists to close.
  //
  // `decke` is computed by the same function the endpoint calls, so they cannot
  // drift again. Falls back to `owner` only for a server that predates the
  // field, so a stale API cannot silently open the gate — it can only keep it
  // where it already was.
  return me.decke ?? me.owner === true
}

/** Test seam, and the escape hatch for a signed-out → signed-in transition. */
export function resetDeckeEntitlement(): void {
  cached = null
}

/**
 * ── THE ESCAPE HATCH WAS BUILT AND NEVER CONNECTED ───────────────────────
 *
 * `resetDeckeEntitlement` existed, its comment named the exact transition it was
 * for, and a `grep` found no caller. The consequence was total and silent, and
 * it hit EVERY signed-in reader rather than any special case:
 *
 *   1. `DeckeHost` mounts app-wide. Hooks run before its early return, so the
 *      entitlement effect fires even on `/auth`, where it renders nothing.
 *   2. Signed out, that call is a 401. `deckeEntitled` fails CLOSED by design
 *      and caches the FAILURE — `cached` is a resolved `false` from then on.
 *   3. Signing in navigates client-side. No reload, so the module cache
 *      survives, and every later caller is answered `false` from memory.
 *   4. **Deck-E never appears until a hard refresh.** Reported from a deployed
 *      preview as "there is no chat button", with `/api/me` cheerfully
 *      returning `decke: true` to anyone who asked it directly.
 *
 * Module scope, not a component, because `lib/supabase.ts` already states the
 * doctrine for this codebase: subscribing once where the client is owned is
 * what stops several component-level subscriptions drifting apart. It lives
 * here rather than there so the dependency keeps pointing the right way — a
 * generic client module has no business importing Deck-E.
 */
const listeners = new Set<() => void>()

/** Re-ask after the signed-in identity changes. Returns its own unsubscribe. */
export function onDeckeEntitlementChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

if (isCloudMode) {
  supabase.auth.onAuthStateChange((event) => {
    // `TOKEN_REFRESHED` is the same person with a newer token, so re-asking
    // would be a request per hour that can only ever return what it already
    // returned. Every other event can change who is asking.
    if (event === 'TOKEN_REFRESHED') return
    resetDeckeEntitlement()
    for (const fn of listeners) fn()
  })
}
