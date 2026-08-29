/**
 * The line that makes a deep-call confirmation worth reading.
 *
 * Every deep call asks first now, and the argument AGAINST asking was real:
 * "friction people learn to click through is worse than none." A dialog saying
 * only "Can I plan a deck?" is precisely that dialog — no information, so the
 * honest response is a reflex tap, and a reflex tap is not consent.
 *
 * What makes the tap mean something is his RESTATEMENT. The reader asked for "a
 * new deck, doesn't have to be good, I just want to give people at the game
 * store a laugh"; what he is about to spend on is `idea: "all-Water Squirtle
 * deck built for comedy over competitiveness"`. Those are different sentences,
 * and the gap between them is the whole value of being asked.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEEP_COST_NOTE, deepRequestLine, isDeepRequest } from '../deepRequest'

test('it shows the request, then its qualifiers', () => {
  assert.equal(
    deepRequestLine('plan_deck', { idea: 'all-Water Squirtle deck for comedy', format: 'Standard' }),
    'all-Water Squirtle deck for comedy · Standard',
  )
})

test('a missing qualifier is simply absent, not blank-padded', () => {
  assert.equal(deepRequestLine('plan_deck', { idea: 'something silly' }), 'something silly')
})

test('NOTHING REAL means null, never a placeholder', () => {
  // A confident-sounding line assembled from an empty object is the failure this
  // whole pass exists to remove, and it would land on the one surface where the
  // reader is being asked to trust what they are reading. `null` makes the card
  // fall back to its headline, which is honest about knowing nothing.
  for (const input of [{}, { idea: '' }, { idea: '   ' }, { idea: 42 }, null, undefined, 'nope']) {
    assert.equal(deepRequestLine('plan_deck', input), null, JSON.stringify(input))
  }
})

test('a tool with no declared shape gets no line rather than a guessed one', () => {
  assert.equal(deepRequestLine('log_cards', { items: [1, 2, 3] }), null)
  assert.equal(deepRequestLine('decks', { deck_id: 'x' }), null)
  assert.equal(isDeepRequest('plan_deck'), true)
  assert.equal(isDeepRequest('log_cards'), false)
})

test('a long idea is cut on a word boundary, not mid-word', () => {
  // It sits on a consent dialog. "…built for comed…" reads as a rendering fault
  // and undermines the one thing the line is there to do.
  const long =
    'a deck built around Squirtle and nothing else at all because the entire point is to make ' +
    'everybody at the game store laugh on Saturday afternoon rather than to win any games'
  const out = deepRequestLine('plan_deck', { idea: long })!
  assert.ok(out.endsWith('…'), 'a truncated line must say it was truncated')
  assert.ok(out.length <= 161, `line was ${out.length} chars`)
  assert.doesNotMatch(out, /\s…$/, 'it left a dangling space before the ellipsis')
  // The cut lands between words: everything before the ellipsis is a prefix of
  // the original, ending where a word ends.
  const body = out.slice(0, -1)
  assert.ok(long.startsWith(body), 'the line is not a prefix of what he actually asked for')
})

test('whitespace is collapsed, because a model writes newlines into prose', () => {
  assert.equal(
    deepRequestLine('plan_deck', { idea: '  a deck\n\n  with   odd   spacing  ' }),
    'a deck with odd spacing',
  )
})

test('every deep tool that asks has a shape, or its card is a bare headline', () => {
  // The four deep tools all reach the consent dialog now. One without a shape
  // here renders the friction-with-no-information dialog the line exists to
  // prevent — silently, and only for that one tool.
  for (const n of ['plan_deck', 'analyze_collection', 'research_meta', 'write_strategy_guide']) {
    assert.equal(isDeepRequest(n), true, `${n} would show a bare headline`)
  }
})

test('the cost is its own sentence and never our internal name for the tier', () => {
  // "I don't know that I want the wording to be 'can I spend a deep question'."
  // "Deep question" is what WE call the tier. It reached a consent dialog, which
  // is the one place a reader is being asked to agree to something and the last
  // place to use a word only we know.
  assert.doesNotMatch(DEEP_COST_NOTE, /deep question/i)
  assert.doesNotMatch(DEEP_COST_NOTE, /credit/i, 'a number here would be a price on a deployment that is not charging')
  assert.match(DEEP_COST_NOTE, /more than a normal/i)
})

// ── THE BUG THAT PUT THIS FILE BACK INTO THE EDITOR ──────────────────────────
//
// `write_strategy_guide` is the one deep tool that WRITES, so its consent card
// is the one surface where a bare "Write and store a strategy guide?" is most
// clearly a reflex tap with nothing behind it. The SHAPE used to list
// `deck_name` and `deck_id`, which are not fields the tool's inputSchema
// declares — see apps/api/src/decke/deep.ts, whose `write_strategy_guide`
// inputSchema is { deck, focus, findings, deepest }. So every call resolved
// `null`, and the card rendered no restatement at all.
//
// The fix reads `deck` (and `focus`); the deck name now renders.

test('write_strategy_guide renders the deck name from the real `deck` field', () => {
  const out = deepRequestLine('write_strategy_guide', { deck: 'Slowking toolbox' })!
  assert.ok(out, 'a guide call with a deck must produce a line, not null')
  assert.match(out, /Slowking toolbox/)
})

test('write_strategy_guide with a focus renders deck then focus', () => {
  assert.equal(
    deepRequestLine('write_strategy_guide', { deck: 'Slowking toolbox', focus: 'mirror matchups' }),
    'Slowking toolbox · mirror matchups',
  )
})

test('write_strategy_guide with no deck renders null, never a placeholder', () => {
  // The honest shape when no field carries anything: the card falls back to its
  // headline. A line assembled from nothing is the failure this pass removes.
  for (const input of [{}, { deck: '' }, { deck: '   ' }]) {
    assert.equal(deepRequestLine('write_strategy_guide', input), null, JSON.stringify(input))
  }
})

// ── THE NO-RESEARCH FACT, RENDERED FROM THE SIGNED INPUT ─────────────────────
//
// `needsApproval` in apps/api/src/decke/deep.ts injects `no_research: true`
// into the input when `findings` is absent or trivial (< 80 chars). That is the
// X2-compliant way to show the reader a guide is not backed by research: a
// server-computed flag in the real input, not model prose. This renders it.

test('no_research: true appends the no-research warning to the line', () => {
  const out = deepRequestLine('write_strategy_guide', {
    deck: 'Slowking toolbox',
    no_research: true,
  })!
  assert.match(out, /Slowking toolbox/)
  assert.match(out, /no research this conversation/)
})

test('without no_research the warning does not appear', () => {
  const out = deepRequestLine('write_strategy_guide', { deck: 'Slowking toolbox' })!
  assert.doesNotMatch(out, /no research/i)
})
