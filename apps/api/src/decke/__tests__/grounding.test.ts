/**
 * Card ids he may show, because a tool returned them.
 *
 * The defect: asked for "my 5 most valuable cards" he drew a panel of five ids
 * the account does not own, and the ids DIFFERED between two runs — which is
 * what proves they were invented rather than stale. The tool-contract gap that
 * invited it is fixed, but fixing the reason does not remove the capability, so
 * this is the part that cannot be talked out of.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGrounding, partitionCards } from '../grounding.js'

/** A real `search_cards` row, in the shape the tools actually emit. */
const ROW = 'Goldeen | me05-013 | Common | owned x1 | $0.07 | series mega-evolution'

test('ids are harvested from the tool result TEXT, which is what tools emit', () => {
  // Deliberately parsed out of the prose rather than read from a structured
  // field: one compact row per line IS the output contract of every tool in the
  // shared package, and a harvester tied to one tool's shape would silently
  // stop working the day a second tool started returning cards.
  const g = createGrounding()
  g.observe(ROW)
  assert.equal(g.seen('me05-013'), true)
  assert.equal(g.seen('ME05-013'), true, 'ids are case-insensitive')
  assert.equal(g.seen('me05-084'), false)
})

test('evidence accumulates across the whole turn, not per call', () => {
  // He may legitimately search on step one and draw the grid on step three.
  const g = createGrounding()
  g.observe('Goldeen | me05-013 | Common')
  g.observe('Seaking | me05-014 | Uncommon')
  assert.equal(g.size(), 2)
  assert.equal(g.seen('me05-014'), true)
})

test('an invented id is removed and a real one is kept', () => {
  const g = createGrounding()
  g.observe(ROW)
  const { kept, invented } = partitionCards(['me05-013', 'me05-084'], g)
  assert.deepEqual(kept, ['me05-013'])
  assert.deepEqual(invented, ['me05-084'])
})

test('the EXACT observed failure: five plausible ids, none returned by a tool', () => {
  // Verbatim from the deployed preview, both runs. Every one of these is a
  // well-formed id for a real set — which is exactly why the reader could not
  // possibly tell: an invented id renders as real card art for somebody else's
  // card, beside a sentence about the cards they asked for.
  const g = createGrounding()
  g.observe('Mega Delphox ex | me05-045 | Holofoil | x1 | $0.68')
  const run1 = partitionCards(['me05-084', 'me05-047', 'me05-019', 'me05-021', 'me05-020'], g)
  const run2 = partitionCards(['me05-084', 'me05-083', 'me05-086', 'me05-087', 'me05-085'], g)
  assert.equal(run1.kept.length, 0, 'not one of them was grounded')
  assert.equal(run2.kept.length, 0)
  assert.equal(run1.invented.length, 5)
})

test('NO evidence means everything passes — the check is for CONTRADICTED ids', () => {
  // A turn with no data-tool calls has no evidence either way. Refusing every id
  // there would break the legitimate flow where a reader types an id themselves
  // and asks to see it, and would turn a grounding check into a general ban.
  const empty = createGrounding()
  const { kept, invented } = partitionCards(['me05-013'], empty)
  assert.deepEqual(kept, ['me05-013'])
  assert.equal(invented.length, 0)

  // And an absent grounding object behaves the same, so a caller that does not
  // pass one is not silently enabling a filter it did not ask for.
  assert.deepEqual(partitionCards(['me05-013'], undefined).kept, ['me05-013'])
})

test('it does not mistake ordinary prose for a card id', () => {
  const g = createGrounding()
  g.observe('You own 12 of 120 — about 10% of the set. Released 2026-07-17.')
  // A date is not a card. Neither is a percentage.
  assert.equal(g.seen('2026-07'), false)
  assert.equal(g.seen('10%'), false)
})

test('real set-id shapes still match, including the odd ones', () => {
  // The letter requirement above must not exclude legitimate ids. These are all
  // real shapes from this catalog.
  const g = createGrounding()
  g.observe('a me05-013 b sv3pt5-084 c gym2-2 d swshp-SWSH001')
  for (const id of ['me05-013', 'sv3pt5-084', 'gym2-2', 'swshp-SWSH001']) {
    assert.equal(g.seen(id), true, `${id} should be recognised as a card id`)
  }
})
