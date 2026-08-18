// Second parity sweep: the six states the original eight-frame sweep does not
// cover. Deliberately a separate file from sweepref.mjs so both can run
// independently. Same instrument (compare.mjs), same camera (?parity=1).
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

// tag, reference png, state name, blender frame, state marker frame
const CASES = [
  ['confused',     'confused_0479.png',      'confused',      479,  459],
  ['loading',      'loading_1608.png',       'loading',       1608, 1588],
  ['card_present', 'card_present_1994.png',  'card_present',  1994, 1974],
  ['point',        'point_2085.png',         'point',         2085, 2065],
  // travel_far: the .blend's flight is baked at 2x speed and finishes 4.4 s early
  // (marker spacing across the whole timeline is duration + ~900 ms, which puts
  // travel_far's intended duration at ~6933 ms = the playbook's 6917). So the
  // port is compared at the MATCHING POSE TIME, 2 * the blender offset, which
  // checks the path and the pose without pretending the timing agrees.
  ['travel_far',   'travel_far_2272.png',    'travel_far',    2272, 2252, 1334],
  ['sleep',        'sleep_2507.png',         'sleep',         2507, 2487],
]

const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] })
for (const [tag, ref, state, F, M, tOverride] of CASES) {
  const p = await b.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 })
  await p.goto('http://localhost:5199/deckpal/dev/decke?parity=1', { waitUntil: 'networkidle' })
  await p.waitForTimeout(7500)
  await p.evaluate(({ state, F, M, tOverride }) => {
    const d = window.deckE
    d.setState(state, { blendMs: 0 })
    d.elapsed = (F - 1) / 30
    const tSec = tOverride != null ? tOverride / 1000 : (F - M) / 30
    d.stateStart = d.elapsed - tSec
    // DETERMINISM. Two bits of procedural state survive the warm-up and make an
    // otherwise identical run differ by up to 0.045 IoU: the blink schedule's
    // monotonic cursor (seeking backwards leaves it stale) and the idle float's
    // integrated clock. Both are reproducible once pinned. This does not make
    // the port match Blender's baked float — nothing can — it makes successive
    // runs of the harness comparable to each other.
    d.proc.blink.cursor = 0
    d.proc.float.tau = d.elapsed
    d.stop(); d.update(0)
    d.stage.renderer.render(d.stage.scene, d.stage.camera)
  }, { state, F, M, tOverride })
  await p.waitForTimeout(200)
  mkdirSync(`sw2/${tag}`, { recursive: true })
  await p.screenshot({ path: `sw2/${tag}/page.png` })
  await p.close()
  const out = execFileSync('node', ['compare.mjs', `ref/${ref}`, `sw2/${tag}/page.png`, `sw2/${tag}`], { encoding: 'utf8' })
  const r = JSON.parse(out)
  console.log(`${tag.padEnd(14)} IoU=${r.silhouette.iou.toFixed(3)}  area=${r.silhouette.areaRatio.toFixed(3)}  dxy=[${r.centroidDeltaPx.map(v => v.toFixed(1)).join(', ')}]  colour=[${r.colour.ratio.join(', ')}]`)
}
await b.close()
