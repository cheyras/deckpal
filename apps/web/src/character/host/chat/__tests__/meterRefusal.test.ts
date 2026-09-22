/**
 * The refusal that has to survive the browser's next POST.
 *
 * A cap-refused `write_strategy_guide` left no trace on the following leg's
 * request, so the server — which keeps nothing between requests — re-derived
 * "nothing has been refused", raised a second approval card for the identical
 * work and charged the same spent cap again.
 *
 * The end-to-end proof is in `tests/browser/chat.mjs`, which drives the real
 * hook against a real fetch and feeds the captured body to the real server
 * seed. This file pins the predicate that decides what travels.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  MAX_REFUSAL_CHARS,
  MAX_REPLAYED_REFUSALS,
  meterRefusalParts,
  meterRefusalScope,
  readMeterRefusal,
  wireCallIdentities,
  type MeterRefusal,
} from '../meterRefusal'

/** Byte-for-byte the shape `apps/api/src/decke/deepOutcome.ts` emits. */
const refusalText = (scope: string, reason: string): string =>
  `[[NO_WORK]] REFUSED [meter:${scope}] — this tool did not run. ${reason}. ` +
  `You did not do this work. Do not describe it as done.`

test('the scope is read off the server marker and nothing else', () => {
  assert.equal(meterRefusalScope(refusalText('cap', "today's 10 are spent")), 'cap')
  assert.equal(meterRefusalScope(refusalText('hold', 'on hold')), 'hold')
  assert.equal(meterRefusalScope(refusalText('credits', 'not enough')), 'credits')
  // A refusal with no scope is a DECLINE or a vetted query, not a spent meter.
  assert.equal(meterRefusalScope('[[NO_WORK]] REFUSED — this tool did not run.'), null)
  // A real answer, a failure, and anything that is not a string at all.
  assert.equal(meterRefusalScope('Here is the guide you asked for.'), null)
  assert.equal(meterRefusalScope({ text: refusalText('cap', 'x') }), null)
  assert.equal(meterRefusalScope(undefined), null)
})

test('prose cannot mint a refusal, wherever the marker sits', () => {
  // The model narrating the marker mid-sentence must not read as one: the
  // pattern is anchored, so only a result that STARTS with it counts.
  assert.equal(meterRefusalScope(`I was told: ${refusalText('cap', 'spent')}`), null)
  assert.equal(readMeterRefusal('c1', 'plan_deck', {}, 'the cap [meter:cap] is spent'), null)
})

test('a refusal carries its id and its ORIGINAL input', () => {
  const input = { deck_id: 'deck-9', findings: '' }
  const r = readMeterRefusal('call-a', 'write_strategy_guide', input, refusalText('cap', 'spent'))
  assert.ok(r)
  assert.equal(r.toolCallId, 'call-a')
  assert.equal(r.name, 'write_strategy_guide')
  assert.deepEqual(r.input, input)
})

test('a chunk with no known tool name is dropped rather than guessed at', () => {
  // `tool-<name>` is the part's whole identity; inventing one would replay a
  // call the server cannot match to anything.
  assert.equal(readMeterRefusal('call-a', undefined, {}, refusalText('cap', 'spent')), null)
})

test('an ordinary server result is not carried', () => {
  // The cost argument in `lookupRecord.ts`: a replayed deck read is kilobytes
  // re-billed on every later leg. Only the refusal travels.
  assert.equal(readMeterRefusal('call-a', 'analyze_collection', {}, 'You own 604 cards…'), null)
})

test('a hostile result cannot grow the payload without bound', () => {
  const long = refusalText('cap', 'x'.repeat(5000))
  const r = readMeterRefusal('call-a', 'plan_deck', {}, long)
  assert.ok(r)
  assert.equal(r.output.length, MAX_REFUSAL_CHARS)
  assert.ok(meterRefusalScope(r.output), 'the marker survives the clamp')
})

test('the wire part is the SDK output-available shape', () => {
  const r = readMeterRefusal(
    'call-a',
    'write_strategy_guide',
    { deck_id: 'deck-9' },
    refusalText('credits', 'needs 2, 0 left'),
  ) as MeterRefusal
  assert.deepEqual(meterRefusalParts([r]), [
    {
      type: 'tool-write_strategy_guide',
      toolCallId: 'call-a',
      state: 'output-available',
      input: { deck_id: 'deck-9' },
      output: r.output,
    },
  ])
})

test('a call already on the wire can be named without the stream repeating it', () => {
  // THE APPROVAL CONTINUATION LEG. The real SDK resumes an approved call and
  // streams only its output — no second `tool-input-available` — so a refusal
  // there arrives as an id and nothing else. The request the browser just built
  // is the only place its name and arguments still exist.
  const wire = [
    { role: 'user', parts: [{ type: 'text', text: 'write the guide' }] },
    {
      role: 'assistant',
      parts: [
        { type: 'text', text: 'I can write that.' },
        {
          type: 'tool-write_strategy_guide',
          toolCallId: 'approved-original',
          state: 'approval-responded',
          input: { deck: 'Toolbox', findings: '', no_research: true },
          approval: { id: 'ap-1', approved: true },
        },
      ],
    },
  ]
  const found = wireCallIdentities(wire)
  assert.deepEqual(found, [
    {
      toolCallId: 'approved-original',
      name: 'write_strategy_guide',
      input: { deck: 'Toolbox', findings: '', no_research: true },
    },
  ])
  // Which is what lets the output-only chunk be read at all.
  const r = readMeterRefusal('approved-original', found[0]!.name, found[0]!.input, refusalText('cap', 'spent'))
  assert.ok(r, 'the continuation leg could not name its own refused call')
  assert.equal(r.name, 'write_strategy_guide')
})

test('wire identities come from tool parts, never from text', () => {
  // Same rule the server's seed follows: prose naming a tool is not a call.
  assert.deepEqual(
    wireCallIdentities([
      { role: 'assistant', parts: [{ type: 'text', text: 'tool-plan_deck', toolCallId: 'x' }] },
      { role: 'assistant', parts: [{ type: 'tool-plan_deck' }] },
      { role: 'user', parts: undefined },
      {},
    ] as never),
    [],
  )
})

test('one leg cannot replay more refusals than the budget', () => {
  const many = Array.from({ length: MAX_REPLAYED_REFUSALS + 3 }, (_, i) =>
    readMeterRefusal(`call-${i}`, 'plan_deck', { goal: String(i) }, refusalText('credits', 'thin')),
  ) as MeterRefusal[]
  assert.equal(meterRefusalParts(many).length, MAX_REPLAYED_REFUSALS)
})
