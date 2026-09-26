import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'
import { announcement } from './upcoming.mjs'

// PERF-01: every page is its own `lazyRoute` chunk. The built app must still
// open a page cold and by navigation, keep Stripe.js off catalog pages, and turn
// a route chunk that vanished under an open tab (a deploy) into exactly ONE
// reload — not an error page, not a loop — while a chunk that is genuinely gone
// surfaces after that one reload instead of reloading forever. These contexts
// have no service worker, which is the case the uncontrolled recovery exists for.
const SERIES_CHUNK = /\/assets\/SeriesDetail-[\w-]+\.js$/

export async function checkRouteSplit(browser, server, mount, label, out) {
  const results = []
  const base = server.origin + mount
  const seriesPath = mount + '/series/' + announcement.seriesSlug
  const seriesHeading = (page) => page.getByRole('heading', { name: 'Browser Series', exact: true })
  // Self-host counts as signed in, so the index groups series by ownership and
  // tucks the uncollected one behind a disclosure first.
  const openSeries = async (page) => {
    const tucked = page.getByText(/^Show \d+ series with no cards collected/)
    if (await tucked.count()) await tucked.click()
    await page.locator(`a[href="${seriesPath}"]`).first().click()
  }

  {
    const { context, page } = await contextFor(browser, server, 1280)
    try {
      const pages = []
      page.on('request', (r) => { if (/\/assets\/(SeriesIndex|SeriesDetail)-/.test(r.url())) pages.push(path.basename(r.url())) })
      await page.goto(base + '/series', { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'Series', exact: true }).waitFor()
      await openSeries(page)
      await seriesHeading(page).waitFor()
      assert.ok(pages.some((p) => p.startsWith('SeriesIndex-')) && pages.some((p) => p.startsWith('SeriesDetail-')),
        label + ': both pages must arrive as their own chunks, not inside the entry')
      assert.deepEqual(server.stubbedThirdParty, [], label + ': Stripe.js must not load on a catalog page')
      results.push({ case: 'route-split-navigation', label, chunks: pages.length, stripeOnCatalog: false })
    } finally { await context.close() }
  }

  // The chunk is missing for the whole first document (the tab predates a
  // deploy) and present from the reload on (the new shell names a hash that
  // exists). The idle prefetch hits the 404 first and must NOT reload: a
  // speculative preload never does.
  for (const genuinelyGone of [false, true]) {
    const { context, page } = await contextFor(browser, server, 390)
    const errorsBefore = server.unexpected.length
    try {
      let documents = 0, missed = 0
      page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents++ })
      await page.route(SERIES_CHUNK, (route) => {
        if (!genuinelyGone && documents > 1) return route.continue()
        missed++
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'gone after a deploy' })
      })
      await page.goto(base + '/series', { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'Series', exact: true }).waitFor()
      await page.waitForFunction(() => document.readyState === 'complete')
      await page.waitForTimeout(1500) // let the idle prefetch try, and fail, first
      assert.equal(documents, 1, label + ': a failed speculative preload must not reload the page')
      await openSeries(page)
      if (genuinelyGone) {
        await page.waitForURL('**' + seriesPath)
        await page.waitForTimeout(4000)
        assert.equal(documents, 2, label + ': a chunk that stays gone must cost one reload, not a loop')
        assert.equal(await seriesHeading(page).count(), 0)
        // The missing chunk surfacing is the point of this case, not a leak —
        // as an uncaught error today, or inside a route error boundary once
        // one exists. Anything else that surfaced is a real failure.
        const surfaced = server.unexpected.splice(errorsBefore)
        assert.ok(surfaced.every((e) => /dynamically imported module|Importing a module script failed/i.test(e)),
          label + ': only the missing chunk may surface: ' + surfaced.join(' | '))
      } else {
        await seriesHeading(page).waitFor({ timeout: 15000 })
        assert.equal(documents, 2, label + ': a stale chunk must cost exactly one reload')
        assert.equal(new URL(page.url()).pathname, seriesPath, label + ': the reload must land where they were going')
        assert.equal(await page.evaluate(() => sessionStorage.getItem('deckpal:chunk-retry')), null,
          label + ': the retry guard must clear once the chunk loads')
        await page.screenshot({ path: path.join(out, `route-split-recovered-${label}.png`) })
      }
      assert.ok(missed >= 1, label + ': the fixture never served the missing chunk')
      results.push({ case: genuinelyGone ? 'route-chunk-gone-no-loop' : 'route-chunk-stale-reload', label, documents, missed })
    } finally { await context.close() }
  }
  return results
}
