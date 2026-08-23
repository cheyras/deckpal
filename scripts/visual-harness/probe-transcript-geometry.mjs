/**
 * The conversation LAYOUT, without a conversation.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * The transcript is `shrink-0` while the panel is empty and `flex-1` once a
 * message exists. Those are different layouts, and only the second one has a
 * scroller that can overflow — so every geometry question about the fade band,
 * the composer overlap and the column edges is unanswerable in the empty state.
 *
 * An earlier probe injected filler into the EMPTY transcript and reported a
 * scroller running from y=-368 to y=1278 in a 900px viewport. Those numbers were
 * real and described a layout the product never renders. It is the third time
 * this pass an instrument has produced confident nonsense.
 *
 * So this fulfils `/api/chat` with a canned SSE stream instead. The request
 * never leaves the browser, no model runs, and no meter is spent — but the REAL
 * component takes the REAL path into the REAL non-empty layout.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/visual-harness/probe-transcript-geometry.mjs
 *
 * Exits non-zero when content is being eaten by the mask or the columns do not
 * line up.
 */
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { signIn, bypassHeaders, qaAccount, openDeckE, unlockDeckE, HOME_PATH } from './lib/session.mjs'
import { stripDevChrome } from './lib/dev-chrome.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i+1] && !argv[i+1].startsWith('--') ? argv[i+1] : d }
const BASE = arg('base', 'http://localhost:5204')
const W = Number(arg('width', '1440')), H = Number(arg('height', '900'))

/** Enough prose to overflow, in his voice, so the wrap is realistic. */
const REPLY = Array.from({ length: 60 }, (_, i) =>
  `Line ${i + 1}: here is a sentence about your collection that is long enough to wrap the way a real answer wraps in this column. `,
).join('')

const { chromium } = await resolvePlaywright()
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, extraHTTPHeaders: bypassHeaders() })
const page = await ctx.newPage()

// FULFIL, never hit the network. The meter is untouched and the model never runs.
await page.route('**/api/chat', async (route) => {
  const body = REPLY.match(/.{1,60}/g)
    .map((d) => `data: ${JSON.stringify({ type: 'text-delta', delta: d })}\n\n`)
    .join('') + 'data: [DONE]\n\n'
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
await page.waitForTimeout(5500)

await composer.fill('show me something long enough to scroll')
await composer.press('Enter')
await page.waitForTimeout(2500)
await stripDevChrome(page)

const m = await page.evaluate(() => {
  const sc = document.querySelector('.decke-transcript-fade')
  if (!sc) return { error: 'no faded scroller' }
  const inner = sc.firstElementChild
  sc.scrollTop = sc.scrollHeight
  const kids = [...inner.children].filter((k) => k.getBoundingClientRect().height > 0)
  const last = kids[kids.length - 1]
  const card = document.querySelector('.decke-composer-card')
  const box = (e) => (e ? e.getBoundingClientRect().toJSON() : null)
  return {
    empty: kids.length === 0,
    // THE CONTENT EDGES, not the padded container. The column is `max-w-760`
    // with `px-16`, so its BOX is 32px wider than anything drawn in it — an
    // earlier run of this probe compared box to composer and reported a 16px
    // misalignment that does not exist on screen.
    innerContent: (() => {
      const cs = getComputedStyle(inner), r = inner.getBoundingClientRect()
      return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) }
    })(),
    // The widest ASSISTANT bubble, which is the thing whose right edge the
    // reader actually compares against the composer.
    bubble: (() => {
      const all = [...inner.querySelectorAll('.decke-bubble')]
      if (!all.length) return null
      const w = all.reduce((a, b) => (b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a))
      return w.getBoundingClientRect().toJSON()
    })(),
    fade: parseFloat(getComputedStyle(sc).getPropertyValue('--decke-fade')) || 0,
    pad: getComputedStyle(inner).paddingBottom,
    scroller: box(sc), inner: box(inner), last: box(last), composer: box(card),
    lastTag: last ? `${last.tagName}.${last.className.split(' ')[0] ?? ''}` : null,
    kidCount: kids.length,
    scrollTop: sc.scrollTop, scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight,
    viewportH: window.innerHeight,
    overflowing: sc.scrollHeight > sc.clientHeight + 1,
  }
})
if (m.error) { console.log(m.error); await browser.close(); process.exit(1) }

const fails = []
const n = (x) => x.toFixed(0).padStart(6)
console.log(`viewport ${W}x${H}   transcript overflowing: ${m.overflowing}`)
console.log(`scroller   top ${n(m.scroller.top)}  bottom ${n(m.scroller.bottom)}`)
console.log(`composer   top ${n(m.composer.top)}  bottom ${n(m.composer.bottom)}`)
console.log(`inner col  left ${n(m.inner.left)}  right ${n(m.inner.right)}`)
console.log(`composer   left ${n(m.composer.left)}  right ${n(m.composer.right)}`)
console.log(`fade ${m.fade}px   inner padding-bottom ${m.pad}`)
console.log(`inner      top ${n(m.inner.top)}  bottom ${n(m.inner.bottom)}   (${m.kidCount} children)`)
console.log(`last child ${m.lastTag}  bottom ${n(m.last.bottom)}   maskTop ${n(m.scroller.bottom - m.fade)}`)
console.log(`scroll     top ${n(m.scrollTop)}  height ${n(m.scrollHeight)}  client ${n(m.clientHeight)}`)

// 1. THE SCROLLER MUST BE INSIDE THE VIEWPORT. If it is not, every other
//    number here describes a layout nobody sees.
if (m.scroller.bottom > m.viewportH + 1 || m.scroller.top < -1) {
  fails.push(`scroller runs outside the viewport (${m.scroller.top.toFixed(0)}..${m.scroller.bottom.toFixed(0)} in ${m.viewportH}px)`)
}
// 2. NOTHING RESTS INSIDE THE MASK. A mask removes pixels; content inside the
//    band is deleted, not softened.
const maskTop = m.scroller.bottom - m.fade
if (m.last && m.last.bottom > maskTop + 0.5) {
  fails.push(`the last message runs ${(m.last.bottom - maskTop).toFixed(0)}px into the mask and is being cut`)
}
// 3. THE COLUMNS LINE UP. "These aren't lined up — this edge and this edge."
const dl = Math.abs(m.composer.left - m.innerContent.left), dr = Math.abs(m.composer.right - m.innerContent.right)
if (dl > 1) fails.push(`transcript/composer left edges differ by ${dl.toFixed(0)}px`)
if (dr > 1) fails.push(`transcript/composer right edges differ by ${dr.toFixed(0)}px`)
if (m.bubble) {
  const bd = m.composer.right - m.bubble.right
  console.log(`widest bubble  left ${n(m.bubble.left)}  right ${n(m.bubble.right)}   (composer right ${n(m.composer.right)})`)
  if (bd > 1) fails.push(`a full-width reply stops ${bd.toFixed(0)}px short of the composer's right edge`)
}

console.log('')
if (fails.length === 0) console.log('  ok — nothing cut, columns aligned')
else for (const f of fails) console.log(`  FAIL — ${f}`)
await browser.close()
process.exit(fails.length ? 1 : 0)
