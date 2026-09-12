// Pure unit test for fmtDate in format.ts — the calendar-date / timestamp split.
//
// A bare `YYYY-MM-DD` is a calendar day, not an instant: it must render as that
// day in every timezone. A string with a time or offset is an instant and keeps
// the existing local-day conversion. Empty / null / invalid inputs fall back
// to the em dash.
//
// Mirrors the `node --import tsx --test` convention used by the other lib tests
// (see rarity.test.ts). The timezone cases run by saving and restoring
// `process.env.TZ`, which Node's Intl honours at call time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate } from '../format.js';

const TZS = ['UTC', 'America/Denver', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland'];

/** Run `fn` with `process.env.TZ` set, restoring the prior value after. */
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

test('a calendar-only date renders as that day in every timezone', () => {
  for (const tz of TZS) {
    withTz(tz, () => {
      assert.equal(fmtDate('2026-09-16'), 'Sep 16, 2026', `2026-09-16 in ${tz}`);
      assert.equal(fmtDate('2016-11-02'), 'Nov 2, 2016', `2016-11-02 in ${tz}`);
      assert.equal(fmtDate('2024-02-29'), 'Feb 29, 2024', `leap day 2024-02-29 in ${tz}`);
    });
  }
});

test('the upcoming 30th Celebration release date is Sep 16 across UTC and Denver', () => {
  // The confirmed defect: both desktop and mobile showed Sep 15 in zones behind
  // UTC because the UTC-midnight parse shifted a day. The fix pins the calendar
  // day for the placeholder and for real catalog DATE-column values alike.
  for (const tz of ['UTC', 'America/Denver']) {
    withTz(tz, () => {
      assert.equal(fmtDate('2026-09-16'), 'Sep 16, 2026', `release date in ${tz}`);
    });
  }
});

test('a timestamp with an offset converts to the local calendar day', () => {
  // 00:30 UTC on Sep 16 is the evening of Sep 15 in America/Denver (MDT, UTC-6).
  // That is the correct "when did this happen here" reading for an instant.
  withTz('America/Denver', () => {
    assert.equal(fmtDate('2026-09-16T00:30:00Z'), 'Sep 15, 2026', '00:30 UTC → Sep 15 in Denver');
  });
  withTz('UTC', () => {
    assert.equal(fmtDate('2026-09-16T00:30:00Z'), 'Sep 16, 2026', '00:30 UTC → Sep 16 in UTC');
  });
  withTz('Asia/Tokyo', () => {
    // 00:30 UTC is 09:30 JST on the same calendar day.
    assert.equal(fmtDate('2026-09-16T00:30:00Z'), 'Sep 16, 2026', '00:30 UTC → Sep 16 in Tokyo');
  });
});

test('invalid calendar month/day combinations fall back to the em dash', () => {
  // `new Date(y, m-1, d)` silently rolls impossible calendar dates into a
  // valid neighbour (e.g. 2026-13-01 → Jan 2027, 2026-02-30 → Mar 2). The fix
  // rejects these via a round-trip check, while a genuine leap day like
  // 2024-02-29 must keep rendering. Run across timezones since the local-zone
  // constructor is what normalises the overflow.
  const invalid = ['2026-13-01', '2026-00-01', '2026-01-00', '2026-02-30', '2026-02-29', '2026-04-31'];
  for (const tz of TZS) {
    withTz(tz, () => {
      for (const d of invalid) {
        assert.equal(fmtDate(d), '—', `invalid calendar date ${d} in ${tz}`);
      }
      // Sanity: the real leap day still renders and was not over-rejected.
      assert.equal(fmtDate('2024-02-29'), 'Feb 29, 2024', `leap day 2024-02-29 in ${tz}`);
    });
  }
});

test('empty, null, undefined and invalid values fall back to the em dash', () => {
  const prev = process.env.TZ;
  delete process.env.TZ;
  try {
    for (const v of [null, undefined, '', 'not-a-date']) {
      assert.equal(fmtDate(v), '—', `fmtDate(${JSON.stringify(v)})`);
    }
  } finally {
    if (prev !== undefined) process.env.TZ = prev;
  }
});
