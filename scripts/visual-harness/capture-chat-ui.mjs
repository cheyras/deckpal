/**
 * Photograph `/dev/chat-ui` — every chat surface at once — at both widths.
 *
 * ── WHY A SEPARATE SCRIPT ────────────────────────────────────────────────────
 *
 * `capture-decke.mjs` drives the CHARACTER: it opens him, waits for a 3D runtime,
 * records video, and every scene it has is about a conversation happening. The
 * gallery is the opposite — a static page with no character on it — so a scene
 * there would inherit a pile of waiting it does not need.
 *
 * This is deliberately dumb: sign in, go to the page, let the card art load,
 * shoot it whole, and shoot each section on its own so a reviewer can look at
 * one component without scrolling a 6000px image.
 *
 *   PLAYWRIGHT_MODULE=…/node_modules/playwright \
 *     node scripts/visual-harness/capture-chat-ui.mjs --base http://localhost:5204
 *
 * Base must be `localhost`, not `127.0.0.1` — vite binds IPv6.
 *
 * ── IT HIDES THE DEV RIBBON, AND THAT IS NOT COSMETIC ────────────────────────
 *
 * `DevBackendRibbon` is `fixed bottom-0 z-[9999]` and sits across the bottom of
 * every shot. It already caused one false bug report — "the composer is cut off
 * at the bottom" was the ribbon, not the composer. A screenshot with dev chrome
 * in it is a screenshot that will be reviewed as if it were the product.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { signIn, bypassHeaders, qaAccount } from './lib/session.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const BASE = arg('base', 'http://localhost:5204')
const OUT = resolve(arg('out', '.visual-harness/chat-ui'))

/** Sections on the page, by their `id`. Each gets its own shot. */
const SECTIONS = ['thinking', 'tool-rows', 'markdown', 'screens', 'approval', 'flow']

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 },
]

const { chromium } = await resolvePlaywright()
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const wrote = []

for (const w of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width: w.width, height: w.height },
    deviceScaleFactor: w.deviceScaleFactor ?? 2,
    isMobile: !!w.isMobile,
    hasTouch: !!w.isMobile,
    extraHTTPHeaders: bypassHeaders(),
  })
  const page = await context.newPage()
  await signIn(page, BASE, qaAccount())

  await page.goto(`${BASE}/dev/chat-ui`, { waitUntil: 'domcontentloaded' })
  // The gallery's own width toggle, so the components lay out the way they
  // would at that width even though the browser is already that size — the
  // page constrains its frame independently.
  await page.getByRole('button', { name: new RegExp(`^${w.name}`, 'i') }).click()

  // CARD ART IS THE POINT of several of these sections, and an unloaded
  // thumbnail is a grey box that a reviewer will correctly call ugly. Wait for
  // the images to actually decode rather than for a fixed delay.
  await page
    .waitForFunction(
      () => {
        const imgs = [...document.images]
        return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0)
      },
      { timeout: 20_000 },
    )
    .catch(() => {})
  // Kill the dev ribbon — see the header.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('div')) {
      if (el.textContent?.startsWith('LIVE DATA ·') && getComputedStyle(el).position === 'fixed') {
        el.remove()
      }
    }
  })
  await page.waitForTimeout(600)

  const dir = `${OUT}/${w.name}`
  mkdirSync(dir, { recursive: true })

  const full = `${dir}/all.png`
  await page.screenshot({ path: full, fullPage: true })
  wrote.push(full)

  for (const id of SECTIONS) {
    const el = page.locator(`#${id}`)
    if (!(await el.count())) continue
    const path = `${dir}/${id}.png`
    await el.screenshot({ path }).catch(() => {})
    wrote.push(path)
  }

  await context.close()
}

await browser.close()

writeFileSync(
  `${OUT}/notes.json`,
  JSON.stringify({ base: BASE, widths: WIDTHS.map((w) => w.name), sections: SECTIONS, wrote }, null, 2),
)

console.log(`\nChat UI gallery captured under ${OUT}`)
for (const p of wrote) console.log(`  ${p}`)
console.log('\nThis script asserted NOTHING. Go and look at them.')
