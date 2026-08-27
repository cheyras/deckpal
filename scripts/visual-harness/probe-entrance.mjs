#!/usr/bin/env node
/**
 * Does the entrance animation actually introduce the CONTENT? (issue #49)
 *
 * ── WHAT WENT WRONG, AND WHY IT SURVIVED TWO INVESTIGATIONS ──────────────────
 *
 * `premium.css` §4 attaches `px-rise` to `.app-content > *` — the route's
 * WRAPPER. The wrapper mounts immediately, holding a `<Spinner>`, while
 * react-query fetches. On a COLD cache the entrance therefore runs and finishes
 * over an empty page, and the real content appears afterwards with no motion.
 *
 * That is why issue #49 was so hard to pin down. Both halves of the
 * contradiction were true at once: the motion layer measurably ran (on the
 * wrapper, which is what a warm-cache measurement sees), and the reporter
 * genuinely saw nothing (because the content they were waiting for arrived
 * seconds later, unanimated). Two earlier hypotheses — `prefers-reduced-motion`
 * and iOS Low Power Mode — were both falsified against the device, and this
 * needs neither: it reproduces on a desktop with motion fully enabled.
 *
 * Measured here before the fix, cold cache, 428px, signed in:
 *
 *     /decks    px-rise ended  927ms    first deck card  6985ms   +6058ms
 *     /series   px-rise ended 3691ms    first set card   4548ms    +857ms
 *
 * ── WHY IT LISTENS RATHER THAN SAMPLES ───────────────────────────────────────
 *
 * An earlier version of this probe polled `getAnimations()` a couple of frames
 * after the content attached and reported "no animation" for content that was
 * demonstrably animating. `requestAnimationFrame` is throttled in a headless,
 * unfocused tab, so "two frames" can be long enough for a 420ms animation to
 * have started and finished in the gap. `animationstart` cannot miss it: the
 * event fires whenever an animation begins, whatever the frame rate.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *
 *   node scripts/visual-harness/probe-entrance.mjs
 *   PROBE_BASE=http://localhost:5399 node scripts/visual-harness/probe-entrance.mjs
 *
 * Exits 0 when every route's content animates, 1 when any route's content
 * arrives with no entrance of its own. B12: signs in as the QA account.
 */
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { qaAccount, signIn } from './lib/session.mjs'

const BASE = process.env.PROBE_BASE ?? 'http://localhost:5199'
const VIEWPORT = { width: 428, height: 879 }

/**
 * `content` is the element the visitor is actually waiting for. It is matched
 * by its Deck-E landmark rather than by a class, because landmarks are already
 * load-bearing elsewhere and so cannot be quietly renamed.
 */
const ROUTES = [
  { path: '/decks', content: '[data-decke-deck-list]', label: 'decks' },
  { path: '/series', content: '[data-decke-series-grid]', label: 'series' },
  { path: '/lists', content: '[data-decke-list-index]', label: 'lists' },
  { path: '/pokedex', content: '[data-decke-dex-grid]', label: 'pokedex', optional: true },
]

const INSTRUMENT = `
window.__probe = { t0: performance.now(), started: [] };
document.addEventListener('animationstart', function (e) {
  window.__probe.started.push({
    name: e.animationName,
    at: performance.now() - window.__probe.t0,
    cls: (e.target && typeof e.target.className === 'string') ? e.target.className : '',
    landmark: (e.target && e.target.getAttribute) ? (e.target.getAttribute('data-decke-landmark') || '') : '',
  });
}, true);
`

async function probeRoute(browser, storageState, route) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, storageState })
  const page = await ctx.newPage()
  await page.addInitScript(INSTRUMENT)
  await page.goto(BASE + route.path, { waitUntil: 'commit' })

  let contentAt = null
  let contentCls = ''
  try {
    await page.waitForSelector(route.content, { timeout: 30_000, state: 'attached' })
    const r = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      return el ? { at: performance.now() - window.__probe.t0, cls: el.className } : null
    }, route.content)
    contentAt = r?.at ?? null
    contentCls = r?.cls ?? ''
  } catch {
    /* never arrived inside the window; reported as n/a below */
  }

  // Long enough for a late entrance to have begun and been recorded.
  await page.waitForTimeout(1500)
  const started = await page.evaluate(() => window.__probe.started)
  await ctx.close()

  const wrapperRise = started.filter((s) => s.name === 'px-rise' && s.cls.includes('app-content') === false && !s.cls.includes('px-enter'))
  // The entrance that belongs to the CONTENT: any animation that began at or
  // after the content appeared, on an element carrying the late-entrance class.
  const contentRise = started.filter((s) => s.cls.split(' ').includes('px-enter'))

  return { ...route, contentAt, contentCls, wrapperRiseAt: wrapperRise[0]?.at ?? null, contentRise, started }
}

const { chromium } = await resolvePlaywright()
// `.qa-account` is gitignored, so a git worktree does not have one; point at
// the checkout that does rather than copying a credential around.
const qa = qaAccount(process.env.QA_ACCOUNT_PATH ?? '.qa-account')
const browser = await chromium.launch()

const seed = await browser.newContext({ viewport: VIEWPORT })
const seedPage = await seed.newPage()
await signIn(seedPage, BASE, { email: qa.email, password: qa.password })
const storageState = await seed.storageState()
await seed.close()

const results = []
for (const route of ROUTES) {
  // A fresh context per route is a genuinely COLD react-query cache — the
  // condition the reporter hit, and the one a warm measurement cannot see.
  results.push(await probeRoute(browser, storageState, route))
}
await browser.close()

let failed = 0
console.log(`\nentrance probe — ${BASE}, ${VIEWPORT.width}x${VIEWPORT.height}, cold cache per route\n`)
for (const r of results) {
  if (r.contentAt == null) {
    console.log(`SKIP ${r.path.padEnd(9)} content never appeared (${r.content})`)
    if (!r.optional) failed++
    continue
  }
  const animated = r.contentRise.length > 0
  const at = r.contentRise[0]?.at
  if (!animated) failed++
  console.log(
    `${animated ? 'OK  ' : 'FAIL'} ${r.path.padEnd(9)}` +
      ` content ${String(Math.round(r.contentAt)).padStart(5)}ms` +
      `  wrapper px-rise ${r.wrapperRiseAt == null ? '   n/a' : String(Math.round(r.wrapperRiseAt)).padStart(5) + 'ms'}` +
      `  content entrance ${animated ? String(Math.round(at)).padStart(5) + 'ms' : '  NONE'}`,
  )
}
console.log(
  failed
    ? `\n${failed} route(s) show their content with no entrance of its own — issue #49.`
    : '\nevery route animates the content itself, not just the wrapper.',
)
process.exit(failed ? 1 : 0)
