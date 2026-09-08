import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestCardmarket } from '../cardmarket.js';
import type { CardmarketFile, CardmarketGuide } from '../types.js';

/**
 * The Cardmarket ingest's TWO-TABLE contract, without a database.
 *
 * `ingestCardmarket` writes `price_current` (the hot snapshot every price in the
 * app is read from) and `price_observation` (the append-only history every chart
 * is drawn from) from ONE in-memory array, inside one transaction. For five
 * nightly runs in August 2026 the first table was full, the second held not one
 * EUR row, and `sync_run` said `status: ok` with a plausible `rows_written`
 * every time. The outage was not that a write failed; it was that a job which
 * wrote half of what it claimed looked exactly like a healthy one.
 *
 * So these tests are about the REPORT as much as the write. The SQL itself is
 * verified against a real Postgres (PGlite) separately — what cannot be checked
 * there cheaply, and what silently rotted for three weeks here, is the
 * bookkeeping around it: what `sync_run` is told, which status a half-written
 * run gets, and whether the next run will retry the file it lost.
 *
 * The fake below is a real little database, not a script of canned answers: it
 * stores rows, enforces the natural key, and answers the read-back from what it
 * actually stored. `loseHistory` makes the observation INSERT report the rows it
 * would have written and keep none of them — the exact production shape.
 */

// ── the 15 and 13 columns the two batch INSERTs bind, in their fixed order ───
const OBS_COLS = [
  'card_variant_id', 'source_code', 'currency_code', 'captured_at',
  'market_minor', 'low_minor', 'mid_minor', 'high_minor', 'direct_low_minor',
  'trend_minor', 'avg1_minor', 'avg7_minor', 'avg30_minor', 'priced_at', 'sync_run_id',
] as const;
const CUR_COLS = [
  'card_variant_id', 'source_code', 'currency_code',
  'market_minor', 'low_minor', 'mid_minor', 'high_minor', 'direct_low_minor',
  'trend_minor', 'avg1_minor', 'avg7_minor', 'avg30_minor', 'priced_at',
] as const;

type Row = Record<string, any>;

function unbatch(params: unknown[], cols: readonly string[]): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < params.length; i += cols.length) {
    const r: Row = {};
    cols.forEach((c, k) => { r[c] = params[i + k]; });
    out.push(r);
  }
  return out;
}

interface VariantRow { id: number; pid: number; finish: string; prim: boolean; so: number }
interface FakeOpts {
  /** what `lastOkStamp` answers — set it to the file's stamp to exercise the skip path */
  lastStamp?: string | null;
  /** the production shape: the append reports rows it did not leave behind */
  loseHistory?: boolean;
  /** blow up in the variant lookup, i.e. after `startRun` and before the transaction */
  failVariantLookup?: boolean;
}

class FakeDb {
  runs: Row[] = [];
  observations: Row[] = [];
  current = new Map<string, Row>();
  tx: string[] = [];
  partitions: string[] = [];

  constructor(private variants: VariantRow[], private opts: FakeOpts = {}) {}

  get lastRun(): Row { return this.runs[this.runs.length - 1]!; }

  async query<T = Row>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const rows = (r: Row[]) => ({ rows: r as T[] });
    if (/pg_try_advisory_lock/.test(text)) return rows([{ locked: true }]);
    if (/pg_advisory_unlock/.test(text)) return rows([{}]);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text)) { this.tx.push(text.trim()); return rows([]); }

    if (/FROM price_source_field_map/.test(text)) {
      // migration 013's seed, which `assertFieldMap` cross-checks the importer against
      return rows([
        { upstream_field: 'avg', target_finish: 'holo' },
        { upstream_field: 'avg-holo', target_finish: 'reverse' },
        { upstream_field: 'trend-holo', target_finish: 'reverse' },
      ]);
    }
    if (/SELECT source_stamp FROM sync_run/.test(text)) {
      return rows(this.opts.lastStamp ? [{ source_stamp: this.opts.lastStamp }] : []);
    }
    if (/INSERT INTO sync_run/.test(text)) {
      const id = this.runs.length + 1;
      this.runs.push({ id, job: params[0], status: 'running', source_stamp: params[1], finished: false });
      return rows([{ id: String(id) }]);
    }
    if (/UPDATE sync_run SET status/.test(text)) {
      const run = this.runs.find((r) => r.id === params[0])!;
      Object.assign(run, {
        status: params[1], rows_written: params[2], items_seen: params[3],
        items_failed: params[4], cursor: params[5], error: params[6], finished: true,
      });
      return rows([]);
    }
    if (/CREATE (TABLE|INDEX) IF NOT EXISTS/.test(text)) {
      this.partitions.push(/price_observation_\d{4}_\d{2}/.exec(text)![0]);
      return rows([]);
    }
    if (/FROM card_variant cv/.test(text)) {
      if (this.opts.failVariantLookup) throw new Error('connection reset by peer');
      return rows(this.variants.map((v) => ({ id: String(v.id), pid: v.pid, finish: v.finish, prim: v.prim, so: v.so })));
    }
    if (/^\s*INSERT INTO price_observation/.test(text)) {
      const batch = unbatch(params, OBS_COLS);
      // the natural PK, honoured so a replay appends nothing exactly as the real one does
      const key = (r: Row) => `${r.card_variant_id}|${r.source_code}|${r.currency_code}|${(r.captured_at as Date).toISOString()}`;
      const seen = new Set(this.observations.map(key));
      const fresh = batch.filter((r) => !seen.has(key(r)));
      if (!this.opts.loseHistory) this.observations.push(...fresh);
      return rows(fresh.map(() => ({ one: 1 })));
    }
    if (/^\s*INSERT INTO price_current/.test(text)) {
      for (const r of unbatch(params, CUR_COLS)) {
        this.current.set(`${r.card_variant_id}|${r.source_code}|${r.currency_code}`, r);
      }
      return rows([]);
    }
    if (/count\(\*\)::text AS n FROM price_observation/.test(text)) {
      const [source, currency, capturedAt] = params as [number, string, Date];
      const n = this.observations.filter(
        (r) => r.source_code === source && r.currency_code === currency
          && (r.captured_at as Date).getTime() === capturedAt.getTime(),
      ).length;
      return rows([{ n: String(n) }]);
    }
    throw new Error(`FakeDb: unhandled query ${text.slice(0, 60)}`);
  }
}

// ── the fixture ─────────────────────────────────────────────────────────────
// P1 carries both price sets on one product (the reverse-holo trap); P2 is a
// plain single-printing product; P3 is priceless — every field null or zero.
const STAMP = '2026-08-09T01:00:03+0000';
const guide = (idProduct: number, base: (number | null)[], holo: (number | null)[]): CardmarketGuide => ({
  idProduct, idCategory: 6,
  avg: base[0]!, low: base[1]!, trend: base[2]!, avg1: base[3]!, avg7: base[4]!, avg30: base[5]!,
  'avg-holo': holo[0]!, 'low-holo': holo[1]!, 'trend-holo': holo[2]!,
  'avg1-holo': holo[3]!, 'avg7-holo': holo[4]!, 'avg30-holo': holo[5]!,
});
const FILE: CardmarketFile = {
  version: 1,
  createdAt: STAMP,
  priceGuides: [
    guide(1000, [1.23, 0.99, 1.5, 1.4, 1.35, 1.31], [4.2, 3.75, 4.5, 4.4, 4.3, 4.25]),
    guide(2000, [10, 8.5, 9.75, 9.8, 9.7, 9.6], [null, null, null, null, null, null]),
    guide(3000, [0, null, 0, null, null, null], [null, null, null, null, null, null]),
  ],
};
const VARIANTS: VariantRow[] = [
  { id: 11, pid: 1000, finish: 'normal', prim: true, so: 0 },
  { id: 12, pid: 1000, finish: 'reverse', prim: false, so: 1 },
  { id: 21, pid: 2000, finish: 'normal', prim: true, so: 0 },
  { id: 31, pid: 3000, finish: 'normal', prim: true, so: 0 },
];
const PRICED = 3; // P1 base + P1 reverse + P2. P3 has no usable price and is written nowhere.

// ── 1. the write itself ─────────────────────────────────────────────────────

test('a healthy run appends one EUR observation per priced variant', async () => {
  const db = new FakeDb(VARIANTS);
  const r = await ingestCardmarket(db, { file: FILE });

  assert.equal(r.observations, PRICED);
  assert.equal(db.observations.length, PRICED, 'the history half must receive every priced variant');
  assert.equal(db.current.size, PRICED, 'and so must the hot snapshot — they are fed one array');
  for (const o of db.observations) {
    // price_observation keys the source by price_source.id (SMALLINT); price_current keys it
    // by price_source.code (TEXT). Feeding either column the other's value is the kind of
    // mismatch that turns a whole source's history into nothing.
    assert.equal(o.source_code, 2, 'observations carry price_source.id 2 (tcgdex-cardmarket)');
    assert.equal(o.currency_code, 'EUR');
    assert.equal((o.captured_at as Date).toISOString(), new Date(STAMP).toISOString(),
      'captured_at is the FILE stamp — never now(), or every backfilled day collapses onto today');
    assert.equal(o.sync_run_id, 1, 'an observation nothing can be attributed to is unauditable');
  }
  for (const c of db.current.values()) {
    assert.equal(c.source_code, 'tcgdex-cardmarket', 'price_current keys the source by code');
  }
  assert.deepEqual(db.tx, ['BEGIN', 'COMMIT'], 'both writes belong to ONE transaction');
  assert.deepEqual(db.partitions, ['price_observation_2026_08', 'price_observation_2026_08'],
    'the month the stamp falls in must be ensured before the append — there is no DEFAULT partition');
});

test('the reverse-holo trap: `-holo` fields are the REVERSE listing, not a holo finish', async () => {
  // Cardmarket carries two price sets on one product object. Reading `-holo` as
  // "holofoil" ships the reverse-holo price as the card's headline price.
  const db = new FakeDb(VARIANTS);
  await ingestCardmarket(db, { file: FILE });
  const base = db.observations.find((o) => o.card_variant_id === 11)!;
  const reverse = db.observations.find((o) => o.card_variant_id === 12)!;

  assert.equal(base.mid_minor, 123, 'base `avg` -> mid_minor');
  assert.equal(base.trend_minor, 150);
  assert.equal(base.market_minor, 150, 'Cardmarket has no market price; `trend` is its headline');
  assert.equal(reverse.mid_minor, 420, '`avg-holo` belongs to the reverse variant');
  assert.equal(reverse.market_minor, 450);
  assert.equal(base.high_minor, null, 'Cardmarket publishes no high/direct-low — they stay NULL');
  assert.equal(base.direct_low_minor, null);
});

test('a product with no usable price is written to NEITHER table', async () => {
  // `price_observation` has CHECK (num_nonnulls(...) > 0) and every metric column
  // has CHECK (> 0): absence of a price is a missing row, not a row of zeroes.
  const db = new FakeDb(VARIANTS);
  await ingestCardmarket(db, { file: FILE });
  assert.ok(!db.observations.some((o) => o.card_variant_id === 31));
  assert.ok(!db.current.has('31|tcgdex-cardmarket|EUR'));
});

// ── 2. the report — what actually rotted ────────────────────────────────────

test('THE REGRESSION: a run whose history does not land must not report ok', async () => {
  // The production shape exactly: the append reports the rows it would have
  // written, `price_current` is filled, and `price_observation` gains nothing.
  // Before the read-back this ended `status: ok` with `rows_written: 26738`,
  // which is why five nightly runs of a dead writer looked like five good ones.
  const db = new FakeDb(VARIANTS, { loseHistory: true });
  await assert.rejects(
    ingestCardmarket(db, { file: FILE }),
    /history half did not land/,
    'a job that writes no history must fail, not return a result',
  );
  assert.equal(db.lastRun.status, 'failed');
  assert.equal(db.lastRun.rows_written, 0,
    'rows_written must be read BACK from price_observation, not reported from an in-process counter');
  assert.equal(db.lastRun.items_failed, PRICED, 'the shortfall is the number of rows that vanished');
  assert.match(String(db.lastRun.error), /price_current was written with 3/,
    'the message must name both halves, or the next reader repeats this investigation');
  assert.equal(db.current.size, PRICED, 'the hot snapshot IS written — that is what hid the failure');
});

test("a lost-history run does not claim its stamp, so the next run retries the file", async () => {
  // `lastOkStamp` treats 'ok' AND 'partial' as success. Marking this run partial
  // would make tomorrow's run skip the very file whose history is missing, and
  // the hole would be permanent. It has to be 'failed'.
  const db = new FakeDb(VARIANTS, { loseHistory: true });
  await assert.rejects(ingestCardmarket(db, { file: FILE }));
  assert.ok(!['ok', 'partial'].includes(db.lastRun.status as string),
    `status ${db.lastRun.status} would be read as a successful stamp and skip the retry`);
});

test('rows_written reports what is STORED, so a replay is honest rather than silent', async () => {
  // Re-running an already-ingested stamp appends nothing (B8: ON CONFLICT DO
  // NOTHING on the natural key). Reporting that 0 as "rows written" is exactly
  // as misleading as reporting a phantom 26,738 — the truthful number is what
  // the table holds for this stamp.
  const db = new FakeDb(VARIANTS);
  await ingestCardmarket(db, { file: FILE });
  const replay = await ingestCardmarket(db, { file: FILE, force: true });

  assert.equal(replay.observations, 0, 'a replayed stamp appends nothing');
  assert.equal(replay.storedObservations, PRICED, 'and the history is still all there');
  assert.equal(db.lastRun.status, 'ok', 'an idempotent re-run is a success, not a failure');
  assert.equal(db.lastRun.rows_written, PRICED);
  assert.deepEqual(JSON.parse(String(db.lastRun.cursor)), { appended: 0, priced: PRICED },
    'both numbers are recorded: what this run inserted, and what the stamp should have');
});

test('a skipped run leaves a closed sync_run row', async () => {
  // "Upstream has not republished today" and "the scheduler has been dead for
  // three weeks" must not be the same picture from the database. They were, and
  // that is how 2026-08-09 -> 2026-08-29 went unnoticed (DECISIONS.md 2026-08-29).
  const db = new FakeDb(VARIANTS, { lastStamp: STAMP });
  const r = await ingestCardmarket(db, { file: FILE });

  assert.equal(r.skipped, true);
  assert.equal(db.runs.length, 1, 'a skip is a run and must be recorded as one');
  assert.equal(db.lastRun.status, 'skipped');
  assert.equal(db.lastRun.finished, true, 'a skipped row left open would wedge the next run');
  assert.equal(db.lastRun.source_stamp, STAMP);
  assert.equal(db.observations.length, 0, 'a skip writes no prices');
});

test('an error before the transaction CLOSES the run instead of wedging the job forever', async () => {
  // `sync_run_one_active` is a partial UNIQUE index on (job) WHERE status='running'
  // (006). A throw between `startRun` and the transaction used to leave the row at
  // 'running', and every later run then failed inside `startRun` on that index —
  // one transient network error, and the job never runs again, silently.
  const db = new FakeDb(VARIANTS, { failVariantLookup: true });
  await assert.rejects(ingestCardmarket(db, { file: FILE }), /connection reset/);
  assert.equal(db.lastRun.status, 'failed', 'the run must not be left running');
  assert.equal(db.lastRun.finished, true);
  assert.match(String(db.lastRun.error), /connection reset/);
});

test('a version bump on the upstream file bails before touching anything', async () => {
  // The schema guard: Cardmarket changing its envelope must stop the job, not
  // reinterpret unknown fields as prices.
  const db = new FakeDb(VARIANTS);
  await assert.rejects(
    ingestCardmarket(db, { file: { ...FILE, version: 2 } }),
    /version 2 != 1/,
  );
  assert.equal(db.runs.length, 0, 'nothing may be recorded for a run that never started');
});
