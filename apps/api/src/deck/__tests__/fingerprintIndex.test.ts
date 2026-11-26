/**
 * `indexFingerprints`' write discipline, against a mocked pool and an injected hash source:
 * `--all` re-reads every row, `--dry-run` writes nothing and names every row that would move.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { indexFingerprints } from '../fingerprintIndex.js';

const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const SAME = 'c'.repeat(64);

const ROWS = [
  { id: '1', tcgdex_id: 'me04-013', name: 'Delphox', fp: OLD }, // definition moved
  { id: '2', tcgdex_id: 'sv01-001', name: 'Sprigatito', fp: SAME }, // unchanged
  { id: '3', tcgdex_id: 'me05-001', name: 'Alpha', fp: null }, // never hashed
  { id: '4', tcgdex_id: 'base1-999', name: 'Stub', fp: null }, // too thin
];
const COMPUTED = new Map<number, string | null>([[1, NEW], [2, SAME], [3, NEW], [4, null]]);

function mockPool(): { pool: pg.Pool; sql: string[] } {
  const sql: string[] = [];
  const pool = {
    async query(text: string) {
      sql.push(text);
      if (/^\s*SELECT id, tcgdex_id/.test(text)) {
        return { rows: /IS NULL/.test(text) ? ROWS.filter((r) => r.fp === null) : ROWS, rowCount: 0 };
      }
      if (/^\s*UPDATE card/.test(text)) return { rows: [], rowCount: 2 };
      throw new Error(`unexpected query: ${text.slice(0, 80)}`);
    },
  } as unknown as pg.Pool;
  return { pool, sql };
}

const compute = async (_pool: pg.Pool, ids: number[]) => new Map(ids.map((id) => [id, COMPUTED.get(id) ?? null]));

test('a dry run writes nothing and lists exactly the rows whose hash would move', async () => {
  const { pool, sql } = mockPool();
  const res = await indexFingerprints(pool, { all: true, dryRun: true, compute });
  assert.equal(sql.filter((s) => /UPDATE/.test(s)).length, 0, 'no UPDATE on a dry run');
  assert.deepEqual(
    { scanned: res.scanned, written: res.written, unchanged: res.unchanged, tooThin: res.tooThin },
    { scanned: 4, written: 2, unchanged: 1, tooThin: 1 },
  );
  assert.deepEqual(res.changes, [
    { id: 1, tcgdexId: 'me04-013', name: 'Delphox', before: OLD, after: NEW },
    { id: 3, tcgdexId: 'me05-001', name: 'Alpha', before: null, after: NEW },
  ]);
});

test('--all reads every row; the default reads only NULL rows; a real run writes with IS DISTINCT FROM', async () => {
  const full = mockPool();
  const res = await indexFingerprints(full.pool, { all: true, compute });
  assert.doesNotMatch(full.sql[0]!, /IS NULL/);
  assert.equal(res.changes, undefined, 'only a dry run lists changes');
  const update = full.sql.find((s) => /UPDATE card/.test(s));
  assert.ok(update && /IS DISTINCT FROM/.test(update));
  assert.equal(res.written, 2);

  const nullsOnly = mockPool();
  const partial = await indexFingerprints(nullsOnly.pool, { compute });
  assert.match(nullsOnly.sql[0]!, /WHERE playable_fingerprint IS NULL/);
  assert.equal(partial.scanned, 2);
});
