/**
 * The after-turn audit's decisions, and its guarantee: with no answer, null —
 * which `api/chat.mjs` reads as today's guard chain, exactly.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JEV_VAR, type Answer } from '../jev.js'
import {
  AUDIT_QUESTIONS,
  CORRECTIVE_TOOLS,
  auditFrom,
  auditTurn,
  correctiveInstruction,
  turnToolNames,
  type AuditKey,
} from '../audit.js'
import { allTools } from '@deckpal/agent-tools'

const claims = (p: number, kind: string, kp = 0.95): Record<AuditKey, Answer> => ({
  claims_action: { type: 'boolean', probability: p },
  action: { type: 'choice', choice: kind, probabilities: { [kind]: kp }, confidence: kp },
})

test('no answer is null, and null is today', () => {
  assert.equal(auditFrom(null, []), null)
  assert.equal(auditFrom(undefined, ['search_cards']), null)
})

test('a claimed change with no acting tool is a phantom of that kind', () => {
  assert.deepEqual(auditFrom(claims(0.95, 'list'), ['collection_value']), { phantom: 'list' })
  assert.deepEqual(auditFrom(claims(0.9, 'collection'), ['search_cards']), { phantom: 'collection' })
  for (const kind of ['list_deleted', 'deck_deleted', 'battle_log_deleted']) {
    assert.deepEqual(auditFrom(claims(0.95, kind), ['decks']), { phantom: kind })
  }
})

test('any acting tool in the turn means the flow worked, whatever the reply says', () => {
  // "Confirm it on the card and I'll log it" beside a held log_cards is right,
  // and so is "Done: 1 → 2" on the leg where an approved write just ran.
  assert.deepEqual(auditFrom(claims(0.99, 'collection'), ['log_cards']), { phantom: null })
  assert.deepEqual(auditFrom(claims(0.99, 'navigation'), ['search_cards', 'goTo']), { phantom: null })
})

test('below the claim threshold, or an unsure kind, is not a phantom', () => {
  // The eval's strongest wrong claim (a held log_cards) was 0.73 — excluded
  // above by the acting tool; its weakest true claim was 0.71.
  assert.deepEqual(auditFrom(claims(0.4, 'list'), []), { phantom: null })
  assert.deepEqual(auditFrom(claims(0.9, 'list', 0.5), []), { phantom: null })
  assert.deepEqual(auditFrom(claims(0.9, 'none'), []), { phantom: null })
})

test('only writes that hold for a signed card are corrected; the rest are admitted', () => {
  const writes = new Map(allTools().map((d) => [d.name, !d.annotations.readOnlyHint]))
  for (const [kind, tool] of Object.entries(CORRECTIVE_TOOLS)) {
    assert.equal(writes.get(tool), true, `${kind} → ${tool} is not an approval-gated write`)
  }
  assert.equal(CORRECTIVE_TOOLS.guide, undefined, 'a guide is a paid deep call; never forced')
  assert.equal(CORRECTIVE_TOOLS.navigation, undefined, 'a walk has no card, and a forced goTo would invent a route')
  for (const kind of ['list_deleted', 'deck_deleted', 'battle_log_deleted']) {
    assert.equal(CORRECTIVE_TOOLS[kind], undefined, `${kind} must get the admission, never an edit tool`)
  }
  assert.match(correctiveInstruction('log_cards'), /Call log_cards now[\s\S]*do not describe it as done/)
})

test('this turn\'s earlier legs count as performed', () => {
  const said = (text: string) => ({ role: 'assistant', parts: [{ type: 'text', text }] })
  const msgs = [
    said('Earlier turn.'),
    { role: 'assistant', parts: [{ type: 'tool-edit_list', state: 'output-available' }] },
    { role: 'user', parts: [{ type: 'text', text: 'add one Charizard ex' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'Here it is.' }, { type: 'tool-log_cards', state: 'approval-responded' }] },
  ]
  // Only after the reader's latest message: an earlier turn's edit_list is not this turn's.
  assert.deepEqual(turnToolNames(msgs), ['log_cards'])
})

test('auditTurn asks the shipped questions about the reply, and fails open', async () => {
  const before = process.env[JEV_VAR]
  process.env[JEV_VAR] = 'on'
  try {
    let sent: { state?: unknown; questions?: object } = {}
    const ok = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ answers: claims(0.95, 'list') }), { status: 200 })
    }) as never
    const verdict = await auditTurn({ message: 'make me a list', reply: "I'm creating the list now!", toolsRun: [], key: 'k', fetchImpl: ok })
    assert.deepEqual(verdict, { phantom: 'list' })
    assert.deepEqual(Object.keys(sent.questions!), Object.keys(AUDIT_QUESTIONS))
    assert.deepEqual(sent.state, { reader_message: 'make me a list', deckes_reply: "I'm creating the list now!" })
    const down = (async () => new Response('', { status: 503 })) as never
    assert.equal(await auditTurn({ message: 'm', reply: 'r', toolsRun: [], key: 'k', fetchImpl: down }), null)
    // Nothing said is nothing to audit — no call at all.
    let called = 0
    assert.equal(await auditTurn({ message: 'm', reply: '  ', toolsRun: [], key: 'k', fetchImpl: (async () => { called++ }) as never }), null)
    assert.equal(called, 0)
  } finally {
    if (before === undefined) delete process.env[JEV_VAR]
    else process.env[JEV_VAR] = before
  }
})
