// The scanner's review list on a phone (owner session 2026-11-27): which row a
// remove can hit, the Undo that follows every remove, whether a swipe can leak
// out of the list into the document behind the fixed screen, the bin's
// follow-the-newest scroll, the Deck-E launcher's clearance, and the count chip.
// Mounts the real components over a fixture batch (scanReviewListFixture.tsx)
// at 390×844 and 428×926 with touch, and asserts on what a finger would hit.
//
//   pnpm exec tsx tests/browser/scanReviewList.mts            # the shipped list
//   SCAN_LIST_BEFORE=1 pnpm exec tsx tests/browser/scanReviewList.mts   # measure only, no assertions
//
// Screenshots and a JSON of every measurement go to .cache/scan-review-list.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright'
import tailwindcss from '../../apps/web/node_modules/@tailwindcss/vite/dist/index.mjs'
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js'

const root = process.cwd()
const BEFORE = process.env.SCAN_LIST_BEFORE === '1'
const label = BEFORE ? 'before' : 'after'
const outputDir = path.join(process.env.TEST_ARTIFACT_DIR ? path.join(process.env.TEST_ARTIFACT_DIR, 'scan-review-list') : path.join(root, '.cache/scan-review-list'), label)
await mkdir(outputDir, { recursive: true })
const fixture = path.join(root, 'tests/browser/scanReviewListFixture.tsx')
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Scan review list</title><div id="root"></div><script type="module" src="/@fs/${fixture}"></script>`
const server = await createServer({
  root: path.join(root, 'apps/web'), configFile: false, appType: 'custom', logLevel: 'error',
  define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' },
  server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { entries: [fixture] },
  resolve: { alias: {
    react: path.join(root, 'apps/web/node_modules/react'), 'react-dom': path.join(root, 'apps/web/node_modules/react-dom'),
    'virtual:pwa-register': path.join(root, 'tests/browser/pwaRegisterStub.ts'),
  } },
  plugins: [tailwindcss(), { name: 'fixture-html', configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url === '/' || req.url?.startsWith('/?')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return }
    // The offline banner's reachability probe. Any answer proves the round trip.
    // (`/deckpal/api/me` here: with no Supabase URL the fixture is a self-host build.)
    if (/^(\/deckpal)?\/api\//.test(req.url ?? '')) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}'); return }
    next()
  }) } }],
})
await server.listen()
const url = server.resolvedUrls!.local[0]! + (BEFORE ? '?before' : '')

const report: Record<string, unknown> = { label }
const browser = await chromium.launch()
const wait = (page: Page, ms: number) => page.waitForTimeout(ms)

/** Every `GET /api/me` the page makes — the offline banner's reachability probe
 *  is the only caller here, and each one is a 401 by design. */
let meRequests = 0

async function open(width: number, height: number): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.on('request', (req) => { if (new URL(req.url()).pathname.endsWith('/api/me')) meRequests += 1 })
  await page.goto(url)
  await wait(page, 1500) // Vite may re-optimise once on a cold start and reload.
  await page.waitForFunction(() => !!window.harness && document.querySelectorAll('[data-verify-feed] > .flex-col > div').length === 10)
  await wait(page, 600) // entrance reveals
  return { context, page, cdp: await context.newCDPSession(page) }
}

type Box = { x: number; y: number; w: number; h: number }
type Row = { name: string; box: Box; remove: Box | null; removeLabel: string | null }
// Page-side code as strings: tsx wraps named functions in a helper (`__name`)
// that does not exist inside the page.
const BOX = `(e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }`
/** Every row: its box, its name, and the box of the control that removes it. */
const rows = (page: Page) =>
  page.evaluate(`(() => { const box = ${BOX}; return [...document.querySelectorAll('[data-verify-feed] > .flex-col > div')].map((el) => {
    const remove = el.querySelector('button[aria-label^="Remove "]')
    return { name: el.querySelector('.fe-name')?.textContent ?? '', box: box(el), remove: box(remove), removeLabel: remove ? remove.getAttribute('aria-label') : null }
  }) })()`) as Promise<Row[]>
/** The last row's every control, labelled. */
const lastRowControls = (page: Page) =>
  page.evaluate(`(() => { const box = ${BOX}; return [...document.querySelectorAll('[data-verify-feed] > .flex-col > div:last-child :is(button, select)')].map((e) => ({ label: e.getAttribute('aria-label') || e.textContent.trim(), ...box(e) })) })()`) as Promise<(Box & { label: string })[]>
const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const overlap = (a: Box | null, b: Box | null) =>
  !a || !b ? 0 : Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
/** What a finger at (x, y) would press: the control's accessible name, or the bare element. */
const hitLabel = (page: Page, x: number, y: number) =>
  page.evaluate(`(() => {
    const el = document.elementFromPoint(${x}, ${y})
    const control = el && el.closest('button, select, [role="button"], a')
    return control ? (control.getAttribute('aria-label') || control.textContent.trim() || control.tagName) : '(' + (el ? el.tagName.toLowerCase() : 'nothing') + ')'
  })()`) as Promise<string>
const listScrollTop = (page: Page, top?: number) =>
  page.evaluate(`(() => { const el = document.querySelector('[data-verify-feed]'); ${typeof top === 'number' ? `el.scrollTop = ${top};` : ''} return el.scrollTop })()`) as Promise<number>
const rowCount = (page: Page) => page.evaluate(`document.querySelectorAll('[data-verify-feed] > .flex-col > div').length`) as Promise<number>
const toastText = (page: Page) => page.locator('[data-toaster]').innerText().catch(() => null)

/** One finger, dragged in small steps the way a thumb does, through CDP so the
 *  browser scrolls it as a real touch gesture. */
async function swipe(cdp: CDPSession, page: Page, x: number, y0: number, y1: number) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / steps }] })
    await wait(page, 16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(page, 500)
}

try {
  for (const [width, height] of [[428, 926], [390, 844]] as const) {
    const tag = `${width}x${height}`
    const { context, page, cdp } = await open(width, height)
    const r: Record<string, unknown> = {}
    report[tag] = r

    // ── 1. The owner's tap, replayed (428×926, the session's phone). Row 3's
    //    remove sat at viewport y≈322. Put row 3 back where it was when he tapped,
    //    and ask what a finger at that point hits, and whether the row he was
    //    looking at — the Herdier above it — showed a remove of its own. ──
    {
      await listScrollTop(page, 0)
      const at0 = await rows(page)
      // Where row 3's top was at the tap: before the fix its × was 6px inside the
      // row's top and 22px tall, so a × centred at 322 means a row top at 305.
      const rowTopAtTap = 322 - (6 + 11)
      await listScrollTop(page, at0[2]!.box.y - rowTopAtTap)
      await wait(page, 100)
      const now = await rows(page)
      const tapX = now[2]!.box.x + now[2]!.box.w - 6 - 11
      const herdier = now[1]!
      const herdierRemoveVisible = herdier.remove
        ? (await hitLabel(page, centre(herdier.remove).x, centre(herdier.remove).y)) === herdier.removeLabel
        : false
      r.trace = {
        scrollTop: await listScrollTop(page),
        tapAt: { x: Math.round(tapX), y: 322 },
        tapHits: await hitLabel(page, tapX, 322),
        rowAbove: herdier.name,
        rowAboveVisiblePx: Math.round(Math.min(herdier.box.y + herdier.box.h, height) - Math.max(herdier.box.y, 0)),
        rowAboveRemoveVisible: herdierRemoveVisible,
        rowAboveRemoveAt: herdier.remove ? Math.round(centre(herdier.remove).y) : null,
      }
      await page.screenshot({ path: path.join(outputDir, `${tag}-1-trace.png`) })
      if (!BEFORE) {
        assert.ok(!String((r.trace as { tapHits: string }).tapHits).startsWith('Remove'), `${tag}: the point the owner tapped removes nothing now (${(r.trace as { tapHits: string }).tapHits})`)
        assert.ok(herdierRemoveVisible, `${tag}: the half-scrolled Herdier shows its OWN remove`)
      }
      // Every row's remove sits inside its own row, clear of the row above.
      const all = await rows(page)
      for (const row of all) {
        if (!row.remove) continue
        const fromTop = row.remove.y - row.box.y
        const fromBottom = row.box.y + row.box.h - (row.remove.y + row.remove.h)
        ;(r.removePlacement ??= []) as unknown[]
        ;(r.removePlacement as unknown[]).push({ name: row.name, fromTop: Math.round(fromTop), fromBottom: Math.round(fromBottom), size: `${Math.round(row.remove.w)}x${Math.round(row.remove.h)}` })
        if (!BEFORE) assert.ok(fromTop > row.box.h / 2, `${tag}: ${row.name}'s remove is in its own control line, not at the top edge`)
      }
    }

    // ── 2. A second tap where the first one was. The removed row's space closes
    //    and the next row's remove slides under the finger. ──
    {
      await page.evaluate(() => window.harness.reset())
      await wait(page, 700)
      await listScrollTop(page, 0)
      await wait(page, 100)
      const first = (await rows(page))[0]!
      const p = centre(first.remove!)
      await page.touchscreen.tap(p.x, p.y)
      await wait(page, 120)
      const slidUnder = await hitLabel(page, p.x, p.y)
      await page.touchscreen.tap(p.x, p.y)
      await wait(page, 400)
      r.doubleTap = { firstRemoved: first.name, underFingerAfter120ms: slidUnder, rowsLeft: await rowCount(page), toast: await toastText(page) }
      await page.screenshot({ path: path.join(outputDir, `${tag}-2-double-tap.png`) })
      if (!BEFORE) {
        assert.equal(await rowCount(page), 9, `${tag}: the second tap, on a row still sliding into place, removed nothing`)
        assert.match(String((r.doubleTap as { toast: string }).toast), /Removed Herdier/, `${tag}: the toast names the card`)
        // A deliberate tap once the list has settled still works…
        await wait(page, 400)
        await page.touchscreen.tap(p.x, p.y)
        await wait(page, 400)
        assert.equal(await rowCount(page), 8, `${tag}: a settled tap removes`)
        assert.match(String(await toastText(page)), /Removed Herdier/)
        // …and Undo puts it back where it was.
        await page.locator('[data-toaster]').getByRole('button', { name: 'Undo' }).click()
        await wait(page, 500)
        const names = (await rows(page)).map((x) => x.name)
        assert.equal(names.length, 9, `${tag}: Undo restored the row`)
        assert.deepEqual(names.slice(0, 2), ['Herdier', 'Galvantula'], `${tag}: in its own place`)
        r.undo = { rows: names.length, order: names.slice(0, 3) }
        await page.screenshot({ path: path.join(outputDir, `${tag}-3-undo.png`) })
      }
    }

    // ── 3. Can a swipe leak out into the document behind the fixed screen? ──
    {
      await page.evaluate(() => window.harness.reset())
      await wait(page, 700)
      const doc = (await page.evaluate(`({
        runway: document.scrollingElement.scrollHeight - innerHeight,
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
        listOverscrollY: getComputedStyle(document.querySelector('[data-verify-feed]')).overscrollBehaviorY,
      })`)) as { runway: number; htmlOverflowY: string; listOverscrollY: string }
      const title = (await page.locator('[data-title-bar]').boundingBox())!
      const list = (await page.locator('[data-verify-feed]').boundingBox())!
      const leaks: Record<string, number> = {}
      const scrollY = () => page.evaluate('window.scrollY') as Promise<number>
      const reset = () => page.evaluate('window.scrollTo(0, 1)')
      await reset(); await listScrollTop(page, 0)
      await swipe(cdp, page, title.x + 200, title.y + 30, title.y + 230) // drag on the title bar
      leaks.titleBarDrag = await scrollY()
      await reset(); await listScrollTop(page, 0)
      await swipe(cdp, page, title.x + 200, title.y + 30, title.y - 40) // and the other way
      leaks.titleBarPush = await scrollY()
      await reset(); await listScrollTop(page, 0)
      await swipe(cdp, page, list.x + 120, list.y + 120, list.y + 360) // pull down with the list at its top
      leaks.listTopPull = await scrollY()
      await reset(); await listScrollTop(page, 99999)
      await swipe(cdp, page, list.x + 120, list.y + list.height - 60, list.y + 40) // push up with the list at its end
      leaks.listEndPush = await scrollY()
      // The list itself: how soon it moves once a finger does.
      await reset(); await listScrollTop(page, 0)
      await page.evaluate(`(() => {
        window.t = {}
        const el = document.querySelector('[data-verify-feed]')
        el.addEventListener('touchstart', (e) => { if (window.t.start === undefined) window.t.start = e.timeStamp }, { passive: true })
        el.addEventListener('scroll', (e) => { if (window.t.scroll === undefined) window.t.scroll = e.timeStamp })
      })()`)
      await swipe(cdp, page, list.x + 120, list.y + 300, list.y + 60)
      const t = (await page.evaluate('window.t')) as { start: number; scroll: number }
      // A non-passive touch or wheel listener on the way from the list up to the
      // window is the one script-side thing that makes a touch scroll wait for
      // the main thread (and so for whatever long task it is running).
      // Page scripts only: Playwright's own injected script (no URL) keeps a
      // capturing touchstart on window for its hit-target checks.
      const scriptUrls = new Map<string, string>()
      cdp.on('Debugger.scriptParsed', (s: { scriptId: string; url: string }) => scriptUrls.set(s.scriptId, s.url))
      await cdp.send('Debugger.enable')
      const nonPassiveOn: string[] = []
      for (const expression of ['window', 'document', 'document.documentElement', 'document.body', 'document.querySelector("[data-verify-feed]")', 'document.getElementById("root")']) {
        const { result } = (await cdp.send('Runtime.evaluate', { expression })) as { result: { objectId: string } }
        const { listeners } = (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })) as { listeners: { type: string; passive: boolean; scriptId: string; lineNumber: number }[] }
        for (const l of listeners) {
          const src = scriptUrls.get(l.scriptId) ?? ''
          if (['touchstart', 'touchmove', 'wheel'].includes(l.type) && !l.passive && src) nonPassiveOn.push(`${expression} ${l.type} (${src}:${l.lineNumber})`)
        }
      }
      await cdp.send('Debugger.disable')
      const nonPassive = nonPassiveOn.length
      r.scrollLeak = { ...doc, documentScrollYAfter: leaks, listFirstScrollMs: Math.round(t.scroll - t.start), nonPassiveTouchListeners: nonPassiveOn }
      if (!BEFORE) {
        assert.equal(doc.htmlOverflowY, 'hidden', `${tag}: the document behind the screen cannot be scrolled`)
        assert.equal(doc.listOverscrollY, 'contain', `${tag}: a swipe off the end of the list stays in the list`)
        for (const [k, v] of Object.entries(leaks)) assert.equal(v, 1, `${tag}: ${k} left the document where main.tsx parked it`)
      }
      if (!BEFORE) assert.equal(nonPassive, 0, `${tag}: nothing on the scroll path can hold a touch scroll for the main thread: ${nonPassiveOn.join(', ')}`)
    }

    // ── 4. The Deck-E launcher and the bottom of the screen. ──
    {
      await page.evaluate(() => window.harness.reset())
      await wait(page, 700)
      const fab = await page.getByRole('button', { name: 'Chat with Deck-E' }).boundingBox()
      const bar = await page.locator('[data-verify-feed] ~ div button').last().boundingBox()
      await listScrollTop(page, 99999)
      await wait(page, 300)
      const last = (await rows(page)).at(-1)!
      const lastControls = await lastRowControls(page)
      const fabBox = fab && { x: fab.x, y: fab.y, w: fab.width, h: fab.height }
      r.fab = {
        fab: fabBox,
        overPrimaryButtonPx2: Math.round(overlap(fabBox, bar && { x: bar.x, y: bar.y, w: bar.width, h: bar.height })),
        overLastRowControls: lastControls.filter((c) => overlap(fabBox, c) > 0).map((c) => c.label),
        overLastRowPx2: Math.round(overlap(fabBox, last.box)),
      }
      await page.screenshot({ path: path.join(outputDir, `${tag}-4-fab-verify.png`) })
      if (!BEFORE) {
        assert.equal((r.fab as { overPrimaryButtonPx2: number }).overPrimaryButtonPx2, 0, `${tag}: the launcher does not cover Add`)
        assert.deepEqual((r.fab as { overLastRowControls: string[] }).overLastRowControls, [], `${tag}: nor the last row's controls`)
      }
      // The same in the scanning step, with the bin scrolled to its end.
      await page.evaluate(() => window.harness.mode('scan'))
      await wait(page, 700)
      await listScrollTop(page, 99999)
      await wait(page, 300)
      const binLastControls = await lastRowControls(page)
      const verifyButton = await page.getByRole('button', { name: /^Verify/ }).boundingBox()
      r.fabScan = {
        overVerifyButtonPx2: Math.round(overlap(fabBox, verifyButton && { x: verifyButton.x, y: verifyButton.y, w: verifyButton.width, h: verifyButton.height })),
        overLastRowControls: binLastControls.filter((c) => overlap(fabBox, c) > 0).map((c) => c.label),
      }
      await page.screenshot({ path: path.join(outputDir, `${tag}-5-fab-scan.png`) })
      if (!BEFORE) {
        assert.equal((r.fabScan as { overVerifyButtonPx2: number }).overVerifyButtonPx2, 0, `${tag}: the launcher does not cover Verify`)
        assert.deepEqual((r.fabScan as { overLastRowControls: string[] }).overLastRowControls, [], `${tag}: nor the bin's last row`)
      }
    }

    // ── 5. The bin follows the newest scan only while the reader is not using it. ──
    {
      // As WebKit: no scroll anchoring, so a row landing above a scrolled reader
      // does not move the scroll position for them (Chromium's anchoring would
      // carry it past the follow threshold and hide what this is about).
      await page.addStyleTag({ content: '[data-verify-feed] { overflow-anchor: none }' })
      await listScrollTop(page, 0)
      await wait(page, 200)
      await listScrollTop(page, 100)
      const list = (await page.locator('[data-verify-feed]').boundingBox())!
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: list.x + 120, y: list.y + 100 }] })
      await page.evaluate(() => window.harness.land('Lillipup'))
      await wait(page, 700)
      const whileTouching = await listScrollTop(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await wait(page, 1500)
      await listScrollTop(page, 40)
      await wait(page, 1200) // hands off, idle
      await page.evaluate(() => window.harness.land('Gothita'))
      await wait(page, 800)
      const idle = await listScrollTop(page)
      r.followTop = { scrolledTo: 100, afterArrivalWhileTouching: whileTouching, idleNearTopAfterArrival: idle }
      if (!BEFORE) {
        assert.ok(whileTouching > 50, `${tag}: a scan landing does not yank the bin out from under a finger (${whileTouching})`)
        assert.equal(idle, 0, `${tag}: an idle reader near the top still sees the newest scan`)
      }
      await page.evaluate(() => window.harness.mode('verify'))
      await wait(page, 500)
    }

    // ── 7. The reachability probe (`GET /api/me`, a 401 by design) does not
    //    re-ask on every window focus — iOS fires one each time the page gets
    //    the screen back. Ten focuses in a row, as a scan session produces. ──
    {
      const start = meRequests
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')))
        await wait(page, 150)
      }
      await wait(page, 500)
      r.meProbesOnTenFocuses = meRequests - start
      if (!BEFORE) assert.equal(r.meProbesOnTenFocuses, 0, `${tag}: a fresh reachable answer is not asked for again on focus`)
    }

    // ── 6. The count chip says which card is there twice. ──
    {
      await page.evaluate(() => window.harness.reset())
      await wait(page, 700)
      const header = async () => (await page.locator('[data-verify-feed] .sticky').first().innerText()).replace(/\s+/g, ' ').trim()
      const headerHeight = async () => (await page.locator('[data-verify-feed] .sticky').first().boundingBox())!.height
      r.chip = await header()
      r.chipHeight = await headerHeight()
      await page.screenshot({ path: path.join(outputDir, `${tag}-6-chip.png`), clip: { x: 0, y: 150, width, height: 120 } })
      // The session's own list by then: one Herdier gone, two Durants left.
      await page.evaluate(() => window.harness.reset())
      await wait(page, 500)
      const herdier = (await rows(page))[1]!
      await page.touchscreen.tap(centre(herdier.remove!).x, centre(herdier.remove!).y)
      await wait(page, 600)
      r.chipAfterRemove = await header()
      await page.screenshot({ path: path.join(outputDir, `${tag}-7-chip-owner.png`), clip: { x: 0, y: 150, width, height: 120 } })
      if (!BEFORE) {
        assert.match(String(r.chip), /10 cards · 2× Durant, 2× Herdier/, `${tag}: ${r.chip}`)
        assert.match(String(r.chipAfterRemove), /9 cards · 2× Durant/, `${tag}: ${r.chipAfterRemove}`)
        assert.ok((r.chipHeight as number) < 60, `${tag}: the header stays on one line (${r.chipHeight}px)`)
      }
    }

    await context.close()
  }
  console.log(JSON.stringify(report, null, 2))
  await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`scan review list (${label}): ${BEFORE ? 'measured' : 'all checks passed'}`)
} finally {
  await browser.close()
  await server.close()
  console.log(`screenshots + report: ${outputDir}`)
}
