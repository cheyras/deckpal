// Pure unit tests for fmtDate and fmtCalendarDate in format.ts — the
// calendar-date / timestamp split that the 30th Celebration release-date fix
// settled on.
//
// Two helpers, one mental model:
//   - fmtCalendarDate(iso): SQL DATE / catalog release-date contexts. Accepts
//     bare `YYYY-MM-DD` and exactly midnight-UTC serializations
//     (`YYYY-MM-DDT00:00:00Z`, `YYYY-MM-DDT00:00:00.000Z`), both of which name a
//     calendar day. Anything else (a real instant, garbage, null) → em dash.
//   - fmtDate(iso): genuine timestamps (price ingest, audit, credit, deck
//     history, admin events). Bare `YYYY-MM-DD` is still treated as a calendar
//     day for backward compatibility with the existing API contract; anything
//     with a time/offset is a true instant and converts to the local day — so a
//     00:00 UTC midnight timestamp lands on the prior evening in Denver.
//
// The two are deliberately split so that admin/audit/credit/list/deck history
// consumers keep real "when did this happen here" semantics, while the five
// catalog release-date consumers (SetHeader, CardDetail, SeriesIndex,
// SeriesDetail, UpcomingSetRow) pin the calendar day regardless of how the API
// serializes the underlying SQL DATE column.
//
// Mirrors the `node --import tsx --test` convention used by the other lib tests
// (see rarity.test.ts). The timezone cases run by saving and restoring
// `process.env.TZ`, which Node's Intl honours at call time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, fmtCalendarDate } from '../format.js';

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

// ── fmtDate ─────────────────────────────────────────────────────────────────

test('fmtDate: a bare calendar-only date renders as that day in every timezone', () => {
  for (const tz of TZS) {
    withTz(tz, () => {
      assert.equal(fmtDate('2026-09-16'), 'Sep 16, 2026', `2026-09-16 in ${tz}`);
      assert.equal(fmtDate('2016-11-02'), 'Nov 2, 2016', `2016-11-02 in ${tz}`);
      assert.equal(fmtDate('2024-02-29'), 'Feb 29, 2024', `leap day 2024-02-29 in ${tz}`);
    });
  }
});

test('fmtDate: the 30th Celebration release date (bare) is Sep 16 across UTC and Denver', () => {
  for (const tz of ['UTC', 'America/Denver']) {
    withTz(tz, () => {
      assert.equal(fmtDate('2026-09-16'), 'Sep 16, 2026', `release date in ${tz}`);
    });
  }
});

test('fmtDate: a midnight-UTC timestamp is a TRUE instant — Sep 15 in Denver, Sep 16 in UTC', () => {
  // This is the regression that guards the B11-style "don't redefine instants
  // as calendar days" contract. A prior worker made fmtDate reclassify ANY
  // midnightUTC timestamp as calendar, which silently shifted admin/audit/
  // credit/list/deck history users one day early in zones behind UTC. fmtDate
  // must keep genuine instant→local-day conversion.
  const midnightForms = ['2026-09-16T00:00:00Z', '2026-09-16T00:00:00.000Z'];
  withTz('America/Denver', () => {
    for (const form of midnightForms) {
      assert.equal(fmtDate(form), 'Sep 15, 2026', `${form} must be Sep 15 in Denver (true instant)`);
    }
  });
  withTz('UTC', () => {
    for (const form of midnightForms) {
      assert.equal(fmtDate(form), 'Sep 16, 2026', `${form} must be Sep 16 in UTC`);
    }
  });
  // Auckland is UTC+12 (or +13 in NZDT; Sep is still NZST = +12): midnight UTC
  // is noon the same calendar day, so still Sep 16.
  withTz('Pacific/Auckland', () => {
    for (const form of midnightForms) {
      assert.equal(fmtDate(form), 'Sep 16, 2026', `${form} must be Sep 16 in Auckland`);
    }
  });
});

test('fmtDate: a non-midnight timestamp converts to the local calendar day', () => {
  withTz('America/Denver', () => {
    assert.equal(fmtDate('2026-09-16T00:30:00Z'), 'Sep 15, 2026', '00:30 UTC → Sep 15 in Denver');
  });
  withTz('UTC', () => {
    assert.equal(fmtDate('2026-09-16T00:30:00Z'), 'Sep 16, 2026', '00:30 UTC → Sep 16 in UTC');
  });
  withTz('Asia/Tokyo', () => {
    assert.equal(fmtDate('2026-09-16T00:30:00Z'), 'Sep 16, 2026', '00:30 UTC → Sep 16 in Tokyo');
  });
});

test('fmtDate: invalid bare calendar month/day combinations fall back to the em dash', () => {
  const invalid = ['2026-13-01', '2026-00-01', '2026-01-00', '2026-02-30', '2026-02-29', '2026-04-31'];
  for (const tz of TZS) {
    withTz(tz, () => {
      for (const d of invalid) {
        assert.equal(fmtDate(d), '—', `invalid calendar date ${d} in ${tz}`);
      }
      assert.equal(fmtDate('2024-02-29'), 'Feb 29, 2024', `leap day 2024-02-29 in ${tz}`);
    });
  }
});

test('fmtDate: empty, null, undefined and invalid values fall back to the em dash', () => {
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

// ── fmtCalendarDate ─────────────────────────────────────────────────────────

test('fmtCalendarDate: bare and midnight-UTC forms render the named calendar day in every timezone', () => {
  const forms = ['2026-09-16', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00.000Z'];
  for (const tz of ['UTC', 'America/Denver', 'Pacific/Auckland']) {
    withTz(tz, () => {
      for (const form of forms) {
        assert.equal(fmtCalendarDate(form), 'Sep 16, 2026', `${form} in ${tz}`);
      }
    });
  }
});

test('fmtCalendarDate: side-by-side calendarSep16 vs true-instant Sep15 under America/Denver', () => {
  // The central regression for the 30th Celebration fix. The SAME input
  // string `2026-09-16T00:00:00Z` must render Sep 16 via fmtCalendarDate (it
  // names a SQL DATE / calendar day) but Sep 15 via fmtDate (it is a true
  // UTC-midnight instant, which is 18:00 the prior evening in Denver). The two
  // helpers must NOT agree on this input — that disagreement is the contract.
  withTz('America/Denver', () => {
    for (const form of ['2026-09-16T00:00:00Z', '2026-09-16T00:00:00.000Z']) {
      assert.equal(fmtCalendarDate(form), 'Sep 16, 2026', `calendar ${form} → Sep 16`);
      assert.equal(fmtDate(form), 'Sep 15, 2026', `instant  ${form} → Sep 15`);
    }
    // Bare form is calendar in BOTH helpers (existing API contract) — same day.
    assert.equal(fmtCalendarDate('2026-09-16'), 'Sep 16, 2026', 'bare calendar → Sep 16');
    assert.equal(fmtDate('2026-09-16'), 'Sep 16, 2026', 'bare instant-helper → Sep 16');
  });
});

test('fmtCalendarDate: calendar values across UTC and Auckland stay on the named day', () => {
  for (const tz of ['UTC', 'Pacific/Auckland']) {
    withTz(tz, () => {
      for (const form of ['2026-09-16', '2026-09-16T00:00:00Z', '2026-09-16T00:00:00.000Z']) {
        assert.equal(fmtCalendarDate(form), 'Sep 16, 2026', `${form} in ${tz}`);
      }
    });
  }
});

test('fmtCalendarDate: null, undefined, empty, garbage and non-midnight instants fall back to the em dash', () => {
  // fmtCalendarDate is narrow by design: only bare YYYY-MM-DD and the exact
  // midnight-UTC DATE serializations are calendar days. A real instant with a
  // non-midnight time (e.g. 00:30 UTC) is NOT a calendar day here — it has no
  // business being routed through the calendar helper, so it returns the em
  // dash rather than silently picking the local day.
  const prev = process.env.TZ;
  delete process.env.TZ;
  try {
    for (const v of [null, undefined, '', 'not-a-date']) {
      assert.equal(fmtCalendarDate(v), '—', `fmtCalendarDate(${JSON.stringify(v)})`);
    }
    assert.equal(fmtCalendarDate('2026-09-16T00:30:00Z'), '—', 'non-midnight instant must not be a calendar date');
    assert.equal(fmtCalendarDate('2026-09-16T12:00:00Z'), '—', 'noon instant must not be a calendar date');
    assert.equal(fmtCalendarDate('2026-09-16T00:00:00+02:00'), '—', 'offset (non-Z) instant must not be a calendar date');
  } finally {
    if (prev !== undefined) process.env.TZ = prev;
  }
});

test('fmtCalendarDate: invalid calendar month/day combinations fall back to the em dash across timezones', () => {
  // Midnight-UTC overflow forms must be rejected the same way bare forms are:
  // the local-zone constructor rolls e.g. 2026-02-30 into Mar 2, so the round-
  // trip check is what catches it. Run across timezones since the constructor
  // normalises per-zone.
  const invalid = [
    '2026-13-01', '2026-13-01T00:00:00Z',
    '2026-02-30', '2026-02-30T00:00:00Z',
    '2026-02-29', '2026-02-29T00:00:00.000Z', // non-leap year
    '2026-04-31', '2026-04-31T00:00:00Z',
  ];
  for (const tz of TZS) {
    withTz(tz, () => {
      for (const d of invalid) {
        assert.equal(fmtCalendarDate(d), '—', `invalid ${d} in ${tz}`);
      }
      // Sanity: the real leap day still renders.
      assert.equal(fmtCalendarDate('2024-02-29'), 'Feb 29, 2024', `leap day 2024-02-29 in ${tz}`);
      assert.equal(fmtCalendarDate('2024-02-29T00:00:00Z'), 'Feb 29, 2024', `leap day midnight-UTC in ${tz}`);
    });
  }
});
