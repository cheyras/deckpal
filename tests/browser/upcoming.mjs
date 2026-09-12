import assert from 'node:assert/strict'
import path from 'node:path'
import { UPCOMING_SETS, upcomingSetsFor, mapUpcomingPlaceholder, compareSetOrder } from '../../apps/api/src/upcomingSets.ts'
import { contextFor } from './support.mjs'

// Stable injected clock/table: expiry is a test case, never today's wall clock.
// When the announcement table is empty, the same row contract exercises its
// no-logo fallback; any real local logos continue to be discovered by the gate.
export const announcement = UPCOMING_SETS[0] ?? {
  placeholderId: 'upcoming-browser-fixture', seriesSlug: 'browser-series', name: 'Browser Celebration',
  releasedOn: '2026-09-16', printedCount: 128, expiresOn: '2026-10-31', logoAssetPath: '',
}
const makeSet = (setId, name, releasedOn) => ({ setId, slug: setId, name, releasedOn,
  isPromo: false, printedCount: 100, secretCount: 0, cardCountTotal: 100, logoUrl: null, symbolUrl: null })
const real = [makeSet('browser-alpha', 'Alpha Fixture', '2026-09-10'), makeSet('browser-beta', 'Beta Fixture', '2026-08-20')]
export function seriesFixture(scenario) {
  const rows = scenario === 'catalogued'
    ? [...real, makeSet('browser-catalogued', announcement.name.toUpperCase().replace(/ /g, '---'), announcement.releasedOn)]
    : [...real]
  const today = scenario === 'expired' ? '2999-01-01' : announcement.expiresOn
  const placeholders = upcomingSetsFor(announcement.seriesSlug, rows.map(s => s.name), today, [announcement]).map(mapUpcomingPlaceholder)
  return { series: { id: 1, slug: announcement.seriesSlug, name: 'Browser Series', firstReleaseOn: '2026-08-20' },
    sets: [...rows, ...placeholders].sort(compareSetOrder) }
}
export function appResponses(scenario, rel) {
  const detail = seriesFixture(scenario)
  if (rel === '/api/series/' + announcement.seriesSlug) return { body: detail }
  if (rel === '/api/series') return { body: { series: [{ ...detail.series, setCount: detail.sets.filter(s => !s.upcoming).length, cardCount: 200, sortOrder: 1 }] } }
  if (['/api/me', '/api/me/settings', '/api/insights/overview', '/api/avatar'].includes(rel)) return { status: 401, body: { error: 'Anonymous browser fixture' } }
  // Explicit image fixture paths only. Cloud's synthetic Supabase origin is
  // this same loopback server; no request is redirected to remote storage.
  const id = '(browser-alpha|browser-beta|browser-catalogued)'
  if (new RegExp('^/(?:deckpal/)?images/sets/' + id + '/symbol\\.webp$').test(rel)
    || new RegExp('^/storage/v1/object/public/card-art/sets/' + id + '/symbol\\.webp$').test(rel))
    return { raw: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8" fill="#64748b"/></svg>', type: 'image/svg+xml' }
  return null
}
export async function checkUpcoming(browser, server, mount, label, out) {
  const results = []
  for (const width of [1280, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    try {
      await page.goto(server.origin + mount + '/series/' + announcement.seriesSlug, { waitUntil: 'networkidle' })
      const row = page.getByRole('group', { name: announcement.name + ' — coming soon', exact: true })
      await row.waitFor({ state: 'visible' })
      assert.equal(await row.locator('a,button,[tabindex],[data-decke-clickable],[role=progressbar]').count(), 0,
        'Placeholder must expose neither navigation nor completion')
      assert.equal(await row.getAttribute('data-decke-clickable'), null)
      const date = new Date(announcement.releasedOn + 'T12:00:00Z').toLocaleDateString('en-US', {
        timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
      assert.ok((await row.innerText()).includes(date), 'Calendar release date shifted in Denver')
      assert.match(await row.innerText(), /coming soon/i)
      await page.getByText('2 sets', { exact: true }).waitFor()
      const link = page.locator('a[data-decke-set="browser-alpha"]')
      assert.equal(new URL(await link.getAttribute('href'), server.origin).pathname,
        mount + '/series/' + announcement.seriesSlug + '/browser-alpha')
      assert.match(await link.innerText(), /Sep 10, 2026/)
      if (announcement.logoAssetPath) {
        const expected = mount + '/' + announcement.logoAssetPath.replace(/^\/+/, '')
        assert.equal(await row.locator('img').getAttribute('src'), expected)
        assert.ok(await row.locator('img').evaluate(el => el.complete && el.naturalWidth > 0), 'Announcement logo must load')
        assert.ok(server.requests.includes(expected))
      }
      const title = row.getByText(announcement.name, { exact: true }).last()
      assert.ok(await title.evaluate(el => el.scrollWidth <= el.clientWidth + 1 &&
        getComputedStyle(el).textOverflow !== 'ellipsis'), 'Announcement title is clipped')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Page overflows viewport')
      await page.screenshot({ path: path.join(out, label + '-' + (width === 390 ? 'mobile390' : 'desktop') + '.png'), fullPage: true })
      results.push({ case: 'upcoming-layout', label, width, mount, date, placeholderExcludedFromCount: true, logoLoaded: !!announcement.logoAssetPath })
    } finally { await context.close() }
  }
  return results
}
