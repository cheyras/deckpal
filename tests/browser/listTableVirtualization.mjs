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
import { fileURLToPath } from 'node:url'
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
      setName: 'Simulator Set', seriesSlug: 'sim', setId: 'sim1',
      variant: i === 1 ? { kind: 'reverse', displayName: 'Master Ball Pattern Reverse Holofoil', tier: 'standard', isPrimary: false } : null,
      staticQuantity: null,
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
  if (rel.startsWith('/api/cards/')) return { status: 404, body: { error: 'Card detail is outside this fixture' } }
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
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${origin}/lists/${LIST_ID}?view=table`, { waitUntil: 'load' })
  await page.waitForSelector('[data-decke-list-items]')

  if (width < 768) {
    await page.waitForSelector('[data-decke-list-items] [data-decke-card]')
    assert.equal(await page.getByRole('button', { name: 'Table' }).count(), 0, 'phone toggle omits Table')
    assert.equal(await page.locator('[data-decke-list-items] table').count(), 0, 'saved Table choice renders Grid on a phone')
    assert.equal(new URL(page.url()).searchParams.get('view'), 'table', 'phone fallback preserves the URL choice')
    await page.setViewportSize({ width: 800, height })
    await page.waitForSelector('[data-decke-list-items] table[aria-rowcount="3201"]')
    assert.equal(new URL(page.url()).searchParams.get('view'), 'table', 'desktop restores the selected Table view')
    for (const desktopWidth of [768, 800, 900]) {
      await page.setViewportSize({ width: desktopWidth, height })
      const tableWidth = await page.locator('[data-decke-list-items] table').evaluate(table => ({
        table: table.getBoundingClientRect().width,
        viewport: table.parentElement.clientWidth,
      }))
      assert.ok(tableWidth.table <= tableWidth.viewport + 1,
        `${desktopWidth}px table overflows its region: ${JSON.stringify(tableWidth)}`)
      const variantFit = await page.locator('tbody tr[data-index="1"]').evaluate(row => ({
        chipRight: row.cells[3].firstElementChild.getBoundingClientRect().right,
        cellRight: row.cells[3].getBoundingClientRect().right,
        priceLeft: row.cells[4].getBoundingClientRect().left,
      }))
      assert.ok(variantFit.chipRight <= variantFit.cellRight + 1 && variantFit.chipRight <= variantFit.priceLeft,
        `${desktopWidth}px long variant overlaps Price: ${JSON.stringify(variantFit)}`)
    }
    await context.close()
    return { fallback: 'grid', savedView: 'table' }
  }

  await page.waitForSelector('[data-decke-list-items] table[aria-rowcount="3201"]')
  await page.waitForSelector('tbody tr[data-index="0"]')
  const renderMs = await page.evaluate(() => performance.now())
  assert.ok(renderMs < 2500, `3,200-row table appeared after ${Math.round(renderMs)} ms (budget 2,500 ms)`)
  await page.waitForTimeout(250)
  const domCount = await page.evaluate(() => document.querySelectorAll('*').length)
  assert.ok(domCount < DOM_NODE_BUDGET, `desktop table has ${domCount} DOM nodes (budget ${DOM_NODE_BUDGET})`)
  const rowCount = await page.locator('tbody tr[data-index]').count()
  assert.ok(rowCount > 0 && rowCount < 200, `expected a visible slice, got ${rowCount} rows`)
  assert.equal(await page.locator('tbody tr[data-index="0"]').getAttribute('aria-rowindex'), '2')
  assert.deepEqual(await page.locator('thead th').allTextContents(), ['Card', '#', 'Name', 'Variant', 'Price', 'Quantity'])
  const alignment = await page.evaluate(() => {
    const headers = [...document.querySelectorAll('thead th')]
    const cells = [...document.querySelector('tbody tr[data-index="0"]').children]
    return headers.map((header, index) => Math.abs(header.getBoundingClientRect().left - cells[index].getBoundingClientRect().left))
  })
  assert.ok(alignment.every(delta => delta < 1), `header and cell columns drifted: ${alignment}`)
  const firstRow = page.locator('tbody tr[data-index="0"]')
  assert.equal(await firstRow.locator('td').nth(3).innerText(), '—', 'a missing variant has a visible placeholder')
  const rowLayout = await firstRow.evaluate(row => {
    const rowBox = row.getBoundingClientRect()
    const imageBox = row.cells[0].firstElementChild.getBoundingClientRect()
    return { height: rowBox.height,
      centers: [0, 1, 2, 3, 4, 5].map(index => {
        const box = row.cells[index].firstElementChild?.getBoundingClientRect() ?? row.cells[index].getBoundingClientRect()
        return box.top + box.height / 2 - rowBox.top
      }),
      imageCenter: imageBox.top + imageBox.height / 2 - rowBox.top }
  })
  assert.ok(rowLayout.height <= 70, `table row is taller than its thumbnail needs: ${JSON.stringify(rowLayout)}`)
  assert.ok(rowLayout.centers.every(center => Math.abs(center - rowLayout.imageCenter) < 2),
    `row contents are not centered: ${JSON.stringify(rowLayout)}`)

  await page.goto(`${origin}/lists/${LIST_ID}?view=table&sort=name&dir=asc`)
  await page.waitForSelector('tbody tr[data-index="0"]')
  const ascNames = await page.locator('tbody tr[data-index] [data-decke-card]').allTextContents()
  await page.goto(`${origin}/lists/${LIST_ID}?view=table&sort=name&dir=desc`)
  await page.waitForSelector('tbody tr[data-index="0"]')
  const descNames = await page.locator('tbody tr[data-index] [data-decke-card]').allTextContents()
  assert.notDeepEqual(ascNames.slice(0, 5), descNames.slice(0, 5), 'sort direction changes visible rows')
  assert.deepEqual(ascNames.slice(0, 5), [...ascNames.slice(0, 5)].sort((a, b) => a.localeCompare(b)))

  await page.goto(`${origin}/lists/${LIST_ID}?view=table`)
  await page.waitForSelector('tbody tr[data-index="0"]')
  await page.locator('tbody tr[data-index="0"] td').nth(4).click()
  await page.waitForSelector('[role="dialog"][aria-modal="true"]')
  assert.equal(new URL(page.url()).searchParams.get('card'), 'sim1-1', 'clicking a table row opens its card')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('card'))
  await page.waitForFunction(() => document.body.style.position !== 'fixed')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-decke-card')), 'sim1-1',
    'a non-link cell click returns focus to its card link after the sheet closes')
  const priceCell = page.locator('tbody tr[data-index="0"] td').nth(4)
  for (const options of [{ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] }, { button: 'middle' }]) {
    const [popup] = await Promise.all([page.waitForEvent('popup'), priceCell.click(options)])
    await popup.waitForLoadState()
    assert.equal(new URL(popup.url()).searchParams.get('card'), 'sim1-1', 'modified row click opens the card in a new tab')
    assert.equal(new URL(page.url()).searchParams.has('card'), false, 'modified row click leaves the list in place')
    await popup.close()
  }
  const firstLink = page.locator('tbody tr[data-index="0"] [data-decke-card]')
  await firstLink.focus()
  await page.keyboard.press('PageDown')
  await page.keyboard.press('PageDown')
  assert.equal(await firstLink.count(), 1, 'focused row stays mounted when scrolled offscreen')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-decke-card')), 'sim1-1')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[role="dialog"][aria-modal="true"]')
  assert.equal(new URL(page.url()).searchParams.get('card'), 'sim1-1')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('card'))
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-decke-card')), 'sim1-1', 'sheet restores focus')
  await page.waitForFunction(() => document.body.style.position !== 'fixed')
  await page.evaluate(() => document.activeElement?.blur()) // end the focus-return scenario before deep scrolling

  await page.evaluate(() => window.scrollTo(0, 100_000))
  await page.waitForTimeout(300) // the virtualizer updates its window range on the next frame
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr[data-index]')]
    .some(row => Number(row.dataset.index) > 100 && row.getBoundingClientRect().top < innerHeight))
  const deep = await page.evaluate(() => [...document.querySelectorAll('tbody tr[data-index]')]
    .find(row => row.getBoundingClientRect().top >= 0 && row.getBoundingClientRect().bottom <= innerHeight)?.dataset.index)
  assert.ok(deep, 'expected a visible deep row')
  const deepLink = page.locator(`tbody tr[data-index="${deep}"] [data-decke-card]`)
  await deepLink.focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector('[role="dialog"][aria-modal="true"]')
  await page.setViewportSize({ width: 900, height })
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr[data-index]')]
    .some(row => Number(row.dataset.index) > 100 && row.getBoundingClientRect().bottom > 0
      && row.getBoundingClientRect().top < innerHeight))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('card'))
  await page.waitForFunction(index => {
    const row = document.querySelector(`tbody tr[data-index="${index}"]`)
    return row?.querySelector('[data-decke-card]') === document.activeElement
      && row.getBoundingClientRect().bottom > 0 && row.getBoundingClientRect().top < innerHeight
  }, deep)
  assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join('; ')}`)
  await context.close()
  return { domCount, rowCount, renderMs: Math.round(renderMs), alignment, deep }
}

async function main(borrowedBrowser) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-list-table-'))
  const dist = path.join(scratch, 'dist')
  const results = {}
  let browser = borrowedBrowser
  try {
    fs.mkdirSync(dist, { recursive: true })
    // Serve first (on an ephemeral port), THEN build against that exact
    // origin — the app bakes `VITE_SUPABASE_URL` in at build time, so the
    // fixture's port has to be known before `buildWeb` runs, not guessed.
    // The server just reads `dist` per request; writing the build into it
    // afterward needs no restart.
    const server = await serve(dist)
    try {
      await buildWeb(dist, true, server.origin)
      browser ??= await chromium.launch({ headless: true })
      results['390x844'] = await checkViewport(browser, server.origin, 390, 844)
      results['1440x900'] = await checkViewport(browser, server.origin, 1440, 900)
    } finally {
      await server.close()
    }
  } finally {
    if (!borrowedBrowser) await browser?.close()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  console.log('PASS list table virtualization (PERF-03):', JSON.stringify(results, null, 2))
  return results
}

export function browserSuites({ browser, results }) {
  return [{ name: 'list-table-virtualization', run: async () => {
    await main(browser)
    results.push({ case: 'list-table-virtualization', width: 390 },
      { case: 'list-table-virtualization', width: 1440 })
  } }]
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack ?? String(error))
    process.exitCode = 1
  })
}
