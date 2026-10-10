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

const sse = (...chunks) =>
  chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n'
const offerReply = offer => sse(
  { type: 'tool-input-available', toolCallId: offer.toolCallId, toolName: 'deep_think', input: { why: WHY, plan: PLAN } },
  { type: 'data-decke-deep-estimate', data: { toolCallId: offer.toolCallId, low: 40, high: 120 } },
  { type: 'tool-approval-request', approvalId: offer.approvalId, toolCallId: offer.toolCallId, signature: 'sig-deep-think' },
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

async function waitForPosts(page, bodies, count) {
  for (let i = 0; i < 100 && bodies.length < count; i += 1) await page.waitForTimeout(20)
  assert.equal(bodies.length, count)
}

function assertApprovalWire(body, offer, approved) {
  const parts = body.messages.flatMap(message => message.parts)
  const replay = parts.find(part => part.type === 'tool-deep_think' && part.toolCallId === offer.toolCallId
    && part.state === 'approval-responded')
  assert.ok(replay, 'the deep_think approval was not replayed in the next POST')
  assert.deepEqual(replay.input, { why: WHY, plan: PLAN })
  assert.equal(replay.approval.id, offer.approvalId)
  assert.equal(replay.approval.approved, approved)
  assert.equal(replay.approval.signature, 'sig-deep-think')
}

export async function checkDeepThinkCard(browser, server, out) {
  const results = []
  for (const width of [1440, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    const bodies = []
    await page.route('**/decke/history', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"ok":true,"recorded":false}',
    }))
    await page.route('**/api/chat', route => {
      bodies.push(JSON.parse(route.request().postData() ?? '{}'))
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'x-decke-credits': '200', 'cache-control': 'no-cache' },
        body: bodies.length % 2 === 1 ? offerReply(OFFERS[Math.floor((bodies.length - 1) / 2)]) : settledReply(),
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
      assert.equal(await card.getByRole('button', { name: 'Keep it quick' }).count(), 1)
      assert.equal(await card.getByRole('button', { name: 'Use Deep Think' }).count(), 1)
      await assertCardGeometry(page, card, width)
      await page.screenshot({ path: path.join(out, 'deep-think-' + width + '.png'), fullPage: true })

      await card.getByRole('button', { name: 'Keep it quick' }).click()
      await waitForPosts(page, bodies, 2)
      assertApprovalWire(bodies[1], OFFERS[0], false)
      await page.waitForFunction(() => window.deepThinkChat.busy === false)

      await page.evaluate(() => window.deepThinkChat.send('Now use Deep Think for the same choice.'))
      await waitForPosts(page, bodies, 3)
      await card.waitFor()
      await card.getByRole('button', { name: 'Use Deep Think' }).click()
      await waitForPosts(page, bodies, 4)
      assertApprovalWire(bodies[3], OFFERS[1], true)
      await page.waitForFunction(() => window.deepThinkChat.busy === false)

      results.push({ case: 'deep-think-card', width, docked: true, declineWire: true, approvalWire: true })
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
