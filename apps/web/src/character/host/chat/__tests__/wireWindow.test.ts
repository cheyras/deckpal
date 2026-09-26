import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WINDOW_MESSAGES, WINDOW_PRIOR_CHARS, windowPrior } from '../wireWindow'

const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] })
const said = (text: string) => ({ role: 'assistant', parts: [{ type: 'text', text }] })
const chat = (n: number, size = 400) =>
  Array.from({ length: n }, (_, i) => [user(`q${i} ${'q'.repeat(size)}`), said(`a${i} ${'a'.repeat(size)}`)]).flat()

test('a short chat is sent whole, and nobody is told anything', () => {
  const prior = chat(5)
  assert.deepEqual(windowPrior(prior), { messages: prior, dropped: 0 })
})

test('a long chat sends only the newest window, starting on a reader message', () => {
  const { messages, dropped } = windowPrior(chat(40))
  assert.ok(messages.length <= WINDOW_MESSAGES)
  assert.equal(dropped, 80 - messages.length)
  assert.equal(messages[0]!.role, 'user')
  assert.match(String(messages.at(-1)!.parts[0]!.text), /^a39 /, 'the newest exchange must survive')
})

test('wordy history is bounded by characters, and the body stays small however long the chat', () => {
  const { messages } = windowPrior(chat(200, 3_000))
  const chars = messages.reduce((n, m) => n + String(m.parts[0]!.text).length, 0)
  assert.ok(chars <= WINDOW_PRIOR_CHARS)
  assert.ok(JSON.stringify(messages).length < 80_000, 'the prior wire should be far under the 256 KB cap')
})

test('a pasted battle log on the previous turn is still carried, so "yes, log it" works', () => {
  const prior = [...chat(10), user(`my game\n${'Turn '.repeat(10_000)}`), said('Want me to log it?')]
  const { messages } = windowPrior(prior)
  assert.ok(messages.some((m) => String(m.parts[0]!.text).startsWith('my game')))
})

test('tool records count toward the budget by their JSON', () => {
  // A replayed failure has no text part, so a text-only count would call it
  // free. By its JSON it is 40k of the 64k budget, which leaves room for four
  // of the six older messages and not the first exchange.
  const failure = { type: 'tool-battle_logs', toolCallId: 'x', state: 'output-error', input: {}, errorText: 'e'.repeat(40_000) }
  const prior = [...chat(3, 5_000), user('second'), { role: 'assistant', parts: [failure] }]
  const { messages, dropped } = windowPrior(prior)
  assert.equal(dropped, 2)
  assert.equal(messages[0]!.role, 'user')
})

test('a message the server refused as too long is not replayed, and costs no history', () => {
  // The reader pasted something past the part cap, saw "That's more than I can
  // read in one go", and asked something else. That message never reached the
  // model; replaying it would end the window at itself and drop every message
  // before it.
  const prior = [...chat(3), user('x'.repeat(70_000))]
  const { messages, dropped } = windowPrior(prior)
  assert.equal(dropped, 0)
  assert.deepEqual(messages, chat(3))
})
