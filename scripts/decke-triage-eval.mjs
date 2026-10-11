#!/usr/bin/env node
/**
 * DOES DECK-E'S FRONT DOOR SEND A MESSAGE TO THE RIGHT PLACE? — the accuracy
 * eval for triage (`apps/api/src/decke/triage.ts`) and the tier decision that
 * consumes it (`decideTier` in `tiers.ts`).
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────
 *
 * Each case in `fixtures/decke-triage/cases.json` is one reader message, with
 * Deck-E's previous reply, the page and an open ask card where they matter.
 * From those the script builds the messages array `api/chat.mjs` replays and
 * derives triage's inputs the way chat.mjs does: the latest user text, the last
 * 800 characters of the previous assistant text, the bounded route,
 * `extractPastedLog` on the latest user message, `answeringAsk` and
 * `carriedFromHistory`. It then runs the REAL `runTriage` (production 2.5 s
 * deadline, heuristic fallback and all) and `decideTier`, imported from source
 * through tsx, so an edit to either file is measured without a build.
 *
 * `heuristicTriage` alone is scored on every case as well: it is what a reader
 * gets whenever the model call times out or fails.
 *
 * Scores: routed primary pathway, acceptable pathway, coverage of mixed
 * requests, tier (under- and over-routing counted apart), expected and
 * forbidden signals, fallback rate, p50/p95 latency and Gateway-reported cost.
 * Cases marked `heldOut` are reported apart from the set the prompt was tuned on.
 *
 * ── IT SPENDS MONEY, SO A LIVE RUN NEEDS A CAP ───────────────────────────────
 *
 * A live run refuses to start without `--budget-usd`. Before every call the
 * cap is checked against spend so far plus in-flight reservations plus the
 * next call's estimate (twice the dearest call seen, or a conservative prior
 * before the first). A call whose cost the Gateway does not report (a timeout
 * aborts it) is counted at its estimate. `--ledger <file>` carries spend across
 * invocations so one cap can cover a whole series of runs.
 *
 * The key is `DECKE_VERCEL_AI_GATEWAY_KEY`, else `AI_GATEWAY_API_KEY` (the same
 * order as chat.mjs's `gatewayKey`). Its value is never printed or written.
 *
 * `--mock` spends nothing: a mock model answers every call with the heuristic's
 * own classification, so the whole pipeline runs with no network. `--help` only
 * prints help. Latency is measured from wherever this runs, not from Vercel.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DECKE_SRC = path.join(ROOT, 'apps/api/src/decke')
export const DEFAULT_CASES = path.join(HERE, 'fixtures/decke-triage/cases.json')
/** Cost assumed for a call before any call has reported one. Deliberately high. */
export const PRIOR_CALL_USD = 0.003
/** chat.mjs passes `previousAssistantText(messages).slice(-800)`. */
export const PREVIOUS_REPLY_CHARS = 800

export const USAGE = `Usage: node scripts/decke-triage-eval.mjs [options]

Scores Deck-E triage + decideTier on scripts/fixtures/decke-triage/cases.json.

  --budget-usd <n>     Hard spend cap in USD. Required for a live run.
  --mock               Spend nothing: a mock model answers with the heuristic.
  --heuristic-only     Score only heuristicTriage (free, no model at all).
  --cases <list>       Comma-separated case ids; also family:<name>, @heldout, @tuned.
  --repeat <n>         Run the model pass n times (1-10) to see variance. Default 1.
  --concurrency <n>    Parallel model calls (1-8). Default 1, as production does.
  --timeout-ms <n>     Triage deadline. Default 2500, production's.
  --ledger <file>      JSON spend ledger; prior spend counts against --budget-usd.
  --out <dir>          Write <label>.json (every row) and <label>.txt (the report).
  --label <name>       Name for the output files. Default triage-<timestamp>.
  --cases-file <file>  Another labelled set.
  -h, --help           Print this and exit. Never starts a run.

Key: DECKE_VERCEL_AI_GATEWAY_KEY, else AI_GATEWAY_API_KEY. Never printed.`

// ─── Arguments ──────────────────────────────────────────────────────────────

export function wantsHelp(argv) {
  return argv.includes('--help') || argv.includes('-h')
}

export function parseArgs(argv) {
  const opts = {
    help: false,
    mock: false,
    heuristicOnly: false,
    budgetUsd: null,
    cases: null,
    repeat: 1,
    concurrency: 1,
    timeoutMs: 2500,
    ledger: null,
    out: null,
    label: null,
    casesFile: DEFAULT_CASES,
  }
  const number = (flag, raw, { min, max, integer }) => {
    const n = Number(raw)
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      throw new Error(`${flag} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}, got ${JSON.stringify(raw)}`)
    }
    return n
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`)
      return v
    }
    switch (flag) {
      case '-h':
      case '--help': opts.help = true; break
      case '--mock': opts.mock = true; break
      case '--heuristic-only': opts.heuristicOnly = true; break
      case '--budget-usd': opts.budgetUsd = number(flag, value(), { min: 0.0001, max: 5, integer: false }); break
      case '--cases': opts.cases = value().split(',').map((s) => s.trim()).filter(Boolean); break
      case '--repeat': opts.repeat = number(flag, value(), { min: 1, max: 10, integer: true }); break
      case '--concurrency': opts.concurrency = number(flag, value(), { min: 1, max: 8, integer: true }); break
      case '--timeout-ms': opts.timeoutMs = number(flag, value(), { min: 100, max: 60_000, integer: true }); break
      case '--ledger': opts.ledger = value(); break
      case '--out': opts.out = value(); break
      case '--label': opts.label = value(); break
      case '--cases-file': opts.casesFile = value(); break
      default: throw new Error(`unknown option ${flag}`)
    }
  }
  if (opts.mock && opts.heuristicOnly) throw new Error('--mock and --heuristic-only are exclusive')
  if (!opts.help && !opts.mock && !opts.heuristicOnly && opts.budgetUsd === null) {
    throw new Error('a live run spends money: pass --budget-usd <n> (or --mock / --heuristic-only)')
  }
  return opts
}

// ─── The system under test, from source ─────────────────────────────────────

let sutPromise = null
/** Import the shipped modules from source through tsx. Memoised. */
export function loadSut() {
  sutPromise ??= (async () => {
    const { register } = await import('tsx/esm/api')
    register()
    const src = (file) => import(pathToFileURL(path.join(DECKE_SRC, file)).href)
    const [triage, tiers, names, models, pasted, wire] = await Promise.all([
      src('triage.ts'), src('tiers.ts'), src('pathways/names.ts'), src('models.ts'), src('pastedLog.ts'), src('wireBounds.ts'),
    ])
    return {
      runTriage: triage.runTriage,
      heuristicTriage: triage.heuristicTriage,
      TRIAGE_SIGNALS: triage.TRIAGE_SIGNALS,
      decideTier: tiers.decideTier,
      carriedFromHistory: tiers.carriedFromHistory,
      answeringAsk: tiers.answeringAsk,
      PATHWAY_NAMES: names.PATHWAY_NAMES,
      TRIAGE_MODEL: models.TRIAGE,
      extractPastedLog: pasted.extractPastedLog,
      boundedRoute: wire.boundedRoute,
    }
  })()
  return sutPromise
}

// ─── Cases ──────────────────────────────────────────────────────────────────

const TIER_NAMES = ['quick', 'standard']
const CASE_KEYS = new Set([
  'id', 'family', 'message', 'previousReply', 'ask', 'route', 'expectedPathways', 'acceptable',
  'expectedTier', 'acceptableTiers', 'expectedSignals', 'forbiddenSignals', 'heldOut', 'note',
])

/** Problems with a labelled set, as strings; empty when it is valid. */
export function validateCases(cases, { pathways, signals }) {
  const problems = []
  const seen = new Set()
  if (!Array.isArray(cases) || cases.length === 0) return ['cases must be a non-empty array']
  const names = (where, list, allowed) => {
    if (list === undefined) return
    if (!Array.isArray(list)) return problems.push(`${where} must be an array`)
    for (const x of list) if (!allowed.includes(x)) problems.push(`${where}: unknown ${JSON.stringify(x)}`)
  }
  for (const c of cases) {
    const id = c?.id
    if (typeof id !== 'string' || !id) { problems.push('a case has no id'); continue }
    if (seen.has(id)) problems.push(`${id}: duplicate id`)
    seen.add(id)
    for (const key of Object.keys(c)) if (!CASE_KEYS.has(key)) problems.push(`${id}: unknown field ${key}`)
    if (typeof c.message !== 'string' || !c.message.trim()) problems.push(`${id}: message is required`)
    if (typeof c.family !== 'string' || !c.family) problems.push(`${id}: family is required`)
    if (!Array.isArray(c.expectedPathways) || c.expectedPathways.length === 0) problems.push(`${id}: expectedPathways is required`)
    names(`${id}.expectedPathways`, c.expectedPathways, pathways)
    names(`${id}.acceptable`, c.acceptable, pathways)
    if (!TIER_NAMES.includes(c.expectedTier)) problems.push(`${id}: expectedTier must be quick or standard`)
    names(`${id}.acceptableTiers`, c.acceptableTiers, TIER_NAMES)
    names(`${id}.expectedSignals`, c.expectedSignals, signals)
    names(`${id}.forbiddenSignals`, c.forbiddenSignals, signals)
    if (c.ask !== undefined && (c.ask === null || typeof c.ask !== 'object')) problems.push(`${id}: ask must be an object`)
    if (c.ask?.about !== undefined) names(`${id}.ask.about`, [c.ask.about], pathways)
  }
  return problems
}

const LOG_TOKEN = /\{\{log:([a-z0-9-]+)\}\}/g

/** The reader's message with `{{log:name}}` replaced by `ptcgl/<name>.txt`. */
export function materializeMessage(message, readLog) {
  return message.replace(LOG_TOKEN, (_, name) => readLog(name).replace(/\r\n/g, '\n').trimEnd())
}

/** PTCG Live logs live in `ptcgl/`: the repo's `.gitignore` drops every `logs/` directory. */
export function fileLogReader(casesFile) {
  const dir = path.join(path.dirname(casesFile), 'ptcgl')
  return (name) => fs.readFileSync(path.join(dir, `${name}.txt`), 'utf8')
}

export function selectCases(cases, tokens) {
  if (!tokens) return cases
  const picked = new Map()
  for (const token of tokens) {
    let hit
    if (token === '@heldout') hit = cases.filter((c) => c.heldOut === true)
    else if (token === '@tuned') hit = cases.filter((c) => c.heldOut !== true)
    else if (token.startsWith('family:')) hit = cases.filter((c) => c.family === token.slice(7))
    else hit = cases.filter((c) => c.id === token)
    if (hit.length === 0) throw new Error(`--cases: nothing matches ${JSON.stringify(token)}`)
    for (const c of hit) picked.set(c.id, c)
  }
  return cases.filter((c) => picked.has(c.id))
}

// ─── Inputs, exactly as api/chat.mjs builds them ────────────────────────────

/** The replayed UI-message array a case stands for. */
export function caseMessages(c, message) {
  const messages = []
  const assistantParts = []
  if (c.previousReply) assistantParts.push({ type: 'text', text: c.previousReply })
  if (c.ask) {
    assistantParts.push({
      type: 'tool-ask_user',
      toolCallId: `ask-${c.id}`,
      state: 'output-available',
      input: { ...(c.ask.about ? { about: c.ask.about } : {}), questions: c.ask.questions ?? [] },
    })
  }
  if (assistantParts.length) {
    messages.push({ role: 'user', parts: [{ type: 'text', text: '(earlier message)' }] })
    messages.push({ role: 'assistant', parts: assistantParts })
  }
  messages.push({ role: 'user', parts: [{ type: 'text', text: message }] })
  return messages
}

/** chat.mjs `latestUserText`: the latest user message's text parts, space-joined. */
export function latestUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'user') continue
    return (Array.isArray(m.parts) ? m.parts : [])
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join(' ')
  }
  return ''
}

/** chat.mjs `previousAssistantText`: the assistant text right before the latest user message. */
export function previousAssistantText(messages) {
  let latestUser = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { latestUser = i; break }
  }
  for (let i = latestUser - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role !== 'assistant') continue
    return (Array.isArray(m.parts) ? m.parts : [])
      .filter((p) => p?.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join(' ')
  }
  return ''
}

export function buildInputs(sut, c, message) {
  const messages = caseMessages(c, message)
  const latestUser = messages.filter((m) => m.role === 'user').at(-1)
  return {
    message: latestUserText(messages),
    previousReply: previousAssistantText(messages).slice(-PREVIOUS_REPLY_CHARS),
    page: sut.boundedRoute(c.route ?? '/'),
    pasted: sut.extractPastedLog(latestUser ? [latestUser] : []) !== null,
    answering: sut.answeringAsk(messages),
    carried: sut.carriedFromHistory(messages),
  }
}

// ─── Scoring (pure) ─────────────────────────────────────────────────────────

/** One case's verdict, given what triage said and where decideTier sent it. */
export function scoreCase(c, triage, decision) {
  const routed = decision.pathways.length ? decision.pathways : ['general']
  const expected = c.expectedPathways
  const allowed = new Set([...expected, ...(c.acceptable ?? [])])
  const tiers = [c.expectedTier, ...(c.acceptableTiers ?? [])]
  const tierOk = tiers.includes(decision.tier)
  const missingSignals = (c.expectedSignals ?? []).filter((s) => !triage.signals.includes(s))
  const forbiddenSignals = (c.forbiddenSignals ?? []).filter((s) => triage.signals.includes(s))
  return {
    primary: routed[0] === expected[0],
    acceptable: allowed.has(routed[0]),
    multi: expected.length > 1,
    // Only a mixed request can be half-routed; a single-pathway case is
    // judged by `acceptable` alone.
    covered: expected.length > 1 ? expected.every((p) => routed.includes(p)) : true,
    tierOk,
    tierMiss: tierOk ? null : decision.tier === 'quick' ? 'under' : 'over',
    signalsLabelled: (c.expectedSignals?.length ?? 0) + (c.forbiddenSignals?.length ?? 0) > 0,
    signalsOk: missingSignals.length === 0 && forbiddenSignals.length === 0,
    missingSignals,
    forbiddenSignals,
  }
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const rank = Math.ceil(p * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))]
}

const ratio = (hits, n) => ({ hits, n, rate: n ? hits / n : null })

/** Aggregate scored rows: `{ case, score, result }`. */
export function summarize(rows) {
  const count = (pred) => rows.filter(pred).length
  const multi = rows.filter((r) => r.score.multi)
  const labelled = rows.filter((r) => r.score.signalsLabelled)
  const ms = rows.map((r) => r.result.ms).filter((x) => typeof x === 'number').sort((a, b) => a - b)
  const costs = rows.map((r) => r.result.costUsd).filter((x) => typeof x === 'number')
  return {
    n: rows.length,
    primary: ratio(count((r) => r.score.primary), rows.length),
    acceptable: ratio(count((r) => r.score.acceptable), rows.length),
    coverage: ratio(multi.filter((r) => r.score.covered).length, multi.length),
    tier: ratio(count((r) => r.score.tierOk), rows.length),
    under: count((r) => r.score.tierMiss === 'under'),
    over: count((r) => r.score.tierMiss === 'over'),
    signals: ratio(labelled.filter((r) => r.score.signalsOk).length, labelled.length),
    fallback: ratio(count((r) => r.result.source === 'heuristic'), rows.length),
    latencyMs: { p50: percentile(ms, 0.5), p95: percentile(ms, 0.95), max: ms.at(-1) ?? null },
    reportedCostUsd: costs.reduce((a, b) => a + b, 0),
  }
}

/** Accuracy grouped by a key of the case (its expected primary, its family). */
export function breakdown(rows, keyOf) {
  const groups = new Map()
  for (const r of rows) {
    const key = keyOf(r.case)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rs]) => ({
      key,
      n: rs.length,
      primary: rs.filter((r) => r.score.primary).length,
      acceptable: rs.filter((r) => r.score.acceptable).length,
      tier: rs.filter((r) => r.score.tierOk).length,
    }))
}

export function routeKey(result) {
  return `${result.pathways.join('+')}/${result.tier}`
}

/** Cases whose route (pathways or tier) differed between repeated runs. */
export function unstableCases(runs) {
  const byCase = new Map()
  for (const rows of runs) {
    for (const r of rows) {
      if (!byCase.has(r.case.id)) byCase.set(r.case.id, [])
      byCase.get(r.case.id).push(routeKey(r.result))
    }
  }
  return [...byCase.entries()]
    .filter(([, keys]) => new Set(keys).size > 1)
    .map(([id, keys]) => ({ id, routes: keys }))
}

/** Misses folded across runs: one line per case and outcome, with a count. */
export function confusions(rows) {
  const folded = new Map()
  for (const r of rows) {
    const s = r.score
    if (s.acceptable && s.tierOk && s.covered && s.signalsOk) continue
    const why = [
      !s.acceptable ? 'pathway' : null,
      !s.covered ? 'coverage' : null,
      !s.tierOk ? `tier-${s.tierMiss}` : null,
      s.missingSignals.length ? `missing:${s.missingSignals.join(',')}` : null,
      s.forbiddenSignals.length ? `forbidden:${s.forbiddenSignals.join(',')}` : null,
    ].filter(Boolean)
    const key = `${r.case.id}|${routeKey(r.result)}|${why.join(' ')}`
    const entry = folded.get(key) ?? {
      id: r.case.id,
      family: r.case.family,
      heldOut: r.case.heldOut === true,
      expected: `${r.case.expectedPathways.join('+')}/${r.case.expectedTier}`,
      got: routeKey(r.result),
      triage: `${r.result.triagePathway}${r.result.also ? `+${r.result.also}` : ''}`,
      signals: r.result.signals,
      wantsDeep: r.result.wantsDeep,
      reasons: r.result.reasons,
      source: r.result.fallbackReason ? `heuristic (${r.result.fallbackReason})` : r.result.source,
      why,
      times: 0,
    }
    entry.times += 1
    folded.set(key, entry)
  }
  return [...folded.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// ─── Spend ──────────────────────────────────────────────────────────────────

/** A hard cap checked BEFORE every call; unknown costs count at their estimate. */
export class Budget {
  constructor(capUsd, { alreadySpentUsd = 0, priorCallUsd = PRIOR_CALL_USD } = {}) {
    this.capUsd = capUsd
    this.priorSpentUsd = alreadySpentUsd
    this.spentUsd = 0
    this.reportedUsd = 0
    this.reservedUsd = 0
    this.priorCallUsd = priorCallUsd
    this.dearestUsd = 0
    this.calls = 0
    this.unknownCost = 0
  }
  estimate() {
    return this.dearestUsd > 0 ? this.dearestUsd * 2 : this.priorCallUsd
  }
  /** The amount reserved, or null when the next call could cross the cap. */
  tryReserve() {
    const next = this.estimate()
    if (this.priorSpentUsd + this.spentUsd + this.reservedUsd + next > this.capUsd) return null
    this.reservedUsd += next
    return next
  }
  settle(reservedUsd, actualUsd) {
    this.reservedUsd = Math.max(0, this.reservedUsd - reservedUsd)
    this.calls += 1
    if (typeof actualUsd === 'number' && Number.isFinite(actualUsd)) {
      this.spentUsd += actualUsd
      this.reportedUsd += actualUsd
      this.dearestUsd = Math.max(this.dearestUsd, actualUsd)
    } else {
      this.spentUsd += reservedUsd
      this.unknownCost += 1
    }
  }
}

export function readLedger(file) {
  if (!file || !fs.existsSync(file)) return { totalUsd: 0, entries: [] }
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { totalUsd: Number(ledger.totalUsd) || 0, entries: Array.isArray(ledger.entries) ? ledger.entries : [] }
}

export function writeLedger(file, ledger, entry) {
  const entries = [...ledger.entries, entry]
  const totalUsd = entries.reduce((sum, e) => sum + (Number(e.countedUsd) || 0), 0)
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify({ totalUsd, entries }, null, 2)}\n`)
  return totalUsd
}

/** `providerMetadata.gateway.cost`, the Gateway's own figure, as a number. */
export function gatewayCost(metadata) {
  const raw = metadata?.gateway?.cost
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** An error's shape for the record, with anything key-like removed. */
export function safeError(error) {
  const e = error ?? {}
  const message = String(e.message ?? e).replace(/[A-Za-z0-9_\-.]{24,}/g, '[redacted]').slice(0, 160)
  return { name: e.name ?? 'Error', status: e.statusCode ?? e.status ?? null, message }
}

// ─── Running ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function observedModel(base, record) {
  const { wrapLanguageModel } = await import('ai')
  let settle
  record.settled = new Promise((resolve) => { settle = resolve })
  return wrapLanguageModel({
    model: base,
    middleware: {
      specificationVersion: 'v4',
      wrapGenerate: async ({ doGenerate }) => {
        record.invoked = true
        try {
          const result = await doGenerate()
          record.outcome = 'ok'
          record.costUsd = gatewayCost(result.providerMetadata)
          record.inputTokens = result.usage?.inputTokens?.total ?? null
          record.outputTokens = result.usage?.outputTokens?.total ?? null
          // Kept so a schema-invalid call can be diagnosed; synthetic data only.
          const call = (result.content ?? []).find((part) => part?.type === 'tool-call')
          record.toolInput = typeof call?.input === 'string' ? call.input.slice(0, 1_200) : null
          return result
        } catch (error) {
          const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError' || /timed out/i.test(String(error?.message))
          record.outcome = timedOut ? 'timeout' : 'error'
          record.error = safeError(error)
          throw error
        } finally {
          settle()
        }
      },
    },
  })
}

async function mockModel(sut, inputs) {
  const { MockLanguageModelV3 } = await import('ai/test')
  const { carried: _carried, ...seen } = inputs
  const { source: _source, ...args } = sut.heuristicTriage(seen)
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'tool-call', toolCallId: 'mock-triage', toolName: 'triage', input: JSON.stringify(args) }],
      finishReason: { unified: 'tool-calls', raw: 'tool_use' },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
      providerMetadata: { gateway: { cost: '0' } },
      warnings: [],
    }),
  })
}

function resultOf(triage, decision, extra = {}) {
  return {
    source: triage.source,
    fallbackReason: triage.fallbackReason ?? null,
    triagePathway: triage.pathway,
    also: triage.also,
    signals: triage.signals,
    wantsDeep: triage.wantsDeep,
    missing: triage.missing,
    pathways: decision.pathways.length ? decision.pathways : ['general'],
    tier: decision.tier,
    effort: decision.effort,
    reasons: decision.reasons,
    ...extra,
  }
}

/** The heuristic on exactly what `runTriage` hands its fallback (everything but the model). */
export function runHeuristic(sut, prepared) {
  return prepared.map(({ case: c, inputs }) => {
    const triage = sut.heuristicTriage({
      message: inputs.message,
      previousReply: inputs.previousReply,
      page: inputs.page,
      pasted: inputs.pasted,
      answering: inputs.answering,
    })
    const decision = sut.decideTier({ triage, carried: inputs.carried, deepApproved: false, pastedLog: inputs.pasted })
    return { case: c, score: scoreCase(c, triage, decision), result: resultOf(triage, decision) }
  })
}

async function runModelCase(sut, item, { base, mock, timeoutMs }) {
  const { case: c, inputs } = item
  const record = {}
  const model = await observedModel(mock ? await mockModel(sut, inputs) : base, record)
  const started = performance.now()
  const triage = await sut.runTriage({
    message: inputs.message,
    previousReply: inputs.previousReply,
    page: inputs.page,
    pasted: inputs.pasted,
    answering: inputs.answering,
    model,
    timeoutMs,
  })
  const ms = Math.round(performance.now() - started)
  if (record.invoked) await Promise.race([record.settled, sleep(5_000)])
  const decision = sut.decideTier({ triage, carried: inputs.carried, deepApproved: false, pastedLog: inputs.pasted })
  // triage.ts names its own fallback reason; the middleware's view is the
  // backstop for a build of triage.ts that predates `fallbackReason`.
  const outcome = triage.source === 'model'
    ? 'ok'
    : triage.fallbackReason ?? (record.outcome === 'ok' ? 'invalid' : (record.outcome ?? 'not-invoked'))
  return {
    case: c,
    score: scoreCase(c, triage, decision),
    result: resultOf(triage, decision, {
      ms,
      costUsd: record.costUsd ?? null,
      inputTokens: record.inputTokens ?? null,
      outputTokens: record.outputTokens ?? null,
      outcome,
      error: record.error ?? null,
      invalidToolInput: triage.source === 'heuristic' && record.outcome === 'ok' ? record.toolInput ?? null : null,
    }),
  }
}

const ACCOUNT_REFUSALS = new Set([401, 402, 403])

/** One model pass over the prepared cases; stops cleanly at the budget or an account-level refusal. */
export async function runModelPass(sut, prepared, { base, mock, timeoutMs, concurrency, budget, onRow }) {
  const rows = new Array(prepared.length)
  let next = 0
  let stopped = null
  const worker = async () => {
    while (!stopped && next < prepared.length) {
      const index = next++
      const reserved = mock ? 0 : budget.tryReserve()
      if (reserved === null) {
        stopped = `budget: the next call could cross $${budget.capUsd}`
        break
      }
      const row = await runModelCase(sut, prepared[index], { base, mock, timeoutMs })
      if (!mock) budget.settle(reserved, row.result.costUsd)
      rows[index] = row
      onRow?.(row)
      // An account-level refusal (bad key, no Gateway credit) fails every call
      // after it too: on 2026-10-10 a 402 turned 391 calls into heuristic rows,
      // each still counted against the cap at its estimate.
      const status = row.result.error?.status
      if (ACCOUNT_REFUSALS.has(status)) stopped = `the Gateway refused with ${status}: ${row.result.error.message.slice(0, 80)}`
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, prepared.length) }, worker))
  return { rows: rows.filter(Boolean), stopped }
}

// ─── Report ─────────────────────────────────────────────────────────────────

const pct = (r) => (r.n ? `${r.hits}/${r.n} ${(100 * r.rate).toFixed(1).padStart(5)}%` : '—')
const usd = (n) => `$${n.toFixed(n < 0.01 ? 5 : 4)}`

function summaryLine(label, s) {
  return [
    label.padEnd(22),
    String(s.n).padStart(4),
    pct(s.primary).padStart(16),
    pct(s.acceptable).padStart(16),
    pct(s.coverage).padStart(14),
    pct(s.tier).padStart(16),
    String(s.under).padStart(6),
    String(s.over).padStart(5),
    pct(s.signals).padStart(14),
    pct(s.fallback).padStart(14),
  ].join(' ')
}

const HEADER = [
  ''.padEnd(22), 'n'.padStart(4), 'primary'.padStart(16), 'acceptable'.padStart(16), 'coverage'.padStart(14),
  'tier'.padStart(16), 'under'.padStart(6), 'over'.padStart(5), 'signals'.padStart(14), 'fallback'.padStart(14),
].join(' ')

function confusionLines(rows, limit = 200) {
  return confusions(rows).slice(0, limit).map((m) =>
    `  ${m.heldOut ? '[held-out] ' : ''}${m.id} (${m.family}) — expected ${m.expected}, got ${m.got}` +
    ` [triage ${m.triage}${m.wantsDeep !== 'no' ? `, deep:${m.wantsDeep}` : ''}; signals ${m.signals.join(',') || '-'}; ${m.reasons.join(',')}; ${m.source}]` +
    ` ${m.why.join(' ')}${m.times > 1 ? ` x${m.times}` : ''}`,
  )
}

function breakdownLines(title, rows, keyOf) {
  return [
    title,
    ...breakdown(rows, keyOf).map((g) =>
      `  ${g.key.padEnd(18)} n=${String(g.n).padStart(3)}  primary ${String(g.primary).padStart(3)}  acceptable ${String(g.acceptable).padStart(3)}  tier ${String(g.tier).padStart(3)}`),
  ]
}

export function formatReport(report) {
  const { meta, modelRuns, heuristic } = report
  const lines = []
  lines.push(`Deck-E triage eval  ${meta.when}  mode=${meta.mode}  model=${meta.model}  timeout=${meta.timeoutMs}ms  concurrency=${meta.concurrency}`)
  lines.push(`cases ${meta.cases} (tuned ${meta.tuned}, held-out ${meta.heldOut})  repeat ${meta.repeat}  triage.ts@${meta.sources['triage.ts']}  tiers.ts@${meta.sources['tiers.ts']}  head ${meta.head}`)
  if (meta.stopped) lines.push(`STOPPED EARLY — ${meta.stopped}`)
  for (const notice of meta.notices) lines.push(`NOTE: ${notice}`)
  lines.push('', HEADER)
  const all = modelRuns.flat()
  const split = (rows, held) => rows.filter((r) => (r.case.heldOut === true) === held)
  if (meta.tuned > 0) {
    lines.push('tuned set')
    modelRuns.forEach((rows, i) => lines.push(summaryLine(`model run ${i + 1}`, summarize(split(rows, false)))))
    if (modelRuns.length > 1) lines.push(summaryLine('model all runs', summarize(split(all, false))))
    lines.push(summaryLine('heuristic alone', summarize(split(heuristic, false))))
  }
  if (meta.heldOut > 0) {
    lines.push('held-out (never tuned on)')
    modelRuns.forEach((rows, i) => lines.push(summaryLine(`model run ${i + 1}`, summarize(split(rows, true)))))
    if (modelRuns.length > 1) lines.push(summaryLine('model all runs', summarize(split(all, true))))
    lines.push(summaryLine('heuristic alone', summarize(split(heuristic, true))))
  }
  if (all.length) {
    const s = summarize(all)
    lines.push('')
    lines.push(`latency (runTriage wall time, all model calls): p50 ${s.latencyMs.p50} ms  p95 ${s.latencyMs.p95} ms  max ${s.latencyMs.max} ms`)
    const outcomes = {}
    for (const r of all) outcomes[r.result.outcome] = (outcomes[r.result.outcome] ?? 0) + 1
    lines.push(`call outcomes: ${Object.entries(outcomes).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    lines.push(`cost: Gateway-reported ${usd(report.spend.reportedUsd)} over ${report.spend.calls} calls` +
      ` (${report.spend.calls ? usd(report.spend.reportedUsd / Math.max(1, report.spend.calls - report.spend.unknownCost)) : '-'}/reported call);` +
      ` counted against the cap ${usd(report.spend.countedUsd)}${report.spend.unknownCost ? ` (${report.spend.unknownCost} unreported, at estimate)` : ''};` +
      ` ledger before ${usd(report.spend.ledgerBeforeUsd)}; cap ${report.spend.capUsd === null ? 'n/a' : usd(report.spend.capUsd)}`)
  }
  if (modelRuns.length > 1) {
    const unstable = unstableCases(modelRuns)
    lines.push('', `unstable across runs (route or tier differed): ${unstable.length}`)
    for (const u of unstable) lines.push(`  ${u.id}: ${u.routes.join(' | ')}`)
  }
  if (all.length) {
    lines.push('', 'model misses (folded across runs; pathway = primary not acceptable)')
    lines.push(...confusionLines(all))
    lines.push('', ...breakdownLines('model, by expected primary pathway (all runs)', all, (c) => c.expectedPathways[0]))
    lines.push('', ...breakdownLines('model, by family (all runs)', all, (c) => c.family))
  }
  lines.push('', 'heuristic misses')
  lines.push(...confusionLines(heuristic))
  lines.push('', ...breakdownLines('heuristic, by expected primary pathway', heuristic, (c) => c.expectedPathways[0]))
  return lines.join('\n')
}

// ─── Main ───────────────────────────────────────────────────────────────────

function shortHash(file) {
  try {
    return createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 10)
  } catch {
    return 'unreadable'
  }
}

function gitHead() {
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git'), 'utf8')
    const gitdir = head.startsWith('gitdir:') ? head.slice(7).trim() : path.join(ROOT, '.git')
    const ref = fs.readFileSync(path.join(gitdir, 'HEAD'), 'utf8').trim()
    if (!ref.startsWith('ref:')) return ref.slice(0, 10)
    const name = ref.slice(4).trim()
    const common = fs.existsSync(path.join(gitdir, 'commondir'))
      ? path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim())
      : gitdir
    for (const dir of [gitdir, common]) {
      const loose = path.join(dir, name)
      if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim().slice(0, 10)
    }
    return name
  } catch {
    return 'unknown'
  }
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? ((line) => console.log(line))
  const error = deps.error ?? ((line) => console.error(line))
  // Help is answered before anything else is parsed or loaded, so no
  // combination of flags beside it can start a run.
  if (wantsHelp(argv)) {
    log(USAGE)
    return 0
  }
  let opts
  try {
    opts = parseArgs(argv)
  } catch (e) {
    error(`decke-triage-eval: ${e.message}\n\n${USAGE}`)
    return 2
  }
  const sut = await (deps.loadSut ?? loadSut)()
  const raw = JSON.parse(fs.readFileSync(opts.casesFile, 'utf8'))
  const allCases = Array.isArray(raw) ? raw : raw.cases
  const problems = validateCases(allCases, { pathways: sut.PATHWAY_NAMES, signals: sut.TRIAGE_SIGNALS })
  if (problems.length) {
    error(`decke-triage-eval: ${opts.casesFile} is invalid:\n  ${problems.join('\n  ')}`)
    return 2
  }
  let cases
  try {
    cases = selectCases(allCases, opts.cases)
  } catch (e) {
    error(`decke-triage-eval: ${e.message}`)
    return 2
  }
  const readLog = fileLogReader(opts.casesFile)
  const notices = []
  const prepared = cases.map((c) => {
    const inputs = buildInputs(sut, c, materializeMessage(c.message, readLog))
    const wantsPaste = /\{\{log:/.test(c.message)
    if (wantsPaste !== inputs.pasted) notices.push(`${c.id}: extractPastedLog says pasted=${inputs.pasted}, the case ${wantsPaste ? 'embeds' : 'has no'} log`)
    return { case: c, inputs }
  })

  const mode = opts.heuristicOnly ? 'heuristic-only' : opts.mock ? 'mock' : 'live'
  const ledger = opts.mock || opts.heuristicOnly ? { totalUsd: 0, entries: [] } : readLedger(opts.ledger)
  const budget = new Budget(opts.budgetUsd ?? Infinity, { alreadySpentUsd: ledger.totalUsd })
  let base = null
  let keyName = null
  if (mode === 'live') {
    keyName = process.env.DECKE_VERCEL_AI_GATEWAY_KEY ? 'DECKE_VERCEL_AI_GATEWAY_KEY' : process.env.AI_GATEWAY_API_KEY ? 'AI_GATEWAY_API_KEY' : null
    if (!keyName) {
      error('decke-triage-eval: set DECKE_VERCEL_AI_GATEWAY_KEY or AI_GATEWAY_API_KEY (never printed), or use --mock')
      return 2
    }
    if (ledger.totalUsd + budget.estimate() > budget.capUsd) {
      error(`decke-triage-eval: the ledger already holds ${usd(ledger.totalUsd)} of the ${usd(budget.capUsd)} cap`)
      return 3
    }
    const { createGateway } = await import('@ai-sdk/gateway')
    base = createGateway({ apiKey: process.env[keyName] })(sut.TRIAGE_MODEL.id)
  }

  const modelRuns = []
  let stopped = null
  if (mode !== 'heuristic-only') {
    for (let run = 0; run < opts.repeat && !stopped; run++) {
      let done = 0
      const pass = await runModelPass(sut, prepared, {
        base,
        mock: mode === 'mock',
        timeoutMs: opts.timeoutMs,
        concurrency: opts.concurrency,
        budget,
        onRow: () => {
          done += 1
          if (done % 10 === 0 || done === prepared.length) error(`  run ${run + 1}: ${done}/${prepared.length}`)
        },
      })
      modelRuns.push(pass.rows)
      stopped = pass.stopped
    }
  }
  const heuristic = runHeuristic(sut, prepared)

  const label = opts.label ?? `triage-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const report = {
    meta: {
      label,
      when: new Date().toISOString(),
      mode,
      model: mode === 'heuristic-only' ? 'none' : mode === 'mock' ? 'mock (heuristic answers)' : sut.TRIAGE_MODEL.id,
      keyEnv: keyName,
      timeoutMs: opts.timeoutMs,
      concurrency: opts.concurrency,
      repeat: opts.repeat,
      cases: cases.length,
      tuned: cases.filter((c) => c.heldOut !== true).length,
      heldOut: cases.filter((c) => c.heldOut === true).length,
      casesFile: path.relative(ROOT, path.resolve(opts.casesFile)),
      sources: {
        'triage.ts': shortHash(path.join(DECKE_SRC, 'triage.ts')),
        'tiers.ts': shortHash(path.join(DECKE_SRC, 'tiers.ts')),
      },
      head: gitHead(),
      stopped,
      notices,
    },
    spend: {
      capUsd: opts.budgetUsd,
      ledgerBeforeUsd: ledger.totalUsd,
      calls: budget.calls,
      reportedUsd: budget.reportedUsd,
      countedUsd: budget.spentUsd,
      unknownCost: budget.unknownCost,
    },
    modelRuns,
    heuristic,
  }
  if (mode === 'live' && opts.ledger) {
    report.spend.ledgerAfterUsd = writeLedger(opts.ledger, ledger, {
      when: report.meta.when, label, calls: budget.calls, reportedUsd: budget.reportedUsd, countedUsd: budget.spentUsd,
    })
  }
  const text = formatReport(report)
  log(text)
  if (opts.out) {
    fs.mkdirSync(opts.out, { recursive: true })
    const strip = (rows) => rows.map((r) => ({ id: r.case.id, family: r.case.family, heldOut: r.case.heldOut === true, score: r.score, result: r.result }))
    const json = {
      ...report,
      summaries: {
        modelRuns: modelRuns.map((rows) => summarize(rows.filter((r) => r.case.heldOut !== true))),
        modelHeldOut: modelRuns.map((rows) => summarize(rows.filter((r) => r.case.heldOut === true))),
        heuristic: summarize(heuristic.filter((r) => r.case.heldOut !== true)),
        heuristicHeldOut: summarize(heuristic.filter((r) => r.case.heldOut === true)),
      },
      modelRuns: modelRuns.map(strip),
      heuristic: strip(heuristic),
    }
    fs.writeFileSync(path.join(opts.out, `${label}.json`), `${JSON.stringify(json, null, 2)}\n`)
    fs.writeFileSync(path.join(opts.out, `${label}.txt`), `${text}\n`)
    error(`wrote ${path.join(opts.out, label)}.{json,txt}`)
  }
  return stopped ? 3 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code }, (e) => {
    console.error(`decke-triage-eval: ${e?.stack ?? e}`)
    process.exitCode = 1
  })
}
