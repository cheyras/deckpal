import type { Express, Request, Response } from 'express';
import express from 'express';
import { pool } from './db.js';
import {
  OAuthValidationError,
  consumeAuthCode,
  createToken,
  getClient,
  registerClient,
  verifyPkceS256,
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

const TOKEN_TTL_HINT = undefined; // access_token does not expire; omit expires_in (RFC 6749 §5.1 — absent means unspecified lifetime).
const MAX_ACTIVE_TOKENS = 20; // mirrors routes/tokens.ts

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
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
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
          grant_types: ['authorization_code'],
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
  // are mounted and whichever matches Content-Type does the work.
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
        if (grantType !== 'authorization_code') {
          oauthError(res, 400, 'unsupported_grant_type', 'Only authorization_code is supported.');
          return;
        }
        const code = str(body.code);
        const redirectUri = str(body.redirect_uri);
        const clientId = str(body.client_id);
        const codeVerifier = str(body.code_verifier);
        if (!code || !redirectUri || !clientId || !codeVerifier) {
          oauthError(res, 400, 'invalid_request', 'code, redirect_uri, client_id and code_verifier are all required.');
          return;
        }

        let consumed;
        try {
          consumed = await consumeAuthCode(pool, code);
        } catch (err) {
          console.error('[deckpal-api] /token code lookup failed:', (err as Error).message);
          oauthError(res, 500, 'server_error');
          return;
        }
        if (!consumed) {
          oauthError(res, 400, 'invalid_grant', 'Unknown, expired, or already-used code.');
          return;
        }
        // Every field the code was minted with must match what the client is
        // presenting now — this is what stops a code stolen in transit (or a
        // client impersonating another) from being redeemed elsewhere.
        if (consumed.clientId !== clientId || consumed.redirectUri !== redirectUri) {
          oauthError(res, 400, 'invalid_grant', 'client_id or redirect_uri does not match the authorization request.');
          return;
        }
        if (!verifyPkceS256(codeVerifier, consumed.codeChallenge)) {
          oauthError(res, 400, 'invalid_grant', 'code_verifier does not match the original code_challenge.');
          return;
        }

        try {
          const client = await getClient(pool, clientId);
          const name = `${client?.clientName ?? 'MCP client'} (OAuth)`.slice(0, 60);

          const { rows: activeRows } = await pool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM api_token WHERE user_id = $1 AND revoked_at IS NULL`,
            [consumed.userId],
          );
          if (Number(activeRows[0]?.count ?? '0') >= MAX_ACTIVE_TOKENS) {
            oauthError(res, 400, 'temporarily_unavailable', 'This account already has the maximum number of active tokens. Revoke one in Profile → Agent access first.');
            return;
          }

          const created = await createToken(pool, consumed.userId, name);
          res.status(200).json({
            access_token: created.raw,
            token_type: 'Bearer',
            ...(TOKEN_TTL_HINT !== undefined ? { expires_in: TOKEN_TTL_HINT } : {}),
          });
        } catch (err) {
          console.error('[deckpal-api] /token mint failed:', (err as Error).message);
          oauthError(res, 500, 'server_error');
        }
      })();
    },
  );
}
