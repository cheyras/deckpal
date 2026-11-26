/**
 * REST `GET /search` `attack` / `ability` filters fold Energy symbols (`{R}` = Fire) on both sides,
 * like `search_cards` (packages/agent-tools/src/__tests__/energyText.test.ts). Drives the REAL
 * route handler inside a mocked RLS client and captures the SQL it sends: no database, no network.
 *
 * What is pinned:
 *  - the bound term is folded, so "{R} Energy" and "Fire Energy" bind the same pattern;
 *  - the EFFECT column is wrapped in canonicalEnergyTextSql (gated: rows with no `{`/`<` skip it);
 *  - the NAME column is NOT folded: attack and Ability names never carry symbols, so `a.name` /
 *    `ab.name` are compared as stored (the folded term is still what they are compared against).
 *
 * Run: node --import tsx --test src/__tests__/search-energy-text.test.ts (wired into `test:pure`).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import type { Request, Response } from 'express';
import { canonicalEnergyTextSql } from '@deckpal/db/energyText';
import { rlsStore, closePool } from '../db.js';
import { searchRouter } from '../routes/search.js';

// The pool is never connected (every query goes to the mock client); pin config so no ambient
// .env can reach a real database, as catalog-cache.test.ts does.
Object.assign(process.env, {
  SUPABASE_MODE: '1',
  PGHOST: '127.0.0.1',
  PGPORT: '9',
  PGDATABASE: 'repair_no_network',
  PGUSER: 'repair',
  PGPASSWORD: '',
  PGSSLMODE: 'disable',
});

after(() => closePool());

type Call = { sql: string; params: unknown[] };

async function runSearch(query: Record<string, string>): Promise<Call[]> {
  const calls: Call[] = [];
  const client = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ sql: text, params: [...params] });
      return { rows: [] };
    },
  } as unknown as pg.PoolClient;
  const layer = searchRouter.stack.find((l) => l.route?.path === '/');
  const handle = layer?.route?.stack[0]?.handle;
  assert.ok(handle, 'GET /search is registered');
  await rlsStore.run(client, () =>
    new Promise<void>((resolve, reject) => {
      const res = {
        setHeader() { return this; },
        append() { return this; },
        set() { return this; },
        header() { return this; },
        status() { return this; },
        json() { resolve(); return this; },
      } as unknown as Response;
      const req = { query, headers: {}, params: {} } as unknown as Request;
      handle(req, res, (e?: unknown) => reject(e ?? new Error('unexpected next()')));
    }),
  );
  return calls;
}

for (const [param, alias, table] of [['attack', 'a', 'card_attack'], ['ability', 'ab', 'card_ability']] as const) {
  test(`/search ${param}: a {R} term and a Fire term bind the same folded pattern`, async () => {
    for (const term of ['Basic {R} Energy', 'Basic Fire Energy']) {
      const [call] = await runSearch({ [param]: term });
      assert.ok(call, 'one query was sent');
      assert.ok(call.params.includes('%Basic Fire Energy%'), `${term}: ${JSON.stringify(call.params)}`);
      assert.ok(!call.params.some((v) => typeof v === 'string' && v.includes('{R}')), 'symbol reached SQL unfolded');
    }
  });

  test(`/search ${param}: the effect column is folded, the name column is not`, async () => {
    const [call] = await runSearch({ [param]: 'Fire Energy' });
    assert.ok(call);
    assert.ok(call.sql.includes(`FROM ${table} ${alias} WHERE`), call.sql);
    assert.ok(call.sql.includes(`${canonicalEnergyTextSql(`${alias}.effect`)} ILIKE $`), 'effect is folded');
    assert.ok(call.sql.includes(`CASE WHEN strpos(${alias}.effect, '{') > 0`), 'the fold is gated');
    assert.match(call.sql, new RegExp(`\\(${alias}\\.name ILIKE \\$\\d+ OR`), 'name is compared as stored');
    assert.ok(!call.sql.includes(canonicalEnergyTextSql(`${alias}.name`)), 'name is not folded');
  });
}
