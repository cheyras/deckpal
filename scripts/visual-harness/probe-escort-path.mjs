/**
 * Does the escort's PATH exist? — the half of gate 22 that needs no model turn.
 *
 * ── WHY THIS EXISTS BESIDE GATE 22 ───────────────────────────────────────────
 *
 * Gate 22 is the authority on "help me find Pitch Black", and it costs a metered
 * turn: 120 a day on the QA account, UTC-midnight reset, and when that is spent
 * the gate cannot run at all. But the thing most likely to be broken about a
 * walk is not whether the model asks for one — that is now measured at 19/20 —
 * it is whether the four DOM landmarks it presses are still there and still lead
 * where they used to.
 *
 * That half is deterministic. `buildEscortSteps` writes the same four selectors
 * every time, so this walks them by hand, in order, and asserts the arrival:
 *
 *   /series  →  [data-decke-show-others]  →  [data-decke-series="…"]
 *            →  [data-decke-set="…"]      →  /series/<slug>/<setId>
 *
 * It is deliberately NOT a test of `runJourney`. It cannot see the pacing, the
 * fail-stop, the cancellation or the chip. What it catches is the failure that
 * would make every one of those irrelevant: a renamed attribute, a set row that
 * stopped being a link, a disclosure that no longer reveals the grid. Those are
 * silent — the walk would fail-stop politely and truthfully, and nobody would
 * know the product had lost a feature.
 *
 *   PLAYWRIGHT_MODULE=…/node_modules/playwright \
 *     node scripts/visual-harness/probe-escort-path.mjs --base http://localhost:5204
 *
 * Exits non-zero on the first hop that does not lead where the escort expects.
 */
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { signIn, bypassHeaders, qaAccount } from './lib/session.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const BASE = arg('base', 'http://localhost:5204')
const SLUG = arg('slug', 'mega-evolution')
const SET = arg('set', 'me05')

// Mirrors `apps/web/src/character/host/escortPlan.ts`. Kept as literals rather
// than imported because that module is TypeScript inside the app's build; if it
// drifts, `escortPlan.test.ts` catches the drift and this catches the DOM.
const SHOW_OTHERS = '[data-decke-show-others]'
const seriesLandmark = `[data-decke-series="${SLUG}"]`
const setLandmark = `[data-decke-set="${SET}"]`
const CANONICAL = `/series/${SLUG}/${SET}`

const fails = []
const step = (n, okay, detail) => {
  console.log(`  ${okay ? 'ok  ' : 'FAIL'}  ${n}${detail ? `  — ${detail}` : ''}`)
  if (!okay) fails.push(n)
  return okay
}

const { chromium } = await resolvePlaywright()
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  extraHTTPHeaders: bypassHeaders(),
})
const page = await context.newPage()
await signIn(page, BASE, qaAccount())

console.log(`\nescort path — ${BASE}, ${SLUG}/${SET}\n`)

// 1. goTo /series
await page.goto(`${BASE}/series`, { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle').catch(() => {})
step('goTo /series', new URL(page.url()).pathname === '/series', page.url())

// 2. ensure — press the disclosure only if the series is not already showing.
const seriesVisible = async () => (await page.locator(seriesLandmark).count()) > 0
if (await seriesVisible()) {
  step(`ensure ${seriesLandmark}`, true, 'already showing')
} else {
  const opener = page.locator(SHOW_OTHERS)
  if (step(`the disclosure ${SHOW_OTHERS} exists`, (await opener.count()) > 0)) {
    await opener.first().click()
    await page.waitForSelector(seriesLandmark, { timeout: 8_000 }).catch(() => {})
    step(`ensure revealed ${seriesLandmark}`, await seriesVisible())
  }
}

// 3. click the series card
if (await seriesVisible()) {
  await page.locator(seriesLandmark).first().click()
  await page.waitForURL((u) => u.pathname.startsWith(`/series/${SLUG}`), { timeout: 8_000 }).catch(() => {})
  step('click the series row', new URL(page.url()).pathname.startsWith(`/series/${SLUG}`), page.url())
}

// 4. the set row must be there to fly to, ring, and press
const setRow = page.locator(setLandmark)
await page.waitForSelector(setLandmark, { timeout: 8_000 }).catch(() => {})
const haveSet = (await setRow.count()) > 0
step(`the set row ${setLandmark} is on the page`, haveSet)
if (haveSet) {
  const box = await setRow.first().boundingBox()
  // A landmark with NO BOX is the hidden-sidebar case the sequencer fail-stops
  // on: it exists in the document, a press really navigates, and nobody sees it.
  step('the set row has a box, so the pointing is visible', !!box && box.width > 0 && box.height > 0)
  step(
    'the set row is marked pressable',
    (await setRow.first().getAttribute('data-decke-clickable')) !== null,
    'data-decke-clickable',
  )

  // 5. THE ARRIVAL. The hop the walk did not take for its first revision.
  await setRow.first().click()
  await page.waitForURL((u) => u.pathname === CANONICAL, { timeout: 8_000 }).catch(() => {})
  step(`ARRIVES on ${CANONICAL}`, new URL(page.url()).pathname === CANONICAL, page.url())
}

await context.close()
await browser.close()

if (fails.length) {
  console.log(`\n${fails.length} hop(s) failed: ${fails.join(' | ')}`)
  console.log('The escort would fail-stop here, truthfully, and the feature would be gone.')
  process.exit(1)
}
console.log('\nEvery hop of the escort leads where it is supposed to.')
