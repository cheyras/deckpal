// UXC-05 (deckpal audit ux-collection, 2026-09-26): a smart list that has
// collected everything it asks for fell into the generic empty state —
// "This list is empty" plus an "Add Cards" button. Every tap in that modal
// 400'd (`this is a smart list — membership is its rule`, apps/api/src/routes/
// lists.ts:965/1092) and the failure was swallowed
// (`onError: () => setAddingId(null)`), so it looked like the tap did nothing.
//
// Source-text test for the same reason `gatedAssets.test.ts` is one: the
// property that matters ("a smart list never offers an add that can only
// 400") is a fact about the CODE, and this repo has no component-rendering
// harness (no jsdom/testing-library in apps/web's devDependencies) to observe
// it any other way short of the full Playwright suite.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const LIST_DETAIL = fileURLToPath(new URL('../ListDetail.tsx', import.meta.url))
const LIST_MODALS = fileURLToPath(new URL('../../components/ListModals.tsx', import.meta.url))

function emptyStateBlock(src: string): string {
  const start = src.indexOf('{items.length === 0 ? (')
  const end = src.indexOf(') : reordering', start)
  assert.ok(start >= 0 && end > start, 'could not find the list-items empty-state ternary — has it moved or been rewritten?')
  return src.slice(start, end)
}

test('a completed smart list gets a completion state, never "Add Cards"', () => {
  const src = fs.readFileSync(LIST_DETAIL, 'utf8')
  const block = emptyStateBlock(src)
  assert.match(block, /smart \? \(/, 'the empty-state branch must check `smart` before falling back to the plain empty list')
  assert.match(block, /You've collected everything in this list/, 'the smart branch must render a completion message, not the generic empty state')
  // The smart branch must come BEFORE the non-smart one that renders the Add
  // Cards button, i.e. "Add Cards" must not appear until after the smart
  // check has already been resolved by the ternary.
  const smartIdx = block.indexOf('smart ? (')
  const addCardsIdx = block.indexOf('Add Cards')
  assert.ok(smartIdx >= 0 && addCardsIdx > smartIdx, '"Add Cards" must sit in the non-smart arm of the ternary, after the smart check')
})

test('a failed add surfaces the server\'s message instead of vanishing', () => {
  const src = fs.readFileSync(LIST_DETAIL, 'utf8')
  assert.doesNotMatch(
    src,
    /onError:\s*\(\)\s*=>\s*setAddingId\(null\)/,
    'addItem.onError must not go back to silently swallowing the failure (the original UXC-05 defect)',
  )
  assert.match(src, /<AddCardModal[\s\S]*?error=\{addError\}/, 'AddCardModal must receive the add mutation\'s error')

  const modals = fs.readFileSync(LIST_MODALS, 'utf8')
  assert.match(modals, /error\?:\s*string \| null/, 'AddCardModal must accept an optional error prop')
})
