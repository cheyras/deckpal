/**
 * The reflex read's decisions, at the thresholds the eval chose, and its one
 * guarantee: with no answer, today's harness exactly.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JEV_VAR, type Answer } from '../jev.js'
import { NO_REFLEX, REFLEX_QUESTIONS, THRESHOLDS, readReflex, readerLeg, reflexFrom, type ReflexKey } from '../reflex.js'

const choice = (c: string, p: number, confidence: number | null = p): Answer => ({
  type: 'choice',
  choice: c,
  probabilities: { [c]: p },
  confidence,
})
const bool = (probability: number): Answer => ({ type: 'boolean', probability })

const answers = (o: Partial<Record<ReflexKey, Answer>> = {}): Record<ReflexKey, Answer> => ({
  intent: choice('something_else', 0.9),
  destination: choice('none', 0.95),
  declines_research: bool(0.02),
  declines_guide: bool(0.02),
  ...o,
})

test('no answer is today\'s harness, exactly', () => {
  assert.deepEqual(reflexFrom(null), NO_REFLEX)
  assert.deepEqual(reflexFrom(undefined), { force: null, hide: [], declines: { research: false, guide: false } })
  assert.deepEqual(reflexFrom(answers()), NO_REFLEX)
})

test('a collection change forces log_cards — down to the least certain positive the eval saw', () => {
  // The eval's weakest true positive was "add one Charizard ex from Obsidian
  // Flames" at p 0.56, confidence 0.44; its strongest negative was 0.30.
  assert.equal(reflexFrom(answers({ intent: choice('change_collection', 0.56, 0.44) })).force, 'log_cards')
  assert.equal(reflexFrom(answers({ intent: choice('change_collection', 0.3, 0.2) })).force, null)
  assert.ok(THRESHOLDS.force.p > 0.3 && THRESHOLDS.force.p <= 0.56)
})

test('nothing but a collection change forces anything', () => {
  for (const other of ['preview_collection', 'other_change', 'go_somewhere', 'something_else']) {
    assert.equal(reflexFrom(answers({ intent: choice(other, 1) })).force, null, other)
  }
})

test('escort leaves view only for pages it cannot reach, and only when sure', () => {
  for (const where of ['list', 'deck', 'other_page']) {
    assert.deepEqual(reflexFrom(answers({ destination: choice(where, 0.9, 0.85) })).hide, ['escort'], where)
  }
  assert.deepEqual(reflexFrom(answers({ destination: choice('set_or_series', 1) })).hide, [])
  assert.deepEqual(reflexFrom(answers({ destination: choice('none', 1) })).hide, [])
  // "add Charizard ex to my Fire deck" read as destination=deck at 0.76 in the
  // eval, while asking to go nowhere; it must not reach the threshold.
  assert.deepEqual(reflexFrom(answers({ destination: choice('deck', 0.76, 0.7) })).hide, [])
})

test('a spoken no is heard above the threshold and not below it', () => {
  assert.deepEqual(reflexFrom(answers({ declines_research: bool(0.92) })).declines, { research: true, guide: false })
  assert.deepEqual(reflexFrom(answers({ declines_guide: bool(0.95) })).declines, { research: false, guide: true })
  // The eval's strongest wrong guide decline ("skip the research…") was 0.55.
  assert.deepEqual(reflexFrom(answers({ declines_guide: bool(0.55) })).declines, { research: false, guide: false })
})

test('the reader\'s latest words are read on every leg; only their own leg is not a continuation', () => {
  const said = (text: string) => ({ role: 'assistant', parts: [{ type: 'text', text }] })
  const asked = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] })
  assert.deepEqual(readerLeg([said('Want me to add it?'), asked('yes')]), { message: 'yes', previousReply: 'Want me to add it?', continuation: false })
  assert.deepEqual(readerLeg([asked('add a Pikachu')]), { message: 'add a Pikachu', previousReply: '', continuation: false })
  // An approval or browser-result leg ends on the assistant, and is still
  // governed by what the reader said at the start of the turn.
  const approvalLeg = [said('Earlier.'), asked('add a Pikachu'), { role: 'assistant', parts: [{ type: 'tool-log_cards', state: 'approval-responded' }] }]
  assert.deepEqual(readerLeg(approvalLeg), { message: 'add a Pikachu', previousReply: 'Earlier.', continuation: true })
  assert.equal(readerLeg([{ role: 'user', parts: [{ type: 'tool-x' }] }]), null)
  assert.equal(readerLeg([said('hello')]), null)
})

test('a continuation keeps the refusals and the hidden walk, and never forces (Astra, PR review)', async () => {
  const before = process.env[JEV_VAR]
  process.env[JEV_VAR] = 'on'
  try {
    const judged = answers({
      intent: choice('change_collection', 0.99),
      destination: choice('deck', 0.95, 0.9),
      declines_research: bool(0.97),
    })
    const ok = (async () => new Response(JSON.stringify({ answers: judged }), { status: 200 })) as never
    const first = [{ role: 'user', parts: [{ type: 'text', text: 'stop researching the meta; just open my deck' }] }]
    const afterGoTo = [...first, { role: 'assistant', parts: [{ type: 'tool-goTo', state: 'output-available', input: {}, output: { ok: true } }] }]
    assert.deepEqual(await readReflex(first, '/', { key: 'k', fetchImpl: ok }), { force: 'log_cards', hide: ['escort'], declines: { research: true, guide: false } })
    assert.deepEqual(await readReflex(afterGoTo, '/decks', { key: 'k', fetchImpl: ok }), { force: null, hide: ['escort'], declines: { research: true, guide: false } })
  } finally {
    if (before === undefined) delete process.env[JEV_VAR]
    else process.env[JEV_VAR] = before
  }
})

test('readReflex asks the shipped questions and fails open', async () => {
  const before = process.env[JEV_VAR]
  process.env[JEV_VAR] = 'on'
  try {
    let asked: Record<string, unknown> = {}
    const ok = (async (_u: string, init: RequestInit) => {
      asked = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ answers: answers({ intent: choice('change_collection', 0.99) }) }), { status: 200 })
    }) as never
    const msgs = [{ role: 'user', parts: [{ type: 'text', text: 'add one Charizard ex' }] }]
    assert.equal((await readReflex(msgs, '/decks', { key: 'k', fetchImpl: ok })).force, 'log_cards')
    assert.deepEqual(Object.keys(asked.questions as object), Object.keys(REFLEX_QUESTIONS))
    assert.deepEqual(asked.state, { reader_latest_message: 'add one Charizard ex', deckes_previous_reply: '', current_page: '/decks' })
    const down = (async () => { throw new TypeError('fetch failed') }) as never
    assert.deepEqual(await readReflex(msgs, '/', { key: 'k', fetchImpl: down }), NO_REFLEX)
  } finally {
    if (before === undefined) delete process.env[JEV_VAR]
    else process.env[JEV_VAR] = before
  }
})
