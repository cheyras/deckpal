import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'

/**
 * Regression coverage for the offline banner fix (`fix/offline-banner`):
 *
 * 1. **Truthfulness.** `navigator.onLine === false` while the network is
 *    genuinely reachable must NOT show "Offline." — the observed iOS
 *    Simulator bug, where the hint lied and the banner repeated it forever.
 * 2. **Real transitions.** A real `context.setOffline` toggle still shows and
 *    clears the banner, on both signals agreeing.
 * 3. **Layering.** An open Sheet's footer (Bug Report / Add Cards' shape) is
 *    never covered by the banner while genuinely offline — the `--z-toast`
 *    fix in `theme.css`.
 *
 * Runs against the SAME built fixture + server `chat.mjs` uses (`?offline`
 * mounts `OfflineHarness` — the real `PwaUi` + a real `Sheet` — instead of
 * `DeckeChat`), so this is real components over a real fetch to this
 * fixture's own `/deckpal/api/me`, not a description of the behavior.
 */
const banner = (page) => page.getByRole('status').filter({ hasText: 'Offline.' })
const waitSettled = (page, wantVisible) =>
  page.waitForFunction(
    (want) => {
      const el = [...document.querySelectorAll('[role="status"]')].find((n) => n.textContent?.includes('Offline.'))
      return want ? !!el : !el
    },
    wantVisible,
    { timeout: 5000 },
  )

export async function checkOffline(browser, server, out) {
  const results = []
  const go = async (page) => {
    await page.goto(server.origin + '/fixture.html?offline', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => typeof window.offlineFixture?.openSheet === 'function')
  }

  // ── 1. A lying hint over a live network must not claim "Offline." ────────
  {
    const { context, page } = await contextFor(browser, server, 390)
    try {
      await page.addInitScript(() => {
        Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
      })
      await go(page)
      await waitSettled(page, false)
      assert.equal(await banner(page).count(), 0, 'navigator.onLine=false with a reachable network must not show the banner')
      results.push({ case: 'lying-hint-suppressed', bannerShown: false })
    } finally { await context.close() }
  }

  // ── 2. A real offline/online transition still shows and clears it ────────
  for (const width of [1280, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    try {
      await go(page)
      await waitSettled(page, false)
      assert.equal(await banner(page).count(), 0, width + ': starts online with no banner')

      await context.setOffline(true)
      await waitSettled(page, true)
      assert.equal(await banner(page).count(), 1, width + ': a real offline transition shows the banner')
      await page.screenshot({ path: path.join(out, 'offline-banner-' + width + '.png') })

      await context.setOffline(false)
      await waitSettled(page, false)
      assert.equal(await banner(page).count(), 0, width + ': a real online transition clears the banner')
      results.push({ case: 'real-transition-roundtrip', width })
    } finally { await context.close() }
  }

  // ── 3. Offline + an open sheet: the footer stays on top and clickable ────
  {
    const { context, page } = await contextFor(browser, server, 390)
    try {
      await go(page)
      await context.setOffline(true)
      await waitSettled(page, true)
      await page.evaluate(() => window.offlineFixture.openSheet())
      const submit = page.getByRole('button', { name: 'Submit' })
      await submit.waitFor()
      // Let the sheet's entrance transition (theme.css) settle before the
      // screenshot and hit-test — mid-transition the node is attached/
      // "visible" to Playwright already but not yet at its resting position,
      // which makes for a misleading screenshot (same idiom feedback.mjs uses).
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.px-sheet-scrim')].every((node) => Number(getComputedStyle(node).opacity) >= 0.99),
      )
      await page.screenshot({ path: path.join(out, 'offline-banner-sheet-open-390.png') })

      // The real test: the point under the Submit button's center resolves to
      // the button itself (or a descendant), not the banner painted over it —
      // exactly the defect this z-index fix corrects.
      const onTop = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Submit')
        const rect = btn.getBoundingClientRect()
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return !!top && (top === btn || btn.contains(top))
      })
      assert.ok(onTop, 'the Submit button, not the offline banner, is hit-tested on top')

      await submit.click()
      assert.equal(await page.evaluate(() => window.offlineFixture.submitted), 1, 'the click actually reached Submit')
      results.push({ case: 'sheet-footer-not-covered', width: 390 })
    } finally { await context.close() }
  }

  return results
}
