import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { contextFor, run } from './support.mjs'
const assistant = text => [{ id: 'reply', role: 'assistant', parts: [{ kind: 'text', id: 'text', text }] }]
async function set(page, patch) {
  await page.evaluate(patch => window.fixture.set(patch), patch)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
/**
 * ── THE METER-REFUSAL WIRE, over a real fetch ───────────────────────────────
 *
 * Everything else in this file renders presentation from fixed props. This case
 * runs the real `useDeckeChat` and intercepts `/api/chat` at the page, so the
 * request bodies below are the ones the production transport actually builds:
 * real SSE parsing, real approval round trip, real leg accumulation.
 *
 * The scenario is the measured bug. Leg 1 asks to write a strategy guide. Leg 2
 * executes it, the meter refuses for lack of credits, and the same leg hands
 * the browser a client tool to run AND an unrelated write to sign for — so the
 * turn continues into leg 3, on a fresh server with no memory. Leg 3's body is
 * the one that used to arrive with no trace of the refusal at all.
 *
 * Page-level routes are used deliberately: they take precedence over the
 * harness's own catch-all, so no fixture-server mutation policy is involved and
 * `server.unexpected` stays empty.
 */
const NO_WORK_TAIL =
  'There is NO result. Do not describe, summarise, continue from or refer to work that did not happen. ' +
  'Do not say "let\'s build", do not list cards, do not give counts. ' +
  'Say plainly that it did not happen and why, and stop.'
/** Byte-identical to `deepRefused('…','credits')`; `meterReplayProof.mts` pins it. */
const GUIDE_REFUSAL =
  '[[NO_WORK]] REFUSED [meter:credits] — this tool did not run. ' +
  'this needs 2 credits and only 0 are left. ' + NO_WORK_TAIL
const GUIDE_CALL = 'guide-call-1'
/**
 * What `needsApproval` leaves on the input before the card is drawn — the
 * server injects `no_research` on an unbacked guide, so this, not the model's
 * `{deck_id, findings}`, is what rides the wire. `meterReplayProof.mts` then
 * replays the model's plain object: the two must fingerprint the same.
 */
const GUIDE_INPUT_INJECTED = { deck_id: 'deck-browser', findings: '', no_research: true }
const sse = (...chunks) =>
  chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n'
const LEGS = [
  // 1. He proposes the guide and stops for consent.
  sse(
    { type: 'text-delta', delta: 'I can write that guide for you.' },
    { type: 'tool-input-available', toolCallId: GUIDE_CALL, toolName: 'write_strategy_guide',
      input: GUIDE_INPUT_INJECTED },
    { type: 'tool-approval-request', approvalId: 'ap-guide', toolCallId: GUIDE_CALL, signature: 'sig-guide' },
  ),
  // 2. Approved, executed, refused by the meter — and the turn does not end,
  //    because a browser tool and a second, unrelated consent are still open.
  //
  //    NO SECOND `tool-input-available` FOR THE GUIDE. That is the real SDK's
  //    shape on an approval continuation — measured by the driver's
  //    `probe-approved-refusal-stream.mts` — and repeating the input here would
  //    hide the bug it exists to catch: the refusal arrives with an id and
  //    nothing to name it, so identity has to come from the outgoing wire.
  sse(
    { type: 'data-decke-tool', data: { id: GUIDE_CALL, name: 'write_strategy_guide',
      title: 'Writing a strategy guide', phase: 'error', summary: 'not enough credits — 2 needed, 0 left' } },
    { type: 'tool-output-available', toolCallId: GUIDE_CALL, output: GUIDE_REFUSAL },
    { type: 'text-delta', delta: ' I could not write it.' },
    { type: 'tool-input-available', toolCallId: 'scroll-1', toolName: 'scrollToMe', input: {} },
    { type: 'tool-input-available', toolCallId: 'log-1', toolName: 'log_cards',
      input: { cards: [{ name: 'Pikachu', quantity: 1 }] } },
    { type: 'tool-approval-request', approvalId: 'ap-log', toolCallId: 'log-1', signature: 'sig-log' },
  ),
  // 3. The leg under test. Its REQUEST is the artefact; the reply just ends.
  sse({ type: 'text-delta', delta: ' Logged the card instead.' }),
  // 4. A new user message — a new turn, which must be able to ask again.
  sse({ type: 'text-delta', delta: 'Still nothing, sorry.' }),
]
async function checkMeterReplay(page, server, width, out) {
  const bodies = []
  await page.route('**/decke/history', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"recorded":false}' }))
  await page.route('**/api/chat', route => {
    bodies.push(JSON.parse(route.request().postData() ?? '{}'))
    const body = LEGS[bodies.length - 1]
    assert.ok(body, 'the hook made more legs than the scenario has: ' + bodies.length)
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      headers: { 'x-decke-credits': '2', 'cache-control': 'no-cache' }, body })
  })
  await page.goto(server.origin + '/fixture.html?meter', { waitUntil: 'networkidle' })
  const panel = page.getByRole('dialog', { name: 'Chat with Deck-E' })
  await panel.waitFor({ state: 'visible' })
  await page.evaluate(() => window.meterChat.send('Write me a strategy guide for that deck.'))

  // CONSENT IS GIVEN THROUGH THE REAL CARD, twice, so the signed round trip and
  // its ordering are exercised rather than simulated.
  const card = panel.getByRole('alertdialog', { name: 'Deck-E is asking permission' })
  await card.waitFor()
  await page.screenshot({ path: path.join(out, 'meter-approval-' + width + '.png'), fullPage: true })
  await card.getByRole('button', { name: 'Go ahead' }).click()
  await page.waitForFunction(() => window.meterChat.busy === false || document
    .querySelector('[role="dialog"]')?.textContent?.includes('could not write'))
  await card.waitFor()
  await card.getByRole('button', { name: 'Go ahead' }).click()
  await page.waitForFunction(() => window.meterChat.busy === false)
  await panel.getByText('Logged the card instead.', { exact: false }).waitFor()
  assert.equal(bodies.length, 3, 'the refusal turn must reach a third leg')

  // A NEW USER TURN. The refusal must NOT survive it — a top-up or a daily
  // reset can only land if the reader's next message re-asks the meter.
  await page.evaluate(() => window.meterChat.send('Any change now?'))
  await page.waitForFunction(() => window.meterChat.busy === false)
  assert.equal(bodies.length, 4)
  await page.screenshot({ path: path.join(out, 'meter-' + width + '.png'), fullPage: true })

  const replayed = bodies[2].messages.flatMap(m => m.parts)
    .filter(p => p.type === 'tool-write_strategy_guide' && p.state === 'output-available')
  assert.equal(replayed.length, 1, 'the next request carried no refused guide')
  assert.deepEqual(replayed[0].input, GUIDE_INPUT_INJECTED, 'the original input must ride along')
  // ORDERING: the AI SDK collects approvals from the final parts of the final
  // message, so nothing may follow them. The refusal is in the prefix.
  const last = bodies[2].messages[bodies[2].messages.length - 1].parts
  assert.equal(last[last.length - 1].state, 'approval-responded', 'consent must stay last on the wire')
  assert.equal(last[last.length - 1].approval.signature, 'sig-log', 'the signature must survive')
  assert.ok(last.findIndex(p => p.state === 'output-available' && p.type === 'tool-write_strategy_guide')
    < last.length - 1, 'the refusal must precede the approval answer')
  assert.equal(bodies[3].messages.flatMap(m => m.parts)
    .filter(p => p.type === 'tool-write_strategy_guide' && p.state === 'output-available').length, 0,
    'a new user turn must not replay the refusal')

  const captured = { legs: bodies.slice(0, 3), newTurn: bodies[2],
    refusal: { toolCallId: GUIDE_CALL, input: GUIDE_INPUT_INJECTED } }
  // The new turn as the SERVER would see it: leg 3's body with the reader's
  // next message appended, which is what `messagesToWire` produced on leg 4.
  captured.newTurn = bodies[3]
  const wirePath = path.join(out, 'meter-wire-' + width + '.json')
  fs.writeFileSync(wirePath, JSON.stringify(captured, null, 2))
  const proofPath = path.join(out, 'meter-proof-' + width + '.json')
  const proof = run(process.execPath, ['--import', 'tsx',
    fileURLToPath(new URL('./meterReplayProof.mts', import.meta.url)), wirePath, proofPath])
  assert.match(proof, /PASS captured browser wire seeds the real ledger/)
  await page.unroute('**/api/chat')
  await page.unroute('**/decke/history')
  return { case: 'meter-refusal-replay', width, legs: bodies.length,
    refusalReplayed: true, consentLast: true, newTurnReset: true,
    proof: JSON.parse(fs.readFileSync(proofPath, 'utf8')) }
}

export async function checkChat(browser, server, out) {
  const results = []
  for (const width of [1280, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    try {
      await page.addInitScript(() => { Math.random = () => 0.3141592653 })
      await page.goto(server.origin + '/fixture.html', { waitUntil: 'networkidle' })
      const panel = page.getByRole('dialog', { name: 'Chat with Deck-E' })
      await panel.waitFor({ state: 'visible' })
      assert.equal(await panel.evaluate(el => getComputedStyle(el).position), 'fixed', 'Fixture must include production Tailwind utilities')
      await panel.getByRole('heading', { level: 2 }).filter({ hasText: 'Browser Reader' }).waitFor()
      const firstGreeting = await panel.getByRole('heading', { level: 2 }).innerText()
      const subhead = await panel.getByRole('heading', { level: 2 }).evaluate(el => el.nextElementSibling.textContent)
      assert.equal(subhead, await page.evaluate(() => window.fixture.expectedSubhead()), 'Chosen subhead must reach the rendered empty state')
      const openers = panel.locator('ul button')
      assert.equal(await openers.count(), 3, 'Real empty-state openers must be wired')
      const openerTexts = await openers.allTextContents()
      await openers.first().click()
      assert.equal(await panel.getByRole('textbox', { name: 'Message Deck-E' }).inputValue(), openerTexts[0])
      assert.equal(await page.evaluate(() => window.fixture.events.sends.length), 0, 'Opener fills without sending')
      await panel.getByText('Experimental', { exact: true }).waitFor()
      await panel.getByText('2 credits left', { exact: true }).waitFor()
      const live = panel.locator('[role="status"][aria-live="polite"][aria-atomic="true"].sr-only')
      assert.equal(await live.count(), 1, 'One persistent whole-response live region')
      assert.equal(await live.innerText(), '')
      const transcript = panel.locator('.decke-transcript-fade')
      const emptyPad = await panel.locator('[data-decke-composer]').evaluate(el => parseFloat(getComputedStyle(el.parentElement).paddingBottom))
      assert.equal(emptyPad, width === 390 ? 20 : 12)
      await set(page, { busy: true, messages: assistant('A streaming fragment') })
      await panel.getByText('A streaming fragment', { exact: true }).waitFor()
      assert.equal(await panel.getByText('A streaming fragment', { exact: true }).evaluate(el => !!el.closest('[aria-live]')), false,
        'Streaming text must not be inside a live region')
      assert.equal(await live.innerText(), '', 'No fragment announcements while busy')
      await set(page, { busy: false, messages: assistant('A completed answer for the reader.') })
      await page.waitForFunction(() => document.querySelector('[role="dialog"] [role="status"].sr-only')?.textContent === 'Deck-E replied.')
      const transcriptPad = await panel.locator('[data-decke-composer]').evaluate(el => parseFloat(getComputedStyle(el.parentElement).paddingBottom))
      assert.equal(transcriptPad, 40, 'Transcript composer has its larger bottom clearance')
      // Click a real child, drag the real background, and release a selection.
      await panel.getByText('A completed answer for the reader.', { exact: true }).click()
      assert.equal(await page.evaluate(() => window.fixture.events.closes), 0, 'Child click must not dismiss')
      await transcript.dispatchEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true })
      await transcript.dispatchEvent('click', { clientX: 40, clientY: 10, bubbles: true })
      assert.equal(await page.evaluate(() => window.fixture.events.closes), 0, 'Background drag must not dismiss')
      await panel.getByText('A completed answer for the reader.', { exact: true }).evaluate(el => {
        const range = document.createRange(); range.selectNodeContents(el)
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
      })
      await transcript.dispatchEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true })
      await transcript.dispatchEvent('click', { clientX: 10, clientY: 10, bubbles: true })
      assert.equal(await page.evaluate(() => window.fixture.events.closes), 0, 'Text selection must not dismiss')
      await page.evaluate(() => getSelection().removeAllRanges())
      await transcript.dispatchEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true })
      await transcript.dispatchEvent('click', { clientX: 10, clientY: 10, bubbles: true })
      assert.equal(await page.evaluate(() => window.fixture.events.closes), 1, 'A plain background click must dismiss')

      await set(page, { messages: [{ id: 'tools', role: 'assistant', parts: [
        { kind: 'tool', id: 'refusal', chip: { id: 'call-declined', name: 'collection_add', title: 'Adding fixture cards', phase: 'ok' } },
        { kind: 'tool', id: 'failure', chip: { id: 'retry-call', name: 'collection_get', title: 'Reading fixture cards', phase: 'error', summary: 'Fixture read failed' } },
      ] }] })
      await panel.getByText('Cancelled', { exact: true }).waitFor()
      await panel.getByRole('button', { name: 'Try Reading fixture cards again' }).click()
      assert.deepEqual(await page.evaluate(() => window.fixture.events.retries), ['retry-call'])
      await set(page, { credits: { remaining: 0, allowance: 100 } })
      assert.equal(await panel.getByRole('textbox', { name: 'Message Deck-E' }).count(), 0, 'Spent credits replace the composer')
      await panel.getByText('Out of credits', { exact: true }).waitFor()
      await panel.getByText("I'm out of credits, so I can't take anything new on right now.", { exact: true }).waitFor()
      await panel.getByText('Cancelled', { exact: true }).waitFor()
      await page.screenshot({ path: path.join(out, 'chat-' + width + '.png'), fullPage: true })

      // Reopening exercises the real persisted opener history rather than a
      // copied selection algorithm. All three choices must rotate.
      await set(page, { open: false, messages: [], credits: { remaining: 2, allowance: 100 } })
      await panel.waitFor({ state: 'detached' })
      await set(page, { open: true })
      await panel.waitFor({ state: 'visible' })
      const newOpeners = await panel.locator('ul button').allTextContents()
      assert.equal(newOpeners.length, 3)
      assert.ok(newOpeners.every(text => !openerTexts.includes(text)), 'Opening again must rotate visible suggestions')
      assert.notEqual(await panel.getByRole('heading', { level: 2 }).innerText(), firstGreeting)
      const nextSubhead = await panel.getByRole('heading', { level: 2 }).evaluate(el => el.nextElementSibling.textContent)
      assert.equal(nextSubhead, await page.evaluate(() => window.fixture.expectedSubhead()))
      assert.notEqual(nextSubhead, subhead, 'Reopening uses the newly chosen subhead')
      results.push({ case: 'rendered-chat', width, liveBoundary: true, composerFill: true,
        greetingAndOpeners: true, dismissalGuards: ['child', 'drag', 'selection', 'background'], refusalAndRetry: true, credits: true })

      await page.goto(server.origin + '/fixture.html?screen', { waitUntil: 'networkidle' })
      const screen = page.getByRole('region', { name: 'Browser screen' })
      const toggle = screen.locator('button[aria-controls]')
      assert.match(await toggle.innerText(), /Show 2 more sections/)
      await toggle.waitFor({ state: 'visible' })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      const controlled = await toggle.getAttribute('aria-controls')
      assert.ok(controlled)
      assert.equal(await page.locator('[id="' + controlled + '"]').count(), 1)
      assert.equal(await screen.getByText('Section 6', { exact: true }).count(), 0)
      await page.keyboard.press('Tab')
      await toggle.focus()
      assert.ok(await toggle.evaluate(el => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none' &&
        parseFloat(getComputedStyle(el).outlineWidth) >= 2), 'Keyboard focus must be visible')
      await page.keyboard.press('Enter')
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
      await screen.getByText('Section 6', { exact: true }).waitFor()
      assert.equal(await toggle.getAttribute('aria-controls'), controlled)
      assert.equal(await toggle.locator('svg').evaluate(el => getComputedStyle(el).transitionDuration), '0s',
        'Chevron animation respects reduced motion')
      await page.keyboard.press('Space')
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      await page.screenshot({ path: path.join(out, 'screen-' + width + '.png'), fullPage: true })
      results.push({ case: 'rendered-screen-keyboard', width, controlled, expandedAndCollapsed: true, focusVisible: true, reducedMotion: true })
      results.push(await checkMeterReplay(page, server, width, out))
    } finally { await context.close() }
  }
  return results
}

/**
 * ── THE FIXTURE'S API: /me, and the catalogue cards the dry-run rows name ────
 *
 * The fixture builds self-host (no Supabase URL), so the client's base is
 * `/deckpal/api`. A card this does not know gets no answer, and the rows the
 * test waits for by NAME never appear — so a missing fixture fails the run
 * rather than passing on a row that shows the bare id.
 */
const CARD_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" rx="3" fill="#3b6f8f"/></svg>')
const CARDS = { 'sv04-160': 'Counter Catcher', 'sv02-185': 'Iono' }
const HISTORY = /^(?:\/deckpal)?\/api\/decke\/history$/
/** The one write the chat fixture accepts: see `chatApi`. */
export const chatAllowMutation = (pathname, method) => method === 'POST' && HISTORY.test(pathname)
export function chatApi(rel) {
  if (rel === '/api/me' || rel === '/deckpal/api/me') return { body: { username: 'Browser Reader', owner: false, decke: false } }
  // The transcript record the real hook writes after a turn. Answered here, not
  // only by a page route: WebKit sends it as a keepalive request, which page
  // routes cannot intercept, so it reaches the server either way.
  if (HISTORY.test(rel)) return { body: { ok: true, recorded: false } }
  const id = rel.match(/^(?:\/deckpal)?\/api\/cards\/([^/]+)$/)?.[1]
  if (id && CARDS[id]) return { body: { card: { cardId: id, name: CARDS[id], images: { low: CARD_SVG, high: CARD_SVG } } } }
  return null
}

const rect = (loc) => loc.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
/** Intersection area of two rects, in CSS px². Zero means the two do not touch. */
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

/**
 * Where he stands, as a box: the park box on a phone. On desktop the host parks
 * him OUTBOARD-LEFT of the card carrying `data-decke-composer`, so the whole
 * column right of that card's left edge is clear — the assertion there is that
 * the landmark exists and everything that must be read sits inside that column.
 */
async function assertClear(page, width, targets, label) {
  const park = page.locator('[data-decke-park]')
  if (width < 1068) {
    assert.equal(await park.count(), 1, label + ': the phone park box is missing')
    const him = await rect(park)
    for (const [name, loc] of Object.entries(targets)) {
      const r = await rect(loc)
      assert.equal(overlap(him, r), 0, `${label}: he stands on ${name} (park ${JSON.stringify(him)}, ${name} ${JSON.stringify(r)})`)
    }
    return him
  }
  assert.equal(await park.count(), 0, label + ': a park box on desktop')
  const floor = page.locator('[data-decke-composer]')
  assert.equal(await floor.count(), 1, label + ': nothing for him to stand beside on desktop')
  const edge = (await rect(floor)).left
  for (const [name, loc] of Object.entries(targets)) {
    assert.ok((await rect(loc)).left >= edge - 0.5, `${label}: ${name} starts left of the card he stands beside`)
  }
  return null
}

const EDIT_SUMMARY = [
  "EDIT your existing deck 'Dragapult ex / Dusknoir' (deck-browser), 22 distinct card(s) in it:",
  'remove x1 sv04-160',
  'set sv02-185 x3 → x4',
].join('\n')
const asked = [{ id: 'u1', role: 'user', parts: [{ kind: 'text', id: 'u1t', text: 'Suggest one improvement to this deck and apply it' }] },
  { id: 'a1', role: 'assistant', parts: [{ kind: 'text', id: 'a1t', text: "One change I'd make: cut Counter Catcher for a fourth Iono." }] }]

/**
 * ── UXD-02/03/04/07/08/15: THE STATES A READER HAS TO ACT ON ───────────────
 *
 * Each state the audit photographed, rendered by the real panel and measured
 * rather than looked at: whether he stands on the card, whether its rows and
 * price are there, and whether every notice offers the one thing it tells the
 * reader to do. Run in Chromium and WebKit at 390 and 1440.
 */
export async function checkDeckeStates(browser, server, out, engine) {
  const results = []
  for (const width of [390, 1440]) {
    const { context, page } = await contextFor(browser, server, width)
    const tag = engine + '-' + width
    try {
      await page.goto(server.origin + '/fixture.html', { waitUntil: 'networkidle' })
      const panel = page.getByRole('dialog', { name: 'Chat with Deck-E' })
      await panel.waitFor({ state: 'visible' })

      // ── A deck edit held for approval (UXD-02, UXD-04) ──────────────────
      await set(page, { busy: true, messages: asked, credits: { remaining: 40, allowance: 100 },
        asking: [{ approvalId: 'ap-1', toolCallId: 'save-1', title: 'Save this deck', name: 'save_deck', input: { deck_id: 'deck-browser' } }],
        preview: { toolCallId: 'save-1', tool: 'save_deck', title: 'Create or edit a deck', summary: EDIT_SUMMARY, ok: true, editable: false, rows: [], skipped: [] } })
      const card = panel.getByRole('alertdialog', { name: 'Deck-E is asking permission' })
      await card.waitFor()
      const rows = card.locator('[data-decke-dry-run] li')
      assert.equal(await rows.count(), 3, 'the dry run did not become rows')
      await card.getByText('Changes to Dragapult ex / Dusknoir', { exact: true }).waitFor()
      await card.getByText('Counter Catcher', { exact: true }).waitFor()
      await card.getByText('Iono', { exact: true }).waitFor()
      assert.deepEqual(await card.locator('[data-decke-dry-run] li span.tabular-nums').allTextContents(), ['−1', '3 → 4'])
      assert.equal(await card.getByText(/DRY RUN/).count(), 0, 'the internal header reached the reader')
      // He is waiting on the reader, and says so — no clock, no Stop.
      await panel.getByText('Waiting for your OK', { exact: true }).waitFor()
      assert.equal(await panel.getByText('Working', { exact: true }).count(), 0, 'says Working while waiting on the reader')
      assert.equal(await panel.getByRole('button', { name: 'Stop' }).count(), 0, 'Stop is offered beside a held card')
      await assertClear(page, width, { 'Leave it': card.getByRole('button', { name: 'Leave it' }),
        'Go ahead': card.getByRole('button', { name: 'Go ahead' }), headline: card.locator('p').first(), rows: card.locator('[data-decke-dry-run]') }, tag + ' approval')
      await page.screenshot({ path: path.join(out, 'decke-approval-' + tag + '.png') })

      // ── A 75-credit deep call with 40 in the wallet (UXD-07) ────────────
      await set(page, { prices: { analysis: 4, planDeck: 75 }, preview: null,
        asking: [{ approvalId: 'ap-2', toolCallId: 'guide-1', title: 'Write a full strategy guide for this deck', name: 'write_strategy_guide',
          input: { deck: 'Dragapult ex / Dusknoir', no_research: true } }] })
      const cost = card.locator('[data-decke-approval-cost]')
      assert.equal(await cost.innerText(), 'This needs 75 credits and you have 40.')
      assert.equal(await card.getByRole('button', { name: 'Go ahead' }).count(), 0, 'a guaranteed refusal is still offered')
      await card.getByText('no research behind it this time — the guide will say so', { exact: false }).waitFor()
      assert.doesNotMatch(await cost.innerText(), /research/, 'the price line contradicts the no-research line')
      await assertClear(page, width, { 'Leave it': card.getByRole('button', { name: 'Leave it' }),
        'Top up': card.getByRole('button', { name: 'Top up credits' }), price: cost }, tag + ' deep approval')
      await page.screenshot({ path: path.join(out, 'decke-price-short-' + tag + '.png') })
      const before = await page.evaluate(() => ({ ...window.fixture.events }))
      await card.getByRole('button', { name: 'Top up credits' }).click()
      const after = await page.evaluate(() => window.fixture.events)
      assert.equal(after.denies, before.denies + 1, 'Top up left the held call waiting')
      assert.equal(after.topUps, before.topUps + 1)
      await set(page, { credits: { remaining: 400, allowance: 1000 } })
      assert.equal(await cost.innerText(), 'This takes longer than a normal answer and uses 75 credits of your 400.')
      await card.getByRole('button', { name: 'Go ahead' }).waitFor()
      // Credits off, or an unlimited account: no number at all.
      await set(page, { prices: null })
      assert.doesNotMatch(await cost.innerText(), /\d/)

      // ── Notices that carry their way forward (UXD-08) ───────────────────
      await set(page, { busy: false, asking: null, messages: [asked[0], { id: 'a2', role: 'assistant', parts: [
        { kind: 'notice', id: 'fault', tone: 'error', title: 'Something went wrong reaching my brain.', detail: 'Nothing was written.', action: 'retry' },
        { kind: 'tool', id: 'refused', chip: { id: 'guide-2', name: 'write_strategy_guide', title: 'Writing a strategy guide', phase: 'error',
          summary: 'not enough credits — 75 needed, 40 left', meter: 'credits' } },
      ] }] })
      const fault = panel.getByRole('status').filter({ hasText: 'Something went wrong reaching my brain.' })
      await fault.getByRole('button', { name: 'Try again' }).click()
      assert.deepEqual((await page.evaluate(() => window.fixture.events.retries)).slice(-1), ['fault'])
      assert.equal(await panel.getByRole('button', { name: 'Try Writing a strategy guide again' }).count(), 0,
        'a meter refusal still offers the retry that walks back into it')
      const topUps = await page.evaluate(() => window.fixture.events.topUps)
      await panel.locator('li').filter({ hasText: 'Writing a strategy guide' }).getByRole('button', { name: 'Top up credits' }).click()
      assert.equal(await page.evaluate(() => window.fixture.events.topUps), topUps + 1)
      await page.screenshot({ path: path.join(out, 'decke-notices-' + tag + '.png') })

      // ── Out of credits (UXD-03) ─────────────────────────────────────────
      await set(page, { messages: [], credits: { remaining: 0, allowance: 100 } })
      const notice = panel.getByRole('status').filter({ hasText: "I'm out of credits" })
      const topUp = notice.getByRole('button', { name: 'Top up credits' })
      await topUp.waitFor()
      assert.equal(await notice.locator('xpath=ancestor::*[@data-decke-composer]').count(), 1,
        'the out-of-credits card is not registered as the floor he stands on')
      await assertClear(page, width, { 'Top up': topUp, 'out-of-credits card': notice }, tag + ' spent')
      await page.screenshot({ path: path.join(out, 'decke-spent-' + tag + '.png') })
      results.push({ case: 'decke-states', engine, width, approvalClear: true, dryRunRows: 3, priceShown: true, noticeActions: true, spentClear: true })

      // ── On a deck, the chips are about that deck (UXD-15) ───────────────
      await page.goto(server.origin + '/decks/deck-browser', { waitUntil: 'networkidle' })
      await panel.waitFor({ state: 'visible' })
      const chips = await panel.locator('ul button').allTextContents()
      const deckQuestions = ['Is this deck legal? If not, why not?', 'What am I missing for this deck, and what will it cost?', 'Suggest one improvement to this deck']
      assert.equal(chips.length, 3)
      assert.ok(chips.slice(0, 2).every(c => deckQuestions.includes(c)), 'a deck page does not lead with that deck: ' + chips.join(' | '))

      // ── The real hook, over a real fetch: a held wallet, then a fault ───
      let reply = { status: 429, body: { error: 'AI credits are on hold while a payment issue is resolved. Open your credit wallet for details.',
        retryAfterDay: false, credits: { balance: 40, needed: 1, held: true } } }
      const sent = []
      await page.route('**/api/chat', route => {
        sent.push(JSON.parse(route.request().postData() ?? '{}'))
        return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) })
      })
      await page.goto(server.origin + '/fixture.html?meter', { waitUntil: 'networkidle' })
      await panel.waitFor({ state: 'visible' })
      await page.evaluate(() => window.meterChat.send('Is this deck legal?'))
      const held = panel.getByRole('status').filter({ hasText: 'Your credits are on hold while a payment issue is sorted out.' })
      await held.waitFor()
      assert.equal(await held.getByRole('button', { name: 'Open credit wallet' }).count(), 1)
      assert.doesNotMatch(await held.innerText(), /top up/i, 'a held wallet is told to top up')
      await page.screenshot({ path: path.join(out, 'decke-held-' + tag + '.png') })
      reply = { status: 500, body: { error: { message: 'boom' } } }
      await page.evaluate(() => window.meterChat.send('Is this deck legal, then?'))
      const broke = panel.getByRole('status').filter({ hasText: 'Something went wrong reaching my brain.' })
      await broke.waitFor()
      reply = { status: 500, body: {} }
      await broke.getByRole('button', { name: 'Try again' }).click()
      for (let i = 0; i < 100 && sent.length < 3; i++) await page.waitForTimeout(50)
      assert.equal(sent.length, 3, 'Try again did not resend')
      const lastUser = body => body.messages.filter(m => m.role === 'user').at(-1).parts.find(p => p.type === 'text').text
      assert.equal(lastUser(sent[2]), 'Is this deck legal, then?', 'Try again resent something other than the last question')
      // No unroute: the context and its route close together.
      results.push({ case: 'decke-refusals', engine, width, heldCopy: true, retryResends: true })
    } finally { await context.close() }
  }
  return results
}
