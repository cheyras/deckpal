/**
 * Who may talk to Deck-E — decided on the SERVER.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * The hole this closes
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `apps/web/src/character/host/entitlement.ts` already answers this question,
 * and answers it correctly — but it runs in the browser, so what it actually
 * decides is whether to render a button. `POST /api/chat` checked only that the
 * Supabase JWT was valid. Verified against the deployed endpoint: an ordinary
 * signed-in account got a full model turn, billed to the owner's Gateway key,
 * by asking for one.
 *
 * That was survivable while the answer cost $0.000143. It stops being
 * survivable the moment this endpoint can invoke Claude sub-agents, live web
 * research and write tools — which is the whole point of the work that follows.
 * So the client gate stays (it is what makes the UI honest), and this becomes
 * the gate that means anything.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * A LIST, not a single id — and that is a requirement, not a convenience
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The obvious implementation is "is this `DESIGN_EDITOR_USER_ID`". It is also
 * unverifiable, and the plan this file belongs to has sixteen browser gates
 * that all begin "sign in and ask Deck-E…".
 *
 * The QA account (`.qa-account`, AGENTS.md B12) is deliberately an ordinary
 * user, so an owner-only gate renders nothing for it. The only account that
 * could run the gates would be the owner's own — whose collection is real data,
 * and two of the gates WRITE. B12 exists to stop exactly that.
 *
 * So entitlement is a set: the owner, plus anyone named in
 * `DECKE_ENTITLED_USER_IDS`. That variable is what lets a gate account exist
 * without being the owner, and it is the mechanism by which this feature can be
 * opened to more people later without a code change.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * B11, applied rather than cited
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `DECKE_ENTITLED_USER_IDS` is declared in `DEPLOYMENT.md` in the same commit
 * that reads it, and its state is reported on `GET /api/health` as
 * `deckeEntitlement` — never its contents, which are user ids and which
 * `/health` is unauthenticated to. Unset means "owner only", which is a real,
 * intentional configuration rather than a failure, so it is reported as
 * `owner-only` rather than as `unset`.
 */

const SUPABASE_MODE = !!process.env.SUPABASE_MODE

/** The one place the variable name is spelled. */
export const DECKE_ENTITLED_VAR = 'DECKE_ENTITLED_USER_IDS'

/**
 * Parse the list.
 *
 * Comma-separated, whitespace-tolerant, empties dropped. Read on every call
 * rather than cached at module load, and the honest reason is that it costs
 * nothing — not the "a serverless instance can outlive a configuration change"
 * this comment used to give. As `build.ts` records, an instance belongs to one
 * immutable deployment and its environment cannot change underneath it, so
 * per-call and module-load are indistinguishable here.
 */
function extraEntitled(): string[] {
  return (process.env[DECKE_ENTITLED_VAR] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * May this account use Deck-E?
 *
 * Self-host is always yes — one user, behind their own reverse proxy, same
 * reasoning the client gate and the `/dev/decke` route guard already use.
 *
 * Cloud fails CLOSED: an unset owner variable and an unset list mean nobody,
 * which is the posture the B11 postmortem concluded was right. The bug there
 * was invisibility, not fail-closed — so see `deckeEntitlementStatus()`.
 */
export function isDeckeEntitled(userId: string): boolean {
  if (!SUPABASE_MODE) return true
  if (!userId) return false
  const owner = process.env.DESIGN_EDITOR_USER_ID
  if (owner && userId === owner) return true
  return extraEntitled().includes(userId)
}

export type DeckeEntitlementStatus =
  /** Self-host: one user, no gate to report. */
  | 'self-host'
  /** Cloud, no owner and no list: Deck-E is shut to everyone. */
  | 'nobody'
  /** Cloud, owner only. The intended default while this is a dark launch. */
  | 'owner-only'
  /** Cloud, owner plus a named list. */
  | 'owner-plus-list'

/**
 * NEVER returns the ids. `/health` is unauthenticated, and a list of user
 * UUIDs is exactly the kind of thing that should not be readable from it. The
 * caller wants to know whether the gate is configured, which is a different
 * question from who is behind it.
 */
export function deckeEntitlementStatus(): DeckeEntitlementStatus {
  if (!SUPABASE_MODE) return 'self-host'
  const owner = !!process.env.DESIGN_EDITOR_USER_ID
  const extra = extraEntitled().length
  if (!owner && !extra) return 'nobody'
  return extra > 0 ? 'owner-plus-list' : 'owner-only'
}

/** How many accounts are entitled beyond the owner. A count is not an identity. */
export function deckeEntitledCount(): number {
  return extraEntitled().length
}

/** The boot line. Returns null when there is nothing worth saying. */
export function deckeEntitlementWarning(): string | null {
  if (deckeEntitlementStatus() !== 'nobody') return null
  return (
    `[deckpal-api] Neither DESIGN_EDITOR_USER_ID nor ${DECKE_ENTITLED_VAR} is set — ` +
    `POST /api/chat will refuse EVERY account with 403. That is the correct ` +
    `fail-closed default; it is only a problem if you expected Deck-E to work.`
  )
}
