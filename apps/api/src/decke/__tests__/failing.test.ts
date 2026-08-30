/**
 * The cross-turn failing-tool circuit breaker, each test watched failing first.
 *
 * The shapes here are the replayed parts `lookupRecord.ts`'s `failureParts`
 * actually produces, not an approximation of them — the same standard
 * `declined.test.ts` sets for the decline ledger.
 *
 * Every test in this file was run RED against a mutated implementation and
 * restored: `failingTools` counting parts instead of messages, `circuitOpen`'s
 * `>=` flipped to `>`, the `retryAsked` bypass deleted, and the `[[NO_WORK]]`
 * lead removed from `circuitMessage`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CIRCUIT_BUDGET,
  circuitChipSummary,
  circuitMessage,
  circuitOpen,
  circuitOpenLogLine,
  failingTools,
  readerAsksRetry,
} from '../failing.js'

/** What the browser replays for one failed call. */
const failed = (name: string, errorText: string, id = 'c1') => ({
  type: `tool-${name}`,
  toolCallId: id,
  input: { deck_id: 'd1' },
  state: 'output-error',
  errorText,
})

/** A successful call's replayed shape — must never be counted as a failure. */
const ok = (name: string) => ({
  type: `tool-${name}`,
  toolCallId: 'c9',
  input: {},
  state: 'output-available',
  output: 'fine',
})

const msg = (parts: unknown[]) => ({ role: 'assistant', parts })

const ERR = 'battle_logs failed: Internal server error'

test('a failure in one turn is counted once, however many times it failed', () => {
  // THE UNIT IS THE TURN, not the call. One bad turn that retried twice is a
  // hiccup the per-leg repeat ledger already handles; two turns is an outage.
  const counts = failingTools([
    msg([failed('battle_logs', ERR, 'c1'), failed('battle_logs', ERR, 'c2'), failed('battle_logs', ERR, 'c3')]),
  ])
  assert.equal(counts.get('battle_logs'), 1)
})

test('failures in distinct turns accumulate, and successes never count', () => {
  const counts = failingTools([
    msg([failed('battle_logs', ERR)]),
    msg([ok('decks')]),
    msg([failed('battle_logs', ERR), failed('decks', 'decks failed: Internal server error')]),
  ])
  assert.equal(counts.get('battle_logs'), 2)
  assert.equal(counts.get('decks'), 1)
})

test('nothing on the wire means nothing has failed', () => {
  assert.equal(failingTools([]).size, 0)
  assert.equal(failingTools(null).size, 0)
  assert.equal(failingTools([msg([{ type: 'text', text: 'hello' }])]).size, 0)
  // A non-tool part whose type merely mentions a state must not count.
  assert.equal(failingTools([msg([{ type: 'data-decke-tool', state: 'output-error' }])]).size, 0)
})

test('the circuit opens at the budget, not before it', () => {
  // The measured transcript: battle_logs 500ed on turns 2, 4, 5 and 6 and was
  // re-called every time. One failing turn must still be retryable — a single
  // 500 is a hiccup — so the threshold is `>=` on the SECOND distinct turn.
  const one = new Map([['battle_logs', 1]])
  const two = new Map([['battle_logs', CIRCUIT_BUDGET]])
  assert.equal(circuitOpen(one, 'battle_logs'), false)
  assert.equal(circuitOpen(two, 'battle_logs'), true)
  // Never open for a tool that has not failed at all.
  assert.equal(circuitOpen(two, 'decks'), false)
})

test('the reader asking to retry closes an open circuit, and only the reader can', () => {
  const two = new Map([['battle_logs', 4]])
  assert.equal(circuitOpen(two, 'battle_logs', readerAsksRetry('try the logs again')), false)
  assert.equal(circuitOpen(two, 'battle_logs', readerAsksRetry('retry that')), false)
  assert.equal(circuitOpen(two, 'battle_logs', readerAsksRetry('give it another go')), false)
  // Their frustration is not a retry request. This is the exact sentence from
  // the transcript, and reading it as "call it again" is the defect.
  assert.equal(
    circuitOpen(two, 'battle_logs', readerAsksRetry("OK, you tried the same tool call again even though i didn't ask you to")),
    true,
  )
  assert.equal(circuitOpen(two, 'battle_logs', readerAsksRetry('')), true)
  assert.equal(circuitOpen(two, 'battle_logs', readerAsksRetry(undefined)), true)
})

test('readerAsksRetry matches on token boundaries, so "retrying" is not "retry"', () => {
  // Same normalisation `printingSaid.ts` and `declined.ts` use. A substring
  // match would make "we keep retrying and failing" re-open the circuit.
  assert.equal(readerAsksRetry('retry'), true)
  // The sentence the comment names, with no negation in it to do the work
  // instead: a substring match alone re-opens the circuit on this.
  assert.equal(readerAsksRetry('we keep retrying and failing'), false)
  assert.equal(readerAsksRetry('stop retrying it'), false)
  assert.equal(readerAsksRetry('try again please'), true)
  // The object can sit in the middle — "try the logs again".
  assert.equal(readerAsksRetry('try the battle logs again'), true)
  assert.equal(readerAsksRetry('can you pull those logs again'), true)
})

test('readerAsksRetry does not read the reader\'s COMPLAINT as permission', () => {
  // Verbatim from the transcript, both turns. These are the sentences that
  // FOLLOW an unwanted re-call; treating either as "call it again" would
  // reinstate the exact loop the breaker exists to stop.
  assert.equal(
    readerAsksRetry("OK, you tried the same tool call again even though i didn't ask you to"),
    false,
  )
  assert.equal(
    readerAsksRetry('You literally hammered that tool again, then immediately said you won\'t keep hammering that tool'),
    false,
  )
})

test('a negation in front of the retry phrase inverts it', () => {
  // The transcript is full of the reader asking for the OPPOSITE while naming
  // the vocabulary. Reading "don't try again" as permission to call the tool is
  // the exact failure the breaker exists to stop.
  assert.equal(readerAsksRetry('do not try again'), false)
  assert.equal(readerAsksRetry("don't try again"), false)
  assert.equal(readerAsksRetry('stop retrying'), false)
  assert.equal(readerAsksRetry('no more retry attempts'), false)
  // …but a negation about something ELSE must not eat a real retry request.
  assert.equal(readerAsksRetry('the deck list is not loading — try again'), true)
})

test('the refusal leads with [[NO_WORK]] and forbids the two measured behaviours', () => {
  const m = circuitMessage('battle_logs', 4)
  // The prompt rule keys on a result STARTING with the marker.
  assert.ok(m.startsWith('[[NO_WORK]]'), 'the marker must lead or prompt.ts cannot match it')
  assert.match(m, /battle_logs/)
  assert.match(m, /4 separate turns/)
  // (1) say it is down and that it was recorded — the reader's own request.
  assert.match(m, /tooling fault/i)
  // (2) do NOT restate the summary they were given four times.
  assert.match(m, /do NOT restate/i)
  // (3) do not call it again unless THEY ask.
  assert.match(m, /unless they explicitly ask you to retry/i)
  // It must NOT tell him to stop answering: a dead tool is not a reason to
  // stop being useful, which is where this differs from declined.ts's tail.
  assert.doesNotMatch(m, /and stop\./)
})

test('the chip says the call was NOT made — never dressed as a result (X2)', () => {
  const s = circuitChipSummary('battle_logs', 3)
  assert.match(s, /^not called/)
  assert.match(s, /battle_logs/)
  assert.match(s, /3 earlier turns/)
})

test('the log line is one greppable record, and a missing id does not suppress it', () => {
  assert.equal(
    circuitOpenLogLine('battle_logs', 4, 'conv_123'),
    '[decke] tool-circuit-open tool=battle_logs failures=4 conversation=conv_123',
  )
  assert.match(circuitOpenLogLine('battle_logs', 4, undefined), /conversation=unknown$/)
  assert.match(circuitOpenLogLine('battle_logs', 4, '   '), /conversation=unknown$/)
})
