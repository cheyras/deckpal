import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'
import { signIn } from './admin.mjs'

const USER = '10000000-0000-4000-8000-000000000002'
const original = '2 Iono PAL 999\n2 Iono PAL 999'
const confirmed = '2 Iono PAL 185\n2 Iono PAL 185'
const partial = '2 Iono PAL 185\n2 Iono PAL 999'
const originalWithWhitespace = '2 Iono PAL 999\n  2 Iono PAL 999  '
const partialWithWhitespace = '2 Iono PAL 185\n  2 Iono PAL 999  '
const summary = (unresolvedLines, lineCount = 2, formatIssues = []) => ({ import: { source: 'ptcgl', resolvedEntries: lineCount - unresolvedLines.length,
  distinctCards: 1, totalCards: (lineCount - unresolvedLines.length) * 2, unresolved: unresolvedLines,
  unresolvedLines, formatIssues, warnings: [], variantNote: '' } })
const fixes = [0, 1].map(lineIndex => ({ lineIndex, original: '2 Iono PAL 999', replacement: '2 Iono PAL 185',
  card: { id: 'pal-185', name: 'Iono', set: 'PAL', number: '185' },
  reason: 'PAL 185 is Iono.', confidence: 'suggested' }))
const twoDifferent = '2 Iono PAL 999\n2 Arven OBF 999'
const partlyRestored = '2 Iono PAL 999\n2 Arven OBF 186'
const illegalWithBlank = '2 Iono PAL 185\n \t \n2 Arven OBF 186'
const twoDifferentFixes = [fixes[0], {
  lineIndex: 1, original: '2 Arven OBF 999', replacement: '2 Arven OBF 186',
  card: { id: 'obf-186', name: 'Arven', set: 'OBF', number: '186' },
  reason: 'OBF 186 is Arven.', confidence: 'suggested',
}]

/** The built cloud app, fake account and intercepted API: no deck is created
 * until the exact reviewed text passes its second dry run. */
export async function checkDeckImport(browser, server, fixture, out) {
  const results = []
  fixture.state.actor = 'ordinary'
  fixture.state.permissions = ['decke.use']
  for (const width of [1440, 390]) {
    console.log('Deck import browser width ' + width + ' started')
    const { context, page } = await contextFor(browser, server, width)
    await signIn(context, USER)
    const created = [], checked = [], formatChecks = []
    let returnedFixes = fixes
    let novelUnresolved = false
    let holdConfirmedCheck = false
    let holdChangedReviewCheck = false
    let releaseConfirmedCheck
    let confirmedCheckStarted
    let releaseChangedReviewCheck
    let changedReviewCheckStarted
    const heldResponse = new Promise(resolve => { releaseConfirmedCheck = resolve })
    const started = new Promise(resolve => { confirmedCheckStarted = resolve })
    const heldChangedReviewResponse = new Promise(resolve => { releaseChangedReviewCheck = resolve })
    const changedReviewStarted = new Promise(resolve => { changedReviewCheckStarted = resolve })
    await page.route('**/api/decks**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/decks' && route.request().method() === 'GET') return route.fulfill({ json: { decks: [] } })
      if (url.pathname === '/api/decks/import/fix') return route.fulfill({ json: { fixes: returnedFixes, unfixed: [] } })
      if (url.pathname === '/api/decks/import') {
        const body = route.request().postDataJSON()
        if (body.dryRun) {
          checked.push(body.text)
          formatChecks.push({ text: body.text, formatCode: body.formatCode })
          if (body.text === confirmed && holdConfirmedCheck) {
            holdConfirmedCheck = false
            confirmedCheckStarted()
            return heldResponse.then(() => route.fulfill({ json: summary([]) }))
          }
          if (body.text === partlyRestored && body.formatCode === 'standard' && holdChangedReviewCheck) {
            holdChangedReviewCheck = false
            changedReviewCheckStarted()
            return heldChangedReviewResponse.then(() => route.fulfill({ json: summary(['2 Iono PAL 999']) }))
          }
          const lines = body.text.split('\n').filter(line => line.trim() && !line.trim().startsWith('Pokémon:'))
          const unresolved = lines.filter(line => line.trim().endsWith('999') ||
            (novelUnresolved && line.trim() === '2 Iono PAL 185'))
          return route.fulfill({ json: summary(unresolved, lines.length,
            body.formatCode === 'glc' && body.text.includes('2 Arven OBF 186')
              ? [{ cardId: 'obf-186', reason: 'Arven is not legal in GLC.' }] : []) })
        }
        created.push(body)
        return route.fulfill({ json: { deck: { id: 'fixture-import' } } })
      }
      return route.fulfill({ json: {} })
    })
    try {
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      const open = () => page.getByRole('button', { name: /Import from PTCG Live/ }).click()
      const prepare = async (suggested = 2, input = original) => {
        await open()
        await page.getByRole('textbox', { name: 'Decklist' }).fill(input)
        await page.getByRole('button', { name: 'Import deck' }).click()
        const group = page.getByRole('group', { name: 'Unmatched decklist lines' })
        await group.getByText("2 lines don't match a card").waitFor()
        assert.equal(await group.locator('[data-decke-errand]').count(), 1, 'Deck-E docks beside the unmatched lines before asking')
        await group.getByRole('button', { name: 'Want me to fix these 2?' }).click()
        await page.getByText('PAL 185 is Iono.').first().waitFor()
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
          ['Import deck', 'Import without them'].includes(button.textContent?.trim()) && !button.disabled), null, { timeout: 10_000 })
        if (input === twoDifferent) {
          assert.equal(await group.getByText('2 Iono PAL 999').count(), 1)
          assert.equal(await group.getByText('2 Arven OBF 999').count(), 1)
        } else if (input === originalWithWhitespace) {
          assert.equal(await group.locator('li').count(), 2, 'spaced and unspaced occurrences keep separate review rows')
        } else {
          assert.equal(await group.getByText('2 Iono PAL 999').count(), 2, 'both original lines remain in their own rows')
        }
        assert.equal(await group.getByRole('button', { name: 'Undo' }).count(), suggested)
        assert.equal(await group.getByText('Review Deck-E’s fixes').count(), 0, 'there is no second review card')
      }
      await prepare()
      assert.equal(await page.getByRole('textbox', { name: 'Decklist' }).inputValue(), confirmed,
        'accepted suggestions update the pasted decklist before import')
      assert.equal(created.length, 0, 'fix endpoint must not create a deck')
      await page.getByRole('button', { name: 'Undo' }).first().click()
      assert.equal(await page.getByRole('textbox', { name: 'Decklist' }).inputValue(), '2 Iono PAL 999\n2 Iono PAL 185',
        'Undo restores only its original line in the pasted decklist')
      await page.getByText('Fixed 1 of 2, check them').waitFor()
      await page.getByRole('button', { name: 'Import without them' }).waitFor()
      assert.equal(created.length, 0, 'Undo must remain read-only')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await prepare()
      assert.equal(created.length, 0, 'review must remain read-only')
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
        button.textContent?.trim() === 'Import deck' && !button.disabled))
      holdConfirmedCheck = true
      await page.getByRole('button', { name: 'Import deck' }).click()
      await Promise.race([started, page.waitForTimeout(10_000).then(() => { throw new Error('confirmation dry run did not start') })])
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll('button')].filter(button => button.textContent?.trim() === 'Undo')
        return buttons.length > 0 && buttons.every(button => button.disabled)
      })
      assert.equal(await page.getByRole('button', { name: 'Undo' }).first().isDisabled(), true,
        'Undo must be disabled while the confirmation dry run is pending')
      assert.equal(created.length, 0, 'the pending check must not create a deck')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await page.getByRole('textbox', { name: 'Decklist' }).waitFor({ state: 'hidden' })
      const response = page.waitForResponse(r => r.url().endsWith('/api/decks/import') &&
        r.request().postDataJSON()?.text === confirmed)
      releaseConfirmedCheck()
      await response
      await page.waitForTimeout(100)
      assert.equal(created.length, 0, 'a canceled confirmation response must not create a deck')
      await prepare()
      assert.equal(created.length, 0, 'reopening review must remain read-only')
      await page.getByRole('button', { name: 'Import deck' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.deepEqual(formatChecks.at(-1), { text: confirmed, formatCode: 'standard' },
        'the final dry run checks the exact accepted text and format before import')
      assert.equal(created.length, 1)
      assert.equal(created[0].text, confirmed, 'import must receive only the text the reader confirmed')
      returnedFixes = twoDifferentFixes
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      await page.getByRole('button', { name: 'Undo' }).first().click()
      await page.getByRole('button', { name: 'Edit the line 2 Iono PAL 999' }).click()
      await page.keyboard.insertText('2 Iono PAL 185')
      assert.equal(await page.getByRole('textbox', { name: 'Decklist' }).inputValue(), '2 Iono PAL 185\n2 Arven OBF 186',
        'a manual edit elsewhere keeps the accepted correction in the paste box')
      const group = page.getByRole('group', { name: 'Unmatched decklist lines' })
      assert.equal(await group.getByRole('button', { name: 'Undo' }).count(), 1,
        'editing A keeps B’s suggestion and does not duplicate A’s manual fix')
      await group.getByText('1 line to review').waitFor()
      await page.getByRole('button', { name: 'Import deck' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.equal(created.at(-1).text, '2 Iono PAL 185\n2 Arven OBF 186',
        'the manual edit and surviving suggestion both reach import')
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      await page.getByRole('textbox', { name: 'Decklist' }).fill('2 Arven OBF 186')
      assert.equal(await group.getByRole('button', { name: 'Undo' }).count(), 1,
        'deleting A keeps B’s suggestion after its line index moves')
      await group.getByText('1 line to review').waitFor()
      await page.getByRole('button', { name: 'Import deck' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.equal(created.at(-1).text, '2 Arven OBF 186', 'the remaining fix applies to B, not the deleted line')
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      await page.getByRole('button', { name: 'Undo' }).first().click()
      await page.getByRole('button', { name: 'Edit the line 2 Iono PAL 999' }).click()
      await page.keyboard.insertText('2 Arven OBF 999')
      await group.getByText('2 lines to review').waitFor()
      assert.equal(await group.getByRole('button', { name: 'Undo' }).count(), 1,
        'a new duplicate above a retained fix keeps its Undo visible')
      assert.equal(await group.getByRole('button', { name: 'Edit the line 2 Arven OBF 999' }).count(), 1,
        'the new duplicate remains a separate unresolved row')
      await group.getByRole('button', { name: 'Undo' }).click()
      assert.equal(await page.getByRole('textbox', { name: 'Decklist' }).inputValue(), '2 Arven OBF 999\n2 Arven OBF 999',
        'Undo on the retained row restores that exact physical line')
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      await page.getByRole('textbox', { name: 'Decklist' }).fill('2 Iono PAL 185\n2 Arven OBF 999\n2 Arven OBF 186')
      await group.getByText('3 lines to review').waitFor()
      assert.equal(await group.getByRole('button', { name: 'Undo' }).count(), 2,
        'inserting a duplicate above a retained correction keeps both corrections undoable')
      assert.equal(await group.getByRole('button', { name: 'Edit the line 2 Arven OBF 999' }).count(), 1,
        'the inserted duplicate has its own unresolved row')
      await group.getByRole('button', { name: 'Undo' }).last().click()
      assert.equal(await page.getByRole('textbox', { name: 'Decklist' }).inputValue(), '2 Iono PAL 185\n2 Arven OBF 999\n2 Arven OBF 999',
        'Undo restores the corrected line below the inserted duplicate')
      returnedFixes = fixes
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare()
      await page.getByRole('button', { name: 'Undo' }).first().click()
      await page.getByRole('button', { name: 'Undo' }).last().click()
      await page.getByRole('textbox', { name: 'Decklist' }).fill('2 Iono PAL 999\n')
      assert.equal(await group.getByRole('button', { name: 'Undo' }).count(), 0,
        'deleting one identical occurrence must not restore its rejected suggestion on the survivor')
      await group.getByText("1 line doesn't match a card").waitFor()
      assert.equal(await page.getByRole('button', { name: 'Import deck' }).isDisabled(), true,
        'a list with no matched cards cannot be imported after ambiguous duplicate deletion')
      assert.equal(created.length, 3, 'ambiguous duplicate deletion must not import a guessed correction')
      returnedFixes = twoDifferentFixes
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      await page.getByRole('button', { name: 'Undo' }).first().click()
      await page.getByRole('textbox', { name: 'Decklist' }).fill('Pokémon: 4\n2 Iono PAL 999\n2 Arven OBF 186')
      await page.getByRole('button', { name: 'Import without them' }).waitFor()
      assert.equal(created.length, 3, 'editing the header must not silently skip the still-unresolved Iono line')
      await page.getByRole('button', { name: 'Import without them' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.equal(created.at(-1).text, 'Pokémon: 4\n2 Iono PAL 999\n2 Arven OBF 186')
      returnedFixes = fixes.slice(0, 1)
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(1)
      // One suggestion stays in its original row; the second keeps Edit. The
      // explicit skip action checks the accepted text and imports in one press.
      assert.equal(await page.getByRole('button', { name: 'Edit the line 2 Iono PAL 999' }).count(), 1)
      await page.getByRole('button', { name: 'Import without them' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.equal(created.at(-1).text, partial)
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(1)
      novelUnresolved = true
      await page.getByRole('button', { name: 'Import without them' }).click()
      await page.getByRole('group', { name: 'Unmatched decklist lines' }).getByText('2 Iono PAL 185').waitFor()
      assert.equal(created.length, 5, 'a newly unmatched replacement must be shown, not silently skipped')
      novelUnresolved = false
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(1, originalWithWhitespace)
      await page.getByRole('button', { name: 'Import without them' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.equal(created.at(-1).text, partialWithWhitespace, 'spaces on the skipped line must not require a second click')
      returnedFixes = twoDifferentFixes
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      const format = page.getByLabel('Format')
      await format.selectOption('expanded')
      await page.getByRole('group', { name: 'Unmatched decklist lines' }).getByRole('button', { name: 'Undo' }).first().waitFor()
      await format.selectOption('standard')
      await page.getByRole('group', { name: 'Unmatched decklist lines' }).getByRole('button', { name: 'Undo' }).nth(1).waitFor()
      await page.getByRole('button', { name: 'Import deck' }).waitFor({ state: 'visible' })
      assert.equal(await page.getByRole('button', { name: 'Import deck' }).isEnabled(), true)
      assert.equal(await page.getByRole('textbox', { name: 'Decklist' }).inputValue(), '2 Iono PAL 185\n2 Arven OBF 186')
      assert.equal(await page.getByRole('group', { name: 'Unmatched decklist lines' }).getByRole('button', { name: 'Undo' }).count(), 2,
        'both accepted fixes and their Undo controls survive Standard → Expanded → Standard')
      assert.deepEqual(formatChecks.slice(-2), [
        { text: '2 Iono PAL 185\n2 Arven OBF 186', formatCode: 'expanded' },
        { text: '2 Iono PAL 185\n2 Arven OBF 186', formatCode: 'standard' },
      ], 'each format change rechecks the current corrected text')
      await page.screenshot({ path: path.join(out, `deck-import-format-roundtrip-${width}.png`) })
      await page.getByRole('button', { name: 'Import deck' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.equal(created.at(-1).text, '2 Iono PAL 185\n2 Arven OBF 186', 'the round trip imports the corrected text')
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      await format.selectOption('glc')
      await page.getByText('Arven is not legal in GLC.').waitFor()
      assert.equal(await page.getByRole('group', { name: 'Unmatched decklist lines' }).getByRole('button', { name: 'Undo' }).count(), 2,
        'both accepted fixes remain undoable, including the illegal one')
      assert.equal(await page.getByRole('button', { name: 'Edit the line 2 Arven OBF 186' }).count(), 1,
        'the illegal accepted fix returns to the unmatched review')
      assert.equal(await page.getByRole('button', { name: 'Import deck' }).isDisabled(), true,
        'an illegal correction cannot be imported')
      await page.screenshot({ path: path.join(out, `deck-import-format-illegal-${width}.png`) })
      await format.selectOption('expanded')
      await page.getByRole('group', { name: 'Unmatched decklist lines' }).getByRole('button', { name: 'Undo' }).nth(1).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Import deck' }).isEnabled(), true,
        'the accepted fix returns when the selected format allows it')
      // A format switch followed by Undo changes the current list again. The
      // restored card must be shown and checked before the reader can skip it.
      const createdBeforeUndo = created.length
      holdChangedReviewCheck = true
      await page.getByRole('button', { name: 'Undo' }).first().click()
      assert.equal(await page.getByRole('textbox', { name: 'Decklist' }).inputValue(), partlyRestored)
      await format.selectOption('standard')
      await Promise.race([changedReviewStarted, page.waitForTimeout(10_000).then(() => { throw new Error('changed-review dry run did not start') })])
      assert.equal(await page.getByRole('button', { name: /Checking|Import/ }).last().isDisabled(), true,
        'Import stays disabled while the changed list and format are checked')
      assert.equal(created.length, createdBeforeUndo, 'Undo and format changes do not silently create a deck')
      const changedReviewResponse = page.waitForResponse(r => r.url().endsWith('/api/decks/import') &&
        r.request().postDataJSON()?.dryRun && r.request().postDataJSON()?.text === partlyRestored &&
        r.request().postDataJSON()?.formatCode === 'standard')
      releaseChangedReviewCheck()
      await changedReviewResponse
      await page.getByRole('button', { name: 'Import without them' }).waitFor()
      await group.getByRole('button', { name: 'Edit the line 2 Iono PAL 999' }).waitFor()
      assert.equal(created.length, createdBeforeUndo, 'the restored Iono still needs an explicit skip')
      await page.screenshot({ path: path.join(out, `deck-import-undo-format-${width}.png`) })
      await page.getByRole('button', { name: 'Import without them' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.equal(created.at(-1).text, partlyRestored, 'the explicit skip imports the currently reviewed text')
      assert.equal(created.at(-1).formatCode, 'standard', 'the explicit skip imports the current format')
      assert.deepEqual(formatChecks.at(-1), { text: partlyRestored, formatCode: 'standard' },
        'the explicit skip uses a dry run for this exact text and format')

      // Whitespace before an illegal accepted correction must not move its
      // identity or clear the format guard. No create request may escape.
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      await format.selectOption('glc')
      await page.getByText('Arven is not legal in GLC.').waitFor()
      const createdBeforeBlank = created.length
      const blankCheck = page.waitForResponse(r => r.url().endsWith('/api/decks/import') &&
        r.request().postDataJSON()?.dryRun && r.request().postDataJSON()?.text === illegalWithBlank &&
        r.request().postDataJSON()?.formatCode === 'glc')
      await page.getByRole('textbox', { name: 'Decklist' }).fill(illegalWithBlank)
      await blankCheck
      await page.getByText('Arven is not legal in GLC.').waitFor()
      assert.deepEqual(formatChecks.at(-1), { text: illegalWithBlank, formatCode: 'glc' },
        'whitespace insertion rechecks the exact current list in GLC')
      assert.equal(await page.getByRole('button', { name: 'Import deck' }).isDisabled(), true,
        'whitespace cannot allow an illegal accepted card to import')
      await page.locator('#deck-import-form').dispatchEvent('submit')
      assert.equal(created.length, createdBeforeBlank, 'no create request escapes the illegal correction guard')
      await page.screenshot({ path: path.join(out, `deck-import-illegal-blank-${width}.png`) })
      await page.getByRole('textbox', { name: 'Decklist' }).blur()
      await page.screenshot({ path: path.join(out, `deck-import-illegal-blank-unfocused-${width}.png`) })
      returnedFixes = fixes
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await open()
      await page.getByRole('textbox', { name: 'Decklist' }).fill(original)
      await page.getByRole('button', { name: 'Import deck' }).click()
      await page.getByText("2 lines don't match a card").waitFor()
      await page.evaluate(() => {
        localStorage.setItem('deckpal.decke.hidden', '1')
        window.dispatchEvent(new CustomEvent('deckpal:decke-visibility'))
      })
      await page.getByRole('button', { name: 'Suggest fixes' }).waitFor()
      assert.equal(await page.locator('[data-decke-errand]').count(), 0, 'hidden Deck-E has no dock')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'dialog fits viewport')
      await page.getByRole('button', { name: 'Suggest fixes' }).click()
      await page.getByText('PAL 185 is Iono.').first().waitFor()
      results.push({ case: 'deck-import-fix-confirm', width, checked: checked.length, created: created.length,
        undoDisabledDuringCheck: true, canceledCheckCreated: false, partialSkip: true,
        newUnresolvedNotSkipped: true, whitespaceSkip: true, hiddenTextAction: true })
      console.log('Deck import browser width ' + width + ' passed')
    } finally { releaseConfirmedCheck(); releaseChangedReviewCheck(); await context.close() }
  }
  return results
}
