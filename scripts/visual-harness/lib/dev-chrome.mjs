/**
 * Take the dev server's own chrome out of the shot.
 *
 * ── THIS HAS PRODUCED THREE FALSE BUG REPORTS ────────────────────────────────
 *
 * `DevBackendRibbon` is `fixed bottom-0 z-[9999]` and lies across the bottom of
 * every screenshot taken against a dev server. It is not in the product. It has
 * now been read as a defect three separate times:
 *
 *   1. "the composer is cut off at the bottom" — it was the ribbon.
 *   2. "Deck-E sits bottom-right and is clipped by the pane edge" — reported by
 *      a reviewer working from a capture that did not strip it.
 *   3. And by me, reading that same capture and starting to look for a missing
 *      horizontal clamp in `dom.ts` that turned out to be present and correct.
 *
 * Each time the reasoning downstream was sound and the pixels were lying. So it
 * lives here rather than being copied into each capture script: a script that
 * forgets it produces a picture that will be reviewed as if it were the product,
 * and the forgetting is silent.
 *
 * Call it after the page has settled and before every screenshot.
 */
export async function stripDevChrome(page) {
  const removed = await page.evaluate(() => {
    let n = 0
    for (const el of document.querySelectorAll('div')) {
      if (el.textContent?.startsWith('LIVE DATA ·') && getComputedStyle(el).position === 'fixed') {
        el.remove()
        n++
      }
    }
    return n
  })
  return removed
}
