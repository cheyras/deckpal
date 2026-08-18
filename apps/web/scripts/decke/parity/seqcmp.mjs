// Frame-by-frame timing check. A pose error shows up in a still; a TIMING error
// does not — it needs a sequence, which is how travel_far's 2x-speed bake was
// found. These three clips are the most timing-sensitive in the playbook.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const MODELS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/models/decke')

const MK = Object.fromEntries(JSON.parse(readFileSync(
  resolve(MODELS, 'markers.json'), 'utf8'))
  .markers.filter(m => m.facing === 1).map(m => [m.state, m.frame]))

const SEQ = {
  nod_yes: [826, 833, 840, 847, 854, 861],
  alert_dizzy: [1369, 1379, 1389, 1399, 1409, 1419],
  talk: [210, 218, 226, 234, 242, 250],
}

const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 })
await p.goto('http://localhost:5199/deckpal/dev/decke?parity=1', { waitUntil: 'networkidle' })
await p.waitForTimeout(8000)

for (const [state, frames] of Object.entries(SEQ)) {
  const M = MK[state]
  console.log(`\n${state}  (marker ${M})`)
  for (const F of frames) {
    await p.evaluate(({ state, F, M }) => {
      const d = window.deckE
      d.setState(state, { blendMs: 0 })
      d.elapsed = (F - 1) / 30
      d.stateStart = d.elapsed - (F - M) / 30
      d.stop(); d.update(0)
      d.stage.renderer.render(d.stage.scene, d.stage.camera)
    }, { state, F, M })
    await p.waitForTimeout(150)
    const dir = `seqout/${state}_${F}`
    mkdirSync(dir, { recursive: true })
    await p.screenshot({ path: `${dir}/page.png` })
    const out = execFileSync('node',
      ['compare.mjs', `seq/${state}_${String(F).padStart(4, '0')}.png`, `${dir}/page.png`, dir],
      { encoding: 'utf8' })
    const r = JSON.parse(out)
    const t = Math.round((F - M) / 30 * 1000)
    console.log(`  t=${String(t).padStart(4)}ms  f${F}  IoU=${r.silhouette.iou.toFixed(3)}` +
      `  area=${r.silhouette.areaRatio.toFixed(3)}  dxy=[${r.centroidDeltaPx.map(v => v.toFixed(1)).join(', ')}]`)
  }
}
await b.close()
