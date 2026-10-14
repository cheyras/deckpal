/**
 * The analysis eval's free half: the cases are sound and agree with their logs,
 * the guard keeps the agent to reads on the QA account, the budget stops a call
 * before it is made, and the scoring adds up. Needs @deckpal/sim built (the log
 * parser is read from its dist/). No network, no model, no money.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BudgetExceeded,
  CONFIGS,
  Mcp,
  aggregate,
  allowCall,
  assertQaAccount,
  cacheNewest,
  checkLog,
  evidenceText,
  loadEval,
  loadParser,
  metered,
  parseArgs,
  readLog,
  reviewText,
  runCase,
  scoreRun,
  validateEval,
} from '../analysis-eval.mjs'
import { Budget } from '../decke-triage-eval.mjs'

const data = loadEval()
const clone = (x) => JSON.parse(JSON.stringify(x))

test('the cases are sound: principles, decks, rubrics, no real handles', () => {
  assert.deepEqual(validateEval(data), [])
  assert.ok(data.cases.filter((c) => c.split === 'owner').length >= 5)
  assert.ok(data.cases.filter((c) => c.split === 'held-out').length >= 3)
})

test('every case states what its log says: result, Prizes, turns, ending, who went first', async () => {
  const parse = await loadParser()
  for (const c of data.cases) assert.deepEqual(checkLog(c, readLog(c), parse), [], c.id)
})

test('the validator catches what would quietly spoil the eval', () => {
  const bad = clone(data)
  bad.cases[0].rubric[0].principle = 'P9'
  bad.cases[1].rubric = bad.cases[1].rubric.map((r) => ({ ...r, must: false }))
  bad.cases[2].notes = 'cheyras said so'
  bad.decks['phantom-puppeteer'].cards[0].count += 1
  const errors = validateEval(bad).join('\n')
  assert.match(errors, /unknown principle P9/)
  assert.match(errors, /no must item/)
  assert.match(errors, /real handle/)
  assert.match(errors, /61 cards/)
})

test('a case whose facts disagree with its log is reported, not trusted', async () => {
  const parse = await loadParser()
  const c = clone(data.cases.find((x) => x.id === 'owner-100'))
  c.facts.prizes = [4, 0]
  c.facts.ending = 'prizes'
  const problems = checkLog(c, readLog(c), parse).join('\n')
  assert.match(problems, /prizes 0-4, case says 4-0/)
  assert.match(problems, /ending timeout, case says prizes/)
})

test('the guard: reads pass, edit_battle_log only on this case\'s log, other writes never leave', () => {
  const ids = { logId: 41, deckId: 'd' }
  assert.equal(allowCall({ name: 'battle_digest', annotations: { readOnlyHint: true } }, {}, ids), true)
  assert.equal(allowCall({ name: 'edit_battle_log', annotations: { readOnlyHint: false } }, { log_id: 41 }, ids), true)
  assert.equal(allowCall({ name: 'edit_battle_log', annotations: { readOnlyHint: false } }, { log_id: 40 }, ids), false)
  assert.equal(allowCall({ name: 'delete_deck', annotations: { readOnlyHint: false } }, {}, ids), false)
  assert.equal(allowCall({ name: 'save_deck' }, {}, ids), false, 'no annotation is not read-only')
})

test('an owner token is refused before anything runs', async () => {
  const fake = (body) => async () => ({ ok: true, json: async () => body })
  await assert.rejects(assertQaAccount({ base: 'x', token: 't' }, fake({ username: 'o', isOwner: true })), /OWNER/)
  assert.equal(await assertQaAccount({ base: 'x', token: 't' }, fake({ username: 'qa', isOwner: false, owner: false })), 'qa')
})

test('MCP replies are read from JSON and from an event stream, with the session kept', async () => {
  const sent = []
  const replies = [
    { body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { instructions: 'be good' } }), session: 's1' },
    { body: '', session: null },
    { body: `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'a' }], nextCursor: 'c' } })}\n\n` },
    { body: JSON.stringify({ jsonrpc: '2.0', id: 3, result: { tools: [{ name: 'b' }] } }) },
    { body: JSON.stringify({ jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: 'hi' }], isError: false } }) },
  ]
  const fetchImpl = async (_url, init) => {
    sent.push({ body: JSON.parse(init.body), session: init.headers['mcp-session-id'] })
    const r = replies.shift()
    return { ok: true, status: 200, headers: { get: () => r.session ?? null }, text: async () => r.body }
  }
  const mcp = new Mcp('https://x', 't', fetchImpl)
  const s = await mcp.init()
  assert.equal(s.instructions, 'be good')
  assert.deepEqual(s.tools.map((t) => t.name), ['a', 'b'])
  assert.deepEqual(await mcp.call('a', {}), { text: 'hi', isError: false })
  assert.equal(sent[1].body.method, 'notifications/initialized')
  assert.equal(sent[3].body.params.cursor, 'c')
  assert.ok(sent.slice(1).every((x) => x.session === 's1'))
})

test('one cache breakpoint, on the newest non-system message', () => {
  const marked = cacheNewest([
    { role: 'system', content: 's', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
    { role: 'user', content: 'u', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
    { role: 'assistant', content: 'a' },
  ])
  assert.ok(marked[0].providerOptions.anthropic.cacheControl, 'the system breakpoint stays')
  assert.equal(marked[1].providerOptions, undefined)
  assert.ok(marked[2].providerOptions.anthropic.cacheControl)
})

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } }
const reply = (content, finish = 'stop') => ({ content, finishReason: { unified: finish, raw: finish }, usage, providerMetadata: { gateway: { cost: '0.01' } }, warnings: [] })

test('the budget stops a call before it is made', async () => {
  const { MockLanguageModelV4 } = await import('ai/test')
  let called = 0
  const base = new MockLanguageModelV4({ doGenerate: async () => { called++; return reply([{ type: 'text', text: 'x' }]) } })
  const calls = []
  const model = await metered(base, new Budget(0.001, { priorCallUsd: 0.05 }), calls, 't')
  const { generateText } = await import('ai')
  await assert.rejects(generateText({ model, prompt: 'p' }), BudgetExceeded)
  assert.equal(called, 0)
})

function fakeSession() {
  return {
    instructions: 'server instructions',
    tools: [
      { name: 'battle_digest', description: 'read', inputSchema: { type: 'object', properties: { log_id: { type: 'integer' } } }, annotations: { readOnlyHint: true } },
      { name: 'delete_deck', description: 'write', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: false } },
    ],
  }
}

test('a run: tool results come from the account, a refused write never reaches it, B\'s writer reads the evidence', async () => {
  const { MockLanguageModelV4 } = await import('ai/test')
  const c = data.cases.find((x) => x.id === 'owner-101')
  const ids = { logId: 7, deckId: 'd' }
  const reached = []
  const mcp = { call: async (name, args) => { reached.push(name); return { text: `digest of #${args.log_id}`, isError: false } } }
  const prompts = []
  const gateway = (id) => {
    let step = 0
    return new MockLanguageModelV4({
      doGenerate: async (opts) => {
        prompts.push({ id, prompt: opts.prompt })
        if (id.includes('sonnet')) return reply([{ type: 'text', text: 'THE REVIEW' }])
        step++
        if (step === 1) return reply([
          { type: 'tool-call', toolCallId: '1', toolName: 'battle_digest', input: JSON.stringify({ log_id: 7 }) },
          { type: 'tool-call', toolCallId: '2', toolName: 'delete_deck', input: '{}' },
        ], 'tool-calls')
        return reply([{ type: 'text', text: 'READY' }])
      },
    })
  }
  const calls = []
  const run = await runCase({ gateway, mcp, session: fakeSession(), config: { key: 'B', ...CONFIGS.B }, c, ids, deckName: 'Deck (eval)', budget: new Budget(1), calls })
  assert.equal(run.error, null)
  assert.deepEqual(reached, ['battle_digest'])
  assert.equal(run.toolCalls.length, 2)
  const refused = run.toolCalls.find((t) => t.name === 'delete_deck')
  assert.equal(refused.isError, true)
  assert.match(refused.text, /not run in this evaluation/)
  assert.equal(run.gatherReply, 'READY')
  assert.equal(run.reply, 'THE REVIEW')
  const writerPrompt = JSON.stringify(prompts.find((p) => p.id.includes('sonnet')).prompt)
  assert.match(writerPrompt, /digest of #7/)
  assert.match(writerPrompt, /server instructions/)
  assert.equal(calls.length, 3)
  assert.match(evidenceText(run.toolCalls), /### \d\. battle_digest\(\{"log_id":7\}\)\ndigest of #7/)
})

test('the judge grades the reply and a saved review that says more', () => {
  assert.equal(reviewText({ reply: 'short', savedReview: 'the long saved review' }), 'short\n\n--- Review saved to the battle log ---\nthe long saved review')
  assert.equal(reviewText({ reply: 'it says: the long saved review', savedReview: 'the long saved review' }), 'it says: the long saved review')
})

test('scores: verdicts per item, per principle, per split, must items apart', () => {
  const c = data.cases.find((x) => x.id === 'owner-101')
  const judged = { items: [{ id: 'hns-blocks-hand', verdict: 'caught' }, { id: 'concession-reason', verdict: 'partial' }], false_claims: [{ claim: 'x', quote: 'y' }] }
  const s = scoreRun(c, judged)
  assert.deepEqual(s.items.map((i) => i.score), [1, 0.5, 0, 0], 'an item the judge skipped is missed')
  const agg = aggregate([{ config: 'A', run: { steps: 4 }, scored: s, costUsd: 0.2 }], data.principles)
  assert.equal(agg.A.overall, 38)
  assert.equal(agg.A.must, 50)
  assert.equal(agg.A.principle.P2, 100)
  assert.equal(agg.A.principle.P4, 50)
  assert.equal(agg.A.principle.P1, null)
  assert.equal(agg.A.falseClaimsPerReview, 1)
})

test('a paid run demands a cap; unknown configs and options are refused', () => {
  assert.throws(() => parseArgs(['run']), /--budget/)
  assert.throws(() => parseArgs(['run', '--budget', '5', '--configs', 'A,Z']), /unknown config/)
  assert.throws(() => parseArgs(['run', '--budget', '5', '--repeat', '2']), /unknown option/)
  assert.throws(() => parseArgs(['report']), /--out/)
  assert.deepEqual(parseArgs(['run', '--budget', '5']).configs, ['A', 'B', 'C'])
})
