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
import { dirname, join } from 'node:path'

/**
 * @param {import('playwright').Page} page
 * @param {string} dir - directory the two PNGs are written into (created if missing)
 * @param {string} name - basename, without extension
 * @returns {Promise<{ viewport: string, fullPage: string }>}
 */
export async function captureScreenshots(page, dir, name) {
  mkdirSync(dir, { recursive: true })
  const viewportPath = join(dir, `${name}.viewport.png`)
  const fullPagePath = join(dir, `${name}.fullpage.png`)
  await page.screenshot({ path: viewportPath, fullPage: false })
  await page.screenshot({ path: fullPagePath, fullPage: true })
  return { viewport: viewportPath, fullPage: fullPagePath }
}

/** Just the one crop, when a spec only needs it (e.g. mid-animation frames). */
export async function captureViewport(page, dir, name) {
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `${name}.png`)
  await page.screenshot({ path: p, fullPage: false })
  return p
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true })
  return path
}

export function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true })
  return filePath
}
