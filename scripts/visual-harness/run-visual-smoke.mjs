/**
 * End-to-end proof that the visual-verification harness (scripts/visual-
 * harness/lib/*) actually works: loads DeckPal SIGNED OUT, screenshots
 * desktop + mobile, records a short video of a real interaction, builds a
 * contact sheet from it, proves the safe-area-inset CDP override against the
 * live page, and writes a timing + diagnostics report.
 *
 * This is a smoke test for the HARNESS, not a gate on the product — unlike
 * `scripts/decke-gates.mjs`, it makes no pass/fail assertions about DeckPal's
 * behavior. It exits non-zero only if an artifact genuinely failed to
 * produce.
 *
 * SAFETY (AGENTS.md B12): runs entirely signed out, against whatever `--base`
 * points at (default: the local dev server at :5199). It clicks nothing but a
 * client-side FAQ accordion on the public landing page — no sign-in, no
 * writes, no `/api/bugs`.
 *
 *   node scripts/visual-harness/run-visual-smoke.mjs                     # desktop + mobile + video
 *   node scripts/visual-harness/run-visual-smoke.mjs --only desktop      # desktop screenshots only
 *   node scripts/visual-harness/run-visual-smoke.mjs --only mobile       # mobile screenshots + video + contact sheet
 *   node scripts/visual-harness/run-visual-smoke.mjs --base http://localhost:5200
 *   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/visual-harness/run-visual-smoke.mjs
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { DESKTOP_PROFILE, mobileProfile } from './lib/devices.mjs'
import { captureScreenshots } from './lib/screenshot.mjs'
import { recordInteraction } from './lib/video.mjs'
import { buildContactSheet } from './lib/contact-sheet.mjs'
import { attachDiagnostics } from './lib/diagnostics.mjs'
import { TimingReport } from './lib/timing.mjs'
import { applySafeAreaInsets, applyStandaloneShim, IPHONE_14_PRO_PORTRAIT_INSETS } from './lib/pwa-emulation.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const BASE = arg('base', 'http://localhost:5199').replace(/\/$/, '')
const RUN = arg('run', 'smoke')
const OUT = arg('out', join(repoRoot, '.visual-harness', RUN))
const HEADED = flag('headed')
const ONLY = arg('only', 'all') // 'desktop' | 'mobile' | 'all'
const RUN_DESKTOP = ONLY === 'all' || ONLY === 'desktop'
const RUN_MOBILE = ONLY === 'all' || ONLY === 'mobile'
if (!RUN_DESKTOP && !RUN_MOBILE) {
  console.error(`--only must be "desktop", "mobile", or "all" (got "${ONLY}")`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** Print size + confirm the file is not suspiciously tiny (a common "blank capture" smell). */
function reportArtifact(label, path, minBytes = 500) {
  const size = statSync(path).size
  const flagged = size < minBytes ? '  ⚠ SUSPICIOUSLY SMALL' : ''
  console.log(`  ${label}: ${path} (${fmtBytes(size)})${flagged}`)
  return { label, path, bytes: size, suspiciouslySmall: size < minBytes }
}

async function main() {
  const { chromium, devices } = await resolvePlaywright()
  console.log(`Visual harness smoke run — base ${BASE}, out ${OUT}, headless=${!HEADED}`)

  const browser = await chromium.launch({ headless: !HEADED })
  const timing = new TimingReport()
  const artifacts = []

  try {
    // ── Desktop: screenshots of the signed-out landing page ──────────────────
    if (RUN_DESKTOP) {
    timing.mark('desktop:start')
    const desktopContext = await browser.newContext({ ...DESKTOP_PROFILE })
    const desktopPage = await desktopContext.newPage()
    const desktopDiag = attachDiagnostics(desktopPage)
    await desktopPage.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 })
    timing.measure('desktop:load', 'desktop:start')
    const desktopShots = await captureScreenshots(desktopPage, join(OUT, 'desktop'), 'landing')
    artifacts.push(reportArtifact('desktop viewport', desktopShots.viewport))
    artifacts.push(reportArtifact('desktop fullpage', desktopShots.fullPage, 2000))
    const desktopLogPath = desktopDiag.writeLog(join(OUT, 'desktop', 'console-network.json'))
    console.log(`  desktop diagnostics: ${desktopLogPath}`)
    await desktopContext.close()
    }

    // ── Mobile: iPhone 14 Pro emulation + standalone-PWA shim + safe-area ────
    if (RUN_MOBILE) {
    timing.mark('mobile:start')
    const mobileContext = await browser.newContext({ ...mobileProfile(devices) })
    const mobilePage = await mobileContext.newPage()
    await applyStandaloneShim(mobilePage) // before navigation, so app code sees it from first paint
    await applySafeAreaInsets(mobilePage, IPHONE_14_PRO_PORTRAIT_INSETS)
    const mobileDiag = attachDiagnostics(mobilePage)
    await mobilePage.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 })
    timing.measure('mobile:load', 'mobile:start')

    // Prove the standalone shim and the safe-area CDP override actually took
    // effect on THIS page (not just a synthetic data: URL) — read them back
    // rather than trusting the call that set them.
    const pwaProbe = await mobilePage.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.cssText = 'padding-top:env(safe-area-inset-top,999px);padding-bottom:env(safe-area-inset-bottom,999px)'
      document.body.appendChild(probe)
      const style = getComputedStyle(probe)
      const result = {
        displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
        navigatorStandalone: window.navigator.standalone,
        safeAreaInsetTop: style.paddingTop,
        safeAreaInsetBottom: style.paddingBottom,
      }
      probe.remove()
      return result
    })
    console.log(`  PWA/safe-area probe on live page: ${JSON.stringify(pwaProbe)}`)
    mkdirSync(join(OUT, 'mobile'), { recursive: true })
    writeFileSync(join(OUT, 'mobile', 'pwa-safe-area-probe.json'), JSON.stringify(pwaProbe, null, 2))

    const mobileShots = await captureScreenshots(mobilePage, join(OUT, 'mobile'), 'landing')
    artifacts.push(reportArtifact('mobile viewport', mobileShots.viewport))
    artifacts.push(reportArtifact('mobile fullpage', mobileShots.fullPage, 2000))
    const mobileLogPath = mobileDiag.writeLog(join(OUT, 'mobile', 'console-network.json'))
    console.log(`  mobile diagnostics: ${mobileLogPath}`)
    await mobileContext.close()

    // ── Video + contact sheet: FAQ accordion open, a real client-side
    //    animation, on the public landing page (no sign-in required) ─────────
    const { path: videoPath } = await recordInteraction(
      browser,
      { contextOptions: { ...mobileProfile(devices) }, dir: join(OUT, 'mobile'), name: 'faq-interaction', keepOpenFor: 600 },
      async (page) => {
        await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 })
        // Landing's FAQ opens its first item by default (`useState(0)`), so
        // .first() here would already be aria-expanded="true" and a click
        // would COLLAPSE it — the opposite of the "expand" predicate below.
        // .nth(1) starts closed.
        const faqButton = page.locator('button[aria-expanded]').nth(1)
        await faqButton.scrollIntoViewIfNeeded()
        await page.waitForTimeout(300) // let scroll settle before the clock starts
        timing.mark('faq:click')
        await faqButton.click()
        await page.waitForFunction(
          (el) => el?.getAttribute('aria-expanded') === 'true',
          await faqButton.elementHandle(),
          { timeout: 5000 },
        )
        timing.measure('faq:click-to-expanded', 'faq:click')
        await page.waitForTimeout(500) // let the expand transition finish on camera
      },
    )
    artifacts.push(reportArtifact('interaction video', videoPath, 5000))

    const sheet = await buildContactSheet(videoPath, join(OUT, 'mobile', 'faq-interaction.contact-sheet.png'), {
      frames: 9,
    })
    artifacts.push(reportArtifact(`contact sheet (${sheet.columns}x${sheet.rows} grid, ${sheet.frames} frames)`, sheet.path, 5000))
    }

    const timingPath = timing.save(join(OUT, 'timing-report.json'))
    console.log(`  timing report: ${timingPath}`)

    console.log(`\nAll artifacts under: ${OUT}`)
    const anySmall = artifacts.some((a) => a.suspiciouslySmall)
    if (anySmall) {
      console.error('\nOne or more artifacts were suspiciously small — inspect them before trusting this run.')
      process.exitCode = 1
    } else {
      console.log('\nSmoke run OK — every artifact produced a non-trivial file.')
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error('\nVisual harness smoke run FAILED:', err)
  process.exit(1)
})
