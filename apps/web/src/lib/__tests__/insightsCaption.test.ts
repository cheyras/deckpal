// Pure unit test for insightsCaption.ts (issue #26 verification). No DB, no
// browser — mirrors apps/api's `node --import tsx --test` convention
// (apps/api/src/deck/__tests__/*.test.ts) rather than pulling in a new test
// framework for one pure function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeCoverageCaption, rangeWindow } from '../insightsCaption.js';

// Fixed "today" so every case is deterministic regardless of when the suite runs.
const TODAY = new Date('2026-08-11T00:00:00.000Z');

test('fewer than 2 points → null (0-point and 1-point cold starts own their own messaging)', () => {
  assert.equal(rangeCoverageCaption([], '30d', TODAY), null);
  assert.equal(rangeCoverageCaption([{ date: '2026-08-08' }], '30d', TODAY), null);
});

test('the real #26 case: 10 days of history, every range renders identically → caption on all four', () => {
  const points = [
    { date: '2026-07-30' },
    { date: '2026-07-31' },
    { date: '2026-08-01' },
    { date: '2026-08-02' },
    { date: '2026-08-03' },
    { date: '2026-08-04' },
    { date: '2026-08-05' },
    { date: '2026-08-06' },
    { date: '2026-08-07' },
    { date: '2026-08-08' },
  ];
  for (const range of ['30d', '3m', '6m', '1y'] as const) {
    assert.equal(
      rangeCoverageCaption(points, range, TODAY),
      'Showing all 10 days of recorded history (started 2026-07-30).',
      `range=${range} should caption — 10 days is short of every window`,
    );
  }
});

test('a range that IS fully populated does not get a caption', () => {
  // 40 days of history: the 30d window (today - 30 = 2026-07-12) is fully covered.
  const points = Array.from({ length: 40 }, (_, i) => {
    const d = new Date(TODAY.getTime());
    d.setUTCDate(d.getUTCDate() - (39 - i));
    return { date: d.toISOString().slice(0, 10) };
  });
  assert.equal(rangeCoverageCaption(points, '30d', TODAY), null);
  // ...but the 3m window (today - 3mo = 2026-05-11) is NOT covered by 40 days.
  const caption = rangeCoverageCaption(points, '3m', TODAY);
  assert.ok(caption?.startsWith('Showing all 40 days of recorded history'), caption ?? 'expected a caption');
});

test('boundary: earliest point exactly at the window start → no caption (genuinely full)', () => {
  const points = [{ date: '2026-07-12' }, { date: '2026-08-08' }]; // 2026-07-12 == today(8/11) - 30d
  assert.equal(rangeCoverageCaption(points, '30d', TODAY), null);
});

test('boundary: earliest point one day after the window start → caption fires', () => {
  const points = [{ date: '2026-07-13' }, { date: '2026-08-08' }]; // one day short of 30d back
  assert.equal(
    rangeCoverageCaption(points, '30d', TODAY),
    'Showing all 2 days of recorded history (started 2026-07-13).',
  );
});

test('month/year ranges use calendar semantics (3m from 2026-08-11 → 2026-05-11)', () => {
  assert.equal(rangeCoverageCaption([{ date: '2026-05-11' }, { date: '2026-08-08' }], '3m', TODAY), null);
  assert.equal(
    rangeCoverageCaption([{ date: '2026-05-12' }, { date: '2026-08-08' }], '3m', TODAY),
    'Showing all 2 days of recorded history (started 2026-05-12).',
  );
  assert.equal(rangeCoverageCaption([{ date: '2025-08-11' }, { date: '2026-08-08' }], '1y', TODAY), null);
});

/**
 * The chart's x-axis DOMAIN.
 *
 * The axis used to fit the data, so with ten days recorded every range chip drew
 * the same picture — a full-width line under a label saying "2 Years". The
 * window is now handed to the chart, so a short history reads as a short line in
 * a long axis. These pin the window arithmetic the axis depends on.
 */
test('a range window ends today and starts a real interval back', () => {
  const now = new Date('2026-08-29T12:00:00Z')
  assert.deepEqual(rangeWindow('30d', now), { from: '2026-07-30', to: '2026-08-29' })
  assert.deepEqual(rangeWindow('3m', now), { from: '2026-05-29', to: '2026-08-29' })
  assert.deepEqual(rangeWindow('1y', now), { from: '2025-08-29', to: '2026-08-29' })
  // 2025-03-01, not 02-28: Aug 29 minus 18 months lands on Feb 29 2025, which
  // does not exist, and JS rolls it forward. `rangeWindowStart` documents this
  // month-length slop as immaterial, and it is — but pin the real answer so the
  // next reader does not 'fix' the code to match a wrong expectation.
  assert.deepEqual(rangeWindow('18m', now), { from: '2025-03-01', to: '2026-08-29' })
  assert.deepEqual(rangeWindow('2y', now), { from: '2024-08-29', to: '2026-08-29' })
})

test('every range gives a DIFFERENT window — the bug this fixes', () => {
  // The whole complaint was that the chips looked identical. They can only
  // differ visually if their windows differ.
  const now = new Date('2026-08-29T12:00:00Z')
  const keys = ['30d', '3m', '6m', '1y', '18m', '2y'] as const
  const froms = keys.map((k) => rangeWindow(k, now).from)
  assert.equal(new Set(froms).size, keys.length, `windows collided: ${froms.join(', ')}`)
  // And they must be strictly ordered oldest-first as the label implies.
  const sorted = [...froms].sort().reverse()
  assert.deepEqual(froms, sorted, 'a longer range must start earlier')
})

test('the window is wider than a short history, so the line cannot fill it', () => {
  // 20 days of readings inside a 2-year window: the axis spans ~730 days, so the
  // data occupies a few percent of it. That ratio IS the message.
  const now = new Date('2026-08-29T12:00:00Z')
  const { from, to } = rangeWindow('2y', now)
  const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000
  assert.ok(days(from, to) > 700, 'a 2y window should span two years of axis')
  assert.ok(20 / days(from, to) < 0.05, 'and 20 days of data should be a small slice of it')
})
