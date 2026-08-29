import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDays } from '../backfill.js';
import { archiveCapturedAt, archiveUrl } from '../archive.js';

/**
 * The chunked-replay resume protocol.
 *
 * A two-year backfill is ~16 sequential workflow runs, and the failure mode is
 * not a crash — it is a run that reports success while the range never
 * advances, because the slice always starts at day 0 and re-does work that is
 * already committed. Sixteen green runs and no progress. These are cheap tests
 * for the one function that decides it.
 */

const days = (...d: string[]) => d;

test('a fresh range does every day, in order', () => {
  const { slice, remaining } = selectDays(days('2024-08-29', '2024-08-30', '2024-08-31'), new Set());
  assert.deepEqual(slice, ['2024-08-29', '2024-08-30', '2024-08-31']);
  assert.equal(remaining, 0);
});

test('days already ingested are skipped, not re-downloaded', () => {
  const { slice, remaining } = selectDays(
    days('2024-08-29', '2024-08-30', '2024-08-31'),
    new Set(['2024-08-29', '2024-08-30']),
  );
  assert.deepEqual(slice, ['2024-08-31']);
  assert.equal(remaining, 0);
});

test('limit caps the run and reports what is left', () => {
  const { slice, remaining } = selectDays(
    days('2024-08-29', '2024-08-30', '2024-08-31', '2024-09-01'),
    new Set(),
    2,
  );
  assert.deepEqual(slice, ['2024-08-29', '2024-08-30']);
  assert.equal(remaining, 2);
});

test('the run ADVANCES: a second pass starts where the first stopped', () => {
  // The actual regression this file exists for. Run 2 must not re-do run 1's
  // days, and `remaining` must fall — otherwise the self-chaining workflow
  // loops forever on the same 45 days.
  const all = days('2024-08-29', '2024-08-30', '2024-08-31', '2024-09-01', '2024-09-02');
  const first = selectDays(all, new Set(), 2);
  const ingested = new Set(first.slice);
  const second = selectDays(all, ingested, 2);

  assert.deepEqual(second.slice, ['2024-08-31', '2024-09-01']);
  assert.ok(second.remaining < first.remaining, 'remaining must fall between runs');
  const third = selectDays(all, new Set([...ingested, ...second.slice]), 2);
  assert.deepEqual(third.slice, ['2024-09-02']);
  assert.equal(third.remaining, 0, 'a complete range reports 0 and stops the chain');
});

test('a fully ingested range is a no-op that reports done', () => {
  const all = days('2024-08-29', '2024-08-30');
  const { slice, remaining } = selectDays(all, new Set(all), 45);
  assert.deepEqual(slice, []);
  assert.equal(remaining, 0);
});

test('limit 0 or undefined means no cap', () => {
  const all = days('2024-08-29', '2024-08-30', '2024-08-31');
  assert.equal(selectDays(all, new Set(), 0).slice.length, 3);
  assert.equal(selectDays(all, new Set()).slice.length, 3);
});

test('archive URLs and stamps use the archive date, not now()', () => {
  assert.equal(
    archiveUrl('2026-08-15'),
    'https://tcgcsv.com/archive/tcgplayer/prices-2026-08-15.ppmd.7z',
  );
  // captured_at must be the day the prices were published. Stamping a backfill
  // with now() would file two years of history under today and flatten the
  // chart into a single point.
  assert.equal(archiveCapturedAt('2026-08-15').toISOString(), '2026-08-15T00:00:00.000Z');
});
