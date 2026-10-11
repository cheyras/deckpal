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
    header: 'Priorities for this deck', // 24 — the longest header ask_user allows
    question: 'What should I optimize for?',
    multi: true,
    options: [
      { label: 'Speed', description: 'Prefer the fastest path.' },
      { label: 'Sources', description: 'Include supporting references.' },
    ],
  },
]
// The WHOLE tool input, as `ask_user` streams it. `about` is what the server's
// `answeringAsk` reads off the replayed part to route the answer; the browser
// used to keep only `questions`.
const ASK_INPUT = { about: 'deck_build', questions: QUESTIONS }
const ASK_OUTPUT = { shown: true }
const SUBMITTED = 'Format — Standard\nPriorities for this deck — Speed, Sources'
const SKIPPED = 'Skip those questions — go with your best judgment.'
const ASKED = 'Deck-E asks: How much detail should I use? Plus 1 more question.'
// What the server streams on a turn's first leg (`data-decke-route`).
const ROUTE = { tier: 'standard', pathways: ['deck_build'], effort: 'medium' }

const sse = (...chunks) =>
  chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n'
const askChunks = id => [
  { type: 'tool-input-available', toolCallId: id, toolName: 'ask_user', input: ASK_INPUT },
  { type: 'tool-output-available', toolCallId: id, output: ASK_OUTPUT },
]
const askReply = () => sse(
  { type: 'text-delta', delta: 'I need two quick choices before I continue.' },
  ...askChunks('ask-browser'),
)
// A reply that is ONLY the question: no words, no tool row. It used to be
// dropped from the next request's history, so the answers arrived bare.
const askOnlyReply = () => sse({ type: 'data-decke-route', data: ROUTE }, ...askChunks('ask-only'))
// A first leg that routes and then hands the browser a tool to run, so the turn
// continues on a second leg that must echo the route.
const routedLegReply = () => sse(
  { type: 'data-decke-route', data: ROUTE },
  { type: 'text-delta', delta: 'Let me get into view first.' },
  { type: 'tool-input-available', toolCallId: 'scroll-1', toolName: 'scrollToMe', input: {} },
)
const answerReply = () => sse({ type: 'text-delta', delta: 'Thanks — I can continue now.' })
// An ask that shares its leg with a browser tool. The leg after the tool runs
// must carry the ask, or the server cannot tell the question is still open.
const askBesideToolReply = () => sse(
  { type: 'data-decke-route', data: ROUTE },
  { type: 'text-delta', delta: 'Two quick choices, and let me get into view.' },
  ...askChunks('ask-beside'),
  { type: 'tool-input-available', toolCallId: 'scroll-2', toolName: 'scrollToMe', input: {} },
)

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

function assertAskWire(body, expectedText, { askOnly = false } = {}) {
  assert.equal(textOfLastUser(body), expectedText)
  const usersWithAnswer = body.messages.filter(message => message.role === 'user')
    .flatMap(message => message.parts)
    .filter(part => part.type === 'text' && part.text === expectedText)
  assert.equal(usersWithAnswer.length, 1, 'the answer must be sent as exactly one user message')
  const lastUserAt = body.messages.findLastIndex(message => message.role === 'user')
  // IMMEDIATELY before the answer: an ask-only reply that was dropped from the
  // wire would leave an earlier assistant message (or none) in its place.
  const previous = body.messages[lastUserAt - 1]
  assert.equal(previous?.role, 'assistant', 'the answer is not preceded by the reply that asked')
  const ask = previous.parts.at(-1)
  assert.equal(ask?.type, 'tool-ask_user', 'the assistant message does not end in the ask_user tool part')
  assert.equal(ask?.state, 'output-available')
  assert.deepEqual(ask?.input, ASK_INPUT, 'the replayed ask lost part of its input (about?)')
  assert.equal(ask?.input?.about, 'deck_build')
  assert.deepEqual(ask?.output, ASK_OUTPUT)
  if (askOnly) {
    assert.deepEqual(previous.parts.map(part => part.type), ['tool-ask_user'],
      'an ask-only reply should replay as exactly its ask, with no empty text part')
  }
  // A new reader message is routed fresh: the echo belongs to one turn's legs.
  assert.equal('tierRoute' in body, false, 'a new reader message carried the previous turn\'s route')
}

async function waitForPosts(page, bodies, count) {
  for (let i = 0; i < 250 && bodies.length < count; i += 1) await page.waitForTimeout(20)
  assert.equal(bodies.length, count)
}

/** The live region that speaks the turn boundary has said exactly `text`. */
async function waitForAnnouncement(page, text) {
  await page.waitForFunction(expected => [...document.querySelectorAll('[role="status"][aria-live="polite"]')]
    .some(node => node.textContent === expected), text, { timeout: 5000 })
    .catch(async () => {
      const said = await page.evaluate(() => [...document.querySelectorAll('[role="status"][aria-live="polite"]')]
        .map(node => node.textContent))
      assert.fail(`the docked ask was not announced as ${JSON.stringify(text)}; live regions said ${JSON.stringify(said)}`)
    })
}

export async function checkAskCard(browser, server, out) {
  const results = []
  for (const width of [1440, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    const bodies = []
    // One reply per POST, in order; anything past the script is a plain answer.
    const replies = []
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
        body: (replies.shift() ?? answerReply)(),
      })
    })
    try {
      await page.goto(server.origin + '/fixture.html?ask', { waitUntil: 'networkidle' })
      const panel = page.getByRole('dialog', { name: 'Chat with Deck-E' })
      await panel.waitFor({ state: 'visible' })
      replies.push(askReply)
      await page.evaluate(() => window.askChat.send('Help me choose the response shape.'))
      await waitForPosts(page, bodies, 1)
      await page.waitForFunction(() => window.askChat.busy === false)

      const card = panel.locator('[data-decke-ask-card]')
      await card.waitFor()
      assert.equal(await card.locator('form[aria-label="A few questions from Deck-E"]').count(), 1,
        'the docked ask surface is not the labelled AskCard form')
      // Words AND a card: both are said, the question read rather than focused.
      await waitForAnnouncement(page, 'Deck-E replied. ' + ASKED)
      const format = card.getByRole('group', { name: 'Format: How much detail should I use?' })
      const priorities = card.getByRole('group', { name: 'Priorities for this deck: What should I optimize for?' })
      // A 24-character header is shown whole, inside the card, and never leaves
      // its question a sliver: at 390px the question wraps under the chip.
      const form = card.locator('.decke-ask-card')
      const formBox = await rect(form)
      assert.ok(await form.evaluate(el => el.scrollWidth <= el.clientWidth), `the ask card scrolls sideways at ${width}px`)
      for (const group of [format, priorities]) {
        const chip = await rect(group.locator('.decke-ask-header'))
        const question = await rect(group.locator('p').first())
        assert.ok(chip.right <= formBox.right + 0.5, `a header chip overflows the ask card at ${width}px`)
        assert.ok(question.right - question.left >= 150, `a question was squeezed to ${Math.round(question.right - question.left)}px at ${width}px`)
      }
      assert.equal(await priorities.locator('.decke-ask-header').textContent(), 'Priorities for this deck')
      // Multi-select says so where it can be seen, and describes its group with it.
      const cue = priorities.getByText('Choose any', { exact: true })
      assert.ok(await cue.isVisible(), 'the multi-select question has no visible "Choose any" cue')
      assert.equal(await format.getByText('Choose any', { exact: true }).count(), 0, 'a single-choice question says "Choose any"')
      const describedAs = group => group.evaluate(element => (element.getAttribute('aria-describedby') ?? '')
        .split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim())
      assert.equal(await describedAs(priorities), 'Choose any')
      assert.equal(await describedAs(format), 'Choose one')
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
      assert.equal(await other.getAttribute('aria-controls'), null, 'a closed Other controls an input that is not there')
      await other.click()
      assert.equal(await other.getAttribute('aria-pressed'), 'true')
      const otherInput = format.getByRole('textbox', { name: 'Other answer for Format' })
      await otherInput.waitFor()
      // The press that opened it moves focus in, and the control names it.
      assert.ok(await otherInput.evaluate(element => element === document.activeElement), 'focus did not move into the Other field')
      assert.equal(await other.getAttribute('aria-controls'), await otherInput.getAttribute('id'))
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
      replies.push(askReply)
      await page.evaluate(() => window.askChat.send('Ask me again so I can skip.'))
      await waitForPosts(page, bodies, 3)
      await page.waitForFunction(() => window.askChat.busy === false)
      await card.waitFor()
      await card.getByRole('button', { name: 'Skip' }).click()
      await card.waitFor({ state: 'detached' })
      await waitForPosts(page, bodies, 4)
      assertAskWire(bodies[3], SKIPPED)
      await page.waitForFunction(() => window.askChat.busy === false)

      // ── AN ASK-ONLY REPLY ──────────────────────────────────────────────────
      // No words before the question and no tool row, so nothing but the ask
      // keeps it on the wire. It still docks, still speaks, and the answer's
      // request still carries the ask — `about` and all — right before it.
      await page.goto(server.origin + '/fixture.html?ask', { waitUntil: 'networkidle' })
      await panel.waitFor({ state: 'visible' })
      replies.push(askOnlyReply)
      await page.evaluate(() => window.askChat.send('Build me a deck.'))
      await waitForPosts(page, bodies, 5)
      await page.waitForFunction(() => window.askChat.busy === false)
      await card.waitFor()
      await waitForAnnouncement(page, ASKED)
      await card.getByRole('group', { name: 'Format: How much detail should I use?' })
        .getByRole('button', { name: /^Standard/ }).click()
      const askOnlyPriorities = card.getByRole('group', { name: 'Priorities for this deck: What should I optimize for?' })
      await askOnlyPriorities.getByRole('button', { name: /^Speed/ }).click()
      await askOnlyPriorities.getByRole('button', { name: /^Sources/ }).click()
      await card.getByRole('button', { name: 'Submit' }).click()
      await card.waitFor({ state: 'detached' })
      await waitForPosts(page, bodies, 6)
      assertAskWire(bodies[5], SUBMITTED, { askOnly: true })
      await page.waitForFunction(() => window.askChat.busy === false)

      // ── THE ROUTE ECHO ─────────────────────────────────────────────────────
      // The first leg streams its route and hands the browser a tool; the
      // continuation leg of the SAME turn sends the route back as `tierRoute`
      // (with `route` still the page path), and the next reader message does not.
      replies.push(routedLegReply)
      await page.evaluate(() => window.askChat.send('Come over here.'))
      await waitForPosts(page, bodies, 8)
      await page.waitForFunction(() => window.askChat.busy === false)
      const [firstLeg, continuation] = [bodies[6], bodies[7]]
      assert.equal('tierRoute' in firstLeg, false, 'a first leg sent a route it had not been given yet')
      assert.deepEqual(continuation.tierRoute, ROUTE, 'the continuation leg did not echo the route')
      assert.equal(continuation.route, firstLeg.route, 'the echo displaced the page path')
      assert.equal(typeof continuation.route, 'string')
      assert.equal(continuation.exchangeId, firstLeg.exchangeId, 'the continuation is not the same turn')
      await page.evaluate(() => window.askChat.send('Thanks.'))
      await waitForPosts(page, bodies, 9)
      await page.waitForFunction(() => window.askChat.busy === false)
      assert.equal('tierRoute' in bodies[8], false, 'a new reader message carried the previous turn\'s route')

      // ── AN ASK BESIDE A BROWSER TOOL ───────────────────────────────────────
      // `ask_user` emits no chip, so the leg loop's chip replay never carried
      // it: the continuation arrived without the question and ran as if it had
      // been answered. The leg's own assistant message must hold the ask, with
      // the browser tool's result still last.
      replies.push(askBesideToolReply)
      await page.evaluate(() => window.askChat.send('Show me, and ask what you need.'))
      await waitForPosts(page, bodies, 11)
      await page.waitForFunction(() => window.askChat.busy === false)
      const resumed = bodies[10]
      assert.deepEqual(resumed.tierRoute, ROUTE, 'the continuation leg did not echo the route')
      const legMessage = resumed.messages.at(-1)
      assert.equal(legMessage?.role, 'assistant')
      const replayedAsk = legMessage.parts.find(part => part.type === 'tool-ask_user')
      assert.ok(replayedAsk, 'the continuation leg dropped the ask its first leg showed')
      assert.equal(replayedAsk.toolCallId, 'ask-beside')
      assert.equal(replayedAsk.state, 'output-available')
      assert.deepEqual(replayedAsk.input, ASK_INPUT, 'the replayed ask lost part of its input')
      assert.equal(legMessage.parts.at(-1)?.type, 'tool-scrollToMe', 'the browser tool result is no longer last')
      assert.equal(legMessage.parts.filter(part => part.type === 'tool-ask_user').length, 1, 'the ask was replayed twice')
      await card.waitFor()

      results.push({ case: 'ask-card', width, docked: true, selection: true, submitWire: true, skipWire: true,
        askOnlyWire: true, announced: true, multiCue: true, routeEcho: true, askBesideTool: true })
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
