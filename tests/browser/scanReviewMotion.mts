// The scanner review's motion, recorded and checked frame by frame (owner
// session 2026-11-26: the confirmed card came back in from the right edge; three
// copies all said 0 -> 1; the scanning list did not keep up with the newest
// scan; things snapped). Mounts the real components over fixture rows
// (scanReviewMotionFixture.tsx), records a video, and samples every animation
// frame of each confirm so a snap-back fails the run instead of needing an eye.
//
// AND THE CAMERA → LIST HAND-OFF (owner session 2026-11-27: "it can't feel
// like it just… goes away and appears somewhere else"), at 390x844 and 428x926:
// the real CameraStage and VerifyFeed driven through the shipping
// scan/ui/handoff.ts, sampled every frame. For each capture, exactly one of
// {tray thumbnail, courier, row picture} is visible on every frame; the
// courier never moves more than 48 px between frames and lands within 1 px of
// the row picture — with two captures in flight 100 ms apart, with the list
// scrolling mid-flight, and (at most one image, the reader's rows held still,
// "1 new ↑") with the list scrolled away. Plus the capture flash (>= 0.9 within
// a frame of 60 ms, gone by 560 ms, one per capture; <= 0.5 under reduced
// motion) and the status pill through the lock-blink flicker the owner saw.
//
//   pnpm exec tsx tests/browser/scanReviewMotion.mts      # video + frames under .cache/scan-review-motion
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import tailwindcss from '../../apps/web/node_modules/@tailwindcss/vite/dist/index.mjs'
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js'

const root = process.cwd()
const outputDir = process.env.TEST_ARTIFACT_DIR
  ? path.join(process.env.TEST_ARTIFACT_DIR, 'scan-review-motion')
  : path.join(root, '.cache/scan-review-motion')
await mkdir(outputDir, { recursive: true })
const fixture = path.join(root, 'tests/browser/scanReviewMotionFixture.tsx')
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Scan review motion</title><div id="root"></div><script type="module" src="/@fs/${fixture}"></script>`
const server = await createServer({
  root: path.join(root, 'apps/web'), configFile: false, appType: 'custom',
  define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' },
  server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { entries: [fixture] },
  resolve: { alias: { react: path.join(root, 'apps/web/node_modules/react'), 'react-dom': path.join(root, 'apps/web/node_modules/react-dom') } },
  plugins: [tailwindcss(), { name: 'fixture-html', configureServer(vite) { vite.middlewares.use((req, res, next) => { if (req.url !== '/') return next(); res.writeHead(200, { 'content-type': 'text/html' }); res.end(html) }) } }],
})
await server.listen()
const url = server.resolvedUrls!.local[0]!

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: outputDir, size: { width: 390, height: 844 } } })
const page = await context.newPage()
const wait = (ms: number) => page.waitForTimeout(ms)
const land = (p: Page, id: string, name: string, hue: number, variantId?: number) =>
  p.evaluate(([id, name, hue, v]) => window.harness.land(id as string, name as string, hue as number, v as number | undefined), [id, name, hue, variantId] as const)

try {
  await page.goto(url)
  // Vite may re-optimise dependencies on a cold start and reload the page once.
  await wait(2500)
  await page.waitForFunction(() => !!window.harness)

  // ── 1. the scanning bin: newest on top, the rest pushed down ──
  const names = ['Latias ex', 'Slowking', 'Oricorio ex', 'Dragapult ex', 'Pinsir', 'Cycling Road']
  for (const [i, n] of names.entries()) {
    await land(page, `cap-${i}`, n, 30 + i * 50, 600 + i * 2)
    await wait(900)
  }
  const order = await page.$$eval('[data-verify-feed] > .flex-col > div', (els) => els.map((e) => e.textContent ?? ''))
  assert.ok(order[0]!.includes('Cycling Road'), `newest first: ${order[0]?.slice(0, 40)}`)
  const scrollTop = await page.$eval('[data-verify-feed]', (el) => el.scrollTop)
  assert.equal(scrollTop, 0, 'the list keeps its top, where the newest scan is, in view')
  await page.screenshot({ path: path.join(outputDir, '1-bin.png') })

  // ── 2. swipe review: three copies of one printing count up ──
  await page.evaluate(() => {
    window.harness.clear()
    window.harness.mode('swipe')
  })
  for (const id of ['cap-a', 'cap-b', 'cap-c']) await land(page, id, 'Oricorio ex', 10, 500)
  await wait(400)
  const youllHave = async () => (await page.locator('text=You\'ll have').first().locator('xpath=..').innerText()).replace(/\s+/g, ' ')
  const firstCopy = await youllHave()
  assert.match(firstCopy, /0 \+ 1 → 1/, firstCopy)
  await page.screenshot({ path: path.join(outputDir, '2-copy-1.png') })

  // ── 3. confirm: sample every frame; the confirmed card must only ever move away ──
  const confirmAndSample = async (how: 'button' | 'drag') => {
    // A string, not a function: tsx wraps named functions in helpers (`__name`)
    // that do not exist inside the page.
    await page.evaluate(`(() => {
      window.samples = []; window.sampling = true
      const t0 = performance.now()
      const tick = () => {
        if (!window.sampling) return
        const cards = [...document.querySelectorAll('[class*="max-w-[300px]"]')].filter((e) => e.parentElement && e.parentElement.classList.contains('relative'))
        window.samples.push({ t: Math.round(performance.now() - t0), cards: cards.map((e) => {
          const r = e.getBoundingClientRect()
          return { x: Math.round(r.left), op: Number(getComputedStyle(e).opacity).toFixed(2), z: getComputedStyle(e).zIndex, hidden: e.getAttribute('aria-hidden') }
        }) })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })()`)
    if (how === 'button') await page.getByRole('button', { name: 'Confirm card' }).click()
    else {
      const box = (await page.locator('[class*="touch-none"][class*="max-w-[300px]"]').first().boundingBox())!
      const y = box.y + box.height / 2
      await page.mouse.move(box.x + box.width / 2, y)
      await page.mouse.down()
      for (let dx = 0; dx <= 180; dx += 20) await page.mouse.move(box.x + box.width / 2 + dx, y)
      await page.mouse.up()
    }
    await wait(700)
    return page.evaluate(() => {
      const w = window as unknown as { samples: { t: number; cards: { x: number; op: string; z: string; hidden: string | null }[] }[]; sampling: boolean }
      w.sampling = false
      return w.samples
    })
  }
  for (const how of ['button', 'drag'] as const) {
    const samples = await confirmAndSample(how)
    // The leaving card is the top layer (z 4). Its x only ever grows, and once
    // it has started moving no frame shows it back at the centre at full opacity.
    const leaving = samples.map((s) => s.cards.find((c) => c.z === '4')).filter((c): c is NonNullable<typeof c> => !!c)
    assert.ok(leaving.length > 3, `${how}: the confirmed card is seen leaving (${leaving.length} frames)`)
    for (let i = 1; i < leaving.length; i++) assert.ok(leaving[i]!.x >= leaving[i - 1]!.x - 1, `${how}: frame ${i} moved back (${leaving[i - 1]!.x} -> ${leaving[i]!.x})`)
    const last = samples.at(-1)!
    assert.ok(!last.cards.some((c) => c.z === '4'), `${how}: the leaving card is gone at the end`)
    console.log(`${how}: ${samples.length} frames, leaving card ${leaving[0]!.x} -> ${leaving.at(-1)!.x}`)
  }
  const thirdCopy = await youllHave()
  assert.match(thirdCopy, /2 \+ 1 → 3/, thirdCopy)
  assert.match(thirdCopy, /copy 3 of 3/, thirdCopy)
  await page.screenshot({ path: path.join(outputDir, '3-copy-3.png') })

  // ── 4. the camera → list hand-off (2026-11-27): one capture, one image ──
  await context.close()
  for (const vp of [
    { width: 390, height: 844 },
    { width: 428, height: 926 },
  ]) {
    const ctx = await browser.newContext({ viewport: vp, recordVideo: { dir: outputDir, size: vp } })
    try {
      await handoffChecks(await ctx.newPage(), `${vp.width}x${vp.height}`)
    } finally {
      await ctx.close()
    }
  }
  // ── 5. the flash under reduced motion: kept, gentler ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    try {
      const p = await ctx.newPage()
      await open(p)
      await p.evaluate(() => window.harness.mode('handoff'))
      await p.waitForTimeout(300)
      await startSampler(p, ['rm-1'])
      await p.evaluate(() => window.harness.capture('rm-1', 'Pikachu', 50))
      await p.waitForTimeout(700)
      const fs_ = await stopSampler(p)
      const peak = Math.max(...fs_.map((f) => f.flash))
      assert.ok(peak > 0.3 && peak <= 0.5 + 1e-3, `reduced motion: the flash stays, gentler (peak ${peak.toFixed(2)})`)
      const gone = fs_.filter((f) => f.t >= 200).every((f) => f.flash < 0.02)
      assert.ok(gone, 'reduced motion: gone within DURATION.fast')
      console.log(`reduced motion: flash peak ${peak.toFixed(2)}`)
    } finally {
      await ctx.close()
    }
  }
  console.log('scan review motion: all checks passed')
} finally {
  await browser.close()
  await server.close()
  console.log(`video + screenshots: ${outputDir}`)
}

// ---------------------------------------------------------------------------

async function open(p: Page) {
  await p.goto(url)
  await p.waitForTimeout(1500)
  await p.waitForFunction(() => !!window.harness)
}

interface HFrame {
  t: number
  /** performance.now() of the frame, to measure against the shutter. */
  at: number
  flash: number
  scrollTop: number
  status: string
  ref: number | null
  ids: Record<string, { tray: number; courier: number; row: number; cx: number | null; cy: number | null; cr: number[] | null; rr: number[] | null }>
}

/** Every animation frame: for each capture, how visible its tray thumbnail,
 *  courier and row picture are (opacity through the ancestors, 0 when hidden,
 *  clipped out of its container, or absent), the courier's centre, the flash. */
async function startSampler(p: Page, ids: string[], refSelector?: string) {
  // A string, not a function: tsx wraps functions in helpers that do not exist in the page.
  await p.evaluate(`(() => {
    const ids = ${JSON.stringify(ids)}
    const refSel = ${JSON.stringify(refSelector ?? null)}
    window.hs = { frames: [], on: true }
    const t0 = performance.now()
    const vis = (el, clip) => {
      if (!el || !el.isConnected) return 0
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0
      let op = 1
      for (let e = el; e && e !== document.body; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return 0
      if (clip) {
        const c = clip.getBoundingClientRect()
        const ix = Math.min(r.right, c.right) - Math.max(r.left, c.left)
        const iy = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top)
        if (ix <= 1 || iy <= 1) return 0
      }
      return op
    }
    const tick = () => {
      if (!window.hs.on) return
      const cam = document.querySelector('[data-scan-camera-view]')
      const list = document.querySelector('[data-verify-feed]')
      const fl = document.querySelector('[data-capture-flash]')
      const ref = refSel ? document.querySelector(refSel) : null
      const st = document.querySelector('[data-scan-status-text]')
      const f = { t: Math.round(performance.now() - t0), at: performance.now(), flash: fl ? Number(getComputedStyle(fl).opacity) : 0, scrollTop: list ? list.scrollTop : 0,
        status: st ? st.textContent.replace(/\\s+/g, ' ').trim() : '', ref: ref ? Math.round(ref.getBoundingClientRect().top * 10) / 10 : null, ids: {} }
      for (const id of ids) {
        const tray = document.querySelector('[data-stack-id="' + id + '"]')
        const courier = document.querySelector('[data-courier-id="' + id + '"]')
        const row = document.querySelector('[data-thumb-id="' + id + '"]')
        const cr = courier ? courier.getBoundingClientRect() : null
        const rr = row ? row.getBoundingClientRect() : null
        f.ids[id] = { tray: vis(tray, cam), courier: vis(courier, null), row: vis(row, list),
          cx: cr ? cr.left + cr.width / 2 : null, cy: cr ? cr.top + cr.height / 2 : null,
          cr: cr ? [cr.left, cr.top, cr.width, cr.height] : null, rr: rr ? [rr.left, rr.top, rr.width, rr.height] : null }
      }
      window.hs.frames.push(f)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })()`)
}
async function stopSampler(p: Page): Promise<HFrame[]> {
  return p.evaluate(() => {
    const w = window as unknown as { hs: { frames: HFrame[]; on: boolean } }
    w.hs.on = false
    return w.hs.frames
  })
}

/** The invariants, per capture: exactly one image visible on every frame from
 *  its first to its last; the courier never jumps; it lands on the row. */
function assertOneImage(frames: HFrame[], id: string, label: string, opts: { clamped?: boolean } = {}) {
  const seen = frames.map((f) => f.ids[id]!).filter((x) => x.tray > 0.02 || x.courier > 0.02 || x.row > 0.02 || x.cr)
  const first = frames.findIndex((f) => {
    const x = f.ids[id]!
    return x.tray > 0.02 || x.courier > 0.02 || x.row > 0.02
  })
  assert.ok(first >= 0, `${label} ${id}: the capture was never seen`)
  let courierFrames = 0
  let maxStep = 0
  let prev: { cx: number; cy: number } | null = null
  for (let i = first; i < frames.length; i++) {
    const x = frames[i]!.ids[id]!
    const n = [x.tray, x.courier, x.row].filter((v) => v > 0.02).length
    if (opts.clamped) assert.ok(n <= 1, `${label} ${id} frame ${i} (t=${frames[i]!.t}): ${n} images visible`)
    else assert.equal(n, 1, `${label} ${id} frame ${i} (t=${frames[i]!.t}): ${n} images visible (tray ${x.tray.toFixed(2)} courier ${x.courier.toFixed(2)} row ${x.row.toFixed(2)})`)
    if (x.cx !== null && x.cy !== null) {
      courierFrames++
      if (prev) maxStep = Math.max(maxStep, Math.hypot(x.cx - prev.cx, x.cy - prev.cy))
      prev = { cx: x.cx, cy: x.cy }
    } else prev = null
  }
  assert.ok(courierFrames > 10, `${label} ${id}: the courier flew (${courierFrames} frames)`)
  if (maxStep > 48) {
    const trace = frames.slice(first).map((f) => `${f.t}:${f.ids[id]!.cx?.toFixed(0) ?? '-'},${f.ids[id]!.cy?.toFixed(0) ?? '-'}`).join(' ')
    console.log(`${label} ${id} courier trace: ${trace}`)
  }
  assert.ok(maxStep <= 48, `${label} ${id}: the courier jumped ${maxStep.toFixed(1)} px in one frame`)
  if (!opts.clamped) {
    // The last courier frame against the row picture on that same frame.
    const lastC = [...frames].reverse().find((f) => f.ids[id]!.cr && f.ids[id]!.rr)!.ids[id]!
    const d = Math.max(...lastC.cr!.map((v, k) => Math.abs(v - lastC.rr![k]!)))
    if (d > 1) {
      const tail = frames.filter((f) => f.ids[id]!.cr && f.ids[id]!.rr).slice(-4)
      console.log(tail.map((f) => `${f.t}: cr ${f.ids[id]!.cr!.map((v) => v.toFixed(1)).join(',')} rr ${f.ids[id]!.rr!.map((v) => v.toFixed(1)).join(',')}`).join('\n'))
    }
    assert.ok(d <= 1, `${label} ${id}: the courier landed ${d.toFixed(2)} px off the row picture`)
    const end = frames.at(-1)!.ids[id]!
    assert.ok(end.row > 0.9 && end.courier === 0 && end.tray === 0, `${label} ${id}: it ends as the row picture, alone`)
  }
  void seen
  return { maxStep, courierFrames }
}

async function handoffChecks(p: Page, label: string) {
  await open(p)
  await p.evaluate(() => window.harness.mode('handoff'))
  await p.waitForTimeout(300)

  // 4a. One capture: the flash, the tray, the list.
  await startSampler(p, ['h-1'])
  await p.evaluate(() => window.harness.capture('h-1', 'Lillipup', 40))
  const shutter = await p.evaluate(() => (window as unknown as { shutterAt: number }).shutterAt)
  const settling = p.evaluate(() => window.harness.settle('h-1'))
  // Mid-flight: the tick (240 ms), then ~200 ms into the courier's flight.
  await p.waitForTimeout(450)
  await p.screenshot({ path: path.join(outputDir, `4a-midflight-${label}.png`) })
  await settling
  await p.waitForTimeout(400)
  let frames = await stopSampler(p)
  const one = assertOneImage(frames, 'h-1', label)
  // The flash, against the capture call (design §5.4): >= 0.9 within 60 ms,
  // gone by 560 ms. A frame is ~16.7 ms, so "within 60 ms" is judged on the
  // first frame painted at or after it.
  const peak = frames.find((f) => f.flash >= 0.9)
  const peakAt = peak ? Math.round(peak.at - shutter) : null
  assert.ok(peakAt !== null && peakAt <= 60 + 17, `${label}: the flash reaches 0.9 at ${peakAt} ms after the shutter`)
  assert.ok(frames.filter((f) => f.at - shutter >= 560).every((f) => f.flash < 0.02), `${label}: the flash is gone by 560 ms`)
  const rises = frames.filter((f, i) => i > 0 && f.flash >= 0.5 && frames[i - 1]!.flash < 0.5).length
  assert.equal(rises, 1, `${label}: one flash for one capture`)
  await p.screenshot({ path: path.join(outputDir, `4a-one-${label}.png`) })
  console.log(`${label} 4a one capture: max courier step ${one.maxStep.toFixed(1)} px over ${one.courierFrames} frames; flash 0.9 at ${peakAt} ms`)

  // 4b. Two in flight: the second settles 100 ms after the first.
  await startSampler(p, ['h-2', 'h-3'])
  await p.evaluate(() => Promise.all([window.harness.capture('h-2', 'Herdier', 90), new Promise((r) => setTimeout(r, 450)).then(() => window.harness.capture('h-3', 'Cheren', 150))]))
  await p.evaluate(() => Promise.all([window.harness.settle('h-2'), new Promise((r) => setTimeout(r, 100)).then(() => window.harness.settle('h-3'))]))
  await p.waitForTimeout(400)
  frames = await stopSampler(p)
  for (const id of ['h-2', 'h-3']) assertOneImage(frames, id, `${label} (two in flight)`)
  const order = await p.$$eval('[data-verify-feed] [data-thumb-id]', (els) => els.map((e) => e.getAttribute('data-thumb-id')))
  assert.deepEqual(order.slice(0, 3), ['h-3', 'h-2', 'h-1'], `${label}: the bin stays newest first: ${order.join(', ')}`)
  console.log(`${label} 4b two in flight: ok`)

  // 4c. While the list scrolls: a fuller list scrolled a little, scrolled again mid-flight.
  for (let i = 0; i < 6; i++) await p.evaluate(([i]) => window.harness.land(`fill-${i}`, `Fill ${i}`, 200 + i * 20, 700 + i * 2), [i] as const)
  await p.waitForTimeout(500)
  await p.$eval('[data-verify-feed]', (el) => (el.scrollTop = 100))
  // Hands off for longer than the list's follow idle (VerifyFeed, 1 s): the
  // landing then brings the list back to its top, scrolling under the flight.
  await p.waitForTimeout(1200)
  await p.evaluate(() => window.harness.capture('h-4', 'Gothorita', 280))
  await startSampler(p, ['h-4'])
  await p.evaluate(() => {
    setTimeout(() => {
      const el = document.querySelector('[data-verify-feed]') as HTMLElement
      el.scrollTop = 40
    }, 380)
    return window.harness.settle('h-4')
  })
  await p.waitForTimeout(500)
  frames = await stopSampler(p)
  assertOneImage(frames, 'h-4', `${label} (list scrolling)`)
  assert.ok(new Set(frames.map((f) => f.scrollTop)).size > 2, `${label}: the list really scrolled mid-flight`)
  console.log(`${label} 4c list scrolling mid-flight: ok`)

  // 4d. Scrolled away: the reader's rows stay put, the courier fades at the top edge, "1 new ↑".
  await p.$eval('[data-verify-feed]', (el) => (el.scrollTop = 320))
  await p.waitForTimeout(1200)
  const refId = await p.$$eval('[data-verify-feed] [data-thumb-id]', (els) => {
    const list = document.querySelector('[data-verify-feed]')!.getBoundingClientRect()
    const firstVisible = els.find((e) => e.getBoundingClientRect().top >= list.top + 50)
    return firstVisible?.getAttribute('data-thumb-id') ?? null
  })
  assert.ok(refId, 'a row in view to anchor on')
  await p.evaluate(() => window.harness.capture('h-5', 'Durant', 330))
  await startSampler(p, ['h-5'], `[data-thumb-id="${refId}"]`)
  await p.evaluate(() => window.harness.settle('h-5'))
  await p.waitForTimeout(400)
  frames = await stopSampler(p)
  assertOneImage(frames, 'h-5', `${label} (scrolled away)`, { clamped: true })
  const tops = frames.map((f) => f.ref).filter((v): v is number => v !== null)
  const drift = Math.max(...tops) - Math.min(...tops)
  assert.ok(drift <= 1, `${label}: the reader's rows moved ${drift.toFixed(1)} px when a scan landed above them`)
  const pill = await p.locator('[data-new-above]').getAttribute('data-new-above')
  assert.equal(pill, '1', `${label}: "1 new ↑"`)
  await p.screenshot({ path: path.join(outputDir, `4d-scrolled-${label}.png`) })
  console.log(`${label} 4d scrolled away: rows held to ${drift.toFixed(1)} px, "1 new" shown`)

  // 4e. The status pill under the flicker the owner saw: a lock that blinks
  // every other tick while the card is watched, one tick of "focusing".
  await p.evaluate(() => {
    const t0 = performance.now()
    window.harness.facts({ capture: { seq: 9, at: t0 }, watching: true, watchingName: null, steady: true })
    let i = 0
    const blink = setInterval(() => {
      i++
      window.harness.facts({ steady: i % 2 === 0, aim: i === 9 ? 'focus' : null, watchingName: i >= 20 ? 'Lillipup' : null })
      if (i === 20) window.harness.facts({ landed: { seq: 1, text: 'Got it — Lillipup' } })
      if (i > 48) clearInterval(blink)
    }, 125)
  })
  await startSampler(p, [])
  await p.waitForTimeout(6_500)
  frames = await stopSampler(p)
  const seq: string[] = []
  for (const f of frames) if (f.status && f.status !== seq.at(-1)) seq.push(f.status)
  // The check is drawn as an Icon, so the text reads without the ✓.
  assert.deepEqual(seq.slice(-4), ['Captured', 'Scanned identifying…', 'Got it — Lillipup', 'Scanned Lillipup'], `${label}: status sequence ${seq.join(' | ')}`)
  console.log(`${label} 4e status pill: ${seq.slice(-4).join(' → ')}`)
}
