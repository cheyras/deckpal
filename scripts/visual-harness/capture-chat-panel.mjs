/**
 * The chat panel ITSELF, in the real app, signed in.
 *
 * ── WHY THIS EXISTS ALONGSIDE `capture-chat-ui.mjs` ──────────────────────────
 *
 * The gallery photographs every chat COMPONENT with fixtures. Two things about
 * this feature are not components and cannot appear there at all:
 *
 *   1. **Where the scrollbar is.** The transcript's scroller used to sit inside
 *      the 760px measure, so the bar was drawn down the middle of the pane with
 *      a foot of empty page to the right of it. That is a property of the
 *      PANEL's flex layout — there is no component whose photograph could show
 *      it, and it went unnoticed for the whole of the pass that shipped it.
 *   2. **The new-chat screen in its real box.** The gallery specimen fixes its
 *      own height so the centring is legible; only the panel can show whether
 *      the heading, the composer and the openers actually land in the middle of
 *      a real 1,600px pane.
 *
 * ── B12 ──────────────────────────────────────────────────────────────────────
 *
 * `pnpm dev` proxies to the LIVE backend, so this signs in as the QA account
 * from `.qa-account` and never the owner's — `lib/session.mjs` carries the full
 * reasoning. This scene OPENS the panel and photographs it. It never types and
 * never sends, so it writes nothing, but the SESSION is real either way.
 *
 * Usage:
 *   PLAYWRIGHT_MODULE=... node scripts/visual-harness/capture-chat-panel.mjs \
 *     --base http://localhost:5205
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { HOME_PATH, bypassHeaders, openDeckE, qaAccount, signIn, unlockDeckE } from './lib/session.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, '.visual-harness', 'chat-panel')

const args = process.argv.slice(2)
const baseAt = args.indexOf('--base')
const BASE = baseAt >= 0 ? args[baseAt + 1] : 'http://localhost:5199'

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1720, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]

const { chromium } = await resolvePlaywright()
const account = qaAccount()
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const wrote = []

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: vp.name === 'mobile',
    hasTouch: vp.name === 'mobile',
    extraHTTPHeaders: bypassHeaders(),
  })
  const page = await context.newPage()
  await signIn(page, BASE, account)
  await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'networkidle' })
  await unlockDeckE(context)
  await openDeckE(page)

  // He flies in and settles; the composer's FLIP and his own arrival are both
  // animations, and a frame taken mid-flight is a photograph of neither state.
  await page.waitForTimeout(6000)

  const file = path.join(OUT, `${vp.name}-empty.png`)
  await page.screenshot({ path: file })
  wrote.push(file)

  /*
    THE SCROLLBAR'S ACTUAL POSITION, MEASURED.

    A screenshot of a scrollbar is only readable when there is enough content to
    show one, and the empty panel has none. So the layout fact is read straight
    off the DOM instead: the element that scrolls should be as wide as the pane
    it sits in, not as wide as the 760px measure.
  */
  const geom = await page.evaluate(() => {
    const scroller = document.querySelector('.decke-transcript-fade')
    const panel = document.querySelector('[role="dialog"][aria-label="Chat with Deck-E"]')
    if (!scroller || !panel) return null
    const s = scroller.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    return {
      scrollerRight: Math.round(s.right),
      panelRight: Math.round(p.right),
      scrollerWidth: Math.round(s.width),
      panelWidth: Math.round(p.width),
    }
  })
  console.log(`${vp.name}: ${JSON.stringify(geom)}`)
  if (geom && geom.scrollerRight !== geom.panelRight) {
    console.log(
      `  ⚠ the scroller stops ${geom.panelRight - geom.scrollerRight}px short of the pane's right edge`,
    )
  } else if (geom) {
    console.log('  ✓ the scroller reaches the pane edge — the bar is at the window edge')
  }

  await context.close()
}

await browser.close()
console.log(`\nWrote:\n${wrote.map((w) => '  ' + w).join('\n')}`)
console.log('\nThis script asserted almost nothing. Go and look at them.')
