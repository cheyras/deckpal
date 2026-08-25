/**
 * Screenshot helper — predictable paths, both crops every gate wants.
 *
 * `viewport` (fullPage: false) is what a real user's screen shows right now;
 * `fullPage` is the whole scrollable document, which matters for e.g. the FAQ
 * section or anything below the fold. Deck-E's chat overlay is fixed-position,
 * so a fullPage capture of a screen with it open shows it exactly once, at its
 * true on-screen scale — not stretched or duplicated down the page.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripDevChrome } from './dev-chrome.mjs'

/**
 * EVERY capture in this directory goes through one of the three functions
 * below, so the dev ribbon is removed HERE rather than by each caller
 * remembering to.
 *
 * It was a shared helper before this and callers still forgot it: two scripts
 * called it and `capture-decke.mjs` — the primary instrument, the one named in
 * STATE.md as proof a script "cannot forget it" — did not. Its review JPEG had
 * the amber ribbon lying across the composer and Deck-E's feet, which is the
 * exact confound that has produced three false bug reports in this codebase.
 *
 * A helper you can decline to call is documentation. This is the choke point.
 */
async function beforeShot(page) {
  await stripDevChrome(page).catch(() => {})
}

/**
 * @param {import('playwright').Page} page
 * @param {string} dir - directory the two PNGs are written into (created if missing)
 * @param {string} name - basename, without extension
 * @returns {Promise<{ viewport: string, fullPage: string }>}
 */
export async function captureScreenshots(page, dir, name) {
  await beforeShot(page)
  mkdirSync(dir, { recursive: true })
  const viewportPath = join(dir, `${name}.viewport.png`)
  const fullPagePath = join(dir, `${name}.fullpage.png`)
  await page.screenshot({ path: viewportPath, fullPage: false })
  await page.screenshot({ path: fullPagePath, fullPage: true })
  return { viewport: viewportPath, fullPage: fullPagePath }
}

/**
 * A second, small copy of the same frame, for LOOKING at.
 *
 * The full-resolution PNG is the evidence; this is the thing a person actually
 * opens. The desktop profile runs at `deviceScaleFactor: 2`, so a viewport shot
 * is 2880×1800 and a couple of megabytes — too big to read comfortably, and far
 * too big to hand to a vision model, which is the other reader these artifacts
 * have.
 *
 * `scale: 'css'` is why this needs no image tooling at all. It tells Chromium to
 * rasterise at CSS pixel size rather than device pixel size, so the browser that
 * already has the page open does the downscale, and the harness does not acquire
 * an ffmpeg or ImageMagick dependency for the sake of making a picture smaller.
 * JPEG at 82 because these are screenshots of a dark UI, where the difference is
 * invisible and the file is an order of magnitude smaller.
 *
 * It is a COPY, never a replacement: an artifact you can read easily and an
 * artifact that shows the truth are both needed, and compressing the only one
 * you have is how a subtle rendering defect gets attributed to the compressor.
 */
export async function captureForReview(page, dir, name) {
  await beforeShot(page)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `${name}.review.jpg`)
  await page.screenshot({ path: p, fullPage: false, scale: 'css', type: 'jpeg', quality: 82 })
  return p
}

/** Just the one crop, when a spec only needs it (e.g. mid-animation frames). */
export async function captureViewport(page, dir, name) {
  await beforeShot(page)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  return p
}
