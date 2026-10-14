/**
 * DOES A GAME REVIEW CATCH WHAT MATTERS? — the analysis eval (evals/analysis/).
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────
 *
 * An agent is handed DeckPal's MCP tools and server instructions, exactly as
 * claude.ai sees them, and asked to review one real PTCG Live game. A judge
 * model then marks each point of that case's rubric caught, partial or missed,
 * and lists the review's false claims. Every rubric point is tagged with one of
 * six PRINCIPLES (`evals/analysis/principles.json`) — facts come from a source,
 * every surprise has a mechanism, consequences cross the board, the opponent
 * decides, the numbers reconcile, judgments are calibrated — so the report
 * reads per principle, not per card. The owner's own catches are instances of
 * the principles; the HELD-OUT cases are games nobody annotated, there to show
 * whether a fix generalised or only learnt the instances.
 *
 * Configs: A — Haiku 5.5 end to end. B — Haiku 5.5 gathers with the tools, then
 * one Sonnet 5.5 call writes the review from what it gathered. C — Sonnet 5.5
 * at low effort end to end. The judge is Sonnet 5.5 at medium effort.
 *
 * ── IT RUNS AGAINST THE QA ACCOUNT, NEVER THE OWNER'S ───────────────────────
 *
 * The MCP token comes from `.qa-account` (QA_MCP_TOKEN, minted by
 * `scripts/qa-token.mjs`, which the maintainer runs). Before anything else the
 * token's account is read from /api/me and the run REFUSES an owner account.
 * The agent's tool calls run for real on the QA account, but only read tools
 * and `edit_battle_log` on the case's own log; any other write is answered
 * "not run in this eval" without reaching the server. Before each run the
 * case's log is reset (review cleared, notes restored) so one config's saved
 * review cannot leak into the next.
 *
 * ── IT SPENDS MONEY, SO IT HAS A CAP ─────────────────────────────────────────
 *
 * `--budget` (required for `run`) is a hard stop checked before EVERY model
 * call against the Gateway's own reported cost. The key is read from
 * AI_GATEWAY_API_KEY (or DECKE_VERCEL_AI_GATEWAY_KEY) and never printed.
 * `report` re-reads a finished run for free.
 *
 *   node scripts/analysis-eval.mjs check                   # free: cases + logs
 *   node scripts/analysis-eval.mjs setup                   # QA decks + logs
 *   node scripts/analysis-eval.mjs run --budget 5 [--configs A,B,C] [--cases owner-94,…] [--out DIR]
 *   node scripts/analysis-eval.mjs report --out DIR        # free
 *
 * It reads the simulator from `packages/sim/dist/`, so build @deckpal/sim first.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Budget, gatewayCost, safeError } from './decke-triage-eval.mjs'

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const EVAL_DIR = path.join(ROOT, 'evals/analysis')
export const PLAYERS = ['PlayerA', 'PlayerB']
export const VERDICTS = { caught: 1, partial: 0.5, missed: 0 }

const HAIKU = 'anthropic/claude-haiku-5.5'
const SONNET = 'anthropic/claude-sonnet-5.5'
export const CONFIGS = {
  A: { label: 'Haiku 5.5, end to end', agent: { model: HAIKU, effort: 'medium' } },
  B: { label: 'Haiku 5.5 gathers, Sonnet 5.5 writes', agent: { model: HAIKU, effort: 'medium', gatherOnly: true }, writer: { model: SONNET, effort: 'medium' } },
  C: { label: 'Sonnet 5.5 low effort, end to end', agent: { model: SONNET, effort: 'low' } },
}
export const JUDGE = { model: SONNET, effort: 'medium' }
export const MAX_STEPS = 24
/** Deck-E's own all-in ceiling for Haiku and Sonnet 5.5 (adaptive thinking counts toward it). */
export const MAX_OUTPUT_TOKENS = 16_000
/** A first call's reservation before any real cost is known: an agent step with ~20K tokens of tools. */
const FIRST_CALL_USD = 0.08

export const USAGE = `Usage: node scripts/analysis-eval.mjs <check|setup|run|report> [options]
  check                     validate the cases and parse every log (free)
  setup                     create the eval decks and logs on the QA account
  run --budget USD          run the configs on the cases and judge each review
      --configs A,B,C       configs to run (default all)
      --cases id,id         cases to run (default all)
      --out DIR             where runs are written (default evals/analysis/runs/<time>)
  report --out DIR          rebuild the report from a finished run (free)
  --account FILE            the QA account file (default .qa-account at the repo root)`

// ─── Cases ──────────────────────────────────────────────────────────────────

export function loadEval(dir = EVAL_DIR) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  const caseDir = path.join(dir, 'cases')
  const cases = fs.readdirSync(caseDir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(caseDir, f), 'utf8')) }))
  return { principles: read('principles.json'), decks: read('decks.json'), cases }
}

/** Every structural problem with the cases, as sentences; empty when sound. */
export function validateEval({ principles, decks, cases }, root = ROOT) {
  const errors = []
  const ids = new Set()
  const covered = { owner: new Set(), 'held-out': new Set() }
  for (const [key, deck] of Object.entries(decks)) {
    const total = deck.cards.reduce((n, c) => n + c.count, 0)
    if (total !== 60) errors.push(`deck ${key}: ${total} cards, not 60`)
    if (!/\(eval\)$/.test(deck.name)) errors.push(`deck ${key}: name must end "(eval)" so it is never mistaken for a real deck`)
  }
  for (const c of cases) {
    const where = `case ${c.id ?? c.file}`
    if (`${c.id}.json` !== c.file) errors.push(`${where}: id does not match its file name`)
    if (ids.has(c.id)) errors.push(`${where}: duplicate id`)
    ids.add(c.id)
    if (!(c.split in covered)) errors.push(`${where}: split must be owner or held-out`)
    if (!decks[c.deck]) errors.push(`${where}: unknown deck ${c.deck}`)
    if (!c.log || !fs.existsSync(path.join(root, c.log))) errors.push(`${where}: log ${c.log} not found`)
    const f = c.facts ?? {}
    if (!['win', 'loss'].includes(f.result) || !Array.isArray(f.prizes) || !Number.isInteger(f.turns) || !f.ending || !PLAYERS.includes(f.first)) {
      errors.push(`${where}: facts need result, prizes, turns, ending and first`)
    }
    if (c.notes !== null && typeof c.notes !== 'string') errors.push(`${where}: notes must be a string or null`)
    const items = Array.isArray(c.rubric) ? c.rubric : []
    if (items.length === 0) errors.push(`${where}: empty rubric`)
    if (!items.some((r) => r.must)) errors.push(`${where}: no must item`)
    const itemIds = new Set()
    for (const r of items) {
      if (itemIds.has(r.id)) errors.push(`${where}: duplicate rubric id ${r.id}`)
      itemIds.add(r.id)
      if (!principles[r.principle]) errors.push(`${where}: rubric ${r.id} names unknown principle ${r.principle}`)
      if (typeof r.must !== 'boolean' || !r.point?.trim()) errors.push(`${where}: rubric ${r.id} needs must and point`)
      covered[c.split]?.add(r.principle)
    }
    if (!Array.isArray(c.false_claims) || c.false_claims.some((x) => typeof x !== 'string')) errors.push(`${where}: false_claims must be strings`)
    if (/cheyras|\bchey\b/i.test(JSON.stringify(c))) errors.push(`${where}: a real handle survived anonymisation`)
  }
  for (const p of Object.keys(principles)) {
    if (!covered.owner.has(p) && !covered['held-out'].has(p)) errors.push(`principle ${p} is tested by no case`)
  }
  if (covered['held-out'].size < 4) errors.push(`held-out cases cover only ${covered['held-out'].size} principles`)
  return errors
}

export async function loadParser(root = ROOT) {
  const href = pathToFileURL(path.join(root, 'packages/sim/dist/replay/liveLog.js')).href
  return (await import(href)).parseLiveLog
}

export const readLog = (c, root = ROOT) => fs.readFileSync(path.join(root, c.log), 'utf8').replace(/\r\n/g, '\n')

/** Where a case's stated facts disagree with its log, as sentences. */
export function checkLog(c, raw, parseLiveLog) {
  const p = parseLiveLog(raw, { players: PLAYERS })
  const problems = []
  if ([...p.players].sort().join() !== PLAYERS.join()) problems.push(`players are ${p.players.join(', ')}, not PlayerA/PlayerB`)
  if (p.unknown.rate >= 0.01) problems.push(`${p.unknown.count} unknown lines: ${p.unknown.samples.join(' | ')}`)
  const taken = [0, 0]
  for (const e of p.events) if (e.t === 'prize') taken[e.p] += e.count
  const end = p.events.find((e) => e.t === 'game_end')
  const first = p.events.find((e) => e.t === 'go_first')
  const firstName = first ? PLAYERS[first.first ? first.p : 1 - first.p] : null
  const f = c.facts
  if (taken.join('-') !== f.prizes.join('-')) problems.push(`prizes ${taken.join('-')}, case says ${f.prizes.join('-')}`)
  if (p.turns !== f.turns) problems.push(`${p.turns} turns, case says ${f.turns}`)
  if ((end?.reason ?? 'none') !== f.ending) problems.push(`ending ${end?.reason ?? 'none'}, case says ${f.ending}`)
  const result = end ? (end.winner === 0 ? 'win' : 'loss') : null
  if (result !== f.result) problems.push(`result ${result}, case says ${f.result}`)
  if (firstName !== f.first) problems.push(`${firstName} went first, case says ${f.first}`)
  return problems
}

export function selectCases(cases, list) {
  if (!list) return cases
  const want = list.split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = want.filter((id) => !cases.some((c) => c.id === id))
  if (unknown.length) throw new Error(`unknown case(s): ${unknown.join(', ')}`)
  return cases.filter((c) => want.includes(c.id))
}

// ─── The QA account over MCP ────────────────────────────────────────────────

export function readAccount(file) {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing (gitignored; the maintainer has it).`)
  const raw = fs.readFileSync(file, 'utf8')
  const get = (k) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() || ''
  const token = get('QA_MCP_TOKEN')
  if (!token) throw new Error('No QA_MCP_TOKEN in the QA account file. The maintainer runs: node scripts/qa-token.mjs')
  return { token, base: (process.env.DECKPAL_BASE ?? 'https://deckpal.app').replace(/\/$/, '') }
}

/** Streamable-HTTP MCP: JSON or SSE replies, one session. */
export class Mcp {
  constructor(base, token, fetchImpl = fetch) {
    this.base = base
    this.token = token
    this.fetch = fetchImpl
    this.session = null
    this.nextId = 1
  }
  async post(body) {
    const res = await this.fetch(`${this.base}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.session ? { 'mcp-session-id': this.session } : {}),
      },
      body: JSON.stringify(body),
    })
    this.session = res.headers.get('mcp-session-id') ?? this.session
    const text = await res.text()
    if (!res.ok) throw new Error(`MCP ${body.method}: HTTP ${res.status}`)
    if (body.id === undefined) return null
    const data = text.trimStart().startsWith('{') ? text : (text.split('\n').filter((l) => l.startsWith('data:')).pop() ?? '').slice(5)
    const reply = JSON.parse(data)
    if (reply.error) throw new Error(`MCP ${body.method}: ${reply.error.message}`)
    return reply.result
  }
  rpc(method, params = {}) {
    return this.post({ jsonrpc: '2.0', id: this.nextId++, method, params })
  }
  async init() {
    const init = await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'analysis-eval', version: '1' } })
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const tools = []
    let cursor
    do {
      const page = await this.rpc('tools/list', cursor ? { cursor } : {})
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor)
    return { instructions: init.instructions ?? '', tools }
  }
  async call(name, args) {
    const r = await this.rpc('tools/call', { name, arguments: args })
    const text = (r.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n')
    return { text, isError: !!r.isError }
  }
}

/** Refuse any account but a non-owner one: the eval writes logs and reviews. */
export async function assertQaAccount({ base, token }, fetchImpl = fetch) {
  const res = await fetchImpl(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`/api/me: HTTP ${res.status}`)
  const me = await res.json()
  if (me.isOwner === true || me.owner === true) throw new Error('This token belongs to the OWNER account. The eval runs on the QA account only.')
  return me.username
}

const STATE_FILE = path.join(EVAL_DIR, '.qa-state.json')
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
export function readState(file = STATE_FILE) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { decks: {}, logs: {} }
}
function writeState(state, file = STATE_FILE) {
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
}

/** The eval's decks and logs on the QA account; reuses what an earlier setup made. */
export async function setup(mcp, data, cases, { state = readState(), save = writeState, log = console.log } = {}) {
  const decksNeeded = [...new Set(cases.map((c) => c.deck))]
  for (const key of decksNeeded) {
    const deck = data.decks[key]
    const cardsHash = hash(JSON.stringify(deck.cards))
    if (state.decks[key]?.cardsHash === cardsHash) {
      const probe = await mcp.call('decks', { deck_id: state.decks[key].id })
      if (!probe.isError) continue
    }
    const index = await mcp.call('decks', {})
    const line = index.text.split('\n').find((l) => l.startsWith(`${deck.name} | `))
    const cards = deck.cards.map((c) => ({ card_id: c.id, quantity: c.count }))
    const r = line
      ? await mcp.call('save_deck', { mode: 'edit', deck_id: line.split(' | ')[1], cards, dry_run: false })
      : await mcp.call('save_deck', { mode: 'create', name: deck.name, format: 'standard', cards, dry_run: false })
    if (r.isError) throw new Error(`save_deck ${deck.name}: ${r.text}`)
    const id = line ? line.split(' | ')[1] : r.text.match(/deck_id "([0-9a-f-]{36})"/)?.[1]
    if (!id) throw new Error(`save_deck ${deck.name}: no deck id in the reply`)
    state.decks[key] = { id, cardsHash }
    save(state)
    log(`deck ${deck.name}: ${line ? 'updated' : 'created'}`)
  }
  for (const c of cases) {
    const raw = readLog(c)
    const logHash = hash(raw)
    const had = state.logs[c.id]
    const deckId = state.decks[c.deck].id
    if (had?.logHash === logHash && had.deckId === deckId) {
      const probe = await mcp.call('battle_logs', { deck_id: deckId, log_id: had.logId })
      if (!probe.isError) continue
    }
    const r = await mcp.call('add_battle_log', { deck_id: deckId, log: raw, player_name: 'PlayerA', notes: c.notes ?? undefined, dry_run: false })
    if (r.isError) throw new Error(`add_battle_log ${c.id}: ${r.text}`)
    const logId = Number(r.text.match(/Logged battle #(\d+)/)?.[1])
    if (!logId) throw new Error(`add_battle_log ${c.id}: no log id in the reply`)
    state.logs[c.id] = { logId, deckId, logHash }
    save(state)
    log(`log ${c.id}: #${logId}`)
  }
  return state
}

/** Clear any saved review and restore the player's notes, so runs cannot see each other. */
export async function resetLog(mcp, c, ids) {
  const r = await mcp.call('edit_battle_log', { deck_id: ids.deckId, log_id: ids.logId, review: null, notes: c.notes, dry_run: false })
  if (r.isError && !/nothing to change|no change/i.test(r.text)) throw new Error(`reset ${c.id}: ${r.text}`)
}

// ─── The agent ──────────────────────────────────────────────────────────────

export const askFor = (deckName, logId) =>
  `Review battle log #${logId} on my deck "${deckName}": what happened, why the game ended the way it did, and what I should take from it.`

export const GATHER_ONLY =
  'In this conversation you only GATHER. Use the tools to collect everything a careful review of this game would need ' +
  '(the game, the cards, the rules, the player\'s notes), then reply with the single word READY. Another model writes ' +
  'the review from exactly what you gathered, so gather what it will need; do not write the review and do not save one.'

export const WRITER_SYSTEM =
  'You write the game review. Another agent already called DeckPal\'s tools for you; their calls and results follow. ' +
  'You cannot call tools yourself. Write the review the player asked for, from that evidence and the instructions above.'

/** May this tool call reach the QA account? Reads always; one write, on this case's log. */
export function allowCall(tool, args, ids) {
  if (tool.annotations?.readOnlyHint === true) return true
  return tool.name === 'edit_battle_log' && Number(args?.log_id) === ids.logId
}

const CACHE = { anthropic: { cacheControl: { type: 'ephemeral' } } }

/** One cache breakpoint on the newest non-system message (api/chat.mjs cacheConversation). */
export function cacheNewest(messages) {
  const newest = messages.findLastIndex((m) => m.role !== 'system')
  return messages.map((m, i) => {
    if (m.role === 'system') return m
    const providerOptions = { ...(m.providerOptions ?? {}) }
    const anthropic = { ...(providerOptions.anthropic ?? {}) }
    delete anthropic.cacheControl
    if (i === newest) Object.assign(anthropic, CACHE.anthropic)
    if (Object.keys(anthropic).length) providerOptions.anthropic = anthropic
    else delete providerOptions.anthropic
    return { ...m, providerOptions: Object.keys(providerOptions).length ? providerOptions : undefined }
  })
}

export class BudgetExceeded extends Error {}

/** A model whose every call is reserved against the budget first and settled at the Gateway's cost. */
export async function metered(base, budget, calls, label) {
  const { wrapLanguageModel } = await import('ai')
  return wrapLanguageModel({
    model: base,
    middleware: {
      specificationVersion: 'v4',
      wrapGenerate: async ({ doGenerate }) => {
        const reserved = budget.tryReserve()
        if (reserved === null) throw new BudgetExceeded(`budget of $${budget.capUsd} reached`)
        const t0 = Date.now()
        let result
        try {
          result = await doGenerate()
        } catch (e) {
          budget.settle(reserved, null)
          calls.push({ label, ok: false, error: safeError(e), ms: Date.now() - t0 })
          throw e
        }
        const costUsd = gatewayCost(result.providerMetadata)
        budget.settle(reserved, costUsd)
        calls.push({ label, ok: true, costUsd, ms: Date.now() - t0, usage: result.usage ?? null })
        return result
      },
    },
  })
}

const providerOptions = (effort) => ({ anthropic: { effort, thinking: { type: 'adaptive' } } })

/** The tools, as the agent sees them: every MCP tool, run against QA through the guard. */
export async function agentTools(session, mcp, ids, record) {
  const { tool, jsonSchema } = await import('ai')
  return Object.fromEntries(session.tools.map((t) => [t.name, tool({
    description: t.description,
    inputSchema: jsonSchema(t.inputSchema ?? { type: 'object', properties: {} }),
    execute: async (args) => {
      const t0 = Date.now()
      let out
      if (!allowCall(t, args, ids)) {
        out = { text: `${t.name} is not run in this evaluation: only read tools and edit_battle_log on battle log #${ids.logId} reach the account.`, isError: true }
      } else {
        try {
          out = await mcp.call(t.name, args)
        } catch (e) {
          out = { text: `The tool call failed: ${safeError(e).message}`, isError: true }
        }
      }
      record.toolCalls.push({ name: t.name, args, isError: out.isError, chars: out.text.length, ms: Date.now() - t0, text: out.text })
      if (t.name === 'edit_battle_log' && !out.isError && args?.dry_run === false && typeof args.review === 'string') record.savedReview = args.review
      return out.isError ? `Error: ${out.text}` : out.text
    },
  })]))
}

/** The gathered evidence as the writer reads it. */
export function evidenceText(toolCalls) {
  return toolCalls.map((t, i) => `### ${i + 1}. ${t.name}(${JSON.stringify(t.args)})${t.isError ? ' — error' : ''}\n${t.text}`).join('\n\n')
}

/** One config on one case: the agent loop (and for B the writer call). */
export async function runCase({ gateway, mcp, session, config, c, ids, deckName, budget, calls }) {
  const { generateText, stepCountIs } = await import('ai')
  const record = { case: c.id, config: config.key, logId: ids.logId, toolCalls: [], savedReview: null, reply: '', error: null }
  const t0 = Date.now()
  const ask = askFor(deckName, ids.logId)
  try {
    const agent = await metered(gateway(config.agent.model), budget, calls, `${c.id}:${config.key}:agent`)
    const system = config.agent.gatherOnly ? `${session.instructions}\n\n${GATHER_ONLY}` : session.instructions
    const out = await generateText({
      model: agent,
      instructions: [{ role: 'system', content: system, providerOptions: CACHE }],
      messages: [{ role: 'user', content: ask }],
      tools: await agentTools(session, mcp, ids, record),
      stopWhen: stepCountIs(MAX_STEPS),
      prepareStep: ({ messages }) => ({ messages: cacheNewest(messages) }),
      providerOptions: providerOptions(config.agent.effort),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
    record.steps = out.steps.length
    record.reply = out.text
    if (config.writer) {
      const writer = await metered(gateway(config.writer.model), budget, calls, `${c.id}:${config.key}:writer`)
      const w = await generateText({
        model: writer,
        instructions: [{ role: 'system', content: `${session.instructions}\n\n${WRITER_SYSTEM}`, providerOptions: CACHE }],
        messages: [
          { role: 'user', content: `${ask}\n\n--- What the gathering agent found ---\n\n${evidenceText(record.toolCalls)}` },
        ],
        providerOptions: providerOptions(config.writer.effort),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
      record.gatherReply = record.reply
      record.reply = w.text
    }
  } catch (e) {
    record.error = safeError(e)
    if (e instanceof BudgetExceeded) record.budgetStop = true
  }
  record.ms = Date.now() - t0
  return record
}

/** What the judge grades: the reply, plus a review the agent saved if it differs. */
export function reviewText(run) {
  const parts = [run.reply?.trim()]
  if (run.savedReview && !run.reply?.includes(run.savedReview.trim().slice(0, 200))) parts.push(`--- Review saved to the battle log ---\n${run.savedReview.trim()}`)
  return parts.filter(Boolean).join('\n\n')
}

// ─── The judge ──────────────────────────────────────────────────────────────

export const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'false_claims'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'evidence'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: Object.keys(VERDICTS) },
          evidence: { type: 'string', description: 'A short quote from the review, or "none".' },
        },
      },
    },
    false_claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'quote'],
        properties: { claim: { type: 'string' }, quote: { type: 'string' } },
      },
    },
  },
}

export function judgeMessages(c, principles, logText, review) {
  const rubric = c.rubric.map((r) => `- ${r.id} [${r.principle} ${principles[r.principle].name}${r.must ? ', must' : ''}]: ${r.point}`).join('\n')
  const system =
    'You grade a Pokemon TCG game review against a rubric written by an expert who checked every point against the card text and the log. ' +
    'For each rubric item: "caught" when the review states the point (its substance, in any words), "partial" when it states part of it or gets ' +
    'the right idea with a material gap, "missed" when it is absent. A point stated wrongly is missed, and the wrong statement is a false claim. ' +
    'Then list the review\'s FALSE CLAIMS: statements of fact that contradict the log, the case facts or the rubric, including any in the ' +
    '"known false claims" list. Do not list opinions, suggestions or hedged hypotheses unless they rest on a false fact. Quote the review exactly.'
  const user = [
    `Case facts: ${JSON.stringify(c.facts)} (PlayerA is the reviewer's player; prizes are [PlayerA, PlayerB]).`,
    c.notes ? `The player's own notes: ${c.notes}` : 'The player left no notes.',
    `Rubric:\n${rubric}`,
    `Known false claims to watch for:\n${c.false_claims.map((x) => `- ${x}`).join('\n')}`,
    `The game log:\n<log>\n${logText}\n</log>`,
    `The review to grade:\n<review>\n${review || '(empty)'}\n</review>`,
  ].join('\n\n')
  return { instructions: [{ role: 'system', content: system }], messages: [{ role: 'user', content: user }] }
}

export async function judgeRun({ gateway, c, principles, logText, run, budget, calls }) {
  const { generateText, Output, jsonSchema } = await import('ai')
  const model = await metered(gateway(JUDGE.model), budget, calls, `${c.id}:${run.config}:judge`)
  const out = await generateText({
    model,
    ...judgeMessages(c, principles, logText, reviewText(run)),
    output: Output.object({ schema: jsonSchema(JUDGE_SCHEMA) }),
    providerOptions: providerOptions(JUDGE.effort),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  })
  return out.output
}

// ─── Scoring ────────────────────────────────────────────────────────────────

/** One judged run → per-item scores; an item the judge skipped counts as missed. */
export function scoreRun(c, judgment) {
  const verdicts = new Map((judgment?.items ?? []).map((i) => [i.id, i.verdict]))
  const items = c.rubric.map((r) => {
    const verdict = verdicts.get(r.id) ?? 'missed'
    return { id: r.id, principle: r.principle, must: r.must, verdict, score: VERDICTS[verdict] ?? 0 }
  })
  return { case: c.id, split: c.split, items, falseClaims: (judgment?.false_claims ?? []).length }
}

const pct = (got, of) => (of ? Math.round((100 * got) / of) : null)

/** Rows of { config, scored, run } → the report's numbers. */
export function aggregate(rows, principles) {
  const byConfig = {}
  for (const row of rows) {
    const a = (byConfig[row.config] ??= { runs: 0, errors: 0, costUsd: 0, steps: 0, falseClaims: 0, principle: {}, split: {}, must: [0, 0], all: [0, 0] })
    a.runs++
    if (row.run.error) a.errors++
    a.costUsd += row.costUsd ?? 0
    a.steps += row.run.steps ?? 0
    a.falseClaims += row.scored.falseClaims
    for (const it of row.scored.items) {
      const p = (a.principle[it.principle] ??= [0, 0])
      p[0] += it.score
      p[1] += 1
      const s = (a.split[row.scored.split] ??= [0, 0])
      s[0] += it.score
      s[1] += 1
      a.all[0] += it.score
      a.all[1] += 1
      if (it.must) {
        a.must[0] += it.score
        a.must[1] += 1
      }
    }
  }
  return Object.fromEntries(Object.entries(byConfig).map(([k, a]) => [k, {
    runs: a.runs,
    errors: a.errors,
    costUsd: Number(a.costUsd.toFixed(4)),
    meanSteps: a.runs ? Number((a.steps / a.runs).toFixed(1)) : 0,
    falseClaimsPerReview: a.runs ? Number((a.falseClaims / a.runs).toFixed(2)) : 0,
    overall: pct(...a.all),
    must: pct(...a.must),
    split: Object.fromEntries(Object.entries(a.split).map(([s, v]) => [s, pct(...v)])),
    principle: Object.fromEntries(Object.keys(principles).map((p) => [p, a.principle[p] ? pct(...a.principle[p]) : null])),
  }]))
}

export function formatReport(agg, principles, rows) {
  const configs = Object.keys(agg).sort()
  const cell = (v) => (v === null || v === undefined ? '—' : `${v}%`)
  const lines = ['# Analysis eval', '']
  lines.push(`| | ${configs.map((k) => `${k}: ${CONFIGS[k]?.label ?? k}`).join(' | ')} |`, `|---|${configs.map(() => '---').join('|')}|`)
  lines.push(`| Overall | ${configs.map((k) => cell(agg[k].overall)).join(' | ')} |`)
  lines.push(`| Must items | ${configs.map((k) => cell(agg[k].must)).join(' | ')} |`)
  lines.push(`| Owner cases | ${configs.map((k) => cell(agg[k].split.owner)).join(' | ')} |`)
  lines.push(`| Held-out cases | ${configs.map((k) => cell(agg[k].split['held-out'])).join(' | ')} |`)
  for (const [p, def] of Object.entries(principles)) lines.push(`| ${p} ${def.name} | ${configs.map((k) => cell(agg[k].principle[p])).join(' | ')} |`)
  lines.push(`| False claims per review | ${configs.map((k) => agg[k].falseClaimsPerReview).join(' | ')} |`)
  lines.push(`| Mean agent steps | ${configs.map((k) => agg[k].meanSteps).join(' | ')} |`)
  lines.push(`| Cost (runs + judge) | ${configs.map((k) => `$${agg[k].costUsd.toFixed(2)}`).join(' | ')} |`)
  lines.push(`| Runs (errors) | ${configs.map((k) => `${agg[k].runs} (${agg[k].errors})`).join(' | ')} |`, '')
  lines.push('## Per case', '', '| Case | Config | Missed | Partial | False claims |', '|---|---|---|---|---|')
  for (const r of [...rows].sort((a, b) => a.scored.case.localeCompare(b.scored.case) || a.config.localeCompare(b.config))) {
    const ids = (v) => r.scored.items.filter((i) => i.verdict === v).map((i) => `${i.id}${i.must ? '*' : ''}`).join(', ') || '—'
    lines.push(`| ${r.scored.case} | ${r.config} | ${ids('missed')} | ${ids('partial')} | ${r.scored.falseClaims} |`)
  }
  lines.push('', '`*` marks a must item.')
  return `${lines.join('\n')}\n`
}

/** Read a run directory back into report rows. */
export function readRows(dir, cases) {
  const rows = []
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.run.json'))) {
    const run = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    const c = cases.find((x) => x.id === run.case)
    if (!c) continue
    const judgeFile = path.join(dir, f.replace('.run.json', '.judge.json'))
    const judgment = fs.existsSync(judgeFile) ? JSON.parse(fs.readFileSync(judgeFile, 'utf8')) : null
    rows.push({ config: run.config, run, scored: scoreRun(c, judgment?.output ?? null), costUsd: (run.costUsd ?? 0) + (judgment?.costUsd ?? 0) })
  }
  return rows
}

// ─── Command line ───────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const [command, ...rest] = argv
  const opts = { command }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`)
    const key = a.slice(2)
    if (!['budget', 'configs', 'cases', 'out', 'account'].includes(key)) throw new Error(`unknown option ${a}`)
    opts[key] = rest[++i]
    if (opts[key] === undefined) throw new Error(`${a} needs a value`)
  }
  if (!['check', 'setup', 'run', 'report'].includes(command)) throw new Error(USAGE)
  if (command === 'run') {
    const budget = Number(opts.budget)
    if (!(budget > 0)) throw new Error('run needs --budget USD (a hard cap on Gateway spend)')
    opts.budget = budget
  }
  if (command === 'report' && !opts.out) throw new Error('report needs --out DIR')
  opts.configs = (opts.configs ?? Object.keys(CONFIGS).join(',')).split(',').map((s) => s.trim())
  const badConfig = opts.configs.filter((k) => !CONFIGS[k])
  if (badConfig.length) throw new Error(`unknown config(s): ${badConfig.join(', ')}`)
  return opts
}

async function connect(opts) {
  const account = readAccount(opts.account ?? path.join(ROOT, '.qa-account'))
  const username = await assertQaAccount(account)
  const mcp = new Mcp(account.base, account.token)
  const session = await mcp.init()
  console.log(`QA account ${username} on ${account.base}: ${session.tools.length} tools.`)
  return { mcp, session }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  const data = loadEval()
  const errors = validateEval(data)
  if (errors.length) throw new Error(`the cases are not sound:\n${errors.join('\n')}`)
  const cases = selectCases(data.cases, opts.cases)

  if (opts.command === 'check') {
    const parse = await loadParser()
    let bad = 0
    for (const c of cases) {
      const problems = checkLog(c, readLog(c), parse)
      if (problems.length) bad++
      console.log(`${problems.length ? 'BAD' : 'ok '} ${c.id}${problems.length ? `: ${problems.join('; ')}` : ''}`)
    }
    return bad ? 1 : 0
  }

  if (opts.command === 'report') {
    const rows = readRows(opts.out, data.cases)
    const report = formatReport(aggregate(rows, data.principles), data.principles, rows)
    fs.writeFileSync(path.join(opts.out, 'report.md'), report)
    console.log(report)
    return 0
  }

  const { mcp, session } = await connect(opts)
  const state = await setup(mcp, data, cases)
  if (opts.command === 'setup') return 0

  const key = process.env.AI_GATEWAY_API_KEY ?? process.env.DECKE_VERCEL_AI_GATEWAY_KEY
  if (!key) throw new Error('Set AI_GATEWAY_API_KEY (or DECKE_VERCEL_AI_GATEWAY_KEY). It is never printed.')
  const { createGateway } = await import('@ai-sdk/gateway')
  const gateway = createGateway({ apiKey: key })
  const out = opts.out ?? path.join(EVAL_DIR, 'runs', new Date().toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(out, { recursive: true })
  const budget = new Budget(opts.budget, { priorCallUsd: FIRST_CALL_USD })
  const calls = []
  const cost = (prefix) => calls.filter((x) => x.label.startsWith(prefix)).reduce((n, x) => n + (x.costUsd ?? 0), 0)

  outer: for (const c of cases) {
    const ids = state.logs[c.id]
    const logText = readLog(c)
    for (const k of opts.configs) {
      const runFile = path.join(out, `${c.id}.${k}.run.json`)
      if (fs.existsSync(runFile)) continue
      await resetLog(mcp, c, ids)
      const run = await runCase({ gateway, mcp, session, config: { key: k, ...CONFIGS[k] }, c, ids, deckName: data.decks[c.deck].name, budget, calls })
      run.costUsd = Number((cost(`${c.id}:${k}:agent`) + cost(`${c.id}:${k}:writer`)).toFixed(6))
      fs.writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`)
      console.log(`${c.id} ${k}: ${run.error ? `error ${run.error.message}` : `${run.steps} steps, ${run.toolCalls.length} tool calls`}, $${run.costUsd.toFixed(3)} (spent $${budget.spentUsd.toFixed(2)})`)
      if (run.budgetStop) break outer
      if (run.error) continue
      try {
        const output = await judgeRun({ gateway, c, principles: data.principles, logText, run, budget, calls })
        fs.writeFileSync(runFile.replace('.run.json', '.judge.json'), `${JSON.stringify({ output, costUsd: Number(cost(`${c.id}:${k}:judge`).toFixed(6)) }, null, 2)}\n`)
      } catch (e) {
        console.log(`${c.id} ${k}: judge failed, ${safeError(e).message}`)
        if (e instanceof BudgetExceeded) break outer
      }
    }
  }
  await resetLogs(mcp, cases, state)
  fs.writeFileSync(path.join(out, 'calls.json'), `${JSON.stringify(calls, null, 2)}\n`)
  const rows = readRows(out, data.cases)
  const report = formatReport(aggregate(rows, data.principles), data.principles, rows)
  fs.writeFileSync(path.join(out, 'report.md'), report)
  console.log(`\n${report}\nSpent $${budget.spentUsd.toFixed(2)} of $${budget.capUsd} in ${budget.calls} calls (${budget.unknownCost} with no reported cost). Runs in ${path.relative(ROOT, out)}.`)
  return 0
}

/** Leave the QA logs as setup made them: no review, the player's notes. */
async function resetLogs(mcp, cases, state) {
  for (const c of cases) if (state.logs[c.id]) await resetLog(mcp, c, state.logs[c.id]).catch(() => {})
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code }, (e) => {
    console.error(`analysis-eval: ${e?.message ?? e}`)
    process.exitCode = 1
  })
}
