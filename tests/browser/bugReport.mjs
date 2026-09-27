import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'
import { signIn } from './admin.mjs'

// SEC-06 coverage: the in-app bug reporter's privacy disclosure and the
// screenshot include/exclude toggle (apps/web/src/components/BugReport.tsx),
// plus the sensitive-page skip (isSensitiveBugPage) that must never even
// attempt a capture on /admin/*. `/api/bugs` is mocked with `page.route` —
// not through the shared `admin`/`feedback` fixture dispatcher — because this
// is the only test exercising that endpoint and a one-off `page.route` keeps
// the shared dispatcher (already enormous) untouched. `page`-level routes
// take priority over the `contextFor` blanket `context.route` abort-by-default
// handler (see chat.mjs's `/api/chat` mock for the same established pattern),
// so the mocked request never reaches the real fixture server at all.
export async function checkBugReport(browser, server, mount, label, out, fixture) {
  const { state } = fixture
  const results = []
  // The API reports whether this deployment files public GitHub issues.
  const disclosure = label === 'cloud'
    ? /description and page path will be posted publicly on DeckPal's GitHub issue tracker/
    : /saved to this server.s issue folder and is not posted to GitHub/
  for (const width of [1440, 390]) {
    state.actor = 'owner'
    const { context, page } = await contextFor(browser, server, width)
    await signIn(context)
    const bugRequests = []
    await page.route('**/api/bugs', async (route) => {
      const body = route.request().postDataJSON()
      bugRequests.push(body)
      const fixtureResponse = label === 'cloud'
        ? { id: 'fixture-report-id', issueUrl: 'https://github.com/cheyras/deckpal/issues/9999' }
        : { id: 'fixture-report-id', saved: 'issues/fixture-report-id/' }
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(fixtureResponse) })
    })
    try {
      // ── Ordinary page: disclosure copy, screenshot captured, exclude toggle ──
      // A query string on purpose: the reported `page` must never carry it.
      await page.goto(server.origin + mount + '/devtools?ref=test123', { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: 'Dev tools', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Report a bug or feature request', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Report a bug', exact: true })
      await dialog.getByText(disclosure, { exact: false }).waitFor()
      await dialog.getByText('Capturing a screenshot of this page…', { exact: true }).waitFor({ state: 'hidden' })
      const shotImg = dialog.locator('img[alt="Screenshot of the current page that will be saved separately"]')
      await shotImg.waitFor()
      assert.match(await shotImg.getAttribute('src'), /^data:image\/jpeg;base64,/, 'a real screenshot must be captured on an ordinary page')
      const checkbox = dialog.getByLabel('Include screenshot', { exact: true })
      assert.equal(await checkbox.isChecked(), true, 'screenshot inclusion defaults to checked')
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: path.join(out, label + '-bugreport-normal-' + width + '.png'), fullPage: false })
      await checkbox.uncheck()
      await dialog.getByRole('textbox').fill('Browser test: normal-page disclosure and exclude toggle')
      await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
      await dialog.getByText('Thanks — your report was saved.', { exact: true }).waitFor()
      if (label === 'cloud') await dialog.getByRole('link', { name: 'View it on GitHub', exact: true }).waitFor()
      else await dialog.getByText('issues/fixture-report-id/', { exact: true }).waitFor()
      assert.equal(bugRequests.length, 1, 'exactly one report was submitted so far')
      // `mount` is the self-host base path ('/deckpal') or '' for cloud —
      // window.location.pathname carries it, and that part is unchanged
      // behavior; only the query string is new-stripped.
      assert.equal(bugRequests[0].page, mount + '/devtools', 'the query string must never leave the browser')
      assert.equal(bugRequests[0].screenshot, undefined, 'unchecking the toggle must exclude the screenshot')
      assert.equal(bugRequests[0].text, 'Browser test: normal-page disclosure and exclude toggle')
      results.push({ case: 'bugreport-normal-disclosure-exclude', label, width })
      await dialog.getByRole('button', { name: 'Done', exact: true }).click()

      // ── Sensitive page: no capture is even attempted, no toggle to offer ──
      await page.goto(server.origin + mount + '/admin/users?search=member', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Report a bug or feature request', exact: true }).click()
      const sensitiveDialog = page.getByRole('dialog', { name: 'Report a bug', exact: true })
      await sensitiveDialog.getByText(/Screenshots are turned off on this page/, { exact: false }).waitFor()
      assert.equal(await sensitiveDialog.getByText('Capturing a screenshot of this page…', { exact: true }).count(), 0, 'a sensitive page must never even show the capturing state')
      assert.equal(await sensitiveDialog.locator('figure').count(), 0, 'no screenshot preview on a sensitive page')
      assert.equal(await sensitiveDialog.getByLabel('Include screenshot', { exact: true }).count(), 0, 'no toggle when nothing was captured')
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: path.join(out, label + '-bugreport-sensitive-' + width + '.png'), fullPage: false })
      await sensitiveDialog.getByRole('textbox').fill('Browser test: admin page must never capture a screenshot')
      await sensitiveDialog.getByRole('button', { name: 'Submit', exact: true }).click()
      await sensitiveDialog.getByText('Thanks — your report was saved.', { exact: true }).waitFor()
      assert.equal(bugRequests.length, 2, 'exactly two reports were submitted so far')
      assert.equal(bugRequests[1].page, mount + '/admin/users', 'the admin search filter must never leak into the reported page')
      assert.equal(bugRequests[1].screenshot, undefined, 'a sensitive page must never send a screenshot, toggle or not')
      results.push({ case: 'bugreport-sensitive-page-skips-capture', label, width })
      await sensitiveDialog.getByRole('button', { name: 'Done', exact: true }).click()

      // The router accepts mixed-case URLs for this same page. The capture
      // guard must agree with the router, including the self-host mount.
      await page.goto(server.origin + mount + '/ADMIN/users', { waitUntil: 'networkidle' })
      await page.getByRole('button', { name: 'Report a bug or feature request', exact: true }).click()
      const mixedCaseDialog = page.getByRole('dialog', { name: 'Report a bug', exact: true })
      await mixedCaseDialog.getByText(/Screenshots are turned off on this page/, { exact: false }).waitFor()
      assert.equal(await mixedCaseDialog.getByLabel('Include screenshot', { exact: true }).count(), 0)
      results.push({ case: 'bugreport-mixed-case-sensitive-page-skips-capture', label, width })
      await mixedCaseDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    } catch (error) {
      await page.screenshot({ path: path.join(out, label + '-bugreport-failure-' + width + '.png'), fullPage: true })
      error.message += '\nBugReport viewport ' + width + ': ' + (await page.locator('body').innerText()).slice(0, 4000)
      console.error(error.message)
      throw error
    } finally {
      await context.close()
    }
  }
  return results
}
