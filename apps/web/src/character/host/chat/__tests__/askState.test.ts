import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  askAnnouncement,
  askFromStream,
  askWireParts,
  formatAnswers,
  hasAsk,
  pendingAsk,
  SKIP_TEXT,
  type AskPart,
  type AskQuestion,
} from '../askState.js'

const questions: AskQuestion[] = [
  { header: 'Format', question: 'Which format?', options: [{ label: 'Standard' }, { label: 'Expanded' }] },
  { header: 'Goals', question: 'What matters?', multi: true, options: [{ label: 'Win locally' }, { label: 'Low cost' }, { label: 'Favorites' }] },
]

const ask = (state = 'output-available', next = questions) => ({
  type: 'tool-ask_user',
  toolCallId: 'ask-1',
  state,
  input: { about: 'deck_build', questions: next },
  output: { status: 'shown' },
})

test('pendingAsk finds the newest completed ask on the latest assistant message', () => {
  const replacement = [{ ...questions[0]!, header: 'Budget' }]
  assert.deepEqual(pendingAsk([
    { role: 'user', parts: [{ type: 'text', text: 'Build me a deck' }] },
    { role: 'assistant', parts: [ask('output-available', questions), { type: 'text', text: 'One more thing' }, ask('output-available', replacement)] },
  ]), replacement)
})

test('pendingAsk ignores unfinished calls and any ask followed by a user answer', () => {
  assert.equal(pendingAsk([{ role: 'assistant', parts: [ask('input-available')] }]), null)
  assert.equal(pendingAsk([
    { role: 'assistant', parts: [ask()] },
    { role: 'user', parts: [{ type: 'text', text: 'Format — Standard' }] },
  ]), null)
  assert.equal(pendingAsk([
    { role: 'assistant', parts: [ask()] },
    { role: 'user', parts: [{ type: 'text', text: 'answered' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'Thanks' }] },
  ]), null)
})

test('pendingAsk accepts Deck-E normalized ask parts', () => {
  assert.deepEqual(pendingAsk([{ role: 'assistant', parts: [{ kind: 'ask', state: 'output-available', input: { questions } }] }]), questions)
})

test('formatAnswers handles single, multi, other, and unanswered questions', () => {
  assert.equal(formatAnswers(questions, [
    { selected: ['Standard'] },
    { selected: ['Win locally', 'Low cost'] },
  ]), 'Format — Standard\nGoals — Win locally, Low cost')
  assert.equal(formatAnswers(questions, [
    { selected: ['Standard'], other: '  Gym Leader Challenge  ' },
    undefined,
  ]), 'Format —   Gym Leader Challenge  ')
  assert.equal(formatAnswers(questions, [{ selected: [] }, { selected: [] }]), '')
})

test('SKIP_TEXT is the explicit best-judgment answer', () => {
  assert.equal(SKIP_TEXT, 'Skip those questions — go with your best judgment.')
})

// ── The wire, built from what the stream actually sent (S2) ─────────────────
//
// The defect this pins: the hook rebuilt the input as `{ questions }`, so the
// server's `answeringAsk` never saw `about`. A test that hand-builds the WIRE
// part cannot catch that, so these start from the streamed `tool-input-available`
// input and go through the same two helpers the hook calls on the way in
// (`askFromStream`) and on the way out (`askWireParts`).

/** Exactly what `ask_user` streams: the tool's input, as the model filled it. */
const streamedInput = () => ({ about: 'deck_build', questions })

const stored = (toolCallId = 'ask-1', input: unknown = streamedInput(), output: unknown = { status: 'shown' }): AskPart => {
  const ask = askFromStream(toolCallId, input, output)
  assert.ok(ask, 'a streamed ask_user input was rejected')
  return { kind: 'ask', id: 'part-1', ...ask }
}

test('the streamed input survives storage and replay verbatim, about included', () => {
  const part = stored()
  assert.deepEqual(askWireParts([{ kind: 'text', text: 'One question first.' } as { kind: string }, part]), [{
    type: 'tool-ask_user',
    toolCallId: 'ask-1',
    state: 'output-available',
    input: { about: 'deck_build', questions },
    output: { status: 'shown' },
  }])
  // And the server's reader of it gets the pathway back.
  const wire = askWireParts([part])[0] as { input: { about?: unknown } }
  assert.equal(wire.input.about, 'deck_build')
})

test('an input with no about replays without inventing one', () => {
  const wire = askWireParts([stored('ask-2', { questions })])[0] as { input: Record<string, unknown> }
  assert.deepEqual(wire.input, { questions })
  assert.equal('about' in wire.input, false)
})

test('the stored ask still docks the card', () => {
  assert.deepEqual(pendingAsk([{ role: 'assistant', parts: [stored()] }]), questions)
})

test('askFromStream refuses an input the card cannot render', () => {
  assert.equal(askFromStream('x', undefined, null), null)
  assert.equal(askFromStream('x', null, null), null)
  assert.equal(askFromStream('x', [], null), null)
  assert.equal(askFromStream('x', { about: 'deck_build' }, null), null)
  assert.equal(askFromStream('x', { questions: 'Which format?' }, null), null)
})

test('an ask-only reply still counts as a message (S3)', () => {
  assert.equal(hasAsk([stored()]), true)
  assert.equal(hasAsk([{ kind: 'text' }, { kind: 'tool' }]), false)
  assert.equal(hasAsk([]), false)
})

test('every ask on a message replays, in order', () => {
  const first = stored('ask-a')
  const second = stored('ask-b', { about: 'battle_log', questions: [questions[0]!] })
  const wire = askWireParts([first, { kind: 'screen' }, second])
  assert.deepEqual(wire.map((part) => part.toolCallId), ['ask-a', 'ask-b'])
  assert.deepEqual(wire.map((part) => (part.input as { about?: string }).about), ['deck_build', 'battle_log'])
})

// ── What a screen reader hears when the card docks ──────────────────────────

test('askAnnouncement reads the first question and counts the rest', () => {
  assert.equal(askAnnouncement([questions[0]!]), 'Deck-E asks: Which format?')
  assert.equal(askAnnouncement(questions), 'Deck-E asks: Which format? Plus 1 more question.')
  assert.equal(
    askAnnouncement([...questions, { ...questions[0]!, header: 'Budget' }]),
    'Deck-E asks: Which format? Plus 2 more questions.',
  )
  assert.equal(
    askAnnouncement([{ header: 'Format', question: '  Pick a format  ', options: [] }]),
    'Deck-E asks: Pick a format.',
  )
})

test('askAnnouncement is silent when nothing docked', () => {
  assert.equal(askAnnouncement(null), '')
  assert.equal(askAnnouncement(undefined), '')
  assert.equal(askAnnouncement([]), '')
  assert.equal(askAnnouncement([{ header: 'X', question: '   ', options: [] }]), '')
})
