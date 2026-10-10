import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { contextFor, isolatedEnv, ROOT, run, serve, WEB } from './support.mjs'

// Battle logs v2 in the deck page's Battles tab (migration 084), rendered by the
// REAL BattlesTab (fixture.html?battles) over real fetches to this fixture API:
// a PTCG Live game with a review and a digest, a game played in person (no raw
// log, so no digest request and no "View log"), an `other` game whose digest
// 404s, a Live game whose digest fails, an `other` game whose digest fails and
// whose detail has rawLog: null (words, never an empty <pre>), and the
// most-faced summary both from the
// server's all-versions record and, under a version filter, from the loaded logs.

const DECK = 'battles-deck'
const API = `/deckpal/api/decks/${DECK}`
const PWNED_REVIEW = [
  '## Turning point',
  '',
  'T9 **Sinistcha ex** went down to a Phantom Dive spread and the *lead* flipped to them, 3–5.',
  '',
  '### What to keep',
  '',
  '- Bench Dusknoir before T6',
  '- Hold Counter Catcher for the last two prizes',
  '',
  '<script>window.__pwned = 1</script>',
  '',
  '<img src="https://attacker.example/x.gif" onerror="window.__pwned = 2">',
  '',
  '[open me](javascript:window.__pwned=3) and ![beacon](https://attacker.example/pixel.gif)',
].join('\n')

const LOGS = [
  { id: 101, deckVersion: 2, result: 'win', opponent: 'Robni16', opponentDeck: 'Dragapult ex / Dusknoir', opponentArchetype: 'dragapult-ex',
    origin: 'ptcgl', turns: 14, prizes: { me: 6, opponent: 5 }, notes: 'Bricked turn two, stabilised on Dusknoir.', reviewMd: PWNED_REVIEW,
    playedAt: '2026-09-11T20:15:00Z', source: 'web' },
  { id: 102, deckVersion: 2, result: 'loss', opponent: 'Sam at locals', opponentDeck: 'Gardevoir ex', opponentArchetype: 'gardevoir-ex',
    origin: 'in_person', turns: null, prizes: null, notes: 'Whiffed Arven twice.',
    reviewMd: '**Light.** Lost the prize race to Munkidori pings; nothing worth replaying.\n\nThey went first and found Arven on turn one.',
    playedAt: '2026-09-10T02:00:00Z', source: 'deckpal-mcp' },
  { id: 103, deckVersion: 1, result: 'loss', opponent: 'TrainerKai', opponentDeck: null, opponentArchetype: 'dragapult-ex',
    origin: 'ptcgl', turns: 11, prizes: { me: 3, opponent: 6 }, notes: null, reviewMd: null,
    playedAt: '2026-09-08T19:00:00Z', source: 'web' },
  { id: 104, deckVersion: 1, result: 'win', opponent: 'Jo', opponentDeck: null, opponentArchetype: 'raging-bolt-ex',
    origin: 'other', turns: null, prizes: null, notes: null, reviewMd: null,
    playedAt: '2026-09-05T19:00:00Z', source: 'deckpal-mcp' },
  // `other` whose digest FAILS, so the UI cannot know there is no log until it
  // asks: "View log" is offered and the detail comes back with rawLog: null.
  { id: 105, deckVersion: 1, result: 'tie', opponent: 'Alex', opponentDeck: 'Lost Box', opponentArchetype: null,
    origin: 'other', turns: null, prizes: null, notes: null, reviewMd: null,
    playedAt: '2026-09-03T19:00:00Z', source: 'deckpal-mcp' },
]
const ARCHETYPES = [ // the API's all-versions record, newest encounter first
  { opponentArchetype: 'gardevoir-ex', games: 1, wins: 0, losses: 1, ties: 0, lastPlayedAt: '2026-09-10T02:00:00Z' },
  { opponentArchetype: 'dragapult-ex', games: 2, wins: 1, losses: 1, ties: 0, lastPlayedAt: '2026-09-11T20:15:00Z' },
  { opponentArchetype: 'raging-bolt-ex', games: 1, wins: 1, losses: 0, ties: 0, lastPlayedAt: '2026-09-05T19:00:00Z' },
]
const ev = (turn, side, prizes, me, opponent, knockedOut) => ({ turn, side, prizes, knockedOut, score: { me, opponent } })
const DIGEST_101 = {
  logId: 101, deckVersion: 2, origin: 'ptcgl', result: 'win',
  digest: {
    players: { me: 'cheyras', opponent: 'Robni16' }, playerNames: ['Robni16', 'cheyras'], confidence: 'high', result: 'win',
    wentFirst: 'opponent', totalTurns: 14, turns: { me: 7, opponent: 7 }, mulligans: { me: 0, opponent: 1 },
    firstAttackTurn: { me: 4, opponent: 3 }, finalPrizes: { me: 6, opponent: 5 },
    prizeTimeline: [
      ev(3, 'opponent', 1, 0, 1, 'Poltchageist'), ev(4, 'me', 1, 1, 1, 'Dreepy'), ev(6, 'me', 2, 3, 1, 'Drakloak'),
      ev(7, 'opponent', 2, 3, 3, 'Fezandipiti ex'), ev(9, 'opponent', 2, 3, 5, 'Sinistcha ex'),
      ev(11, 'me', 2, 5, 5, 'Dragapult ex'), ev(14, 'me', 1, 6, 5, 'Duskull'),
    ],
    opponentCards: [{ name: 'Dragapult ex', count: 16 }], myPokemonUsed: ['Poltchageist'], opponentArchetypeGuess: 'Dragapult ex / Dusknoir',
    endReason: 'prizes', leadChanged: true, closeGame: true,
    unknowns: ["the opponent's hand, and any card of theirs that was never shown", 'which cards were prized, on either side'],
  },
}
const RAW_101 = 'Setup\nRobni16 chose tails for the opening coin flip.\ncheyras won the coin toss.\n\nTurn # 1 - Robni16\'s Turn\nRobni16 drew a card.'

function battlesApi() {
  const calls = [], unexpected = []
  const record = (status, body) => ({ status, body, headers: { 'Cache-Control': 'no-store, private' } })
  function respond(rel, url) {
    if (!rel.startsWith('/deckpal/api/') && !rel.startsWith('/api/')) return null
    calls.push(rel + url.search)
    if (rel === API + '/logs') {
      const version = url.searchParams.get('version')
      const logs = version ? LOGS.filter(l => l.deckVersion === Number(version)) : LOGS
      const count = r => logs.filter(l => l.result === r).length
      return record(200, {
        version: version ? Number(version) : null, logs,
        totals: { total: logs.length, wins: count('win'), losses: count('loss'), ties: count('tie') },
        archetypes: ARCHETYPES,
        pagination: { page: 1, pageSize: 50, total: logs.length, pageCount: 1 },
      })
    }
    if (rel === API + '/logs/101/digest') return record(200, DIGEST_101)
    if (rel === API + '/logs/103/digest' || rel === API + '/logs/105/digest') {
      return record(500, { error: { code: 'internal', message: 'Fixture digest failure' } })
    }
    if (rel === API + '/logs/105') {
      return record(200, { log: { ...LOGS[4], rawLog: null, parsed: null, createdAt: LOGS[4].playedAt } })
    }
    if (rel === API + '/logs/104/digest') {
      return record(404, { error: { code: 'not_found', message: 'no game log to digest — this game was logged without one' } })
    }
    if (rel === API + '/logs/101') {
      return record(200, { log: { ...LOGS[0], rawLog: RAW_101, parsed: null, createdAt: LOGS[0].playedAt } })
    }
    unexpected.push('Unexpected API: ' + rel + url.search)
    return record(404, { error: { message: 'Not a fixture route' } })
  }
  return { calls, unexpected, respond }
}

const rowToggle = (page, id) => page.locator(`button[aria-controls="battle-log-${id}"]`)
const panel = (page, id) => page.locator(`#battle-log-${id}`)
const box = loc => loc.evaluate(el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round) })

async function noHorizontalScroll(page, label) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }))
  assert.ok(scroll <= inner, `${label}: the page scrolls sideways (${scroll} > ${inner})`)
}

export async function checkBattlesV2(browser, server, fixture, out) {
  const results = []
  for (const width of [1440, 390]) {
    fixture.calls.length = 0
    const { context, page } = await contextFor(browser, server, width)
    try {
      await page.goto(server.origin + '/fixture.html?battles', { waitUntil: 'networkidle' })
      await page.evaluate(() => { document.documentElement.dataset.skin = 'premium' })
      const rows = page.locator('section[aria-labelledby="battles-games"] > ul > li')
      await rows.first().waitFor()
      assert.equal(await rows.count(), 5)

      // ── Origin + archetype on each row: quiet words, no new chip ─────────────
      const rowText = i => rows.nth(i).locator('button').first().innerText()
      assert.match(await rowText(0), /vs Robni16[\s\S]*Dragapult ex[\s\S]*TCG Live/)
      assert.match(await rowText(1), /vs Sam at locals[\s\S]*Gardevoir ex[\s\S]*In person/)
      assert.doesNotMatch(await rowText(1), /turns|prizes/, 'an in-person game has no parsed turns or prizes to show')
      assert.match(await rowText(3), /Raging Bolt ex[\s\S]*Other source/)

      // ── Most faced, from the all-versions record the list already carries ───
      const faced = page.getByRole('region', { name: 'Most faced' })
      const facedItems = faced.locator('ol > li')
      assert.equal(await facedItems.count(), 3)
      assert.deepEqual((await facedItems.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()), [
        'Dragapult ex 2 games 1W–1L', 'Gardevoir ex 1 game 0W–1L', 'Raging Bolt ex 1 game 1W–0L',
      ])
      assert.equal(fixture.calls.filter(c => c.includes('/digest') || /\/logs\/\d+$/.test(c)).length, 0,
        'nothing per-row may be fetched before a row is opened')
      await noHorizontalScroll(page, `list ${width}`)
      await page.screenshot({ path: path.join(out, `battles-v2-list-${width}.png`), fullPage: true })

      // ── Keyboard: reach the first row by Tab, see the ring, open with Enter ──
      const live = rowToggle(page, 101)
      let reached = false
      for (let i = 0; i < 20 && !reached; i += 1) {
        await page.keyboard.press('Tab')
        reached = await live.evaluate(el => el === document.activeElement)
      }
      assert.ok(reached, 'the first row could not be reached with Tab')
      // The house ring: theme.css's 2px outline, or the premium skin's 1px outline + 4px halo.
      const ring = await live.evaluate(el => {
        const s = getComputedStyle(el)
        return { visible: el.matches(':focus-visible'), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, boxShadow: s.boxShadow }
      })
      assert.ok(ring.visible && ring.outlineStyle !== 'none' && (parseFloat(ring.outlineWidth) >= 2 || ring.boxShadow !== 'none'),
        'no visible focus ring: ' + JSON.stringify(ring))
      assert.equal(await live.getAttribute('aria-expanded'), 'false')
      await page.keyboard.press('Enter')
      assert.equal(await live.getAttribute('aria-expanded'), 'true')

      // ── Live game: digest fetched on open, once; raw log NOT until asked ────
      const livePanel = panel(page, 101)
      await livePanel.getByRole('heading', { name: /Prize race/ }).waitFor()
      assert.deepEqual(fixture.calls.filter(c => c.includes('/digest')), [API + '/logs/101/digest'])
      assert.equal(fixture.calls.filter(c => c === API + '/logs/101').length, 0, 'the raw log was fetched before View log')
      const race = livePanel.getByRole('region', { name: /Prize race/ })
      assert.equal(await race.locator('ol > li').count(), 7)
      assert.match(await race.innerText(), /You went second · Close game/)
      assert.equal((await livePanel.getByRole('heading', { name: /Prize race/ }).boundingBox()).height < 30, true,
        'the prize-race heading wrapped onto a second line')
      const turningItems = livePanel.getByRole('region', { name: 'Turning points' }).locator('li')
      assert.deepEqual(await turningItems.locator('span[aria-hidden="true"]').allInnerTexts(), ['T3', 'T6', 'T9', 'T14'])
      assert.deepEqual(await turningItems.locator('.sr-only').allTextContents(), ['Turn 3', 'Turn 6', 'Turn 9', 'Turn 14'])
      assert.deepEqual(await turningItems.locator(':scope > span:last-child').allInnerTexts(), [
        'They took the first prize (your Poltchageist)',
        'You took the lead, 3–1',
        'They took the lead, 3–5',
        'You took your last prize, 6–5',
      ])
      const details = await livePanel.locator('dl').innerText()
      assert.match(details, /Archetype\s+Dragapult ex/)
      assert.match(details, /Their deck\s+Dragapult ex \/ Dusknoir/)

      // ── Review: real markdown, and the injection attempt is inert text ──────
      const review = livePanel.getByRole('region', { name: "Deck-E's review" })
      assert.equal(await review.locator('h4', { hasText: 'Turning point' }).count(), 1)
      assert.equal(await review.locator('strong', { hasText: 'Sinistcha ex' }).count(), 1)
      assert.equal(await review.locator('em', { hasText: 'lead' }).count(), 1)
      assert.equal(await review.locator('ul > li').count(), 2)
      assert.equal(await review.locator('img, script, iframe').count(), 0, 'markup from the review became live elements')
      assert.equal(await review.locator('a[href^="javascript:"]').count(), 0)
      assert.match(await review.innerText(), /<script>window.__pwned = 1<\/script>/, 'raw HTML should be visible as text')
      assert.equal(await page.evaluate(() => window.__pwned), undefined, 'review content executed')

      // Nothing arrives late and shoves the buttons: one paint, then still.
      const del = livePanel.getByRole('button', { name: 'Delete Log' })
      const before = await box(del)
      await page.waitForTimeout(600)
      assert.deepEqual(await box(del), before, 'the detail shifted after it painted')

      const view = livePanel.getByRole('button', { name: 'View log' })
      assert.equal(await view.getAttribute('aria-expanded'), 'false')
      await view.click()
      await livePanel.locator('pre', { hasText: 'Robni16 chose tails' }).waitFor()
      assert.equal(fixture.calls.filter(c => c === API + '/logs/101').length, 1)
      assert.equal(await livePanel.getByRole('button', { name: 'Hide log' }).getAttribute('aria-expanded'), 'true')
      await noHorizontalScroll(page, `live detail ${width}`)
      await livePanel.locator('..').screenshot({ path: path.join(out, `battles-v2-live-${width}.png`) })
      await page.screenshot({ path: path.join(out, `battles-v2-live-page-${width}.png`), fullPage: true })
      await live.click()
      assert.equal(await livePanel.count(), 0)

      // ── In person: no digest request, no raw-log fetch, no "View log" ───────
      await rowToggle(page, 102).click()
      const personPanel = panel(page, 102)
      await personPanel.getByText('Reported in person — no game log').waitFor()
      assert.equal(await personPanel.getByRole('button', { name: /View log/ }).count(), 0)
      assert.equal(await personPanel.locator('pre').count(), 0, 'an in-person game painted a log box')
      assert.match(await personPanel.getByRole('region', { name: "Deck-E's review" }).innerText(), /Light\.\s+Lost the prize race/)
      assert.equal(await personPanel.getByRole('heading', { name: /Prize race/ }).count(), 0)
      await page.waitForTimeout(200)
      assert.equal(fixture.calls.filter(c => c.includes('/logs/102')).length, 0, 'an in-person game asked the server for a log or digest')
      await noHorizontalScroll(page, `in-person detail ${width}`)
      await personPanel.locator('..').screenshot({ path: path.join(out, `battles-v2-in-person-${width}.png`) })
      await rowToggle(page, 102).click()

      // ── Live game whose digest fails: quiet — no error, log still offered ───
      await rowToggle(page, 103).click()
      const failedPanel = panel(page, 103)
      await failedPanel.getByRole('button', { name: 'View log' }).waitFor()
      assert.equal(await failedPanel.getByText('Fixture digest failure').count(), 0, 'a digest failure was shown to the reader')
      assert.equal(await failedPanel.getByRole('heading', { name: /Prize race/ }).count(), 0)
      assert.equal(await failedPanel.getByRole('region', { name: "Deck-E's review" }).count(), 0, 'no review must render nothing, not an empty box')
      await rowToggle(page, 103).click()

      // ── `other` with no log: the digest's 404 hides "View log" ─────────────
      await rowToggle(page, 104).click()
      const otherPanel = panel(page, 104)
      await otherPanel.getByText('Logged without a game log', { exact: true }).waitFor()
      assert.equal(await otherPanel.getByRole('button', { name: /View log/ }).count(), 0)
      await rowToggle(page, 104).click()

      // ── `other`, digest unknown: "View log" answers rawLog: null in words ──
      await rowToggle(page, 105).click()
      const nullPanel = panel(page, 105)
      await nullPanel.getByRole('button', { name: 'View log' }).click()
      await nullPanel.locator('#battle-log-105-raw').getByText('Logged without a game log', { exact: true }).waitFor()
      assert.equal(await nullPanel.locator('pre').count(), 0, 'a null rawLog painted an empty log box')
      assert.equal(fixture.calls.filter(c => c === API + '/logs/105').length, 1)
      await rowToggle(page, 105).click()
      assert.equal(fixture.calls.filter(c => c.includes('/digest')).length, 4, 'each digest is fetched once, on open')

      // ── Version filter: the summary is re-tallied from the loaded logs ──────
      await page.getByLabel('Filter by deck version').selectOption('2')
      await page.getByRole('region', { name: /Most faced · on v2/ }).waitFor()
      await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="battles-games"] > ul > li').length === 2)
      const scoped = page.getByRole('region', { name: /Most faced/ }).locator('ol > li')
      assert.deepEqual((await scoped.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()), [
        'Dragapult ex 1 game 1W–0L', 'Gardevoir ex 1 game 0W–1L',
      ])
      await noHorizontalScroll(page, `filtered ${width}`)

      results.push({ case: 'battles-v2', width })
    } finally {
      await context.close()
    }
  }
  return results
}

export function browserSuites({ browser, out, scratch, results, logs }) {
  return [{
    name: 'battles-v2',
    async run() {
      const fixtureDist = path.join(scratch, 'battles-v2')
      logs.push(await run(process.execPath, [path.join(WEB, 'node_modules/vite/bin/vite.js'), 'build',
        '--config', path.join(ROOT, 'tests/browser/vite.config.mjs'), '--outDir', fixtureDist],
      { env: isolatedEnv() }))
      const fixture = battlesApi()
      const server = await serve(fixtureDist, '', fixture.respond, 'fixture.html')
      try {
        results.push(...await checkBattlesV2(browser, server, fixture, out))
        assert.deepEqual(fixture.unexpected, [], 'Battles v2 fixture: unexpected API calls')
        assert.deepEqual(server.unexpected, [], 'Battles v2 fixture: unexpected network/error events')
      } finally {
        await server.close()
      }
    },
  }]
}

async function runOnlyBattlesV2() {
  const out = path.resolve(process.env.TEST_ARTIFACT_DIR ?? path.join(ROOT, '.cache/browser-tests/battles-v2'))
  fs.mkdirSync(out, { recursive: true })
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-battles-v2-'))
  const results = [], logs = []
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  try {
    await browserSuites({ browser, out, scratch, results, logs })[0].run()
    console.log('PASS battles v2 browser journey:', JSON.stringify(results))
  } finally {
    await browser.close()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runOnlyBattlesV2()
}
