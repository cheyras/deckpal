/**
 * Video capture for one interaction.
 *
 * Playwright only records video for a context created WITH `recordVideo` set
 * (it cannot be turned on for an already-open page), and the file is only
 * finalized — readable, correct duration — once the page that used it is
 * closed. So this helper owns the whole lifecycle: it creates a fresh
 * context+page scoped to exactly the interaction being recorded, hands the
 * page to the caller's `interact` function, then closes the page/context and
 * moves the resulting `.webm` to a predictable path (Playwright names the raw
 * file by an internal GUID, not by anything the caller chose).
 *
 * Because video recording needs its own context, it cannot share cookies /
 * origin state with a context created earlier in the same spec unless the
 * caller re-establishes that state inside `interact` (e.g. by re-navigating).
 * For a signed-out, read-only interaction — the only kind this harness's
 * specs are allowed to run — that is just a `page.goto()` at the top of
 * `interact`.
 */
import { copyFileSync, mkdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * @param {import('playwright').Browser} browser
 * @param {object} opts
 * @param {object} [opts.contextOptions] - passed to browser.newContext() (viewport, device profile, etc.)
 * @param {{width:number,height:number}} [opts.size] - video frame size; defaults to contextOptions.viewport or 1280x720
 * @param {string} opts.dir - directory the final .webm is written into
 * @param {string} opts.name - basename, without extension
 * @param {(page: import('playwright').Page, context: import('playwright').BrowserContext) => Promise<void>} interact
 *   Read anything you need off `page`/`context` (diagnostics, extra
 *   screenshots) BEFORE `interact` returns — both are closed immediately
 *   after, to finalize the video file.
 * @returns {Promise<{ path: string }>}
 */
export async function recordInteraction(browser, { contextOptions = {}, size, dir, name, keepOpenFor }, interact) {
  mkdirSync(dir, { recursive: true })
  const rawDir = join(tmpdir(), `deckpal-visual-harness-video-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(rawDir, { recursive: true })

  const videoSize = size ?? contextOptions.viewport ?? { width: 1280, height: 720 }

  const context = await browser.newContext({
    ...contextOptions,
    recordVideo: { dir: rawDir, size: videoSize },
  })
  const page = await context.newPage()
  try {
    await interact(page, context)
    // Playwright's recorder samples on a timer; without a short settle it can
    // clip the last visible frame of an animation that finishes right as
    // `interact` returns.
    if (keepOpenFor) await page.waitForTimeout(keepOpenFor)
  } finally {
    await page.close() // finalizes the video file
  }
  const rawPath = await page.video()?.path()
  await context.close()

  if (!rawPath) {
    throw new Error('Playwright produced no video path — was recordVideo actually applied to this context?')
  }
  const finalPath = join(dir, `${name}.webm`)
  // copy + unlink, not rename: the raw file lives under the OS temp dir, which
  // is very likely on a different drive than the repo on Windows (C: vs. a
  // project checked out on E:), and `rename`/`renameSync` refuses a
  // cross-device move (EXDEV) rather than falling back to a copy itself.
  copyFileSync(rawPath, finalPath)
  unlinkSync(rawPath)
  rmSync(rawDir, { recursive: true, force: true })
  return { path: finalPath }
}
