/**
 * The analysis eval's free half: the cases are sound and agree with their logs,
 * the guard keeps the agent to reads on the QA account, the budget stops a call
 * before it is made, and the scoring adds up. Needs @deckpal/sim built (the log
 * parser is read from its dist/). No network, no model, no money.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  BudgetExceeded,
  CONFIGS,
  Ceiling,
  LEDGER_FILE,
  Ledger,
  REQUEST_OVERHEAD_TOKENS,
  Mcp,
  ROOT,
  aggregate,
  allowCall,
  assertQaAccount,
  cacheNewest,
  checkLog,
  evidenceText,
  formatReport,
  loadEval,
  loadParser,
  maxCallUsd,
  metered,
  parseArgs,
  readLog,
  readRows,
  reviewText,
  runCase,
  scoreRun,
  validateEval,
} from '../analysis-eval.mjs'

/** Per-token prices for the mocks: $1 in, $5 out per million. */
const PRICE = { input: 1e-6, output: 5e-6 }
const PRICES = { 'anthropic/claude-haiku-5.5': PRICE, 'anthropic/claude-sonnet-5.5': PRICE }

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
  const edit = { name: 'edit_battle_log', annotations: { readOnlyHint: false } }
  assert.equal(allowCall(edit, { deck_id: 'd', log_id: 41, review: 'r', dry_run: false }, ids), true)
  assert.equal(allowCall(edit, { log_id: 40, review: 'r' }, ids), false, 'another log')
  // Fields a later config would read are never the agent's to change (Astra, #347).
  assert.equal(allowCall(edit, { log_id: 41, review: 'r', result: 'win' }, ids), false)
  assert.equal(allowCall(edit, { log_id: 41, notes: 'mine now' }, ids), false)
  assert.equal(allowCall(edit, { log_id: 41, opponent_deck: 'x' }, ids), false)
  assert.equal(allowCall({ name: 'delete_deck', annotations: { readOnlyHint: false } }, {}, ids), false)
  assert.equal(allowCall({ name: 'save_deck' }, {}, ids), false, 'no annotation is not read-only')
})

test('only THE QA account passes: pinned username, explicitly not the owner, nothing missing', async () => {
  const fake = (body) => async () => ({ ok: true, json: async () => body })
  const qa = { base: 'x', token: 't', username: 'qa' }
  assert.equal(await assertQaAccount(qa, fake({ username: 'qa', isOwner: false, owner: false })), 'qa')
  await assert.rejects(assertQaAccount(qa, fake({ username: 'qa', isOwner: true, owner: true })), /not provably a non-owner/)
  await assert.rejects(assertQaAccount(qa, fake({ username: 'qa' })), /not provably a non-owner/, 'missing flags are a refusal')
  await assert.rejects(assertQaAccount(qa, fake({ username: 'someone', isOwner: false, owner: false })), /does not belong to the QA account/)
  await assert.rejects(assertQaAccount(qa, fake({ isOwner: false, owner: false })), /does not belong to the QA account/)
  await assert.rejects(assertQaAccount({ base: 'x', token: 't', username: '' }, fake({ username: 'qa', isOwner: false, owner: false })), /QA_USERNAME/)
})

test('every case log is committed, not ignored', () => {
  for (const c of data.cases) {
    let ignored = true
    try {
      execFileSync('git', ['check-ignore', '-q', c.log], { cwd: ROOT, stdio: 'ignore' })
    } catch {
      ignored = false
    }
    assert.equal(ignored, false, `${c.log} is gitignored, so a clean checkout would not have it`)
  }
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

/** The input-token bound maxCallUsd used, recovered from its price at $1/token in, $0 out. */
const boundTokens = (params) => maxCallUsd({ input: 1, output: 0 }, params)

test('a call\'s ceiling: one token per request byte plus the provider\'s overhead, at the dearest rate, plus the output cap', () => {
  const params = { prompt: [{ role: 'user', content: 'x'.repeat(1000) }], tools: [], maxOutputTokens: 1000 }
  const bytes = Buffer.byteLength(JSON.stringify({ prompt: params.prompt, tools: [], toolChoice: null, responseFormat: null }), 'utf8')
  assert.equal(boundTokens(params), bytes + REQUEST_OVERHEAD_TOKENS)
  assert.equal(maxCallUsd(PRICE, params), (bytes + REQUEST_OVERHEAD_TOKENS) * 1e-6 + 1000 * 5e-6)
  assert.equal(maxCallUsd({ ...PRICE, cacheWrite: 2e-6 }, params), (bytes + REQUEST_OVERHEAD_TOKENS) * 2e-6 + 1000 * 5e-6, 'cache writes are the dearest input')
})

test('the bound never undercounts what the provider bills (Astra, #347)', () => {
  // Anthropic's token-counting example: one get_weather tool and one question bill 403 input tokens.
  const weather = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: "What's the weather like in San Francisco?" }] }],
    tools: [{ type: 'function', name: 'get_weather', description: 'Get the current weather in a given location', inputSchema: { type: 'object', properties: { location: { type: 'string', description: 'The city and state, e.g. San Francisco, CA' } }, required: ['location'] } }],
  }
  assert.ok(boundTokens(weather) >= 403, `${boundTokens(weather)} < 403`)
  // Text that tokenizes worst (emoji, CJK) is counted by its bytes, never its characters.
  const emoji = { prompt: [{ role: 'user', content: '😀'.repeat(500) }] }
  assert.ok(boundTokens(emoji) >= 2000 + REQUEST_OVERHEAD_TOKENS)
  // The judge's response schema is part of the request.
  const plain = { prompt: [{ role: 'user', content: 'grade this' }] }
  const schema = { ...plain, responseFormat: { type: 'json', schema: { type: 'object', properties: { items: { type: 'array' } } } } }
  assert.ok(boundTokens(schema) > boundTokens(plain))
})

test('the ceiling holds: a call that COULD exceed what is left is refused before it is made', async () => {
  const { MockLanguageModelV4 } = await import('ai/test')
  const { generateText } = await import('ai')
  let called = 0
  // Astra's case on #347: this call settles at $0.20 under a $0.08 budget. It must never be sent.
  const base = new MockLanguageModelV4({ doGenerate: async () => { called++; return { ...reply([{ type: 'text', text: 'x' }]), providerMetadata: { gateway: { cost: '0.20' } } } } })
  const dear = { input: 1e-6, output: 15e-6 } // 16k output cap alone is $0.24
  const model = await metered(base, dear, new Ceiling(0.08), [], 't')
  await assert.rejects(generateText({ model, prompt: 'p', maxOutputTokens: 16_000 }), BudgetExceeded)
  assert.equal(called, 0)

  // Within the ceiling it runs, and settles at the Gateway's figure.
  const budget = new Ceiling(1)
  const calls = []
  const ok = await metered(base, dear, budget, calls, 't')
  await generateText({ model: ok, prompt: 'p', maxOutputTokens: 16_000 })
  assert.equal(called, 1)
  assert.equal(budget.spentUsd, 0.2)
  assert.equal(budget.reservedUsd, 0)
})

test('a call with no reported cost counts its whole reservation', () => {
  const b = new Ceiling(1)
  const r = b.reserve(0.3)
  b.settle(r, null)
  assert.equal(b.spentUsd, 0.3)
  assert.equal(b.unknownCost, 1)
  assert.equal(b.reserve(0.71), null)
})

test('the ceiling starts from earlier invocations\' spend, and a call over its bound stops everything', () => {
  const resumed = new Ceiling(1, 0.9)
  assert.equal(resumed.reserve(0.2), null)
  assert.equal(resumed.reserve(0.05), 0.05)
  const b = new Ceiling(10)
  b.settle(b.reserve(0.1), 0.15)
  assert.equal(b.overruns, 1)
  assert.equal(b.reserve(0.01), null, 'a broken bound is never trusted again')
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
  const run = await runCase({ gateway, prices: PRICES, mcp, session: fakeSession(), config: { key: 'B', ...CONFIGS.B }, c, ids, deckName: 'Deck (eval)', budget: new Ceiling(1), calls })
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
  assert.deepEqual(calls.map((e) => e.kind), ['reserve', 'settle', 'reserve', 'settle', 'reserve', 'settle'], 'each call reserved before it is sent')
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

test('an errored or unjudged run is counted apart, never scored as a review that missed everything', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-eval-'))
  try {
    const put = (f, x) => fs.writeFileSync(path.join(dir, f), JSON.stringify(x))
    const run = (id, k, extra = {}) => ({ case: id, config: k, steps: 3, error: null, ...extra })
    const all = (c) => ({ items: c.rubric.map((r) => ({ id: r.id, verdict: 'caught' })), false_claims: [] })
    const c101 = data.cases.find((x) => x.id === 'owner-101')
    put('owner-101.A.run.json', run('owner-101', 'A'))
    put('owner-101.A.judge.json', { status: 'ok', output: all(c101) })
    put('owner-95.A.run.json', run('owner-95', 'A'))
    put('owner-95.A.judge.json', { status: 'failed', error: { message: 'budget' } })
    put('owner-99.A.run.json', run('owner-99', 'A'))
    put('owner-100.A.run.json', run('owner-100', 'A', { error: { message: 'boom' } }))
    // Invocations into the same directory: every attempt stays in the ledger.
    const call = (ledger, id, label, reservedUsd, costUsd) => {
      ledger.push({ kind: 'reserve', id, label, reservedUsd })
      if (costUsd !== undefined) ledger.push({ kind: 'settle', id, label, ok: costUsd !== null, costUsd, reservedUsd })
    }
    const first = new Ledger(path.join(dir, LEDGER_FILE))
    call(first, 'a1', 'owner-101:A:agent', 0.5, 0.2) // an attempt that later errored
    call(first, 'j1', 'owner-101:A:judge', 0.04, null) // a judge call with no reported cost
    call(first, 'k1', 'owner-99:B:agent', 0.3) // killed mid-call: reserved, never settled, no run file
    const resumed = new Ledger(path.join(dir, LEDGER_FILE))
    assert.equal(resumed.entries.length, 5, 'a resumed ledger starts from the file')
    call(resumed, 'a2', 'owner-101:A:agent', 0.5, 0.3) // the retry
    call(resumed, 'j2', 'owner-101:A:judge', 0.1, 0.05) // the re-judge
    call(resumed, 'a3', 'owner-95:A:agent', 0.5, 0.1)
    assert.equal(Number(resumed.countedUsd().toFixed(6)), 0.99, 'reported charges, plus unpriced and in-flight reservations at their bound')
    assert.equal(resumed.overruns(), 0)
    const rows = readRows(dir, data.cases)
    const agg = aggregate(rows, data.principles)
    assert.equal(agg.A.runs, 4)
    assert.equal(agg.A.judged, 1)
    assert.equal(agg.A.unjudged, 2)
    assert.equal(agg.A.errors, 1)
    assert.equal(agg.A.overall, 100, 'only the judged run is scored')
    assert.equal(agg.A.costUsd, 0.65, 'every attempt is paid for: 0.2 + 0.3 + 0.05 + 0.1')
    assert.equal(agg.A.unpricedUsd, 0.04)
    assert.equal(agg.B.runs, 1, 'spend with no run file is an interrupted run')
    assert.equal(agg.B.errors, 1)
    assert.equal(agg.B.unpricedUsd, 0.3, 'counted at its whole reservation')
    const report = formatReport(agg, data.principles, rows)
    assert.match(report, /\| owner-95 \| A \| not judged/)
    assert.match(report, /\| owner-100 \| A \| error: boom/)
    assert.match(report, /\| owner-99 \| B \| error: interrupted/)
    assert.match(report, /1 \/ 1 \/ 2/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an overrun in the ledger survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-eval-'))
  try {
    const l = new Ledger(path.join(dir, LEDGER_FILE))
    l.push({ kind: 'reserve', id: 'x', label: 'owner-94:C:agent', reservedUsd: 0.1 })
    l.push({ kind: 'settle', id: 'x', label: 'owner-94:C:agent', ok: true, costUsd: 0.12, reservedUsd: 0.1 })
    const again = new Ledger(path.join(dir, LEDGER_FILE))
    assert.equal(again.overruns(), 1)
    assert.equal(new Ceiling(10, again.countedUsd(), again.overruns()).reserve(0.01), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a paid run demands a cap; unknown configs and options are refused', () => {
  assert.throws(() => parseArgs(['run']), /--budget/)
  assert.throws(() => parseArgs(['run', '--budget', '5', '--configs', 'A,Z']), /unknown config/)
  assert.throws(() => parseArgs(['run', '--budget', '5', '--repeat', '2']), /unknown option/)
  assert.throws(() => parseArgs(['report']), /--out/)
  assert.deepEqual(parseArgs(['run', '--budget', '5']).configs, ['A', 'B', 'C'])
})
