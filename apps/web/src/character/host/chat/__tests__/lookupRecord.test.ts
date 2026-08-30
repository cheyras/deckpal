/**
 * The evidence a leg carries into the next one.
 *
 * ── THE TURN THIS FILE IS ABOUT ─────────────────────────────────────────────
 *
 * Asked to show a decklist visually, he drew the panel with `showScreen`, then
 * called `flyTo` — which is a client tool, so the browser has to run it and the
 * turn continues on a second leg. On that leg he re-read `decks` and wrote the
 * whole 60-card list out again as prose, in a second bubble.
 *
 * Two rules should have stopped it and neither could fire, because the
 * follow-up message carried his text and the movement's result and nothing
 * else: the prompt's "when a panel carries the answer, do not also narrate it",
 * and `showScreen`'s own return value, "the panel is on screen, do not repeat
 * its contents in words". A rule cannot apply to evidence that was thrown away
 * before it was read.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  MAX_REPLAYED_FAILURES,
  failureParts,
  freshCalls,
  lookupRecord,
  TOOL_RECORD_PREFIX,
  type FailedCall,
  type RecordedCall,
} from '../lookupRecord'

const call = (over: Partial<RecordedCall> & { name: string }): RecordedCall => ({
  phase: 'ok',
  summary: 'did a thing',
  ...over,
})

// ── lookupRecord ────────────────────────────────────────────────────────────

test('a finished lookup becomes one line, prefixed so it cannot read as speech', () => {
  const rec = lookupRecord([
    call({ name: 'decks', summary: "Slowking Toolbox (v2) — 60 cards" }),
    call({ name: 'showScreen', summary: 'panel drawn, 3 block(s)' }),
  ])
  assert.ok(rec, 'two finished calls are evidence')
  assert.equal(rec.type, 'text')
  assert.ok(rec.text.startsWith(TOOL_RECORD_PREFIX), 'marked as a record, not folded into his words')
  // THE LITERAL IS A WIRE CONTRACT. The server's circuit breaker
  // (apps/api/src/decke/failing.ts) replicates this exact string to read
  // recoveries out of the replayed record — a browser module and a server
  // module cannot import each other. Change one, change both.
  assert.equal(TOOL_RECORD_PREFIX, '[lookups on that turn, for your own reference —')
  assert.match(rec.text, /decks: Slowking Toolbox \(v2\) — 60 cards/)
  assert.match(rec.text, /showScreen: panel drawn, 3 block\(s\)/)
})

test('THE PANEL IS IN THE RECORD — this is the bug', () => {
  // The whole point. On the leg after a `flyTo`, this line is the only thing
  // that tells him a panel already exists. Without it he redraws the answer in
  // prose, which is what the reader actually saw happen.
  const rec = lookupRecord([
    call({
      name: 'showScreen',
      summary: 'panel drawn, 3 block(s) — the user can see it; do not repeat it in words',
    }),
  ])
  assert.ok(rec)
  assert.match(rec.text, /do not repeat it in words/)
})

test('nothing finished means nothing to replay', () => {
  assert.equal(lookupRecord([]), null)
  // A call still in flight is not evidence that anything was found.
  assert.equal(lookupRecord([call({ name: 'decks', phase: 'start', summary: undefined })]), null)
  // Nor is one that failed — its summary is an error message, and replaying it
  // as a lookup would present a failure as a finding.
  assert.equal(lookupRecord([call({ name: 'decks', phase: 'error' })]), null)
  // A summary-less `ok` has nothing to say.
  assert.equal(lookupRecord([call({ name: 'health', summary: undefined })]), null)
})

test('an animation gets a row but is not replayed as evidence', () => {
  // The block says "you actually ran these, so the figures in them are real".
  // `express` looked nothing up, so listing it there is a category error — and
  // one that would reach the prompt on every leg of every turn that used it.
  assert.equal(lookupRecord([call({ name: 'express', summary: 'applied 2 command(s)' })]), null)
  // `showScreen` is not a lookup either and IS replayed, on purpose: it is the
  // line that tells the next leg a panel already exists.
  const mixed = lookupRecord([
    call({ name: 'express', summary: 'applied 2 command(s)' }),
    call({ name: 'showScreen', summary: 'panel drawn, 3 block(s)' }),
  ])
  assert.ok(mixed)
  assert.doesNotMatch(mixed.text, /express/)
  assert.match(mixed.text, /showScreen/)
})

test('a partial is replayed AND labelled, never quietly promoted', () => {
  const rec = lookupRecord([
    call({ name: 'collection_summary', phase: 'partial', summary: 'read 410 cards', reason: 'timeout' }),
  ])
  assert.ok(rec)
  assert.match(rec.text, /read 410 cards/, 'the reading really happened')
  assert.match(rec.text, /INCOMPLETE/, 'and it did not finish')
  assert.match(rec.text, /ran out of time/)
  const truncated = lookupRecord([
    call({ name: 'search_cards', phase: 'partial', summary: 'first 200 rows', reason: 'truncated' }),
  ])
  assert.match(truncated!.text, /ran out of room/)
})

// ── freshCalls ──────────────────────────────────────────────────────────────

const withId = (id: string, over: Partial<RecordedCall> = {}) => ({
  id,
  name: 'decks',
  phase: 'ok',
  summary: 's',
  ...over,
})

test('a leg replays only what it added', () => {
  // Chips live on the reply message for the WHOLE turn, so replaying all of
  // them each leg would send leg 1's lookups again on leg 2 and a third time on
  // leg 3 — the same reading arriving three times reads as three readings,
  // which is the drift this record exists to prevent.
  const seen = new Set<string>()
  const leg1 = freshCalls([withId('a'), withId('b')], seen)
  assert.deepEqual(leg1.send.map((c) => c.id), ['a', 'b'])
  for (const id of leg1.mark) seen.add(id)

  const leg2 = freshCalls([withId('a'), withId('b'), withId('c')], seen)
  assert.deepEqual(leg2.send.map((c) => c.id), ['c'], 'a and b were already carried')
})

test('an unfinished call stays eligible until its result lands', () => {
  // `start` is seen but not recorded, so when the same call comes back `ok` on
  // a later leg it is still replayed. Marking on sight would lose it for good.
  const seen = new Set<string>()
  const first = freshCalls([withId('a', { phase: 'start', summary: undefined })], seen)
  assert.equal(first.send.length, 1)
  assert.deepEqual(first.mark, [], 'nothing to record yet')
  for (const id of first.mark) seen.add(id)

  const second = freshCalls([withId('a', { phase: 'ok', summary: 'read 60 cards' })], seen)
  assert.deepEqual(second.send.map((c) => c.id), ['a'], 'the finished result still gets through')
  assert.deepEqual(second.mark, ['a'])
})

test('what freshCalls sends is what lookupRecord can use', () => {
  // The two halves have to agree: a call marked as replayed must be one that
  // actually reached the record, or evidence goes missing at the seam.
  const seen = new Set<string>()
  const { send, mark } = freshCalls(
    [withId('a'), withId('b', { phase: 'error', summary: 'boom' })],
    seen,
  )
  const rec = lookupRecord(send)
  assert.ok(rec)
  assert.match(rec.text, /decks: s/)
  assert.deepEqual(mark, ['a'], 'the failure is neither recorded nor marked, so it cannot be lost')
})

// ── failureParts ────────────────────────────────────────────────────────────
//
// Each test below was run RED against a mutated implementation and restored:
// the `phase === 'error'` filter widened to every chip, the summary-present
// guard dropped, `MAX_REPLAYED_FAILURES` removed, and `args` stopped riding
// along.

/** A failed chip, in the shape `useDeckeChat`'s `ToolChip` really carries. */
const failed = (over: Partial<FailedCall> & { name: string; id: string }): FailedCall => ({
  phase: 'error',
  summary: 'battle_logs failed: Internal server error',
  ...over,
})

test('a failed call replays as the SDK\'s own output-error part, not as prose', () => {
  // `battle_logs` 500ed on four turns of one conversation and was re-called on
  // every one of them, because nothing carried the failure past the turn
  // boundary. The part shape is what `convertToModelMessages` reads: it becomes
  // a tool-call plus an error-text tool-result, so the model sees the failed
  // call it made rather than a sentence about one.
  const [part, ...rest] = failureParts([failed({ name: 'battle_logs', id: 'c1', args: { deck_id: 'd1' } })])
  assert.equal(rest.length, 0)
  assert.equal(part.type, 'tool-battle_logs')
  assert.equal(part.toolCallId, 'c1')
  assert.equal(part.state, 'output-error')
  assert.equal(part.errorText, 'battle_logs failed: Internal server error')
  // ARGS RIDE ALONG. A tool-call with no input is a call the model cannot
  // recognise as the one it made.
  assert.deepEqual(part.input, { deck_id: 'd1' })
})

test('only failures are replayed, and only ones that say something', () => {
  const parts = failureParts([
    failed({ name: 'battle_logs', id: 'c1' }),
    failed({ name: 'decks', id: 'c2', phase: 'ok', summary: 'Slowking Toolbox (v3) — 60 cards' }),
    failed({ name: 'decks', id: 'c3', phase: 'start', summary: undefined }),
    // An error with no summary says nothing; replaying it as an empty failure
    // is a fact with no content and costs the same tokens.
    failed({ name: 'get_card', id: 'c4', summary: '   ' }),
  ])
  assert.deepEqual(parts.map((p) => p.type), ['tool-battle_logs'])
})

test('the payload is bounded — a turn that flailed cannot dominate the window', () => {
  // Every part here is re-billed on every leg of every later turn. One failure
  // per turn is already enough for the breaker, which counts distinct TURNS.
  const many = Array.from({ length: 12 }, (_, i) => failed({ name: 'battle_logs', id: `c${i}` }))
  assert.equal(failureParts(many).length, MAX_REPLAYED_FAILURES)
})

test('no failures means no parts at all', () => {
  assert.deepEqual(failureParts([]), [])
  assert.deepEqual(failureParts([failed({ name: 'decks', id: 'c1', phase: 'ok' })]), [])
})
