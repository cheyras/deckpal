/**
 * `dbHandle()` — the one rule that keeps a request from deadlocking itself.
 *
 * In SUPABASE_MODE the RLS middleware (index.ts) checks out ONE pooled client
 * for the whole lifetime of a request and puts it in `rlsStore`. A helper that
 * is handed the module `pool` instead calls `pool.query()`, and pg's implicit
 * connect→query→release is a SECOND checkout held at the same time. N concurrent
 * requests then want 2N connections; at `max=2` two requests wait on each other
 * until connectionTimeoutMillis fires and both answer 500. That is the
 * production incident of 2026-08-29, whose stack trace ran through
 * `buildReprintOracle` — so this suite pins the helper AND the call shape.
 *
 * No database: `pool` is never connected, and the second-checkout assertion is
 * exactly that `pool.connect` is not called.
 *
 * Run: node --import tsx --test src/__tests__/dbHandle.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { dbHandle, pool, rlsStore } from '../db.js';
import { buildReprintOracle } from '../deck/index.js';
import type { CardFacts } from '../deck/index.js';

/** A checked-out client that records what it was asked. */
function fakeClient(rows: Record<string, unknown>[] = []): pg.PoolClient & { sql: string[] } {
  const sql: string[] = [];
  return { sql, query: async (text: string) => { sql.push(text); return { rows }; } } as unknown as
    pg.PoolClient & { sql: string[] };
}

const card = (id: number, mark: string | null): CardFacts =>
  ({ id, tcgdexId: `x-${id}`, name: `Card ${id}`, regulationMark: mark }) as unknown as CardFacts;

test('outside a request there is no store, so the pool is the handle', () => {
  assert.equal(dbHandle(), pool);
});

test('inside a request the handle IS the client the middleware checked out', () => {
  const client = fakeClient();
  rlsStore.run(client, () => {
    assert.equal(dbHandle(), client);
  });
});

test('the handle survives an await — the store is async-context, not a global', async () => {
  const client = fakeClient();
  await rlsStore.run(client, async () => {
    await Promise.resolve();
    assert.equal(dbHandle(), client);
  });
});

test('a catalogue read inside a request takes NO second connection', async (t) => {
  const client = fakeClient();
  const connect = pool.connect;
  // Any implicit checkout is the bug, so make it loud rather than a 10s timeout.
  (pool as { connect: unknown }).connect = () => {
    throw new Error('second checkout: a request handler reached for the pool');
  };
  t.after(() => { (pool as { connect: unknown }).connect = connect; });

  await rlsStore.run(client, async () => {
    // 'D' has rotated out, so the oracle must actually query for a reprint.
    await buildReprintOracle(dbHandle(), [card(1, 'D')], ['H', 'I', 'J']);
  });
  assert.ok(client.sql.length > 0, 'the request client is what answered');
});
