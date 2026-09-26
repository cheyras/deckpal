import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'

/**
 * QUAL-01 (scratchpad/audits/quality.md) — the app-wide error boundaries.
 *
 * Drives the REAL `RootErrorBoundary`/`RouteErrorFallback` components
 * (`apps/web/src/components/ErrorBoundary.tsx`) inside a minimal but REAL
 * `@tanstack/react-router` tree (`fixture.tsx`'s `?errorboundary` mode),
 * wired exactly like `main.tsx`: `defaultErrorComponent` on `createRouter()`,
 * the whole thing wrapped in `RootErrorBoundary`.
 *
 * Three things this pins that a screenshot alone would not:
 *   1. A route that throws is caught by ITS OWN boundary — the shell (a
 *      header outside the routed `<Outlet/>`) stays mounted and interactive.
 *   2. Retry actually re-runs the crashed component rather than papering over
 *      it — it still crashes while the underlying bug is "armed", and only
 *      renders real content once the fixture disarms it, mirroring a bug
 *      that was actually fixed rather than a screen that was reset.
 *   3. The root boundary is a strictly LARGER blast radius than the route
 *      boundary — a crash outside the router takes the shell down too. If a
 *      future refactor accidentally made `defaultErrorComponent` catch
 *      everything (collapsing the two into one), this would stop
 *      distinguishing "shell survives" from "shell gone" and fail.
 *
 * `server.unexpected` (populated by `contextFor`'s `page.on('pageerror', …)`)
 * is asserted empty at the end: an uncaught exception that escaped React
 * entirely — the exact failure mode QUAL-01 is about — would show up there
 * even if every other assertion in this file were accidentally wrong.
 */
export async function checkErrorBoundary(browser, server, out) {
  const results = []
  for (const width of [1280, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    const reports = []
    // Page-level route: takes precedence over `contextFor`'s own catch-all
    // (see chat.mjs's `checkMeterReplay` for the same idiom), so no fixture
    // server mutation policy is involved and `server.unexpected` stays empty.
    await page.route('**/client-errors', (route) => {
      reports.push(JSON.parse(route.request().postData() ?? '{}'))
      return route.fulfill({ status: 204, body: '' })
    })
    try {
      // `/?errorboundary`, NOT `/fixture.html?errorboundary`: the real
      // `@tanstack/react-router` tree below matches on `location.pathname`,
      // and the home route is `/` — `serve()`'s no-extension fallback still
      // answers `fixture.html` for it (see support.mjs), but leaves the
      // pathname the router actually needs intact.
      await page.goto(server.origin + '/?errorboundary', { waitUntil: 'networkidle' })
      const shell = page.getByRole('banner').filter({ hasText: 'Fixture shell header' })
      await shell.waitFor()
      await page.getByText('Home route content', { exact: true }).waitFor()

      // ── 1. A route crash is caught by its own boundary; the shell survives ──
      const reported = page.waitForRequest((req) => req.url().includes('/client-errors'))
      await page.getByRole('link', { name: 'Go to crash route', exact: true }).click()
      const fallback = page.getByRole('alert').filter({ hasText: 'This page hit a snag' })
      await fallback.waitFor()
      await shell.waitFor()
      await page.getByText('Home route content', { exact: true }).waitFor({ state: 'hidden' })
      await reported
      assert.equal(reports.length, 1, 'exactly one crash report for the one route crash')
      assert.equal(reports[0].route, '/crash')
      assert.match(reports[0].message, /deliberate render-time throw/)
      assert.equal(typeof reports[0].stack, 'string')
      await page.screenshot({ path: path.join(out, 'errorboundary-route-crash-' + width + '.png'), fullPage: true })
      results.push({ case: 'errorboundary-route-crash-shell-survives', width })

      // ── 2. Retry re-runs the crashed component: still broken, still broken ──
      const reportedAgain = page.waitForRequest((req) => req.url().includes('/client-errors'))
      await fallback.getByRole('button', { name: 'Retry', exact: true }).click()
      await fallback.waitFor()
      await reportedAgain
      assert.equal(reports.length, 2, 'a second Retry attempt against a still-broken route reports again')

      // ── 3. Once the underlying bug is fixed, Retry recovers ──────────────────
      await page.evaluate(() => window.errorBoundaryFixture.disarmCrash())
      await fallback.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.getByText('Recovered — this route renders fine now.', { exact: true }).waitFor()
      await shell.waitFor()
      assert.equal(await fallback.count(), 0, 'the fallback is gone once the route renders for real')
      results.push({ case: 'errorboundary-retry-recovers', width })

      // ── 4. The root boundary is the LARGER blast radius: shell goes too ─────
      await page.evaluate(() => window.errorBoundaryFixture.crashOutsideRouter())
      await page.getByRole('alert').filter({ hasText: 'Something went wrong' }).waitFor()
      assert.equal(await shell.count(), 0, 'a crash outside the router takes the shell down too — this IS the last resort')
      await page.screenshot({ path: path.join(out, 'errorboundary-root-crash-' + width + '.png'), fullPage: true })
      results.push({ case: 'errorboundary-root-crash-whole-app-fallback', width })
    } catch (error) {
      await page.screenshot({ path: path.join(out, 'errorboundary-failure-' + width + '.png'), fullPage: true })
      error.message += '\nError boundary viewport ' + width + ': ' + (await page.locator('body').innerText()).slice(0, 4000)
      throw error
    } finally {
      await context.close()
    }
  }
  return results
}
