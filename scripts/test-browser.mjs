import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { ROOT, WEB, run, buildWeb, isolatedEnv, serve, contextFor } from '../tests/browser/support.mjs'
import { appResponses, announcement, checkUpcoming } from '../tests/browser/upcoming.mjs'
import { checkChat } from '../tests/browser/chat.mjs'
import { checkDeployAssets } from './check-deploy-assets.mjs'

const out = path.resolve(process.env.TEST_ARTIFACT_DIR ?? path.join(ROOT, '.cache/browser-tests'))
fs.mkdirSync(out, { recursive: true })
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-browser-'))
const results = [], assets = [], logs = []
let browser
let failure
try {
  // This entry lives outside apps/web/src and has its own typecheck.
  logs.push(run(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '-p', path.join(ROOT, 'tests/browser/tsconfig.json')]))
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  for (const [label, mount] of [['selfhost', '/deckpal'], ['cloud', '']]) {
    const dist = path.join(scratch, label)
    let scenario = 'active'
    const server = await serve(dist, mount, rel => appResponses(scenario, rel))
    try {
      logs.push(buildWeb(dist, label === 'cloud', server.origin))
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
      assert.deepEqual(server.unexpected, [], label + ': unexpected network/error events')
    } finally { await server.close() }
  }

  const fixtureDist = path.join(scratch, 'chat')
  logs.push(run(process.execPath, [path.join(WEB, 'node_modules/vite/bin/vite.js'), 'build',
    '--config', path.join(ROOT, 'tests/browser/vite.config.mjs'), '--outDir', fixtureDist],
    { env: isolatedEnv() }))
  const server = await serve(fixtureDist, '', rel => rel === '/api/me' || rel === '/deckpal/api/me'
    ? { body: { username: 'Browser Reader', owner: false, decke: false } } : null, 'fixture.html')
  try {
    results.push(...await checkChat(browser, server, out))
    assert.deepEqual(server.unexpected, [], 'Rendered chat fixture: unexpected network/error events')
  } finally { await server.close() }
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
