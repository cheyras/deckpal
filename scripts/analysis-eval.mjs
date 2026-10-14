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
 * `scripts/qa-token.mjs`, which the maintainer runs; it also records
 * QA_USERNAME, read from /api/me right after signing in with the QA password).
 * Before anything is written, the token's /api/me must name exactly that user
 * and say it is not the owner; anything else, a missing field included, is a
 * refusal. The agent's tool calls run for real on the QA account, but only
 * read tools and `edit_battle_log` saving a review on the case's own log; any
 * other write is answered "not run in this eval" without reaching the server.
 * Before each run the case's log is reset (review cleared, notes restored) so
 * one config's saved review cannot leak into the next.
 *
 * ── IT SPENDS MONEY, SO IT HAS A CEILING ─────────────────────────────────────
 *
 * `--budget` (required for `run`) is a ceiling, not an estimate, over the whole
 * --out directory: every model call first reserves the MOST it could cost — one
 * input token per UTF-8 byte of the request (Claude's tokenizer is byte-level)
 * plus the provider's overhead, at the dearest input rate, and the whole output
 * cap, all at the Gateway's own listed prices — and is refused unless that fits
 * in what is left. It settles at the Gateway's reported cost, or at the full
 * reservation when none comes back, and a call ever costing more than its bound
 * stops the run. Every call is written to `calls.jsonl` as a reservation BEFORE
 * it is sent and a settlement after, so a call cut off mid-flight still counts
 * at its bound; reports
 * and the ceiling read spend from there, every attempt included. The key is
 * read from AI_GATEWAY_API_KEY (or DECKE_VERCEL_AI_GATEWAY_KEY) and never
 * printed. Only judged runs are scored; resuming the same --out reruns errored
 * runs and re-judges unjudged ones. `report` re-reads a finished run for free.
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
import { gatewayCost, safeError } from './decke-triage-eval.mjs'

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
  return { token, username: get('QA_USERNAME'), base: (process.env.DECKPAL_BASE ?? 'https://deckpal.app').replace(/\/$/, '') }
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

/**
 * The token must belong to THE QA account, before anything is written: its
 * username equals QA_USERNAME (recorded by qa-token.mjs right after signing in
 * with the QA password) and the account is explicitly not the owner. A missing
 * field is a refusal, never a pass.
 */
export async function assertQaAccount({ base, token, username }, fetchImpl = fetch) {
  if (!username) throw new Error('No QA_USERNAME in the QA account file. The maintainer reruns: node scripts/qa-token.mjs (it records it).')
  const res = await fetchImpl(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`/api/me: HTTP ${res.status}`)
  const me = await res.json()
  if (me.isOwner !== false || me.owner !== false) throw new Error('This token is not provably a non-owner account (isOwner/owner not false). The eval runs on the QA account only.')
  if (typeof me.username !== 'string' || me.username !== username) throw new Error('This token does not belong to the QA account named in QA_USERNAME.')
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

/** The only fields the agent may send to edit_battle_log: saving its review, nothing a later run would read. */
export const REVIEW_EDIT_FIELDS = new Set(['deck_id', 'log_id', 'review', 'dry_run'])

/** May this tool call reach the QA account? Reads always; one write: the review, on this case's log. */
export function allowCall(tool, args, ids) {
  if (tool.annotations?.readOnlyHint === true) return true
  return tool.name === 'edit_battle_log'
    && Number(args?.log_id) === ids.logId
    && Object.keys(args ?? {}).every((k) => REVIEW_EDIT_FIELDS.has(k))
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

/**
 * A spending CEILING, not an estimate. Each call reserves the most it could
 * cost (`maxCallUsd`) and is refused unless that fits in what is left; it
 * settles at the Gateway's reported cost, or at the full reservation when no
 * cost comes back (a failed call may still have been billed).
 */
export class Ceiling {
  /**
   * `priorUsd`: what earlier invocations into the same --out already spent (the
   * ledger's total). `priorOverruns`: calls of theirs that cost more than their
   * bound — a resume inherits the stop.
   */
  constructor(capUsd, priorUsd = 0, priorOverruns = 0) {
    this.capUsd = capUsd
    this.priorUsd = priorUsd
    this.spentUsd = 0
    this.reservedUsd = 0
    this.calls = 0
    this.unknownCost = 0
    this.overruns = priorOverruns
  }
  remaining() {
    return this.capUsd - this.priorUsd - this.spentUsd - this.reservedUsd
  }
  reserve(maxUsd) {
    // A call that ever cost more than its bound means the bound is wrong: stop, never guess on.
    if (this.overruns > 0 || !(maxUsd > 0) || maxUsd > this.remaining()) return null
    this.reservedUsd += maxUsd
    return maxUsd
  }
  settle(reserved, actualUsd) {
    this.reservedUsd = Math.max(0, this.reservedUsd - reserved)
    this.calls += 1
    if (typeof actualUsd === 'number' && Number.isFinite(actualUsd)) {
      this.spentUsd += actualUsd
      if (actualUsd > reserved) this.overruns += 1
    } else {
      this.spentUsd += reserved
      this.unknownCost += 1
    }
  }
}

/**
 * Tokens the provider adds that are not in the request we send: Anthropic's
 * tool-use system prompt (a few hundred tokens) and message framing. Generous
 * on purpose; the serialized request's keys and quotes over-count as well.
 */
export const REQUEST_OVERHEAD_TOKENS = 4_096

/**
 * The most one call can cost. The bound on input tokens is the request's UTF-8
 * BYTE count: Claude's tokenizer is byte-level, so no token is shorter than a
 * byte. Everything the provider turns into input is counted — messages,
 * reasoning carried in them, tool definitions, tool choice and a structured
 * response's schema — plus the provider's own overhead, all at the dearest
 * input rate (a cache write), and the whole output cap (thinking included).
 */
export function maxCallUsd(price, params) {
  const request = JSON.stringify({ prompt: params.prompt ?? null, tools: params.tools ?? null, toolChoice: params.toolChoice ?? null, responseFormat: params.responseFormat ?? null })
  const inputTokens = Buffer.byteLength(request, 'utf8') + REQUEST_OVERHEAD_TOKENS
  const outputTokens = params.maxOutputTokens ?? MAX_OUTPUT_TOKENS
  return inputTokens * Math.max(price.input, price.cacheWrite ?? 0) + outputTokens * price.output
}

/**
 * Every model call, in `calls.jsonl`: a `reserve` line written BEFORE the call
 * is sent, and a `settle` line when it returns or fails. A process killed mid
 * call leaves its reservation unsettled, and an unsettled reservation counts
 * at its full bound. So no attempt's cost is lost to a crash, a retry or a
 * resume. Reports and the ceiling read their spend from here, not from run
 * files.
 */
export class Ledger {
  constructor(file = null) {
    this.file = file
    this.entries = file && fs.existsSync(file) ? readLedger(file) : []
  }
  push(entry) {
    const e = { at: new Date().toISOString(), ...entry }
    this.entries.push(e)
    if (this.file) fs.appendFileSync(this.file, `${JSON.stringify(e)}\n`)
  }
  /** What a ceiling must count: reported charges, plus the whole reservation of any call unpriced or never settled. */
  countedUsd(entries = this.entries) {
    return ledgerCalls(entries).reduce((n, c) => n + countedCost(c), 0)
  }
  /** Calls that cost more than their bound: once there is one, no further call is trusted. */
  overruns() {
    return ledgerCalls(this.entries).filter((c) => c.settled && typeof c.costUsd === 'number' && c.costUsd > c.reservedUsd).length
  }
}

export function readLedger(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

/** One record per call: its reservation, and its settlement if there was one. */
export function ledgerCalls(entries) {
  const byId = new Map()
  for (const e of entries) {
    const key = e.id ?? Symbol('call') // a line with no id stands alone
    const c = byId.get(key) ?? { id: e.id, label: e.label, reservedUsd: e.reservedUsd ?? 0, settled: false, costUsd: null }
    if (e.kind !== 'reserve') Object.assign(c, { settled: true, costUsd: typeof e.costUsd === 'number' ? e.costUsd : null, ok: e.ok })
    byId.set(key, c)
  }
  return [...byId.values()]
}

const countedCost = (c) => (c.settled && typeof c.costUsd === 'number' ? c.costUsd : c.reservedUsd)

/**
 * Spend per "case:config" across every attempt: Gateway-reported charges, and
 * apart from them the reservations of calls that reported no cost or never
 * settled (an interrupted call is counted at its bound).
 */
export function costsByRun(entries) {
  const out = {}
  for (const c of ledgerCalls(entries)) {
    const key = c.label.split(':').slice(0, 2).join(':')
    const r = (out[key] ??= { reportedUsd: 0, unpricedUsd: 0, calls: 0 })
    r.calls++
    if (c.settled && typeof c.costUsd === 'number') r.reportedUsd += c.costUsd
    else r.unpricedUsd += c.reservedUsd
  }
  return out
}

/** Per-token USD prices from the Gateway's own model list; a model without them is refused. */
export async function loadPrices(gateway, ids) {
  const { models } = await gateway.getAvailableModels()
  const prices = {}
  for (const id of ids) {
    const p = models.find((m) => m.id === id)?.pricing
    const input = Number(p?.input)
    const output = Number(p?.output)
    if (!(input > 0) || !(output > 0)) throw new Error(`The Gateway lists no price for ${id}; refusing to run without a ceiling.`)
    const cacheWrite = Number(p.cacheCreationInputTokens)
    prices[id] = { input, output, ...(cacheWrite > 0 ? { cacheWrite } : {}) }
  }
  return prices
}

/** A model whose every call is reserved at its maximum cost first and settled at the Gateway's cost. */
export async function metered(base, price, budget, calls, label) {
  const { wrapLanguageModel } = await import('ai')
  return wrapLanguageModel({
    model: base,
    middleware: {
      specificationVersion: 'v4',
      wrapGenerate: async ({ doGenerate, params }) => {
        const maxUsd = maxCallUsd(price, params)
        const reserved = budget.reserve(maxUsd)
        if (reserved === null) {
          const why = budget.overruns > 0 ? 'a call has cost more than its bound, so no bound is trusted' : `the next call could cost up to $${maxUsd.toFixed(3)} and $${budget.remaining().toFixed(3)} is left`
          throw new BudgetExceeded(`budget of $${budget.capUsd}: ${why}`)
        }
        // On disk before the request leaves: a kill mid-call still counts this reservation.
        const id = crypto.randomUUID()
        calls.push({ kind: 'reserve', id, label, reservedUsd: reserved })
        const t0 = Date.now()
        let result
        try {
          result = await doGenerate()
        } catch (e) {
          budget.settle(reserved, null)
          calls.push({ kind: 'settle', id, label, ok: false, costUsd: null, reservedUsd: reserved, error: safeError(e), ms: Date.now() - t0 })
          throw e
        }
        const costUsd = gatewayCost(result.providerMetadata)
        budget.settle(reserved, costUsd)
        calls.push({ kind: 'settle', id, label, ok: true, costUsd, reservedUsd: reserved, ms: Date.now() - t0, usage: result.usage ?? null })
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
        out = { text: `${t.name} is not run in this evaluation: only read tools, and edit_battle_log saving a review on battle log #${ids.logId}, reach the account.`, isError: true }
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
export async function runCase({ gateway, prices, mcp, session, config, c, ids, deckName, budget, calls }) {
  const { generateText, stepCountIs } = await import('ai')
  const record = { case: c.id, config: config.key, logId: ids.logId, toolCalls: [], savedReview: null, reply: '', error: null }
  const t0 = Date.now()
  const ask = askFor(deckName, ids.logId)
  try {
    const agent = await metered(gateway(config.agent.model), prices[config.agent.model], budget, calls, `${c.id}:${config.key}:agent`)
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
      const writer = await metered(gateway(config.writer.model), prices[config.writer.model], budget, calls, `${c.id}:${config.key}:writer`)
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

export async function judgeRun({ gateway, prices, c, principles, logText, run, budget, calls }) {
  const { generateText, Output, jsonSchema } = await import('ai')
  const model = await metered(gateway(JUDGE.model), prices[JUDGE.model], budget, calls, `${c.id}:${run.config}:judge`)
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

/**
 * Rows of { config, run, scored, costUsd } → the report's numbers. Only JUDGED
 * runs count toward quality; a run that errored or was never judged is counted
 * apart, never scored as a review that missed everything.
 */
export function aggregate(rows, principles) {
  const byConfig = {}
  for (const row of rows) {
    const a = (byConfig[row.config] ??= { runs: 0, judged: 0, errors: 0, unjudged: 0, costUsd: 0, unpricedUsd: 0, steps: 0, falseClaims: 0, principle: {}, split: {}, must: [0, 0], all: [0, 0] })
    a.runs++
    a.costUsd += row.costUsd ?? 0
    a.unpricedUsd += row.unpricedUsd ?? 0
    if (row.run.error) {
      a.errors++
      continue
    }
    if (!row.scored) {
      a.unjudged++
      continue
    }
    a.judged++
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
    judged: a.judged,
    errors: a.errors,
    unjudged: a.unjudged,
    costUsd: Number(a.costUsd.toFixed(4)),
    unpricedUsd: Number(a.unpricedUsd.toFixed(4)),
    meanSteps: a.judged ? Number((a.steps / a.judged).toFixed(1)) : null,
    falseClaimsPerReview: a.judged ? Number((a.falseClaims / a.judged).toFixed(2)) : null,
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
  const num = (v) => (v === null || v === undefined ? '—' : v)
  lines.push(`| False claims per review | ${configs.map((k) => num(agg[k].falseClaimsPerReview)).join(' | ')} |`)
  lines.push(`| Mean agent steps | ${configs.map((k) => num(agg[k].meanSteps)).join(' | ')} |`)
  lines.push(`| Cost, every attempt (runs + judge) | ${configs.map((k) => `$${agg[k].costUsd.toFixed(2)}${agg[k].unpricedUsd ? ` + $${agg[k].unpricedUsd.toFixed(2)} unpriced` : ''}`).join(' | ')} |`)
  lines.push(`| Runs: judged / errored / unjudged | ${configs.map((k) => `${agg[k].judged} / ${agg[k].errors} / ${agg[k].unjudged}`).join(' | ')} |`, '')
  lines.push('Scores count judged runs only.', '')
  lines.push('## Per case', '', '| Case | Config | Missed | Partial | False claims |', '|---|---|---|---|---|')
  for (const r of [...rows].sort((a, b) => a.run.case.localeCompare(b.run.case) || a.config.localeCompare(b.config))) {
    if (!r.scored || r.run.error) {
      lines.push(`| ${r.run.case} | ${r.config} | ${r.run.error ? `error: ${r.run.error.message}` : 'not judged'} | | |`)
      continue
    }
    const ids = (v) => r.scored.items.filter((i) => i.verdict === v).map((i) => `${i.id}${i.must ? '*' : ''}`).join(', ') || '—'
    lines.push(`| ${r.run.case} | ${r.config} | ${ids('missed')} | ${ids('partial')} | ${r.scored.falseClaims} |`)
  }
  lines.push('', '`*` marks a must item.')
  return `${lines.join('\n')}\n`
}

/**
 * Read a run directory back into report rows. Cost comes from the call ledger,
 * every attempt of the pair included (a retried run, a re-judge), with calls
 * that reported no cost counted apart at their reservation.
 */
export function readRows(dir, cases) {
  const ledger = path.join(dir, LEDGER_FILE)
  const costs = costsByRun(fs.existsSync(ledger) ? readLedger(ledger) : [])
  const rows = []
  const seen = new Set()
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.run.json'))) {
    const run = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    const c = cases.find((x) => x.id === run.case)
    if (!c) continue
    const judgment = readJudgment(path.join(dir, f))
    const scored = !run.error && judgment?.status === 'ok' ? scoreRun(c, judgment.output) : null
    const key = `${run.case}:${run.config}`
    seen.add(key)
    const cost = costs[key] ?? { reportedUsd: 0, unpricedUsd: 0 }
    rows.push({ config: run.config, run, scored, costUsd: cost.reportedUsd, unpricedUsd: cost.unpricedUsd })
  }
  // Spend with no run file is an interrupted run: it is paid for and counted, as an error.
  for (const [key, cost] of Object.entries(costs)) {
    if (seen.has(key)) continue
    const [caseId, config] = key.split(':')
    rows.push({ config, run: { case: caseId, config, error: { message: 'interrupted before its run file was written' } }, scored: null, costUsd: cost.reportedUsd, unpricedUsd: cost.unpricedUsd })
  }
  return rows
}

export const LEDGER_FILE = 'calls.jsonl'

const judgeFileOf = (runFile) => runFile.replace('.run.json', '.judge.json')
export function readJudgment(runFile) {
  const f = judgeFileOf(runFile)
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null
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
  const models = [...new Set(opts.configs.flatMap((k) => [CONFIGS[k].agent.model, CONFIGS[k].writer?.model]).concat(JUDGE.model).filter(Boolean))]
  const prices = await loadPrices(gateway, models)
  const out = opts.out ?? path.join(EVAL_DIR, 'runs', new Date().toISOString().replace(/[:.]/g, '-'))
  fs.mkdirSync(out, { recursive: true })
  // --budget caps the whole --out directory: a resumed run starts from what earlier invocations spent.
  const calls = new Ledger(path.join(out, LEDGER_FILE))
  const prior = calls.countedUsd()
  const priorOverruns = calls.overruns()
  if (priorOverruns > 0) throw new Error(`${path.relative(ROOT, out)}/${LEDGER_FILE} records ${priorOverruns} call(s) that cost more than their bound. Fix the bound (maxCallUsd) before spending more; use a new --out.`)
  const budget = new Ceiling(opts.budget, prior, priorOverruns)
  if (prior > 0) console.log(`Resuming ${path.relative(ROOT, out)}: $${prior.toFixed(2)} already counted against the $${opts.budget} budget.`)
  const cost = (prefix) => calls.countedUsd(calls.entries.filter((x) => x.label.startsWith(prefix)))
  try {
    await runAll({ gateway, prices, mcp, session, data, cases, state, configs: opts.configs, out, budget, calls, cost })
  } finally {
    await resetLogs(mcp, cases, state)
  }
  const rows = readRows(out, data.cases)
  const report = formatReport(aggregate(rows, data.principles), data.principles, rows)
  fs.writeFileSync(path.join(out, 'report.md'), report)
  console.log(`\n${report}\nThis invocation: $${budget.spentUsd.toFixed(2)} in ${budget.calls} calls (${budget.unknownCost} with no reported cost, counted at their reservation; ${budget.overruns} over their bound). All invocations: $${(prior + budget.spentUsd).toFixed(2)} of $${budget.capUsd}. Runs in ${path.relative(ROOT, out)}.`)
  return 0
}

/**
 * Each (case, config) once. Resuming the same --out: a finished, judged pair is
 * skipped; a run that errored is run again; a run whose judging failed or never
 * happened is judged again, never scored as empty.
 */
async function runAll({ gateway, prices, mcp, session, data, cases, state, configs, out, budget, calls, cost }) {
  for (const c of cases) {
    const ids = state.logs[c.id]
    const logText = readLog(c)
    for (const k of configs) {
      const runFile = path.join(out, `${c.id}.${k}.run.json`)
      let run = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : null
      if (run && !run.error && readJudgment(runFile)?.status === 'ok') continue
      if (!run || run.error) {
        await resetLog(mcp, c, ids)
        run = await runCase({ gateway, prices, mcp, session, config: { key: k, ...CONFIGS[k] }, c, ids, deckName: data.decks[c.deck].name, budget, calls })
        fs.writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`)
        console.log(`${c.id} ${k}: ${run.error ? `error ${run.error.message}` : `${run.steps} steps, ${run.toolCalls.length} tool calls`}, $${cost(`${c.id}:${k}:`).toFixed(3)} so far for this pair (all attempts)`)
        if (run.budgetStop) return
        if (run.error) continue
      }
      try {
        const output = await judgeRun({ gateway, prices, c, principles: data.principles, logText, run, budget, calls })
        writeJudgment(runFile, { status: 'ok', output })
      } catch (e) {
        writeJudgment(runFile, { status: 'failed', error: safeError(e) })
        console.log(`${c.id} ${k}: judge failed, ${safeError(e).message}`)
        if (e instanceof BudgetExceeded) return
      }
    }
  }
}

function writeJudgment(runFile, judgment) {
  fs.writeFileSync(judgeFileOf(runFile), `${JSON.stringify(judgment, null, 2)}\n`)
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
