import assert from 'node:assert/strict'
import { contextFor } from './support.mjs'
import { signIn } from './admin.mjs'

const USER = '10000000-0000-4000-8000-000000000002'
const original = '2 Iono PAL 999\n2 Iono PAL 999'
const confirmed = '2 Iono PAL 185\n2 Iono PAL 185'
const partial = '2 Iono PAL 185\n2 Iono PAL 999'
const originalWithWhitespace = '2 Iono PAL 999\n  2 Iono PAL 999  '
const partialWithWhitespace = '2 Iono PAL 185\n  2 Iono PAL 999  '
const summary = (unresolvedLines, lineCount = 2) => ({ import: { source: 'ptcgl', resolvedEntries: lineCount - unresolvedLines.length,
  distinctCards: 1, totalCards: (lineCount - unresolvedLines.length) * 2, unresolved: unresolvedLines,
  unresolvedLines, warnings: [], variantNote: '' } })
const fixes = [0, 1].map(lineIndex => ({ lineIndex, original: '2 Iono PAL 999', replacement: '2 Iono PAL 185',
  card: { id: 'pal-185', name: 'Iono', set: 'PAL', number: '185' },
  reason: 'PAL 185 is Iono.', confidence: 'suggested' }))
const twoDifferent = '2 Iono PAL 999\n2 Arven OBF 999'
const twoDifferentFixes = [fixes[0], {
  lineIndex: 1, original: '2 Arven OBF 999', replacement: '2 Arven OBF 186',
  card: { id: 'obf-186', name: 'Arven', set: 'OBF', number: '186' },
  reason: 'OBF 186 is Arven.', confidence: 'suggested',
}]

/** The built cloud app, fake account and intercepted API: no deck is created
 * until the exact reviewed text passes its second dry run. */
export async function checkDeckImport(browser, server, fixture) {
  const results = []
  fixture.state.actor = 'ordinary'
  fixture.state.permissions = ['decke.use']
  for (const width of [1440, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    await signIn(context, USER)
    const created = [], checked = []
    let returnedFixes = fixes
    let novelUnresolved = false
    let holdConfirmedCheck = true
    let releaseConfirmedCheck
    let confirmedCheckStarted
    const heldResponse = new Promise(resolve => { releaseConfirmedCheck = resolve })
    const started = new Promise(resolve => { confirmedCheckStarted = resolve })
    await page.route('**/api/decks**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/decks' && route.request().method() === 'GET') return route.fulfill({ json: { decks: [] } })
      if (url.pathname === '/api/decks/import/fix') return route.fulfill({ json: { fixes: returnedFixes, unfixed: [] } })
      if (url.pathname === '/api/decks/import') {
        const body = route.request().postDataJSON()
        if (body.dryRun) {
          checked.push(body.text)
          if (body.text === confirmed && holdConfirmedCheck) {
            holdConfirmedCheck = false
            confirmedCheckStarted()
            return heldResponse.then(() => route.fulfill({ json: summary([]) }))
          }
          if (body.text === '2 Iono PAL 999' || body.text === '2 Iono PAL 999\n')
            return route.fulfill({ json: summary(['2 Iono PAL 999'], 1) })
          if (body.text.includes('Arven OBF'))
            return route.fulfill({ json: summary(body.text.split('\n').filter(line => line.endsWith('999'))) })
          return route.fulfill({ json: summary(body.text === confirmed ? []
            : body.text === partial ? [novelUnresolved ? '2 Iono PAL 185' : '2 Iono PAL 999']
              : body.text === partialWithWhitespace ? ['  2 Iono PAL 999  ']
                : body.text === originalWithWhitespace ? ['2 Iono PAL 999', '  2 Iono PAL 999  ']
                  : ['2 Iono PAL 999', '2 Iono PAL 999']) })
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
        if (input === twoDifferent) {
          assert.equal(await group.getByText('2 Iono PAL 999').count(), 1)
          assert.equal(await group.getByText('2 Arven OBF 999').count(), 1)
        } else {
          assert.equal(await group.getByText('2 Iono PAL 999').count(), 2, 'both original lines remain in their own rows')
        }
        assert.equal(await group.getByRole('button', { name: 'Undo' }).count(), suggested)
        assert.equal(await group.getByText('Review Deck-E’s fixes').count(), 0, 'there is no second review card')
      }
      await prepare()
      assert.equal(created.length, 0, 'fix endpoint must not create a deck')
      await page.getByRole('button', { name: 'Undo' }).first().click()
      await page.getByText('Fixed 1 of 2, check them').waitFor()
      await page.getByRole('button', { name: 'Import without them' }).waitFor()
      assert.equal(created.length, 0, 'Undo must remain read-only')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await prepare()
      assert.equal(created.length, 0, 'review must remain read-only')
      await page.getByRole('button', { name: 'Import deck' }).click()
      await started
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
      assert.deepEqual(checked, [original, original, confirmed, original, confirmed],
        'the second dry run must check the exact accepted text on each review')
      assert.equal(created.length, 1)
      assert.equal(created[0].text, confirmed, 'import must receive only the text the reader confirmed')
      returnedFixes = twoDifferentFixes
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      await page.getByRole('button', { name: 'Undo' }).first().click()
      await page.getByRole('button', { name: 'Edit the line 2 Iono PAL 999' }).click()
      await page.keyboard.insertText('2 Iono PAL 185')
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
      await page.getByRole('textbox', { name: 'Decklist' }).fill('2 Arven OBF 999')
      assert.equal(await group.getByRole('button', { name: 'Undo' }).count(), 1,
        'deleting A keeps B’s suggestion after its line index moves')
      await group.getByText('1 line to review').waitFor()
      await page.getByRole('button', { name: 'Import deck' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.equal(created.at(-1).text, '2 Arven OBF 186', 'the remaining fix applies to B, not the deleted line')
      returnedFixes = fixes
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare()
      await page.getByRole('button', { name: 'Undo' }).last().click()
      await page.getByRole('textbox', { name: 'Decklist' }).fill('2 Iono PAL 999\n')
      assert.equal(await group.getByRole('button', { name: 'Undo' }).count(), 0,
        'deleting one identical occurrence must not restore its rejected suggestion on the survivor')
      await page.getByRole('button', { name: 'Import deck' }).click()
      await group.getByText("1 line doesn't match a card").waitFor()
      assert.equal(created.length, 3, 'ambiguous duplicate deletion must not import a guessed correction')
      returnedFixes = twoDifferentFixes
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(2, twoDifferent)
      await page.getByRole('button', { name: 'Undo' }).first().click()
      await page.getByRole('textbox', { name: 'Decklist' }).fill(`Pokémon: 4\n${twoDifferent}`)
      await page.getByRole('button', { name: 'Import deck' }).click()
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
      novelUnresolved = true
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(1)
      await page.getByRole('button', { name: 'Import without them' }).click()
      await page.getByRole('group', { name: 'Unmatched decklist lines' }).getByText('2 Iono PAL 185').waitFor()
      assert.equal(created.length, 5, 'a newly unmatched replacement must be shown, not silently skipped')
      novelUnresolved = false
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      await prepare(1, originalWithWhitespace)
      await page.getByRole('button', { name: 'Import without them' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.equal(created.at(-1).text, partialWithWhitespace, 'spaces on the skipped line must not require a second click')
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
    } finally { releaseConfirmedCheck(); await context.close() }
  }
  return results
}
