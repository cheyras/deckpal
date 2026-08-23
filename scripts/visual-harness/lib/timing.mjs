/**
 * Simple wall-clock timings, collected in one place and written as JSON —
 * "time from click to first painted change", "time to first SSE token",
 * whatever a spec needs to put a number on. Deliberately dumb: this is a
 * stopwatch with a notebook, not a performance-tracing library. Marks are
 * taken in Node (the test process), so they measure end-to-end wall time
 * including Playwright's own IPC — good enough for "did this get faster or
 * slower", not a substitute for real browser performance-timeline APIs.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class TimingReport {
  constructor() {
    /** @type {Record<string, number>} */
    this.marks = {}
    /** @type {{ label: string, ms: number, from?: string, to?: string }[]} */
    this.entries = []
  }

  /** Record "now" under `label`. Returns the timestamp (ms, monotonic). */
  mark(label) {
    const t = performance.now()
    this.marks[label] = t
    return t
  }

  /**
   * Record the elapsed time between two marks (or a mark and "now") as one
   * named entry in the report.
   */
  measure(label, fromLabel, toLabel) {
    const from = this.marks[fromLabel]
    if (from === undefined) throw new Error(`TimingReport.measure: no mark "${fromLabel}"`)
    const to = toLabel ? this.marks[toLabel] : performance.now()
    if (toLabel && to === undefined) throw new Error(`TimingReport.measure: no mark "${toLabel}"`)
    const ms = to - from
    this.entries.push({ label, ms, from: fromLabel, to: toLabel ?? '(now)' })
    return ms
  }

  /** Record a timing you measured some other way (e.g. from a network event). */
  add(label, ms) {
    this.entries.push({ label, ms })
    return ms
  }

  /**
   * Click something and time how long until a page-evaluated predicate
   * becomes true — "time to first painted change" made concrete. `predicate`
   * runs IN THE BROWSER (Playwright serializes it), so it can only close over
   * values passed via `arg`, not over Node-side variables.
   *
   * @param {import('playwright').Page} page
   * @param {() => Promise<void>} act - the click/keypress/etc that starts the clock
   * @param {(arg: any) => boolean} predicate - polled via page.waitForFunction
   * @param {object} [opts]
   * @param {any} [opts.arg]
   * @param {number} [opts.timeoutMs=10000]
   * @param {string} label
   */
  async timeUntil(label, page, act, predicate, opts = {}) {
    const { arg, timeoutMs = 10_000 } = opts
    const start = performance.now()
    await act()
    await page.waitForFunction(predicate, arg, { timeout: timeoutMs })
    return this.add(label, performance.now() - start)
  }

  /** @param {string} reportPath */
  save(reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify({ marks: this.marks, entries: this.entries }, null, 2))
    return reportPath
  }
}
