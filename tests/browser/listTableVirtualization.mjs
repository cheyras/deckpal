// PERF-03 regression check: ListDetail's Table view virtualization.
//
// A small standalone server rather than `support.mjs`'s shared `serve()`: that
// helper enforces a closed allowlist of known API paths (any unlisted `/api/*`
// request is a hard failure), which is the right contract for the admin/
// catalog suite but would mean growing that allowlist for a route it
// otherwise never touches. This script owns its own tiny dispatcher instead —
// same build tooling (`buildWeb`) and the SAME `adminFixture` app-shell
// responses (`/api/me`, `/api/insights/overview`, `/api/me/settings`, …) the
// rest of this suite already relies on, so the signed-in shell (nav, avatar,
// Deck-E's boot check) renders exactly as it does elsewhere — plus its own
// `/api/lists*` handler for the one route this check actually exercises,
// mirroring `.sim/server.mjs` (this repo's local scale-profiling fixture,
// gitignored) in composing a route-specific responder in front of
// `adminFixture`'s general one.
//
// Run directly: `node --import tsx tests/browser/listTableVirtualization.mjs`
// (see the `test:browser:list-table` package.json script).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { chromium } from 'playwright'
import { buildWeb } from './support.mjs'
import { adminFixture } from './admin.mjs'

const NOW = '2026-09-12T18:00:00Z'
const LIST_ID = 'list-big'
const COUNT = 3200
// Comfortably above the ~485-615 nodes actually measured for a virtualized
// render (viewport + overscan), comfortably below the ~29,000 an
// unvirtualized `cards.map()` produces at this list size — the point is
// "bounded regardless of list length", not a tight tolerance on exact count.
const DOM_NODE_BUDGET = 2500

const PLACEHOLDER_IMG = { low: '/__fixture/card.svg', high: '/__fixture/card.svg' }
const PRICE = { market: 4.5, low: 3, mid: 4.5, high: 6, currency: 'USD' }
const CATALOG = [
  { cardId: 'sim1-1', name: 'Simuchu' },
  { cardId: 'sim1-2', name: 'Fixturemon' },
  { cardId: 'sim1-3', name: 'Testadactyl' },
  { cardId: 'sim1-4', name: 'Mockipom' },
  { cardId: 'sim1-5', name: 'Stubbicoon' },
]

function makeListItems(n) {
  const items = []
  for (let i = 0; i < n; i++) {
    const base = CATALOG[i % CATALOG.length]
    const have = i % 3 !== 0
    items.push({
      itemId: `item-big-${i}`, position: i, kind: 'card', cardId: base.cardId,
      number: String((i % 500) + 1).padStart(3, '0'), numberSort: String((i % 500) + 1).padStart(3, '0'),
      name: `${base.name} #${i + 1}`, category: 'Pokémon', rarity: 'Rare', artist: 'Fixture Artist',
      variantCount: 1, images: PLACEHOLDER_IMG, price: PRICE,
      ownership: { totalQuantity: have ? 1 : 0, requiredCount: 1, ownedRequired: have ? 1 : 0, have, need: !have, dupe: false },
      setName: 'Simulator Set', seriesSlug: 'sim', setId: 'sim1', variant: null, staticQuantity: null,
    })
  }
  return items
}
const ITEMS = makeListItems(COUNT)
const owned = ITEMS.filter((i) => i.ownership.have).length
const LIST_SUMMARY = {
  id: LIST_ID, kind: 'dynamic', name: `Table Virtualization Fixture (${COUNT} cards)`, description: null,
  visibility: 'private', isFavorite: false, coverRender: '', pocketSize: null, itemCount: COUNT,
  progress: { owned, total: COUNT, pct: Math.round((100 * owned) / COUNT), copies: COUNT },
  marketValueUsd: COUNT * PRICE.market, coverImage: null, coverImages: [],
  rule: null, ruleEvaluatedAt: null, createdAt: NOW, updatedAt: NOW,
}

function seedScript() {
  return () => {
    const token = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ sub: '10000000-0000-4000-8000-000000000002', exp: 4102444800, role: 'authenticated' })) + '.fixture'
    const session = {
      access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer',
      expires_in: 3600, expires_at: 4102444800,
      user: { id: '10000000-0000-4000-8000-000000000002', email: 'fixture@example.invalid', aud: 'authenticated',
        role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-12T18:00:00Z' },
    }
    localStorage.setItem('sb-127-auth-token', JSON.stringify(session))
    localStorage.setItem('deckpal.settings.pushed.v1', '1')
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' }

/** Narrow, permissive fixture: answers the paths this page actually calls,
 * and returns an empty 200 for anything else `/api/`-shaped (the app renders
 * fine with empty auxiliary data — this suite isn't asserting on those) so
 * adding a route here later doesn't require enumerating the whole surface. */
function respondApi(rel, url) {
  if (rel === '/__fixture/card.svg') {
    return { raw: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="200" height="280" rx="12" fill="#64748b"/></svg>', type: 'image/svg+xml' }
  }
  if (rel === '/sw.js') return { status: 404, body: 'no service worker in this fixture', type: 'text/plain' }
  if (rel === '/api/lists' && url.searchParams.get('deleted') !== 'true') return { body: { lists: [LIST_SUMMARY] } }
  if (rel === `/api/lists/${LIST_ID}`) return { body: { list: LIST_SUMMARY, items: ITEMS } }
  return null
}

// Ordinary signed-in user, matching this file's seeded JWT `sub` — mirrors
// `.sim/server.mjs`'s override of `adminFixture`'s (owner-by-default) state,
// so the app shell renders as a normal member, not an admin.
const FAKE_USER_ID = '10000000-0000-4000-8000-000000000002'
const admin = adminFixture('')
admin.state.actor = 'ordinary'
admin.state.permissions = []
admin.state.signedOut = false
admin.state.users[0].id = FAKE_USER_ID

async function serve(dist) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const rel = decodeURIComponent(url.pathname)
    const response = respondApi(rel, url) ?? admin.response(rel, url, { method: req.method, headers: req.headers })
      ?? (rel.startsWith('/api/') ? { body: {} } : null)
    if (response) {
      res.writeHead(response.status ?? 200, { 'Content-Type': response.type ?? 'application/json' })
      res.end(response.raw ?? JSON.stringify(response.body))
      return
    }
    let file = path.resolve(dist, '.' + rel)
    if (!file.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(rel)) { res.writeHead(404); res.end('Missing asset: ' + rel); return }
      file = path.join(dist, 'index.html')
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) }
}

async function checkViewport(browser, origin, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
  await context.addInitScript(seedScript())
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  // ── Bounded DOM regardless of list length ──
  await page.goto(`${origin}/lists/${LIST_ID}?view=table`, { waitUntil: 'load' })
  await page.waitForSelector('[data-decke-list-items]')
  await page.waitForFunction(
    () => document.querySelectorAll('[role="listitem"]').length > 0,
    { timeout: 10_000 },
  )
  await page.waitForTimeout(300) // let the virtualizer's measured-height pass settle
  const domCount = await page.evaluate(() => document.querySelectorAll('*').length)
  assert.ok(
    domCount < DOM_NODE_BUDGET,
    `${width}x${height}: expected a bounded DOM at ${COUNT} rows, got ${domCount} nodes (budget ${DOM_NODE_BUDGET})`,
  )
  const rowCount = await page.evaluate(() => document.querySelectorAll('[role="listitem"]').length)
  assert.ok(rowCount > 0 && rowCount < 200, `${width}x${height}: expected only a viewport-sized slice of rows mounted, got ${rowCount}`)

  // ── Sort: ListDetail sorts `items` before TableView ever sees them, so
  //    virtualizing the render must not change the resulting order. ──
  await page.goto(`${origin}/lists/${LIST_ID}?view=table&sort=name&dir=asc`, { waitUntil: 'load' })
  await page.waitForSelector('[role="listitem"]')
  await page.waitForTimeout(200)
  const ascNames = await page.evaluate(() =>
    [...document.querySelectorAll('[role="listitem"] .font-display')].slice(0, 5).map((e) => e.textContent))
  await page.goto(`${origin}/lists/${LIST_ID}?view=table&sort=name&dir=desc`, { waitUntil: 'load' })
  await page.waitForSelector('[role="listitem"]')
  await page.waitForTimeout(200)
  const descNames = await page.evaluate(() =>
    [...document.querySelectorAll('[role="listitem"] .font-display')].slice(0, 5).map((e) => e.textContent))
  assert.notDeepEqual(ascNames, descNames, `${width}x${height}: expected sort direction to change the rendered order`)
  const expectedAsc = [...ascNames].sort((a, b) => a.localeCompare(b))
  assert.deepEqual(ascNames, expectedAsc, `${width}x${height}: ascending sort not reflected in rendered rows`)

  // ── Keyboard: Tab reaches a row's link (not skipped for being off-DOM),
  //    Enter activates it exactly like a click would. ──
  await page.goto(`${origin}/lists/${LIST_ID}?view=table`, { waitUntil: 'load' })
  await page.waitForSelector('[role="listitem"]')
  await page.waitForTimeout(200)
  let landedOnRow = false
  for (let i = 0; i < 40 && !landedOnRow; i++) {
    await page.keyboard.press('Tab')
    landedOnRow = await page.evaluate(() => !!document.activeElement?.closest('[role="listitem"]'))
  }
  assert.ok(landedOnRow, `${width}x${height}: expected Tab to reach a row link within 40 presses`)
  const focusedCardId = await page.evaluate(() => document.activeElement.getAttribute('data-decke-card'))
  assert.ok(focusedCardId, `${width}x${height}: focused row link missing its card address`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const openedCard = await page.evaluate(() => new URLSearchParams(location.search).get('card'))
  assert.equal(openedCard, focusedCardId, `${width}x${height}: Enter on the focused row should open that exact card`)

  assert.deepEqual(pageErrors, [], `${width}x${height}: unexpected page errors: ${pageErrors.join('; ')}`)
  await context.close()
  return { domCount, rowCount, ascNames, descNames, focusedCardId }
}

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-list-table-'))
  const dist = path.join(scratch, 'dist')
  const results = {}
  let browser
  try {
    fs.mkdirSync(dist, { recursive: true })
    // Serve first (on an ephemeral port), THEN build against that exact
    // origin — the app bakes `VITE_SUPABASE_URL` in at build time, so the
    // fixture's port has to be known before `buildWeb` runs, not guessed.
    // The server just reads `dist` per request; writing the build into it
    // afterward needs no restart.
    const server = await serve(dist)
    try {
      buildWeb(dist, true, server.origin)
      browser = await chromium.launch({ headless: true })
      results['390x844'] = await checkViewport(browser, server.origin, 390, 844)
      results['1440x900'] = await checkViewport(browser, server.origin, 1440, 900)
    } finally {
      await server.close()
    }
  } finally {
    await browser?.close()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  console.log('PASS list table virtualization (PERF-03):', JSON.stringify(results, null, 2))
}

main().catch((error) => {
  console.error(error.stack ?? String(error))
  process.exitCode = 1
})
