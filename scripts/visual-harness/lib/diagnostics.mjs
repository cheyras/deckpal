/**
 * Console errors and failed network requests, captured for the life of a page
 * and written to a JSON log a human (or a follow-up gate) can read without
 * re-running anything.
 *
 * Two different "failed" signals, both recorded: a `requestfailed` event
 * (DNS error, aborted, blocked by CORS before a response ever came back) and
 * an HTTP response with status >= 400 (the request completed; the SERVER
 * refused it). Treating these as the same bucket would erase which one
 * happened, and they point at different bugs.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * @param {import('playwright').Page} page
 * @returns {{ consoleMessages: object[], failedRequests: object[], writeLog: (path: string) => string }}
 */
export function attachDiagnostics(page) {
  const consoleMessages = []
  const failedRequests = []
  const startedAt = Date.now()
  const t = () => Date.now() - startedAt

  page.on('console', (m) => {
    consoleMessages.push({ tMs: t(), type: m.type(), text: m.text(), location: m.location() })
  })
  page.on('pageerror', (e) => {
    consoleMessages.push({ tMs: t(), type: 'pageerror', text: String(e?.message ?? e) })
  })
  page.on('requestfailed', (req) => {
    failedRequests.push({
      tMs: t(),
      kind: 'network-error',
      method: req.method(),
      url: req.url(),
      errorText: req.failure()?.errorText ?? 'unknown',
    })
  })
  page.on('response', (res) => {
    if (res.status() < 400) return
    failedRequests.push({
      tMs: t(),
      kind: 'http-error',
      method: res.request().method(),
      url: res.url(),
      status: res.status(),
    })
  })

  return {
    consoleMessages,
    failedRequests,
    /** @param {string} logPath */
    writeLog(logPath) {
      mkdirSync(dirname(logPath), { recursive: true })
      const consoleErrors = consoleMessages.filter((m) => m.type === 'error' || m.type === 'pageerror')
      writeFileSync(
        logPath,
        JSON.stringify(
          {
            summary: {
              consoleMessages: consoleMessages.length,
              consoleErrors: consoleErrors.length,
              failedRequests: failedRequests.length,
            },
            consoleMessages,
            failedRequests,
          },
          null,
          2,
        ),
      )
      return logPath
    },
  }
}
