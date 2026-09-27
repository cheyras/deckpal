/**
 * HOW GOOD IS A JEV JUDGMENT, ON DECK-E'S OWN FAILURES? — the eval behind every
 * Jev threshold in `apps/api/src/decke/` (`reflex.ts` and its siblings).
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────
 *
 * The labelled set `apps/api/src/decke/eval/judgments.json` (SYNTHETIC prompts
 * only, in the shape of the failure classes DECISIONS.md records) is scored
 * twice: by the heuristic Deck-E runs today — the real `readerNamedPrinting`,
 * `phantomClaims`, `promisedWithoutActing` and `declinedCalls`, imported, not
 * copied — and by Jev asked the SHIPPED questions through the Gateway. It
 * prints accuracy, precision/recall at the shipped thresholds, latency p50/p95
 * and the Gateway's reported cost.
 *
 * The free half (the heuristics) also runs in CI as
 * `__tests__/judgmentsEval.test.ts`, so the set cannot rot silently.
 *
 * ── IT SPENDS MONEY, SO IT HAS A CAP ─────────────────────────────────────────
 *
 * Jev is input-priced at $0.042 per million tokens; one full pass over the set
 * is ~95k tokens, about $0.004. `--budget` (default $0.50) is a hard stop checked
 * before every call against the Gateway's own reported cost. The key is read
 * from `AI_GATEWAY_API_KEY` or `DECKE_VERCEL_AI_GATEWAY_KEY` and never printed.
 * Latency is measured from wherever this runs, which is not where Vercel runs.
 *
 * ── IT READS FROM `dist/`, SO BUILD FIRST ────────────────────────────────────
 *
 *   pnpm --filter @deckpal/db build && pnpm --filter @deckpal/agent-tools build \
 *     && pnpm --filter deckpal-api build
 *   node scripts/decke-jev-eval.mjs [--repeat 3] [--budget 0.5] [--out results.json]
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { evaluate } from '../apps/api/dist/decke/jev.js'
import { scoreSet } from '../apps/api/dist/decke/eval/score.js'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const repeat = Number(arg('repeat', '1'))
const budget = Number(arg('budget', '0.5'))
const out = arg('out', null)
// RE-SCORE WITHOUT PAYING: `--replay earlier.json` answers every question from
// a previous run's saved answers, so a threshold or a decision rule can be
// re-chosen at no cost. Latency and spend are then meaningless and say so.
const replay = arg('replay', null)
const key = process.env.AI_GATEWAY_API_KEY ?? process.env.DECKE_VERCEL_AI_GATEWAY_KEY
if (!key && !replay) {
  console.error('Set AI_GATEWAY_API_KEY (or DECKE_VERCEL_AI_GATEWAY_KEY). It is never printed.')
  process.exit(2)
}
const set = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../apps/api/src/decke/eval/judgments.json', import.meta.url)), 'utf8'))

let spent = 0
let tokens = 0
const calls = []
/** One Jev call through the SHIPPED client, with the eval's own deadline. */
async function ask(label, state, questions) {
  if (spent >= budget) throw new Error(`budget of $${budget} reached after ${calls.length} calls`)
  const j = await evaluate(state, questions, { key, label, force: true, timeoutMs: 15_000 })
  if (j) {
    spent += Number(j.costUsd ?? 0)
    tokens += j.inputTokens ?? 0
  }
  calls.push({ label, ok: !!j, ms: j?.ms ?? null, inputTokens: j?.inputTokens ?? null, costUsd: j?.costUsd ?? null })
  return j?.answers ?? null
}

const runs = []
if (replay) {
  const saved = JSON.parse(fs.readFileSync(replay, 'utf8')).runs
  for (const run of saved) {
    const queue = Object.fromEntries(Object.entries(run.answers ?? {}).map(([k, v]) => [`eval-${k}`, [...v]]))
    runs.push(await scoreSet(set, async (label) => queue[label]?.shift()?.answers ?? null))
  }
} else {
  for (let r = 0; r < repeat; r++) runs.push(await scoreSet(set, ask))
}
const ms = calls.filter((c) => c.ok).map((c) => c.ms).sort((a, b) => a - b)
const pct = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]
const byLabel = (l) => {
  const cs = calls.filter((c) => c.ok && c.label === l)
  return cs.length ? { calls: cs.length, meanInputTokens: Math.round(cs.reduce((n, c) => n + c.inputTokens, 0) / cs.length),
    meanCostUsd: cs.reduce((n, c) => n + Number(c.costUsd ?? 0), 0) / cs.length } : null
}
const summary = {
  when: new Date().toISOString(),
  repeat,
  calls: calls.length,
  failedCalls: calls.filter((c) => !c.ok).length,
  latencyMs: { p50: pct(0.5), p95: pct(0.95), max: ms[ms.length - 1] },
  inputTokens: tokens,
  spentUsd: Number(spent.toFixed(8)),
  perCall: Object.fromEntries([...new Set(calls.map((c) => c.label))].map((l) => [l.replace('eval-', ''), byLabel(l)])),
  runs,
}
console.log(JSON.stringify(summary, null, 2))
if (out) fs.writeFileSync(out, JSON.stringify({ ...summary, calls }, null, 2))
