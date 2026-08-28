/**
 * DOES THE CHAT BAR STOP MOVING WHEN THE KEYBOARD DOES?
 *
 * ── THE COMPLAINT, REPORTED TWICE ────────────────────────────────────────────
 *
 * *"I'm still seeing that downward drift happening after the keyboard is
 * dismissed. The chat bar goes down most of the way with the keyboard, but then
 * it slowly animates downward until it hits its final resting place."*
 *
 * The panel is `fixed bottom-0`; iOS does not shrink the layout viewport for a
 * keyboard; WebKit scrolls the held document to reveal the composer, and every
 * fixed layer rides that scroll — then rides the ANIMATED unwind back down once
 * the keyboard has gone. `keyboardInset.ts` removes the reason for the
 * reveal-scroll, so there is no unwind to watch.
 *
 * ── HOW A HEADLESS BROWSER IS MADE TO HAVE A KEYBOARD ────────────────────────
 *
 * It cannot have one. What it CAN have is the only thing the fix reads: a
 * `visualViewport` whose height shrinks and grows. Those getters are overridden
 * on the real object and its real `resize` event is dispatched, so the
 * component's own listener, its own `requestAnimationFrame` coalescing and its
 * own React render all run exactly as they do on the phone.
 *
 * That is honest about what it proves and what it does not:
 *
 *   PROVEN — the panel's floor tracks the visual viewport, it lands in one step
 *   rather than sliding, and it is STILL once the events stop.
 *
 *   NOT PROVEN — WebKit's reveal-scroll itself, which no engine but WebKit
 *   performs and no headless browser performs at all. The unit tests pin the
 *   arithmetic against the numbers `character/viewport.ts` measured on real
 *   hardware; this pins the wiring.
 *
 * The keyboard is 268px because that is what the iPhone in `viewport.ts`
 * measured (canvas 0..760 down, -268..492 up).
 *
 *   PLAYWRIGHT_MODULE=… node scripts/visual-harness/probe-keyboard-settle.mjs
 *
 * Exits non-zero if the bar fails to clear the keyboard, or if it is still
 * moving after the last viewport event.
 */
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { signIn, bypassHeaders, qaAccount, openDeckE, unlockDeckE, HOME_PATH } from './lib/session.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const BASE = arg('base', 'http://localhost:5199')
const W = Number(arg('width', '390'))
const H = Number(arg('height', '844'))
/** The measured iPhone keyboard. */
const KB = Number(arg('keyboard', '268'))
/** How long after the last viewport event the bar must already be at rest. */
const SETTLE_MS = Number(arg('settle', '2000'))
const CONTROL = argv.includes('--control')

const { chromium } = await resolvePlaywright()
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  extraHTTPHeaders: bypassHeaders(),
})
const page = await ctx.newPage()

// No model, no meter — the same canned-stream trick the other probes use.
await page.route('**/api/chat', async (route) => {
  const body =
    `data: ${JSON.stringify({ type: 'text-delta', delta: 'Short answer, so the panel has a transcript.' })}\n\n` +
    'data: [DONE]\n\n'
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
await page.waitForTimeout(6000)
await composer.fill('say something short')
await composer.press('Enter')
await page.waitForTimeout(3000)

/** Install the fake keyboard. Real object, real event, overridden getters. */
await page.evaluate(() => {
  const vv = window.visualViewport
  if (!vv) throw new Error('no visualViewport in this browser — the probe cannot run')
  const real = vv.height
  window.__kb = 0
  Object.defineProperty(vv, 'height', { configurable: true, get: () => real - window.__kb })
  window.__setKb = (px) => {
    window.__kb = px
    vv.dispatchEvent(new Event('resize'))
  }
})

const barTop = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-decke-composer]')
    return el ? Math.round(el.getBoundingClientRect().top) : null
  })

/**
 * And where HE is standing, because the bar is only half the picture.
 *
 * The park box lives inside the panel, so a panel that lifts correctly and
 * leaves the character behind is a different defect wearing the same clothes —
 * and it is the one the reader would notice first, since he is the thing
 * moving on screen.
 */
const parkTop = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-decke-park]')
    return el ? Math.round(el.getBoundingClientRect().top) : null
  })

const restTop = await barTop()
const restPark = await parkTop()

// ── UP ───────────────────────────────────────────────────────────────────────
await page.evaluate((px) => window.__setKb(px), KB)
await page.waitForTimeout(400)
const upTop = await barTop()
const upPark = await parkTop()

// ── DOWN, and then WATCH ─────────────────────────────────────────────────────
//
// The defect is entirely in what happens AFTER the last event: on the phone the
// keyboard's own animation ends and the bar keeps going. So the samples that
// matter are the ones taken once nothing else is happening.
await page.evaluate(() => window.__setKb(0))
await page.waitForTimeout(250)
const settleStart = await barTop()
const samples = []
for (let t = 0; t < SETTLE_MS; t += 250) {
  await page.waitForTimeout(250)
  samples.push(await barTop())
}

const drift = Math.max(...samples.map((s) => Math.abs(s - settleStart)))
const lifted = restTop - upTop
const parkLifted = restPark !== null && upPark !== null ? restPark - upPark : null

console.log(
  JSON.stringify(
    { viewport: `${W}x${H}`, keyboardPx: KB, restTop, upTop, lifted, restPark, upPark, parkLifted, settleStart, samples, drift },
    null,
    2,
  ),
)
await browser.close()

const fail = []
if (CONTROL) {
  // The control run asserts the DEFECT is present: without the fix the panel
  // does not answer the visual viewport at all, so the bar never lifts and the
  // composer would be behind the keyboard — which is why the phone needs
  // WebKit's reveal-scroll, which is what drifts.
  if (lifted !== 0) fail.push(`control expected an unresponsive bar, but it lifted ${lifted}px`)
  console.log(
    fail.length ? '' : `CONTROL — the bar ignored a ${KB}px keyboard (lifted ${lifted}px), which is the state that needs the reveal-scroll`,
  )
} else {
  // ONE: it clears the keyboard, which is what makes pinning the scroll safe.
  if (Math.abs(lifted - KB) > 2) fail.push(`the bar lifted ${lifted}px for a ${KB}px keyboard`)
  // TWO: and it is ALREADY at rest a quarter-second after the last event, and
  // stays there. This is the reported defect, stated as a measurement.
  if (drift > 1) fail.push(`the bar was still moving after the keyboard left: ${drift}px of drift across ${SETTLE_MS}ms`)
  // THREE: and he came up with it. His mark is inside the panel, so a panel
  // that lifts while he stays put is the same complaint from the other side.
  if (parkLifted === null) fail.push('no park box — he is not standing on a mark at all')
  else if (Math.abs(parkLifted - KB) > 2) fail.push(`he moved ${parkLifted}px for a ${KB}px keyboard`)
}

if (fail.length) {
  console.error('FAIL\n  ' + fail.join('\n  '))
  process.exit(1)
}
if (!CONTROL) {
  console.log(`PASS — cleared a ${KB}px keyboard exactly, and 0px of drift across ${SETTLE_MS}ms after it left`)
}
