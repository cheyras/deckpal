import assert from 'node:assert/strict'
import { contextFor } from './support.mjs'
import { signIn } from './admin.mjs'

const USER = '10000000-0000-4000-8000-000000000002'
const original = '2 Iono PAL 999\n2 Iono PAL 999'
const confirmed = '2 Iono PAL 185\n2 Iono PAL 185'
const summary = unresolvedLines => ({ import: { source: 'ptcgl', resolvedEntries: 2 - unresolvedLines.length,
  distinctCards: 1, totalCards: (2 - unresolvedLines.length) * 2, unresolved: unresolvedLines,
  unresolvedLines, warnings: [], variantNote: '' } })
const fixes = [0, 1].map(lineIndex => ({ lineIndex, original: '2 Iono PAL 999', replacement: '2 Iono PAL 185',
  card: { id: 'pal-185', name: 'Iono', set: 'PAL', number: '185' },
  reason: 'PAL 185 is Iono.', confidence: 'suggested' }))

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
    await page.route('**/api/decks**', route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/decks' && route.request().method() === 'GET') return route.fulfill({ json: { decks: [] } })
      if (url.pathname === '/api/decks/import/fix') return route.fulfill({ json: { fixes, unfixed: [] } })
      if (url.pathname === '/api/decks/import') {
        const body = route.request().postDataJSON()
        if (body.dryRun) {
          checked.push(body.text)
          return route.fulfill({ json: summary(body.text === confirmed ? [] : ['2 Iono PAL 999', '2 Iono PAL 999']) })
        }
        created.push(body)
        return route.fulfill({ json: { deck: { id: 'fixture-import' } } })
      }
      return route.fulfill({ json: {} })
    })
    try {
      await page.goto(server.origin + '/decks', { waitUntil: 'networkidle' })
      const open = () => page.getByRole('button', { name: /Import from PTCG Live/ }).click()
      const prepare = async () => {
        await open()
        await page.getByRole('textbox', { name: 'Decklist' }).fill(original)
        await page.getByRole('button', { name: 'Import Deck' }).click()
        await page.getByRole('button', { name: 'Ask Deck-E' }).click()
        await page.getByText('PAL 185 is Iono.').first().waitFor()
      }
      await prepare()
      assert.equal(created.length, 0, 'fix endpoint must not create a deck')
      await page.getByRole('button', { name: 'Undo' }).first().click()
      await page.getByText('Deck-E suggested fixes for 1 of 2 lines.', { exact: false }).waitFor()
      assert.equal(created.length, 0, 'Undo must remain read-only')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await prepare()
      assert.equal(created.length, 0, 'review must remain read-only')
      await page.getByRole('button', { name: 'Confirm and import' }).click()
      await page.waitForFunction(() => location.pathname.endsWith('/decks/fixture-import'))
      assert.deepEqual(checked, [original, original, confirmed], 'the second dry run must check the exact accepted text')
      assert.equal(created.length, 1)
      assert.equal(created[0].text, confirmed, 'import must receive only the text the reader confirmed')
      results.push({ case: 'deck-import-fix-confirm', width, checked: checked.length, created: created.length })
    } finally { await context.close() }
  }
  return results
}
