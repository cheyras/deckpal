import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestTcgcsvPrices, type IngestDeps } from '../tcgcsv.js';
import { RateLimited } from '../http.js';
import type { LinkResult } from '../linkTcgcsv.js';

/**
 * How the link pass is SEQUENCED around the price ingest, without a database.
 *
 * The behaviour worth pinning is about retry and honesty, not matching: a link failure must (1) not
 * stop today's prices, (2) turn the job red, and (3) be retried by the NEXT 15-minute tick — which
 * the price ingest's skip-if-unchanged would otherwise swallow until tomorrow's stamp. That is why
 * the link pass is its own `sync_run` job (`products-tcgcsv`) with its own stamp. The first draft
 * recorded the run `partial`, which `lastOkStamp` counts as done, and suppressed the retry.
 */

interface Run { id: number; job: string; stamp: string | null; status: string; error?: string }

function fakeClient() {
  const runs: Run[] = [];
  const client = {
    runs,
    async query(text: string, params: unknown[] = []) {
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (text.includes('pg_advisory_unlock')) return { rows: [] };
      if (text.includes('FROM sync_run') && text.includes("status IN ('ok','partial')")) {
        const last = [...runs].reverse().find((r) => r.job === params[0] && (r.status === 'ok' || r.status === 'partial'));
        return { rows: last ? [{ source_stamp: last.stamp }] : [] };
      }
      if (text.includes("SET status = 'orphaned'")) {
        for (const r of runs) if ((params[0] as string[]).includes(r.job) && r.status === 'running') r.status = 'orphaned';
        return { rows: [] };
      }
      if (text.includes('INSERT INTO sync_run')) {
        // sync_run_one_active: one `running` row per job, enforced like the real unique index.
        if (runs.some((r) => r.job === params[0] && r.status === 'running')) {
          throw new Error('duplicate key value violates unique constraint "sync_run_one_active"');
        }
        const run: Run = { id: runs.length + 1, job: String(params[0]), stamp: (params[1] as string | null) ?? null, status: 'running' };
        runs.push(run);
        return { rows: [{ id: String(run.id) }] };
      }
      if (text.includes('UPDATE sync_run')) {
        const run = runs.find((r) => r.id === params[0])!;
        run.status = String(params[1]);
        if (params[6]) run.error = String(params[6]);
        return { rows: [] };
      }
      if (text.includes('FROM card_set')) return { rows: [] }; // no sets: the price walk is empty
      return { rows: [] }; // BEGIN / COMMIT / ROLLBACK / partition DDL
    },
  };
  return client;
}

const STAMP = '2026-10-01T20:05:00Z';
const linkResult = (over: Partial<LinkResult> = {}): LinkResult => ({
  dryRun: false, setsScanned: 3, groupsAssigned: 1, variantsLinked: 10, unresolvedSets: 0, failedSets: [], perSet: [], ...over,
});
const deps = (link: IngestDeps['linkProducts'], calls: { n: number }): IngestDeps => ({
  fetchLastUpdated: async () => STAMP,
  fetchGroupPrices: async () => [],
  linkProducts: async (...a) => { calls.n++; return link!(...a); },
});
const jobStatus = (c: ReturnType<typeof fakeClient>, job: string) => c.runs.filter((r) => r.job === job).map((r) => r.status);

test('a link failure does not stop the prices, still fails the job, and is recorded as its own failed run', async () => {
  const c = fakeClient(); const calls = { n: 0 };
  await assert.rejects(
    ingestTcgcsvPrices(c as never, {}, deps(async () => linkResult({ failedSets: [{ set: 'svp', error: 'HTTP 503' }] }), calls)),
    /link pass failed.*svp: HTTP 503/s,
  );
  assert.deepEqual(jobStatus(c, 'prices-tcgcsv'), ['ok'], "today's prices were ingested");
  assert.deepEqual(jobStatus(c, 'products-tcgcsv'), ['failed'], 'and the link failure is on the record');
});

test('the NEXT tick retries a failed link pass even though the prices are already in', async () => {
  const c = fakeClient(); const calls = { n: 0 };
  await assert.rejects(ingestTcgcsvPrices(c as never, {}, deps(async () => linkResult({ failedSets: [{ set: 'svp', error: 'x' }] }), calls)));
  assert.equal(calls.n, 1);
  // Same stamp, prices unchanged — the old design would skip here until tomorrow.
  const r = await ingestTcgcsvPrices(c as never, {}, deps(async () => linkResult(), calls));
  assert.equal(calls.n, 2, 'the link pass ran again');
  assert.equal(r.skipped, true, 'prices were not re-ingested');
  assert.equal(r.linkedVariants, 10);
  assert.deepEqual(jobStatus(c, 'products-tcgcsv'), ['failed', 'ok']);
  // And once it has succeeded for this stamp, the poll goes back to costing one query.
  await ingestTcgcsvPrices(c as never, {}, deps(async () => linkResult(), calls));
  assert.equal(calls.n, 2, 'no third link run for an unchanged stamp');
});

test('on an unchanged stamp whose link already failed, the retry failing again is still loud', async () => {
  const c = fakeClient(); const calls = { n: 0 };
  await assert.rejects(ingestTcgcsvPrices(c as never, {}, deps(async () => linkResult({ failedSets: [{ set: 'a', error: 'e' }] }), calls)));
  await assert.rejects(
    ingestTcgcsvPrices(c as never, {}, deps(async () => linkResult({ failedSets: [{ set: 'a', error: 'e' }] }), calls)),
    /link pass failed/,
  );
  assert.deepEqual(jobStatus(c, 'prices-tcgcsv'), ['ok'], 'the prices were not ingested twice');
});

test('a thrown link error is held the same way: prices continue, the job fails', async () => {
  const c = fakeClient(); const calls = { n: 0 };
  await assert.rejects(
    ingestTcgcsvPrices(c as never, {}, deps(async () => { throw new Error('connection reset'); }, calls)),
    /link pass failed.*connection reset/s,
  );
  assert.deepEqual(jobStatus(c, 'prices-tcgcsv'), ['ok']);
  assert.deepEqual(jobStatus(c, 'products-tcgcsv'), ['failed']);
});

test('a rate limit aborts the whole run: no prices are ingested', async () => {
  const c = fakeClient(); const calls = { n: 0 };
  await assert.rejects(
    ingestTcgcsvPrices(c as never, {}, deps(async () => { throw new RateLimited(429, 'https://tcgcsv.com/x'); }, calls)),
    RateLimited,
  );
  assert.deepEqual(jobStatus(c, 'prices-tcgcsv'), []);
  assert.deepEqual(jobStatus(c, 'products-tcgcsv'), ['failed']);
});

test('link:false skips the link pass entirely', async () => {
  const c = fakeClient(); const calls = { n: 0 };
  await ingestTcgcsvPrices(c as never, { link: false }, deps(async () => linkResult(), calls));
  assert.equal(calls.n, 0);
  assert.deepEqual(jobStatus(c, 'products-tcgcsv'), []);
});

test('a run restricted to some sets records no stamp, so it can never stand in for the full run', async () => {
  const c = fakeClient(); const calls = { n: 0 };
  await ingestTcgcsvPrices(c as never, { sets: ['svp'] }, deps(async () => linkResult(), calls));
  assert.equal(c.runs.find((r) => r.job === 'products-tcgcsv')!.stamp, null);
  // The full run that follows still does its own link pass.
  await ingestTcgcsvPrices(c as never, {}, deps(async () => linkResult(), calls));
  assert.equal(calls.n, 2);
});

test('a link run killed mid-flight does not wedge price ingestion: its stale row is swept and the work retried', async () => {
  const c = fakeClient(); const calls = { n: 0 };
  // What a cancelled runner leaves behind, for BOTH jobs.
  c.runs.push({ id: 100, job: 'products-tcgcsv', stamp: STAMP, status: 'running' });
  c.runs.push({ id: 101, job: 'prices-tcgcsv', stamp: STAMP, status: 'running' });
  const r = await ingestTcgcsvPrices(c as never, {}, deps(async () => linkResult(), calls));
  assert.equal(r.skipped, false, 'prices were ingested, not blocked behind the stale rows');
  assert.equal(calls.n, 1, 'and the interrupted link pass was retried');
  assert.equal(c.runs.find((x) => x.id === 100)!.status, 'orphaned');
  assert.equal(c.runs.find((x) => x.id === 101)!.status, 'orphaned');
  assert.deepEqual(jobStatus(c, 'products-tcgcsv'), ['orphaned', 'ok']);
});

test('if even recording the link run fails, prices still run and the job fails loudly', async () => {
  const c = fakeClient(); const calls = { n: 0 };
  const realQuery = c.query.bind(c);
  c.query = async (text: string, params: unknown[] = []) => {
    if (text.includes('INSERT INTO sync_run') && params[0] === 'products-tcgcsv') throw new Error('connection terminated');
    return realQuery(text, params);
  };
  await assert.rejects(
    ingestTcgcsvPrices(c as never, {}, deps(async () => linkResult(), calls)),
    /link pass failed.*connection terminated/s,
  );
  assert.equal(calls.n, 0);
  assert.deepEqual(jobStatus(c, 'prices-tcgcsv'), ['ok']);
});
