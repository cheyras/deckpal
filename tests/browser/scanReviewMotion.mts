// The scanner review's motion, recorded and checked frame by frame (owner
// session 2026-11-26: the confirmed card came back in from the right edge; three
// copies all said 0 -> 1; the scanning list did not keep up with the newest
// scan; things snapped). Mounts the real components over fixture rows
// (scanReviewMotionFixture.tsx), records a video, and samples every animation
// frame of each confirm so a snap-back fails the run instead of needing an eye.
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
  console.log('scan review motion: all checks passed')
} finally {
  await context.close()
  await browser.close()
  await server.close()
  console.log(`video + screenshots: ${outputDir}`)
}
