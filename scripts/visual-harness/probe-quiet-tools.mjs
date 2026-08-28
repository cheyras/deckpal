/**
 * DOES THE TRANSCRIPT TELEGRAPH AN ANIMATION?
 *
 * ── THE RULING ───────────────────────────────────────────────────────────────
 *
 * *"The 'change how he looks' commands don't need to be telegraphed to the user
 * ever."* — 2026-08-27, filed against a recorded turn whose entire content was
 * feedback and which came back with `Change how he looks · applied 1
 * command(s)` above the reply.
 *
 * It is the `express` tool's own contract, stated in its description: *"The
 * user never sees these commands — only your words and the animation."*
 *
 * ── WHY A BROWSER AND NOT A UNIT TEST ────────────────────────────────────────
 *
 * The fix has two halves in two tiers — the server stopped emitting the chip
 * (`decke/tools.ts`) and the client refuses to draw one (`lookupRecord.ts`'s
 * `NOT_SHOWN`). `legWiring.test.ts` pins both by reading their source. Neither
 * of those runs the client-side half: this drives the REAL chip through the
 * REAL stream and asks the DOM.
 *
 * The stream carries BOTH kinds of chip on purpose. A probe that only sends
 * `express` and finds no row cannot tell "the guard worked" from "chips are
 * broken", so a `decks` chip goes with it and must still be drawn.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/visual-harness/probe-quiet-tools.mjs
 */
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { signIn, bypassHeaders, qaAccount, openDeckE, unlockDeckE, HOME_PATH } from './lib/session.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i+1] && !argv[i+1].startsWith('--') ? argv[i+1] : d }
const BASE = arg('base', 'http://localhost:5199')
const W = Number(arg('width', '390')), H = Number(arg('height', '844'))

/** Exactly the pair the recorded turn produced, in the order it produced them. */
const STREAM = [
  { type: 'data-decke-tool', data: { id: 'c-express', name: 'express', title: 'Change how he looks', phase: 'ok', summary: 'applied 1 command(s)' } },
  { type: 'data-decke-tool', data: { id: 'c-decks', name: 'decks', title: 'Browse decks', phase: 'ok', summary: 'Toolbox Slowking | 60 cards' } },
  { type: 'text-delta', delta: 'thanks for the feedback!' },
]

const { chromium } = await resolvePlaywright()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, extraHTTPHeaders: bypassHeaders() })
const page = await ctx.newPage()

await page.route('**/api/chat', async (route) => {
  const body = STREAM.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body })
})

await signIn(page, BASE, qaAccount())
await unlockDeckE(page)
await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded' })
const composer = await openDeckE(page)
await page.waitForTimeout(5500)

// The prompt deliberately does NOT contain the reply's words: the history menu
// renders the question too, and waiting on a string that appears in both waits
// on the wrong element.
await composer.fill('flagging this for a future improvement agent')
await composer.press('Enter')
await page.locator('.decke-bubble', { hasText: 'thanks for the feedback!' }).first().waitFor({ timeout: 20_000 })
await page.waitForTimeout(1500)

const seen = await page.evaluate(() =>
  [...document.querySelectorAll('li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean),
)

const leaked = seen.filter((t) => /change how he looks/i.test(t))
const kept = seen.filter((t) => /browse decks/i.test(t))

console.log(JSON.stringify({ rows: seen, leaked, kept }, null, 2))
await browser.close()

if (leaked.length) {
  console.error(`FAIL — the animation was telegraphed: ${leaked.join(' | ')}`)
  process.exit(1)
}
if (!kept.length) {
  console.error('FAIL — the control row is missing too, so this proves nothing about the guard')
  process.exit(1)
}
console.log(`PASS — the animation drew no row; the lookup beside it still did (${W}x${H})`)
