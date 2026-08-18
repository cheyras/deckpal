// Drive /dev/decke through its real UI, the way a user does — and through the
// JSON console, which is the surface the LLM will eventually drive.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const b = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader'] })
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const errors = []
p.on('pageerror', e => errors.push('pageerror: ' + e.message))
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await p.goto('http://localhost:5199/deckpal/dev/decke', { waitUntil: 'networkidle' })
await p.waitForTimeout(8000)
mkdirSync('dev', { recursive: true })

const status = () => p.evaluate(() => {
  const d = window.deckE
  const el = [...document.querySelectorAll('*')].find(n =>
    /state\s+\S+\s+·\s+facing/.test(n.textContent || '') && n.children.length === 0)
  return {
    line: el ? el.textContent.trim() : null,
    state: d.stateName ?? d.state ?? null,
    facing: d.facing ?? (d.pose && d.pose.facing) ?? null,
  }
})

// 1. every state button, in order — does any of them throw or wedge the loop?
const stateButtons = await p.evaluate(() =>
  [...document.querySelectorAll('button')].map(b => b.textContent.trim())
    .filter(t => /^[a-z_]+$/.test(t) && t !== 'release'))
console.log('driving', stateButtons.length, 'state buttons')
let broke = null
for (const name of stateButtons) {
  await p.getByRole('button', { name, exact: true }).first().click()
  await p.waitForTimeout(140)
  const s = await status()
  if (!s.line) { broke = name; break }
}
console.log(broke ? `WEDGED at ${broke}` : 'all state buttons OK — status line alive throughout')
console.log('status after sweep:', JSON.stringify(await status()))

// 2. facing
await p.getByRole('button', { name: 'Face left (−1)' }).click()
await p.waitForTimeout(1100)
const facedLeft = await p.evaluate(() => {
  const y = window.deckE.stage.scene.getObjectByName('DeckE_Facing').rotation.y
  return +(y * 180 / Math.PI).toFixed(1)
})
await p.getByRole('button', { name: 'Face right (+1)' }).click()
await p.waitForTimeout(1100)
const facedRight = await p.evaluate(() => {
  const y = window.deckE.stage.scene.getObjectByName('DeckE_Facing').rotation.y
  return +(y * 180 / Math.PI).toFixed(1)
})
console.log(`facing yaw: left ${facedLeft}deg  right ${facedRight}deg`)

// 3. talk overlay on top of an emote
await p.getByRole('button', { name: 'happy', exact: true }).click()
await p.getByRole('button', { name: 'Start talking' }).click()
await p.waitForTimeout(600)
const talking = await p.evaluate(() => ({ mouth: +window.deckE.pose.mouth.toFixed(3) }))
await p.getByRole('button', { name: 'Stop', exact: true }).click()
console.log('talk overlay while happy — mouth:', JSON.stringify(talking))

// 4. flyTo via the UI
const rootBefore = await p.evaluate(() =>
  window.deckE.stage.scene.getObjectByName('DeckE_Root').position.toArray().map(v => +v.toFixed(2)))
await p.getByRole('button', { name: 'fly here' }).first().click()
await p.waitForTimeout(2600)
const rootAfter = await p.evaluate(() =>
  window.deckE.stage.scene.getObjectByName('DeckE_Root').position.toArray().map(v => +v.toFixed(2)))
console.log('flyTo — root', JSON.stringify(rootBefore), '->', JSON.stringify(rootAfter))
await p.screenshot({ path: 'dev/flown.png' })

// 5. the JSON console: a good batch, then a rejected one
const runJson = async (obj) => {
  const ta = p.locator('textarea').first()
  await ta.fill(JSON.stringify(obj))
  await p.getByRole('button', { name: 'Run' }).click()
  await p.waitForTimeout(500)
  return p.evaluate(() => {
    const pre = [...document.querySelectorAll('pre,code')].map(n => n.textContent.trim()).filter(Boolean)
    return pre[pre.length - 1] || null
  })
}
console.log('\n-- JSON console, valid batch --')
console.log((await runJson({ commands: [
  { op: 'state', value: 'curious' }, { op: 'facing', value: 'left' }, { op: 'talk', value: true },
] }) || '').slice(0, 300))
console.log('\n-- JSON console, unknown state (must REJECT, not clamp) --')
console.log((await runJson({ commands: [{ op: 'state', value: 'ecstatic' }] }) || '').slice(0, 500))

await p.getByRole('button', { name: 'Return home' }).click()
await p.waitForTimeout(2200)
await p.screenshot({ path: 'dev/final.png' })
console.log('\n' + (errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console/page errors'))
await b.close()
