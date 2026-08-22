import type { Api } from './api.js';
import type { Queryable } from './db.js';

/**
 * Tool context — everything a tool needs that is not a tool argument.
 *
 * Three callers build it three different ways, and the whole point of this
 * interface is that the tools cannot tell which one they are running under:
 *
 *  • **Self-host MCP** (`apps/mcp/src/index.ts`): built once at startup. `db` is
 *    the process pool, `userId` is the single default user, `api` is
 *    unauthenticated (the reverse proxy is the auth boundary). Shared by every
 *    request.
 *
 *  • **Cloud MCP** (`apps/mcp/src/cloud.ts`): built per request from the
 *    caller's personal access token. `db` is the client already inside that
 *    user's RLS transaction, `userId` is the token's owner, and `api` carries
 *    the token so the REST side resolves the same identity.
 *
 *  • **Deck-E**, the in-app agent, which reaches the same tools through the
 *    other adapter over this same interface.
 *
 * Tools are written against this interface only, so they are identical in all
 * of them.
 *
 * ## Why there is no `config` here any more
 *
 * The MCP server's `Ctx` used to carry `config: McpConfig` — `{ port, key,
 * apiBase }`. Not one of the 23 tools ever read it: `port` and `key` are the
 * self-host listener's business, and `apiBase` is already baked into the `Api`
 * instance by the time a tool sees it. Carrying it here meant every caller had
 * to invent a port and a shared secret to satisfy the type — `cloud.ts` was
 * literally passing `{ port: 0, key: '' }` with a comment explaining that it
 * never listens. `McpConfig` now lives with the server that has a socket
 * (`apps/mcp/src/ctx.ts`), and this interface is the three fields a tool
 * actually uses.
 */
export interface Ctx {
  /** Pool (self-host) or the request's RLS-scoped client (cloud). */
  db: Queryable;
  api: Api;
  /**
   * `app_user.id` — a UUID since migration 020. Every user-scoped query passes
   * it as a bind parameter; in the cloud it is additionally enforced by RLS.
   */
  userId: string;
}
