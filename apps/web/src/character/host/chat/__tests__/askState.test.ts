import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatAnswers, pendingAsk, SKIP_TEXT, type AskQuestion } from '../askState.js'

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
