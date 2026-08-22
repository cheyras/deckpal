#!/usr/bin/env node
/**
 * Photograph Deck-E, signed in, on both platforms — the instrument every visual
 * claim about the chat depends on.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
 *
 * `decke-gates.mjs` answers *"did it actually happen?"* by hooking the network.
 * `run-visual-smoke.mjs` proves this harness works, signed out, on the public
 * landing page. Neither can answer *"does the chat look right?"*, because the
 * chat is behind auth and behind an entitlement check — so this is the first
 * thing in the repo that can produce evidence about a Deck-E surface at all.
 *
 * It ASSERTS NOTHING on its own. It produces artifacts a human (or, through
 * `judge-motion.mjs`, a vision model) can be wrong in front of. That division
 * is deliberate: a script that both takes the photograph and grades it is a
 * script that grades its own homework.
 *
 * ── SCENES ───────────────────────────────────────────────────────────────────
 *
 * A scene is a named situation worth looking at, and every phase of the Deck-E
 * experience pass adds the scenes it needs rather than adding a script. Scenes
 * that capture a BEFORE are as valuable as the after: run one against the
 * current build, keep the artifact, run it again after the change.
 *
 *   node scripts/visual-harness/capture-decke.mjs --list
 *   node scripts/visual-harness/capture-decke.mjs --scene chat-open
 *   node scripts/visual-harness/capture-decke.mjs --scene all --only desktop
 *   node scripts/visual-harness/capture-decke.mjs --scene chat-open --run before
 *
 * ── SAFETY (AGENTS.md B12) ───────────────────────────────────────────────────
 *
 * This signs in. `pnpm dev` proxies to the LIVE backend, so the session is real
 * and so is anything it touches. It runs as the QA account from `.qa-account`
 * and never the owner's. Scenes here read and look; none of them sends a
 * message or approves a write, and a scene that wants to must say so in its own
 * `writes: true` flag so `--list` shows it and this header stays true.
 *
 * ── PREREQUISITES ────────────────────────────────────────────────────────────
 *
 *   pnpm dev                                          # or --base <a deployment>
 *   export PLAYWRIGHT_MODULE=/c/tmp/pw/node_modules/playwright
 *   .qa-account present at the repo root
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { DESKTOP_PROFILE, mobileProfile } from './lib/devices.mjs'
import { captureForReview, captureScreenshots, captureViewport } from './lib/screenshot.mjs'
import { recordInteraction } from './lib/video.mjs'
import { buildContactSheet } from './lib/contact-sheet.mjs'
import { attachDiagnostics } from './lib/diagnostics.mjs'
import { TimingReport } from './lib/timing.mjs'
import {
  applySafeAreaInsets,
  applyStandaloneShim,
  IPHONE_14_PRO_PORTRAIT_INSETS,
} from './lib/pwa-emulation.mjs'
import { HOME_PATH, bypassHeaders, openDeckE, qaAccount, signIn, unlockDeckE } from './lib/session.mjs'
import { fmtBytes as fmtPayload, recordPayload } from './lib/payload.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const BASE = arg('base', 'http://localhost:5199').replace(/\/$/, '')
const RUN = arg('run', 'decke')
const OUT = arg('out', join(repoRoot, '.visual-harness', RUN))
const HEADED = flag('headed')
const ONLY = arg('only', 'all')
const WIDE = Number(arg('width', 1440))
const TALL = Number(arg('height', 900))

// ── The scenes ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} Scene
 * @property {string} name
 * @property {string} what          - what a reader is meant to look for
 * @property {('desktop'|'mobile')[]} platforms
 * @property {boolean} [video]      - record the act, and build a contact sheet
 * @property {boolean} [writes]     - true if the scene can write to the account
 * @property {(ctx: object) => Promise<void>} act
 */

/** @type {Scene[]} */
const SCENES = [
  {
    name: 'idle',
    what:
      'The page as a visitor finds it: the launcher chip and nothing else. ' +
      'Two things to check — the chip is the ONLY Deck-E on screen (a 3D body ' +
      'here as well is the "two Deck-Es" defect), and the network log shows ' +
      'whether the 7.1 MB runtime loaded without being asked for.',
    platforms: ['desktop', 'mobile'],
    async act({ page }) {
      // Long enough to be past the old idle/1.5 s auto-load window, so the
      // network log answers the A1 question rather than racing it.
      await page.waitForTimeout(6000)
    },
  },
  {
    name: 'chat-open',
    what:
      'The chat, open, with an empty conversation — the most-seen screen in ' +
      'the feature. Look at: where the composer sits, whether the composer ' +
      'reads as a card or as a pill floating on the scrim, how strong the ' +
      'scrim is, whether the app header stays sharp, and on mobile whether ' +
      'anything is under the notch or the home indicator.',
    platforms: ['desktop', 'mobile'],
    async act({ page, timing, notes }) {
      timing.mark('open:click')
      await openDeckE(page)
      timing.measure('open:click-to-composer', 'open:click')
      notes.characterArrival = await waitForCharacter(page)
      // The panel's entrance is 320 ms and he flies after arriving; this
      // photographs the settled state, not the transition (see `chat-entry`).
      await page.waitForTimeout(1800)
    },
  },
  {
    name: 'chat-entry',
    what:
      'The open transition, as motion. Frames should show: no character at ' +
      'first, then a character that grows from nothing at the button, then ' +
      'travels to its stand point. A character that is simply already there ' +
      'at full size in frame two has not got an entrance.',
    platforms: ['desktop', 'mobile'],
    video: true,
    async act({ page }) {
      await page.waitForTimeout(500) // a beat of "before" on camera
      await openDeckE(page)
      await page.waitForTimeout(3500) // the entrance and the flight
    },
  },
  {
    name: 'cold-open',
    what:
      'The tap-and-wait path, with NO warming hover — what a phone gets. ' +
      'Frames should show the chip in a loading state that reads as coming ' +
      'rather than broken, then the character arriving. The timing report ' +
      'says how long the wait actually was.',
    platforms: ['mobile'],
    video: true,
    async act({ page, timing, notes }) {
      await page.waitForTimeout(500)
      timing.mark('cold:tap')
      await openDeckE(page, { warm: false })
      timing.measure('cold:tap-to-composer', 'cold:tap')
      // THE NUMBER THIS SCENE EXISTS FOR: tap to character, with no warming
      // hover, which is what every phone gets now.
      notes.characterArrival = await waitForCharacter(page)
      timing.measure('cold:tap-to-character', 'cold:tap')
      await page.waitForTimeout(2200)
    },
  },
]

/**
 * Wait until the character is actually on screen, and say how long it took.
 *
 * A fixed `waitForTimeout` was the first version and it was wrong in both
 * directions: too short and the capture photographs an empty panel and reports
 * it as "the character did not appear", too long and every run pays for the
 * slowest case. Worse, neither tells you the number that this whole change is
 * about — how long somebody waits between tapping and Deck-E arriving.
 *
 * Returns `{ arrived, ms }`. `arrived: false` is a real answer, not an error:
 * a load can genuinely fail, and the capture should record that rather than
 * throw and lose every other artifact from the run.
 */
async function waitForCharacter(page, timeoutMs = 20_000) {
  const started = Date.now()
  try {
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas.fixed.inset-0')
        return !!c && Number(getComputedStyle(c).opacity) > 0.99
      },
      undefined,
      { timeout: timeoutMs },
    )
    return { arrived: true, ms: Date.now() - started }
  } catch {
    return { arrived: false, ms: Date.now() - started }
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/**
 * Report a produced file, and flag one that is suspiciously small.
 *
 * A blank or torn capture is the failure mode that matters here, because unlike
 * a crash it produces a file, and a file is what a caller checks for.
 */
function reportArtifact(list, label, path, minBytes = 500) {
  const size = statSync(path).size
  const small = size < minBytes
  console.log(
    `    ${label}: ${relative(repoRoot, path)} (${fmtBytes(size)})${small ? '  ⚠ SUSPICIOUSLY SMALL' : ''}`,
  )
  list.push({ label, path, bytes: size, suspiciouslySmall: small })
}

/**
 * Everything that must be true before a page is worth photographing, in the one
 * order that works: the standalone shim and the safe-area override go on BEFORE
 * navigation (app code reads them from first paint), the entitlement unlock
 * goes on the context, and sign-in happens last.
 */
async function preparePage(page, context, platform) {
  if (platform === 'mobile') {
    await applyStandaloneShim(page)
    await applySafeAreaInsets(page, IPHONE_14_PRO_PORTRAIT_INSETS)
  }
  const diag = attachDiagnostics(page)
  const payload = recordPayload(page)
  await signIn(page, BASE, qaAccount())
  return { diag, payload }
}

/**
 * Read the safe-area insets back OFF the live page.
 *
 * Setting an override and trusting it is exactly the class of mistake this
 * harness exists to catch. Chromium's default is 0px on every edge, which is
 * indistinguishable from "the app has no safe-area handling" — so a mobile
 * capture is only evidence about safe areas if the insets are non-zero, and
 * this is what says whether they were.
 */
async function readSafeArea(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText =
      'padding-top:env(safe-area-inset-top,999px);padding-bottom:env(safe-area-inset-bottom,999px)'
    document.body.appendChild(probe)
    const s = getComputedStyle(probe)
    const out = {
      top: s.paddingTop,
      bottom: s.paddingBottom,
      standalone: window.matchMedia('(display-mode: standalone)').matches,
    }
    probe.remove()
    return out
  })
}

/**
 * How many Deck-Es are on screen, and whether the runtime loaded unasked.
 *
 * `button[aria-label="Chat with Deck-E"]`, WITH the tag name, and that is not
 * belt-and-braces. `DeckeChat.tsx:436` puts the identical aria-label on the
 * PANEL, so the obvious attribute-only selector matches the open conversation
 * and reports the launcher as visible in the very state the launcher is
 * unmounted — turning "two Deck-Es on screen" from a finding into an artifact
 * of the instrument. It did exactly that, and the only reason it was caught is
 * that somebody opened the screenshot and saw one chip where the JSON claimed
 * two. Which is the argument for this whole harness, aimed at itself.
 */
async function readPresence(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0.01
    }
    const canvas = document.querySelector('canvas.fixed.inset-0')
    const launcher = document.querySelector('button[aria-label="Chat with Deck-E"]')
    const body = visible(canvas)
    const chip = visible(launcher)
    return {
      characterBodyVisible: body,
      launcherChipVisible: chip,
      // The invariant `DeckeHost.tsx:433-436` states in its own comment: the
      // chip is hidden while he is standing in the panel, because "two Deck-Es
      // is the exact thing the whole well design exists to avoid."
      twoDeckEs: body && chip,
    }
  })
}

async function runScene(browser, devices, scene, platform, timing) {
  const label = `${scene.name} · ${platform}`
  console.log(`\n  ── ${label} ─────────────────────────────`)
  const dir = join(OUT, scene.name, platform)
  mkdirSync(dir, { recursive: true })
  const artifacts = []
  const contextOptions = {
    ...(platform === 'mobile'
      ? mobileProfile(devices)
      : { ...DESKTOP_PROFILE, viewport: { width: WIDE, height: TALL } }),
    extraHTTPHeaders: bypassHeaders(),
  }

  /** Recorded once per scene run and written beside the images. */
  const notes = { scene: scene.name, platform, what: scene.what, base: BASE }

  if (scene.video) {
    // A recorded context cannot be reused, so sign-in happens inside `interact`.
    const { path: videoPath } = await recordInteraction(
      browser,
      { contextOptions, dir, name: scene.name, keepOpenFor: 700 },
      async (page, context) => {
        const unlock = await unlockDeckE(context)
        const { diag, payload } = await preparePage(page, context, platform)
        await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await scene.act({ page, context, timing, platform, notes })
        notes.entitlementShimFired = unlock.fired()
        notes.presence = await readPresence(page)
        if (platform === 'mobile') notes.safeArea = await readSafeArea(page)
        notes.characterPayload = await payload.settle(page)
        diag.writeLog(join(dir, 'console-network.json'))
        await captureViewport(page, dir, `${scene.name}.final`)
        await captureForReview(page, dir, `${scene.name}.final`)
      },
    )
    reportArtifact(artifacts, 'video', videoPath, 5000)
    reportArtifact(artifacts, 'final frame', join(dir, `${scene.name}.final.png`))
    const sheet = await buildContactSheet(videoPath, join(dir, `${scene.name}.contact-sheet.png`), {
      frames: 12,
    })
    reportArtifact(
      artifacts,
      `contact sheet (${sheet.columns}×${sheet.rows}, ${sheet.frames} frames)`,
      sheet.path,
      5000,
    )
  } else {
    const context = await browser.newContext(contextOptions)
    const unlock = await unlockDeckE(context)
    const page = await context.newPage()
    try {
      const { diag, payload } = await preparePage(page, context, platform)
      await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await scene.act({ page, context, timing, platform, notes })
      notes.entitlementShimFired = unlock.fired()
      notes.presence = await readPresence(page)
      if (platform === 'mobile') notes.safeArea = await readSafeArea(page)
      notes.characterPayload = await payload.settle(page)
      diag.writeLog(join(dir, 'console-network.json'))
      const shots = await captureScreenshots(page, dir, scene.name)
      reportArtifact(artifacts, 'viewport', shots.viewport)
      reportArtifact(artifacts, 'fullpage', shots.fullPage, 2000)
      reportArtifact(artifacts, 'review copy (open THIS one)', await captureForReview(page, dir, scene.name))
    } finally {
      await context.close()
    }
  }

  writeFileSync(join(dir, 'notes.json'), JSON.stringify(notes, null, 2))
  console.log(`    presence: ${JSON.stringify(notes.presence)}`)
  if (notes.characterArrival) {
    const a = notes.characterArrival
    console.log(`    character arrival: ${a.arrived ? `${a.ms} ms` : `NEVER (gave up after ${a.ms} ms)`}`)
  }
  if (notes.safeArea) console.log(`    safe area: ${JSON.stringify(notes.safeArea)}`)
  const cp = notes.characterPayload
  console.log(
    `    character runtime: ${cp.count} requests, ${fmtPayload(cp.bytes)}` +
      (cp.unmeasured ? ` (${cp.unmeasured} unmeasured)` : '') +
      (cp.firstAtMs == null ? ' — none' : `, first at ${cp.firstAtMs} ms`),
  )
  if (notes.entitlementShimFired) {
    console.log('    NOTE: the /api/me entitlement shim FIRED — this account is not really entitled.')
  }
  return artifacts
}

async function main() {
  if (flag('list')) {
    console.log('Scenes:\n')
    for (const s of SCENES) {
      console.log(`  ${s.name}  [${s.platforms.join(', ')}]${s.video ? ' (video)' : ''}${s.writes ? ' (WRITES)' : ''}`)
      console.log(`    ${s.what.replace(/\s+/g, ' ')}\n`)
    }
    return
  }

  const want = arg('scene', null)
  if (!want) {
    console.error('Pass --scene <name> (or --scene all). --list shows what there is.')
    process.exitCode = 1
    return
  }
  const chosen = want === 'all' ? SCENES : SCENES.filter((s) => s.name === want)
  if (!chosen.length) {
    console.error(`No scene named "${want}". Known: ${SCENES.map((s) => s.name).join(', ')}`)
    process.exitCode = 1
    return
  }

  const { chromium, devices } = await resolvePlaywright()
  console.log(
    `Deck-E visual capture — base ${BASE}, out ${OUT}, headless=${!HEADED}\n` +
      'Signed in as the QA account (.qa-account) — never the owner. AGENTS.md B12.',
  )

  const browser = await chromium.launch({ headless: !HEADED })
  const timing = new TimingReport()
  const artifacts = []
  try {
    for (const scene of chosen) {
      for (const platform of scene.platforms) {
        if (ONLY !== 'all' && ONLY !== platform) continue
        artifacts.push(...(await runScene(browser, devices, scene, platform, timing)))
      }
    }
    timing.save(join(OUT, 'timing-report.json'))
  } finally {
    await browser.close()
  }

  console.log(`\nArtifacts under: ${OUT}`)
  if (artifacts.some((a) => a.suspiciouslySmall)) {
    console.error('\nOne or more artifacts were suspiciously small — look at them before trusting this run.')
    process.exitCode = 1
  } else if (!artifacts.length) {
    console.error('\nNo artifacts were produced — nothing was verified.')
    process.exitCode = 1
  } else {
    console.log('\nCapture OK. Now go and LOOK at them; this script asserted nothing.')
  }
}

main().catch((err) => {
  console.error('\nDeck-E visual capture FAILED:', err)
  process.exitCode = 1
})
