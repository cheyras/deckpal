/**
 * "Show me my Charizard", driven through the real app, with the character in it.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * Deck-E taking someone to a thing was "fixed" many times and kept coming back,
 * and the reason is on record: every one of those fixes was verified by a probe
 * someone ran by hand, once (`scripts/visual-harness/`), and nothing in CI ever
 * watched him move. The only Deck-E check here asserted where he STOOD, never
 * how he got there. So a regression in an already-fixed motion defect had no
 * tripwire, and the owner was the regression suite.
 *
 * This is that tripwire. It serves the real built app, lets the real chat hook
 * run a scripted `goTo`, and records every frame: the page's scroll, his box on
 * screen, the target's box, the ring. Then it asserts the invariants that make
 * the trip read as ONE motion — the ones each earlier bug broke:
 *
 *   - ONE scroll owner: at most one jump (the long throw) and one glide, with
 *     bounded pixel settling, never a substantial reversal. Two glides was
 *     the grid scrolling itself, then his flight again.
 *   - NO SNAPS: his drawn position never moves further in one frame than a fast
 *     flight can (the composer drag was 274 px; the stale second leg 667 px).
 *   - HE LANDS BESIDE IT: at the moment the ring appears he is within a few
 *     pixels of the card (he used to park 460 px below it).
 *   - THE ANSWER FOLLOWS THE ACT: the model's next leg is requested only after
 *     the ring is up, because the tool now answers when he lands.
 *   - A MISSING CARD FAILS FAST, a READER'S SCROLL is honoured, and REDUCED
 *     MOTION arrives with no glide at all.
 *
 * ── HOW IT STEPS HIM ─────────────────────────────────────────────────────────
 *
 * Headless browsers draw WebGL in software, and at whatever rate they manage.
 * So the engine's own loop is stopped and he is advanced by exactly 1/60 s per
 * animation frame WITHOUT DRAWING (`DeckE.simulate`: `step` minus the GPU
 * work). Every per-frame number below is therefore a 60 Hz number whatever the
 * machine, and "time" in the budgets is ENGINE time. Real-time budgets are
 * measured on a real GPU and reported in the PR, not asserted here. For the
 * same reason no assertion here is a wall-clock bound.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { webkit } from 'playwright'
import { buildWeb, contextFor, serve, run, ROOT } from './support.mjs'
import { adminFixture, signIn } from './admin.mjs'
import { analyseScroll, MAX_SETTLING_PX } from './deckeShowScroll.mjs'

const USER = '10000000-0000-4000-8000-000000000002'
const NOW = '2026-09-12T18:00:00Z'
const CHARIZARD = '[data-decke-card="sim1-199"]'
/** Four cards in one row of Simulator Set 7, below the fold at 1280. */
const WALK_CARDS = ['sim7-029', 'sim7-030', 'sim7-031', 'sim7-032']

// ── the catalog: one set big enough that the card is far down a virtual grid ──

const NAMES = ['Bulbasaur', 'Ivysaur', 'Venusaur', 'Charmander', 'Squirtle', 'Pikachu', 'Raichu', 'Vulpix', 'Meowth', 'Psyduck']
const SETS = Array.from({ length: 9 }, (_, i) => ({ setId: 'sim' + (i + 1), name: 'Simulator Set ' + (i + 1), size: i === 0 ? 250 : 40 }))
const prog = (owned, total) => ({ owned, total, pct: Math.round((owned / total) * 100) })
const progress = (s) => ({ complete: prog(Math.floor(s.size / 3), s.size), master: prog(Math.floor(s.size / 3), s.size), grandmaster: prog(Math.floor(s.size / 3), s.size) })
function card(setId, n) {
  const number = String(n).padStart(3, '0')
  const have = n % 3 === 0
  return {
    cardId: setId + '-' + number, number, numberSort: number, name: n === 199 ? 'Charizard ex' : NAMES[n % NAMES.length],
    category: 'Pokémon', rarity: 'Rare', artist: 'Fixture Artist', variantCount: 1,
    images: { low: '/__fixture/card/' + n + '.svg', high: '/__fixture/card/' + n + '.svg' },
    price: { market: 1 + (n % 17), low: 1, mid: 2, high: 3, currency: 'USD' },
    ownership: { totalQuantity: have ? 1 : 0, requiredCount: 1, ownedRequired: have ? 1 : 0, have, need: !have, dupe: false },
    standardVariants: [{ variantId: 10000 + n, kind: 'normal', displayName: 'Normal', tier: 'standard', quantity: have ? 1 : 0 }],
    seriesSlug: 'sim', setId,
  }
}
const setSummary = (s) => ({ setId: s.setId, slug: s.setId, name: s.name, releasedOn: NOW, isPromo: false, printedCount: s.size, secretCount: 0, cardCountTotal: s.size, logoUrl: null, symbolUrl: null, progress: progress(s) })
const SERIES = { slug: 'sim', tcgdexId: 'sim', name: 'Simulator Series', firstReleaseOn: NOW, sortOrder: 1, setCount: SETS.length, cardCount: 570, repSetId: null, repHasLogo: false, repHasSymbol: false, progress: prog(190, 570) }

const say = (delta) => ({ type: 'text-delta', delta })
const call = (toolCallId, toolName, input) => ({ type: 'tool-input-available', toolCallId, toolName, input })
const sse = (chunks) => chunks.map((c) => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n'

/** The catalog and a SCRIPTED chat, layered over the admin fixture's account. */
export function showFixture(mount, admin) {
  const legs = [], bodies = []
  const response = (rel, url, req) => {
    if (req.method === 'GET') {
      const art = rel.match(/^\/__fixture\/card\/(\d+)\.svg$/)
      if (art) {
        const n = Number(art[1])
        return { raw: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"><rect width="200" height="280" rx="12" fill="hsl(' + ((n * 47) % 360) + ' 55% 45%)"/></svg>', type: 'image/svg+xml' }
      }
      // Set logos and symbols are looked up by id on both image tiers; this
      // catalog has none, and saying so is what the real tiers do too.
      if (/^\/(storage\/v1\/object\/public\/card-art|deckpal\/images)\/sets\/[^/]+\/(logo|symbol)\.webp$/.test(rel)) {
        return { status: 404, raw: '', type: 'text/plain' }
      }
      // A widget's card grid asks for each card's art by id.
      const one = rel.match(/^\/api\/cards\/((sim\d+)-(\d+))$/)
      if (one) {
        const c = card(one[2], Number(one[3]))
        return { body: { card: { ...c, set: { setId: one[2], name: 'Simulator Set', slug: one[2], logoUrl: null, symbolUrl: null }, series: { slug: 'sim', name: SERIES.name, tcgdexId: 'sim' } }, variants: [] } }
      }
      if (rel === '/api/series') return { body: { series: [SERIES] } }
      if (rel === '/api/series/sim') return { body: { series: { slug: 'sim', tcgdexId: 'sim', name: SERIES.name, firstReleaseOn: NOW }, sets: SETS.map(setSummary) } }
      const set = rel.match(/^\/api\/sets\/([^/]+)$/)
      if (set) {
        const s = SETS.find((x) => x.setId === set[1])
        if (!s) return { status: 404, body: { error: { message: 'No such set' } } }
        const cards = Array.from({ length: s.size }, (_, i) => card(s.setId, i + 1))
        return { body: {
          set: { setId: s.setId, slug: s.setId, name: s.name, series: { slug: 'sim', name: SERIES.name, tcgdexId: 'sim' }, releasedOn: NOW, isPromo: false,
            printedCount: s.size, secretCount: 0, cardCountTotal: s.size, images: { logoUrl: null, symbolUrl: null, backgroundUrl: null }, marketValueUsd: 100, mostExpensiveCard: null },
          progress: progress(s), query: {}, pagination: { page: 1, pageSize: 250, total: s.size, pageCount: 1 }, cards,
        } }
      }
    }
    if (rel === '/api/chat' && req.method === 'POST') {
      bodies.push(req.body)
      return { raw: sse(legs.shift() ?? [say('')]), type: 'text/event-stream', headers: { 'x-decke-credits': '500', 'cache-control': 'no-cache' } }
    }
    if (rel === '/api/decke/history' && req.method === 'POST') return { body: { ok: true, recorded: false } }
    return null
  }
  const allowMutation = (pathname, method) => method === 'POST' && ['/api/chat', '/api/decke/history'].includes(pathname.slice(mount.length))
  return {
    response, allowMutation, bodies,
    /** Queue the model's legs for the next question. */
    script(next) { legs.length = 0; legs.push(...next); bodies.length = 0 },
    /** What the browser sent back for its client tools, leg by leg. */
    toolOutputs() {
      return bodies.slice(1).flatMap((b) => (b.messages?.at(-1)?.parts ?? []).filter((p) => /^tool-/.test(p.type ?? '')).map((p) => p.output))
    },
  }
}

// ── the recorder, installed in the page ──────────────────────────────────────

/**
 * Stops his loop and steps him 1/60 s per animation frame, recording each one.
 * Also timestamps every `/api/chat` request on the same clock as the frames.
 */
function installRecorder(target) {
  const d = window.__decke
  d.stop()
  const R = (window.__show = { frames: [], chats: [], target })
  const realFetch = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/chat')) R.chats.push(performance.now())
    return realFetch.call(this, input, init)
  }
  const box = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
  const tick = () => {
    d.simulate(1 / 60)
    const him = d.screenRect()
    const origin = d.opts.canvas.getBoundingClientRect()
    const el = R.target ? document.querySelector(R.target) : null
    const ring = document.querySelector('.decke-ring:not([data-leaving])')
    const bubble = document.querySelector('[data-decke-bubble]')
    const bubbleBox = bubble && bubble.dataset.side ? bubble.getBoundingClientRect() : null
    const s = d.getState()
    R.frames.push({
      t: performance.now(), y: Math.round(window.scrollY), viewportHeight: window.innerHeight, path: location.pathname, flying: s.flying,
      him: him ? [Math.round(him.left + origin.left), Math.round(him.top + origin.top), Math.round(him.width), Math.round(him.height)] : null,
      target: el ? box(el.getBoundingClientRect()) : null,
      ring: ring ? box(ring.getBoundingClientRect()) : null,
      bubble: bubbleBox ? [...box(bubbleBox), bubble.dataset.side, bubble.dataset.switching !== undefined] : null,
    })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// ── what a run means ──────────────────────────────────────────────────────────

const centre = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2]
/** Edge-to-edge gap between two boxes; 0 when they touch or overlap. */
const gap = (a, b) => Math.hypot(Math.max(0, a[0] - (b[0] + b[2]), b[0] - (a[0] + a[2])), Math.max(0, a[1] - (b[1] + b[3]), b[1] - (a[1] + a[3])))

export function analyse(frames) {
  const scroll = analyseScroll(frames, frames[0].viewportHeight)
  // Snaps: his centre moving further in one 1/60 s step than any flight does.
  // A character under 12 px tall is tucked into the chip, where position means
  // nothing, and so is a frame where the canvas itself was re-anchored.
  let worst = 0
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].him, b = frames[i].him
    if (!a || !b || a[3] < 12 || b[3] < 12) continue
    const [ax, ay] = centre(a), [bx, by] = centre(b)
    worst = Math.max(worst, Math.hypot(bx - ax, by - ay))
  }
  // The speech bubble riding him. Per frame, how far the edge of the bubble
  // that faces him moved relative to him: 0 is riding exactly. A frame where
  // the side itself changed is a deliberate, eased move and is counted
  // separately; docked slots are pinned to the screen by design.
  const facing = ([x, y, w, h, side]) =>
    side === 'below' || side === 'under' ? [x + w / 2, y]
    : side === 'left' ? [x + w, y + h / 2]
    : side === 'right' ? [x, y + h / 2]
    : [x + w / 2, y + h]
  let bubbleWorst = 0, sideChanges = 0, bubbleFrames = 0
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i]
    if (b.bubble) bubbleFrames++
    if (!a.bubble || !b.bubble || !a.him || !b.him || a.him[3] < 12 || b.him[3] < 12) continue
    if (a.bubble[4] !== b.bubble[4]) { sideChanges++; continue }
    // Mid-switch it is making its own eased move (bounded by `sideChanges`).
    if (a.bubble[5] || b.bubble[5] || String(b.bubble[4]).startsWith('dock')) continue
    const [ax, ay] = facing(a.bubble), [bx, by] = facing(b.bubble)
    const [hx0, hy0] = centre(a.him), [hx1, hy1] = centre(b.him)
    bubbleWorst = Math.max(bubbleWorst, Math.hypot((bx - ax) - (hx1 - hx0), (by - ay) - (hy1 - hy0)))
  }
  const ringAt = frames.findIndex((f) => f.ring)
  // Judged once the ring has had a few frames to settle in: the first frame in
  // the next forty where ring and card agree, or failing that the twelfth.
  const aligned = (f) => f.ring && f.target && Math.hypot(centre(f.ring)[0] - centre(f.target)[0], centre(f.ring)[1] - centre(f.target)[1]) < 12
  const lookAt = ringAt >= 0
    ? (frames.slice(ringAt + 4, ringAt + 44).find(aligned) ?? frames[Math.min(frames.length - 1, ringAt + 12)])
    : null
  const flightFrames = frames.filter((f) => f.flying).length
  return {
    ...scroll, worstStepPx: Math.round(worst), flightMs: Math.round((flightFrames * 1000) / 60),
    bubbleFrames, bubbleDesyncPx: Math.round(bubbleWorst), bubbleSideChanges: sideChanges,
    ringT: ringAt >= 0 ? frames[ringAt].t : null,
    ringOnTarget: !!(lookAt && aligned(lookAt)),
    besidePx: lookAt?.him && lookAt.target ? Math.round(gap(lookAt.him, lookAt.target)) : null,
  }
}

/** The fastest a flight moves him in one 1/60 s step, with headroom. */
const MAX_STEP_PX = 90
/**
 * How far the bubble may move against him in one step: the fastest frame of an
 * eased 260 ms change of side, with headroom. The 8 Hz follower it replaced
 * moved up to 668 px against him in a single frame.
 */
const MAX_BUBBLE_DESYNC_PX = 24

async function openChat(page, server) {
  await page.goto(server.origin + '/series', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Chat with Deck-E' }).click()
  await page.waitForFunction(() => !!window.__decke, null, { timeout: 60_000 })
  // From here he is SIMULATED, never drawn: his own loop stops, and the test
  // advances him 1/60 s per animation frame without rendering. Drawing this
  // scene in software was most of every frame's cost on a CI runner, and it
  // slowed the suites running alongside this one. His entrance finishes on
  // that same clock.
  await page.evaluate(() => new Promise((resolve) => {
    const d = window.__decke
    d.stop()
    let n = 0
    const tick = () => {
      d.simulate(1 / 60)
      if ((!d.getState().flying && d.entryScale > 0.99) || ++n > 900) return resolve()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
  return page.getByRole('dialog', { name: 'Chat with Deck-E' }).getByRole('textbox')
}

async function ask(page, box, question, target) {
  await page.evaluate(installRecorder, target)
  await box.fill(question)
  await box.press('Enter')
}

/**
 * Every frame recorded so far, once forty-five more have been recorded. The
 * second leg can be requested in the very task the ring is drawn in — under
 * reduced motion he arrives inside `flyTo` itself — so reading the record the
 * moment that request lands can miss the arrival it was reporting.
 */
async function frames(page) {
  await page.waitForFunction((n) => window.__show.frames.length >= n,
    (await page.evaluate(() => window.__show.frames.length)) + 45, { timeout: 60_000 })
  return page.evaluate(() => window.__show.frames)
}

/**
 * Wait for the model's second leg — the request that carries his tool results —
 * to reach the SERVER, not merely to be started in the page: the page stamps a
 * request when `fetch` is called, and the body is what the assertions read.
 */
async function secondLeg(page, fixture, timeout) {
  await page.waitForFunction(() => window.__show.chats.length >= 2, null, { timeout })
  const until = Date.now() + 10_000
  while (fixture.bodies.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
  assert.ok(fixture.bodies.length >= 2, 'the second leg never reached the server')
}

export async function checkDeckeShow(browser, server, out, engine, fixture, admin) {
  admin.state.actor = 'ordinary'
  admin.state.permissions = ['decke.use']
  admin.state.balance = 500
  const results = []
  // WebKit at phone width too: it is the engine iOS Safari runs, and the
  // bubble and scroll-drive defects both showed up first on the phone.
  const cases = [{ width: 1280 }, { width: 390, mobile: true }]
  for (const vp of cases) {
    if (engine === 'chromium' && !vp.mobile) {
      const { context, page } = await contextFor(browser, server, vp.width, { reducedMotion: 'reduce' })
      try {
        await page.goto(server.origin + '/series/sim/sim1?view=table')
        await page.waitForSelector('table[aria-rowcount="251"]')
        assert.equal(await page.locator(CHARIZARD).count(), 0, 'deep Table card should start outside the virtual window')
        const before = await page.evaluate(() => scrollY)
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('decke:reveal', {
          detail: { cardId: 'sim1-199', selector: '[data-decke-card="sim1-199"]' },
        })))
        await page.waitForSelector(CHARIZARD, { state: 'attached' })
        assert.equal(await page.evaluate(() => scrollY), before, 'Table mounts the reveal without scrolling for Deck-E')
        results.push({ case: 'decke-show-table-reveal', engine })
      } finally { await context.close() }
    }
    // ── 1. another page, far down a virtualized grid ──
    {
      const { context, page } = await contextFor(browser, server, vp.width, { reducedMotion: 'no-preference', ...(vp.mobile ? { hasTouch: true } : {}) })
      await signIn(context, USER)
      try {
        const box = await openChat(page, server)
        fixture.script([
          [say('Let me show you. '), call('go-1', 'goTo', { route: '/series/sim/sim1', selector: CHARIZARD })],
          [say('There it is.')],
        ])
        await ask(page, box, 'Show me my Charizard', CHARIZARD)
        await secondLeg(page, fixture, 90_000)
        const f = await frames(page)
        const m = analyse(f)
        fs.writeFileSync(path.join(out, 'decke-show-card-' + engine + '-' + vp.width + '.json'), JSON.stringify({ frames: f, metrics: m }, null, 2) + '\n')
        const chats = await page.evaluate(() => window.__show.chats)
        await page.screenshot({ path: path.join(out, 'decke-show-card-' + engine + '-' + vp.width + '.png') })
        const where = engine + ' ' + vp.width + ': '
        assert.deepEqual(fixture.toolOutputs(), [{ ok: true }], where + 'the goTo did not report a landing')
        assert.equal(f.at(-1).path, '/series/sim/sim1', where + 'he did not take the reader to the set')
        assert.ok(m.jumps <= 1 && m.glides <= 1, where + 'the page exceeded one throw and one glide (' + m.jumps + ' jumps, ' + m.glides + ' glides)')
        assert.ok(m.settlingPx <= MAX_SETTLING_PX, where + 'the page drifted ' + m.settlingPx + ' px outside the planned motion')
        assert.equal(m.reversals, 0, where + 'the scroll reversed direction on its own')
        assert.ok(m.worstStepPx <= MAX_STEP_PX, where + 'he snapped ' + m.worstStepPx + ' px in one frame')
        assert.ok(m.ringT !== null && m.ringOnTarget, where + 'the card was never ringed')
        assert.ok(m.besidePx !== null && m.besidePx <= 40, where + 'he landed ' + m.besidePx + ' px from the card he was showing')
        // The two-leg trip this replaced took 2.7 s; one leg is ~1.5 s (1.8 s on a phone).
        assert.ok(m.flightMs <= 2200, where + 'the flight took ' + m.flightMs + ' ms of engine time')
        // `>=`: the request is sent from the same frame the ring lands in, and
        // WebKit's coarsened clock can stamp both with the same millisecond.
        assert.ok(chats[1] >= m.ringT, where + 'the model was asked for its next line before he had arrived (' +
          JSON.stringify({ chats: chats.map(Math.round), ringT: Math.round(m.ringT), first: Math.round(f[0].t), last: Math.round(f.at(-1).t) }) + ')')
        // HIS LINE RIDES HIM. The bubble used to follow a position polled at
        // 8 Hz and re-solve its side on every poll: it moved in steps, flipped
        // mid-flight, and jumped when the arrival line was appended. Now it
        // moves with him every frame, and changes side only at its beats (when
        // it appears and when he lands), eased.
        assert.ok(m.bubbleFrames > 0, where + 'his line never appeared beside him')
        assert.ok(m.bubbleDesyncPx <= MAX_BUBBLE_DESYNC_PX, where + 'the bubble moved ' + m.bubbleDesyncPx + ' px against him in one frame')
        assert.ok(m.bubbleSideChanges <= 2, where + 'the bubble changed sides ' + m.bubbleSideChanges + ' times')
        // OUT ON THE PAGE NOTHING CLIPS HIM. His second line arrives while the
        // chat is minimised and re-runs the phone park pass; that must not put
        // back the clip at a composer that is not on screen.
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const clip = await page.evaluate(() => window.__decke.opts.canvas.style.clipPath)
        assert.equal(clip, '', where + 'out on the page he is clipped at the hidden composer (' + clip + ')')
        results.push({ case: 'decke-show-card', engine, width: vp.width, ...m, ringT: undefined })
      } finally { await context.close() }
    }
    if (engine !== 'chromium' || vp.mobile) continue
    // ── 2. a card the set does not have: the page says so at once ──
    {
      const { context, page } = await contextFor(browser, server, vp.width, { reducedMotion: 'no-preference' })
      await signIn(context, USER)
      try {
        const box = await openChat(page, server)
        fixture.script([
          [say('Let me look. '), call('go-1', 'goTo', { route: '/series/sim/sim1', selector: '[data-decke-card="sim1-999"]' })],
          [say('It is not in that set.')],
        ])
        const started = Date.now()
        await ask(page, box, 'Show me card 999', '[data-decke-card="sim1-999"]')
        await secondLeg(page, fixture, 60_000)
        const waited = Date.now() - started
        const m = analyse(await frames(page))
        const [output] = fixture.toolOutputs()
        assert.equal(output?.ok, false)
        assert.match(output?.reason ?? '', /not in this set/, 'the page\'s own "no" did not reach the model')
        // No wall-clock bound here: under CI's software WebGL a single frame can
        // take a quarter of a second. The reason IS the proof of the fast path —
        // the 6 s cap answers "I could not find that part of it" instead.
        assert.equal(m.glides, 0, 'the page scrolled toward a card that does not exist')
        results.push({ case: 'decke-show-missing', engine, waitedMs: waited })
      } finally { await context.close() }
    }
    // ── 3. the reader scrolls away mid-flight: he stops, and says so ──
    {
      const { context, page } = await contextFor(browser, server, vp.width, { reducedMotion: 'no-preference' })
      await signIn(context, USER)
      try {
        const box = await openChat(page, server)
        fixture.script([
          [say('Let me show you. '), call('go-1', 'goTo', { route: '/series/sim/sim1', selector: CHARIZARD })],
          [say('Okay.')],
        ])
        await ask(page, box, 'Show me my Charizard', CHARIZARD)
        // A quarter of the way into the glide, the reader scrolls back up.
        await page.waitForFunction(() => window.__show.frames.filter((x) => x.flying).length >= 20, null, { timeout: 60_000 })
        await page.mouse.move(640, 450)
        await page.mouse.wheel(0, -600)
        await secondLeg(page, fixture, 60_000)
        const m = analyse(await frames(page))
        const [output] = fixture.toolOutputs()
        assert.ok(m.worstStepPx <= MAX_STEP_PX, 'taking over made him snap ' + m.worstStepPx + ' px')
        // Either the card was still on screen and he reached it, or it was not
        // and he stopped short — what he must never do is report an arrival he
        // did not make, or ring a card nobody can see.
        // (Presence of the ring, not its alignment: the reader's own scroll may
        // still be animating, and the ring follows it a frame behind.)
        if (output?.ok) assert.ok(m.ringT !== null, 'reported an arrival with no ring on the card')
        else assert.match(output?.reason ?? '', /scrolled away/, 'the reader\'s scroll was not what he reported')
        results.push({ case: 'decke-show-takeover', engine, ok: !!output?.ok, worstStepPx: m.worstStepPx })
      } finally { await context.close() }
    }
    // ── 4. reduced motion: he arrives, the page arrives, nothing glides ──
    {
      const { context, page } = await contextFor(browser, server, vp.width)
      await signIn(context, USER)
      try {
        const box = await openChat(page, server)
        fixture.script([
          [say('Here. '), call('go-1', 'goTo', { route: '/series/sim/sim1', selector: CHARIZARD })],
          [say('There it is.')],
        ])
        await ask(page, box, 'Show me my Charizard', CHARIZARD)
        await secondLeg(page, fixture, 60_000)
        const m = analyse(await frames(page))
        assert.deepEqual(fixture.toolOutputs(), [{ ok: true }])
        assert.equal(m.glides, 0, 'reduced motion still glided the page')
        assert.ok(m.ringOnTarget, 'reduced motion never ringed the card: ' + JSON.stringify(m))
        assert.ok(m.besidePx !== null && m.besidePx <= 40, 'reduced motion put him ' + m.besidePx + ' px from the card')
        results.push({ case: 'decke-show-reduced', engine, ...m, ringT: undefined })
      } finally { await context.close() }
    }
    // ── 5. the escort walk completes, pointing on the way, and ENDS ON THE CARDS ──
    //
    // "Show me the pikachu ones in the app" walked to the set and stopped, and
    // he told the reader the cards were "in the grid" over a page that showed
    // none of them. Given the cards, the walk ends on them: the page brought to
    // the first, every one on screen ringed.
    {
      const { context, page } = await contextFor(browser, server, vp.width, { reducedMotion: 'no-preference' })
      await signIn(context, USER)
      try {
        const box = await openChat(page, server)
        fixture.script([
          [say('Follow me. '), call('esc-1', 'escort', { seriesSlug: 'sim', setId: 'sim7', cardIds: WALK_CARDS })],
          [say('There they are.')],
        ])
        await ask(page, box, 'Show me the Venusaur ones in Simulator Set 7', '[data-decke-card="' + WALK_CARDS[0] + '"]')
        await secondLeg(page, fixture, 90_000)
        const [output] = fixture.toolOutputs()
        // Every series here has cards collected, so the "show the rest"
        // disclosure never renders — the case that used to fail at step 1.
        assert.equal(output?.ok, true, 'the escort stopped: ' + JSON.stringify(output?.failure ?? fixture.bodies.map((b) => (b.messages?.at(-1)?.parts ?? []).map((p) => p.type))))
        assert.equal(output.ran.length, output.planned)
        // The last step presses the set's own link; the router commits it on
        // its own schedule, so wait for the address rather than sample it.
        await page.waitForURL(/\/series\/sim\/sim7$/, { timeout: 10_000 })
        const last = output.ran.at(-1)
        assert.equal(last.verb, 'flyTo', 'the walk ended before the cards')
        assert.equal(last.target, '[data-decke-card="' + WALK_CARDS[0] + '"]')
        const ringed = await page.evaluate((ids) => ids.filter((id) => {
          const el = document.querySelector('[data-decke-card="' + id + '"]')
          if (!el) return false
          const r = el.getBoundingClientRect()
          const onScreen = r.bottom > 0 && r.top < innerHeight
          return onScreen && [...document.querySelectorAll('.decke-ring:not([data-leaving])')].some((ring) => {
            const q = ring.getBoundingClientRect()
            return Math.abs(q.left + q.width / 2 - (r.left + r.width / 2)) < 12 && Math.abs(q.top + q.height / 2 - (r.top + r.height / 2)) < 12
          })
        }), WALK_CARDS)
        assert.deepEqual(ringed, WALK_CARDS, 'not every card he walked to is ringed on screen')
        results.push({ case: 'decke-show-escort', engine, steps: output.ran.length, ringed: ringed.length })
      } finally { await context.close() }
    }
  }
  return results
}

// ── the phone chat: widgets keep their width, he keeps to his latest words ──

const LONG = 'There are more V-UNION sets (Greninja, Zacian, Morpeko, etc.) — these are just two examples. Also had some promo trios in the First Partner Illustration Collection line that form regional panoramas. '
const widget = (title, ids) => ({ type: 'data-decke-screen', data: { screen: { title, blocks: [
  { kind: 'text', text: 'Four-card sets, one per quarter of a big scene. Assembled, they make one panoramic artwork.' },
  { kind: 'cardGrid', cards: ids },
] } } })
const ids = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => 'sim1-' + String(a + i).padStart(3, '0'))

/**
 * Advances him 1/60 s per frame without drawing (as `installRecorder` does) and
 * records the conversation's geometry: every widget, every one of his text
 * bubbles, his drawn box, and the clip under him.
 */
function installLayoutRecorder() {
  const d = window.__decke
  d.stop()
  const L = (window.__layout = { frames: [], scrolls: 0 })
  // Counted in the capture phase, so it sees every scroll event the transcript
  // gets whoever else is listening: for a failure message.
  document.addEventListener('scroll', () => { L.scrolls++ }, { capture: true, passive: true })
  const box = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
  const dialog = document.querySelector('[role="dialog"]')
  const tick = () => {
    d.simulate(1 / 60)
    const sc = document.querySelector('[data-decke-transcript]')
    const him = d.viewportRect()
    const canvas = d.opts.canvas
    const inset = /inset\(([^)]*)\)/.exec(canvas.style.clipPath || '')
    const cr = canvas.getBoundingClientRect()
    let floor = null
    if (inset) { const v = inset[1].split(/\s+/).map(parseFloat); floor = cr.bottom - (v.length >= 3 ? v[2] : v[0]) }
    L.frames.push({
      st: sc ? Math.round(sc.scrollTop) : null,
      him: him ? box(him) : null, floor,
      widgets: [...dialog.querySelectorAll('.decke-figure, li > ul')].map((el) => box(el.getBoundingClientRect())),
      texts: [...dialog.querySelectorAll('.decke-beside.decke-bubble, .decke-settled.decke-bubble')].map((el) => box(el.getBoundingClientRect())),
      beside: [...dialog.querySelectorAll('.decke-beside.decke-bubble')].map((el) => box(el.getBoundingClientRect())),
      settled: [...dialog.querySelectorAll('.decke-settled.decke-bubble')].map((el) => box(el.getBoundingClientRect())),
      anchor: (() => { const a = dialog.querySelector('[data-decke-anchor]'); return a ? box(a.getBoundingClientRect()) : null })(),
      // For a failure message: what he is standing on, and where the park box is.
      park: (() => { const p = document.querySelector('[data-decke-park]'); return p ? [Math.round(p.getBoundingClientRect().top), p.dataset.ride ?? null] : null })(),
      scrolls: L.scrolls,
      stn: (() => { const t = d.station; if (!t) return null; const g = t.target; return t.kind + (g ? ':' + (g.selector ?? (g.rect ? 'rect' : typeof g)) : '') })(),
    })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/** Scroll the transcript by `dy` over `n` frames, one step per frame. */
function scrollTranscript([dy, n]) {
  return new Promise((resolve) => {
    const sc = document.querySelector('[data-decke-transcript]')
    let i = 0
    const step = () => {
      sc.scrollTop += dy / n
      if (++i < n) requestAnimationFrame(step)
      else requestAnimationFrame(() => requestAnimationFrame(resolve))
    }
    requestAnimationFrame(step)
  })
}

const overlapArea = (p, q) => Math.max(0, Math.min(p[0] + p[2], q[0] + q[2]) - Math.max(p[0], q[0])) *
  Math.max(0, Math.min(p[1] + p[3], q[1] + q[3]) - Math.max(p[1], q[1]))

/** His drawn part: what is above the clip line, if there is one. */
const drawn = (him, floor) => floor === null ? him : [him[0], him[1], him[2], Math.max(0, Math.min(him[3], floor - him[1]))]

export function analyseLayout(frames) {
  let widgetResizes = 0, textResizes = 0, scrolled = 0, overWidget = 0
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i]
    if (a.st !== b.st) scrolled++
    if (a.widgets.length === b.widgets.length && a.widgets.some((w, k) => w[2] !== b.widgets[k][2] || w[0] !== b.widgets[k][0])) widgetResizes++
    if (a.texts.length === b.texts.length && a.texts.some((w, k) => w[2] !== b.texts[k][2] || w[0] !== b.texts[k][0])) textResizes++
  }
  let overFrame = null
  for (const f of frames) {
    if (!f.him || f.him[3] < 12) continue
    const him = drawn(f.him, f.floor)
    const worst = Math.max(0, ...f.widgets.map((w) => overlapArea(him, w)))
    if (worst > overWidget) { overWidget = worst; overFrame = f }
  }
  return { frames: frames.length, scrolled, widgetResizes, textResizes, overWidgetPx2: Math.round(overWidget), overFrame }
}

/** CIE76 distance between two sRGB colours, for "is he the brand's cyan". */
function deltaE(a, b) {
  const lab = ([r, g, bb]) => {
    const lin = [r, g, bb].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    const X = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047
    const Y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722
    const Z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
  }
  const p = lab(a), q = lab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

export async function checkDeckeChatPhone(browser, server, out, engine, fixture, admin) {
  admin.state.actor = 'ordinary'
  admin.state.permissions = ['decke.use']
  admin.state.balance = 500
  const results = []
  const { context, page } = await contextFor(browser, server, 390, { reducedMotion: 'no-preference', hasTouch: true })
  await signIn(context, USER)
  try {
    const box = await openChat(page, server)

    // ── HIS COLOURS, AS AUTHORED: white eyes, brand-cyan body, true accents ──
    // The owner: "like someone ran a desaturate filter over him entirely". It
    // was the tone curve (Blender's AgX), over all of him. Drawn once for real
    // and read back in the same task (the canvas keeps no buffer between
    // tasks), then sorted into his parts by hue: the eyes' whites (bright and
    // colourless), the cyan body, the amber bolts, the rose mouth.
    const color = await page.evaluate(() => {
      const d = window.__decke
      // Drawn and read until his eyes are open: a frame mid-blink has almost no
      // white in it, and the pose at any one frame depends on the machine.
      const read = () => {
      d.step(1 / 60)
      const src = d.opts.canvas, r = d.screenRect(), s = src.width / src.getBoundingClientRect().width
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height
      const g = c.getContext('2d'); g.drawImage(src, 0, 0)
      const px = g.getImageData(Math.max(0, Math.floor(r.left * s)), Math.max(0, Math.floor(r.top * s)), Math.ceil(r.width * s), Math.ceil(r.height * s)).data
      const parts = { body: [], white: [], gold: [], rose: [] }
      let blown = 0, n = 0
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 250) continue
        const [R, G, B] = [px[i], px[i + 1], px[i + 2]], mx = Math.max(R, G, B), dl = mx - Math.min(R, G, B)
        if (mx < 30) continue
        n++
        if (R > 250 && G > 250 && B > 250) blown++
        let hue = !dl ? 0 : mx === R ? 60 * (((G - B) / dl) % 6) : mx === G ? 60 * ((B - R) / dl + 2) : 60 * ((R - G) / dl + 4)
        if (hue < 0) hue += 360
        const sat = dl / mx
        if (sat < 0.12 && mx > 120) parts.white.push([R, G, B])
        else if (sat > 0.15 && hue >= 165 && hue <= 215) parts.body.push([R, G, B])
        else if (sat > 0.3 && hue >= 25 && hue <= 60) parts.gold.push([R, G, B])
        else if (sat > 0.2 && (hue >= 320 || hue <= 15)) parts.rose.push([R, G, B])
      }
      // A band's per-channel median, never one pixel at a percentile: at equal
      // brightness a lit pixel and a grey specular one sort side by side, and a
      // single pick lands on either (ΔE 3 or 25 from the same frame).
      const lum = (p) => p[0] * 0.2126 + p[1] * 0.7152 + p[2] * 0.0722
      const band = (arr, lo, hi) => {
        if (!arr.length) return null
        const all = [...arr].sort((a, b) => lum(a) - lum(b))
        const sl = all.slice(Math.floor(all.length * lo), Math.max(Math.floor(all.length * lo) + 1, Math.floor(all.length * hi)))
        return [0, 1, 2].map((k) => sl.map((p) => p[k]).sort((a, b) => a - b)[sl.length >> 1])
      }
      const sat = parts.body.reduce((acc, [R, G, B]) => acc + (Math.max(R, G, B) - Math.min(R, G, B)) / Math.max(R, G, B), 0) / (parts.body.length || 1)
      return {
        n: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length])),
        median: band(parts.body, 0, 1), lit: band(parts.body, 0.75, 0.95), sat,
        white: band(parts.white, 0.5, 0.95), gold: band(parts.gold, 0.5, 0.95), rose: band(parts.rose, 0.5, 0.95),
        blown: blown / (n || 1),
      }
      }
      // Eyes open: white pixels at least a tenth of the body's (open, they are
      // about 15%; mid-blink, under 1%). Up to two seconds of him.
      let got = read()
      for (let k = 0; k < 120 && got.n.white < got.n.body / 10; k++) got = read()
      return got
    })
    const hex = (a) => '#' + a.map((v) => v.toString(16).padStart(2, '0')).join('')
    const BRAND = [0x00, 0xd3, 0xf3], AMBER = [0xfa, 0xb8, 0x20], ROSE = [0xfb, 0x71, 0x85]
    assert.ok(color.n.body > 500 && color.n.white > 200 && color.n.gold > 100, engine + ': too few pixels of each part to judge his colours ' + JSON.stringify(color.n))
    // His EYE WHITES are white: authored #ffffff under white lights. Through
    // AgX they came out #cacbcb, the grey that made the whole of him read dim.
    const whiteMin = Math.min(...color.white), whiteSpread = Math.max(...color.white) - whiteMin
    assert.ok(whiteMin >= 225, engine + ': his eye whites render ' + hex(color.white) + ', grey')
    assert.ok(whiteSpread <= 10, engine + ': his eye whites render ' + hex(color.white) + ', tinted')
    // His BODY's lit face (the 75th to 95th brightness percentiles) is the
    // brand cyan. The median also counts his shaded side, and how much of that
    // is in view depends on his pose, so it is reported rather than asserted.
    const dMedian = deltaE(color.median, BRAND), dLit = deltaE(color.lit, BRAND)
    assert.ok(dLit <= 6, engine + ': his lit face renders ' + hex(color.lit) + ', ΔE ' + dLit.toFixed(1) + ' from the brand cyan')
    assert.ok(color.sat >= 0.75, engine + ': his body is ' + Math.round(color.sat * 100) + '% saturated — grayed out')
    // His ACCENTS are their authored colours: the amber-400 bolts, not the
    // muted #c29f5e (ΔE 40) AgX made of them. The rose-400 mouth is reported,
    // not asserted: it is a thin glossy line that changes shape with his pose,
    // so at some poses its anti-aliased edge against the cyan outweighs it.
    const dGold = deltaE(color.gold, AMBER), dRose = color.rose ? deltaE(color.rose, ROSE) : null
    assert.ok(dGold <= 14, engine + ': his bolts render ' + hex(color.gold) + ', ΔE ' + dGold.toFixed(1) + ' from amber-400')
    assert.ok(color.blown <= 0.01, engine + ': ' + (color.blown * 100).toFixed(1) + '% of him is blown to white')
    results.push({ case: 'decke-body-color', engine, deltaE: Math.round(dMedian), deltaELit: Math.round(dLit), saturation: Math.round(color.sat * 100),
      white: hex(color.white), bolts: hex(color.gold), boltsDeltaE: Math.round(dGold), mouth: color.rose && hex(color.rose), mouthDeltaE: color.rose && Math.round(dRose) })

    // ── A LONG PHONE CONVERSATION WITH WIDGETS, SCROLLED UP AND BACK ──
    // The recorder is what advances him (his own loop is stopped), so it runs
    // from here on: through both answers, so he parks as he would for a reader.
    await page.evaluate(installLayoutRecorder)
    fixture.script([
      [say('Cards with art that spans multiple cards. '), widget('Cards with art that spans multiple cards', ids(139, 144)), say(LONG), say('Those are the ones collectors chase for display.')],
      [say('Here are more of them. '), widget('V-UNION cards', ids(147, 152)), say(LONG), say('Want the full list, or where the starter trios live in your collection?')],
    ])
    for (const q of ['What cards have art that spans multiple cards?', 'Show me more of those']) {
      await box.fill(q)
      await box.press('Enter')
      await page.waitForFunction(() => !document.querySelector('[data-decke-thinking]') && document.querySelectorAll('.decke-figure').length > 0, null, { timeout: 60_000 })
      // Let the art land and the widget settle before the next question.
      await page.waitForFunction(() => [...document.querySelectorAll('.decke-figure img')].every((i) => i.complete), null, { timeout: 30_000 })
    }
    // Settled: a second of his time at rest before the reader scrolls.
    await page.evaluate(() => new Promise((resolve) => { let n = 0; const f = () => (++n > 60 ? resolve() : requestAnimationFrame(f)); requestAnimationFrame(f) }))
    await page.evaluate(() => { window.__layout.frames = [] })
    let cdp = null, m0 = null
    if (engine === 'chromium') {
      cdp = await context.newCDPSession(page)
      await cdp.send('Performance.enable')
      m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
    }
    await page.evaluate(scrollTranscript, [-1400, 70])
    await page.evaluate(scrollTranscript, [1400, 70])
    let layouts = null
    if (cdp) {
      const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
      layouts = m1.LayoutCount - m0.LayoutCount
    }
    const f = await page.evaluate(() => window.__layout.frames)
    const m = analyseLayout(f)
    await page.screenshot({ path: path.join(out, 'decke-chat-phone-' + engine + '.png') })
    assert.ok(m.scrolled >= 60, engine + ': the transcript barely scrolled (' + m.scrolled + ' frames)')
    assert.equal(m.widgetResizes, 0, engine + ': a widget changed size or position against the column while scrolling (' + m.widgetResizes + ' frames)')
    assert.equal(m.textResizes, 0, engine + ': his words re-wrapped while scrolling (' + m.textResizes + ' frames)')
    assert.equal(m.overWidgetPx2, 0, engine + ': he was drawn over a widget (' + m.overWidgetPx2 + ' px²): ' + JSON.stringify(m.overFrame) +
      ' after ' + JSON.stringify(f.slice(Math.max(0, f.indexOf(m.overFrame) - 3), f.indexOf(m.overFrame)).map((x) => ({ st: x.st, him: x.him?.[1], anchor: x.anchor?.[1], park: x.park, scrolls: x.scrolls }))) +
      ' of ' + f.length + ' frames, first ' + JSON.stringify({ st: f[0].st, anchor: f[0].anchor?.[1], park: f[0].park, scrolls: f[0].scrolls }))
    // Widgets take the whole column on a phone: 390 less the panel's 16 px sides.
    const widest = Math.max(...f.at(-1).widgets.map((w) => w[2]))
    assert.ok(widest >= 390 - 32 - 2, engine + ': a widget is narrower than the column (' + widest + ' px)')
    // Back at the bottom he stands beside his latest words, not above them.
    const end = f.at(-1)
    assert.ok(end.him && end.anchor && end.him[1] >= end.anchor[1] - 2, engine + ': at rest he stands above his latest words')
    // Only his latest reply keeps the gutter (owner, 2026-09-28): the first
    // answer's long paragraph takes the whole column, the latest answer's words
    // are indented past him.
    assert.ok(end.settled.length > 0 && end.beside.length > 0, engine + ': expected words from both answers: ' + JSON.stringify({ settled: end.settled, beside: end.beside }))
    const widestSettled = Math.max(...end.settled.map((t) => t[2]))
    assert.ok(widestSettled >= 390 - 32 - 2, engine + ': an earlier reply kept his gutter (' + widestSettled + ' px wide)')
    const leftEdge = Math.min(...end.settled.map((t) => t[0]))
    assert.ok(end.beside.every((t) => t[0] >= leftEdge + 8), engine + ': his latest reply is not indented past him: ' + JSON.stringify(end.beside))
    // Up the page he left with those words: drawn nowhere above the composer.
    const up = f.reduce((best, x) => (x.st !== null && (best === null || x.st < best.st) ? x : best), null)
    assert.ok(up.floor !== null && drawn(up.him, up.floor)[3] === 0, engine + ': scrolled up, he was still drawn over the conversation')
    // No thrash: at most about one layout per scrolled frame (it was 2.4 before).
    if (layouts !== null) assert.ok(layouts <= m.scrolled + 20, engine + ': ' + layouts + ' layouts for ' + m.scrolled + ' scrolled frames')

    // Closed while he had ridden off, then reopened: the panel unmounts on
    // close, so the park box comes back untransformed, and he must stand on it
    // whole rather than clipped against where the old box had ridden to.
    await page.evaluate(scrollTranscript, [-1400, 40])
    await page.getByRole('dialog', { name: 'Chat with Deck-E' }).getByRole('button', { name: 'Close chat' }).click()
    await page.getByRole('button', { name: 'Chat with Deck-E' }).click()
    await page.evaluate(() => new Promise((resolve) => { let n = 0; const f = () => (++n > 90 ? resolve() : requestAnimationFrame(f)); requestAnimationFrame(f) }))
    const back = await page.evaluate(() => window.__layout.frames.at(-1))
    assert.ok(back.him && back.him[3] >= 12 && drawn(back.him, back.floor)[3] >= back.him[3] - 1,
      engine + ': reopened at the latest reply, he is clipped out: ' + JSON.stringify(back))

    // Read a saved conversation and come back: the live transcript is a new
    // element, and he must still leave with his reply when it is scrolled.
    const saved = { id: 'c1', title: 'Pikachu promos', startedAt: NOW }
    const history = /\/api\/decke\/history(\/c1)?$/
    await page.route(history, (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({ json: /\/c1$/.test(route.request().url())
        ? { ...saved, turns: [{ seq: 1, asked: 'Which are the Pikachu promos?', answered: 'SWSH139 to SWSH142.', tools: [], buildPr: null, buildSha: null, at: NOW }] }
        : { conversations: [{ ...saved, turns: 1, updatedAt: NOW, buildPrMin: null, buildPrMax: null, buildSha: null }] } })
    })
    const dialog = page.getByRole('dialog', { name: 'Chat with Deck-E' })
    await dialog.getByRole('button', { name: /History/ }).click()
    await dialog.getByText('Pikachu promos').click()
    await dialog.getByRole('button', { name: 'Back to the live chat' }).click()
    await page.waitForFunction(() => !!document.querySelector('[data-decke-transcript] [data-decke-anchor]'))
    // He flies back to the composer from where he stood over the transcript;
    // a flight is never clipped, so judge him once he has landed.
    const settle = (n) => page.evaluate((k) => new Promise((resolve) => { let i = 0; const f = () => (++i > k ? resolve() : requestAnimationFrame(f)); requestAnimationFrame(f) }), n)
    await settle(120)
    await page.evaluate(scrollTranscript, [-1400, 40])
    await settle(30)
    const left = await page.evaluate(() => window.__layout.frames.at(-1))
    assert.ok(left.him && left.floor !== null && drawn(left.him, left.floor)[3] === 0,
      engine + ': back from a saved conversation, he stopped following the scroll: ' + JSON.stringify(left))
    await page.unroute(history)
    results.push({ case: 'decke-chat-phone', engine, ...m, overFrame: undefined, layouts, station: f.at(-1).stn })
  } finally { await context.close() }
  return results
}

/**
 * Self-registration for `scripts/test-browser.mjs`: this suite owns its own
 * cloud build (the engine handle is on in every test build) and fixture server.
 */
export function browserSuites({ browser, out, scratch, results, logs }) {
  return [{
    name: 'decke-show',
    async run() {
      logs.push(await run(process.execPath, ['--test', path.join(ROOT, 'tests/browser/__tests__/deckeShowScroll.test.mjs')]))
      const dist = path.join(scratch, 'decke-show')
      const admin = adminFixture('')
      const show = showFixture('', admin)
      const server = await serve(dist, '', (rel, url, req) => show.response(rel, url, req) ?? admin.response(rel, url, req), 'index.html',
        { allowMutation: (pathname, method) => admin.allowMutation(pathname, method) || show.allowMutation(pathname, method) })
      try {
        logs.push(await buildWeb(dist, true, server.origin))
        results.push(...await checkDeckeShow(browser, server, out, 'chromium', show, admin))
        const safari = await webkit.launch({ headless: true, ...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH } : {}) })
        try { results.push(...await checkDeckeShow(safari, server, out, 'webkit', show, admin)) } finally { await safari.close() }
        assert.deepEqual(server.unexpected, [], 'decke-show: unexpected network/error events')
      } finally { await server.close() }
    },
  }, {
    name: 'decke-chat-phone',
    async run() {
      const dist = path.join(scratch, 'decke-chat-phone')
      const admin = adminFixture('')
      const show = showFixture('', admin)
      const server = await serve(dist, '', (rel, url, req) => show.response(rel, url, req) ?? admin.response(rel, url, req), 'index.html',
        { allowMutation: (pathname, method) => admin.allowMutation(pathname, method) || show.allowMutation(pathname, method) })
      try {
        logs.push(await buildWeb(dist, true, server.origin))
        results.push(...await checkDeckeChatPhone(browser, server, out, 'chromium', show, admin))
        const safari = await webkit.launch({ headless: true, ...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH } : {}) })
        try { results.push(...await checkDeckeChatPhone(safari, server, out, 'webkit', show, admin)) } finally { await safari.close() }
        assert.deepEqual(server.unexpected, [], 'decke-chat-phone: unexpected network/error events')
      } finally { await server.close() }
    },
  }]
}
