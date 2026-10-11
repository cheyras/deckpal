#!/usr/bin/env node
/**
 * Could Jev route Deck-E instead of Haiku triage? Measured on the triage eval's
 * own cases, against Haiku in the same pass.
 *
 * Jev (`typesafe-ai/jev`, the Gateway's evaluation model) already reads every
 * reader message for the reflex (`decke/reflex.ts`): p50 0.28 s, about a third
 * of a cent per thousand messages. Haiku triage (`decke/triage.ts`) runs beside
 * it at p50 ~1.1 s, so the first reply waits for Haiku. If Jev can name the
 * pathway and the tier-raising signals well enough, the front door gets about
 * 0.8 s faster.
 *
 * Each case is sent to BOTH, concurrently, as production sends them:
 *   - Jev: the production `readJevRoute` (`apps/api/src/decke/jevRoute.ts`) —
 *     one `/v1/evaluate` call, the pathway as a choice over the twelve and four
 *     yes/no signals, turned into a `Triage` with the same code rules — at
 *     threshold 0, so every threshold can be scored from one pass.
 *   - Haiku: the real `runTriage`, exactly as `decke-triage-eval.mjs` runs it.
 * and scored with that script's own `scoreCase`. Three routers are reported:
 * Jev alone, Haiku alone, and a HYBRID at several confidence thresholds — Jev
 * when its pathway answer is confident, otherwise Haiku. The hybrid's latency is
 * Jev's when Jev is used and the slower of the two otherwise (both start at once).
 *
 * The key is `DECKE_VERCEL_AI_GATEWAY_KEY`, else `AI_GATEWAY_API_KEY` (chat.mjs's
 * order); its value is never printed. A live run REQUIRES `--budget-usd` — the
 * cap on spend, with a Haiku call whose cost the Gateway does not report (a
 * timeout) counted at an estimate — so no bare invocation spends anything.
 * `--help` only prints help.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DEFAULT_CASES, buildInputs, fileLogReader, loadSut, materializeMessage, percentile, scoreCase, selectCases,
} from './decke-triage-eval.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DECKE_SRC = path.join(HERE, '..', 'apps/api/src/decke')

export const USAGE = `Usage: node scripts/decke-jev-route-eval.mjs [options]
  --cases <tokens>     Case selection, as decke-triage-eval.mjs (default: all).
  --repeat <n>         Passes over the cases (default 1).
  --budget-usd <x>     Required for a live run: stop before spend could cross this.
  --out <file>         Write every row as JSON.
  --no-zdr             Drop Jev's zero-data-retention flag, keeping its provider
                       pin, for a key whose Vercel plan has no ZDR (a Hobby plan
                       answers 403). The cases are test fixtures, but some quote
                       real game logs with player names: run it only on a key
                       you would trust with those.
  --help               Print this.`

export function parseArgs(argv) {
  const opts = { cases: null, repeat: 1, budgetUsd: null, out: null, noZdr: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v }
    if (a === '--cases') opts.cases = val().split(',').filter(Boolean)
    else if (a === '--repeat') opts.repeat = Math.max(1, Number(val()))
    else if (a === '--budget-usd') opts.budgetUsd = Number(val())
    else if (a === '--out') opts.out = val()
    else if (a === '--no-zdr') opts.noZdr = true
    else throw new Error(`unknown option ${a}\n${USAGE}`)
  }
  if (opts.budgetUsd !== null && (!Number.isFinite(opts.budgetUsd) || opts.budgetUsd <= 0)) throw new Error('--budget-usd must be positive')
  return opts
}

export const HAIKU_ESTIMATE_USD = 0.0004
export const JEV_ESTIMATE_USD = 0.00006
const NEXT_CASE_USD = HAIKU_ESTIMATE_USD + JEV_ESTIMATE_USD

const ratio = (n, d) => ({ n, d, pct: d ? (100 * n) / d : null })

export function summarizeRouter(rows) {
  const ok = (k) => rows.filter((r) => r[k]).length
  const ms = rows.map((r) => r.ms).filter((x) => typeof x === 'number').sort((a, b) => a - b)
  return {
    n: rows.length,
    primary: ratio(ok('primary'), rows.length),
    acceptable: ratio(ok('acceptable'), rows.length),
    tier: ratio(ok('tierOk'), rows.length),
    under: rows.filter((r) => r.tierMiss === 'under').length,
    over: rows.filter((r) => r.tierMiss === 'over').length,
    p50: percentile(ms, 0.5),
    p95: percentile(ms, 0.95),
  }
}

/** The hybrid at threshold `t`: Jev's route when confident, Haiku's otherwise. */
export function hybridRows(pairs, t) {
  return pairs.map((pair) => {
    const useJev = pair.jev && pair.jev.confidence >= t
    const pick = useJev ? pair.jev : pair.haiku
    return { ...pick.score, ms: useJev ? pair.jev.ms : Math.max(pair.jev?.ms ?? 0, pair.haiku.ms), usedJev: useJev }
  })
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return }
  const opts = parseArgs(argv)
  if (opts.budgetUsd === null) throw new Error('A live run spends money: pass --budget-usd <cap>.\n' + USAGE)
  const key = process.env.DECKE_VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY
  if (!key) throw new Error('Need DECKE_VERCEL_AI_GATEWAY_KEY or AI_GATEWAY_API_KEY for a live run.')

  const sut = await loadSut()
  const src = (file) => import(pathToFileURL(path.join(DECKE_SRC, file)).href)
  const { readJevRoute } = await src('jevRoute.ts')
  const { createGateway } = await import('@ai-sdk/gateway')
  const { wrapLanguageModel } = await import('ai')
  const gateway = createGateway({ apiKey: key })
  // jev.ts always asks for ZDR, which a Hobby-plan key cannot have. These cases
  // are synthetic, so --no-zdr drops that one flag and keeps `only`, so the same
  // TypeSafe host answers (the unpinned route goes elsewhere first, 2026-09-26).
  const fetchImpl = opts.noZdr
    ? (url, init) => {
        const body = JSON.parse(init.body)
        delete body.providerOptions.gateway.zeroDataRetention
        return fetch(url, { ...init, body: JSON.stringify(body) })
      }
    : undefined

  const raw = JSON.parse(fs.readFileSync(DEFAULT_CASES, 'utf8'))
  const cases = selectCases(Array.isArray(raw) ? raw : raw.cases, opts.cases)
  const readLog = fileLogReader(DEFAULT_CASES)
  let spent = 0
  const pairs = []

  for (let pass = 1; pass <= opts.repeat; pass++) {
    for (const c of cases) {
      // The next case could cost about one Haiku call and one Jev call.
      if (spent + NEXT_CASE_USD > opts.budgetUsd) { console.log(`stopping: spent ~$${spent.toFixed(4)}; the next case could cross $${opts.budgetUsd}`); break }
      const inputs = buildInputs(sut, c, materializeMessage(c.message, readLog))
      let haikuCost = 0
      let haikuReported = false
      const haikuModel = wrapLanguageModel({
        model: gateway(sut.TRIAGE_MODEL.id),
        middleware: {
          specificationVersion: 'v4',
          wrapGenerate: async ({ doGenerate }) => {
            const r = await doGenerate()
            const reported = Number(r.providerMetadata?.gateway?.cost)
            if (Number.isFinite(reported)) { haikuCost += reported; haikuReported = true }
            return r
          },
        },
      })
      const t0 = performance.now()
      const [judged, haiku] = await Promise.all([
        readJevRoute(inputs, { key, force: true, threshold: 0, ...(fetchImpl ? { fetchImpl } : {}) }).then((j) => ({ j, ms: Math.round(performance.now() - t0) })),
        sut.runTriage({ ...inputs, model: haikuModel }).then((t) => ({ t, ms: Math.round(performance.now() - t0) })),
      ])
      // A Haiku call with no reported cost (a timeout) counts at an estimate;
      // readJevRoute does not surface Jev's cost, so it counts at list price.
      spent += (haikuReported ? haikuCost : HAIKU_ESTIMATE_USD) + JEV_ESTIMATE_USD

      const haikuDecision = sut.decideTier({ triage: haiku.t, carried: inputs.carried, deepApproved: false, pastedLog: inputs.pasted })
      const pair = {
        case: c,
        haiku: { ms: haiku.ms, route: haikuDecision, score: scoreCase(c, haiku.t, haikuDecision) },
        jev: null,
      }
      if (judged.j?.candidate) {
        const triage = judged.j.candidate
        const decision = sut.decideTier({ triage, carried: inputs.carried, deepApproved: false, pastedLog: inputs.pasted })
        pair.jev = { ms: judged.ms, confidence: judged.j.confidence ?? 0, route: decision, triage, score: scoreCase(c, triage, decision) }
      }
      pairs.push(pair)
    }
  }

  const split = (pred) => pairs.filter((p) => pred(p.case))
  const report = (label, ps) => {
    if (!ps.length) return
    const line = (name, s, extra = '') =>
      console.log(`  ${name.padEnd(16)} n=${String(s.n).padStart(3)}  primary ${pct(s.primary)}  acceptable ${pct(s.acceptable)}  tier ${pct(s.tier)} (under ${s.under}, over ${s.over})  p50 ${s.p50 ?? '—'} ms  p95 ${s.p95 ?? '—'} ms${extra}`)
    console.log(label)
    const answered = ps.filter((p) => p.jev)
    line('haiku triage', summarizeRouter(ps.map((p) => ({ ...p.haiku.score, ms: p.haiku.ms }))))
    line('jev alone', summarizeRouter(answered.map((p) => ({ ...p.jev.score, ms: p.jev.ms }))), `  (answered ${answered.length}/${ps.length})`)
    for (const t of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      const rows = hybridRows(ps, t)
      line(`hybrid @${t}`, summarizeRouter(rows), `  jev used ${rows.filter((r) => r.usedJev).length}/${rows.length}`)
    }
  }
  const pct = (r) => (r.pct == null ? '   —  ' : `${r.pct.toFixed(1).padStart(5)}%`)
  report('all cases', pairs)
  report('held-out cases', split((c) => c.heldOut))

  const misses = pairs.filter((p) => p.jev && (!p.jev.score.acceptable || !p.jev.score.tierOk))
  console.log(`\njev misses (${misses.length}):`)
  for (const p of misses.slice(0, 40)) {
    console.log(`  ${p.case.id.padEnd(28)} expected ${p.case.expectedPathways[0]}/${p.case.expectedTier} got ${p.jev.route.pathways[0] ?? 'general'}/${p.jev.route.tier} conf ${p.jev.confidence.toFixed(2)} signals [${p.jev.triage.signals.join(',')}]`)
  }
  console.log(`\nspent ~$${spent.toFixed(4)} (Haiku Gateway-reported + Jev at its list price)`)
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(pairs, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error?.message ?? error); process.exit(1) })
}
