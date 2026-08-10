import type { Request, RequestHandler } from 'express';
import type { AuthUser } from './auth.js';
import { ApiError } from './http.js';

/**
 * Request identity — the single seam between "who is calling" and "whose rows
 * do I read/write", valid in both deployments.
 *
 * DeckScout ships two deployments with two different answers to "who is the
 * current user?":
 *
 *  • **Cloud** — the authenticated subject of a verified Supabase JWT (or of a
 *    personal access token resolved against `api_token`). Nothing else. There
 *    is no ambient user; an unauthenticated request to a user-scoped route is
 *    a 401.
 *
 *  • **Self-host** — the single local user (`app_user` ordered by id, first
 *    row). Self-host has no built-in authentication by design: it sits behind a
 *    reverse proxy that is the auth boundary (SECURITY.md). This is the
 *    historical `defaultUserId()` semantics, and it is the same rule
 *    `apps/mcp/src/ctx.ts` applies when it builds the self-host context.
 *
 * Routes must never branch on that difference. {@link makeResolveIdentity}
 * runs once per request ahead of every user-scoped router and settles it, and
 * {@link currentUserId} is the **only** supported way for a route to read the
 * answer.
 *
 * ## Why routes must not read `req.user` directly
 *
 * `req.user` is optional by necessity — public routes (`/health`, `/search`)
 * and the anonymous bug reporter legitimately run without one. During the
 * cloud pivot ~30 routes were rewritten from `await defaultUserId()` to
 * `req.user!.id`. In cloud that is correct. In self-host `authMiddleware` is
 * deliberately a no-op, so `req.user` is `undefined`, the non-null assertion
 * erases at compile time, and every one of those routes passed `undefined`
 * into a `WHERE user_id = $1` — a 500 on `/insights/overview` and on every
 * collection and deck write. TypeScript could not catch it: `!` is precisely
 * the escape hatch that switches the type checker off.
 *
 * A non-optional type is therefore *not* the fix — `!` applied to a
 * non-optional type is a silent no-op, so the same keystroke would still
 * compile. The fix is that the value routes consume is **total**:
 * `currentUserId()` returns `string`, never `string | undefined`, so there is
 * nothing for `!` to assert and no `undefined` to leak into SQL. If the
 * middleware were ever unmounted, it throws a loud 500 instead of writing a
 * `NULL` row. The remaining half of the guard lives in
 * `__tests__/identity.test.ts`, which fails CI if a route reaches for
 * `req.user` again.
 */

// ── The narrowed request ────────────────────────────────────────────────────

/**
 * A request that has passed {@link makeResolveIdentity}: `user` is present,
 * non-optional, in both deployments. Handlers mounted behind `resolveIdentity`
 * may take this instead of `Request` to get `req.user.id` with no assertion —
 * though {@link currentUserId} is preferred, because it also holds when the
 * handler is reached some other way.
 */
export interface AuthedRequest extends Request {
  user: AuthUser;
}

// ── The accessor ────────────────────────────────────────────────────────────

/**
 * The current user's `app_user.id`. **The one way a route learns who is
 * calling** — cloud and self-host alike.
 *
 * Total by construction: returns a `string` or throws. It never returns
 * `undefined`, so no call site needs `!` and none can smuggle `undefined` into
 * a bind parameter.
 *
 * Throws 500 `identity_unresolved` if identity was never settled, which can
 * only happen if a router is mounted ahead of `resolveIdentity`. That is a
 * wiring bug in this app, not a client error — hence 5xx, and hence loud.
 */
export function currentUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) {
    throw new ApiError(
      500,
      'identity_unresolved',
      'Request identity was not resolved. This route is mounted ahead of resolveIdentity.',
    );
  }
  return id;
}

// ── Resolution ──────────────────────────────────────────────────────────────

export interface IdentityConfig {
  /**
   * True when *any* Supabase environment is configured — `SUPABASE_URL`,
   * `SUPABASE_JWT_SECRET`, or `SUPABASE_MODE`. When true the deployment is
   * cloud and identity comes from the verified credential and nothing else.
   *
   * Deliberately wider than auth.ts's `AUTH_ENABLED` (which ignores
   * `SUPABASE_MODE`): a half-configured cloud deployment must fail closed with
   * a 401 rather than quietly hand every anonymous caller the first row of
   * `app_user`.
   */
  supabaseConfigured: boolean;
  /**
   * Self-host only: resolve the single local user. **Never invoked when
   * `supabaseConfigured` is true** — the caller is expected to pass a function
   * that throws in that case, and `makeResolveIdentity` asserts the same
   * invariant independently before it would call this.
   */
  localUserId: () => Promise<string>;
}

/** The 401 body, byte-identical to the one `requireAuth` has always sent. */
const UNAUTHORIZED = {
  error: { code: 'unauthorized', message: 'Authentication required' },
} as const;

/**
 * Build the middleware that settles request identity. Mount it once, ahead of
 * every user-scoped router; after it, {@link currentUserId} always answers.
 *
 * Order of resolution:
 *
 *  1. A credential already verified upstream by `authMiddleware` — a Supabase
 *     JWT or a personal access token — wins in both deployments. This is the
 *     *only* branch cloud can take, so the cloud identity remains derived from
 *     the verified JWT subject and nothing else.
 *  2. No credential and Supabase is configured → **401**. Cloud never falls
 *     back to an ambient user; that would be a cross-tenant read.
 *  3. No credential and no Supabase configuration → the single local user.
 *     Self-host gains no authentication it did not have: the request is
 *     served, exactly as it was before the cloud pivot.
 *
 * Injectable rather than reading `process.env` itself so that all three
 * branches are exercised by a pure test with no database and no environment
 * mutation (see `__tests__/identity.test.ts`).
 */
export function makeResolveIdentity(cfg: IdentityConfig): RequestHandler {
  return (req, res, next) => {
    // 1. Verified credential (JWT or personal access token).
    if (req.user?.id) {
      next();
      return;
    }

    // 2. Cloud without a credential — reject. No fallback exists here.
    if (cfg.supabaseConfigured) {
      res.status(401).json(UNAUTHORIZED);
      return;
    }

    // 3. Self-host — the single local user.
    //
    // Belt and braces: step 2 already returned for every cloud request, so
    // this assertion is unreachable by construction. It is written out anyway
    // because "the self-host fallback is not reachable in cloud" is a security
    // property, and a security property that is only implied by control flow
    // is one refactor away from being untrue. If a future edit reorders these
    // branches, this throws a 500 instead of silently serving one tenant's
    // rows to an anonymous caller.
    if (cfg.supabaseConfigured) {
      next(
        new ApiError(
          500,
          'identity_fallback_in_cloud',
          'Refusing to resolve a local user: Supabase auth is configured.',
        ),
      );
      return;
    }

    cfg
      .localUserId()
      .then((id) => {
        req.user = { id };
        req.authKind = 'local';
        next();
      })
      .catch(next);
  };
}
