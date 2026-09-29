import { Router } from 'express';
import { q1, q, withTx, commitRequestTx, pool, rlsStore } from '../db.js';
import { adminError, getAccessForUser, hasPermission } from '../admin/access.js';
import { ApiError, asyncHandler, badRequest, notFound } from '../http.js';
import { currentUserId } from '../identity.js';
import { randomBytes } from 'node:crypto';
import { classifyRedirect, grantSchemaReady, type TokenScope } from '@deckpal/db';
async function getClient(id:string) {
 const row=await q1<{client:{clientId:string;clientName:string;redirectUris:string[]}|null}>('SELECT public.admin_connector_client($1) AS client',[id]);
 return row?.client;
}

/**
 * The signed-in half of the OAuth "Connect" flow — showing what a client is
 * asking for and recording the user's decision. Mounted under `/api/oauth`
 * behind `requireSession` (see index.ts): approving a connection mints a new
 * long-lived credential, exactly the class of action that guard exists for
 * (see its doc comment) — a personal access token must never be usable to
 * approve issuing another one.
 *
 * The public half — registration and the code-for-token exchange, which run
 * before any DeckPal session exists — is oauthServer.ts, mounted at the
 * bare origin.
 *
 * Narrow session-only RPCs use the caller's request transaction; no direct
 * OAuth table policy or second pool connection is needed. Code issue and
 * administrative revocation serialize on the same governance lock.
 */
export const oauthRouter: Router = Router();

const S256 = 'S256';

/**
 * GET /oauth/client?client_id=&redirect_uri= — what the consent screen shows
 * before the user decides anything. Re-checked for real at decision time
 * below; this lookup exists so a bad link fails with a clear message instead
 * of a live redirect to nowhere.
 *
 * `clientName` is self-asserted and is returned only so the screen can quote
 * it as a claim. Who is really asking is answered by `redirectHost` and
 * `trust`, worked out here from the redirect (see classifyRedirect), so the
 * browser holds no list of its own to drift from this one.
 */
oauthRouter.get(
  '/client',
  asyncHandler(async (req, res) => {
    const clientId = String(req.query.client_id ?? '');
    const redirectUri = String(req.query.redirect_uri ?? '');
    if (!clientId || !redirectUri) throw badRequest('client_id and redirect_uri are required');

    const client = await getClient(clientId);
    if (!client) throw notFound('Unknown client_id. This connector may not be registered with DeckPal.');
    if (!client.redirectUris.includes(redirectUri)) {
      throw badRequest('redirect_uri does not match what this client registered.');
    }
    const { host, trust, verifiedName } = classifyRedirect(redirectUri);
    const access = await getAccessForUser(currentUserId(req));
    res.json({
      clientName: client.clientName,
      redirectUri,
      redirectHost: host,
      trust,
      verifiedName,
      canGrantDeckeImprovementRead:
        hasPermission(access, 'admin.access') &&
        hasPermission(access, 'decke.improvement.read') &&
        (access.role?.tier ?? 0) >= 40,
    });
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
  scope?: unknown;
  deckeImprovementRead?: unknown;
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
    // Absent means full, which is what every approval meant before the choice
    // existed; anything else present is a mistake, not a default.
    const scope = (str(body.scope) || 'full') as TokenScope;
    if (body.deckeImprovementRead !== undefined && typeof body.deckeImprovementRead !== 'boolean') {
      throw badRequest('deckeImprovementRead must be a boolean');
    }
    const deckeImprovementRead = body.deckeImprovementRead === true;

    if (decision !== 'allow' && decision !== 'deny') throw badRequest('decision must be "allow" or "deny"');
    if (scope !== 'full' && scope !== 'read') throw badRequest('scope must be "full" or "read"');
    if (!clientId || !redirectUri) throw badRequest('clientId and redirectUri are required');

    const client = await getClient(clientId);
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
    // Before migration 075 there is nowhere to record the scope, and quietly
    // minting full access after the person chose read-only would make the
    // consent screen a lie. Say so instead, for the minutes it lasts.
    if (!(await grantSchemaReady(rlsStore.getStore() ?? pool))) {
      throw new ApiError(503, 'unavailable', 'DeckPal is finishing an update. Try connecting again in a few minutes.');
    }
    const code='dsac_'+randomBytes(32).toString('base64url');
    try {
      await withTx(async()=>{
        await q('SELECT public.admin_connector_issue($1,$2,$3,$4,$5,$6)',[code,clientId,redirectUri,codeChallenge,resource??null,scope]);
        if (deckeImprovementRead) {
          await q('SELECT public.decke_improvement_oauth_capability($1,true)', [code]);
        }
      });
      await commitRequestTx(userId);
    } catch(error) { throw adminError(error); }
    res.setHeader('Cache-Control','no-store');
    res.json({ redirectTo: withParams(redirectUri, { code, ...(state ? { state } : {}) }) });
  }),
);
