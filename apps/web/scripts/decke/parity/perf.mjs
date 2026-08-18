// Frame budget on a phone-sized viewport with CPU throttling, and on desktop.
// "Runs smoothly on mobile and desktop" is an explicit product requirement.
import { chromium } from 'playwright'

const CASES = [
  { tag: 'desktop 1440x900', vp: { width: 1440, height: 900 }, dpr: 1, cpu: 1 },
  { tag: 'mobile  390x844 x2dpr, 4x CPU', vp: { width: 390, height: 844 }, dpr: 2, cpu: 4 },
  { tag: 'mobile  390x844 x3dpr, 6x CPU', vp: { width: 390, height: 844 }, dpr: 3, cpu: 6 },
]

const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] })
for (const c of CASES) {
  const ctx = await b.newContext({ viewport: c.vp, deviceScaleFactor: c.dpr })
  const p = await ctx.newPage()
  const cdp = await ctx.newCDPSession(p)
  if (c.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.cpu })
  await p.goto('http://localhost:5199/deckpal/dev/decke', { waitUntil: 'networkidle' })
  await p.waitForTimeout(9000)

  // Drive him through something expensive: an emote, then a flight.
  const r = await p.evaluate(async () => {
    const d = window.deckE
    d.setState('card_stash', { blendMs: 200 })
    const frames = []
    let last = performance.now()
    await new Promise((resolve) => {
      let n = 0
      const tick = () => {
        const now = performance.now()
        frames.push(now - last)
        last = now
        if (++n === 40) d.setState('loading', { blendMs: 200 })
        if (n < 180) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    frames.sort((a, z) => a - z)
    const pct = (q) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))]
    return {
      n: frames.length,
      median: +pct(0.5).toFixed(2),
      p95: +pct(0.95).toFixed(2),
      worst: +frames[frames.length - 1].toFixed(2),
      drawCalls: d.stage.renderer.info.render.calls,
      triangles: d.stage.renderer.info.render.triangles,
      programs: d.stage.renderer.info.programs?.length ?? null,
      texMem: d.stage.renderer.info.memory.textures,
      geoMem: d.stage.renderer.info.memory.geometries,
    }
  })
  console.log(
    `${c.tag.padEnd(30)} median ${String(r.median).padStart(6)} ms  p95 ${String(r.p95).padStart(6)} ms  ` +
    `worst ${String(r.worst).padStart(7)} ms  | ${r.drawCalls} calls, ${r.triangles} tris, ` +
    `${r.programs} programs, ${r.texMem} tex, ${r.geoMem} geo`)
  await ctx.close()
}
await b.close()
