import type { NextFunction, Request, RequestHandler, Response } from 'express';
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
  return function ownerGate(req: Request, res: Response, next: NextFunction): void {
    if (process.env.VERCEL_ENV !== 'production') {
      next();
      return;
    }
    if (isOwner(req.user?.id)) {
      next();
      return;
    }
    if (refusal === 'not-found') {
      next(new ApiError(404, 'not_found', 'Not found'));
      return;
    }
    res.status(403).json({ error: { code: 'forbidden', message: 'Owner only.' } });
  };
}
