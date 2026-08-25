#!/usr/bin/env node
/**
 * The PRESENTATION round trip: out to a thing on the page, and back to the chip.
 *
 * ── WHY THIS EXISTS, AND WHY THE OTHER PROBE WAS NOT ENOUGH ──────────────────
 *
 * `probe-decke-flight.mjs` measures the chat ENTRANCE — chip to composer — and
 * it passes. The owner then reported three things it cannot see, because none
 * of them happen on that leg:
 *
 *   "he's still doing a lot of unnecessary little turns when he arrives at his
 *    destination after a hop. reads as a flinch, and not intentional."
 *   "he just barely traveled to a target to show me, and disappeared on
 *    arrival. Then reappeared to hop back, and missed the button."
 *
 * A presentation is a different solve from a chat park. `parkBeside` returns a
 * FACING for it (a beside-park faces inward; the composer park is an optical
 * anchor that does not), it lands on the BACKGROUND depth plane at a third his
 * size, and its station is a page element that can scroll, re-flow or
 * virtualize out from under him. Every one of those is a way for the leg to end
 * badly that the entrance simply does not have.
 *
 * So this drives the real thing and samples every animation frame across the
 * whole round trip:
 *
 *   OUT      `flyTo` a card tile with exactly the options `uiTools.runUiTool`
 *            passes for the `flyTo` tool — same depth, same ring, same `then`,
 *            same `scrollWith`.
 *   HOLD     a beat parked, which is when "disappeared on arrival" happens.
 *   BACK     close the chat through the real UI, so the HOST's own dismissal
 *            runs rather than a reconstruction of it.
 *
 * and reports, for each phase: the worst turn after landing, whether he was
 * ever invisible while he was supposed to be on screen, and how far his final
 * resting place is from the launcher he was diving into.
 *
 * ── SAFETY (AGENTS.md B12) ───────────────────────────────────────────────────
 *
 * Signs in as the QA account from `.qa-account`, never the owner's. It opens the
 * chat, drives the character, and closes the chat. No message is sent, no tool
 * runs on the server, nothing is written.
 *
 * ── PREREQUISITES ────────────────────────────────────────────────────────────
 *
 *   pnpm dev                                          # or --base <a deployment>
 *   export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright
 *   .qa-account present at the repo root
 *
 * RUN IT `--headed`. Headless Chromium throttles `requestAnimationFrame` to
 * about 5 Hz here, which is coarser than every defect this measures. See the
 * same note on `probe-decke-flight.mjs`; it cost a full pass to learn once.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { DESKTOP_PROFILE } from './lib/devices.mjs'
import { bypassHeaders, openDeckE, qaAccount, signIn, unlockDeckE } from './lib/session.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const BASE = arg('base', 'http://localhost:5199').replace(/\/$/, '')
const OUT = arg('out', join(repoRoot, '.visual-harness', arg('run', 'present-probe')))
const HEADED = flag('headed')
const RUNS = Math.max(1, Number(arg('runs', 3)))
/** A set page with a virtualized grid of card tiles — the real presentation target. */
const ROUTE = arg('route', '/series/base/base1')

/** See `probe-decke-flight.mjs` — same channel, same reasoning. */
const TURN_MAX = 0.05

/**
 * How much bigger he may get on the way BACK into the chip.
 *
 * The chat-exit contract is explicit that he "never grows during the trip", and
 * the dismissal broke it for one specific start: leaving a PRESENTATION, which
 * parks him on the far plane at a third scale, while `flyTo` defaults `depth`
 * to `foreground`. He was pulled toward the camera on his way out — measured,
 * 43.3 px of drawn height to 62.9, a 45% swell — and only then shrank away.
 * 1.08 is slack for the landing squash and the float, and nothing like 1.45.
 */
const RETURN_GROWTH_MAX = 1.08

/**
 * The smallest he may be and still count as ON SCREEN.
 *
 * He presents on the BACKGROUND plane at about a third his normal size, so a
 * simple "is he big" test would call every correct presentation a
 * disappearance. This is a fraction of the size he actually had when he landed,
 * which is the only honest comparison: 15% of himself is a speck, and the
 * defect being looked for is him going to nothing.
 */
const VANISH_FRACTION = 0.15

/**
 * How far his final resting place may be from the launcher's centre, in CSS px.
 *
 * The dive ends INSIDE the chip — "gone" and "landed" are the same frame by
 * construction (`flyTo` with `scaleTo: 0`). The chip is 52px, so half of it is
 * 26; 40 allows for the last sampled frame being a frame or two before the end
 * without allowing the "shrinks down into this space well above the chat
 * button" the review recorded, which was most of his own body away.
 */
const HOME_MISS_MAX_PX = 40

async function startRecording(page) {
  await page.evaluate(() => {
    const d = window.__decke
    window.__probe = []
    window.__probeStop = false
    const t0 = performance.now()
    const tick = () => {
      if (window.__probeStop) return
      let r = null
      try {
        r = d.screenRect()
      } catch {
        r = null
      }
      const s = d.getState()
      // THE LAUNCHER, EVERY FRAME. The dismissal picks its destination from
      // this element's rect, and whether it exists at the moment of the close
      // is the whole question — `DeckeButton` unmounts while the panel is open.
      const btn = document.querySelector('button[aria-label="Chat with Deck-E"]')
      const br = btn ? btn.getBoundingClientRect() : null
      window.__probe.push({
        t: performance.now() - t0,
        mark: window.__probeMark ?? '',
        chip: br && br.width > 0 ? { x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2), w: Math.round(br.width) } : null,
        flying: !!s.flying,
        state: s.state,
        facing: s.facing,
        scale: d.entryScale,
        onScreen: !!r,
        x: r ? (r.left + r.right) / 2 : null,
        y: r ? (r.top + r.bottom) / 2 : null,
        h: r ? r.bottom - r.top : null,
      })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

const mark = (page, name) => page.evaluate((n) => { window.__probeMark = n }, name)

async function stopRecording(page) {
  return page.evaluate(() => {
    window.__probeStop = true
    return window.__probe
  })
}

/** The last contiguous run of `flying`, and what happened after it. */
function phase(samples, name) {
  const seg = samples.filter((s) => s.mark === name)
  const vis = seg.filter((s) => s.onScreen)
  if (!vis.length) return { name, ok: false, reason: 'never on screen in this phase' }
  const first = vis.findIndex((s) => s.flying)
  if (first < 0) return { name, ok: false, reason: 'no flight in this phase' }
  let last = first
  while (last + 1 < vis.length && vis[last + 1].flying) last++
  const landed = vis[last]
  // BOUNDED BY THE PHASE, not by the end of the recording. The first version
  // measured "after landing" as everything that followed, so the dismissal's
  // own shrink-to-nothing counted as the presentation vanishing — 571 frames of
  // it in one run and none in the next, which is a metric reading the gap
  // between two phases rather than anything inside one.
  const after = vis.filter((s) => s.t > landed.t)
  let turn = 0
  let turnAtMs = null
  for (const s of after) {
    const d = Math.abs(s.facing - landed.facing)
    if (d > turn) {
      turn = d
      turnAtMs = Math.round(s.t - landed.t)
    }
  }
  // Did he vanish while he was meant to be standing there? `onScreen` false is
  // `screenRect()` returning null; a tiny `h` is him being scaled to nothing.
  const off = seg.filter((s) => s.t > landed.t && !s.onScreen).length
  const tiny = after.filter((s) => landed.h && s.h < landed.h * VANISH_FRACTION).length
  return {
    name,
    ok: true,
    legMs: Math.round(landed.t - vis[first].t),
    landedAt: { x: Math.round(landed.x), y: Math.round(landed.y) },
    landedH: Math.round(landed.h),
    turn: Number(turn.toFixed(3)),
    turnAtMs,
    framesOffScreenAfterLanding: off,
    framesTinyAfterLanding: tiny,
    finalAt: after.length && after[after.length - 1].x !== null
      ? { x: Math.round(after[after.length - 1].x), y: Math.round(after[after.length - 1].y) }
      : null,
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const { chromium } = await resolvePlaywright()
  const account = qaAccount(join(repoRoot, '.qa-account'))
  const browser = await chromium.launch({ headless: !HEADED })
  const context = await browser.newContext({
    ...DESKTOP_PROFILE,
    extraHTTPHeaders: bypassHeaders({ base: BASE, repoRoot }),
  })
  await unlockDeckE(context)
  const page = await context.newPage()
  const report = { base: BASE, route: ROUTE, runs: [] }
  try {
    await signIn(page, BASE, account)
    await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-decke-card]', { timeout: 60_000 })
    await page.waitForTimeout(2500)

    for (let run = 0; run < RUNS; run++) {
      await openDeckE(page)
      await page.waitForFunction(() => !!window.__decke, undefined, { timeout: 60_000 })
      await page.waitForFunction(
        () => window.__decke.entryScale >= 1 && !window.__decke.getState().flying,
        undefined,
        { timeout: 60_000 },
      )
      await page.waitForTimeout(1500)

      await startRecording(page)
      await mark(page, 'far')
      // EXACTLY the options `uiTools.runUiTool` passes for the `flyTo` tool.
      // A reconstruction that drifts from the caller measures a leg the app
      // never flies.
      const target = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll('[data-decke-card]')]
        // The whole tile need not fit — a card tile is ~342px tall on this
        // layout and the panel is over most of the window, so demanding a
        // fully-visible one finds nothing. What matters is that the thing he is
        // sent to is really on screen: its top edge inside the viewport and
        // enough of it below that to point at.
        // ACROSS HIM, so the leg is long AND the beside-park has to flip his
        // facing. A tile on the side he already faces needs no turn at all,
        // which is how the first version of this probe reported `turn 0` on
        // every run: it was measuring legs that never asked for one.
        const me = window.__decke.screenRect()
        const mid = me ? (me.left + me.right) / 2 : window.innerWidth / 2
        const usable = tiles.filter((t) => {
          const r = t.getBoundingClientRect()
          return r.width > 80 && r.top > 100 && r.top < window.innerHeight - 160
        })
        if (!usable.length) return null
        const away = usable
          .map((t) => ({ t, d: Math.abs(t.getBoundingClientRect().left - mid) }))
          .sort((a, b) => b.d - a.d)[0].t
        const id = away.getAttribute('data-decke-card')
        const sel = `[data-decke-card="${id}"]`
        window.__decke.flyTo(
          { selector: sel },
          { depth: 'background', highlight: true, then: 'point', scrollWith: true },
        )
        return sel
      })
      if (!target) throw new Error('no card tile on screen to present')
      await page.waitForTimeout(3500)

      // A SHORT HOP, which is the case the owner describes — "he just barely
      // traveled to a target to show me". The turn has a floor
      // (`FACING_TURN_MIN_MS`, 280ms), so a leg shorter than that still has a
      // turn running after it lands however tightly the turn is bounded to the
      // leg. A neighbouring tile is a few hundred pixels, which is that leg.
      await mark(page, 'near')
      await page.evaluate((sel) => {
        const cur = document.querySelector(sel)
        if (!cur) return
        const r0 = cur.getBoundingClientRect()
        const next = [...document.querySelectorAll('[data-decke-card]')]
          .filter((t) => t !== cur)
          .map((t) => {
            const r = t.getBoundingClientRect()
            return { t, d: Math.hypot(r.left - r0.left, r.top - r0.top) }
          })
          .filter((x) => x.d > 10)
          .sort((a, b) => a.d - b.d)[0]
        if (!next) return
        const id = next.t.getAttribute('data-decke-card')
        window.__decke.flyTo(
          { selector: `[data-decke-card="${id}"]` },
          { depth: 'background', highlight: true, then: 'point', scrollWith: true },
        )
      }, target)
      await page.waitForTimeout(3000)

      await mark(page, 'back')
      // THE HOST'S OWN DISMISSAL, through the real control. Reconstructing the
      // exit here would test this file's idea of it rather than the app's.
      await page
        .getByRole('dialog', { name: 'Chat with Deck-E' })
        .getByRole('button', { name: 'Close chat' })
        .click()
      await page.waitForTimeout(4000)
      // AFTER THE CLOSE. The launcher is UNMOUNTED while the panel is open, so
      // querying it mid-presentation returned null and the "did he miss the
      // button" check silently never ran — every run reported `nullpx` and the
      // probe passed anyway. A check that cannot fail is not a check; this is
      // the exact trap `scripts/visual-harness/README.md` warns about, walked
      // into by the person who wrote the warning.
      const launcher = await page.evaluate(() => {
        const b = document.querySelector('button[aria-label="Chat with Deck-E"]')
        const r = b?.getBoundingClientRect()
        return r && r.width > 0
          ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
          : null
      })
      const samples = await stopRecording(page)
      writeFileSync(join(OUT, `run-${run + 1}.json`), JSON.stringify(samples, null, 1))

      const far = phase(samples, 'far')
      const near = phase(samples, 'near')
      const back = phase(samples, 'back')
      // WHERE HE VANISHED, not where he was parked afterwards.
      //
      // The first version took the last frame he was on screen at all, and
      // reported 262 px on a dive that was actually landing 17 px from the chip
      // centre — i.e. on it. The dismissal deliberately puts him back at the
      // abstract home corner once he is invisible (`DeckeHost`'s `finish`:
      // "BACK TO NOTHING, at a station the collapsed state can live with"), and
      // that parking of an INVISIBLE character was the whole of the 262. The
      // number to compare against the chip is the last frame anyone could still
      // see him in.
      const rest = samples
        .filter((s) => s.mark === 'back' && s.onScreen && s.scale > VANISH_FRACTION)
        .at(-1)
      const homeMiss =
        launcher && rest ? Math.round(Math.hypot(rest.x - launcher.x, rest.y - launcher.y)) : null
      const verdict = { far, near, back, launcher, homeMiss }
      report.runs.push(verdict)

      // DID HE SWELL ON THE WAY BACK? Measured off his drawn height, not off
      // `entryScale`: the shrink and the depth change compose, so the scale
      // channel can be falling while he is visibly getting bigger.
      const backVis = samples.filter((s) => s.mark === 'back' && s.onScreen && s.scale > 0.02)
      const backH = backVis.map((s) => s.h)
      verdict.returnGrowth = backH.length
        ? Number((Math.max(...backH) / backH[0]).toFixed(2))
        : null

      const fmt = (p) =>
        p.ok
          ? `leg ${p.legMs}ms · turn-after ${p.turn}${p.turnAtMs === null ? '' : ` @+${p.turnAtMs}ms`} · ` +
            `vanished ${p.framesOffScreenAfterLanding} off-screen / ${p.framesTinyAfterLanding} tiny frames`
          : `unreadable — ${p.reason}`
      console.log(`  run ${run + 1}`)
      console.log(`    far : ${fmt(far)}`)
      console.log(`    near: ${fmt(near)}`)
      console.log(`    back: ${fmt(back)}`)
      console.log(
        `    home: ended ${homeMiss}px from the launcher centre · grew x${verdict.returnGrowth} on the way`,
      )
      await page.waitForTimeout(1500)
    }

    const usable = report.runs.filter((r) => r.far.ok || r.near.ok)
    const turnedIn = (p) => p.ok && p.turn > TURN_MAX
    const turned = usable.filter((r) => turnedIn(r.far) || turnedIn(r.near)).length
    const vanishedIn = (p) => p.ok && (p.framesOffScreenAfterLanding > 0 || p.framesTinyAfterLanding > 0)
    const vanished = usable.filter((r) => vanishedIn(r.far) || vanishedIn(r.near)).length
    // A run whose launcher could not be measured is NOT a pass. It is the check
    // not having run, and it has to say so out loud.
    const unmeasured = usable.filter((r) => r.homeMiss === null).length
    const missed = usable.filter((r) => r.homeMiss !== null && r.homeMiss > HOME_MISS_MAX_PX).length
    const grew = usable.filter((r) => (r.returnGrowth ?? 1) > RETURN_GROWTH_MAX).length
    report.summary = { runs: report.runs.length, usable: usable.length, turned, vanished, missed, unmeasured, grew }
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(
      `\n  ${usable.length}/${report.runs.length} readable · ${turned} turned after landing (> ${TURN_MAX}) · ` +
        `${vanished} vanished while presenting · ${missed} missed the button (> ${HOME_MISS_MAX_PX}px) · ` +
        `${grew} grew on the way back (> x${RETURN_GROWTH_MAX})` +
        (unmeasured ? ` · ${unmeasured} UNMEASURED (no launcher rect)` : ''),
    )
    const ok =
      usable.length > 0 && turned === 0 && vanished === 0 && missed === 0 && unmeasured === 0 && grew === 0
    console.log(ok ? '  PASS\n' : '  FAIL — see above.\n')
    console.log(`  samples + report: ${OUT}\n`)
    return usable.length ? (ok ? 0 : 1) : 4
  } finally {
    if (!flag('keep')) await browser.close()
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error(err)
    process.exitCode = 4
  },
)
