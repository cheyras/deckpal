import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { DECKE_ENTITLED_VAR } from './decke/entitlement.js';
import { ApiError } from './http.js';

/**
 * Who the deployment's owner is, and the middleware that keeps a route to them.
 *
 * ── ONE DEFINITION, BECAUSE THREE COPIES WAS ALREADY ONE TOO MANY ────────────
 *
 * `routes/me.ts` had this identity check, `dev/scanFlags.ts` had a second copy
 * with a comment admitting it was duplicated ("kept in sync by hand") because
 * the first was not exported, and the scanner's own gate would have been a
 * third. A gate that decides who may reach a surface is exactly the thing that
 * must not exist in three places that can disagree — the disagreement is
 * invisible from any one of them, which is the shape of the Deck-E hole
 * (`decke/entitlement.ts`) that made this codebase write that lesson down.
 *
 * The env var keeps its original name, `DESIGN_EDITOR_USER_ID`, because it is
 * already set in production and renaming it would silently close every
 * owner-only surface on the next deploy. What it MEANS is "the owner";
 * `/design` was simply the first surface that needed one.
 */

/**
 * Which deployment tier this is, read per call rather than at module load.
 *
 * `db.ts` exports a `SUPABASE_MODE` constant captured once at import, and this
 * module deliberately does not use it. Two reasons, and the second is the real
 * one:
 *
 *  - **Testability.** A module-load capture cannot be varied, so the cloud
 *    branch of an owner gate would be untestable in a self-host test process and
 *    the self-host branch untestable in a cloud one. Half of `ownerGate.test.ts`
 *    would skip depending on how the runner happened to be started — which is
 *    the shape of a suite that looks green and checks nothing.
 *  - **It costs nothing, and nothing else changes.** As `decke/entitlement.ts`
 *    records for its own per-call read: a serverless instance belongs to one
 *    immutable deployment and its environment cannot change underneath it, so
 *    per-call and module-load are indistinguishable at runtime.
 *
 * Not importing `db.js` also keeps this module free of a database import, which
 * is what lets its tests run in the pure (no-DB) suite.
 */
function supabaseMode(): boolean {
  return !!process.env.SUPABASE_MODE;
}

/**
 * Is this account the deployment's owner?
 *
 * Cloud: only the account named by `DESIGN_EDITOR_USER_ID` (a Supabase auth
 * UUID, set in the Vercel env). **Unset means NOBODY** — an owner-only surface
 * can never open up by accident, only fail closed.
 *
 * Self-host: always, because a self-host deployment has exactly one user (the
 * owner) sitting behind the owner's own auth proxy.
 *
 * This lives server-side so the owner's identity is checked against the
 * verified JWT subject and never baked into the public JS bundle. A
 * client-side check would be a suggestion, not a gate.
 */
export function isOwner(userId: string | undefined | null): boolean {
  if (!supabaseMode()) return true;
  const owner = process.env.DESIGN_EDITOR_USER_ID;
  return !!owner && !!userId && userId === owner;
}

/**
 * Whether an owner is configured at all — NOT who it is.
 *
 * Exported so `/health` can report it and boot can warn about it. "Unset means
 * nobody" is the right default, but it used to be a SILENT default: `/design`
 * shipped gated on this variable on 2026-08-14, the variable was never set in
 * Vercel, and nothing anywhere said so. It was found four days later only
 * because `/dev/decke` reused the same gate and someone went looking. See
 * AGENTS.md B11.
 */
export function ownerGateStatus(): 'configured' | 'unset' | 'self-host' {
  if (!supabaseMode()) return 'self-host';
  return process.env.DESIGN_EDITOR_USER_ID ? 'configured' : 'unset';
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * The labeler set — the owner PLUS the QA account
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Decided by @cheyras 2026-09-08: the quad training surface is to be live on
 * production for the owner's account AND the QA account, while `/scan` itself
 * stays owner-only.
 *
 * WHY THIS IS NOT `isOwner`. AGENTS.md B12 says browser verification signs in
 * as QA, never the owner, because the writes are real. An owner-only labeler
 * therefore renders Not Found for the only account that is supposed to drive
 * it — round 9 of the labeler work measured exactly that and the surface was
 * unusable. This is the same argument `decke/entitlement.ts` already wrote
 * down for `POST /api/chat`, and it reaches the same shape: a SET, not an id.
 *
 * WHY IT FALLS BACK TO DECK-E'S LIST. `DECKE_ENTITLED_USER_IDS` is already set
 * in production and already contains the owner plus the QA account, so
 * inheriting it makes this work on the next deploy with no Vercel change —
 * which matters, because a gate that needs a config step nobody performs is
 * the B11 failure this codebase has already had once (`/design` shipped gated
 * on a variable that was never set, and nothing said so for four days).
 *
 * THE COUPLING IS REAL AND IS THE PRICE. Widening Deck-E later would widen the
 * labeler too. `LABELER_ENTITLED_USER_IDS` exists so that can be undone
 * without a code change: set it, and Deck-E's list stops being consulted.
 */

/** The one place the labeler variable name is spelled. */
export const LABELER_ENTITLED_VAR = 'LABELER_ENTITLED_USER_IDS';

/** Comma-separated, whitespace-tolerant, empties dropped — the same parse
 *  `decke/entitlement.ts` documents, applied to whichever variable is in
 *  force. Read per call for the reason `supabaseMode()` gives above. */
function idList(varName: string): string[] {
  return (process.env[varName] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Which variable actually decides. The dedicated one wins WHEN SET AND
 *  NON-EMPTY; a variable set to an empty string is a typo, not a decision to
 *  shut the surface, and treating it as the latter would silently lock the
 *  owner out of their own tool. */
function labelerVar(): string {
  return idList(LABELER_ENTITLED_VAR).length ? LABELER_ENTITLED_VAR : DECKE_ENTITLED_VAR;
}

/**
 * May this account open the quad training surface and write labels?
 *
 * Self-host: always, same one-user-behind-their-own-proxy reasoning `isOwner`
 * gives. Cloud: the owner, or an id in the governing list. Fails CLOSED — no
 * owner and no list means nobody.
 */
export function isLabelerEntitled(userId: string | undefined | null): boolean {
  if (!supabaseMode()) return true;
  if (!userId) return false;
  if (isOwner(userId)) return true;
  return idList(labelerVar()).includes(userId);
}

export type LabelerEntitlementStatus =
  /** Self-host: one user, no gate to report. */
  | 'self-host'
  /** Cloud, no owner and no list: the labeler is shut to everyone. */
  | 'nobody'
  /** Cloud, owner only — no list is set anywhere. */
  | 'owner-only'
  /** Cloud, owner plus `LABELER_ENTITLED_USER_IDS`. */
  | 'owner-plus-list'
  /** Cloud, owner plus Deck-E's list, inherited because no dedicated one is set. */
  | 'owner-plus-decke-list';

/**
 * NEVER returns the ids, for `deckeEntitlementStatus()`'s reason: `/health` is
 * unauthenticated and a list of user UUIDs is not a thing to serve from it.
 */
export function labelerEntitlementStatus(): LabelerEntitlementStatus {
  if (!supabaseMode()) return 'self-host';
  const owner = !!process.env.DESIGN_EDITOR_USER_ID;
  const dedicated = idList(LABELER_ENTITLED_VAR).length;
  const inherited = idList(DECKE_ENTITLED_VAR).length;
  if (!owner && !dedicated && !inherited) return 'nobody';
  if (dedicated) return 'owner-plus-list';
  if (inherited) return 'owner-plus-decke-list';
  return 'owner-only';
}

/** How a gated route answers somebody who is not the owner. */
export type OwnerRefusal = 'forbidden' | 'not-found';

/**
 * Owner-only **on production**, open everywhere else.
 *
 * Non-production Vercel deployments (preview, and unset for self-host and a
 * local `pnpm dev`) pass through unconditionally: a preview is already fronted
 * by Vercel SSO or has no auth boundary at all, and self-host has no Supabase
 * identity to resolve. Production requires the verified JWT subject
 * (`authMiddleware` has already run; `req.user` is never client-supplied) to
 * be the owner.
 *
 * **`refusal` is a real choice, not a style.** `forbidden` (403) says "this
 * exists and you may not have it" — right for `/dev/scan-flags`, an operator
 * tool whose existence is documented and uninteresting. `not-found` (404) says
 * nothing at all, which is what an owner-gated PRODUCT surface owes: the
 * scanner is gated because the owner asked for it to be invisible, and a 403
 * would confirm to every prober that deckpal.app has a scanner endpoint behind
 * a door. It matches the route gate on the web side, which throws `notFound()`
 * for the same reason.
 */
export function ownerOnlyInProduction(refusal: OwnerRefusal = 'forbidden'): RequestHandler {
  return entitledOnlyInProduction(isOwner, refusal, 'Owner only.');
}

/**
 * The labeler set, same production-only posture — `/dev/scan-flags`, which is
 * the ONLY path a saved label takes (`scan/labeler/saveLabel.ts` posts through
 * `api.scanFlag`). Gating the route in the browser and not this would give the
 * QA account a surface that labels happily and 403s on every save, which is
 * the Deck-E hole inverted: a client that is more permissive than its server
 * rather than less.
 *
 * `forbidden`, not `not-found`, for the reason the existing gate here gives:
 * this is a documented operator tool whose existence is uninteresting. Only
 * the SCANNER owes a 404.
 */
export function labelerOnlyInProduction(refusal: OwnerRefusal = 'forbidden'): RequestHandler {
  return entitledOnlyInProduction(isLabelerEntitled, refusal, 'Labeler access only.');
}

/**
 * The shared body of both gates.
 *
 * Written once rather than twice for the reason this module exists at all: the
 * three hand-synced copies of `isOwner` are what motivated it, and two copies
 * of "which tier is this, and how do I refuse" would be the same mistake one
 * level up. The predicate is the only thing that varies.
 */
function entitledOnlyInProduction(
  entitled: (userId: string | undefined | null) => boolean,
  refusal: OwnerRefusal,
  message: string,
): RequestHandler {
  return function entitlementGate(req: Request, res: Response, next: NextFunction): void {
    if (process.env.VERCEL_ENV !== 'production') {
      next();
      return;
    }
    if (entitled(req.user?.id)) {
      next();
      return;
    }
    if (refusal === 'not-found') {
      next(new ApiError(404, 'not_found', 'Not found'));
      return;
    }
    res.status(403).json({ error: { code: 'forbidden', message } });
  };
}
