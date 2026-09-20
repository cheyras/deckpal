import test from 'node:test';
import assert from 'node:assert/strict';
import { runCloudSnapshot } from '../jobs/cloudSnapshot.js';

/**
 * Tests for runCloudSnapshot: the advisory lock + sync_run bookkeeping wrapper
 * around snapshotAllUsers.
 *
 * The goal is the same as cardmarket.test.ts: assert on the REPORT (sync_run
 * state) as much as on the write, because a wrapper that performs the work but
 * mis-books it is invisible at the health endpoint.
 *
 * No real database: FakeDb intercepts the six query shapes the wrapper and
 * snapshotAllUsers produce, enforces their invariants from what it actually
 * stored, and lets individual tests flip failure modes.
 */

// ── FakeDb ───────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface FakeOpts {
  /** pg_try_advisory_lock returns false: another process holds the lock */
  lockHeld?: boolean;
  /** startRunOrSkip ON CONFLICT DO NOTHING fires: another run is active */
  activeRunExists?: boolean;
  /** snapshotAllUsers' INSERT INTO collection_value_point throws this */
  snapshotError?: Error;
  /**
   * user_id strings returned by the INSERT RETURNING clause.
   * Controls inserted count (rows.length) and users count (distinct set size).
   * Empty slice = idempotent re-run: ON CONFLICT DO NOTHING returned 0 rows.
   */
  snapshotUserIds?: string[];
}

class FakeDb {
  /** Every sync_run row opened during this session. */
  runs: Row[] = [];
  /** How many times pg_advisory_unlock was called (must be 1 on success/error, 0 on lock-skip). */
  unlockCalls = 0;
  /**
   * The $1 param received by INSERT INTO collection_value_point.
   * undefined = query never reached; null = opts.observedOn was null/omitted.
   */
  capturedObservedOn: string | null | undefined = undefined;

  constructor(private opts: FakeOpts = {}) {}

  get lastRun(): Row { return this.runs[this.runs.length - 1]!; }

  async query<T = Row>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const rows = (r: Row[]) => ({ rows: r as T[] });

    // ── advisory lock ──────────────────────────────────────────────────────
    if (/pg_try_advisory_lock/.test(text)) {
      return rows([{ locked: !this.opts.lockHeld }]);
    }
    if (/pg_advisory_unlock/.test(text)) {
      this.unlockCalls++;
      return rows([{}]);
    }

    // ── sync_run lifecycle ─────────────────────────────────────────────────
    if (/INSERT INTO sync_run/.test(text)) {
      if (this.opts.activeRunExists) {
        // ON CONFLICT (job) WHERE status='running' DO NOTHING → no RETURNING row
        return rows([]);
      }
      const id = this.runs.length + 1;
      this.runs.push({ id, job: params[0], status: 'running', finished: false });
      return rows([{ id: String(id) }]);
    }
    if (/UPDATE sync_run SET status/.test(text)) {
      // finishRun: ($1=id, $2=status, $3=rows_written, …, $7=error)
      const run = this.runs.find((r) => r.id === params[0])!;
      Object.assign(run, {
        status: params[1],
        rows_written: params[2],
        error: params[6],
        finished: true,
      });
      return rows([]);
    }

    // ── snapshotAllUsers queries ───────────────────────────────────────────
    if (/INSERT INTO collection_value_point/.test(text)) {
      // $1 is opts.observedOn ?? null, forwarded unchanged by snapshotAllUsers
      this.capturedObservedOn = params[0] as string | null;
      if (this.opts.snapshotError) throw this.opts.snapshotError;
      const userIds = this.opts.snapshotUserIds ?? [];
      return rows(userIds.map((user_id) => ({ user_id })));
    }
    if (/SELECT to_char\(COALESCE/.test(text)) {
      // snapshotAllUsers date query: resolve $1 (observedOn) or fall back to today
      const d = (params[0] as string | null) ?? '2026-09-19';
      return rows([{ d }]);
    }

    throw new Error(`FakeDb: unhandled query: ${text.slice(0, 80)}`);
  }
}

// ── 1. success: row accounting ────────────────────────────────────────────────

test('a successful run records inserted count and closes ok', async () => {
  // 4 RETURNING rows = 4 inserted; 2 distinct user_ids = 2 users
  const db = new FakeDb({ snapshotUserIds: ['u1', 'u2', 'u1', 'u2'] });
  const r = await runCloudSnapshot(db);

  assert.ok(!('skipped' in r), 'result must be a ValueSnapshotResult, not a skip');
  assert.equal(r.inserted, 4);
  assert.equal(r.users, 2);
  assert.equal(db.runs.length, 1);
  assert.equal(db.lastRun.status, 'ok');
  assert.equal(db.lastRun.rows_written, 4, 'rows_written must equal inserted from snapshotAllUsers');
  assert.equal(db.lastRun.finished, true);
});

// ── 2. idempotent zero-row success ───────────────────────────────────────────

test('a same-day re-run inserts 0 rows, closes ok, and gives health a fresh timestamp', async () => {
  // ON CONFLICT (user_id, observed_on, currency_code) DO NOTHING → INSERT RETURNING []
  const db = new FakeDb({ snapshotUserIds: [] });
  const r = await runCloudSnapshot(db);

  assert.ok(!('skipped' in r));
  assert.equal(r.inserted, 0);
  assert.equal(db.lastRun.status, 'ok',
    'zero inserted is idempotent, not a failure — /api/health needs the fresh finished_at');
  assert.equal(db.lastRun.rows_written, 0);
  assert.equal(db.lastRun.finished, true, 'run must close so health is not stale');
});

// ── 3. snapshot failure: bookkeeping + propagated error ──────────────────────

test('snapshot error marks run failed and propagates so CLI exits non-zero', async () => {
  const boom = new Error('price_current is empty — no market data to snapshot');
  const db = new FakeDb({ snapshotError: boom });

  await assert.rejects(
    runCloudSnapshot(db),
    /price_current is empty/,
    'error must propagate; swallowing it would leave the scheduler unaware of the failure',
  );
  assert.equal(db.runs.length, 1, 'a run was opened before the snapshot was attempted');
  assert.equal(db.lastRun.status, 'failed');
  assert.equal(db.lastRun.finished, true);
  assert.match(String(db.lastRun.error), /price_current is empty/,
    'error message must land in sync_run so the next reader does not repeat this investigation');
});

// ── 4. lock contention: no fabricated completed snapshot ─────────────────────

test('lock held: skip cleanly, no sync_run row opened', async () => {
  // Another process (manual re-run or a hung previous run) holds the advisory lock.
  const db = new FakeDb({ lockHeld: true });
  const r = await runCloudSnapshot(db);

  assert.ok('skipped' in r && r.skipped === true);
  assert.match(r.reason, /lock/);
  assert.equal(db.runs.length, 0,
    'a lock skip must not open a sync_run row — that would manufacture a health record');
  assert.equal(db.unlockCalls, 0,
    'lock was never acquired, must not be released — unlock without acquire is a no-op but is still wrong');
});

// ── 5. active-run conflict ────────────────────────────────────────────────────

test('active run (sync_run_one_active): skip cleanly, report reason', async () => {
  // INSERT … ON CONFLICT … DO NOTHING fired: a running row exists for this job.
  const db = new FakeDb({ activeRunExists: true });
  const r = await runCloudSnapshot(db);

  assert.ok('skipped' in r && r.skipped === true);
  assert.match(r.reason, /active/);
  assert.equal(db.runs.length, 0,
    'ON CONFLICT DO NOTHING returned no id; no run was opened by this call');
  // Lock WAS acquired (tryLock returned true), so unlock must happen.
  assert.equal(db.unlockCalls, 1,
    'lock acquired before startRunOrSkip; must be released even when the run is skipped');
});

// ── 6. unlock on failures ─────────────────────────────────────────────────────

test('advisory lock is released in finally even when the snapshot throws', async () => {
  const db = new FakeDb({ snapshotError: new Error('connection reset') });
  await assert.rejects(runCloudSnapshot(db), /connection reset/);
  assert.equal(db.unlockCalls, 1,
    'a missing unlock leaves the advisory lock held until the connection closes, ' +
    'blocking every subsequent run of this job');
});

// ── 7. observedOn forwarding ──────────────────────────────────────────────────

test('--on date is forwarded unchanged to the snapshot INSERT', async () => {
  const db = new FakeDb({ snapshotUserIds: ['u1'] });
  const r = await runCloudSnapshot(db, { observedOn: '2026-09-01' });

  assert.equal(db.capturedObservedOn, '2026-09-01',
    'the $1 param reaching INSERT INTO collection_value_point must be the caller\'s date, ' +
    'not null or today — if it is wrong the value point lands on the wrong day');
  assert.ok(!('skipped' in r));
  assert.equal(r.observedOn, '2026-09-01');
});
