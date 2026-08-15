import { Router } from 'express';
import { pool, rlsStore } from '../db.js';
import { asyncHandler, badRequest, notFound, userCache } from '../http.js';
import { currentUserId } from '../identity.js';
import { createToken, listTokens, revokeToken, type Queryable } from '@deckpal/db';

/**
 * Personal access tokens — `/tokens` (migration 026).
 *
 * Mounted behind `requireSession` (see index.ts), so a token can never be used
 * to mint or revoke another token: only a real browser session reaches here.
 *
 * All three handlers run on whatever client the request already owns — the
 * per-request RLS transaction in SUPABASE_MODE, the plain pool otherwise — so
 * the `WHERE user_id = $1` in every statement is backed by an RLS policy
 * rather than trusted on its own.
 */
export const tokensRouter: Router = Router();

const MAX_NAME_LEN = 60;
/** Enough for a lifetime of clients; a cheap stop on runaway automation. */
const MAX_ACTIVE_TOKENS = 20;

/** The RLS transaction client when one is active, else the shared pool. */
function db(): Queryable {
  return rlsStore.getStore() ?? pool;
}

// The acting user comes from currentUserId(req), the same seam every other
// router uses: the verified JWT subject in cloud, the single local user in
// self-host. This file used to carry its own `userId ?? defaultUserId()`
// fallback — the only route that survived the cloud pivot working, and the
// reason the breakage in its siblings was easy to miss.

// GET /tokens — list, newest first. Never returns a secret.
tokensRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    userCache(res);
    const userId = currentUserId(req);
    res.json({ tokens: await listTokens(db(), userId) });
  }),
);

// POST /tokens { name } — mint. The raw value is in this response and nowhere else.
tokensRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw badRequest('name is required');
    if (name.length > MAX_NAME_LEN) throw badRequest(`name must be ${MAX_NAME_LEN} characters or fewer`);

    const userId = currentUserId(req);
    const existing = await listTokens(db(), userId);
    if (existing.filter((t) => !t.revokedAt).length >= MAX_ACTIVE_TOKENS) {
      throw badRequest(`You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`);
    }

    const created = await createToken(db(), userId, name);
    userCache(res);
    // 201 with the one and only copy of the secret.
    res.status(201).json({ token: created.token, secret: created.raw });
  }),
);

// DELETE /tokens/:id — revoke. Idempotent; a second call is still 200.
tokensRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    // Reject junk before it reaches Postgres, where a malformed UUID is a
    // 22P02 error rather than "no such row".
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw notFound('No such token');
    }
    const userId = currentUserId(req);
    const revoked = await revokeToken(db(), userId, id);
    if (!revoked) throw notFound('No such token');
    userCache(res);
    res.json({ token: revoked });
  }),
);
