import type { Express, Request, Response } from 'express';
import express from 'express';
import { pool, withTx } from './db.js';
import { MAX_ACTIVE_TOKENS } from './routes/tokens.js';
import {
  OAuthValidationError,
  connectionName,
  consumeAuthCode,
  countActiveTokens,
  getClient,
  grantSchemaReady,
  openConnection,
  refreshConnection,
  registerClient,
  verifyPkceS256,
  type IssuedTokens,
} from '@deckpal/db';

/**
 * The public, unauthenticated half of the OAuth 2.1 "Connect" flow —
 * everything an MCP client (claude.ai, ChatGPT, Gemini, Claude Code, …) talks
 * to *before* a DeckPal session exists: discovery metadata, dynamic client
 * registration, and the token exchange.
 *
 * The signed-in half — showing the consent screen and recording the user's
 * decision — is `routes/oauth.ts`, mounted under the normal `/api` base path
 * behind `requireSession` like every other account-administration route.
 *
 * These four routes are mounted at the bare origin (`/register`, `/token`,
 * `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-
 * resource`), NOT under `/api`, because RFC 8414/9728 fix `.well-known` paths
 * relative to the issuer's origin, and because a client that fails metadata
 * discovery historically falls back to guessing conventional paths at the
 * bare origin (issue #29) — putting the real endpoints exactly where a
 * guessing client already looks is the fix, not a workaround for it.
 *
 * `/authorize` itself is deliberately NOT here: a human's browser lands on
 * it, so it is a normal frontend route (apps/web `/authorize`) served by the
 * existing SPA catch-all, not a JSON endpoint.
 */

function originFor(req: Request): string {
  const configured = process.env.DECKPAL_PUBLIC_ORIGIN;
  if (configured) return configured.replace(/\/+$/, '');
  const host = req.headers.host ?? 'localhost';
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

const DEFAULT_ALLOWED_HOSTS = 'deckpal.app,www.deckpal.app,localhost,127.0.0.1';

/** Same allowlist concern as apps/mcp/src/cloud.ts's hostAllowed — these routes mint URLs FROM the Host header, so an unrecognised host must not be trusted with that. */
function hostAllowed(req: Request): boolean {
  const list = (process.env.MCP_ALLOWED_HOSTS ?? DEFAULT_ALLOWED_HOSTS)
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (list.includes('*')) return true;
  const raw = (req.headers.host ?? '').toLowerCase();
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.slice(0, raw.lastIndexOf(':') === -1 ? undefined : raw.lastIndexOf(':'));
  if (host.endsWith('.vercel.app')) return true;
  return list.includes(host);
}

function oauthError(res: Response, status: number, error: string, description?: string): void {
  res.status(status).json(description ? { error, error_description: description } : { error });
}

/** Mount the four public OAuth endpoints directly on `app` (root, not under basePath). Call only when SUPABASE_MODE. */
export function mountOAuthServer(app: Express): void {
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    if (!hostAllowed(req)) {
      res.status(421).json({ error: { code: 'bad_host', message: 'Host not allowed' } });
      return;
    }
    const origin = originFor(req);
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      // Not a permission DeckPal checks: Claude asks for a refresh token by
      // adding `offline_access` to its request only when it is listed here
      // (Anthropic's connector auth docs), and every connection has one.
      scopes_supported: ['offline_access'],
    });
  });

  app.get('/.well-known/oauth-protected-resource', (req, res) => {
    if (!hostAllowed(req)) {
      res.status(421).json({ error: { code: 'bad_host', message: 'Host not allowed' } });
      return;
    }
    const origin = originFor(req);
    res.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
    });
  });

  // POST /register — RFC 7591 dynamic client registration. Public by design:
  // any MCP client self-registers before it has ever seen a DeckPal user.
  app.post('/register', express.json({ limit: '16kb' }), (req, res) => {
    void (async () => {
      if (!hostAllowed(req)) {
        res.status(421).json({ error: { code: 'bad_host', message: 'Host not allowed' } });
        return;
      }
      const body = (req.body ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
      try {
        const client = await registerClient(pool, {
          clientName: typeof body.client_name === 'string' ? body.client_name : undefined,
          redirectUris: Array.isArray(body.redirect_uris) ? (body.redirect_uris as unknown[]).filter((u): u is string => typeof u === 'string') : [],
        });
        res.status(201).json({
          client_id: client.clientId,
          client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
          client_name: client.clientName,
          redirect_uris: client.redirectUris,
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        });
      } catch (err) {
        if (err instanceof OAuthValidationError) {
          oauthError(res, 400, 'invalid_client_metadata', err.message);
          return;
        }
        console.error('[deckpal-api] /register failed:', (err as Error).message);
        oauthError(res, 500, 'server_error');
      }
    })();
  });

  // POST /token — RFC 6749 §3.2 token endpoint. Traditionally
  // application/x-www-form-urlencoded; some clients send JSON, so both parsers
  // are mounted and whichever matches Content-Type does the work. Two grants:
  // the first exchange of a consent code, and every renewal after it.
  app.post(
    '/token',
    express.urlencoded({ extended: false, limit: '16kb' }),
    express.json({ limit: '16kb' }),
    (req, res) => {
      void (async () => {
        if (!hostAllowed(req)) {
          res.status(421).json({ error: { code: 'bad_host', message: 'Host not allowed' } });
          return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const str = (v: unknown): string => (typeof v === 'string' ? v : '');

        const grantType = str(body.grant_type);
        if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
          oauthError(res, 400, 'unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
          return;
        }
        const clientId = str(body.client_id);
        const code = str(body.code);
        const redirectUri = str(body.redirect_uri);
        const codeVerifier = str(body.code_verifier);
        const refreshToken = str(body.refresh_token);
        if (grantType === 'authorization_code' && (!code || !redirectUri || !clientId || !codeVerifier)) {
          oauthError(res, 400, 'invalid_request', 'code, redirect_uri, client_id and code_verifier are all required.');
          return;
        }
        if (grantType === 'refresh_token' && !refreshToken) {
          oauthError(res, 400, 'invalid_request', 'refresh_token is required.');
          return;
        }

        try {
          res.setHeader('Cache-Control', 'no-store');
          if (!(await grantSchemaReady(pool))) {
            oauthError(res, 503, 'temporarily_unavailable', 'DeckPal is finishing an update. Try connecting again in a few minutes.');
            return;
          }
          const outcome: { tokens?: IssuedTokens; error?: string } =
            grantType === 'refresh_token'
              ? await withTx(async (db) => {
                  // No governance lock: a renewal mints no api_token row, and
                  // every secret it issues resolves through that row, so a
                  // revoke committed at any moment still ends it.
                  const refreshed = await refreshConnection(db, { refreshToken, clientId });
                  return refreshed.ok ? { tokens: refreshed.tokens } : { error: 'Unknown, expired, revoked, or already-used refresh token.' };
                })
              : await withTx(async (db) => {
                  // Serialize exchange with admin revocation/suspension, including
                  // the code that was issued before an owner clicked Revoke.
                  await db.query('SELECT pg_advisory_xact_lock(741290064)');
                  const consumed = await consumeAuthCode(db, code);
                  if (!consumed) return { error: 'Unknown, expired, revoked, or already-used code.' };
                  if (consumed.clientId !== clientId || consumed.redirectUri !== redirectUri) {
                    return { error: 'The authorization request does not match.' };
                  }
                  if (!verifyPkceS256(codeVerifier, consumed.codeChallenge)) {
                    return { error: 'The code verifier does not match.' };
                  }
                  if ((await countActiveTokens(db, consumed.userId)) >= MAX_ACTIVE_TOKENS) {
                    return { error: 'The account has the maximum number of active connectors.' };
                  }
                  const client = await getClient(db, clientId);
                  const tokens = await openConnection(db, {
                    userId: consumed.userId,
                    name: connectionName(client?.clientName, consumed.redirectUri),
                    clientId,
                    redirectUri: consumed.redirectUri,
                    scope: consumed.scope,
                  });
                  return { tokens };
                });
          if (!outcome.tokens) {
            oauthError(res, 400, 'invalid_grant', outcome.error);
            return;
          }
          // Return bearer credentials only after their transaction has committed.
          res.status(200).json({
            access_token: outcome.tokens.accessToken,
            token_type: 'Bearer',
            expires_in: outcome.tokens.expiresIn,
            refresh_token: outcome.tokens.refreshToken,
          });
        } catch (err) {
          console.error('[deckpal-api] /token failed:', (err as Error).message);
          oauthError(res, 500, 'server_error');
        }
      })();
    },
  );
}
