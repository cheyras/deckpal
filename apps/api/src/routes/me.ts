import { Router } from 'express';
import { q1, SUPABASE_MODE } from '../db.js';
import { asyncHandler, notFound, userCache } from '../http.js';
import { currentUserId } from '../identity.js';

/**
 * GET /me — the caller's own account identity. Currently just `username`
 * (issue #25: the profile page and header chip hardcoded "Trainer").
 *
 * Reads `app_user.username` rather than the JWT's `user_metadata.username`:
 * the signup form (routes/Auth.tsx) never sets that metadata key, so most
 * real accounts have it empty. `app_user.username` is always populated —
 * self-host seeds it once (migration 013), and cloud's `handle_new_user`
 * trigger (migration 021) falls back to the email's local part when no
 * metadata username was supplied — so the DB column is the one place the
 * value is guaranteed to exist.
 */
export const meRouter: Router = Router();

interface UsernameRow {
  username: string;
}

/**
 * Is this account the deployment's owner?
 *
 * Cloud: only the account named by DESIGN_EDITOR_USER_ID (a Supabase auth
 * UUID, set in the Vercel env) — unset means NOBODY, so an owner-only surface
 * can never open up by accident, only fail closed. Self-host: always, because
 * a self-host deployment has exactly one user (the owner) and sits behind the
 * owner's own auth proxy.
 *
 * This lives here, server-side, so the owner's identity is verified against
 * the JWT and never baked into the public JS bundle. A client-side check would
 * be a suggestion, not a gate.
 *
 * The env var keeps its original name because it is already set in production
 * and renaming it would silently close both surfaces on the next deploy. What
 * it means is "the owner"; `designEditor` was simply the first thing that
 * needed one.
 */
function isOwner(userId: string): boolean {
  if (!SUPABASE_MODE) return true;
  const owner = process.env.DESIGN_EDITOR_USER_ID;
  return !!owner && userId === owner;
}

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    userCache(res);
    const userId = currentUserId(req);
    const row = await q1<UsernameRow>('SELECT username FROM app_user WHERE id = $1', [userId]);
    if (!row) throw notFound('No such user');
    const owner = isOwner(userId);
    // `designEditor` is retained for the existing /design gate. `owner` is the
    // same answer under the name that actually describes it, and is what new
    // owner-only surfaces should use.
    res.json({ username: row.username, designEditor: owner, owner });
  }),
);
