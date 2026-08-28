/**
 * HOW MANY TIMES DOES HE FLY TO SETTLE ON ONE MARK?
 *
 * ── THE DEFECT, MEASURED OFF THE 2026-08-27 MOBILE TAPE ──────────────────────
 *
 * *"See how that is like slowly drifting downward before it rests at the
 * bottom? It's also causing him to do a lot of jitter and stuff as he has to
 * readjust a bunch."*
 *
 * Tracked frame by frame at 10 Hz from 0:36.6 to 0:41.5 of the recording, his
 * silhouette's bottom edge fell in SIX discrete hops with a small retreat
 * between each pair — about 90 CSS px in just under five seconds. Six hops is
 * not one animation; it is the mark watch firing six times, because a mark that
 * moves a handful of pixels was worth a full flight with an arc and an arrival.
 *
 * `markWatch.test.ts` pins the decision. This pins the CONSEQUENCE, which is
 * the thing the owner actually reported: how many separate journeys he takes to
 * answer one drift.
 *
 * ── HOW THE DRIFT IS REPRODUCED WITHOUT A SOFTWARE KEYBOARD ──────────────────
 *
 * On the tape the mark is moved by iOS retracting the keyboard and the panel
 * re-laying-out under it, which headless Chromium has no equivalent of. What
 * the watch actually sees, though, is just the composer's rect changing by a
 * few pixels several times in a row — so this moves it directly, six times, by
 * the deltas measured off the tape. Same input to the decision under test, with
 * nothing standing in for it.
 *
 * No model runs: `/api/chat` is fulfilled with a canned stream, exactly as
 * `probe-transcript-geometry.mjs` does.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/visual-harness/probe-park-settle.mjs
 *
 * Exits non-zero if one drift costs more than two flights.
 */
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { signIn, bypassHeaders, qaAccount, openDeckE, unlockDeckE, HOME_PATH } from './lib/session.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i+1] && !argv[i+1].startsWith('--') ? argv[i+1] : d }
const BASE = arg('base', 'http://localhost:5199')
const W = Number(arg('width', '390')), H = Number(arg('height', '844'))
/** At most this many flights for one drift. One is ideal; two is the budget. */
const BUDGET = Number(arg('budget', '2'))

/** The per-hop deltas measured off the tape, in CSS px. */
const HOPS = [33, 13, 13, 17, 10, 7]

const { chromium } = await resolvePlaywright()
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  extraHTTPHeaders: bypassHeaders(),
})
const page = await ctx.newPage()

await page.route('**/api/chat', async (route) => {
  const body =
    [{ type: 'text-delta', delta: 'Here is a short answer so the panel has a transcript in it.' }]
      .map((c) => `data: ${JSON.stringify(c)}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body })
})

await signIn(page, BASE, qaAccount())
await unlockDeckE(page)
await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded' })
const composer = await openDeckE(page)
await page.waitForFunction(() => !!window.__decke, undefined, { timeout: 60_000 })
await composer.fill('say something short')
await composer.press('Enter')
// The entrance, the send and the composer's own drop all have to be over before
// anything counted here is the drift rather than the turn.
await page.waitForTimeout(7000)

// COUNT FLIGHTS, not positions. A cut and a flight both end with him in the
// right place; only one of them is a journey the reader watches him take.
await page.evaluate(() => {
  const d = window.__decke
  window.__flights = []
  const real = d.flyTo.bind(d)
  d.flyTo = (target, opts = {}) => {
    if (!opts.instant) window.__flights.push(Date.now())
    return real(target, opts)
  }
})

// Move the mark the way the tape moved it: six small growths, spaced so each one
// is a fresh sample for a 100 ms poll with a 420 ms trailing debounce.
for (const px of HOPS) {
  await page.evaluate((delta) => {
    const el = document.querySelector('[data-decke-composer]')
    const now = parseFloat(getComputedStyle(el).paddingBottom) || 0
    el.style.paddingBottom = `${now + delta}px`
  }, px)
  await page.waitForTimeout(700)
}
// Let the last debounce and its flight finish before counting.
await page.waitForTimeout(2500)

const flights = await page.evaluate(() => window.__flights.length)
const moved = HOPS.reduce((a, b) => a + b, 0)
console.log(JSON.stringify({ viewport: `${W}x${H}`, hops: HOPS.length, movedPx: moved, flights, budget: BUDGET }, null, 2))

await browser.close()
if (flights > BUDGET) {
  console.error(`FAIL — ${moved}px of drift cost ${flights} separate flights; the budget is ${BUDGET}`)
  process.exit(1)
}
console.log(`PASS — ${moved}px of drift settled in ${flights} flight(s) at ${W}x${H}`)
