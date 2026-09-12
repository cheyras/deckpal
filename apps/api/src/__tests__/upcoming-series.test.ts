import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPCOMING_SETS,
  upcomingSetsFor,
  mapUpcomingPlaceholder,
  compareSetOrder,
  type UpcomingSet,
} from '../upcomingSets.js';

/**
 * API ASSEMBLY CONTRACT — the series route (apps/api/src/routes/series.ts)
 * builds a combined set list: DB-sourced catalog sets, then placeholders from
 * upcomingSetsFor() mapped through mapUpcomingPlaceholder(), all sorted by
 * compareSetOrder() (released_on DESC NULLS LAST, name).
 *
 * These tests exercise the PRODUCTION helpers the route calls — not a local
 * copy of the mapping or comparator — so a route that changes one without the
 * other fails here instead of a green suite that only proved the test's copy
 * agreed with itself. The shape and integration behaviour the disconnected
 * upcomingSetsFor unit tests cannot reach: that mapUpcomingPlaceholder produces
 * `upcoming:true` / `logoAssetPath` / no `progress`, that the real-set count
 * (the SeriesDetail heading) excludes the placeholder, and that compareSetOrder
 * keeps everything in calendar order.
 */

const FIXTURE: UpcomingSet = {
  placeholderId: 'upcoming-test-set',
  seriesSlug: 'mega-evolution',
  name: '30th Celebration',
  releasedOn: '2026-09-16',
  printedCount: 128,
  logoAssetPath: '/brand/test.webp',
  expiresOn: '2026-10-31',
};

/** A catalog-set summary the same shape the series route emits. */
const catalogSet = (over: Partial<{ setId: string; name: string; releasedOn: string | null }> = {}) => ({
  setId: 'me01',
  slug: 'mega-evolution-1',
  name: 'XY',
  releasedOn: '2014-08-01' as string | null,
  isPromo: false,
  printedCount: 108,
  secretCount: 5,
  cardCountTotal: 113,
  logoUrl: 'https://assets.tcgdex.net/en/xy/xy12/logo.webp',
  symbolUrl: null,
  // Catalog sets never carry `upcoming`; the placeholder does. Typed as
  // `true | undefined` so the combined array's `.upcoming` guard type-checks.
  upcoming: undefined as true | undefined,
  ...over,
});

test('mapUpcomingPlaceholder produces the API shape with upcoming:true and logoAssetPath', () => {
  const [entry] = upcomingSetsFor('mega-evolution', [], '2026-09-12', [FIXTURE]);
  assert.ok(entry);
  const mapped = mapUpcomingPlaceholder(entry);

  assert.equal(mapped.upcoming, true);
  assert.equal(mapped.setId, 'upcoming-test-set');
  assert.equal(mapped.slug, 'upcoming-test-set');
  assert.equal(mapped.logoUrl, null);
  assert.equal(mapped.symbolUrl, null);
  assert.equal(mapped.logoAssetPath, '/brand/test.webp');
  assert.equal(mapped.isPromo, false);
  assert.equal(mapped.secretCount, 0);
  assert.equal(mapped.cardCountTotal, 128);
  assert.equal(mapped.printedCount, 128);
});

test('mapUpcomingPlaceholder emits no progress key', () => {
  const [entry] = upcomingSetsFor('mega-evolution', [], '2026-09-12', [FIXTURE]);
  assert.ok(entry);
  const mapped = mapUpcomingPlaceholder(entry);
  // progress is deliberately absent: a 0/0 bar would read as "you own none of
  // it" rather than "it does not exist yet" (see series.ts comment).
  assert.equal('progress' in mapped, false, 'placeholder must not carry a progress key');
});

test('mapUpcomingPlaceholder namespaces setId as an upcoming- id, not a catalog id', () => {
  const [entry] = upcomingSetsFor('mega-evolution', [], '2026-09-12', [FIXTURE]);
  assert.ok(entry);
  const mapped = mapUpcomingPlaceholder(entry);
  assert.ok(mapped.setId.startsWith('upcoming-'), 'setId must start with upcoming-');
  // slug === setId so a Link to setId would construct the same URL either way
  assert.equal(mapped.slug, mapped.setId);
});

test('mapUpcomingPlaceholder maps a null printedCount to 0', () => {
  const mapped = mapUpcomingPlaceholder({ ...FIXTURE, printedCount: null });
  assert.equal(mapped.printedCount, 0);
  assert.equal(mapped.cardCountTotal, 0);
});

test('the real-set count (the series heading) excludes the placeholder', () => {
  // The series page renders: data.sets.filter((s) => !s.upcoming).length
  const real = catalogSet();
  const [entry] = upcomingSetsFor('mega-evolution', [], '2026-09-12', [FIXTURE]);
  assert.ok(entry);
  const placeholder = mapUpcomingPlaceholder(entry);
  const allSets = [real, placeholder];

  const realCount = allSets.filter((s) => !s.upcoming).length;
  assert.equal(realCount, 1, 'catalog set counted');
  assert.equal(allSets.length, 2, 'placeholder included in full list for rendering');
});

test('compareSetOrder places a placeholder in date order among catalog sets', () => {
  // Newest first (DESC): newer catalog set, placeholder (2026-09-16), older set.
  const older = catalogSet({ name: 'Older Set', releasedOn: '2025-01-01' });
  const newer = catalogSet({ name: 'Newer Set', releasedOn: '2026-10-01' });
  const [entry] = upcomingSetsFor('mega-evolution', [], '2026-09-12', [FIXTURE]);
  assert.ok(entry);
  const placeholder = mapUpcomingPlaceholder(entry); // releasedOn 2026-09-16

  const sorted = [older, newer, placeholder].sort(compareSetOrder);
  const [first, second, third] = sorted;
  assert.ok(first && second && third);
  assert.equal(first.name, 'Newer Set', 'newest first (Oct 2026)');
  assert.equal(second.name, '30th Celebration', 'placeholder in middle (Sep 2026)');
  assert.equal(third.name, 'Older Set', 'oldest last (Jan 2025)');
});

test('compareSetOrder sorts null releasedOn after every dated set', () => {
  const dated = catalogSet({ name: 'Dated Set', releasedOn: '2024-03-01' });
  const undated = catalogSet({ name: 'Undated Promo', releasedOn: null });
  const sorted = [undated, dated].sort(compareSetOrder);
  const [first, second] = sorted;
  assert.ok(first && second);
  assert.equal(first.name, 'Dated Set', 'dated set before null');
  assert.equal(second.name, 'Undated Promo');
});

test('the full route assembly — map then sort — keeps placeholders off real counts', () => {
  // Exercises the same two production calls the route chains, in order, against
  // a fixture table: upcomingSetsFor → mapUpcomingPlaceholder → compareSetOrder.
  const real = catalogSet({ name: 'XY', releasedOn: '2014-08-01' });
  const placeholders = upcomingSetsFor('mega-evolution', [], '2026-09-12', [FIXTURE]).map(
    mapUpcomingPlaceholder,
  );
  const sets = [real, ...placeholders].sort(compareSetOrder);

  // Newest first: the 2026 placeholder, then the 2014 catalog set.
  assert.equal(sets[0]?.name, '30th Celebration');
  assert.equal(sets[1]?.name, 'XY');
  // The heading count excludes placeholders.
  assert.equal(sets.filter((s) => !s.upcoming).length, 1);
  // No placeholder carries a progress key.
  for (const s of sets) {
    if (s.upcoming) assert.equal('progress' in s, false);
  }
});

test('the live 30th Celebration entry maps correctly via the real UPCOMING_SETS table', () => {
  // Smoke-tests that the real entry survives the mapping that the route applies.
  // When UPCOMING_SETS is empty (set already published), this passes vacuously —
  // the table is expected to be empty most of the year.
  const entry = UPCOMING_SETS.find((u) => u.placeholderId === 'upcoming-pokemon-30th-celebration');
  if (!entry) return;

  const mapped = mapUpcomingPlaceholder(entry);
  assert.equal(mapped.upcoming, true);
  assert.ok(mapped.logoAssetPath?.startsWith('/'), 'logoAssetPath is root-relative');
  assert.ok(mapped.setId.startsWith('upcoming-'), 'setId is namespaced');
  assert.equal(mapped.logoUrl, null);
  assert.equal('progress' in mapped, false);
});
