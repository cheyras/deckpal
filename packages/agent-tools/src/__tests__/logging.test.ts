/**
 * `log_cards` — CONTRACT tests for the write tool with a documented production
 * incident.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * DECISIONS.md 2026-08-19, "The silent-success incident": a 99-item
 * `log_cards` batch reported `"The connector's server isn't responding"`
 * three times running, while every one of those "failures" had already
 * committed its writes. The calling agent retried — correctly, given that
 * error — and quantities inflated up to 4x across 99 cards. Recovery meant
 * hand-deriving 92 corrective deltas out of `collection_log`.
 *
 * The fix (same file, `logging.ts`) is a deterministic idempotency key per
 * batch, plus a `whatLanded` reconciliation path that asks the mutation log
 * "did that actually commit?" instead of assuming a failed response means a
 * failed write. Neither half had ANY test before this file — `toolErrors.
 * test.ts` covers only the error-MESSAGE-redaction concern (never leak a DSN),
 * not the write contract itself. This file pins:
 *
 *  1. the happy path (resolve → one API call → render before/after);
 *  2. that identical batches (a real retry) carry the SAME idempotency key,
 *     so a "REPLAYED" server response is rendered honestly rather than as a
 *     second application — the exact regression class that produced the 4x
 *     inflation;
 *  3. that a boundary-crossing retry still finds what committed (`whatLanded`
 *     probes the current AND previous 15-minute bucket);
 *  4. that a `dry_run` call always forwards `dryRun` to the API untouched;
 *  5. the delta/quantity/ambiguity contract per item, including the
 *     "several input rows fold into one API result row" case call out in the
 *     2026-08-19 fix comment; and
 *  6. that collection reads are scoped by `ctx.userId`, not a fixed or
 *     leaked value — the resolution step that determines "how many do you
 *     already own" for every write in this tool.
 *
 * Pure: no database, no network. `ctx.db.query` and `ctx.api` are stubs
 * mirroring the real shapes (`CARD_SELECT`'s columns, the `/collection/batch`
 * envelope), the same convention `toolErrors.test.ts` and
 * `deckIntel-infer.test.ts` use. This file lives in `src/__tests__/`, so
 * `pnpm --filter @deckpal/agent-tools test:variants` (`node --test
 * src/__tests__/*.test.ts`) picks it up automatically — the same glob CI's
 * "Variant classification + agent-tools guards" step already runs.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Api } from '../api.js';
import type { Ctx } from '../ctx.js';
import { loggingTools } from '../tools/logging.js';

const logCards = loggingTools.find((t) => t.name === 'log_cards')!;

// ── Fixture catalogue ─────────────────────────────────────────────────────

interface CardFixture {
  id: number;
  tcgdexId: string;
  name: string;
  localId: string;
  rarity: string | null;
  category: string;
  setTcgdexId: string;
  setName: string;
  seriesSlug: string;
  bestMinor: number | null;
}

interface VariantFixture {
  id: number;
  kindCode: string;
  displayName: string | null;
  isPrimary: boolean;
  /** Owned quantity, PER USER — the thing an RLS/scoping bug would confuse. */
  ownedQtyByUser?: Record<string, number>;
}

const PIKACHU: CardFixture = {
  id: 1,
  tcgdexId: 'sv01-25',
  name: 'Pikachu',
  localId: '025',
  rarity: 'Common',
  category: 'Pokemon',
  setTcgdexId: 'sv01',
  setName: 'Scarlet & Violet',
  seriesSlug: 'sv',
  bestMinor: 50,
};

const RAICHU: CardFixture = {
  id: 2,
  tcgdexId: 'sv01-26',
  name: 'Raichu',
  localId: '026',
  rarity: 'Uncommon',
  category: 'Pokemon',
  setTcgdexId: 'sv01',
  setName: 'Scarlet & Violet',
  seriesSlug: 'sv',
  bestMinor: 120,
};

const CARDS = [PIKACHU, RAICHU];

/** Two users, two different owned counts of the same variant — see the RLS/scoping tests. */
const VARIANTS: Record<number, VariantFixture[]> = {
  1: [{ id: 9001, kindCode: 'normal', displayName: null, isPrimary: true, ownedQtyByUser: { 'user-a': 2, 'user-b': 40 } }],
  2: [
    { id: 9002, kindCode: 'normal', displayName: null, isPrimary: true, ownedQtyByUser: {} },
    { id: 9003, kindCode: 'reverse', displayName: 'Reverse Holo', isPrimary: false, ownedQtyByUser: {} },
  ],
};

function cardRow(c: CardFixture): Record<string, unknown> {
  return {
    id: c.id,
    tcgdex_id: c.tcgdexId,
    name: c.name,
    local_id: c.localId,
    rarity: c.rarity,
    category: c.category,
    set_tcgdex_id: c.setTcgdexId,
    set_name: c.setName,
    series_slug: c.seriesSlug,
    best_minor: c.bestMinor,
  };
}

/** Every `card_variant` query this test file makes, recorded for the RLS/scoping tests. */
interface VariantQuery {
  cardIds: number[];
  userId: string;
}

function makeDb(variantQueries?: VariantQuery[]) {
  return {
    query: async (sql: string, params: unknown[]) => {
      if (/FROM card c/.test(sql) && /tcgdex_id = ANY\(\$1::text\[\]\)/.test(sql)) {
        const ids = (params[0] as string[]).map((s) => s.trim());
        return { rows: CARDS.filter((c) => ids.includes(c.tcgdexId)).map(cardRow) };
      }
      if (/FROM card_variant cv/.test(sql)) {
        const cardIds = params[0] as number[];
        const userId = params[1] as string;
        variantQueries?.push({ cardIds: [...cardIds], userId });
        const rows: Record<string, unknown>[] = [];
        for (const cid of cardIds) {
          for (const v of VARIANTS[cid] ?? []) {
            rows.push({
              card_id: cid,
              id: v.id,
              variant_kind_code: v.kindCode,
              display_name: v.displayName,
              is_primary: v.isPrimary,
              owned_qty: v.ownedQtyByUser?.[userId] ?? 0,
            });
          }
        }
        return { rows };
      }
      throw new Error(`log_cards test stub: unexpected query — ${sql}`);
    },
  };
}

// ── API stub ─────────────────────────────────────────────────────────────

interface Recorded {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

interface BatchItemLike {
  variantId: number;
  before: number;
  after: number;
  delta: number;
  clamped?: boolean;
}

/** Build a `/collection/batch` response the way the real API shapes it. */
function batchResponse(over: {
  items: BatchItemLike[];
  dryRun?: boolean;
  applied?: number;
  wouldApply?: number;
  unchanged?: number;
  batchId?: string | null;
  replayed?: boolean;
  duplicateOf?: { batchId: string; at: string; note: string | null };
}): Record<string, unknown> {
  const dryRun = over.dryRun ?? false;
  return {
    dryRun,
    batchId: over.batchId ?? 'batch-1',
    applied: dryRun ? 0 : (over.applied ?? over.items.length),
    ...(dryRun ? { wouldApply: over.wouldApply ?? over.items.length } : {}),
    unchanged: over.unchanged ?? 0,
    items: over.items.map((it) => ({
      variantId: it.variantId,
      cardId: null,
      setId: null,
      before: it.before,
      after: it.after,
      delta: it.delta,
      requestedDelta: it.delta,
      clamped: it.clamped ?? false,
    })),
    progress: {},
    ...(over.replayed !== undefined ? { replayed: over.replayed } : {}),
    ...(over.duplicateOf !== undefined ? { duplicateOf: over.duplicateOf } : {}),
  };
}

function makeCtx(opts: {
  userId?: string;
  variantQueries?: VariantQuery[];
  onBatch?: (body: Record<string, unknown>, callIndex: number) => unknown;
  onMutationsList?: (idempotencyKey: string, callIndex: number) => unknown;
  onMutationDetail?: (batchId: string) => unknown;
} = {}): { ctx: Ctx; sends: Recorded[]; gets: string[] } {
  const sends: Recorded[] = [];
  const gets: string[] = [];
  let batchCalls = 0;
  let mutationsListCalls = 0;

  const api: Api = {
    base: 'http://127.0.0.1:3700/deckpal/api',
    get: async (path: string) => {
      gets.push(path);
      if (path.startsWith('/mutations?idempotency_key=')) {
        const raw = path.slice('/mutations?idempotency_key='.length).split('&')[0]!;
        const key = decodeURIComponent(raw);
        const res = opts.onMutationsList?.(key, mutationsListCalls) ?? { batches: [] };
        mutationsListCalls++;
        return res;
      }
      if (path.startsWith('/mutations/')) {
        const batchId = path.slice('/mutations/'.length);
        return opts.onMutationDetail?.(batchId) ?? { batch: { batchId, response: null } };
      }
      throw new Error(`log_cards test stub: unexpected GET ${path}`);
    },
    send: async (method: string, path: string, body?: unknown) => {
      sends.push({ method, path, body: (body ?? {}) as Record<string, unknown> });
      if (method === 'POST' && path === '/collection/batch') {
        const idx = batchCalls;
        batchCalls++;
        const result = opts.onBatch?.(body as Record<string, unknown>, idx);
        if (result instanceof Error) throw result;
        return result ?? batchResponse({ items: [] });
      }
      throw new Error(`log_cards test stub: unexpected send ${method} ${path}`);
    },
  } as unknown as Api;

  const ctx = {
    userId: opts.userId ?? 'user-a',
    db: makeDb(opts.variantQueries),
    api,
  } as unknown as Ctx;

  return { ctx, sends, gets };
}

const batchSends = (sends: Recorded[]): Recorded[] => sends.filter((s) => s.path === '/collection/batch');

// ── 1. Happy path ─────────────────────────────────────────────────────────

test('log_cards applies a single delta item and renders before → after', async () => {
  const { ctx, sends } = makeCtx({
    onBatch: (body) => {
      assert.deepEqual(body.items, [{ variantId: 9001, delta: 1 }]);
      return batchResponse({ items: [{ variantId: 9001, before: 2, after: 3, delta: 1 }], batchId: 'batch-abc' });
    },
  });

  const res = await logCards.handler({ items: [{ card_id: 'sv01-25', delta: 1 }], dry_run: false }, ctx);

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Pikachu \| sv01-25 \| normal \| 2 → 3 \(Δ\+1\)/);
  assert.match(res.text, /applied 1, unchanged 0, skipped 0/);
  assert.match(res.text, /undo with revert\(batch_id: "batch-abc"\)/);

  const [sent] = batchSends(sends);
  assert.equal(sent!.body.dryRun, false);
  assert.equal(sent!.body.source, 'deckpal-mcp');
  assert.equal(typeof sent!.body.idempotencyKey, 'string');
});

test('log_cards sets an absolute quantity, not a delta', async () => {
  const { ctx, sends } = makeCtx({
    onBatch: (body) => {
      assert.deepEqual(body.items, [{ variantId: 9001, quantity: 10 }]);
      return batchResponse({ items: [{ variantId: 9001, before: 2, after: 10, delta: 8 }] });
    },
  });

  const res = await logCards.handler({ items: [{ card_id: 'sv01-25', quantity: 10 }], dry_run: false }, ctx);

  assert.equal(res.isError, undefined);
  assert.match(res.text, /2 → 10 \(Δ\+8\)/);
});

// ── 2. dry_run always forwards dryRun, never claims a write happened ─────────

test('log_cards dry_run forwards dryRun:true and never renders a checkmark', async () => {
  const { ctx, sends } = makeCtx({
    onBatch: (body) => {
      assert.equal(body.dryRun, true, 'the tool must forward dry_run to the API — the server enforces "no write"');
      return batchResponse({ dryRun: true, wouldApply: 1, items: [{ variantId: 9001, before: 2, after: 3, delta: 1 }] });
    },
  });

  const res = await logCards.handler({ items: [{ card_id: 'sv01-25', delta: 1 }], dry_run: true }, ctx);

  assert.equal(res.isError, undefined);
  assert.equal(res.text.includes('✓'), false, 'dry_run must never render as an applied write');
  assert.match(res.text, /would apply 1, unchanged 0, skipped 0/);
  assert.match(res.text, /dry run — nothing written; re-call with dry_run:false to apply/);
  assert.equal(batchSends(sends)[0]!.body.dryRun, true);
});

// ── 3. Retry safety — the 4x-inflation regression class ──────────────────────

test('two identical calls (a real retry) carry the SAME idempotency key, and a REPLAYED response is rendered honestly, not as a second application', async () => {
  const seenKeys: unknown[] = [];
  const { ctx, sends } = makeCtx({
    onBatch: (body, callIndex) => {
      seenKeys.push(body.idempotencyKey);
      // The server enforces `UNIQUE (user_id, idempotency_key)` — a genuine
      // retry gets back the ORIGINAL response with `replayed: true`. The old
      // buggy behaviour this incident produced would instead have applied a
      // second time (before: 3, after: 4) — that is exactly what must NOT
      // happen here.
      return callIndex === 0
        ? batchResponse({ items: [{ variantId: 9001, before: 2, after: 3, delta: 1 }], batchId: 'batch-1' })
        : batchResponse({ items: [{ variantId: 9001, before: 2, after: 3, delta: 1 }], batchId: 'batch-1', replayed: true });
    },
  });

  const args = { items: [{ card_id: 'sv01-25', delta: 1 }], dry_run: false };
  const first = await logCards.handler(args, ctx);
  const second = await logCards.handler(args, ctx);

  assert.equal(first.isError, undefined);
  assert.equal(second.isError, undefined);
  assert.equal(seenKeys.length, 2);
  assert.equal(seenKeys[0], seenKeys[1], 'a retry within the same batch/content/time-bucket must derive the identical key');

  assert.match(first.text, /2 → 3 \(Δ\+1\)/);
  assert.match(second.text, /2 → 3 \(Δ\+1\)/);
  assert.equal(second.text.includes('3 → 4'), false, 'must never report the double-applied quantity the incident produced');
  assert.match(second.text, /REPLAYED — an identical batch had already been applied/);
});

test('a caller-supplied idempotency_key is used verbatim (scoped per chunk) instead of a derived one', async () => {
  const { ctx, sends } = makeCtx({
    onBatch: () => batchResponse({ items: [{ variantId: 9001, before: 2, after: 3, delta: 1 }] }),
  });

  await logCards.handler(
    { items: [{ card_id: 'sv01-25', delta: 1 }], idempotency_key: 'my-own-key', dry_run: false },
    ctx,
  );

  assert.equal(batchSends(sends)[0]!.body.idempotencyKey, 'my-own-key#0');
  assert.equal(batchSends(sends)[0]!.body.requestFingerprint, undefined, 'a caller key bypasses the server-side content fingerprint');
});

test('a retry that straddles a 15-minute bucket boundary still collides — whatLanded probes more than one bucket', async () => {
  // Simulates the actual incident shape: the API call itself fails (a dead
  // connection, exactly as the 2026-08-19 report describes), but the write
  // already committed. By the time this tool asks "did that land?" the wall
  // clock may have crossed into the next bucket, so the lookup must try more
  // than the single most-recent key before giving up.
  const seenKeys: string[] = [];
  const { ctx, sends } = makeCtx({
    onBatch: () => new Error('no response within 25s'),
    onMutationsList: (key, callIndex) => {
      seenKeys.push(key);
      return callIndex === 0 ? { batches: [] } : { batches: [{ batchId: 'batch-committed', status: 'committed' }] };
    },
    onMutationDetail: (batchId) => ({
      batch: {
        batchId,
        response: batchResponse({ items: [{ variantId: 9001, before: 2, after: 3, delta: 1 }], applied: 1, batchId }),
      },
    }),
  });

  const res = await logCards.handler({ items: [{ card_id: 'sv01-25', delta: 1 }], dry_run: false }, ctx);

  assert.equal(res.isError, undefined, 'the write DID land — this must never be reported as a failure');
  assert.equal(seenKeys.length, 2, 'whatLanded must probe more than one bucket before giving up');
  assert.match(res.text, /mutation log confirms the write COMMITTED/);
  assert.match(res.text, /2 → 3/);
  assert.equal(batchSends(sends).length, 1, 'must not re-send just because the reply, not the write, was lost');
});

test('when nothing under any key committed, the tool says so honestly and says retrying is safe — it does not guess', async () => {
  const { ctx } = makeCtx({
    onBatch: () => new Error('no response within 25s'),
    onMutationsList: () => ({ batches: [] }),
  });

  const res = await logCards.handler({ items: [{ card_id: 'sv01-25', delta: 1 }], dry_run: false }, ctx);

  assert.equal(res.isError, undefined, 'a clean abandonment is reported, not thrown as a tool error');
  assert.match(res.text, /STOPPED after chunk 1\/1: no response within 25s/);
  assert.match(res.text, /Re-calling with the same items is safe/);
});

// ── 4. Several inputs resolving to ONE variant fold into ONE result row ─────

test('two input rows for the same variant (e.g. "+1 Pikachu" twice) both render the SAME applied result, neither as NOT SENT', async () => {
  const { ctx } = makeCtx({
    onBatch: (body) => {
      // The API folds duplicate variants into one row.
      assert.equal((body.items as unknown[]).length, 2);
      return batchResponse({ items: [{ variantId: 9001, before: 2, after: 4, delta: 2 }], applied: 1 });
    },
  });

  const res = await logCards.handler(
    { items: [{ card_id: 'sv01-25', delta: 1 }, { card_id: 'sv01-25', delta: 1 }], dry_run: false },
    ctx,
  );

  assert.equal(res.isError, undefined);
  assert.equal(res.text.includes('NOT SENT'), false, 'the fold fix: every input index that produced the row must render it');
  const matches = res.text.match(/2 → 4 \(Δ\+2\)/g) ?? [];
  assert.equal(matches.length, 2, 'both input rows must show the same real result');
});

// ── 5. Per-item validation: exactly one of delta/quantity, non-zero delta ────

test('an item with BOTH delta and quantity, or with NEITHER, is skipped without touching the API — the rest of the batch still applies', async () => {
  const { ctx, sends } = makeCtx({
    onBatch: (body) => {
      assert.deepEqual(body.items, [{ variantId: 9001, delta: 1 }]);
      return batchResponse({ items: [{ variantId: 9001, before: 2, after: 3, delta: 1 }] });
    },
  });

  const res = await logCards.handler(
    {
      items: [
        { card_id: 'sv01-25', delta: 1 },
        { card_id: 'sv01-26', delta: 1, quantity: 1 },
        { card_id: 'sv01-26' },
        { card_id: 'sv01-26', delta: 0 },
      ],
      dry_run: false,
    },
    ctx,
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /has BOTH delta and quantity — provide exactly one/);
  assert.match(res.text, /has NEITHER delta nor quantity — provide exactly one/);
  assert.match(res.text, /delta must be non-zero/);
  assert.match(res.text, /applied 1, unchanged 0, skipped 3/);
  assert.equal(batchSends(sends).length, 1, 'invalid items never reach the API at all');
});

test('an unresolvable card_id is reported per-item and does not block the rest of the batch', async () => {
  const { ctx } = makeCtx({
    onBatch: (body) => {
      assert.deepEqual(body.items, [{ variantId: 9001, delta: 1 }]);
      return batchResponse({ items: [{ variantId: 9001, before: 2, after: 3, delta: 1 }] });
    },
  });

  const res = await logCards.handler(
    { items: [{ card_id: 'sv01-25', delta: 1 }, { card_id: 'no-such-card', delta: 1 }], dry_run: false },
    ctx,
  );

  assert.equal(res.isError, undefined);
  assert.match(res.text, /No card with id 'no-such-card'/);
  assert.match(res.text, /2 → 3/);
});

test('nothing to apply: every item invalid or unresolved returns ok(), not an error, and never calls the API', async () => {
  const { ctx, sends } = makeCtx({});

  const res = await logCards.handler({ items: [{ card_id: 'no-such-card', delta: 1 }] as never, dry_run: false }, ctx);

  assert.equal(res.isError, undefined);
  assert.match(res.text, /nothing to apply — 1 item\(s\) unresolved\/invalid/);
  assert.equal(batchSends(sends).length, 0);
});

// ── 6. Collection reads are scoped by ctx.userId, never confused or leaked ──

test('the owned-quantity lookup is scoped by ctx.userId — two users resolving the same card see their own counts, not each other\'s', async () => {
  const queriesA: VariantQuery[] = [];
  const { ctx: ctxA } = makeCtx({ userId: 'user-a', variantQueries: queriesA });
  const resA = await logCards.handler({ items: [{ card_id: 'sv01-25', quantity: 5 }], dry_run: true }, {
    ...ctxA,
    api: {
      ...ctxA.api,
      send: async (_m: string, _p: string, body?: unknown) => {
        // Echo back so the dry-run render can show the "before" the tool
        // itself derived — but the tool derives `before`/`after` only from the
        // API's own response, so this test asserts the QUERY PARAMETER
        // instead: the second bind parameter to the card_variant query is the
        // resolving user's id, not a shared or hardcoded one.
        return batchResponse({ dryRun: true, items: [{ variantId: 9001, before: 2, after: 5, delta: 3 }] });
      },
    },
  } as Ctx);

  const queriesB: VariantQuery[] = [];
  const { ctx: ctxB } = makeCtx({ userId: 'user-b', variantQueries: queriesB });
  await logCards.handler({ items: [{ card_id: 'sv01-25', quantity: 5 }], dry_run: true }, {
    ...ctxB,
    api: {
      ...ctxB.api,
      send: async () => batchResponse({ dryRun: true, items: [{ variantId: 9001, before: 40, after: 5, delta: -35 }] }),
    },
  } as Ctx);

  assert.equal(resA.isError, undefined);
  assert.equal(queriesA.length, 1);
  assert.equal(queriesA[0]!.userId, 'user-a', 'the variant query must carry the CALLING user, never a different one');
  assert.equal(queriesB.length, 1);
  assert.equal(queriesB[0]!.userId, 'user-b');
  assert.notEqual(queriesA[0]!.userId, queriesB[0]!.userId, 'two different ctx.userId values must never collapse to one query');
});

test('an ambiguous absolute-quantity target (owns multiple distinct variants, no variant specified) is reported per-user, from that user\'s own ownership', async () => {
  // Raichu (card 2) has two variants and NOBODY owns either in this fixture —
  // so setting an absolute quantity with no variant specified must default to
  // the primary, not ask, because ambiguity is keyed on the OWNER owning >1
  // distinct variant (see resolve.ts pickVariant), not on the card having >1.
  const { ctx } = makeCtx({
    userId: 'user-a',
    onBatch: (body) => {
      assert.deepEqual(body.items, [{ variantId: 9002, quantity: 2 }]);
      return batchResponse({ items: [{ variantId: 9002, before: 0, after: 2, delta: 2 }] });
    },
  });

  const res = await logCards.handler({ items: [{ card_id: 'sv01-26', quantity: 2 }], dry_run: false }, ctx);

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Raichu \| sv01-26 \| normal \| 0 → 2/);
});
