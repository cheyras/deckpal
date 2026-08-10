import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { ApiError } from '../http.js';
import {
  currentUserId,
  makeResolveIdentity,
  type AuthedRequest,
  type IdentityConfig,
} from '../identity.js';

/**
 * Request identity — PURE tests (no database, no network, no environment
 * mutation). Wired into `pnpm --filter deckscout-api test:auth`, which CI runs.
 *
 * These are the compensating control for contract B7: live-DB suites
 * (`test:collection`) stay out of CI by design, so the deployment split that
 * broke self-host — cloud routes reading a `req.user` that self-host never
 * populates — has to be provable without a Postgres. `makeResolveIdentity`
 * takes its configuration as an argument precisely so that all three branches
 * are reachable from a unit test:
 *
 *   • cloud + credential  → the JWT/token subject, unchanged
 *   • cloud, no credential → 401, never a fallback
 *   • self-host           → the single local user
 *
 * The last block is a source scan: it fails if any route reaches for
 * `req.user` directly again. `!` is an escape hatch the type checker cannot
 * close, so the guard is a test rather than a type.
 */

// ── Minimal express doubles ─────────────────────────────────────────────────

interface FakeRes {
  statusCode: number | null;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

/**
 * Settles on whichever exit the middleware takes: `next()` (with or without an
 * error) or a terminal `res.json()`. Never races a timer against a promise, so
 * it stays correct however many turns the local-user lookup takes.
 */
async function run(
  cfg: IdentityConfig,
  req: Partial<Request>,
): Promise<{ req: Partial<Request>; res: FakeRes; nextErr: unknown; nexted: boolean }> {
  let nextErr: unknown;
  let nexted = false;
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const res: FakeRes = {
    statusCode: null,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      settle(); // terminal response — the chain ended here
      return this;
    },
  };

  const next = (err?: unknown): void => {
    nexted = true;
    nextErr = err;
    settle();
  };

  makeResolveIdentity(cfg)(req as Request, res as unknown as Response, next);
  await done;
  return { req, res, nextErr, nexted };
}

const CLOUD: IdentityConfig = {
  supabaseConfigured: true,
  localUserId: () =>
    Promise.reject(new Error('self-host identity fallback is unreachable when Supabase auth is configured')),
};

const SELF_HOST: IdentityConfig = {
  supabaseConfigured: false,
  localUserId: () => Promise.resolve('local-user-1'),
};

// ── Cloud ───────────────────────────────────────────────────────────────────

describe('resolveIdentity — cloud (Supabase configured)', () => {
  test('an authenticated request resolves to the JWT subject and nothing else', async () => {
    const jwtSubject = '11111111-2222-3333-4444-555555555555';
    const { req, res, nextErr, nexted } = await run(CLOUD, {
      user: { id: jwtSubject, email: 'trainer@example.com' },
      authKind: 'jwt',
    });

    assert.ok(nexted, 'passes the request through');
    assert.equal(nextErr, undefined);
    assert.equal(res.statusCode, null, 'does not answer the request itself');
    assert.equal(currentUserId(req as Request), jwtSubject);
    assert.equal(req.authKind, 'jwt', 'credential kind is left untouched');
  });

  test('a token-authenticated request resolves to the token owner', async () => {
    const owner = '99999999-8888-7777-6666-555555555555';
    const { req, nextErr } = await run(CLOUD, { user: { id: owner }, authKind: 'token' });

    assert.equal(nextErr, undefined);
    assert.equal(currentUserId(req as Request), owner);
    assert.equal(req.authKind, 'token');
  });

  test('an unauthenticated request is rejected — there is no fallback identity', async () => {
    const { req, res, nexted } = await run(CLOUD, {});

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
      error: { code: 'unauthorized', message: 'Authentication required' },
    });
    assert.equal(nexted, false, 'the chain stops here — no route runs');
    assert.equal(req.user, undefined, 'no ambient user was invented');
  });

  test('a request whose credential failed verification is rejected, not fallen back', async () => {
    // authMiddleware leaves req.user undefined on an invalid/expired JWT. That
    // must be indistinguishable from presenting no credential at all.
    const { res, nexted } = await run(CLOUD, { headers: { authorization: 'Bearer not-a-real-jwt' } });

    assert.equal(res.statusCode, 401);
    assert.equal(nexted, false);
  });

  test('the self-host fallback is never invoked when Supabase is configured', async () => {
    // CLOUD.localUserId rejects if called. An anonymous request must 401
    // without ever reaching it, so nothing lands in nextErr either.
    let called = 0;
    const cfg: IdentityConfig = {
      supabaseConfigured: true,
      localUserId: () => {
        called += 1;
        return Promise.resolve('SHOULD-NEVER-BE-USED');
      },
    };
    const { res, req } = await run(cfg, {});

    assert.equal(called, 0, 'the local-user lookup was not called');
    assert.equal(res.statusCode, 401);
    assert.equal(req.user, undefined);
  });
});

// ── Self-host ───────────────────────────────────────────────────────────────

describe('resolveIdentity — self-host (no Supabase environment)', () => {
  test('an unauthenticated request resolves to the single local user', async () => {
    const { req, res, nextErr, nexted } = await run(SELF_HOST, {});

    assert.ok(nexted, 'the request is served, exactly as before the cloud pivot');
    assert.equal(nextErr, undefined);
    assert.equal(res.statusCode, null, 'self-host gains no auth it never had — no 401');
    assert.equal(currentUserId(req as Request), 'local-user-1');
    assert.equal(req.authKind, 'local');
  });

  test('a personal access token still wins over the local default', async () => {
    // A self-hoster who has run migration 026 can use tokens; the token owner
    // is a better answer than "the first row of app_user".
    const { req, nextErr } = await run(SELF_HOST, { user: { id: 'token-owner' }, authKind: 'token' });

    assert.equal(nextErr, undefined);
    assert.equal(currentUserId(req as Request), 'token-owner');
    assert.equal(req.authKind, 'token');
  });

  test('a failing local-user lookup surfaces as an error, never as undefined', async () => {
    const cfg: IdentityConfig = {
      supabaseConfigured: false,
      localUserId: () => Promise.reject(new Error('db down')),
    };
    const { req, nextErr } = await run(cfg, {});

    assert.ok(nextErr instanceof Error);
    assert.equal((nextErr as Error).message, 'db down');
    assert.equal(req.user, undefined);
  });
});

// ── The accessor ────────────────────────────────────────────────────────────

describe('currentUserId', () => {
  test('returns the resolved id', () => {
    assert.equal(currentUserId({ user: { id: 'abc' } } as unknown as Request), 'abc');
  });

  test('throws rather than returning undefined when identity was never settled', () => {
    // The pre-fix `req.user!.id` returned `undefined` here and passed it into
    // `WHERE user_id = $1`. The accessor cannot: its return type is `string`.
    assert.throws(
      () => currentUserId({} as unknown as Request),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 500);
        assert.equal(err.code, 'identity_unresolved');
        return true;
      },
    );
  });

  test('an empty-string id is treated as unresolved, not as a user', () => {
    assert.throws(() => currentUserId({ user: { id: '' } } as unknown as Request), ApiError);
  });

  test('AuthedRequest exposes user as non-optional', () => {
    const req = { user: { id: 'narrowed' } } as unknown as AuthedRequest;
    // Reads `.id` with no `!` and no `?.` — the narrowing is the point. This
    // line stops compiling if `AuthedRequest.user` ever goes back to optional.
    assert.equal(req.user.id, 'narrowed');
    assert.equal(currentUserId(req), 'narrowed');
  });
});

// ── Source guard ────────────────────────────────────────────────────────────

describe('routes read identity only through the accessor', () => {
  const srcRoot = fileURLToPath(new URL('..', import.meta.url));

  /** Every route module: routes/*.ts plus the two sibling routers. */
  function routeFiles(): string[] {
    const files = readdirSync(join(srcRoot, 'routes'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(srcRoot, 'routes', f));
    files.push(join(srcRoot, 'export', 'router.ts'), join(srcRoot, 'scan', 'router.ts'));
    return files;
  }

  test('no route uses a non-null assertion on req.user', () => {
    const offenders = routeFiles().filter((f) => /req\.user\s*!/.test(readFileSync(f, 'utf-8')));
    assert.deepEqual(
      offenders.map((f) => f.slice(srcRoot.length)),
      [],
      'req.user! erases at compile time and yields undefined in self-host — call currentUserId(req) instead',
    );
  });

  test('no route reads req.user directly outside the anonymous bug reporter', () => {
    // routes/bugs.ts is the one legitimate reader: a cloud bug report records
    // the reporter when there is one and NULL when there is not, so it wants
    // the optional field rather than a resolved user.
    const offenders = routeFiles()
      .filter((f) => !f.endsWith(join('routes', 'bugs.ts')))
      .filter((f) => /\breq\.user\b/.test(readFileSync(f, 'utf-8')));
    assert.deepEqual(
      offenders.map((f) => f.slice(srcRoot.length)),
      [],
      'identity has exactly one accessor: currentUserId(req)',
    );
  });

  test('the guard can actually see the route sources', () => {
    // A typo in the path would make both assertions above vacuously true.
    const files = routeFiles();
    assert.ok(files.length >= 12, `expected the full route set, saw ${files.length}`);
    const withAccessor = files.filter((f) => readFileSync(f, 'utf-8').includes('currentUserId(req)'));
    assert.ok(withAccessor.length >= 10, `expected most routers to use the accessor, saw ${withAccessor.length}`);
  });
});
