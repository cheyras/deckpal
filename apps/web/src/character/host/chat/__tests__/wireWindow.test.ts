import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TOOL_RECORD_PREFIX } from '../lookupRecord'
import { BREAKER_PER_TOOL, EVIDENCE_MAX, WINDOW_MESSAGES, WINDOW_PRIOR_CHARS, windowPrior } from '../wireWindow'

const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] })
const said = (text: string) => ({ role: 'assistant', parts: [{ type: 'text', text }] })
const chat = (n: number, size = 400) =>
  Array.from({ length: n }, (_, i) => [user(`q${i} ${'q'.repeat(size)}`), said(`a${i} ${'a'.repeat(size)}`)]).flat()

test('a short chat is sent whole, and nobody is told anything', () => {
  const prior = chat(5)
  assert.deepEqual(windowPrior(prior), { messages: prior, dropped: 0, evidence: [] })
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

const failed = (tool: string, id: string) =>
  ({ type: `tool-${tool}`, toolCallId: id, state: 'output-error', input: {}, errorText: 'Internal server error' })
const recorded = (...lines: string[]) =>
  ({ type: 'text', text: `${TOOL_RECORD_PREFIX} you actually ran these]\n${lines.join('\n')}` })

test('a dropped reply keeps its failures and lookup record as evidence, and nothing else', () => {
  const record = recorded('decks: 2 decks')
  const failure = failed('battle_logs', 'f')
  const early = { role: 'assistant', parts: [{ type: 'text', text: 'Sorry, that failed.' }, record, failure] }
  const { messages, evidence } = windowPrior([user('first'), early, ...chat(20)])
  assert.ok(!messages.includes(early), 'the reply itself has left the window')
  // Records first, the still-open failure last — the order the server replays.
  assert.deepEqual(evidence, [{ role: 'assistant', parts: [record] }, { role: 'assistant', parts: [failure] }])
})

test('an unrecovered failure outlives any number of later lookups (Astra, second pass)', () => {
  // Two failed battle_logs turns, then 36 exchanges of successful decks
  // lookups: a plain "last 24 replies" slice evicted the failures and quietly
  // re-closed the breaker.
  const prior = [
    user('show my battles'), { role: 'assistant', parts: [failed('battle_logs', 'f1')] },
    user('again?'), { role: 'assistant', parts: [failed('battle_logs', 'f2')] },
    ...Array.from({ length: 36 }, (_, i) => [user(`deck ${i}`), { role: 'assistant', parts: [recorded(`decks: deck ${i}`)] }]).flat(),
  ]
  const { evidence } = windowPrior(prior)
  assert.ok(evidence.length <= EVIDENCE_MAX)
  const tail = evidence.slice(-2).map((m) => m.parts[0]!.toolCallId).sort()
  assert.deepEqual(tail, ['f1', 'f2'], 'both failures, last')
  assert.ok(evidence.slice(0, -2).every((m) => !String(m.parts[0]!.text).includes('battle_logs')))
})

test('every open breaker survives, however many tools are failing (Astra, third pass)', () => {
  // Thirteen tools, each failed in two turns, then a long quiet stretch. One
  // message per failure would be 26 and a cap would cut a whole tool; one
  // message per turn DEPTH carries all thirteen in two.
  const tools = Array.from({ length: 13 }, (_, i) => `tool_${String.fromCharCode(97 + i)}`)
  const prior = [0, 1].flatMap((turn) => [user(`q${turn}`), { role: 'assistant', parts: tools.map((t) => failed(t, `${t}-${turn}`)) }])
  const { evidence } = windowPrior([...prior, ...chat(30)])
  const breaker = evidence.filter((m) => m.parts.every((p) => p.state === 'output-error'))
  assert.equal(breaker.length, 2)
  for (const t of tools) {
    assert.equal(breaker.filter((m) => m.parts.some((p) => p.type === `tool-${t}`)).length, 2, `${t} lost a turn`)
  }
})

test('a success resets a tool, and only its own failures since then are carried', () => {
  const prior = [
    user('a'), { role: 'assistant', parts: [failed('battle_logs', 'old')] },
    user('b'), { role: 'assistant', parts: [recorded('battle_logs: 3 logs')] },
    user('c'), { role: 'assistant', parts: [failed('battle_logs', 'new')] },
    ...chat(30),
  ]
  const failures = windowPrior(prior).evidence.flatMap((m) => m.parts).filter((p) => p.state === 'output-error')
  assert.deepEqual(failures, [failed('battle_logs', 'new')])
})

test('a tool that failed in many turns carries at most BREAKER_PER_TOOL of them', () => {
  const prior = Array.from({ length: 10 }, (_, i) => [user(`q${i}`), { role: 'assistant', parts: [failed('battle_logs', `f${i}`)] }]).flat()
  const { evidence } = windowPrior([...prior, ...chat(30)])
  assert.equal(evidence.length, BREAKER_PER_TOOL)
  assert.deepEqual(evidence.map((m) => String(m.parts[0]!.toolCallId)).sort(), ['f6', 'f7', 'f8', 'f9'])
})
