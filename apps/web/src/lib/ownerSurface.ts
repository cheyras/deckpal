/**
 * Who gets an owner-only surface, as far as the UI is concerned.
 *
 * ONE CHOKE POINT, deliberately — the same shape and for the same reasons as
 * `character/host/entitlement.ts`, which is this module's direct precedent and
 * worth reading before changing anything here.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT ─────────────────────────────────────
 *
 * This decides whether to DRAW something: the scanner's nav row, its camera
 * button. It is not a gate. The gates are the route's `beforeLoad` in
 * `main.tsx` (which throws `notFound()`) and the server's own refusal
 * (`apps/api/src/scan/router.ts`, which 404s a non-owner on production). Both
 * of those check the identity against the verified JWT subject; this only
 * decides what a person sees before they get there.
 *
 * That distinction is why all three exist. Drawing a button a person cannot use
 * is a broken promise; leaving an endpoint open because the button is hidden is
 * the Deck-E hole — an ordinary signed-in account got a full model turn out of
 * `POST /api/chat` by asking for one, because the only gate was a client that
 * had politely declined to render. See `apps/api/src/decke/entitlement.ts`.
 *
 * ── IT READS `owner`, NOT A NEW FLAG ─────────────────────────────────────────
 *
 * `GET /me` already returns a server-computed `owner`, checked against
 * `DESIGN_EDITOR_USER_ID` — the same variable, the same fail-closed default
 * ("unset means nobody"), and the same one `/design`, `/dev/decke` and the
 * scanner's own route and API gates read. A launch flag of its own would be a
 * second thing to keep true about production for no gain, which is the ruling
 * Deck-E's entitlement file already recorded under contract B11.
 *
 * Widening a surface later is a configuration change, not a code change.
 */
import { useEffect, useState } from 'react'
import { api } from './api'
import { isCloudMode, supabase } from './supabase'

/** Cached across callers: `/me` is one request per session, not one per mount. */
let cached: Promise<boolean> | null = null

/**
 * Is the signed-in account this deployment's owner?
 *
 * Fails CLOSED on every error path. A network blip, a lapsed session or a
 * missing `DESIGN_EDITOR_USER_ID` all resolve to `false`, which draws nothing
 * at all — the same posture the route gate takes when its `/me` call throws.
 */
export function ownerEntitled(): Promise<boolean> {
  if (cached) return cached
  cached = resolve().catch(() => false)
  return cached
}

async function resolve(): Promise<boolean> {
  // Local dev is the owner's own machine against their own session; gating it
  // would mean nobody can build the feature they are building. This matches
  // `main.tsx`'s `import.meta.env.DEV` short-circuit exactly — if the two
  // disagreed, the route would open and the button that leads to it would not.
  if (import.meta.env.DEV) return true
  // Self-host has exactly one user (the owner) behind their own reverse proxy,
  // and unlike Deck-E there is somewhere for the button to lead: `apps/api`
  // serves the scan routes on every tier, and `ownerOnlyInProduction` passes
  // self-host through. So this one is a true `yes`, not a fail-closed `no`.
  if (!isCloudMode) return true
  const me = await api.me()
  return me.owner === true
}

/** Test seam, and the escape hatch for a signed-out → signed-in transition. */
export function resetOwnerEntitlement(): void {
  cached = null
}

/**
 * ── THE ESCAPE HATCH MUST BE CONNECTED, AND ONCE WAS NOT ─────────────────────
 *
 * Deck-E's identical hatch existed, its comment named the exact transition it
 * was for, and `grep` found no caller. The consequence was total and silent and
 * hit every signed-in reader: a component mounts while signed out, the `/me`
 * call 401s, the fail-closed `false` is CACHED, signing in navigates
 * client-side so the module cache survives — and the feature never appeared
 * until a hard refresh. It was reported as "there is no button", with `/api/me`
 * cheerfully returning `owner: true` to anyone who asked it directly.
 *
 * So this is wired at module scope, the same place `lib/supabase.ts` says such
 * subscriptions belong: once, where the client is owned, rather than several
 * component-level ones that can drift apart.
 */
const listeners = new Set<() => void>()

/** Re-ask after the signed-in identity changes. Returns its own unsubscribe. */
export function onOwnerEntitlementChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

if (isCloudMode) {
  supabase.auth.onAuthStateChange((event) => {
    // `TOKEN_REFRESHED` is the same person with a newer token, so re-asking
    // would be a request per hour that can only ever return what it already
    // returned. Every other event can change who is asking.
    if (event === 'TOKEN_REFRESHED') return
    resetOwnerEntitlement()
    for (const fn of listeners) fn()
  })
}

/**
 * The same answer, for a component that has to render before it arrives.
 *
 * `undefined` means "not known yet", and callers must treat it as HIDE rather
 * than as show — the shell's `signedIn` hook documents the same three-state
 * discipline, and for the stronger reason here: a flash of the scanner's nav
 * row in front of somebody who may not have it is the leak the gate exists to
 * prevent, and it is worse than the row appearing a tick late for the one
 * account that does.
 *
 * One hook call per shell, not one per nav surface: the rail, the header and
 * the mobile drawer all read the same value from `AppShell`, because those
 * three drifted apart once already over a hardcoded `active={false}` (issue
 * #52) and a hidden-ness that only two of them agreed on would be the same bug
 * with worse consequences.
 */
export function useOwnerEntitled(): boolean | undefined {
  const [owner, setOwner] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let live = true
    const ask = () => {
      void ownerEntitled().then((ok) => {
        if (live) setOwner(ok)
      })
    }
    ask()
    // Signing in or out must re-ask; without this the fail-closed `false`
    // cached while signed out survives the client-side navigation into a
    // signed-in session, and the surface never appears until a hard refresh.
    const off = onOwnerEntitlementChange(ask)
    return () => {
      live = false
      off()
    }
  }, [])

  return owner
}
