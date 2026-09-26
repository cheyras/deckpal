// Scanner voice, in a real browser: the shipping hook, controls and list
// (tests/browser/scannerVoiceFixture.tsx) driven by a FAKE SpeechRecognition installed
// before the page loads, on Playwright's fake clock so the 4 s hold and the 20 s
// watchdog are exercised exactly rather than slept through. Interim and final
// results, a refusal, Chrome's session-per-utterance, iOS's silent death, an
// engine that ends every session at once, page hide/show and unmount.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import tailwindcss from '../../apps/web/node_modules/@tailwindcss/vite/dist/index.mjs'
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js'

const root = process.cwd()
const outputDir = process.env.TEST_ARTIFACT_DIR ? path.join(process.env.TEST_ARTIFACT_DIR, 'scanner-voice') : path.join(root, '.cache/scanner-voice')
await mkdir(outputDir, { recursive: true })
const fixture = path.join(root, 'tests/browser/scannerVoiceFixture.tsx')
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Scanner voice proof</title><div id="root"></div><script type="module" src="/@fs/${fixture}"></script>`
const server = await createServer({
  root: path.join(root, 'apps/web'), configFile: false, appType: 'custom',
  define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' },
  server: { host: '127.0.0.1', port: 0, strictPort: true }, optimizeDeps: { entries: [fixture] },
  resolve: { alias: { react: path.join(root, 'apps/web/node_modules/react'), 'react-dom': path.join(root, 'apps/web/node_modules/react-dom') } },
  plugins: [tailwindcss(), { name: 'fixture-html', configureServer(vite) { vite.middlewares.use((req, res, next) => { if (req.url !== '/') return next(); res.writeHead(200, { 'content-type': 'text/html' }); res.end(html) }) } }],
})

/** Installed before the app: a recognizer the test drives, keeping every
 *  session it was asked to open. A string, not a function: tsx wraps functions
 *  in helpers (`__name`) that do not exist inside the page. */
const installFakeSpeech = `(() => {
  const S = { sessions: [], starts: 0, aborts: 0, live: null }
  class FakeRec {
    constructor() { this.results = []; this.aborted = false; S.sessions.push(this) }
    start() { S.starts++; S.live = this }
    abort() { S.aborts++; this.aborted = true; if (S.live === this) S.live = null }
  }
  S.open = () => { S.live.onstart?.({}); S.live.onaudiostart?.({}) }
  S.say = (text, isFinal, alts = []) => {
    const r = S.live, last = r.results.at(-1)
    const i = last && !last.isFinal ? r.results.length - 1 : r.results.length
    r.results[i] = Object.assign([text, ...alts].map((transcript) => ({ transcript })), { isFinal })
    r.onresult?.({ resultIndex: i, results: r.results })
  }
  S.fail = (error) => { const r = S.live; r.onerror?.({ error }); r.onend?.({}) }
  S.end = () => { const r = S.live; S.live = null; r.onend?.({}) }
  Object.assign(window, { SpeechRecognition: FakeRec, webkitSpeechRecognition: FakeRec, speech: S })
})()`

type Speech = { starts: number; aborts: number; sessions: { aborted: boolean }[]; live: unknown }
const speech = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { speech: Speech }).speech
  return { starts: s.starts, aborts: s.aborts, sessions: s.sessions.length, live: !!s.live }
})
const drive = (page: Page, fn: 'open' | 'end', ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window as never as { speech: Record<string, (...a: unknown[]) => void> }).speech[fn as string](...(args as unknown[])), [fn, args] as const)
const say = (page: Page, text: string, isFinal = true, alts: string[] = []) =>
  page.evaluate(([t, f, a]) => (window as never as { speech: { say: (...x: unknown[]) => void } }).speech.say(t, f, a), [text, isFinal, alts] as const)
const fail = (page: Page, error: string) =>
  page.evaluate((e) => (window as never as { speech: { fail: (e: string) => void } }).speech.fail(e), error)
const harness = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([fn, args]) => (window as never as { harness: Record<string, (...a: unknown[]) => unknown> }).harness[fn as string](...(args as unknown[])), [fn, args] as const)

/** Poll in REAL time — the page's own timers are on the fake clock — for a
 *  React commit that follows a state change made from outside. */
async function until(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 40; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 50)) }
  assert.fail(what)
}

/** Pretend the page was hidden or shown. A string for the same `__name` reason. */
const visibility = (state: 'hidden' | 'visible') =>
  `Object.defineProperty(document, 'visibilityState', { configurable: true, get() { return '${state}' } }); document.dispatchEvent(new Event('visibilitychange'))`

let browser
try {
  await server.listen()
  const address = server.httpServer?.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch()
  const results: Record<string, unknown> = {}
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]] as const) {
    const page = await browser.newPage({ viewport: { width, height } })
    let external = 0
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== origin) { external++; await route.abort('blockedbyclient'); return }
      await route.continue()
    })
    await page.addInitScript({ content: installFakeSpeech })
    await page.clock.install({ time: new Date('2026-09-26T12:00:00Z') })
    await page.goto(origin)
    const rows = page.locator('[data-entry-state]')
    await rows.nth(2).waitFor()
    const toggle = page.getByRole('button', { name: 'Voice commands' })
    const live = page.locator('[role="status"][aria-live="polite"]')
    const row = (n: number) => rows.nth(n)

    // Off by default; the explainer comes before the recognizer is ever built.
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
    await toggle.click()
    const primer = page.getByRole('dialog', { name: 'Voice commands' })
    await primer.getByText('DeckPal never receives, records or stores your audio').waitFor()
    assert.equal((await speech(page)).sessions, 0, 'no recognizer before the reader agrees')
    await primer.getByRole('button', { name: 'Turn on voice' }).click()
    assert.equal((await speech(page)).starts, 1)
    await drive(page, 'open')
    await page.locator('[data-voice-status="listening"]').waitFor()
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true')

    // Interim words stream onto the camera; the final lands as a PENDING chip
    // on "that one" (the last capture), and the list has not changed yet.
    await say(page, "that one's a", false)
    await say(page, "that one's a reverse", false)
    await page.locator('[data-voice-interim]').waitFor()
    assert.match((await page.locator('[data-voice-interim]').textContent()) ?? '', /that one's a reverse/)
    await say(page, "that one's a reverse hollow", true, ["that one's a reverse holo"])
    const pending = row(2).locator('[data-voice-pending="printing"]')
    await pending.waitFor()
    assert.equal((await pending.textContent())?.trim(), 'Reverse Holofoil')
    assert.equal(await row(2).locator('[data-printing="needs-pick"]').count(), 1, 'still pending, nothing applied')
    await page.clock.runFor(100)
    assert.match((await live.textContent()) ?? '', /Venonat → Reverse Holofoil/)
    await page.screenshot({ path: path.join(outputDir, `${name}-pending.png`) })
    // The hold ends and the reader's pick is made for them.
    await page.clock.runFor(4_200)
    await pending.waitFor({ state: 'detached' })
    assert.equal((await row(2).locator('[data-printing="resolved"]').textContent())?.trim(), 'Reverse Holofoil')

    // An explicit name beats "that one"; quantity and printing in one breath.
    await say(page, 'two first edition charizards')
    await row(1).locator('[data-voice-pending="quantity"]').waitFor()
    await row(1).locator('[data-voice-pending="printing"]').getByText('1st Edition Holofoil Shadowless').waitFor()
    await page.clock.runFor(4_200)
    await row(1).locator('[data-voice-pending]').first().waitFor({ state: 'detached' })
    assert.equal((await row(1).locator('.tabular-nums').textContent())?.trim(), '2')

    // Tap a pending chip away: nothing happens to the row.
    await say(page, 'normal')
    await row(2).locator('[data-voice-pending="printing"]').waitFor()
    await row(2).getByRole('button', { name: 'Cancel voice change: Normal' }).click()
    await page.clock.runFor(5_000)
    assert.equal((await row(2).locator('[data-printing="resolved"]').textContent())?.trim(), 'Reverse Holofoil')

    // Conversation is shown dimmed and does nothing.
    await say(page, 'I still need to find a reverse holo of this')
    await page.locator('[data-voice-caption="ignored"]').waitFor()
    assert.equal(await page.locator('[data-voice-pending]').count(), 0)

    // Remove: struck through with Keep, then gone, then Undo puts it back where it was.
    await say(page, 'no, remove it')
    await page.locator('[data-voice-removing]').waitFor()
    await page.screenshot({ path: path.join(outputDir, `${name}-removing.png`) })
    await page.clock.runFor(5_200)
    await page.locator('[data-voice-removing]').waitFor({ state: 'detached' })
    assert.deepEqual(await page.locator('[data-entry-state] .fe-name').allTextContents(), ['Exeggcute', 'Charizard'])
    await page.locator('[data-voice-caption="done"]').getByRole('button', { name: 'Undo' }).click()
    assert.deepEqual(await page.locator('[data-entry-state] .fe-name').allTextContents(), ['Exeggcute', 'Charizard', 'Venonat'])
    assert.deepEqual(await page.evaluate('window.harness.restored'), ['cap-3'], 'a restored row asks for its printings again')
    // "Undo" by voice walks back the next applied change: Charizard's count.
    await say(page, 'undo')
    await page.clock.runFor(100)
    assert.equal((await row(1).locator('.tabular-nums').textContent())?.trim(), '1')

    // A command about a card still being identified waits for its row.
    await harness(page, 'setLast', 'cap-4')
    await harness(page, 'setInFlight', 'cap-4')
    await say(page, 'reverse holo')
    await page.clock.runFor(1_000)
    assert.equal(await page.locator('[data-voice-pending]').count(), 0, 'no row yet, so no chip yet')
    await harness(page, 'land', 'cap-4', 'Venonat')
    await harness(page, 'setInFlight', null)
    await row(3).locator('[data-voice-pending="printing"]').waitFor()
    await page.clock.runFor(4_300)
    assert.equal((await row(3).locator('[data-printing="resolved"]').textContent())?.trim(), 'Reverse Holofoil')

    // Silent death: no sign of life for 20 s and the session is replaced.
    const beforeDeath = await speech(page)
    await page.clock.runFor(20_100)
    const afterDeath = await speech(page)
    assert.equal(afterDeath.sessions, beforeDeath.sessions + 1, 'watchdog opened a new session')
    assert.equal(afterDeath.aborts, beforeDeath.aborts + 1, 'and aborted the dead one')
    await drive(page, 'open')

    // Chrome: a session ends after an utterance and is re-armed.
    await drive(page, 'end')
    await page.clock.runFor(300)
    assert.equal((await speech(page)).sessions, afterDeath.sessions + 1)
    await drive(page, 'open')

    // Hidden page: the microphone stops; shown again: it resumes.
    await page.evaluate(visibility('hidden'))
    assert.equal((await speech(page)).live, false)
    const startsHidden = (await speech(page)).starts
    await page.evaluate(visibility('visible'))
    assert.equal((await speech(page)).starts, startsHidden + 1)
    await drive(page, 'open')

    // Leaving the scan step: stops listening and applies what is pending.
    await say(page, 'three of those')
    await row(3).locator('[data-voice-pending="quantity"]').waitFor()
    await harness(page, 'setEnabled', false)
    await row(3).locator('[data-voice-pending]').waitFor({ state: 'detached' })
    assert.equal((await row(3).locator('.tabular-nums').textContent())?.trim(), '3')
    assert.equal((await speech(page)).live, false)
    // Back on the scan step while the page is hidden (a commit finishing after
    // the reader switched away): no microphone until the page is shown.
    await page.evaluate(visibility('hidden'))
    const startsBack = (await speech(page)).starts
    await harness(page, 'setEnabled', true)
    await page.waitForTimeout(300)
    assert.equal((await speech(page)).starts, startsBack, 'no session while hidden')
    await page.evaluate(visibility('visible'))
    await until(async () => (await speech(page)).live, 'shown again on the scan step, listening resumes')
    await drive(page, 'open')

    // An engine that ends every session at once is given up on, and says why.
    for (let i = 0; i < 4; i++) { await fail(page, 'network'); await page.clock.runFor(300) }
    await page.locator('[data-voice-caption="error"]').getByText('needs a network connection', { exact: false }).waitFor()
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')

    // Unmount: nothing left listening, nothing restarts.
    await toggle.click()
    await drive(page, 'open')
    await harness(page, 'unmount')
    await until(async () => !(await speech(page)).live, 'unmounting aborts the session')
    const atUnmount = await speech(page)
    await page.clock.runFor(30_000)
    assert.equal((await speech(page)).starts, atUnmount.starts)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 0, `${name} overflow ${overflow}`)
    assert.equal(external, 0)
    results[name] = { viewport: { width, height }, externalRequests: external, noHorizontalOverflow: true, primerBeforeRecognizer: true, pendingThenApplied: true, namedTarget: true, cancel: true, chatterIgnored: true, removeKeepUndo: true, voiceUndo: true, commandWaitsForRow: true, watchdog: true, chromeRearm: true, visibility: true, leaveStepSettles: true, fastFailStops: true, unmountStops: true }
    await page.close()
  }

  // A refusal before the microphone ever opened reads as blocked, with help.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.addInitScript({ content: installFakeSpeech })
  await page.addInitScript({ content: "localStorage.setItem('deckpal.scan.voicePrimer.v1', '1')" })
  await page.goto(origin)
  await page.getByRole('button', { name: 'Voice commands' }).click()
  await fail(page, 'not-allowed')
  await page.locator('[data-voice-status="denied"]').waitFor()
  await page.locator('[data-voice-caption="denied"]').waitFor()
  await page.screenshot({ path: path.join(outputDir, 'mobile-denied.png') })
  results.denied = true
  await page.close()

  await writeFile(path.join(outputDir, 'browser-proof.json'), JSON.stringify({ status: 'passed', generatedAt: new Date().toISOString(), results }, null, 2) + '\n')
  console.log('PASS scanner voice Chromium proof at 1280 and 390')
} finally {
  await browser?.close()
  await server.close()
}
