import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { chatAllowMutation, chatApi } from './chat.mjs'
import { contextFor, isolatedEnv, ROOT, run, serve, WEB } from './support.mjs'

const WHY = 'Compare the strongest lines and tradeoffs before recommending a deck.'
const PLAN = 'Review the options, test the matchups, and explain the recommendation.'
const OFFERS = [
  { toolCallId: 'deep-think-decline', approvalId: 'ap-deep-think-decline' },
  { toolCallId: 'deep-think-approve', approvalId: 'ap-deep-think-approve' },
]

const TOKEN = offer => 'dt1.1760000000000.token-for-' + offer.toolCallId
const GRANT = 'dt1.1760000000000.grant-for-this-turn'
const KEEP_QUICK = /^\[\[KEEP_QUICK\]\] The reader declined Deep Think/

const sse = (...chunks) =>
  chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n'
// The server's offer arrives AFTER the SDK's card here, as it may in production
// (it is written beside the SDK's stream), so the hook must attach it late.
const offerReply = offer => sse(
  { type: 'tool-input-available', toolCallId: offer.toolCallId, toolName: 'deep_think', input: { why: WHY, plan: PLAN } },
  { type: 'tool-approval-request', approvalId: offer.approvalId, toolCallId: offer.toolCallId, signature: 'sig-deep-think' },
  { type: 'data-decke-deep-offer', data: { toolCallId: offer.toolCallId, token: TOKEN(offer), estimate: { low: 40, high: 120 } } },
)
// The approval leg: deep_think ran (its row and its result, which carries the
// grant), then Opus asked the browser for one tool — so there is a leg after it.
const approvedReply = offer => sse(
  { type: 'data-decke-tool', data: { phase: 'start', id: offer.toolCallId, name: 'deep_think', title: 'Deep Think' } },
  { type: 'data-decke-tool', data: { phase: 'ok', id: offer.toolCallId, name: 'deep_think', title: 'Deep Think', summary: 'Deep Think is on for this request' } },
  { type: 'tool-output-available', toolCallId: offer.toolCallId, output: { status: 'on', grant: GRANT, note: 'Deep Think is on for this request.' } },
  { type: 'text-delta', delta: 'Working through it properly.' },
  { type: 'tool-input-available', toolCallId: 'scroll-after-deep', toolName: 'scrollToMe', input: {} },
)
const settledReply = () => sse({ type: 'text-delta', delta: 'I have continued with your choice.' })

const rect = locator => locator.evaluate(element => {
  const box = element.getBoundingClientRect()
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
})
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

async function assertCardGeometry(page, card, width) {
  if (width >= 1068) {
    const cardBox = await rect(card)
    assert.ok(cardBox.right > cardBox.left && cardBox.bottom > cardBox.top, 'the visible Deep Think card has no geometry')
    const composer = page.locator('[data-decke-composer]')
    assert.equal(await composer.count(), 1, 'desktop lost the approval-slot composer floor')
    const composerBox = await rect(composer)
    assert.ok(cardBox.left >= composerBox.left - 0.5,
      `the Deep Think card starts left of its composer (${JSON.stringify({ cardBox, composerBox })})`)
    return
  }
  const park = page.locator('[data-decke-park]')
  assert.equal(await park.count(), 1, 'the phone park box is missing')
  const key = () => page.evaluate(() => {
    const nodes = ['[data-decke-park]', '[data-decke-deep-think]'].map(selector => document.querySelector(selector))
    return nodes.map(node => node
      ? Math.round(node.getBoundingClientRect().top) + ':' + Math.round(node.getBoundingClientRect().bottom)
      : '-').join('|')
  })
  let last = await key(), still = 0, since = Date.now()
  for (let i = 0; i < 240 && (still < 5 || Date.now() - since < 500); i += 1) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
    const next = await key()
    if (next === last) still += 1
    else { last = next; still = 0; since = Date.now() }
  }
  assert.ok(still >= 5 && Date.now() - since >= 500, 'the Deep Think card floor never settled')
  const cardBox = await rect(card)
  assert.ok(cardBox.right > cardBox.left && cardBox.bottom > cardBox.top, 'the visible Deep Think card has no geometry')
  const parkBox = await rect(park)
  assert.equal(overlap(parkBox, cardBox), 0,
    `Deck-E's park overlaps the visible Deep Think card (${JSON.stringify({ parkBox, cardBox })})`)
}

/**
 * At least `count` POSTs. The approval leg and the leg after it can land
 * within one poll of each other, so a later POST may already be here; the
 * journey's final count is checked exactly once it settles.
 */
async function waitForPosts(page, bodies, count) {
  for (let i = 0; i < 100 && bodies.length < count; i += 1) await page.waitForTimeout(20)
  assert.ok(bodies.length >= count, `expected ${count} POSTs, saw ${bodies.length}`)
}

function assertApprovalWire(body, offer, approved) {
  const final = body.messages.at(-1)
  const replay = final.parts.at(-1)
  assert.equal(replay.type, 'tool-deep_think', 'the deep_think answer is not the last part of the final message')
  assert.equal(replay.toolCallId, offer.toolCallId)
  assert.equal(replay.state, 'approval-responded')
  assert.deepEqual(replay.input, { why: WHY, plan: PLAN })
  assert.equal(replay.approval.id, offer.approvalId)
  assert.equal(replay.approval.approved, approved)
  assert.equal(replay.approval.signature, 'sig-deep-think')
  // The server's turn binding rides beside the SDK's approval, never inside it.
  assert.equal(replay.deepOffer, TOKEN(offer), 'the offer token was not replayed with the answer')
  assert.equal('deepOffer' in replay.approval, false)
  if (approved) assert.equal('reason' in replay.approval, false)
  else assert.match(replay.approval.reason, KEEP_QUICK, '"Keep it quick" sent the write-decline reason')
}

/** The leg after the approval leg: the yes has become the result that carries the grant. */
function assertGrantWire(body, offer) {
  const parts = body.messages.flatMap(message => message.parts)
  const deep = parts.filter(part => part.type === 'tool-deep_think' && part.toolCallId === offer.toolCallId)
  assert.equal(deep.length, 1, 'the deep_think call is replayed twice (or not at all) — a duplicate or unpaired call')
  assert.equal(deep[0].state, 'output-available', 'the answered yes was left behind as an unpaired approval')
  assert.equal(JSON.parse(deep[0].output).grant, GRANT, 'the grant did not reach the next leg')
  assert.equal('approval' in deep[0], false)
  const scroll = parts.find(part => part.type === 'tool-scrollToMe')
  assert.equal(scroll?.state, 'output-available', 'the browser tool result is missing')
}

/**
 * The newest reply's activity line that reads `summary` (a reply has one per
 * run of steps between its words), and opening it shows the `step` row.
 */
async function expandedStep(panel, summary, step) {
  const lines = panel.locator('[data-decke-activity]')
  let seen = []
  for (let attempt = 0; attempt < 50; attempt += 1) {
    seen = await lines.locator('> button[aria-expanded]').allTextContents()
    const at = seen.findLastIndex(text => summary.test(text.trim()))
    if (at >= 0) {
      const line = lines.nth(at)
      const toggle = line.locator('> button[aria-expanded]')
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
      await line.getByText(step, { exact: true }).waitFor()
      return
    }
    await panel.page().waitForTimeout(100)
  }
  throw new Error(`no activity line reads ${summary}; the lines read ${JSON.stringify(seen)}`)
}

/**
 * The server's price is what the eye lands on: above the model-written reason
 * and plan, and at least as large and as heavy. An injection can steer the
 * prose on this card, never the price.
 */
async function assertPriceLeads(card) {
  const look = locator => locator.evaluate(element => {
    const style = getComputedStyle(element)
    return { top: element.getBoundingClientRect().top, size: parseFloat(style.fontSize), weight: Number(style.fontWeight) }
  })
  const cost = await look(card.locator('[data-decke-deep-think-cost]'))
  const why = await look(card.getByText(WHY, { exact: true }))
  const plan = await look(card.locator('p', { hasText: PLAN }))
  assert.ok(cost.top < why.top && cost.top < plan.top, `the model's prose is drawn above the price (${JSON.stringify({ cost, why, plan })})`)
  assert.ok(cost.size >= why.size && cost.size >= plan.size, `the price is smaller than the model's prose (${JSON.stringify({ cost, why, plan })})`)
  assert.ok(cost.weight > why.weight, `the price is no heavier than the model's prose (${JSON.stringify({ cost, why })})`)
}

/** "Use Deep Think" is disabled until the balance read after the card went up has landed. */
async function assertWaitsForBalance(page, card) {
  const use = card.getByRole('button', { name: 'Use Deep Think' })
  assert.equal(await use.count(), 1)
  assert.equal(await use.isDisabled(), true, 'Use Deep Think is live while the balance is unknown')
  await card.getByText('Checking your balance…', { exact: true }).waitFor()
  await page.evaluate(() => window.deepThinkChat.setBalance(200))
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('[data-decke-deep-think] button')]
      .find(element => element.textContent?.trim() === 'Use Deep Think')
    return button && !button.disabled
  })
  assert.equal(await card.getByText('Checking your balance…', { exact: true }).count(), 0)
}

export async function checkDeepThinkCard(browser, server, out) {
  const results = []
  for (const width of [1440, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    const bodies = []
    await page.route('**/decke/history', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"ok":true,"recorded":false}',
    }))
    // POST by POST: offer → decline answer → offer → approval leg → the leg after it.
    const replies = [
      () => offerReply(OFFERS[0]),
      settledReply,
      () => offerReply(OFFERS[1]),
      () => approvedReply(OFFERS[1]),
      settledReply,
    ]
    await page.route('**/api/chat', route => {
      bodies.push(JSON.parse(route.request().postData() ?? '{}'))
      const reply = replies[bodies.length - 1]
      if (!reply) return route.fulfill({ status: 500, body: 'unexpected extra POST ' + bodies.length })
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'x-decke-credits': '200', 'cache-control': 'no-cache' },
        body: reply(),
      })
    })
    try {
      await page.goto(server.origin + '/fixture.html?deep-think', { waitUntil: 'networkidle' })
      const panel = page.getByRole('dialog', { name: 'Chat with Deck-E' })
      await panel.waitFor({ state: 'visible' })

      await page.evaluate(() => window.deepThinkChat.send('Think deeply about my deck choice.'))
      await waitForPosts(page, bodies, 1)
      const card = panel.locator('[data-decke-deep-think]')
      await card.waitFor()
      await card.getByText('Deep Think', { exact: true }).waitFor()
      await card.getByText(WHY, { exact: true }).waitFor()
      await card.getByText('About 40–120 credits', { exact: true }).waitFor()
      await assertPriceLeads(card)
      assert.equal(await card.getByRole('button', { name: 'Keep it quick' }).count(), 1)
      await assertWaitsForBalance(page, card)
      await assertCardGeometry(page, card, width)
      await page.screenshot({ path: path.join(out, 'deep-think-' + width + '.png'), fullPage: true })

      await card.getByRole('button', { name: 'Keep it quick' }).click()
      await waitForPosts(page, bodies, 2)
      assertApprovalWire(bodies[1], OFFERS[0], false)
      await page.waitForFunction(() => window.deepThinkChat.busy === false)
      // The turn's activity line says what the reader chose — not "Skipped that change".
      await expandedStep(panel, /^Kept it quick · \d+s$/, 'Kept it quick')

      // A new card is priced against a NEW balance read, unknown until it lands.
      await page.evaluate(() => window.deepThinkChat.setBalance(null))
      await page.evaluate(() => window.deepThinkChat.send('Now use Deep Think for the same choice.'))
      await waitForPosts(page, bodies, 3)
      await card.waitFor()
      await assertWaitsForBalance(page, card)
      await card.getByRole('button', { name: 'Use Deep Think' }).click()
      await waitForPosts(page, bodies, 4)
      assertApprovalWire(bodies[3], OFFERS[1], true)
      // The approval leg ran deep_think and handed the browser a tool, so the
      // turn continues — and that next POST carries the result, not the yes.
      await waitForPosts(page, bodies, 5)
      assertGrantWire(bodies[4], OFFERS[1])
      await page.waitForFunction(() => window.deepThinkChat.busy === false)
      await expandedStep(panel, /^Looked at 1 thing · \d+s$/, 'Used Deep Think')

      assert.equal(bodies.length, 5, 'the journey made an unexpected extra request')
      results.push({ case: 'deep-think-card', width, docked: true, waitsForBalance: true, priceLeads: true, declineWire: true, approvalWire: true, grantWire: true })
    } finally {
      await context.close()
    }
  }
  return results
}

export function browserSuites({ browser, out, scratch, results, logs }) {
  return [{
    name: 'deep-think-card',
    async run() {
      const fixtureDist = path.join(scratch, 'deep-think-card')
      logs.push(await run(process.execPath, [path.join(WEB, 'node_modules/vite/bin/vite.js'), 'build',
        '--config', path.join(ROOT, 'tests/browser/vite.config.mjs'), '--outDir', fixtureDist],
      { env: isolatedEnv() }))
      const server = await serve(fixtureDist, '', chatApi, 'fixture.html', { allowMutation: chatAllowMutation })
      try {
        results.push(...await checkDeepThinkCard(browser, server, out))
        assert.deepEqual(server.unexpected, [], 'Deep Think card fixture: unexpected network/error events')
      } finally {
        await server.close()
      }
    },
  }]
}

async function runOnlyDeepThinkCard() {
  const out = path.resolve(process.env.TEST_ARTIFACT_DIR ?? path.join(ROOT, '.cache/browser-tests/deep-think'))
  fs.mkdirSync(out, { recursive: true })
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-deep-think-card-'))
  const results = [], logs = []
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  try {
    await browserSuites({ browser, out, scratch, results, logs })[0].run()
    console.log('PASS Deep Think card browser journey:', JSON.stringify(results))
  } finally {
    await browser.close()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runOnlyDeepThinkCard()
}
