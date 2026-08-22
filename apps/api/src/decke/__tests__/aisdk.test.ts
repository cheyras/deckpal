/**
 * The AI SDK adapter — the half of it that is a safety control, and the half
 * that decides how much of the database ends up in a model's context.
 *
 * The execute path itself needs a database and is covered by the browser gates.
 * What is asserted here is everything that decides WHICH tools exist and WHAT
 * shape their output reaches the model in — both of which are wrong silently if
 * they are wrong at all.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allTools } from '@deckpal/agent-tools'
import {
  DEFAULT_MAX_TOOL_CHARS,
  buildDataTools,
  clampToolText,
  dataToolSummary,
} from '../adapters/aisdk.js'

/** Enough of the options to build a tool set; nothing here ever executes. */
const OPTS = {
  pool: null as never,
  userId: 'u1',
  jwt: 'jwt',
  apiBase: 'https://example.test/api',
}

test('the default tool set is read-only, and that is derived from the annotation', () => {
  const names = Object.keys(buildDataTools(OPTS))
  const byName = new Map(allTools().map((d) => [d.name, d]))

  assert.ok(names.length > 0, 'no data tools were exposed at all')
  for (const n of names) {
    assert.equal(
      byName.get(n)?.annotations.readOnlyHint,
      true,
      `${n} is exposed to the conversational model but is not annotated read-only`,
    )
  }
})

test('not one write tool is reachable before the approval flow exists', () => {
  const names = new Set(Object.keys(buildDataTools(OPTS)))
  const writes = allTools().filter((d) => !d.annotations.readOnlyHint)

  assert.ok(writes.length > 0, 'the fixture is wrong — there should be write tools to exclude')
  for (const w of writes) {
    assert.equal(names.has(w.name), false, `${w.name} can write and is exposed`)
  }
  // Named explicitly, because these four can destroy data that is not otherwise
  // recoverable and their absence should fail loudly if it ever changes.
  for (const n of ['delete_deck', 'delete_list', 'delete_battle_log', 'revert']) {
    assert.equal(names.has(n), false, `${n} is destructive and is exposed`)
  }
})

test('the filter reads the annotation, not the verb in the name', () => {
  const names = new Set(Object.keys(buildDataTools(OPTS)))
  // The two that would be classified wrongly by their names. `set_cart` only
  // composes an outbound TCGplayer URL and never contacts TCGplayer;
  // `deck_history` can roll a deck back.
  assert.equal(names.has('set_cart'), true, 'set_cart is a read and should be available')
  assert.equal(names.has('deck_history'), false, 'deck_history can revert a deck')
})

test('a narrower include is honoured — a sub-agent gets a subset', () => {
  // A research sub-agent must never hold a write tool, and the way to guarantee
  // that is to not hand it one.
  const only = buildDataTools({ ...OPTS, include: (d) => d.name === 'search_cards' })
  assert.deepEqual(Object.keys(only), ['search_cards'])
})

test('the prompt summary matches the tools actually built', () => {
  // These two must not drift: the prompt tells him what he has, and the tool
  // set is what he has. A prompt that names a tool he does not hold is the bug
  // this whole area exists to fix, in a new place.
  const built = Object.keys(buildDataTools(OPTS)).sort()
  const summarised = dataToolSummary()
    .map((t) => t.name)
    .sort()
  assert.deepEqual(summarised, built)
  for (const t of dataToolSummary()) {
    assert.ok(t.title.length > 0, `${t.name} has no title to show`)
  }
})

test('output under the ceiling is returned untouched', () => {
  const text = 'Charizard ex | me05-84 | Double Rare | holo x2 | $31.20'
  assert.equal(clampToolText(text, DEFAULT_MAX_TOOL_CHARS), text)
})

test('truncation ANNOUNCES itself — a silent cut is a new way to lie', () => {
  const rows = Array.from({ length: 400 }, (_, i) => `Card ${i} | me05-${i} | Common | $0.10`)
  const out = clampToolText(rows.join('\n'), 500)

  assert.ok(out.length < rows.join('\n').length, 'nothing was cut')
  // A model handed a quietly shortened list will describe it as the whole list,
  // which is exactly the class of confident-claim-about-unseen-data being fixed.
  assert.match(out, /Cut off here/)
  assert.match(out, /NOT the whole result/)
  assert.match(out, /do not describe it as complete/)
  // And it says how much it kept, so he can say so too.
  assert.match(out, /showing \d+ of 400 lines/)
})

test('the cut lands on a line boundary — half a row reads as data and is not', () => {
  const rows = Array.from({ length: 100 }, (_, i) => `Card ${i} | me05-${i} | Common | $0.10`)
  const out = clampToolText(rows.join('\n'), 500)
  const body = out.slice(0, out.indexOf('\n\n[Cut off here'))
  for (const line of body.split('\n')) {
    assert.match(line, /\| \$\d/, `a row was cut mid-way: ${JSON.stringify(line)}`)
  }
})

test('a ceiling of 0 disables truncation, for the tier that wants everything', () => {
  const big = 'x'.repeat(50_000)
  assert.equal(clampToolText(big, 0), big)
})

test('a single enormous line is still cut rather than passed through', () => {
  // No newline to cut on. The line-boundary preference must not become a way to
  // bypass the ceiling entirely.
  const oneLine = 'y'.repeat(20_000)
  const out = clampToolText(oneLine, 1_000)
  assert.ok(out.length < oneLine.length)
  assert.match(out, /Cut off here/)
})
