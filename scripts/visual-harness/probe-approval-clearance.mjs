/**
 * DOES HE STAND ON THE PERMISSION PROMPT, OR ABOVE IT?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * 2026-08-27 mobile screen recording, narrated at 0:54: *"We have this issue
 * where the permission prompts, he's covering it up. I'd like him to like jump
 * up above the permission prompt. That would be much better … so we can
 * actually read the text that he's covering up."*
 *
 * `parkFloor.ts` carries the arithmetic and its unit tests pin it. What no unit
 * test can reach is the WIRING: that the approval card's node is measured at
 * all, that the number reaches the park box's `bottom`, and that `DeckeHost`
 * flies him to the box rather than to the composer it used to be pinned to.
 * Each of those is a separate way to ship a correct calculation nobody uses —
 * which is exactly what `composerTop` did for a whole revision (see its own
 * note: "the new placement was correct and was never the one being used").
 *
 * So this measures the two boxes on a real phone-sized viewport and asserts the
 * clearance, the same way `probe-transcript-geometry.mjs` measures the scroller.
 *
 * ── NO MODEL RUNS AND NO METER IS SPENT ──────────────────────────────────────
 *
 * `/api/chat` is FULFILLED with a canned SSE stream, exactly as
 * `probe-transcript-geometry.mjs` does. The approval is a real
 * `tool-approval-request` chunk taking the real path through `useDeckeChat`, so
 * the REAL `ApprovalCard` renders in the REAL panel — and because the call is
 * never answered, nothing is ever executed. `write_strategy_guide` is named
 * because it is the tool the recording caught asking.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/visual-harness/probe-approval-clearance.mjs
 *
 * Exits non-zero if any part of the card is behind him.
 */
import { mkdirSync } from 'node:fs'
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { signIn, bypassHeaders, qaAccount, openDeckE, unlockDeckE, HOME_PATH } from './lib/session.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i+1] && !argv[i+1].startsWith('--') ? argv[i+1] : d }
const BASE = arg('base', 'http://localhost:5199')
const W = Number(arg('width', '390')), H = Number(arg('height', '844'))
const SHOTS = arg('out', '.gate-shots')

const CALL = 'probe-call-1'
const APPROVAL = 'probe-approval-1'

/** The chunks, in the order the server sends them for a held write. */
const STREAM = [
  { type: 'text-delta', delta: 'Let me put together a proper guide for that deck.' },
  {
    // The name is learned HERE — the approval chunk carries only ids. Getting
    // this wrong renders a card with no title, which is a passing-looking probe.
    type: 'tool-input-available',
    toolCallId: CALL,
    toolName: 'write_strategy_guide',
    input: { deck: 'eaae34ba-9607-49d6-a133-1a06b777d472' },
  },
  { type: 'tool-approval-request', approvalId: APPROVAL, toolCallId: CALL },
]

const { chromium } = await resolvePlaywright()
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  extraHTTPHeaders: bypassHeaders(),
})
const page = await ctx.newPage()

await page.route('**/api/chat', async (route) => {
  const body = STREAM.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  await route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    body,
  })
})

await signIn(page, BASE, qaAccount())
await unlockDeckE(page)
await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded' })
const composer = await openDeckE(page)
// The entrance's own park has to land before anything here is a measurement of
// where he STANDS rather than of where he is passing through.
await page.waitForTimeout(6000)

await composer.fill('write me a strategy guide for my slowking deck')
await composer.press('Enter')

// The card, then his re-park: `MARK_SETTLE_MS` of debounce plus the flight.
// Waited on by LANDMARK rather than by title: the title is composed from
// `APPROVAL_PHRASE`, and a probe that waits on a sentence fails whenever
// somebody rewords a dialog it is not testing.
// `--control` measures the SAME two boxes on a build that predates the
// landmark, so "he used to be 101px into the card" is a reading rather than an
// inference. The card is found by its Leave-it button's card instead.
// The CONTROL measures the same two boxes on a build that predates the
// landmark, so "he used to be N px into the card" is a reading rather than an
// inference. There it waits on the composer's Stop button clearing instead,
// and finds the card by walking up from its Leave-it button.
const CONTROL = argv.includes('--control')
const CARD_SEL = CONTROL ? '[data-decke-approval-control]' : '[data-decke-approval]'
if (CONTROL) {
  // `Leave it` is the plain button on every approval card and its wording is
  // pinned by `approvalPhrases.test.ts`, so this is as stable as a landmark on
  // a build that has none. Its card is two elements up: button → card → wrapper.
  const leave = page.getByRole('button', { name: /leave it/i }).first()
  await leave.waitFor({ timeout: 20_000 })
  await leave.evaluate((b) => {
    const card = b.closest('div[class*="max-w-[760px]"]') ?? b.parentElement?.parentElement
    card?.setAttribute('data-decke-approval-control', '')
  })
} else {
  await page.waitForSelector(CARD_SEL, { timeout: 20_000 })
}
await page.waitForTimeout(4000)

await page.evaluate((sel) => { window.__CARD_SEL__ = sel }, CARD_SEL)
const m = await page.evaluate(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }
  }
  // The park box IS his mark — `DeckeHost` flies him to its centre and the
  // transcript measures its top edge. Asserting against it rather than against
  // the canvas is the only way to ask this question without reading pixels out
  // of a WebGL buffer, and it is the same box every other consumer trusts.
  const park = document.querySelector('[data-decke-park]')
  const card = document.querySelector(window.__CARD_SEL__)
  return { park: box(park), card: box(card), composer: box(document.querySelector('[data-decke-composer]')) }
})

mkdirSync(SHOTS, { recursive: true })
await page.screenshot({ path: `${SHOTS}/approval-clearance-${W}x${H}.png` })

const fail = []
// DESKTOP HAS NO PARK BOX AND NEEDS NONE: above `NAV_BREAKPOINT` he parks
// BESIDE the composer, outboard of the 760px column the card lives in, so the
// two cannot overlap by construction. The screenshot is still taken — that is
// the desktop half of the verification standard — and the geometry assertion
// is the phone's.
if (!m.park && W >= 1068) {
  console.log(`SKIP — desktop parks him beside the composer, outside the card's column (${W}x${H})`)
  await browser.close()
  process.exit(0)
}
if (!m.park) fail.push('no park box — he is not standing on a mark at all')
if (!m.card) fail.push('no approval card in the DOM')
if (m.park && m.card) {
  // THE ASSERTION, and it is about the CARD being readable rather than about him
  // having moved: his box must end above where the card begins.
  if (m.park.bottom > m.card.top) {
    fail.push(`he overlaps the card by ${m.park.bottom - m.card.top}px (park bottom ${m.park.bottom}, card top ${m.card.top})`)
  }
  if (m.park.top < 0) fail.push(`the clamp failed — his head is ${-m.park.top}px off the top of the screen`)
}

console.log(JSON.stringify(m, null, 2))
if (fail.length) {
  console.error('FAIL\n  ' + fail.join('\n  '))
  await browser.close()
  process.exit(1)
}
console.log(`PASS — ${m.card.top - m.park.bottom}px of clearance between his feet and the card at ${W}x${H}`)
await browser.close()
