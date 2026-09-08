/**
 * The owner gate — who reaches an owner-only surface, decided on the SERVER.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * The hole these close
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `apps/web/src/main.tsx` gates `/scan` in the browser, and `AppShell` hides the
 * nav row and the camera button. Both are correct and neither is a control: what
 * they decide is what gets DRAWN. `POST /api/scan` used to check nothing beyond
 * a valid session, which is the same shape of hole `POST /api/chat` had — an
 * ordinary signed-in account got a full model turn out of it by asking, while
 * the client gate had politely rendered nothing (see `decke/entitlement.ts`).
 *
 * The owner's directive on 2026-09-07 was "remove the scanner entirely for
 * anyone that isn't me", and "entirely" is the word that makes this file the
 * one that matters.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Why the middleware is exercised rather than read
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A gate has four behaviours — pass the owner, refuse everyone else, refuse the
 * anonymous, and step aside off production — and three of the four are ways of
 * saying no. A test that only proves the happy path proves the least
 * interesting quarter of it. These call the handler directly with a fake
 * req/res: no database, no Express app, no network, so they run in the pure
 * suite and cannot be quietly skipped for wanting a DB.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../http.js';
import {
  isLabelerEntitled,
  isOwner,
  labelerEntitlementStatus,
  labelerOnlyInProduction,
  ownerGateStatus,
  ownerOnlyInProduction,
} from '../ownerGate.js';

const OWNER = '11111111-2222-3333-4444-555555555555';
const SOMEBODY_ELSE = '99999999-8888-7777-6666-555555555555';

const ENV_KEYS = [
  'VERCEL_ENV',
  'DESIGN_EDITOR_USER_ID',
  'SUPABASE_MODE',
  'DECKE_ENTITLED_USER_IDS',
  'LABELER_ENTITLED_USER_IDS',
] as const;
const saved = new Map<string, string | undefined>();
for (const k of ENV_KEYS) saved.set(k, process.env[k]);

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/**
 * Both tiers are exercised in one process, and that is exactly why `ownerGate.ts`
 * reads `SUPABASE_MODE` per call instead of importing `db.js`'s module-load
 * capture. With the capture, half of this file would silently `skip` depending
 * on how the runner was started — a suite that looks green and checks nothing.
 */
const cloud = () => {
  process.env.SUPABASE_MODE = '1';
};
const selfHost = () => {
  delete process.env.SUPABASE_MODE;
};

interface Called {
  status?: number;
  body?: unknown;
  nexted: boolean;
  error?: unknown;
}

/** Drive the middleware with a caller identity and report what it did. */
function run(handler: RequestHandler, userId: string | undefined): Called {
  const out: Called = { nexted: false };
  const req = { user: userId ? { id: userId } : undefined } as unknown as Request;
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = ((err?: unknown) => {
    if (err) out.error = err;
    else out.nexted = true;
  }) as NextFunction;
  handler(req, res, next);
  return out;
}

// ── isOwner ─────────────────────────────────────────────────────────────────

test('cloud: only the account named by DESIGN_EDITOR_USER_ID is the owner', () => {
  cloud();
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  assert.equal(isOwner(OWNER), true);
  assert.equal(isOwner(SOMEBODY_ELSE), false);
});

test('cloud: an UNSET owner variable means NOBODY, never everybody', () => {
  cloud();
  delete process.env.DESIGN_EDITOR_USER_ID;
  assert.equal(isOwner(OWNER), false, 'an unset gate must fail CLOSED');
  assert.equal(isOwner(SOMEBODY_ELSE), false);
  assert.equal(isOwner(undefined), false);
});

test('cloud: an anonymous caller is never the owner, even with the variable set', () => {
  cloud();
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  assert.equal(isOwner(undefined), false);
  assert.equal(isOwner(null), false);
  assert.equal(isOwner(''), false);
});

test('self-host: the single local user is always the owner', () => {
  selfHost();
  delete process.env.DESIGN_EDITOR_USER_ID;
  assert.equal(isOwner('anyone-at-all'), true);
  assert.equal(isOwner(undefined), true);
});

test('ownerGateStatus reports whether a gate is configured, never who it names', () => {
  cloud();
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  assert.equal(ownerGateStatus(), 'configured');
  delete process.env.DESIGN_EDITOR_USER_ID;
  assert.equal(ownerGateStatus(), 'unset', 'an unset variable must be reported, not hidden — B11');

  selfHost();
  assert.equal(ownerGateStatus(), 'self-host');

  // The status is a WORD. `/health` is unauthenticated, so whatever this
  // returns is public, and a user UUID is not something it may hand out.
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  cloud();
  assert.ok(['configured', 'unset', 'self-host'].includes(ownerGateStatus()));
  assert.notEqual(ownerGateStatus(), OWNER);
});

// ── the middleware, on production ───────────────────────────────────────────

test('production: the owner passes', () => {
  cloud();
  process.env.VERCEL_ENV = 'production';
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  const r = run(ownerOnlyInProduction('not-found'), OWNER);
  assert.equal(r.nexted, true);
  assert.equal(r.error, undefined);
  assert.equal(r.status, undefined);
});

test('production: a signed-in NON-owner gets 404, not 403 — the route must look absent', () => {
  cloud();
  process.env.VERCEL_ENV = 'production';
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  const r = run(ownerOnlyInProduction('not-found'), SOMEBODY_ELSE);
  assert.equal(r.nexted, false, 'a non-owner must not reach the handler');
  assert.ok(r.error instanceof ApiError);
  assert.equal(r.error.status, 404);
  assert.equal(r.error.code, 'not_found');
  // A 403 would confirm to any prober that deckpal.app has a scanner behind a
  // door. The web route throws notFound() for the same reason, and the pair
  // leaks whatever either half gives away.
  assert.notEqual(r.error.status, 403);
});

test('production: an anonymous caller gets 404 too', () => {
  cloud();
  process.env.VERCEL_ENV = 'production';
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  const r = run(ownerOnlyInProduction('not-found'), undefined);
  assert.equal(r.nexted, false);
  assert.ok(r.error instanceof ApiError);
  assert.equal(r.error.status, 404);
});

test('production with an UNSET owner variable refuses everybody — fail closed', () => {
  cloud();
  process.env.VERCEL_ENV = 'production';
  delete process.env.DESIGN_EDITOR_USER_ID;
  for (const who of [OWNER, SOMEBODY_ELSE, undefined]) {
    const r = run(ownerOnlyInProduction('not-found'), who);
    assert.equal(r.nexted, false, `misconfiguration must close the gate, not open it (caller: ${who})`);
  }
});

test("the 'forbidden' refusal answers 403 with a message, for the operator tool that wants one", () => {
  cloud();
  process.env.VERCEL_ENV = 'production';
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  const r = run(ownerOnlyInProduction('forbidden'), SOMEBODY_ELSE);
  assert.equal(r.nexted, false);
  assert.equal(r.status, 403);
  assert.deepEqual(r.body, { error: { code: 'forbidden', message: 'Owner only.' } });
});

// ── the middleware, off production ──────────────────────────────────────────

test('PREVIEW is unrestricted — every caller passes, owner or not', () => {
  // Cloud, so the pass-through is demonstrably the VERCEL_ENV check doing the
  // work and not self-host's "everyone is the owner".
  cloud();
  process.env.VERCEL_ENV = 'preview';
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  for (const who of [OWNER, SOMEBODY_ELSE, undefined]) {
    for (const refusal of ['not-found', 'forbidden'] as const) {
      const r = run(ownerOnlyInProduction(refusal), who);
      assert.equal(r.nexted, true, `preview must pass ${who} through (${refusal})`);
    }
  }
});

test('VERCEL_ENV unset (self-host, local dev) is unrestricted', () => {
  cloud();
  delete process.env.VERCEL_ENV;
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  for (const who of [OWNER, SOMEBODY_ELSE, undefined]) {
    assert.equal(run(ownerOnlyInProduction('not-found'), who).nexted, true);
  }
});

test('"development" is not "production" — only the exact string closes the gate', () => {
  cloud();
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  for (const env of ['development', 'Production', 'PRODUCTION', 'prod', '']) {
    process.env.VERCEL_ENV = env;
    assert.equal(
      run(ownerOnlyInProduction('not-found'), SOMEBODY_ELSE).nexted,
      true,
      `VERCEL_ENV=${JSON.stringify(env)} unexpectedly closed the gate`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// The labeler set — the owner PLUS the QA account (2026-09-08 owner ruling)
// ══════════════════════════════════════════════════════════════════════════════
//
// These matter more than their size suggests. The quad training surface has TWO
// gates that must agree — the route guard in `apps/web/src/main.tsx` and this
// middleware on POST /dev/scan-flags, which is the only path a saved label
// takes. When they disagreed in one direction the surface was invisible to the
// only account allowed to drive it (round 9); disagreeing in the other gives
// the QA account a page that labels happily and 403s on every save. Both
// failures are silent from the surface itself, so they are pinned here.

const QA = '77777777-6666-5555-4444-333333333333';

test('cloud: the labeler set is the owner plus the named list', () => {
  cloud();
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  process.env.LABELER_ENTITLED_USER_IDS = QA;
  assert.equal(isLabelerEntitled(OWNER), true);
  assert.equal(isLabelerEntitled(QA), true);
  assert.equal(isLabelerEntitled(SOMEBODY_ELSE), false);
  assert.equal(isLabelerEntitled(undefined), false);
});

test("cloud: with no dedicated list, Deck-E's list is inherited", () => {
  cloud();
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  delete process.env.LABELER_ENTITLED_USER_IDS;
  process.env.DECKE_ENTITLED_USER_IDS = ` ${QA} , `;
  assert.equal(isLabelerEntitled(QA), true, 'the inherited list is parsed the same way');
  assert.equal(isLabelerEntitled(SOMEBODY_ELSE), false);
  assert.equal(labelerEntitlementStatus(), 'owner-plus-decke-list');
});

test('a dedicated list REPLACES the inherited one — that is the decoupling', () => {
  cloud();
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  process.env.DECKE_ENTITLED_USER_IDS = SOMEBODY_ELSE;
  process.env.LABELER_ENTITLED_USER_IDS = QA;
  assert.equal(isLabelerEntitled(QA), true);
  assert.equal(
    isLabelerEntitled(SOMEBODY_ELSE),
    false,
    "Deck-E's list must not leak through once the labeler has its own",
  );
  assert.equal(labelerEntitlementStatus(), 'owner-plus-list');
});

test('an EMPTY dedicated list is a typo, not a decision to shut the surface', () => {
  cloud();
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  process.env.DECKE_ENTITLED_USER_IDS = QA;
  for (const v of ['', '   ', ',', ' , ,']) {
    process.env.LABELER_ENTITLED_USER_IDS = v;
    assert.equal(
      isLabelerEntitled(QA),
      true,
      `LABELER_ENTITLED_USER_IDS=${JSON.stringify(v)} should fall back, not lock out`,
    );
  }
});

test('cloud: no owner and no list anywhere means nobody', () => {
  cloud();
  delete process.env.DESIGN_EDITOR_USER_ID;
  delete process.env.LABELER_ENTITLED_USER_IDS;
  delete process.env.DECKE_ENTITLED_USER_IDS;
  assert.equal(isLabelerEntitled(OWNER), false);
  assert.equal(labelerEntitlementStatus(), 'nobody');
});

test('self-host: one user, always entitled', () => {
  selfHost();
  assert.equal(isLabelerEntitled(SOMEBODY_ELSE), true);
  assert.equal(isLabelerEntitled(undefined), true);
  assert.equal(labelerEntitlementStatus(), 'self-host');
});

test('labelerOnlyInProduction: 403s a stranger and passes the QA account', () => {
  cloud();
  process.env.VERCEL_ENV = 'production';
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  process.env.LABELER_ENTITLED_USER_IDS = QA;

  assert.equal(run(labelerOnlyInProduction(), OWNER).nexted, true);
  assert.equal(run(labelerOnlyInProduction(), QA).nexted, true);

  const refused = run(labelerOnlyInProduction(), SOMEBODY_ELSE);
  assert.equal(refused.nexted, false);
  assert.equal(refused.status, 403);

  const anon = run(labelerOnlyInProduction(), undefined);
  assert.equal(anon.nexted, false);
  assert.equal(anon.status, 403);
});

test('labelerOnlyInProduction steps aside off production, like its sibling', () => {
  cloud();
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  delete process.env.LABELER_ENTITLED_USER_IDS;
  delete process.env.DECKE_ENTITLED_USER_IDS;
  for (const env of ['preview', 'development', undefined]) {
    if (env === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = env;
    assert.equal(run(labelerOnlyInProduction(), SOMEBODY_ELSE).nexted, true);
  }
});

test('the scanner gate did NOT widen — /scan stays owner-only', () => {
  cloud();
  process.env.VERCEL_ENV = 'production';
  process.env.DESIGN_EDITOR_USER_ID = OWNER;
  process.env.LABELER_ENTITLED_USER_IDS = QA;
  const refused = run(ownerOnlyInProduction('not-found'), QA);
  assert.equal(refused.nexted, false);
  assert.ok(refused.error instanceof ApiError);
  assert.equal((refused.error as ApiError).status, 404);
});
