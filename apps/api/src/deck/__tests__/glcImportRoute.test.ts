import { test } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import type { Request, Response } from 'express';
import { rlsStore } from '../../db.js';
import { decksRouter } from '../../routes/decks.js';
import { ApiError } from '../../http.js';

const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cards = [
  { id: '1', tcgdex_id: 'sv01-1', name: 'Wailmer', local_id: '1', local_id_numeric: 1,
    set_tcgdex_id: 'sv01', category: 'Pokemon', stage: 'Basic', suffix: null, regulation_mark: 'H' },
  { id: '2', tcgdex_id: 'sv01-2', name: 'Sprigatito V', local_id: '2', local_id_numeric: 2,
    set_tcgdex_id: 'sv01', category: 'Pokemon', stage: 'Basic', suffix: 'V', regulation_mark: 'H' },
];

function fakeDb(sqls: string[]): pg.PoolClient {
  return {
    async query(sql: string, values?: unknown[]) {
      sqls.push(sql);
      if (sql.includes('WHERE s.tcgdex_id = $1 AND c.local_id_numeric = $2')) {
        const number = Number(values?.[1]);
        const row = cards.find((card) => card.local_id_numeric === number);
        return { rows: row ? [{ ...row, trainer_type: null, energy_type: null, hp: 90,
          retreat: 1, evolve_from: null, released_on: '2025-01-01' }] : [] };
      }
      if (sql.includes('FROM card_type WHERE card_id = ANY')) {
        const ids = values?.[0] as number[];
        return { rows: ids.map((id) => ({ card_id: String(id), type: id === 1 ? 'Water' : 'Grass' })) };
      }
      throw new Error(`Unexpected import query: ${sql.slice(0, 100)}`);
    },
  } as unknown as pg.PoolClient;
}

type ImportSummary = {
  glcType: string | null;
  pendingTypeCardIds: string[];
  formatIssues: Array<{ cardId: string; reason: string }>;
};

async function callImport(text: string, body: Record<string, unknown> = {}) {
  const sqls: string[] = [];
  const client = fakeDb(sqls);
  const route = decksRouter.stack.find((layer) => layer.route?.path === '/import');
  const handler = route?.route?.stack[0]?.handle;
  assert.ok(handler, 'POST /import is registered');
  const result = await rlsStore.run(client, () => new Promise<{ summary?: ImportSummary; error?: unknown }>((resolve) => {
    const req = { body: { text, formatCode: 'glc', dryRun: true, ...body }, user: { id: userId } } as unknown as Request;
    const res = {
      setHeader() { return this; },
      json(payload: { import: ImportSummary }) { resolve({ summary: payload.import }); return this; },
    } as unknown as Response;
    handler(req, res, (error: unknown) => resolve({ error }));
  }));
  return { ...result, sqls };
}

test('GLC dry run infers Water or Grass and never returns a hidden Grass mismatch', async () => {
  const water = await callImport('1 Wailmer SVI 1');
  assert.equal(water.error, undefined);
  assert.equal(water.summary?.glcType, 'Water');
  assert.deepEqual(water.summary?.pendingTypeCardIds, []);
  assert.deepEqual(water.summary?.formatIssues, []);

  const grass = await callImport('1 Sprigatito V SVI 2');
  assert.equal(grass.error, undefined);
  assert.equal(grass.summary?.glcType, 'Grass');
  assert.deepEqual(grass.summary?.pendingTypeCardIds, []);
  assert.equal(grass.summary?.formatIssues.some((issue) => issue.reason.includes('not Grass')), false);
});

test('ambiguous GLC preview leaves Pokémon type corrections pending and keeps definitive format issues', async () => {
  const preview = await callImport('1 Wailmer SVI 1\n1 Sprigatito V SVI 2');
  assert.equal(preview.error, undefined);
  assert.equal(preview.summary?.glcType, null);
  assert.deepEqual(preview.summary?.pendingTypeCardIds, ['sv01-1', 'sv01-2']);
  assert.ok(preview.summary?.formatIssues.some((issue) => issue.cardId === 'sv01-2' && /Rule Box/.test(issue.reason)));
  assert.equal(preview.summary?.formatIssues.some((issue) => /not (Water|Grass)/.test(issue.reason)), false);
});

test('explicit GLC type checks incompatible cards and unknown type cannot be written', async () => {
  const text = '1 Wailmer SVI 1\n1 Sprigatito V SVI 2';
  const declared = await callImport(text, { glcType: 'Water' });
  assert.equal(declared.error, undefined);
  assert.equal(declared.summary?.glcType, 'Water');
  assert.deepEqual(declared.summary?.pendingTypeCardIds, []);
  assert.ok(declared.summary?.formatIssues.some((issue) => issue.cardId === 'sv01-2' && /not Water/.test(issue.reason)));

  const write = await callImport(text, { dryRun: false });
  assert.ok(write.error instanceof ApiError);
  assert.equal(write.error.status, 400);
  assert.equal(write.sqls.some((sql) => /INSERT|BEGIN/i.test(sql)), false);
});
