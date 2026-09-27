/**
 * `mutation_history` and `revert` — CONTRACT tests.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * These two tools exist BECAUSE of the 2026-08-19 `log_cards` incident
 * (DECISIONS.md): recovering from it meant an agent hand-deriving 92
 * corrective deltas from `collection_log` under time pressure. `revert` is
 * the tool that is supposed to make that a one-line undo instead — which
 * makes it one of the highest-consequence UNTESTED tools in the package
 * (QUAL-04): a wrong `revert` call is itself a destructive write, logged as
 * one, undoable only by ANOTHER revert. Neither tool had any test before this
 * file.
 *
 * Both route entirely through `ctx.api` — no SQL — so a stub `Api` is enough.
 * This file pins:
 *  - `revert` requires EXACTLY ONE target (batch_id / event_id / since /
 *    entity_id) and refuses zero or several before ever calling the API;
 *  - `dry_run` (the default) never sends the revert;
 *  - conflicts and skips are rendered distinctly from clean, appliable rows;
 *  - a genuinely destructive apply reports its OWN batch id so it can itself
 *    be reverted (the "can be reverted" chain this file's own header claims);
 *    and
 *  - `mutation_history`'s batch_id-detail mode renders the undo instruction
 *    only when something in it is still undoable.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools } from '../index.js';
import type { Api } from '../api.js';
import type { Ctx } from '../ctx.js';

const byName = (n: string) => allTools().find((d) => d.name === n)!;

interface StubApi extends Api {
  sends: { method: string; path: string; body?: unknown }[];
  gets: string[];
}

function stubApi(opts: {
  get?: (path: string) => unknown;
  send?: (method: string, path: string, body?: unknown) => unknown;
}): StubApi {
  const sends: { method: string; path: string; body?: unknown }[] = [];
  const gets: string[] = [];
  return {
    sends,
    gets,
    base: 'https://test/api',
    get: async (path: string) => {
      gets.push(path);
      if (opts.get) return opts.get(path);
      throw new Error(`unexpected get ${path}`);
    },
    send: async (method: string, path: string, body?: unknown) => {
      sends.push({ method, path, body });
      if (opts.send) return opts.send(method, path, body);
      throw new Error(`unexpected send ${method} ${path}`);
    },
  } as unknown as StubApi;
}

function makeCtx(api: StubApi): Ctx {
  return { db: { query: async () => ({ rows: [] }) }, userId: 'u1', api } as unknown as Ctx;
}

// ── revert: target selection ─────────────────────────────────────────────────

test('revert with NO target refuses before calling the API', async () => {
  const api = stubApi({});
  const res = await byName('revert').handler({ strategy: 'inverse', force: false, dry_run: true }, makeCtx(api));
  assert.equal(res.isError, true);
  assert.match(res.text, /Pass one of: batch_id, event_id, since, or entity_type \+ entity_id/);
  assert.equal(api.sends.length, 0);
});

test('revert with TWO targets refuses — they mean different things and must never be combined', async () => {
  const api = stubApi({});
  const res = await byName('revert').handler(
    { batch_id: 'batch-1', event_id: 42, strategy: 'inverse', force: false, dry_run: true },
    makeCtx(api),
  );
  assert.equal(res.isError, true);
  assert.match(res.text, /Pass exactly ONE of batch_id, event_id, since, or entity_id/);
  assert.equal(api.sends.length, 0);
});

test('revert entity_id without entity_type refuses', async () => {
  const api = stubApi({});
  const res = await byName('revert').handler(
    { entity_id: '9001', strategy: 'inverse', force: false, dry_run: true },
    makeCtx(api),
  );
  assert.equal(res.isError, true);
  assert.match(res.text, /entity_id needs entity_type/);
  assert.equal(api.sends.length, 0);
});

// ── revert: dry_run never applies, and reports conflicts distinctly ─────────

test('revert dry_run sends dryRun:true and renders conflicts separately from clean rows', async () => {
  const api = stubApi({
    send: (method, path, body) => {
      assert.equal(method, 'POST');
      assert.equal(path, '/mutations/revert');
      assert.equal((body as { dryRun: boolean }).dryRun, true);
      return {
        dryRun: true,
        label: 'batch batch-1',
        strategy: 'inverse',
        plan: [
          { eventId: 1, entityType: 'collection_item', entityId: '9001', action: 'apply inverse Δ-1', conflicts: [], exact: true },
          {
            eventId: 2,
            entityType: 'collection_item',
            entityId: '9002',
            action: 'apply inverse Δ-1',
            conflicts: ['a later event asserted an absolute quantity'],
            exact: false,
          },
        ],
        applied: 0,
        wouldApply: 1,
        skipped: 0,
        conflicts: 1,
        batchId: null,
      };
    },
  });

  const res = await byName('revert').handler({ batch_id: 'batch-1', strategy: 'inverse', force: false, dry_run: true }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /revert DRY RUN — batch batch-1 \(strategy: inverse\)/);
  assert.match(res.text, /⚠ #2/);
  assert.match(res.text, /conflict: a later event asserted an absolute quantity/);
  assert.match(res.text, /would undo 1, 1 conflict\(s\), 0 skipped/);
  assert.match(res.text, /add force:true to apply the conflicted ones too/);
});

test('revert with nothing matching says so and does not render an empty plan', async () => {
  const api = stubApi({
    send: () => ({
      dryRun: true,
      label: 'since 2026-08-19T00:00:00Z',
      strategy: 'inverse',
      plan: [],
      applied: 0,
      skipped: 0,
      conflicts: 0,
      batchId: null,
    }),
  });

  const res = await byName('revert').handler({ since: '2026-08-19T00:00:00Z', strategy: 'inverse', force: false, dry_run: true }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /Nothing to undo for since 2026-08-19T00:00:00Z — no changes matched/);
});

// ── revert: an actual apply is itself a loggable, revertible operation ──────

test('revert dry_run:false applies and reports its OWN batch id — the undo of an undo', async () => {
  const api = stubApi({
    send: (method, path, body) => {
      assert.equal((body as { dryRun: boolean }).dryRun, false);
      assert.equal((body as { force: boolean }).force, false);
      return {
        dryRun: false,
        label: 'batch batch-1',
        strategy: 'inverse',
        plan: [{ eventId: 1, entityType: 'collection_item', entityId: '9001', action: 'apply inverse Δ-1', conflicts: [], exact: true }],
        applied: 1,
        skipped: 0,
        conflicts: 0,
        batchId: 'batch-revert-1',
      };
    },
  });

  const res = await byName('revert').handler({ batch_id: 'batch-1', strategy: 'inverse', force: false, dry_run: false }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /undid 1, 0 conflict\(s\) left alone, 0 skipped/);
  assert.match(res.text, /this revert is itself operation batch-revert-1 — revert\(batch_id: "batch-revert-1"\) undoes it/);
});

test("revert strategy:'restore' and force:true are forwarded verbatim to the API", async () => {
  const api = stubApi({
    send: (method, path, body) => {
      assert.equal((body as { strategy: string }).strategy, 'restore');
      assert.equal((body as { force: boolean }).force, true);
      return { dryRun: false, label: 'entity 9001', strategy: 'restore', plan: [], applied: 0, skipped: 0, conflicts: 0, batchId: null };
    },
  });

  await byName('revert').handler(
    { entity_type: 'collection_item', entity_id: '9001', strategy: 'restore', force: true, dry_run: false },
    makeCtx(api),
  );
  assert.equal(api.sends.length, 1);
});

// ── mutation_history ─────────────────────────────────────────────────────────

test('mutation_history batch_id detail mode offers the undo instruction only when something is still undoable', async () => {
  const api = stubApi({
    get: (path) => {
      if (path === '/mutations/batch-1') {
        return {
          batch: {
            batchId: 'batch-1',
            source: 'deckpal-mcp',
            tool: 'collection.batch',
            note: null,
            status: 'committed',
            idempotencyKey: 'key-1',
            revertsBatchId: null,
            summary: { applied: 1 },
            startedAt: '2026-08-19T02:12:00.000Z',
            finishedAt: '2026-08-19T02:12:01.000Z',
            eventCount: 1,
            revertedEventCount: 0,
          },
          events: [
            {
              eventId: 1,
              entityType: 'collection_item',
              entityId: '9001',
              operation: 'increment',
              before: { quantity: 2 },
              after: { quantity: 3 },
              requestedDelta: 1,
              effectiveDelta: 1,
              clamped: false,
              undoneByEventId: null,
              occurredAt: '2026-08-19T02:12:00.000Z',
            },
          ],
        };
      }
      throw new Error(`unexpected get ${path}`);
    },
  });

  const res = await byName('mutation_history').handler({ batch_id: 'batch-1', limit: 25, page: 1 }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /2 → 3/);
  assert.match(res.text, /undo this whole operation with revert\(batch_id: "batch-1"\)/);
});

test('mutation_history says every change was already reverted when none remain undoable', async () => {
  const api = stubApi({
    get: () => ({
      batch: {
        batchId: 'batch-1',
        source: 'deckpal-mcp',
        tool: 'collection.batch',
        note: null,
        status: 'committed',
        idempotencyKey: null,
        revertsBatchId: null,
        summary: null,
        startedAt: '2026-08-19T02:12:00.000Z',
        finishedAt: '2026-08-19T02:12:01.000Z',
        eventCount: 1,
        revertedEventCount: 1,
      },
      events: [
        {
          eventId: 1,
          entityType: 'collection_item',
          entityId: '9001',
          operation: 'increment',
          before: { quantity: 2 },
          after: { quantity: 3 },
          requestedDelta: 1,
          effectiveDelta: 1,
          clamped: false,
          undoneByEventId: 2,
          occurredAt: '2026-08-19T02:12:00.000Z',
        },
      ],
    }),
  });

  const res = await byName('mutation_history').handler({ batch_id: 'batch-1', limit: 25, page: 1 }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /every change in this operation has already been reverted/);
  assert.equal(res.text.includes('undo this whole operation'), false);
});

test('mutation_history list mode with zero results explains the log\'s start date rather than showing an empty page', async () => {
  const api = stubApi({
    get: () => ({ total: 0, page: 1, pageSize: 25, batches: [] }),
  });

  const res = await byName('mutation_history').handler({ limit: 25, page: 1 }, makeCtx(api));

  assert.equal(res.isError, undefined);
  assert.match(res.text, /No operations match/);
  assert.match(res.text, /mutation log starts at the 2026-08-19 release/);
});

test('mutation_history list mode forwards every filter as a query parameter', async () => {
  const api = stubApi({
    get: (path) => {
      assert.match(path, /\/mutations\?/);
      assert.match(path, /since=2026-08-19T00%3A00%3A00Z/);
      assert.match(path, /source=deckpal-mcp/);
      assert.match(path, /tool=collection\.batch/);
      assert.match(path, /entity_type=collection_item/);
      assert.match(path, /entity_id=9001/);
      return { total: 0, page: 1, pageSize: 25, batches: [] };
    },
  });

  await byName('mutation_history').handler(
    {
      since: '2026-08-19T00:00:00Z',
      source: 'deckpal-mcp',
      tool: 'collection.batch',
      entity_type: 'collection_item',
      entity_id: '9001',
      limit: 25,
      page: 1,
    },
    makeCtx(api),
  );
});
