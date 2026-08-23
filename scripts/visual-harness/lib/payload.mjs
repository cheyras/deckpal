/**
 * What a page actually downloaded, and how much of it.
 *
 * ── WHY THIS IS SEPARATE FROM `diagnostics.mjs` ──────────────────────────────
 *
 * That module records only FAILURES — console errors and requests that did not
 * come back. That is the right shape for "did anything go wrong". It is the
 * wrong shape for the question this one answers, which is about requests that
 * succeeded perfectly and should never have been made at all.
 *
 * The specific question: Deck-E's character runtime is a little over seven
 * megabytes, and it was being fetched on a timer, for every visitor, on every
 * page, whether or not anyone ever spoke to him. "Is that still happening?"
 * cannot be answered by a screenshot — an eagerly-loaded character and a
 * lazily-loaded one look identical once both have loaded, and the difference is
 * entirely in what crossed the wire and when. So this records the wire.
 *
 * ── MEASURED, NOT CITED ──────────────────────────────────────────────────────
 *
 * `transferBytes` comes from `response.body()`, so a payload figure produced
 * here is a measurement of this run rather than a number copied forward from a
 * document. That matters: the figure this project carried for a year — "6.9 MB"
 * — was wrong, and it was wrong because everyone quoting it was quoting each
 * other. Bodies are read only for requests matching a caller's pattern, because
 * reading every body on a page would double its memory for no purpose.
 */

/** Everything the character costs, by URL shape. Keep in step with `vite.config.ts`. */
export const CHARACTER_RUNTIME = /(models\/decke\/|assets\/Decke-[^/]*\.js)/

/**
 * Start recording. Attach BEFORE navigating — a listener added afterwards
 * misses exactly the requests a cold-load question is about.
 *
 * @param {import('playwright').Page} page
 * @param {RegExp} [measure] bodies are read (and sized) only for matching URLs
 */
export function recordPayload(page, measure = CHARACTER_RUNTIME) {
  const startedAt = Date.now()
  /** @type {{tMs:number,url:string,method:string,type:string,status?:number,bytes?:number}[]} */
  const requests = []
  const byUrl = new Map()

  page.on('request', (req) => {
    const entry = {
      tMs: Date.now() - startedAt,
      url: req.url(),
      method: req.method(),
      type: req.resourceType(),
    }
    requests.push(entry)
    byUrl.set(req, entry)
  })

  page.on('response', async (res) => {
    const entry = byUrl.get(res.request())
    if (!entry) return
    entry.status = res.status()
    if (!measure.test(entry.url)) return
    try {
      // `body()` on a response the page has already consumed can throw; a
      // measurement that fails must not take the run down with it, so the
      // entry simply keeps no `bytes` and `total()` says how many are missing.
      entry.bytes = (await res.body()).byteLength
    } catch {
      entry.bytesUnavailable = true
    }
  })

  const matching = (re = measure) => requests.filter((r) => re.test(r.url))

  return {
    requests,
    matching,
    /**
     * Bytes across matching requests, plus how many could not be measured — so
     * a caller can tell "nothing was downloaded" from "we failed to look".
     */
    total(re = measure) {
      const hits = matching(re)
      return {
        count: hits.length,
        bytes: hits.reduce((n, r) => n + (r.bytes ?? 0), 0),
        unmeasured: hits.filter((r) => r.bytes == null).length,
        firstAtMs: hits.length ? Math.min(...hits.map((r) => r.tMs)) : null,
        urls: hits.map((r) => r.url.replace(/^https?:\/\/[^/]+/, '')),
      }
    },
    /** A settled snapshot. Await this before reading totals — response handlers are async. */
    async settle(page_, quietMs = 500) {
      await page_.waitForTimeout(quietMs)
      return this.total()
    },
  }
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
