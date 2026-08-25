#!/usr/bin/env node
/**
 * Does his hop STOP halfway, and does he twitch after he lands?
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
 *
 * Two of the 2026-08-24 review's findings are about the shape of a single leg,
 * and neither survives being looked at in a contact sheet:
 *
 *   "Deck-E seems like he makes to stop right here in the wrong spot, before
 *    then continuing to where he's supposed to go — makes the animation feel
 *    glitchy and not smooth."                              (c2, and c24/c37/c50)
 *   "hiccup/temporary pause on the way again. happens every time pretty much."
 *   "after arriving in the right spot he does an unnecessary turn/adjustment
 *    that feels like a flinch. Feels crappy."                              (c51)
 *
 * A 24-frame sheet of a 700 ms hop has three frames in it. A vision model asked
 * "did he pause?" is guessing. So this samples `DeckE.screenRect()` — his real
 * drawn box, entrance scale and all — on every animation frame of a real
 * entrance, and reads the answer off the trajectory:
 *
 *   STALL     an interior local minimum in speed, i.e. he decelerated toward
 *             a stop somewhere that is not the destination and then set off
 *             again. The ease-in and ease-out at the ends are excluded by
 *             construction; only the middle of the leg is examined.
 *   FLINCH    how far his centre moves in the second after the flight reports
 *             itself finished. Idle float is a couple of pixels; a corrective
 *             hop is tens.
 *
 * It ASSERTS by exit code, and it repeats — `--runs N` — because "happens every
 * time pretty much" is a claim about a RATE, and one clean hop does not answer
 * it.
 *
 *   node scripts/visual-harness/probe-decke-flight.mjs --base http://localhost:5199
 *   node scripts/visual-harness/probe-decke-flight.mjs --runs 5
 *
 * Exit 0 if every run was clean, 1 if any run stalled or flinched, 4 on a
 * harness error.
 *
 * ── SAFETY (AGENTS.md B12) ───────────────────────────────────────────────────
 *
 * Signs in as the QA account from `.qa-account`, never the owner's. It opens and
 * closes the chat panel and reads a number off the running engine. No message is
 * sent, no tool runs, nothing is written.
 *
 * ── PREREQUISITES ────────────────────────────────────────────────────────────
 *
 *   pnpm dev                                          # or --base <a deployment>
 *   export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright
 *   .qa-account present at the repo root
 *
 * `window.__decke` is DEV-ONLY (`DeckeHost` publishes it behind
 * `import.meta.env.DEV`), so this cannot run against a production deployment.
 * That is a real limit and not a bug: the alternative is measuring him off
 * pixels, which `probe-decke-size.mjs` does and which cannot see a stall
 * because it cannot sample every frame.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { DESKTOP_PROFILE } from './lib/devices.mjs'
import { bypassHeaders, HOME_PATH, qaAccount, signIn, unlockDeckE } from './lib/session.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const BASE = arg('base', 'http://localhost:5199').replace(/\/$/, '')
const OUT = arg('out', join(repoRoot, '.visual-harness', arg('run', 'flight-probe')))
const HEADED = flag('headed')
const RUNS = Math.max(1, Number(arg('runs', 3)))

/**
 * How deep an interior dip in speed counts as a stall.
 *
 * A leg is one eased arc: speed climbs, holds, falls. Anything that dips to a
 * fraction of the speed it had just reached and then climbs back is a second
 * arc glued onto the first, which is exactly what a flight being replaced
 * mid-air looks like. 0.45 is well under the ripple a solved track produces on
 * its own (measured under 0.15 of the peak, frame to frame) and well over the
 * near-zero a real stop reaches.
 */
const STALL_RATIO = 0.45

/**
 * The stretch of the leg that is examined.
 *
 * The first and last fifth are ALWAYS slow — that is the ease, and it is the
 * animation working. A stall detector that includes them reports every hop.
 */
const INTERIOR = [0.2, 0.85]

/**
 * How far his centre may drift in the second after the flight ends, in CSS px.
 *
 * NOT ZERO: `procedural.ts` floats him, deliberately and continuously, and the
 * float is the difference between a character and a decal. Measured on a parked
 * character over three seconds, the centre wanders under 6 px. A corrective hop
 * moves him tens — the review's own frames put one at "sudden shift downward
 * and to the left" across most of his own body width.
 */
const FLINCH_MAX_PX = 14

/** How long after the landing the flinch window runs, in ms. */
const FLINCH_MS = 1000

/**
 * How far `facing` may still move after he has landed.
 *
 * `facing` is continuous over [-1, +1] and the two authored directions are its
 * ends, so a full turn is 2.0 and the quarter-turn the owner calls "an
 * unnecessary turn/adjustment that feels like a flinch" is a few tenths. Zero
 * is not the target — a park solve can land a hair off and ease in over a frame
 * or two. 0.05 is comfortably under what reads as a TURN and comfortably over
 * that easing.
 */
const TURN_MAX = 0.05

/**
 * How long he may stand at the chip AT FULL SIZE before the leg starts, in ms.
 *
 * The entrance is meant to be concurrent — the owner's ruling, in the engine
 * README: "he should just be scaling up during the hop, really, so that it
 * feels snappy." A grow that finishes and then waits is the sequential staging
 * that ruling replaced, arriving back by a different route. A couple of frames
 * is scheduling noise; a quarter of a second is the defect.
 */
const GROW_LEAD_MAX_MS = 40

/**
 * Sample his drawn box every animation frame, for `ms`, and hand back the
 * series.
 *
 * IN THE PAGE, not over the wire. A round trip per sample would sample at
 * whatever the CDP latency happens to be, which is neither every frame nor an
 * even cadence — and a stall is a shape in TIME. `performance.now()` inside the
 * page is the only clock that is on the same side of the boundary as the rAF
 * loop being measured.
 */
async function record(page, ms) {
  return page.evaluate(async (duration) => {
    const d = window.__decke
    if (!d) return { error: 'window.__decke is absent — is this a dev build?' }
    const out = []
    const t0 = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now() - t0
        let r = null
        try {
          r = d.screenRect()
        } catch {
          r = null
        }
        const s = d.getState()
        out.push({
          t: now,
          flying: !!s.flying,
          state: s.state,
          scale: d.entryScale,
          // FACING IS THE FLINCH. The first version of this probe measured the
          // arrival wobble as centre DISPLACEMENT and passed a build the owner
          // could plainly see turning: a yaw is a rotation about his own axis,
          // so it moves his centroid by a couple of pixels and his silhouette
          // barely more. `facing` is the channel the turn actually drives.
          facing: s.facing,
          x: r ? (r.left + r.right) / 2 : null,
          y: r ? (r.top + r.bottom) / 2 : null,
          h: r ? r.bottom - r.top : null,
        })
        if (now >= duration) resolve()
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    return { samples: out }
  }, ms)
}

/** Distance between two samples, or null if either is not on screen. */
function step(a, b) {
  if (a.x === null || b.x === null) return null
  const dt = b.t - a.t
  if (dt <= 0) return null
  return Math.hypot(b.x - a.x, b.y - a.y) / dt
}

/**
 * Read the leg out of a recording: when it started, when it ended, whether it
 * stalled in the middle, and how far he moved after it.
 *
 * THE LEG IS THE RUN OF `flying`, not a run of "he was moving fast enough".
 * The movement heuristic was written first and it was wrong in a way worth
 * recording, because it produced a confident false positive: the entrance grows
 * him AT THE CHIP for a third of a second before he sets off, and growing moves
 * his centre a little, so the heuristic started the leg during the grow. That
 * put the real landing — decelerate to nothing, settle, stop — at 42% of what
 * it believed the leg to be, and reported it as a mid-flight stall, twice out
 * of two runs, with a ratio of 0.04.
 *
 * `flying` is the engine's own answer to "is a solved track being played", and
 * it is the right boundary for the question. It also happens to be exactly the
 * boundary that catches the defect: `launch` REPLACES a track in place without
 * clearing the flag, so two legs glued together are one run of `flying` with
 * the junction in its middle, which is where a stall is looked for.
 */
function analyse(samples) {
  const visible = samples.filter((s) => s.x !== null && s.scale > 0.02)
  if (visible.length < 8) return { ok: false, reason: 'he was never really on screen' }
  const first = visible.findIndex((s) => s.flying)
  if (first < 0) return { ok: false, reason: 'he never flew' }
  let last = first
  while (last + 1 < visible.length && visible[last + 1].flying) last++
  const leg = visible.slice(first, last + 1)
  if (leg.length < 12) return { ok: false, reason: `the leg was ${leg.length} frames — nothing to read` }
  const span = leg[leg.length - 1].t - leg[0].t
  if (span < 120) return { ok: false, reason: `the leg lasted ${Math.round(span)}ms — nothing to read` }

  const speeds = []
  for (let i = 1; i < leg.length; i++) {
    const v = step(leg[i - 1], leg[i])
    speeds.push({ f: (leg[i].t - leg[0].t) / span, v: v ?? 0, t: leg[i].t })
  }
  const peak = Math.max(...speeds.map((s) => s.v))
  if (peak <= 0) return { ok: false, reason: 'he never moved at all' }

  // The interior only. Both ends of a leg are slow BY DESIGN: `flight.ts` opens
  // every track with an anticipation dip — a small backward move before the
  // real one, measured here at 11% of the way through — and closes it with a
  // deceleration and an aimed overshoot that settles. Neither is a defect and
  // both would trip any dip detector that included them.
  const inner = speeds.filter((s) => s.f >= INTERIOR[0] && s.f <= INTERIOR[1])
  let stall = null
  for (let k = 1; k < inner.length - 1; k++) {
    const before = Math.max(...inner.slice(0, k).map((s) => s.v))
    const after = Math.max(...inner.slice(k + 1).map((s) => s.v))
    const ratio = inner[k].v / Math.min(before, after)
    if (ratio < STALL_RATIO && (!stall || ratio < stall.ratio)) {
      stall = {
        atMs: Math.round(inner[k].t - leg[0].t),
        atFraction: Number(inner[k].f.toFixed(2)),
        ratio: Number(ratio.toFixed(3)),
      }
    }
  }

  // What he did AFTER the track ended.
  const landed = leg[leg.length - 1]
  const after = visible.filter((s) => s.t > landed.t && s.t <= landed.t + FLINCH_MS)
  let flinch = 0
  let sizeDrift = 0
  let turn = 0
  let turnAtMs = null
  for (const s of after) {
    flinch = Math.max(flinch, Math.hypot(s.x - landed.x, s.y - landed.y))
    if (landed.h) sizeDrift = Math.max(sizeDrift, Math.abs(s.h - landed.h) / landed.h)
    const d = Math.abs(s.facing - landed.facing)
    if (d > turn) {
      turn = d
      turnAtMs = Math.round(s.t - landed.t)
    }
  }

  // AND HOW THE GROW SITS AGAINST THE LEG. The entrance is meant to be
  // CONCURRENT — the owner's ruling, recorded in the engine README: "he should
  // just be scaling up during the hop, really, so that it feels snappy." What
  // ships is sequential: he grows to full size standing on the chip and only
  // then sets off. `growDoneBeforeLegMs` is how long he stands there finished
  // and motionless; negative means the grow was still running when the leg
  // began, which is the shape that was asked for.
  const grown = visible.find((s) => s.scale >= 0.995)
  const growDoneBeforeLegMs = grown ? Math.round(leg[0].t - grown.t) : null
  const scaleAtLaunch = Number(leg[0].scale.toFixed(3))
  return {
    ok: true,
    legMs: Math.round(span),
    frames: leg.length,
    fps: Math.round((leg.length / span) * 1000),
    travelledPx: Math.round(Math.hypot(landed.x - leg[0].x, landed.y - leg[0].y)),
    peakPxPerMs: Number(peak.toFixed(2)),
    stall,
    flinchPx: Math.round(flinch),
    turn: Number(turn.toFixed(3)),
    turnAtMs,
    sizeDrift: Number(sizeDrift.toFixed(3)),
    scaleAtLaunch,
    growDoneBeforeLegMs,
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
  const report = { base: BASE, runs: [] }
  try {
    await signIn(page, BASE, account)
    await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded' })

    const launcher = page.getByRole('button', { name: 'Chat with Deck-E' })
    await launcher.waitFor({ state: 'visible', timeout: 30_000 })
    // Warm first, OUTSIDE the measurement. The first open pays for the module,
    // the glb and the shader compile — measured at 7.4s cold in the engine's own
    // README — and a leg solved while the main thread is compiling shaders is a
    // measurement of the compile.
    await launcher.hover()
    await launcher.click()
    await page.getByLabel('Message Deck-E').waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForFunction(() => !!window.__decke, undefined, { timeout: 60_000 })
    await page.waitForTimeout(2500)

    for (let run = 0; run < RUNS; run++) {
      // Close, let him get all the way home, then open and watch the whole
      // entrance: the chip, the grow, the leg, the landing and the second after.
      await page
        .getByRole('dialog', { name: 'Chat with Deck-E' })
        .getByRole('button', { name: 'Close chat' })
        .click()
      await page.waitForTimeout(2500)
      const pending = record(page, 3200)
      await page.waitForTimeout(120)
      await launcher.click()
      const rec = await pending
      if (rec.error) throw new Error(rec.error)
      const verdict = analyse(rec.samples)
      report.runs.push(verdict)
      writeFileSync(join(OUT, `run-${run + 1}.json`), JSON.stringify(rec.samples, null, 1))
      const line = verdict.ok
        ? `  run ${run + 1}: leg ${verdict.legMs}ms over ${verdict.travelledPx}px at ${verdict.fps}fps · ` +
          `stall ${verdict.stall ? `YES at +${verdict.stall.atMs}ms (${verdict.stall.ratio})` : 'no'} · ` +
          `turn-after ${verdict.turn}${verdict.turnAtMs === null ? '' : ` @+${verdict.turnAtMs}ms`} · ` +
          `flinch ${verdict.flinchPx}px · ` +
          `launch@scale ${verdict.scaleAtLaunch} (full ${verdict.growDoneBeforeLegMs}ms before the leg)`
        : `  run ${run + 1}: unreadable — ${verdict.reason}`
      console.log(line)
      await page.waitForTimeout(1500)
    }

    const usable = report.runs.filter((r) => r.ok)
    const stalled = usable.filter((r) => r.stall).length
    const flinched = usable.filter((r) => r.flinchPx > FLINCH_MAX_PX || r.turn > TURN_MAX).length
    const sequential = usable.filter((r) => (r.growDoneBeforeLegMs ?? -1) > GROW_LEAD_MAX_MS).length
    report.summary = { runs: report.runs.length, usable: usable.length, stalled, flinched, sequential }
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(
      `\n  ${usable.length}/${report.runs.length} readable · ${stalled} stalled · ` +
        `${flinched} flinched (> ${FLINCH_MAX_PX}px or > ${TURN_MAX} facing) · ` +
        `${sequential} grew before setting off (> ${GROW_LEAD_MAX_MS}ms)`,
    )
    if (!usable.length) {
      console.log('  INCONCLUSIVE — nothing was measurable.\n')
      return 4
    }
    const ok = stalled === 0 && flinched === 0 && sequential === 0
    console.log(ok ? '  PASS — every leg was one continuous arc.\n' : '  FAIL — see above.\n')
    console.log(`  samples + report: ${OUT}\n`)
    return ok ? 0 : 1
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
