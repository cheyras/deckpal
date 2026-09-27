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
 *   - ONE scroll owner: at most one jump (the long throw) and one glide, never a
 *     reversal. Two glides was the grid scrolling itself, then his flight again.
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
import path from 'node:path'
import { webkit } from 'playwright'
import { buildWeb, contextFor, serve } from './support.mjs'
import { adminFixture, signIn } from './admin.mjs'

const USER = '10000000-0000-4000-8000-000000000002'
const NOW = '2026-09-12T18:00:00Z'
const CHARIZARD = '[data-decke-card="sim1-199"]'

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
      t: performance.now(), y: Math.round(window.scrollY), path: location.pathname, flying: s.flying,
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
  // Scroll runs: a GLIDE is three or more consecutive moving frames, a JUMP one
  // or two. Runs are separated by four still frames.
  let glides = 0, jumps = 0, reversals = 0, run = 0, still = 99, dir = 0
  const close = () => { if (run >= 3) glides++; else if (run > 0) jumps++; run = 0 }
  for (let i = 1; i < frames.length; i++) {
    const dy = frames[i].y - frames[i - 1].y
    if (Math.abs(dy) <= 0.5) { still++; continue }
    if (still >= 4) close()
    still = 0
    run++
    if (dir && Math.sign(dy) !== dir) reversals++
    dir = Math.sign(dy)
  }
  close()
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
    glides, jumps, reversals, worstStepPx: Math.round(worst), flightMs: Math.round((flightFrames * 1000) / 60),
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
        const chats = await page.evaluate(() => window.__show.chats)
        await page.screenshot({ path: path.join(out, 'decke-show-card-' + engine + '-' + vp.width + '.png') })
        const where = engine + ' ' + vp.width + ': '
        assert.deepEqual(fixture.toolOutputs(), [{ ok: true }], where + 'the goTo did not report a landing')
        assert.equal(f.at(-1).path, '/series/sim/sim1', where + 'he did not take the reader to the set')
        assert.ok(m.jumps <= 1 && m.glides <= 1, where + 'the page scrolled more than once (' + m.jumps + ' jumps, ' + m.glides + ' glides) — two scroll owners again')
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
    // ── 5. the escort walk completes, pointing on the way ──
    {
      const { context, page } = await contextFor(browser, server, vp.width, { reducedMotion: 'no-preference' })
      await signIn(context, USER)
      try {
        const box = await openChat(page, server)
        fixture.script([
          [say('Follow me. '), call('esc-1', 'escort', { seriesSlug: 'sim', setId: 'sim7' })],
          [say('Here it is.')],
        ])
        await ask(page, box, 'Take me to Simulator Set 7', '[data-decke-set="sim7"]')
        await secondLeg(page, fixture, 90_000)
        const [output] = fixture.toolOutputs()
        // Every series here has cards collected, so the "show the rest"
        // disclosure never renders — the case that used to fail at step 1.
        assert.equal(output?.ok, true, 'the escort stopped: ' + JSON.stringify(output?.failure ?? fixture.bodies.map((b) => (b.messages?.at(-1)?.parts ?? []).map((p) => p.type))))
        assert.equal(output.ran.length, output.planned)
        // The last step presses the set's own link; the router commits it on
        // its own schedule, so wait for the address rather than sample it.
        await page.waitForURL(/\/series\/sim\/sim7$/, { timeout: 10_000 })
        results.push({ case: 'decke-show-escort', engine, steps: output.ran.length })
      } finally { await context.close() }
    }
  }
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
  }]
}
