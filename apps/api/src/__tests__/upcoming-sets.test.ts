import test from 'node:test';
import assert from 'node:assert/strict';
import { UPCOMING_SETS, upcomingSetsFor, type UpcomingSet } from '../upcomingSets.js';

// The table is expected to be empty most of the time — an entry only exists in
// the window between an announcement and the catalog refresh that lands it. So
// the behavioural tests use fixtures, and only the shape tests look at the real
// table. A green suite with an empty table still means something.

const FIXTURE: UpcomingSet = {
  placeholderId: 'upcoming-test-set',
  seriesSlug: 'mega-evolution',
  name: '30th Celebration',
  releasedOn: '2026-09-16',
  printedCount: 128,
  logoAssetPath: '/brand/test.webp',
  expiresOn: '2026-10-31',
};

/** The real predicate, against a one-entry table. */
const only = (slug: string, existing: string[], today: string) =>
  upcomingSetsFor(slug, existing, today, [FIXTURE]);

test('a real entry is served before its expiry, in its own series only', () => {
  const served = upcomingSetsFor('mega-evolution', [], '2026-09-11');
  for (const u of served) {
    assert.equal(u.seriesSlug, 'mega-evolution');
    assert.ok('2026-09-11' <= u.expiresOn);
  }
  // Nothing leaks into a series that did not declare it.
  assert.deepEqual(upcomingSetsFor('scarlet-violet', [], '2026-09-11'), []);
});

test('expiry suppresses an entry even when the catalog never matched the name', () => {
  assert.equal(only('mega-evolution', [], '2026-10-31').length, 1, 'the day of expiry still serves');
  assert.equal(only('mega-evolution', [], '2026-11-01').length, 0, 'the day after does not');
  // Same assertion against the live table: nothing may outlive its own expiresOn.
  for (const u of UPCOMING_SETS) {
    assert.equal(upcomingSetsFor(u.seriesSlug, [], u.expiresOn).some((x) => x.placeholderId === u.placeholderId), true);
    const dayAfter = new Date(Date.parse(`${u.expiresOn}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    assert.equal(upcomingSetsFor(u.seriesSlug, [], dayAfter).some((x) => x.placeholderId === u.placeholderId), false);
  }
});

test('a matching catalog set suppresses the placeholder, punctuation and case aside', () => {
  assert.equal(only('mega-evolution', ['Pitch Black'], '2026-09-11').length, 1);
  assert.equal(only('mega-evolution', ['30th Celebration'], '2026-09-11').length, 0);
  assert.equal(only('mega-evolution', ['30TH  celebration'], '2026-09-11').length, 0);
  assert.equal(only('mega-evolution', ['30th-Celebration'], '2026-09-11').length, 0);
});

test('the real table is well formed', () => {
  const ids = new Set<string>();
  for (const u of UPCOMING_SETS) {
    assert.match(u.releasedOn, /^\d{4}-\d{2}-\d{2}$/, `${u.placeholderId} releasedOn`);
    assert.match(u.expiresOn, /^\d{4}-\d{2}-\d{2}$/, `${u.placeholderId} expiresOn`);
    assert.ok(u.expiresOn > u.releasedOn, `${u.placeholderId} must expire after it releases`);
    // A placeholder id that looked like a TCGdex id could be mistaken for one
    // and written to the database — the failure upcomingSets.ts exists to avoid.
    assert.ok(u.placeholderId.startsWith('upcoming-'), `${u.placeholderId} must be namespaced`);
    assert.equal(ids.has(u.placeholderId), false, `${u.placeholderId} is duplicated`);
    ids.add(u.placeholderId);
    // The asset is served by apps/web out of public/, so the path must be
    // root-relative; a bare filename would resolve against the current route.
    assert.ok(u.logoAssetPath.startsWith('/'), `${u.placeholderId} logoAssetPath must be absolute`);
  }
});
