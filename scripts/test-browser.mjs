import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, webkit } from 'playwright'
import { ROOT, WEB, run, buildWeb, isolatedEnv, serve, contextFor } from '../tests/browser/support.mjs'
import { appResponses, announcement, checkUpcoming } from '../tests/browser/upcoming.mjs'
import { adminFixture, checkAdmin } from '../tests/browser/admin.mjs'
import { checkServiceWorkerPrivacy } from '../tests/browser/admin-worker.mjs'
import { checkFeedback } from '../tests/browser/feedback.mjs'
import { chatAllowMutation, chatApi, checkChat, checkDeckeStates } from '../tests/browser/chat.mjs'
import { checkDeployAssets } from './check-deploy-assets.mjs'

const out = path.resolve(process.env.TEST_ARTIFACT_DIR ?? path.join(ROOT, '.cache/browser-tests'))
fs.mkdirSync(out, { recursive: true })
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-browser-'))
const results = [], assets = [], logs = []
let browser

// Runs `suites` with at most `concurrency` running at once. Each suite owns its
// own dist dir, fixture server and (for the label suites) admin-fixture state,
// so they never share mutable state with one another -- only the shared
// Playwright `browser` handle and the `results`/`assets`/`logs` arrays, and
// pushing to those from concurrent async suites is safe (Node has one thread;
// a push is never interleaved mid-call). A suite's own failure screenshot and
// cleanup still happen in its own try/finally; this just lets every suite run
// to completion and reports every failure together instead of stopping CI's
// feedback at the first one, the way the previous sequential `for` loop did.
async function pool(concurrency, suites) {
  const errors = []
  let next = 0
  async function worker() {
    while (next < suites.length) {
      const suite = suites[next++]
      try { await suite.run() } catch (error) { errors.push(suite.name + ':\n' + (error.stack ?? String(error))) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, suites.length) }, worker))
  if (errors.length) throw new Error(errors.join('\n\n'))
}

// One entry per independent build+check branch. To add another (a new PR's
// test file), push one more `{ name, run }` here -- `run` gets its own
// dist/server/browser context and should push its own cases into `results`
// (and `assets`, if it builds a dist worth asset-checking) before returning.
function labelSuite(label, mount) {
  return {
    name: label,
    async run() {
      const dist = path.join(scratch, label)
      let scenario = 'active'
      const admin = adminFixture(mount)
      let adminActive = false
      const server = await serve(dist, mount, (rel, url, req) => adminActive ? admin.response(rel, url, req) : appResponses(scenario, rel), 'index.html', { allowMutation: admin.allowMutation })
      try {
        logs.push(await buildWeb(dist, label === 'cloud', server.origin))
        assets.push({ label, ...checkDeployAssets(dist) })
        results.push(...await checkUpcoming(browser, server, mount, label, out))
        for (scenario of ['expired', 'catalogued']) {
          const { context, page } = await contextFor(browser, server, 390)
          try {
            await page.goto(server.origin + mount + '/series/' + announcement.seriesSlug, { waitUntil: 'networkidle' })
            await page.getByRole('heading', { name: 'Browser Series', exact: true }).waitFor()
            assert.equal(await page.getByRole('group', { name: announcement.name + ' — coming soon', exact: true }).count(), 0)
            await page.getByText(scenario === 'catalogued' ? '3 sets' : '2 sets', { exact: true }).waitFor()
            results.push({ case: 'upcoming-suppression', label, scenario, placeholderAbsent: true })
          } finally { await context.close() }
        }
        adminActive = true
        results.push(...await checkAdmin(browser, server, mount, label, out, admin))
        results.push(...await checkFeedback(browser, server, mount, label, out, admin))
        results.push(await checkServiceWorkerPrivacy(browser, dist, mount, label))
        assert.deepEqual(server.unexpected, [], label + ': unexpected network/error events')
      } finally { await server.close() }
    },
  }
}

const chatSuite = {
  name: 'chat',
  async run() {
    const fixtureDist = path.join(scratch, 'chat')
    logs.push(await run(process.execPath, [path.join(WEB, 'node_modules/vite/bin/vite.js'), 'build',
      '--config', path.join(ROOT, 'tests/browser/vite.config.mjs'), '--outDir', fixtureDist],
      { env: isolatedEnv() }))
    const server = await serve(fixtureDist, '', chatApi, 'fixture.html', { allowMutation: chatAllowMutation })
    try {
      results.push(...await checkChat(browser, server, out))
      // The Deck-E states a reader has to act on, in both engines: WebKit is what
      // an iPhone runs, and the character's clearance was photographed failing
      // there too.
      results.push(...await checkDeckeStates(browser, server, out, 'chromium'))
      const safari = await webkit.launch({ headless: true, ...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH } : {}) })
      try { results.push(...await checkDeckeStates(safari, server, out, 'webkit')) } finally { await safari.close() }
      assert.deepEqual(server.unexpected, [], 'Rendered chat fixture: unexpected network/error events')
    } finally { await server.close() }
  },
}

const tscSuite = {
  name: 'typecheck',
  async run() {
    // This entry lives outside apps/web/src and has its own typecheck.
    logs.push(await run(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'),
      '--noEmit', '-p', path.join(ROOT, 'tests/browser/tsconfig.json')]))
  },
}

let failure
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  const suites = [tscSuite, labelSuite('selfhost', '/deckpal'), labelSuite('cloud', ''), chatSuite]
  // Bounded at 4: matches a GitHub-hosted runner's 4 cores. Each suite does a
  // real `vite build` (CPU-bound) plus a run of Playwright page checks
  // (mostly I/O-wait), so 4 concurrent suites is headroom, not oversubscription.
  await pool(4, suites)
} catch (error) {
  failure = error
  logs.push(error.stack ?? String(error))
} finally {
  await browser?.close()
  fs.rmSync(scratch, { recursive: true, force: true })
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({
    status: failure ? 'failed' : 'passed', results, assets, fixedTime: '2026-09-12T18:00:00Z',
    network: 'loopback-only; unexpected requests fail', fixtureScope:
      'Real built SPA and production presentation/mapping helpers; local JSON fixtures, not database or live authentication.',
    ...(failure ? { error: failure.message } : {}),
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(out, 'browser-build.log'), logs.join('\n'))
}
if (failure) throw failure
console.log('PASS browser boundaries: ' + results.length + ' cases; screenshots and reports in ' + out)
