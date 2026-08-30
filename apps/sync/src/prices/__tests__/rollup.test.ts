import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_KEEP_DAYS, WEEKLY_KEEP_DAYS,
  addDays, daysBetween, isoWeekStart, monthStartOf, nextMonthStart, monthEnd,
  weekStartsIn, quarterPartition, selectEligibleMonths, weekGrainApplies,
  selectDroppableRetired, verificationFailures,
} from '../rollup.js';
import { GRAIN_STALENESS, grainForDay } from '../../jobs/valueSnapshot.js';

/**
 * The rollup's ATTRIBUTION and ELIGIBILITY protocol, without a database.
 *
 * The same reasoning as `backfill.test.ts`: the SQL can be verified against a
 * real Postgres by hand, but the arithmetic deciding WHICH month is rolled up,
 * WHICH weeks that month owns, and WHEN a retired partition may be dropped is
 * the part whose failure mode is silent. A month attributed to the wrong week,
 * or a partition dropped one cycle early, both look exactly like success.
 */

// ── ISO week attribution ───────────────────────────────────────────────────

test('isoWeekStart truncates to Monday, and is a no-op on a Monday', () => {
  assert.equal(isoWeekStart('2026-08-31'), '2026-08-31'); // Monday
  assert.equal(isoWeekStart('2026-09-01'), '2026-08-31'); // Tuesday
  assert.equal(isoWeekStart('2026-09-06'), '2026-08-31'); // Sunday — still that week
  assert.equal(isoWeekStart('2026-09-07'), '2026-09-07'); // next Monday
});

test('a Sunday belongs to the week that STARTED six days earlier, not the next one', () => {
  // The off-by-one that would silently move every Sunday into the following
  // bucket, and with it a seventh of every close.
  assert.equal(isoWeekStart('2026-01-04'), '2025-12-29');
  assert.equal(isoWeekStart('2026-01-05'), '2026-01-05');
});

test('a month owns every week STARTING in it — and only those', () => {
  const w = weekStartsIn('2026-08-01');
  assert.deepEqual(w, ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']);
  // 2026-07-27 starts in July and reaches into August: July's, not August's.
  assert.ok(!w.includes('2026-07-27'));
  assert.deepEqual(weekStartsIn('2026-07-01').at(-1), '2026-07-27');
});

test('every ISO week is owned by EXACTLY ONE month across a two-year span', () => {
  // The straddle invariant, stated as a partition: no week bucketed twice, no
  // week left unbucketed. Double-bucketing is invisible (the second write is an
  // upsert of the same values); a missed week is a hole nothing recomputes.
  const seen = new Map<string, string>();
  for (let m = '2024-09-01'; m < '2026-09-01'; m = nextMonthStart(m)) {
    for (const w of weekStartsIn(m)) {
      assert.equal(seen.get(w), undefined, `week ${w} owned by both ${seen.get(w)} and ${m}`);
      seen.set(w, m);
    }
  }
  // …and the coverage is contiguous: consecutive owned weeks are 7 days apart.
  const weeks = [...seen.keys()].sort();
  for (let i = 1; i < weeks.length; i++) {
    assert.equal(daysBetween(weeks[i - 1]!, weeks[i]!), 7, `gap before ${weeks[i]}`);
  }
});

test('the last week of a month straddles into the next one, and that is the point', () => {
  const last = weekStartsIn('2026-08-01').at(-1)!;
  assert.equal(last, '2026-08-31');
  assert.equal(addDays(last, 6), '2026-09-06'); // six days into September
  // Which is why rollup(August) must read the PARENT table, not partition 08.
  assert.ok(addDays(last, 6) > monthEnd('2026-08-01'));
});

// ── Month arithmetic ───────────────────────────────────────────────────────

test('month boundaries survive December and February', () => {
  assert.equal(nextMonthStart('2026-12-01'), '2027-01-01');
  assert.equal(monthEnd('2026-12-01'), '2026-12-31');
  assert.equal(monthEnd('2024-02-01'), '2024-02-29'); // leap
  assert.equal(monthEnd('2026-02-01'), '2026-02-28');
  assert.equal(monthStartOf('2026-08-29'), '2026-08-01');
});

test('quarter partitions are named and bounded by the week START', () => {
  assert.deepEqual(quarterPartition('2026-08-31'),
    { name: 'price_bucket_week_2026q3', from: '2026-07-01', to: '2026-10-01' });
  // A week that STARTS in September and ends in October is still q3: the
  // partition key is bucket_start, so routing follows the start or the insert
  // lands in a quarter that will be dropped on a different schedule.
  assert.equal(quarterPartition('2026-09-28').name, 'price_bucket_week_2026q3');
  assert.deepEqual(quarterPartition('2026-11-02'),
    { name: 'price_bucket_week_2026q4', from: '2026-10-01', to: '2027-01-01' });
  assert.equal(quarterPartition('2026-01-05').name, 'price_bucket_week_2026q1');
});

// ── Eligibility ────────────────────────────────────────────────────────────

const MONTHS_2026 = [
  '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01',
  '2026-06-01', '2026-07-01', '2026-08-01',
];

test('a month is eligible only once its LAST day is past the daily window', () => {
  const got = selectEligibleMonths(MONTHS_2026, '2026-08-29');
  // cutoff = 2026-07-30. July ends 07-31, which is NOT past it.
  assert.deepEqual(got, ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01',
                         '2026-05-01', '2026-06-01']);
  assert.ok(!got.includes('2026-07-01'), 'July still holds days inside the 30-day window');
  assert.ok(!got.includes('2026-08-01'), 'the current month is never eligible');
});

test('eligibility is oldest-first — the straddle invariant depends on the order', () => {
  const got = selectEligibleMonths([...MONTHS_2026].reverse(), '2026-08-29');
  assert.deepEqual(got, [...got].sort());
  assert.equal(got[0], '2026-01-01');
});

test('July becomes eligible the day its last day leaves the window', () => {
  assert.ok(!selectEligibleMonths(['2026-07-01'], '2026-08-30').length);
  assert.deepEqual(selectEligibleMonths(['2026-07-01'], '2026-08-31'), ['2026-07-01']);
  assert.equal(DAILY_KEEP_DAYS, 30);
});

// ── The weekly band ────────────────────────────────────────────────────────

test('week grain is skipped for months whose QUARTER has left the weekly band', () => {
  const today = '2026-08-29'; // weekly cutoff = 2026-02-27
  assert.equal(weekGrainApplies('2026-06-01', today), true);  // q2 ends 06-30
  assert.equal(weekGrainApplies('2026-01-01', today), true);  // q1 ends 03-31
  assert.equal(weekGrainApplies('2025-12-01', today), false); // q4 ends 12-31
  assert.equal(weekGrainApplies('2024-09-01', today), false);
  assert.equal(WEEKLY_KEEP_DAYS, 183);
});

test('the catch-up writes month grain ONLY for the deep past', () => {
  // The refinement that stops a two-year catch-up writing ~6M week rows it
  // would drop in the same run.
  const today = '2026-08-29';
  const deep = ['2024-09-01', '2024-12-01', '2025-06-01'];
  assert.ok(deep.every((m) => !weekGrainApplies(m, today)));
});

// ── The one-cycle-later DROP ───────────────────────────────────────────────

const retired = (m: string) => ({ table: `price_observation_${m.slice(0, 4)}_${m.slice(5, 7)}_retired`, month: m });

test('nothing retired by THIS run is droppable by it', () => {
  const all = [retired('2026-01-01'), retired('2026-02-01')];
  const thisRun = new Set([all[1]!.table]);
  const due = selectDroppableRetired(all, '2026-08-29', thisRun);
  assert.deepEqual(due.map((d) => d.month), ['2026-01-01']);
});

test('a partition retired this cycle is still droppable NEXT cycle', () => {
  const all = [retired('2026-02-01')];
  assert.equal(selectDroppableRetired(all, '2026-08-29', new Set([all[0]!.table])).length, 0);
  assert.equal(selectDroppableRetired(all, '2026-08-29', new Set()).length, 1);
});

test('the age rule keeps a month around for a grace period after retirement', () => {
  // Steady state: rollup(June) runs at the start of August. June must not be
  // droppable then, and must be by September.
  const june = [retired('2026-06-01')];
  assert.equal(selectDroppableRetired(june, '2026-08-02', new Set()).length, 0,
    'June was dropped in the same cycle it was retired');
  assert.equal(selectDroppableRetired(june, '2026-09-02', new Set()).length, 1,
    'June was never dropped');
});

test('droppable partitions come out oldest-first', () => {
  const all = [retired('2026-03-01'), retired('2026-01-01'), retired('2026-02-01')];
  assert.deepEqual(
    selectDroppableRetired(all, '2026-12-01', new Set()).map((d) => d.month),
    ['2026-01-01', '2026-02-01', '2026-03-01'],
  );
});

// ── The verification verdict ───────────────────────────────────────────────

const clean = { storedNotRecomputed: 0, recomputedNotStored: 0, bucketedDays: 40, observedDays: 40, shrunk: 0 };

test('a clean verification has no failures', () => {
  assert.deepEqual(verificationFailures(clean), []);
});

test('every check can fail on its own, and says which', () => {
  assert.match(verificationFailures({ ...clean, storedNotRecomputed: 3 })[0]!, /does not reproduce/);
  assert.match(verificationFailures({ ...clean, recomputedNotStored: 3 })[0]!, /missing or different/);
  assert.match(verificationFailures({ ...clean, observedDays: 41 })[0]!, /conservation/);
  assert.match(verificationFailures({ ...clean, shrunk: 1 })[0]!, /SHRANK/);
});

test('conservation catches a series that got NO bucket at all', () => {
  // The EXCEPT checks compare bucket to bucket; a whole series the source has
  // and the rollup silently skipped produces no row on either side of them.
  // Only the day count notices.
  const missed = { ...clean, observedDays: 40 + 31 };
  const fails = verificationFailures(missed);
  assert.equal(fails.length, 1);
  assert.match(fails[0]!, /buckets account for 40 observed day\(s\) but the partition holds 71/);
});

test('a run with several problems reports all of them, not the first', () => {
  const fails = verificationFailures({ storedNotRecomputed: 1, recomputedNotStored: 2, bucketedDays: 1, observedDays: 2, shrunk: 3 });
  assert.equal(fails.length, 4);
});

// ── The grain-aware staleness gate (jobs/valueSnapshot) ────────────────────

const BANDS = { dayFloor: '2026-07-01', weekFloor: '2026-01-05' };

test('the tier covering a day decides how stale its price may be', () => {
  assert.equal(grainForDay('2026-08-15', BANDS), 'day');
  assert.equal(grainForDay('2026-07-01', BANDS), 'day');   // the floor itself is daily
  assert.equal(grainForDay('2026-06-30', BANDS), 'week');
  assert.equal(grainForDay('2026-01-05', BANDS), 'week');
  assert.equal(grainForDay('2026-01-04', BANDS), 'month');
  assert.equal(grainForDay('2024-11-11', BANDS), 'month');
});

test('with nothing rolled up every day is still daily', () => {
  assert.equal(grainForDay('2024-01-01', { dayFloor: null, weekFloor: null }), 'day');
});

test('with no weekly tier the monthly one runs up to the daily floor', () => {
  const b = { dayFloor: '2026-07-01', weekFloor: null };
  assert.equal(grainForDay('2026-06-30', b), 'month');
  assert.equal(grainForDay('2026-07-02', b), 'day');
});

test('the staleness window is the grain length plus the two days daily already allowed', () => {
  assert.deepEqual(GRAIN_STALENESS, { day: 2, week: 9, month: 33 });
  // The regression this exists to prevent: at a flat 2 days, EVERY day past the
  // daily window is skipped with "no price observation", and the backfill
  // becomes useless for exactly the range it repairs.
  assert.ok(GRAIN_STALENESS.week > 7, 'a weekly close can be up to 7 days old before it is late');
  assert.ok(GRAIN_STALENESS.month > 31, 'a monthly close can be up to 31 days old before it is late');
});

// ── Date algebra ───────────────────────────────────────────────────────────

test('addDays and daysBetween round-trip across a DST boundary in UTC', () => {
  // Anything using local time here would silently shift a bucket edge twice a
  // year, which is a bug that only reproduces in March and October.
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
});
