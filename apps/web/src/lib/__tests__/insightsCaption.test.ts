// Pure unit test for insightsCaption.ts (issue #26 verification, plus QUAL-07 and
// the UXC-07 label fix). No DB, no browser — mirrors apps/api's
// `node --import tsx --test` convention (apps/api/src/deck/__tests__/*.test.ts)
// rather than pulling in a new test framework for a few pure functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rangeCoverageCaption, rangeWindow, rangeLabel, VALUE_RANGES } from '../insightsCaption.js';

/**
 * Run `fn` with `process.env.TZ` set, restoring the prior value after.
 * Mirrors the helper in format-date.test.ts — same convention, this file's
 * own copy per that file's precedent for pure lib tests.
 */
function withTz<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

// Fixed "today" so every case is deterministic regardless of when the suite
// runs. QUAL-07 made the window boundary depend on the VIEWER's local day, so
// every test below that touches it now pins TZ explicitly with `withTz`
// rather than trusting the runner's ambient zone (which — see this repo's own
// dev machine — is not UTC).
const TODAY = new Date('2026-08-11T00:00:00.000Z');

test('fewer than 2 points → null (0-point and 1-point cold starts own their own messaging)', () => {
  withTz('UTC', () => {
    assert.equal(rangeCoverageCaption([], '30d', TODAY), null);
    assert.equal(rangeCoverageCaption([{ date: '2026-08-08' }], '30d', TODAY), null);
  });
});

test('the real #26 case: 10 days of history, every range renders identically → caption on all four', () => {
  withTz('UTC', () => {
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
});

test('a range that IS fully populated does not get a caption', () => {
  withTz('UTC', () => {
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
});

test('boundary: earliest point exactly at the window start → no caption (genuinely full)', () => {
  withTz('UTC', () => {
    const points = [{ date: '2026-07-12' }, { date: '2026-08-08' }]; // 2026-07-12 == today(8/11) - 30d
    assert.equal(rangeCoverageCaption(points, '30d', TODAY), null);
  });
});

test('boundary: earliest point one day after the window start → caption fires', () => {
  withTz('UTC', () => {
    const points = [{ date: '2026-07-13' }, { date: '2026-08-08' }]; // one day short of 30d back
    assert.equal(
      rangeCoverageCaption(points, '30d', TODAY),
      'Showing all 2 days of recorded history (started 2026-07-13).',
    );
  });
});

test('month/year ranges use calendar semantics (3m from 2026-08-11 → 2026-05-11)', () => {
  withTz('UTC', () => {
    assert.equal(rangeCoverageCaption([{ date: '2026-05-11' }, { date: '2026-08-08' }], '3m', TODAY), null);
    assert.equal(
      rangeCoverageCaption([{ date: '2026-05-12' }, { date: '2026-08-08' }], '3m', TODAY),
      'Showing all 2 days of recorded history (started 2026-05-12).',
    );
    assert.equal(rangeCoverageCaption([{ date: '2025-08-11' }, { date: '2026-08-08' }], '1y', TODAY), null);
  });
});

/**
 * The chart's x-axis DOMAIN.
 *
 * The axis used to fit the data, so with ten days recorded every range chip drew
 * the same picture — a full-width line under a label saying "2 Years". The
 * window is now handed to the chart, so a short history reads as a short line in
 * a long axis. These pin the window arithmetic the axis depends on, for a
 * viewer in UTC (so local day == UTC day and the pre-QUAL-07 numbers still hold).
 */
test('a range window ends today and starts a real interval back', () => {
  withTz('UTC', () => {
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
})

test('every range gives a DIFFERENT window — the bug this fixes', () => {
  withTz('UTC', () => {
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
})

test('the window is wider than a short history, so the line cannot fill it', () => {
  withTz('UTC', () => {
    // 20 days of readings inside a 2-year window: the axis spans ~730 days, so the
    // data occupies a few percent of it. That ratio IS the message.
    const now = new Date('2026-08-29T12:00:00Z')
    const { from, to } = rangeWindow('2y', now)
    const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000
    assert.ok(days(from, to) > 700, 'a 2y window should span two years of axis')
    assert.ok(20 / days(from, to) < 0.05, 'and 20 days of data should be a small slice of it')
  })
})

// ── QUAL-07: the window boundary is the VIEWER's local day, not UTC's ──────────

test('QUAL-07: a US evening viewer sees today on the axis, not tomorrow', () => {
  withTz('America/Denver', () => {
    // 9pm Sep 25 in Pacific time = already Sep 26 in UTC. The pre-fix isoDate()
    // read the UTC day, so `to` came out as tomorrow from the viewer's chair.
    const now = new Date('2026-09-25T21:00:00-07:00')
    assert.equal(rangeWindow('30d', now).to, '2026-09-25', 'axis should end on the viewer\'s today, not UTC\'s')
    assert.notEqual(rangeWindow('30d', now).to, '2026-09-26', 'must not show tomorrow\'s date')
  })
})

test('QUAL-07: the same instant reads as a different local day in different zones', () => {
  // 2026-09-25T21:00:00-07:00 is 2026-09-26T04:00:00Z — already tomorrow in UTC
  // and in any zone at or east of UTC, but still "today" (Sep 25) west of it.
  const instant = new Date('2026-09-25T21:00:00-07:00')
  assert.equal(withTz('UTC', () => rangeWindow('30d', instant).to), '2026-09-26')
  assert.equal(withTz('America/Denver', () => rangeWindow('30d', instant).to), '2026-09-25')
  assert.equal(withTz('America/Los_Angeles', () => rangeWindow('30d', instant).to), '2026-09-25')
})

test('QUAL-07: the window SPAN stays correct in a local zone (30 real days, not 29 or 31)', () => {
  withTz('America/Denver', () => {
    const now = new Date('2026-09-25T21:00:00-07:00')
    const { from, to } = rangeWindow('30d', now)
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    assert.equal(days, 30)
  })
})

// ── UXC-07: the delta card's label names the SELECTED range, not always 30 days ──

test('rangeLabel names every range Insights offers — the UXC-07 mislabel', () => {
  assert.equal(rangeLabel('30d'), '30 Days')
  assert.equal(rangeLabel('3m'), '3 Months')
  assert.equal(rangeLabel('6m'), '6 Months')
  assert.equal(rangeLabel('1y'), '1 Year')
  assert.equal(rangeLabel('18m'), '18 Months')
  assert.equal(rangeLabel('2y'), '2 Years')
})

test('rangeLabel and the range chips (VALUE_RANGES) cannot drift apart — same list', () => {
  assert.ok(VALUE_RANGES.length >= 6)
  for (const r of VALUE_RANGES) assert.equal(rangeLabel(r.key), r.label)
})
