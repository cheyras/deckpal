import type { Request, RequestHandler } from 'express';
import type { AuthUser } from './auth.js';
import { ApiError } from './http.js';

/**
 * Request identity — the single seam between "who is calling" and "whose rows
 * do I read/write", valid in both deployments.
 *
 * DeckPal ships two deployments with two different answers to "who is the
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
 *
 * ## The public catalog — a second, explicit answer
 *
 * The catalog (series, sets, cards, Pokédex) is browsable signed-out. Those
 * routes are not "user-scoped" and not "user-free" either: they are catalog
 * responses that *embed* the caller's ownership when there is a caller. So
 * there is a second, deliberately separate seam —
 * {@link makeResolveOptionalIdentity} + {@link optionalUserId} — whose answer
 * is `string | null`, where `null` means **nobody is calling** rather than
 * "we don't know yet".
 *
 * It is a distinct function and a distinct middleware on purpose. Widening
 * `currentUserId` to return `string | null` would have made every one of the
 * ~30 user-scoped call sites nullable overnight, and the original bug was
 * precisely a `undefined` reaching `WHERE user_id = $1`. Instead the two
 * concepts stay apart: a route that must have a user calls `currentUserId` and
 * cannot compile against `null`; a route that tolerates anonymity calls
 * `optionalUserId` and the compiler forces it to say what it does with `null`.
 * Both throw the same loud 500 when no identity middleware ran at all, so
 * neither can silently degrade.
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

/**
 * The current user's email address, or `null` when the credential did not carry
 * one. It lives on this seam for the same reason `currentUserId` does: a route
 * reaching into `req.user` for it is the exact pattern
 * `__tests__/identity.test.ts` exists to forbid.
 *
 * `null` is ordinary, not exceptional, and callers must treat it that way. A
 * personal access token resolves to a user id and no email at all (auth.ts),
 * and a self-host request has no JWT to carry one. The single caller today --
 * `routes/billing.ts`, filling in a Stripe customer so receipts have somewhere
 * to go -- passes it through when present and omits the field when it is not.
 * Nothing may *depend* on it: an email is a convenience here, never an
 * identity. The identity is the uuid.
 */
export function currentUserEmail(req: Request): string | null {
  const email = req.user?.email;
  return typeof email === 'string' && email.includes('@') ? email : null;
}

/**
 * The current user's `app_user.id`, or `null` when the request is **explicitly
 * anonymous**. The one way a *public catalog* route learns who is calling.
 *
 * `null` is a settled answer, not a missing one: it is only ever returned
 * behind {@link makeResolveOptionalIdentity}, which reached it by finding no
 * credential on a cloud deployment. A route mounted ahead of any identity
 * middleware still gets the same loud 500 `identity_unresolved` as
 * {@link currentUserId} — "nobody is calling" and "nobody has asked yet" are
 * different facts and must never collapse into the same value.
 *
 * Self-host never returns `null`: there is always the single local user, and
 * the reverse proxy is the auth boundary (SECURITY.md). Public catalog routes
 * therefore behave in self-host exactly as they always have.
 *
 * ## What a route must do with `null`
 *
 * Two things, and the second is the one that matters:
 *
 *  1. Bind it into the query as-is. SQL's `col = NULL` is `UNKNOWN`, never
 *     true, so `LEFT JOIN collection_item ci ON … AND ci.user_id = $2` matches
 *     no row for any user — the anonymous result is empty *by three-valued
 *     logic*, not by a filter someone could forget to apply.
 *  2. **Omit the ownership fields from the response.** Zeroes read as "you own
 *     none of this", which is a claim about a person that does not exist here.
 *     Absent keys are the honest shape and are trivially provable: the audit is
 *     `Object.keys(response)`, not an argument about which zero is real.
 */
export function optionalUserId(req: Request): string | null {
  const id = req.user?.id;
  if (id) return id;
  if (req.identityResolution === 'anonymous') return null;
  throw new ApiError(
    500,
    'identity_unresolved',
    'Request identity was not resolved. This route is mounted ahead of resolveOptionalIdentity.',
  );
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
        req.identityResolution = 'user';
        next();
      })
      .catch(next);
  };
}

/**
 * Build the middleware that settles identity for the **public catalog**: mount
 * it ahead of the routers a logged-out visitor is allowed to reach.
 *
 * Same three branches as {@link makeResolveIdentity}, with one difference, and
 * it is the whole point:
 *
 *  1. A verified credential wins, identically. A signed-in visitor browsing the
 *     catalog gets exactly the response they got before this middleware
 *     existed.
 *  2. No credential and Supabase is configured → **anonymous**, not 401. The
 *     request is marked and served; {@link optionalUserId} answers `null` and
 *     the route omits every ownership field.
 *  3. No credential and no Supabase configuration → the single local user.
 *     Byte-identical to the required path, so self-host is untouched: there is
 *     no anonymous state in a self-host deployment and this middleware cannot
 *     invent one.
 *
 * Note what branch 2 does *not* do: it never invents a user id, a sentinel
 * uuid, or "the first row of app_user". `req.user` stays `undefined`, so a
 * route that calls `currentUserId` by mistake — because it needs a real user —
 * still throws rather than reading somebody's rows. The only thing that changes
 * is that `optionalUserId` now has an answer to give.
 */
export function makeResolveOptionalIdentity(cfg: IdentityConfig): RequestHandler {
  return (req, _res, next) => {
    // 1. Verified credential (JWT or personal access token).
    if (req.user?.id) {
      req.identityResolution = 'user';
      next();
      return;
    }

    // 2. Cloud without a credential — served, as nobody.
    if (cfg.supabaseConfigured) {
      req.identityResolution = 'anonymous';
      next();
      return;
    }

    // 3. Self-host — the single local user, exactly as the required path.
    cfg
      .localUserId()
      .then((id) => {
        req.user = { id };
        req.authKind = 'local';
        req.identityResolution = 'user';
        next();
      })
      .catch(next);
  };
}
