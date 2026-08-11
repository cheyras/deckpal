// Pure unit test for insightsCaption.ts (issue #26 verification). No DB, no
// browser — mirrors apps/api's `node --import tsx --test` convention
// (apps/api/src/deck/__tests__/*.test.ts) rather than pulling in a new test
// framework for one pure function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeCoverageCaption } from '../insightsCaption.js';

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
