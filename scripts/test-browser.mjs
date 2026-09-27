import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { ROOT } from '../tests/browser/support.mjs'

const out = path.resolve(process.env.TEST_ARTIFACT_DIR ?? path.join(ROOT, '.cache/browser-tests'))
fs.mkdirSync(out, { recursive: true })
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-browser-'))
const results = [], assets = [], logs = []
let browser

// Every .mjs module may export browserSuites(context). Helper modules simply
// omit that export. New suites register by adding their own file, so concurrent
// PRs no longer have to edit this runner's suite list.
async function discoverSuites(context) {
  const dir = path.join(ROOT, 'tests/browser')
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.mjs')).sort()
  const suites = []
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(dir, file)).href)
    if (!Object.hasOwn(module, 'browserSuites')) continue
    assert.equal(typeof module.browserSuites, 'function', file + ': browserSuites must be a function')
    const discovered = await module.browserSuites(context)
    assert.ok(Array.isArray(discovered), file + ': browserSuites must return an array')
    for (const suite of discovered) {
      assert.ok(typeof suite?.name === 'string' && suite.name && typeof suite.run === 'function',
        file + ': every suite needs a name and run function')
      assert.ok(!suites.some(previous => previous.name === suite.name), 'Duplicate browser suite: ' + suite.name)
      suites.push(suite)
    }
  }
  assert.ok(suites.length, 'No browser suites discovered in tests/browser/*.mjs')
  return suites
}

// Suites own their dist, fixture server and browser contexts. A failure does
// not suppress the other independent suites' results or cleanup.
async function pool(concurrency, suites) {
  const errors = []
  let next = 0
  async function worker() {
    while (next < suites.length) {
      const suite = suites[next++]
      const started = performance.now()
      try { await suite.run() } catch (error) { errors.push(suite.name + ':\n' + (error.stack ?? String(error))) }
      finally { console.log('TIMING suite ' + suite.name + ' ' + ((performance.now() - started) / 1000).toFixed(1) + 's') }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, suites.length) }, worker))
  if (errors.length) throw new Error(errors.join('\n\n'))
}

let failure
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  const suites = await discoverSuites({ browser, out, scratch, results, assets, logs })
  // Four workers match a GitHub-hosted runner's four cores. Builds are CPU
  // heavy, while the browser checks spend much of their time waiting on I/O.
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
      'Real built SPA and production presentation/mapping helpers; local JSON fixtures, not a real database. ' +
      'One check (auth-return) drives a real supabase-js sign-in against a fake, in-process Auth REST responder ' +
      '— still no real account and no network egress; every other check uses a localStorage session shortcut.',
    ...(failure ? { error: failure.message } : {}),
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(out, 'browser-build.log'), logs.join('\n'))
}
if (failure) throw failure
console.log('PASS browser boundaries: ' + results.length + ' cases; screenshots and reports in ' + out)
