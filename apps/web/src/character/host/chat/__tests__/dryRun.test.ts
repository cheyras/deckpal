/**
 * The dry-run rows on the approval card (UXD-04).
 *
 * The card read "DRY RUN — nothing executed. Would:" and nothing else, on a
 * tool that rewrites a whole deck. These pin that every operation line becomes
 * something the reader can check, that nothing unrecognised is dropped, and that
 * the grammar here is the grammar `describeOp` actually prints.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { dryRunCardIds, dryRunChange, dryRunDeckLine, dryRunItems } from '../dryRun'

// Exactly what `previewSummary` (apps/api aisdk.ts) sends for a save_deck edit;
// its own test drives the real tool to produce this shape.
const EDIT = [
  "EDIT your existing deck 'Dragapult ex / Dusknoir' (deck-drag), 22 distinct card(s) in it:",
  'remove x1 sv04-160',
  'set sv02-185 x3 → x4',
].join('\n')

test('an edit becomes the deck, then one row per card', () => {
  const items = dryRunItems(EDIT)
  assert.deepEqual(items, [
    { kind: 'deck', name: 'Dragapult ex / Dusknoir', created: false },
    { kind: 'card', op: 'remove', qty: 1, cardId: 'sv04-160' },
    { kind: 'card', op: 'set', cardId: 'sv02-185', from: 3, qty: 4 },
  ])
  assert.equal(dryRunDeckLine(items[0] as never), 'Changes to Dragapult ex / Dusknoir')
  assert.deepEqual(dryRunCardIds(items), ['sv04-160', 'sv02-185'])
})

test('each change says which way it points', () => {
  assert.deepEqual(dryRunChange({ kind: 'card', op: 'add', qty: 4, cardId: 'a' }), { text: '+4', down: false })
  assert.deepEqual(dryRunChange({ kind: 'card', op: 'remove', qty: 1, cardId: 'a' }), { text: '−1', down: true })
  assert.deepEqual(dryRunChange({ kind: 'card', op: 'set', qty: 4, from: 3, cardId: 'a' }), { text: '3 → 4', down: false })
  assert.deepEqual(dryRunChange({ kind: 'card', op: 'set', qty: 2, from: 3, cardId: 'a' }), { text: '3 → 2', down: true })
})

test('a create names the new deck and its format', () => {
  const items = dryRunItems("CREATE a new deck called 'Squirtle Laughs' (standard)\nadd x4 sv01-7")
  assert.equal(dryRunDeckLine(items[0] as never), 'A new deck, Squirtle Laughs (Standard)')
  assert.deepEqual(items[1], { kind: 'card', op: 'add', qty: 4, cardId: 'sv01-7' })
})

test('list dry runs carry parseable card ids while keeping their labels', () => {
  const items = dryRunItems("CREATE a new static list called 'Coin flips'\nadd Goldeen (me05-013, Normal) — card: add x2 me05-013")
  assert.deepEqual(items, [
    { kind: 'list', name: 'Coin flips', created: true },
    { kind: 'card', op: 'add', qty: 2, cardId: 'me05-013', label: 'Goldeen (me05-013, Normal)' },
  ])
  assert.deepEqual(dryRunCardIds(items), ['me05-013'])
})

test('list edits parse added and removed cards for the visual diff', () => {
  const items = dryRunItems("ADD TO your existing list 'Coin flips' (16 item(s) already in it)\nadd Pikachu VMAX — card: add x1 swsh4-44\nremove item item-1\ncard: remove x2 me05-013 — Goldeen")
  assert.deepEqual(items.map((item) => item.kind), ['list', 'card', 'card'])
  assert.deepEqual(dryRunChange(items[1] as never), { text: '+1', down: false })
  assert.deepEqual(dryRunChange(items[2] as never), { text: '−2', down: true })
})

test('nothing unrecognised is dropped, and the cut is marked', () => {
  const items = dryRunItems("(heads up: you already have a deck called 'X' — this makes a SECOND one)\nrename 'A' → 'B'\n…and 9 more")
  assert.deepEqual(items.map((i) => i.kind), ['text', 'text', 'text'])
  assert.equal((items[2] as { more?: boolean }).more, true)
})

test('the bare header an older server sends is not shown as a fact', () => {
  assert.deepEqual(dryRunItems('DRY RUN — nothing executed. Would:'), [])
  assert.deepEqual(dryRunItems(''), [])
  assert.deepEqual(dryRunItems(null), [])
})

test('the grammar is the one `describeOp` prints', () => {
  // If the tool rewords an operation, rows would silently fall back to raw
  // text. That is safe (nothing is dropped) but it is a regression worth failing.
  const src = readFileSync(new URL('../../../../../../../packages/agent-tools/src/tools/decks.ts', import.meta.url), 'utf8')
  for (const template of [
    'return `add x${op.qty} ${op.cardId}`;',
    'return `set ${op.cardId} x${op.from} → x${op.to}`;',
    'return `remove x${op.qty} ${op.cardId}`;',
    "`  EDIT your existing deck '${current.deck.name}' (${deckRef}), ${current.cards.length} distinct card(s) in it:`",
    "`  CREATE a new deck called '${name}' (${format ?? 'standard'})`",
  ]) {
    assert.ok(src.includes(template), `decks.ts no longer prints: ${template}`)
  }
})
