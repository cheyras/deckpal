import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'
const assistant = text => [{ id: 'reply', role: 'assistant', parts: [{ kind: 'text', id: 'text', text }] }]
async function set(page, patch) {
  await page.evaluate(patch => window.fixture.set(patch), patch)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
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
    } finally { await context.close() }
  }
  return results
}
