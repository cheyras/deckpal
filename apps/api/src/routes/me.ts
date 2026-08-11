import { Router } from 'express';
import { q1 } from '../db.js';
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

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    userCache(res);
    const userId = currentUserId(req);
    const row = await q1<UsernameRow>('SELECT username FROM app_user WHERE id = $1', [userId]);
    if (!row) throw notFound('No such user');
    res.json({ username: row.username });
  }),
);
