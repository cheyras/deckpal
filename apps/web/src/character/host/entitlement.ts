/**
 * Who gets Deck-E.
 *
 * ONE CHOKE POINT, deliberately. Every entry point to the character — the
 * floating button, the chat overlay, the scan augmentation — asks this and
 * nothing else. When the paid tier exists, this file changes and they do not.
 *
 * TODAY IT IS A DARK LAUNCH, and it reuses the owner gate rather than inventing
 * a flag. That is not laziness, it is contract B11: a feature whose behaviour
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
import { isCloudMode } from '../../lib/supabase'

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
  // Self-host has exactly one user, behind their own reverse proxy. Same
  // reasoning as the `/dev/decke` route guard, kept identical on purpose.
  if (!isCloudMode) return true
  const me = await api.me()
  return me.owner === true
}

/** Test seam, and the escape hatch for a signed-out → signed-in transition. */
export function resetDeckeEntitlement(): void {
  cached = null
}
