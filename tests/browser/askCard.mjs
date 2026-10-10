import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { chatAllowMutation, chatApi } from './chat.mjs'
import { contextFor, isolatedEnv, ROOT, run, serve, WEB } from './support.mjs'

const QUESTIONS = [
  {
    header: 'Format',
    question: 'How much detail should I use?',
    options: [
      { label: 'Quick', description: 'Just the answer.' },
      { label: 'Standard', description: 'A balanced explanation.' },
      { label: 'Detailed', description: 'Walk through the reasoning.' },
    ],
  },
  {
    header: 'Priorities',
    question: 'What should I optimize for?',
    multi: true,
    options: [
      { label: 'Speed', description: 'Prefer the fastest path.' },
      { label: 'Sources', description: 'Include supporting references.' },
    ],
  },
]
const ASK_OUTPUT = { shown: true }
const SUBMITTED = 'Format — Standard\nPriorities — Speed, Sources'
const SKIPPED = 'Skip those questions — go with your best judgment.'

const sse = (...chunks) =>
  chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n'
const askReply = () => sse(
  { type: 'text-delta', delta: 'I need two quick choices before I continue.' },
  { type: 'tool-input-available', toolCallId: 'ask-browser', toolName: 'ask_user', input: { questions: QUESTIONS } },
  { type: 'tool-output-available', toolCallId: 'ask-browser', output: ASK_OUTPUT },
)
const answerReply = () => sse({ type: 'text-delta', delta: 'Thanks — I can continue now.' })

const rect = locator => locator.evaluate(element => {
  const box = element.getBoundingClientRect()
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
})
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

async function settledPark(page, card, width) {
  const park = page.locator('[data-decke-park]')
  if (width >= 1068) {
    assert.equal(await park.count(), 0, 'desktop should use the composer landmark instead of a phone park box')
    const floor = page.locator('[data-decke-composer]')
    assert.equal(await floor.count(), 1, 'the ask card lost the desktop approval-slot floor')
    const floorBox = await rect(floor)
    // The dock wrapper is 760px; the visible card (the form) carries the 16px inset that
    // lines it up with the composer, exactly as the approval and feedback cards do.
    const cardBox = await rect(card.locator('.decke-ask-card'))
    assert.ok(cardBox.left >= floorBox.left - 0.5, `the ask card starts left of the column Deck-E stands beside (card ${JSON.stringify(cardBox)}, composer ${JSON.stringify(floorBox)})`)
    return 'desktop-composer'
  }

  assert.equal(await park.count(), 1, 'the phone park box is missing')
  const key = () => page.evaluate(() => {
    const nodes = ['[data-decke-park]', '[data-decke-ask-card]'].map(selector => document.querySelector(selector))
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
  assert.ok(still >= 5 && Date.now() - since >= 500, 'the ask-card floor never settled')
  const parkBox = await rect(park)
  const cardBox = await rect(card)
  assert.equal(overlap(parkBox, cardBox), 0,
    `Deck-E's settled park box overlaps the ask card (${JSON.stringify({ parkBox, cardBox })})`)
  return await park.getAttribute('style')
}

const textOfLastUser = body => {
  const user = body.messages.filter(message => message.role === 'user').at(-1)
  return user?.parts.find(part => part.type === 'text')?.text
}

function assertAskWire(body, expectedText) {
  assert.equal(textOfLastUser(body), expectedText)
  const usersWithAnswer = body.messages.filter(message => message.role === 'user')
    .flatMap(message => message.parts)
    .filter(part => part.type === 'text' && part.text === expectedText)
  assert.equal(usersWithAnswer.length, 1, 'the answer must be sent as exactly one user message')
  const lastUserAt = body.messages.findLastIndex(message => message.role === 'user')
  const previous = body.messages.slice(0, lastUserAt).findLast(message => message.role === 'assistant')
  assert.ok(previous, 'the answer request has no preceding assistant message')
  const ask = previous.parts.at(-1)
  assert.equal(ask?.type, 'tool-ask_user', 'the assistant message does not end in the ask_user tool part')
  assert.equal(ask?.state, 'output-available')
  assert.deepEqual(ask?.input, { questions: QUESTIONS })
  assert.deepEqual(ask?.output, ASK_OUTPUT)
}

async function waitForPosts(page, bodies, count) {
  for (let i = 0; i < 100 && bodies.length < count; i += 1) await page.waitForTimeout(20)
  assert.equal(bodies.length, count)
}

export async function checkAskCard(browser, server, out) {
  const results = []
  for (const width of [1440, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    const bodies = []
    await page.route('**/decke/history', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"ok":true,"recorded":false}',
    }))
    await page.route('**/api/chat', async route => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      bodies.push(body)
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'x-decke-credits': '2', 'cache-control': 'no-cache' },
        body: bodies.length % 2 === 1 ? askReply() : answerReply(),
      })
    })
    try {
      await page.goto(server.origin + '/fixture.html?ask', { waitUntil: 'networkidle' })
      const panel = page.getByRole('dialog', { name: 'Chat with Deck-E' })
      await panel.waitFor({ state: 'visible' })
      await page.evaluate(() => window.askChat.send('Help me choose the response shape.'))
      await waitForPosts(page, bodies, 1)
      await page.waitForFunction(() => window.askChat.busy === false)

      const card = panel.locator('[data-decke-ask-card]')
      await card.waitFor()
      assert.equal(await card.locator('form[aria-label="A few questions from Deck-E"]').count(), 1,
        'the docked ask surface is not the labelled AskCard form')
      const format = card.getByRole('group', { name: 'Format: How much detail should I use?' })
      const priorities = card.getByRole('group', { name: 'Priorities: What should I optimize for?' })
      const optionButtons = [
        format.getByRole('button', { name: /^Quick/ }),
        format.getByRole('button', { name: /^Standard/ }),
        format.getByRole('button', { name: /^Detailed/ }),
        priorities.getByRole('button', { name: /^Speed/ }),
        priorities.getByRole('button', { name: /^Sources/ }),
      ]
      for (const button of optionButtons) {
        assert.equal(await button.evaluate(element => element.tagName), 'BUTTON')
        assert.equal(await button.getAttribute('aria-pressed'), 'false')
      }

      const standard = optionButtons[1]
      await standard.click()
      assert.equal(await standard.getAttribute('aria-pressed'), 'true')
      await optionButtons[0].click()
      assert.equal(await standard.getAttribute('aria-pressed'), 'false', 'single-choice options stayed selected together')
      assert.equal(await optionButtons[0].getAttribute('aria-pressed'), 'true')
      await optionButtons[3].click()
      await optionButtons[4].click()
      assert.equal(await optionButtons[3].getAttribute('aria-pressed'), 'true')
      assert.equal(await optionButtons[4].getAttribute('aria-pressed'), 'true', 'multi-select did not retain both choices')

      const other = format.getByRole('button', { name: 'Other…' })
      await other.click()
      assert.equal(await other.getAttribute('aria-pressed'), 'true')
      const otherInput = format.getByRole('textbox', { name: 'Other answer for Format' })
      await otherInput.waitFor()
      assert.ok(await settledPark(page, card, width))
      await page.screenshot({ path: path.join(out, 'ask-card-' + width + '.png'), fullPage: true })

      await standard.click()
      assert.equal(await otherInput.count(), 0, 'choosing an option did not close Other')
      assert.equal(await standard.getAttribute('aria-pressed'), 'true')
      await card.getByRole('button', { name: 'Submit' }).click()
      await card.waitFor({ state: 'detached' })
      await waitForPosts(page, bodies, 2)
      assertAskWire(bodies[1], SUBMITTED)
      await page.waitForFunction(() => window.askChat.busy === false)

      await page.goto(server.origin + '/fixture.html?ask', { waitUntil: 'networkidle' })
      await panel.waitFor({ state: 'visible' })
      await page.evaluate(() => window.askChat.send('Ask me again so I can skip.'))
      await waitForPosts(page, bodies, 3)
      await page.waitForFunction(() => window.askChat.busy === false)
      await card.waitFor()
      await card.getByRole('button', { name: 'Skip' }).click()
      await card.waitFor({ state: 'detached' })
      await waitForPosts(page, bodies, 4)
      assertAskWire(bodies[3], SKIPPED)

      results.push({ case: 'ask-card', width, docked: true, selection: true, submitWire: true, skipWire: true })
    } finally {
      await context.close()
    }
  }
  return results
}

export function browserSuites({ browser, out, scratch, results, logs }) {
  return [{
    name: 'ask-card',
    async run() {
      const fixtureDist = path.join(scratch, 'ask-card')
      logs.push(await run(process.execPath, [path.join(WEB, 'node_modules/vite/bin/vite.js'), 'build',
        '--config', path.join(ROOT, 'tests/browser/vite.config.mjs'), '--outDir', fixtureDist],
      { env: isolatedEnv() }))
      const server = await serve(fixtureDist, '', chatApi, 'fixture.html', { allowMutation: chatAllowMutation })
      try {
        results.push(...await checkAskCard(browser, server, out))
        assert.deepEqual(server.unexpected, [], 'Ask card fixture: unexpected network/error events')
      } finally {
        await server.close()
      }
    },
  }]
}

async function runOnlyAskCard() {
  const out = path.resolve(process.env.TEST_ARTIFACT_DIR ?? path.join(ROOT, '.cache/browser-tests/ask-card'))
  fs.mkdirSync(out, { recursive: true })
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-ask-card-'))
  const results = [], logs = []
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
  try {
    await browserSuites({ browser, out, scratch, results, logs })[0].run()
    console.log('PASS ask card browser journey:', JSON.stringify(results))
  } finally {
    await browser.close()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runOnlyAskCard()
}
