/**
 * The caps `pnpm mcp:audit --responses` led to (2026-10-12). Each of these
 * outputs had no upper bound — it grew with the user's data — and each now
 * pages, says how much is left and how to get it:
 *
 *   lists (one list)        300 items measured 32,789 chars; a master set 42,228
 *   decks (the index)       30 decks 3,564 chars, growing ~120 a deck
 *   mutation_history batch  one 250-item operation 14,243 chars
 *   revert (the plan)       the same 250 items 12,694 chars, up to 500 lines
 *
 * battle_logs' raw cap and the fenced raw block are pinned in
 * untrusted.test.ts. Pure, with `ctx.api` stubbed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allTools } from '../index.js';
import type { Api } from '../api.js';
import type { Ctx } from '../ctx.js';

const tool = (n: string) => allTools().find((d) => d.name === n)!;

function ctxWith(get: (path: string) => unknown, send?: (method: string, path: string, body?: unknown) => unknown): Ctx {
  const api = {
    base: 'https://test/api',
    get: async (path: string) => get(path),
    send: async (method: string, path: string, body?: unknown) => {
      if (!send) throw new Error(`unexpected ${method} ${path}`);
      return send(method, path, body);
    },
  } as unknown as Api;
  return { db: { query: async () => ({ rows: [] }) }, userId: 'u1', api } as unknown as Ctx;
}

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

test('lists: one list reads 100 items a page and says how to reach the rest', async () => {
  const listId = uuid(1);
  const items = Array.from({ length: 250 }, (_, i) => ({
    itemId: uuid(1000 + i), position: i, kind: 'card', cardId: `sv08-${String(i + 1).padStart(3, '0')}`, name: `Card ${i + 1}`,
    variant: { kind: 'normal', displayName: 'Normal' }, rarity: 'Common', price: { market: 0.1, currency: 'USD' }, ownedQuantity: 0,
  }));
  const summary = { id: listId, kind: 'static', name: 'Big list', itemCount: 250, progress: null, marketValueUsd: 25, updatedAt: '2026-10-01' };
  const ctx = ctxWith((path) => {
    if (path === '/lists') return { lists: [summary] };
    if (path === `/lists/${listId}`) return { list: summary, items };
    throw new Error(`unexpected get ${path}`);
  });
  const first = await tool('lists').handler({ list_id: listId, deleted: false, page: 1, page_size: 100 }, ctx);
  const rows = (t: string) => t.split('\n').filter((l) => l.startsWith('  x'));
  assert.equal(rows(first.text).length, 100);
  assert.match(first.text, /showing 1–100 of 250 — page 2 for more/);
  const last = await tool('lists').handler({ list_id: listId, deleted: false, page: 3, page_size: 100 }, ctx);
  assert.equal(rows(last.text).length, 50);
  assert.match(last.text, /showing 201–250 of 250$/m);
  assert.ok(rows(last.text)[0]!.includes('Card 201'));
});

test('decks: the index pages at 100 decks', async () => {
  const decks = Array.from({ length: 150 }, (_, i) => ({
    id: uuid(i), name: `Deck ${i + 1}`, formatCode: 'standard', version: 1, totalCount: 60, valueUsd: 10, legal: true,
    updatedAt: '2026-10-01', record: { wins: 0, losses: 0, ties: 0 },
  }));
  const ctx = ctxWith((path) => {
    if (path === '/decks') return { decks };
    throw new Error(`unexpected get ${path}`);
  });
  const first = await tool('decks').handler({ deleted: false, page: 1 }, ctx);
  assert.equal(first.text.split('\n').filter((l) => l.startsWith('Deck ')).length, 100);
  assert.match(first.text, /150 deck\(s\); showing 1–100 of 150 — page 2 for more/);
  const second = await tool('decks').handler({ deleted: false, page: 2 }, ctx);
  assert.equal(second.text.split('\n').filter((l) => l.startsWith('Deck ')).length, 50);
});

test('decks: an index that fits one page reads exactly as it always did', async () => {
  const ctx = ctxWith(() => ({ decks: [{ id: uuid(1), name: 'Only', formatCode: 'standard', version: 1, totalCount: 60, valueUsd: 1, legal: true, updatedAt: '', record: { wins: 0, losses: 0, ties: 0 } }] }));
  const res = await tool('decks').handler({ deleted: false, page: 1 }, ctx);
  assert.match(res.text, /\n1 deck\(s\)$/);
});

const batch = (events: number) => ({
  batch: {
    batchId: uuid(9), source: 'deckpal-mcp', tool: 'collection.batch', note: null, status: 'committed', idempotencyKey: null,
    revertsBatchId: null, summary: null, startedAt: '2026-10-01T00:00:00Z', finishedAt: null, eventCount: events, revertedEventCount: 0,
  },
  events: Array.from({ length: events }, (_, i) => ({
    eventId: i + 1, entityType: 'collection_item', entityId: String(500 + i), operation: 'quantity.delta',
    before: { quantity: 0 }, after: { quantity: 1 }, requestedDelta: 1, effectiveDelta: 1, clamped: false, undoneByEventId: null, occurredAt: '2026-10-01',
  })),
});

test('mutation_history: one operation lists its changes 50 a page, and limit/page move through them', async () => {
  const ctx = ctxWith((path) => {
    if (path === `/mutations/${uuid(9)}`) return batch(250);
    throw new Error(`unexpected get ${path}`);
  });
  const first = await tool('mutation_history').handler({ batch_id: uuid(9), page: 1 }, ctx);
  const lines = (t: string) => t.split('\n').filter((l) => /^ {2}#\d+ \|/.test(l));
  assert.equal(lines(first.text).length, 50);
  assert.match(first.text, /250 change\(s\):/);
  assert.match(first.text, /showing 1–50 of 250 — page 2 for more \(same batch_id\)/);
  assert.match(first.text, /revert\(batch_id: /, 'the undo hint survives paging');
  const page3 = await tool('mutation_history').handler({ batch_id: uuid(9), page: 3, limit: 100 }, ctx);
  assert.equal(lines(page3.text).length, 50);
  assert.ok(lines(page3.text)[0]!.startsWith('  #201 |'));
});

test('mutation_history: the operations feed keeps its default of 25', async () => {
  let asked = '';
  const ctx = ctxWith((path) => {
    asked = path;
    return { total: 0, page: 1, pageSize: 25, batches: [] };
  });
  await tool('mutation_history').handler({ page: 1 }, ctx);
  assert.match(asked, /limit=25/);
});

test('revert: a big plan lists 50 clean items, every conflict and skip, and the true counts', async () => {
  const plan = Array.from({ length: 300 }, (_, i) => ({
    eventId: i + 1, entityType: 'collection_item', entityId: String(i), operation: 'quantity.delta',
    action: `quantity 1 → 0`, conflicts: i === 250 ? ['a later call set an absolute quantity'] : [], exact: true,
    ...(i === 299 ? { skipped: 'already undone' } : {}),
  }));
  const ctx = ctxWith(
    () => { throw new Error('no reads'); },
    () => ({ dryRun: true, label: 'batch x', strategy: 'inverse', plan, applied: 0, wouldApply: 298, skipped: 1, conflicts: 1, batchId: null }),
  );
  const res = await tool('revert').handler({ batch_id: uuid(9), strategy: 'inverse', force: false, dry_run: true }, ctx);
  const clean = res.text.split('\n').filter((l) => l.startsWith('  · '));
  assert.equal(clean.length, 50);
  assert.match(res.text, /⚠ #251 \|/, 'the conflict is listed even though it is past the first 50');
  assert.match(res.text, /conflict: a later call set an absolute quantity/);
  assert.match(res.text, /✗ #300 \|/, 'the skip is listed too');
  assert.match(res.text, /… and 248 more clean item\(s\), no conflicts among them/);
  assert.match(res.text, /would undo 298, 1 conflict\(s\), 1 skipped/);
});

test('revert refuses an argument it does not know, instead of dropping a filter', () => {
  // `source` is mutation_history's name for the filter revert calls
  // `filter_source`, and apps/mcp/SPEC.md documented it for revert too.
  const schema = tool('revert').inputSchema!;
  const parsed = schema.safeParse({ since: '2026-10-01T00:00:00Z', source: 'deckpal-mcp' });
  assert.equal(parsed.success, false);
  assert.ok(schema.safeParse({ since: '2026-10-01T00:00:00Z', filter_source: 'deckpal-mcp' }).success);
});
