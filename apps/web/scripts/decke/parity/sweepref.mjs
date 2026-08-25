import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const CASES = [
  ['rest',        'rest_0001.png',            null,          1,    1],
  ['boot_pop',    'boot_pop_0035.png',        'boot',        35,   28],
  ['thinking',    'thinking_0153.png',        'thinking',    153,  133],
  ['happy_peak',  'happy_peak_0298.png',      'happy',       298,  291],
  ['sad_hold',    'sad_hold_0410.png',        'sad',         410,  365],
  ['curious_hold','curious_hold_0716.png',    'curious',     716,  679],
  ['alert_star',  'alert_star_1052.png',      'alert_star',  1052, 1042],
  ['stash_gape',  'card_stash_gape_1834.png', 'card_stash',  1834, 1777],
]

const b = await chromium.launch({ channel:'chrome', args:['--enable-unsafe-swiftshader'] })
for (const [tag, ref, state, F, M] of CASES) {
  const p = await b.newPage({ viewport:{width:720,height:720}, deviceScaleFactor:1 })
  await p.goto('http://localhost:5199/deckpal/dev/decke?parity=1',{waitUntil:'networkidle'})
  await p.waitForTimeout(7500)
  await p.evaluate(({state,F,M}) => {
    const d = window.deckE
    if (state) {
      d.setState(state, { blendMs: 0 })
      d.elapsed = (F - 1) / 30
      d.stateStart = d.elapsed - (F - M) / 30
    }
    // DETERMINISM. Two bits of procedural state survive the warm-up and make an
    // otherwise identical run differ by up to 0.045 IoU: the blink schedule's
    // monotonic cursor (seeking backwards leaves it stale) and the idle float's
    // integrated clock. Both are reproducible once pinned. This does not make
    // the port match Blender's baked float — nothing can — it makes successive
    // runs of the harness comparable to each other.
    d.proc.blink.cursor = 0
    d.proc.float.tau = d.elapsed
    // Freeze: stop the loop, evaluate once at the seeked time, render that frame.
    d.stop(); d.update(0)
    d.stage.renderer.render(d.stage.scene, d.stage.camera)
  }, {state,F,M})
  await p.waitForTimeout(200)
  mkdirSync(`sw/${tag}`, { recursive:true })
  await p.screenshot({ path:`sw/${tag}/page.png` })
  await p.close()
  const out = execFileSync('node', ['compare.mjs', `ref/${ref}`, `sw/${tag}/page.png`, `sw/${tag}`], {encoding:'utf8'})
  const r = JSON.parse(out)
  console.log(`${tag.padEnd(14)} IoU=${r.silhouette.iou.toFixed(3)}  area=${r.silhouette.areaRatio.toFixed(3)}  dxy=[${r.centroidDeltaPx.map(v=>v.toFixed(1)).join(', ')}]  colour=[${r.colour.ratio.join(', ')}]`)
}
await b.close()
