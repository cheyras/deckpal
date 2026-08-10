import { Router } from 'express';
import { pool } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../http.js';
import { currentUserId } from '../identity.js';
import { createAuthCode, getClient } from '@deckscout/db';

/**
 * The signed-in half of the OAuth "Connect" flow — showing what a client is
 * asking for and recording the user's decision. Mounted under `/api/oauth`
 * behind `requireSession` (see index.ts): approving a connection mints a new
 * long-lived credential, exactly the class of action that guard exists for
 * (see its doc comment) — a personal access token must never be usable to
 * approve issuing another one.
 *
 * The public half — registration and the code-for-token exchange, which run
 * before any DeckScout session exists — is oauthServer.ts, mounted at the
 * bare origin.
 *
 * Deliberately queries `pool` directly, never the per-request RLS client:
 * `oauth_client`/`oauth_code` (migration 033) enable RLS with ZERO policies —
 * every role but the pool's own (which bypasses RLS as table owner) is
 * default-denied, on purpose (see 033's comment). Routing through the RLS
 * client here would run as `authenticated`, which that migration means to
 * block — client lookup would always come back empty and code creation would
 * fail RLS outright. Safety instead comes from `requireSession` plus
 * `currentUserId(req)`, exactly as designed.
 */
export const oauthRouter: Router = Router();

const S256 = 'S256';

/**
 * GET /oauth/client?client_id=&redirect_uri= — what the consent screen shows
 * before the user decides anything. Re-checked for real at decision time
 * below; this lookup exists so a bad link fails with a clear message instead
 * of a live redirect to nowhere.
 */
oauthRouter.get(
  '/client',
  asyncHandler(async (req, res) => {
    const clientId = String(req.query.client_id ?? '');
    const redirectUri = String(req.query.redirect_uri ?? '');
    if (!clientId || !redirectUri) throw badRequest('client_id and redirect_uri are required');

    const client = await getClient(pool, clientId);
    if (!client) throw notFound('Unknown client_id. This connector may not be registered with DeckScout.');
    if (!client.redirectUris.includes(redirectUri)) {
      throw badRequest('redirect_uri does not match what this client registered.');
    }
    res.json({ clientName: client.clientName, redirectUri });
  }),
);

interface DecisionBody {
  decision?: unknown;
  responseType?: unknown;
  clientId?: unknown;
  redirectUri?: unknown;
  codeChallenge?: unknown;
  codeChallengeMethod?: unknown;
  state?: unknown;
  resource?: unknown;
}

/** Append `code`/`error` + `state` onto redirectUri without clobbering a query string it may already carry. */
function withParams(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * POST /oauth/authorize/decision — the consent screen's Allow/Deny action.
 *
 * Every parameter is re-validated against the database here, never trusted
 * from the frontend: `client_id` must exist, `redirect_uri` must be an exact
 * match for one this client registered (the anti-open-redirect control), and
 * PKCE must specify S256. A request that fails any of THOSE checks gets a 400
 * with no redirect — we cannot safely bounce the browser to a redirect_uri we
 * have not just verified belongs to this client. Once redirect_uri is
 * verified, a deny (or a later-stage error) redirects back to it with
 * `error=...&state=...`, which is the client's problem to handle, not ours.
 */
oauthRouter.post(
  '/authorize/decision',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as DecisionBody;
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');

    const decision = str(body.decision);
    const clientId = str(body.clientId);
    const redirectUri = str(body.redirectUri);
    const responseType = str(body.responseType);
    const codeChallenge = str(body.codeChallenge);
    const codeChallengeMethod = str(body.codeChallengeMethod);
    const state = str(body.state);
    const resource = str(body.resource) || undefined;

    if (decision !== 'allow' && decision !== 'deny') throw badRequest('decision must be "allow" or "deny"');
    if (!clientId || !redirectUri) throw badRequest('clientId and redirectUri are required');

    const client = await getClient(pool, clientId);
    if (!client) throw notFound('Unknown client_id');
    if (!client.redirectUris.includes(redirectUri)) {
      // Deliberately not a redirect: redirectUri is exactly what we cannot trust yet.
      throw badRequest('redirect_uri does not match what this client registered');
    }

    if (decision === 'deny') {
      res.json({ redirectTo: withParams(redirectUri, { error: 'access_denied', ...(state ? { state } : {}) }) });
      return;
    }

    if (responseType !== 'code') {
      res.json({ redirectTo: withParams(redirectUri, { error: 'unsupported_response_type', ...(state ? { state } : {}) }) });
      return;
    }
    if (!codeChallenge || codeChallengeMethod !== S256) {
      res.json({ redirectTo: withParams(redirectUri, { error: 'invalid_request', error_description: 'PKCE S256 code_challenge is required', ...(state ? { state } : {}) }) });
      return;
    }

    const userId = currentUserId(req);
    const { code } = await createAuthCode(pool, { clientId, userId, redirectUri, codeChallenge, resource });
    res.json({ redirectTo: withParams(redirectUri, { code, ...(state ? { state } : {}) }) });
  }),
);
