#!/usr/bin/env node
/**
 * Does Deck-E change SIZE when nothing about the viewport changed?
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
 *
 * The 2026-08-24 review's most frequent complaint, fourteen tagged instances of
 * it, was that his size pops to a new value in one frame — "he all of a sudden
 * just grew in size for no reason" — paired with a shift down and to the left
 * and a corrective hop a beat later. Reading the tape frame by frame, every
 * instance brackets a stretch of the user TYPING: the composer's textarea grows
 * a line, and he grows with it, because `DeckeHost.characterHeightBeside()`
 * rules him off the composer's LIVE height.
 *
 * A vision model cannot settle "is he 1.6x bigger than he was", and a contact
 * sheet of a 20-minute session cannot either. This measures him in pixels:
 * photograph him, find his silhouette, type into the composer, photograph him
 * again. The number it prints is the ratio, and the claim it gates is that the
 * ratio is 1.
 *
 * It ASSERTS by exit code, unlike `capture-decke.mjs`, because the thing it
 * measures is a scalar with a right answer rather than a picture someone has to
 * have an opinion about.
 *
 *   node scripts/visual-harness/probe-decke-size.mjs --base http://localhost:5199
 *   node scripts/visual-harness/probe-decke-size.mjs --headed --keep
 *
 * Exit 0 if he holds his size, 1 if he does not, 4 on a harness error.
 *
 * ── HOW HE IS MEASURED ───────────────────────────────────────────────────────
 *
 * By his SHELL COLOUR, not by any number the app reports about itself. An
 * instrument that asks the code under test how big it thinks it is cannot catch
 * the code being wrong, and the whole defect here is a disagreement between the
 * height the host computes and the size the owner sees. So: screenshot the
 * viewport, keep the pixels inside his teal band, and take the bounding box of
 * the LARGEST CONNECTED blob of them — see `silhouette` for why the connected
 * part is load-bearing rather than tidy.
 *
 * ── SAFETY (AGENTS.md B12) ───────────────────────────────────────────────────
 *
 * Signs in as the QA account from `.qa-account`, never the owner's. It TYPES
 * into the composer and never sends: no turn is started, no tool runs, nothing
 * is written. The draft is cleared before the run ends.
 *
 * ── PREREQUISITES ────────────────────────────────────────────────────────────
 *
 *   pnpm dev                                          # or --base <a deployment>
 *   export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright
 *   .qa-account present at the repo root
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { DESKTOP_PROFILE } from './lib/devices.mjs'
import { bypassHeaders, HOME_PATH, openDeckE, qaAccount, signIn, unlockDeckE } from './lib/session.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const BASE = arg('base', 'http://localhost:5199').replace(/\/$/, '')
const OUT = arg('out', join(repoRoot, '.visual-harness', arg('run', 'size-probe')))
const HEADED = flag('headed')

/**
 * The largest fraction of his height he may gain or lose while the viewport
 * holds still.
 *
 * Not zero. He BREATHES — `procedural.ts`'s idle float moves him a little over
 * a ~2.4 s cycle, and the samples either side of a typing burst are seconds
 * apart and land wherever that cycle happens to be. Measured across ten
 * back-to-back samples with nothing touched, the spread is under 2%. The defect
 * this gates is 60%, so 6% separates them with room to spare and still fails a
 * single extra composer row (which is ~40% on a 56px composer).
 */
const TOLERANCE = 0.06

/**
 * His shell, sampled off the review recording (`capture-20260824-221854`,
 * t=365s) and again off this harness's own frames: the lit face reads
 * ~(101,168,175), the shadowed one ~(62,124,131), the highlight ~(164,211,218).
 * Teal, i.e. green and blue within a few units of each other and both well
 * clear of red.
 *
 * The app's own accent cyan is a different colour and this band is what
 * separates them: `#22d3ee` (34,211,238) leads blue over green by 27 and the
 * sidebar's active icon (15,145,164) by 19, where every sample of HIM is
 * between +6 and +11. The band tests the RELATIONSHIP between the channels for
 * exactly that reason, rather than a distance to one colour — but it is a
 * coarse filter, and the connected-component pass below is what actually
 * settles which teal thing on screen is him.
 */
function isShell(r, g, b) {
  return g > 90 && g < 235 && b - g < 16 && b - g > -24 && g - r > 45
}

/**
 * His bounding box in CSS pixels, or `null` if he is not on screen.
 *
 * THE LARGEST CONNECTED BLOB OF SHELL COLOUR, PLUS WHATEVER TOUCHES IT — not
 * the bounding box of every pixel that passes the band, and not the largest
 * blob on its own. Both of the simpler versions were written first and both
 * measured the wrong thing:
 *
 *   - The GLOBAL box read 570px of "him" on a 900px viewport. The DeckPal
 *     wordmark and the sidebar's active-row icon both sit inside any band loose
 *     enough to hold his shadowed faces, so the box spanned the window and
 *     would have reported "no change" whatever he did.
 *   - The LARGEST BLOB alone read 199px at rest and 147px with a draft, and
 *     called a passing fix a 26% shrink. He had not moved a pixel: his mouth
 *     was open in the second frame, and an open mouth cuts the front panel in
 *     two. Measured: one blob of 13,762 px became two of 9,154 and 4,170, whose
 *     union is 200px tall against the first frame's 199.
 *
 * So: find the biggest blob, then absorb every other blob that overlaps the box
 * so far, until nothing new is absorbed. His parts touch each other; the
 * wordmark is four hundred pixels away and never joins.
 *
 * Four-connected, iterative — a recursive flood fill blows the stack on a blob
 * this size.
 */

/**
 * How far outside the running box a blob may sit and still be part of him.
 *
 * His mouth splits the panel with a gap of a pixel or two, so a strict overlap
 * test is enough in practice and this margin is slack for the antialiasing at
 * the cut. Small on purpose: the composer's own teal border runs 712 px across
 * the frame a few pixels under him on a phone layout, and a generous margin
 * would swallow it and report a character twice his width.
 */
const JOIN_SLOP = 4

/**
 * A blob thinner than this is a RULE, not a body — the composer's focus border,
 * a divider, the underline on a link. He is never two pixels thick anywhere,
 * and admitting one of these stretches the box across the whole window.
 */
const MIN_THICKNESS = 4

async function silhouette(pngBuffer, dpr) {
  // Halved first. Five million pixels is a second of flood fill for a
  // measurement quoted to the nearest CSS pixel; at half scale the fill is a
  // quarter of the work and the answer is still far finer than the 6% the
  // verdict turns on.
  const meta = await sharp(pngBuffer).metadata()
  const { data, info } = await sharp(pngBuffer)
    .resize({ width: Math.round(meta.width / 2) })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const scale = dpr / 2
  const mask = new Uint8Array(width * height)
  for (let i = 0, p = 0; p < mask.length; p++, i += channels) {
    if (isShell(data[i], data[i + 1], data[i + 2])) mask[p] = 1
  }

  const seen = new Uint8Array(mask.length)
  const stack = new Int32Array(mask.length)
  const blobs = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    let top = 0
    stack[top++] = start
    seen[start] = 1
    let count = 0
    let x0 = width
    let x1 = -1
    let y0 = height
    let y1 = -1
    while (top > 0) {
      const p = stack[--top]
      const x = p % width
      const y = (p - x) / width
      count++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (x > 0 && mask[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), (stack[top++] = p - 1)
      if (x + 1 < width && mask[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), (stack[top++] = p + 1)
      if (y > 0 && mask[p - width] && !seen[p - width]) (seen[p - width] = 1), (stack[top++] = p - width)
      if (y + 1 < height && mask[p + width] && !seen[p + width])
        (seen[p + width] = 1), (stack[top++] = p + width)
    }
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    if (Math.min(w, h) < MIN_THICKNESS) continue
    blobs.push({ count, x0, x1, y0, y1 })
  }
  if (!blobs.length) return null
  blobs.sort((a, b) => b.count - a.count)

  const box = { ...blobs[0] }
  const taken = new Set([0])
  for (let changed = true; changed; ) {
    changed = false
    for (let i = 1; i < blobs.length; i++) {
      if (taken.has(i)) continue
      const b = blobs[i]
      const apart =
        b.x0 > box.x1 + JOIN_SLOP ||
        b.x1 < box.x0 - JOIN_SLOP ||
        b.y0 > box.y1 + JOIN_SLOP ||
        b.y1 < box.y0 - JOIN_SLOP
      if (apart) continue
      taken.add(i)
      box.x0 = Math.min(box.x0, b.x0)
      box.x1 = Math.max(box.x1, b.x1)
      box.y0 = Math.min(box.y0, b.y0)
      box.y1 = Math.max(box.y1, b.y1)
      box.count += b.count
      changed = true
    }
  }
  // A blob smaller than a favicon is not a character. Returning `null` rather
  // than a tiny box is what lets the caller say "he was not on screen" instead
  // of quietly comparing two pieces of chrome.
  if (box.count < 400) return null
  return {
    left: Math.round(box.x0 / scale),
    right: Math.round(box.x1 / scale),
    top: Math.round(box.y0 / scale),
    bottom: Math.round(box.y1 / scale),
    w: Math.round((box.x1 - box.x0 + 1) / scale),
    h: Math.round((box.y1 - box.y0 + 1) / scale),
    px: box.count,
  }
}

/** Photograph him and measure, saving the frame beside the report. */
async function measure(page, label, dpr) {
  const shot = await page.screenshot({ type: 'png' })
  writeFileSync(join(OUT, `${label}.png`), shot)
  const box = await silhouette(shot, dpr)
  return box
}

/**
 * The composer's own box, which is the ruler the host sizes him against.
 *
 * Reported alongside him so a failure says WHICH of the two moved — a run where
 * the composer grew and he did not is the fix working, and a run where neither
 * moved means the typing never landed and the probe measured nothing.
 */
async function composerBox(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-decke-composer]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: Math.round(r.top), left: Math.round(r.left), h: Math.round(r.height) }
  })
}

/**
 * Long enough for a composer move to be chased all the way to a landing.
 *
 * `markWatch.MARK_WATCH_MS` (100) samples the composer, `MARK_SETTLE_MS` (420)
 * is the trailing debounce, and the re-park is a flight that has to land. Two
 * seconds covers all three with margin; the probe is not measuring latency and
 * a generous wait is what keeps it from reading a frame mid-hop.
 */
const SETTLE_MS = 2000

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
  const dpr = DESKTOP_PROFILE.deviceScaleFactor ?? 1

  const report = { base: BASE, tolerance: TOLERANCE, samples: [] }
  try {
    await signIn(page, BASE, account)
    await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded' })
    const composer = await openDeckE(page)
    await page.waitForFunction(() => !!window.__decke, undefined, { timeout: 60_000 })
    // He arrives via a flight; measuring while he is still flying measures the
    // trip, not the destination.
    await page.waitForFunction(
      () => {
        const d = window.__decke
        return !!d && d.entryScale >= 1 && !d.getState().flying
      },
      undefined,
      { timeout: 60_000 },
    )
    await page.waitForTimeout(SETTLE_MS)

    const rest = await measure(page, '1-rest', dpr)
    const restComposer = await composerBox(page)
    report.samples.push({ label: 'rest', him: rest, composer: restComposer })
    if (!rest) throw new Error('could not find him on screen at rest — the colour band or the scene is wrong')

    // A draft long enough to force the textarea past one row. Typed, never
    // sent: `fill` sets the value in one go, which is what a paste does and
    // what the auto-grow effect measures either way.
    await composer.fill(
      'Show me every Base Set holo I still need, sorted by what it would cost ' +
        'me to finish the set, and tell me which three are the best value right now.',
    )
    await page.waitForTimeout(SETTLE_MS)

    const typed = await measure(page, '2-typed', dpr)
    const typedComposer = await composerBox(page)
    report.samples.push({ label: 'typed', him: typed, composer: typedComposer })
    if (!typed) throw new Error('could not find him on screen with a draft in the composer')

    // And back, so a run also proves the return leg is symmetric rather than
    // leaving him at whatever the draft made him.
    await composer.fill('')
    await page.waitForTimeout(SETTLE_MS)
    const cleared = await measure(page, '3-cleared', dpr)
    report.samples.push({ label: 'cleared', him: cleared, composer: await composerBox(page) })

    const grew = (typedComposer?.h ?? 0) - (restComposer?.h ?? 0)
    report.composerGrewPx = grew
    const ratio = typed.h / rest.h
    const backRatio = cleared ? cleared.h / rest.h : null
    report.heightRatioTyped = Number(ratio.toFixed(4))
    report.heightRatioCleared = backRatio === null ? null : Number(backRatio.toFixed(4))

    console.log(`\n  base ${BASE}`)
    console.log(`  composer   ${restComposer?.h}px at rest → ${typedComposer?.h}px with a draft (+${grew}px)`)
    console.log(`  him        ${rest.h}px at rest → ${typed.h}px with a draft → ${cleared?.h ?? '?'}px cleared`)
    console.log(`  position   top ${rest.top},${rest.left} → ${typed.top},${typed.left}`)
    console.log(`  ratio      ${ratio.toFixed(3)} (tolerance ±${TOLERANCE})`)

    if (grew <= 0) {
      report.verdict = 'inconclusive'
      console.log('\n  INCONCLUSIVE — the composer never grew, so nothing was exercised.\n')
      writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
      return 4
    }
    const ok =
      Math.abs(ratio - 1) <= TOLERANCE && (backRatio === null || Math.abs(backRatio - 1) <= TOLERANCE)
    report.verdict = ok ? 'pass' : 'fail'
    console.log(
      ok
        ? '\n  PASS — he held his size while the composer grew.\n'
        : '\n  FAIL — he changed size because the composer did.\n',
    )
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`  frames + report: ${OUT}\n`)
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
