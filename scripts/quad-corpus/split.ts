#!/usr/bin/env node
/**
 * A deterministic, FROZEN train/val/test split of the quad corpus.
 *
 *   node --import tsx scripts/quad-corpus/split.ts              # make split.json (refuses to overwrite)
 *   node --import tsx scripts/quad-corpus/split.ts --dry-run    # print the composition, write nothing
 *   node --import tsx scripts/quad-corpus/split.ts --extend     # corpus grew: keep every old assignment
 *   node --import tsx scripts/quad-corpus/split.ts --force      # regenerate from scratch (see below)
 *
 * Options: --corpus <dir> (default QUAD_CORPUS_DIR, else ~/deckpal-data/quad-corpus)
 *          --seed <s> (default "quad-split-v1")  --test 0.2  --val 0.1
 *          --gap-min <m>  a new SESSION starts after m minutes with no labels. Omitted,
 *                         the coarsest of 30/10/5/2/1 min that covers every stratum
 *                         is chosen (recorded in split.json params).
 *
 * THE UNIT IS A SESSION, NOT A FRAME. Frames labelled seconds apart share the
 * card, the hand, the background and the light, so a random frame split would
 * put near-copies of every test frame in train and flatter whatever trained on
 * it. Rows are grouped into units by union-find over two relations and a unit is
 * never divided:
 *   1. the same labelling SESSION — consecutive rows (by capture time) with no
 *      gap longer than --gap-min. Deliberately NOT cut at the UTC day boundary:
 *      the owner is in UTC-6, so an evening session crosses UTC midnight, and
 *      cutting there would split one sitting across two units.
 *   2. the same harvest `dupGroup` (dHash within 4 bits), which also catches a
 *      re-shot frame that recurs in a different session.
 *
 * STRATIFIED, SO THE TEST SET CAN ANSWER THE QUESTIONS IT IS FOR. Rarest stratum
 * first, test takes whole units until it holds its share of each of: tight
 * framings (fill >= 75%, the HARVEST.md §5 failure), card backs, every negative
 * reason, every source, and every fill bucket — while leaving at least one unit
 * of that stratum for train whenever two exist. Val does the same where three
 * units exist. The remaining units fill toward the target sizes in a fixed
 * pseudo-random order (sha256 of seed + unit key), so the whole thing is a pure
 * function of (manifest, params).
 *
 * FROZEN. split.json records the sha256 of the manifest it was made from, and
 * eval.ts refuses to score a split whose manifest has changed. When the corpus
 * grows, `--extend` keeps every existing assignment (test stays test), lets new
 * rows inherit the split of any unit they join, and assigns brand-new units by
 * the same rules. A new row that bridges units already in different splits is
 * EXCLUDED rather than put on either side of the line. `--force` regenerates
 * from scratch, which re-deals the test set and invalidates every model trained
 * on the old train split — the reason it is not the default.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  arg,
  composition,
  corpusDir,
  describe,
  flag,
  readManifest,
  readSplit,
  type Composition,
  type ManifestRow,
  type SplitFile,
  type SplitName,
} from './corpus'
import { fillBucket, isTight } from './metrics'

const SPLITS: Exclude<SplitName, 'excluded'>[] = ['train', 'val', 'test']

function strataOf(m: ManifestRow): string[] {
  const s = [`source:${m.source ?? 'missing'}`]
  if (m.verdict === 'negative') {
    s.push(`neg:${m.reason ?? '(none)'}`)
    return s
  }
  s.push('pos', `fill:${fillBucket(m.fill)}`)
  if (isTight(m.corners)) s.push('pos:tight')
  if (m.verdict === 'back') s.push('face:back')
  return s
}

interface Unit {
  key: number
  rows: ManifestRow[]
  strata: Map<string, number>
  order: string
  split: SplitName | null
}

function buildUnits(rows: ManifestRow[], gapMs: number, seed: string): Unit[] {
  const parent = new Map<number, number>(rows.map((r) => [r.id, r.id]))
  const find = (x: number): number => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    while (parent.get(x) !== r) {
      const n = parent.get(x)!
      parent.set(x, r)
      x = n
    }
    return r
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb))
  }
  const byTime = [...rows].sort((a, b) => a.id - b.id)
  for (let i = 1; i < byTime.length; i++) if (byTime[i].id - byTime[i - 1].id <= gapMs) union(byTime[i].id, byTime[i - 1].id)
  const byGroup = new Map<number, number>()
  for (const r of rows) {
    const g = r.dupGroup ?? r.id
    const first = byGroup.get(g)
    if (first == null) byGroup.set(g, r.id)
    else union(first, r.id)
  }
  const units = new Map<number, Unit>()
  for (const r of rows) {
    const k = find(r.id)
    let u = units.get(k)
    if (!u) {
      u = { key: k, rows: [], strata: new Map(), order: '', split: null }
      units.set(k, u)
    }
    u.rows.push(r)
    for (const s of strataOf(r)) u.strata.set(s, (u.strata.get(s) ?? 0) + 1)
  }
  const out = [...units.values()]
  for (const u of out) {
    u.key = Math.min(...u.rows.map((r) => r.id))
    u.order = crypto.createHash('sha256').update(`${seed}:${u.key}`).digest('hex')
  }
  return out.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
}

interface Params {
  seed: string
  test: number
  val: number
  gapMin: number
}

interface Dealt {
  units: Unit[]
  assign: Map<number, SplitName>
  size: Record<string, number>
  warnings: string[]
  /** Coverage failures a different grouping could avoid — what the gap ladder
   *  minimises. */
  problems: number
  biggest: number
}

/** The session gaps tried, coarsest first, when --gap-min is not given. The
 *  coarsest that covers every stratum wins: the most leakage protection the
 *  corpus can afford. Nothing below a minute — that would be a frame split. */
const GAP_LADDER_MIN = [30, 10, 5, 2, 1]

function deal(rows: ManifestRow[], P: Params, old: SplitFile | null): Dealt {
  const warnings: string[] = []
  const units = buildUnits(rows, P.gapMin * 60_000, P.seed)
  const assign = new Map<number, SplitName>()

  // --extend: freeze what was already dealt.
  if (old) {
    const present = new Set(rows.map((r) => String(r.id)))
    const dropped = Object.keys(old.assignments).filter((id) => !present.has(id))
    if (dropped.length) warnings.push(`${dropped.length} previously assigned rows are no longer in the manifest (dropped)`)
    for (const u of units) {
      const prior = new Set<SplitName>()
      for (const r of u.rows) {
        const s = old.assignments[String(r.id)]
        if (s) {
          assign.set(r.id, s)
          if (s !== 'excluded') prior.add(s)
        }
      }
      if (prior.size === 1) {
        const s = [...prior][0]
        u.split = s
        for (const r of u.rows) if (!assign.has(r.id)) assign.set(r.id, s)
      } else if (prior.size > 1) {
        u.split = 'excluded'
        const fresh = u.rows.filter((r) => !assign.has(r.id))
        for (const r of fresh) assign.set(r.id, 'excluded')
        if (fresh.length) warnings.push(`${fresh.length} new rows bridge units already in ${[...prior].join('+')}; excluded (unit ${u.key})`)
      }
    }
  }

  // Running tallies, by split and stratum, over every row assigned so far.
  const have: Record<string, Map<string, number>> = { train: new Map(), val: new Map(), test: new Map(), excluded: new Map() }
  const size: Record<string, number> = { train: 0, val: 0, test: 0, excluded: 0 }
  for (const r of rows) {
    const s = assign.get(r.id)
    if (!s) continue
    size[s]++
    for (const st of strataOf(r)) have[s].set(st, (have[s].get(st) ?? 0) + 1)
  }
  const put = (u: Unit, s: SplitName) => {
    u.split = s
    for (const r of u.rows) {
      assign.set(r.id, s)
      size[s]++
      for (const st of strataOf(r)) have[s].set(st, (have[s].get(st) ?? 0) + 1)
    }
  }

  // Stratified phases, rarest stratum first.
  const N = rows.length
  const goal: Record<string, number> = { train: N * (1 - P.test - P.val), val: N * P.val, test: N * P.test }
  const totals = new Map<string, number>()
  const unitsWith = new Map<string, Unit[]>()
  for (const u of units)
    for (const [s, n] of u.strata) {
      totals.set(s, (totals.get(s) ?? 0) + n)
      unitsWith.set(s, [...(unitsWith.get(s) ?? []), u])
    }
  const required = [...totals.keys()].filter((s) => s !== 'pos').sort((a, b) => totals.get(a)! - totals.get(b)! || (a < b ? -1 : 1))
  /** May `u` leave the train pool? Only if, for EVERY stratum it carries that
   *  has two or more units, another unit of that stratum is still unassigned or
   *  in train — so taking one rare stratum for test can never strip train of a
   *  different one (or of positives altogether). */
  const canTake = (u: Unit) => {
    for (const s of u.strata.keys()) {
      const all = unitsWith.get(s)!
      if (all.length < 2) continue
      if (!all.some((x) => x !== u && (x.split == null || x.split === 'train'))) return false
    }
    return true
  }
  for (const [target, frac, minUnits] of [
    ['test', P.test, 2],
    ['val', P.val, 3],
  ] as const) {
    if (!(frac > 0)) continue
    // Coverage may push a split past its target size, but not past twice it.
    const cap = 2 * goal[target]
    for (const s of required) {
      const withS = unitsWith.get(s)!
      if (withS.length < minUnits && !(target === 'test' && withS.length === 1)) continue
      const need = Math.max(1, Math.round(frac * totals.get(s)!))
      for (const u of withS) {
        if ((have[target].get(s) ?? 0) >= need) break
        if (u.split || !canTake(u)) continue
        if (size[target] + u.rows.length > cap && (have[target].get(s) ?? 0) > 0) break
        put(u, target)
      }
    }
  }
  // Fill toward the target sizes, in the fixed pseudo-random order.
  for (const u of units) {
    if (u.split) continue
    let best: (typeof SPLITS)[number] = 'train'
    let bestDef = -Infinity
    for (const s of SPLITS) {
      const def = goal[s] - size[s]
      if (def > bestDef) {
        bestDef = def
        best = s
      }
    }
    put(u, best)
  }

  let problems = 0
  for (const s of required) {
    const several = unitsWith.get(s)!.length >= 2
    if (!(have.test.get(s) ?? 0)) {
      warnings.push(`test has no rows of stratum ${s} (${totals.get(s)} in the corpus)`)
      problems++
    }
    const outside = (have.train.get(s) ?? 0) + (have.val.get(s) ?? 0)
    if (!outside) {
      warnings.push(`train+val have no rows of stratum ${s}${several ? '' : ' (it is a single unit)'} — the model will never see it in training`)
      if (several) problems++
    }
  }
  if (size.test < 0.5 * goal.test || size.test > 2 * goal.test) {
    warnings.push(`test is ${size.test} rows against a target of ${Math.round(goal.test)}`)
    problems++
  }
  const biggest = Math.max(...units.map((u) => u.rows.length))
  if (biggest > N * P.test) warnings.push(`largest unit holds ${biggest} rows (> the test target); consider a smaller --gap-min`)
  return { units, assign, size, warnings, problems, biggest }
}

function main(): void {
  const dir = corpusDir(arg('corpus'))
  const seed = arg('seed', 'quad-split-v1')!
  const fr = { test: Number(arg('test', '0.2')), val: Number(arg('val', '0.1')) }
  const gapArg = arg('gap-min')
  const extend = flag('extend')
  const force = flag('force')
  const dry = flag('dry-run')
  if (!(fr.test > 0 && fr.val >= 0 && fr.test + fr.val < 1)) throw new Error('--test/--val must be fractions summing below 1')

  const man = readManifest(dir)
  const old = readSplit(dir)
  const outFile = path.join(dir, 'split.json')
  if (old && !extend && !force && !dry) {
    if (old.manifest.sha256 === man.sha256) {
      console.log(`split.json already matches this manifest (${man.sha256.slice(0, 12)}); nothing to do.`)
      return
    }
    throw new Error(
      `split.json was made from manifest ${old.manifest.sha256.slice(0, 12)}, this one is ${man.sha256.slice(0, 12)}. ` +
        'Use --extend to keep the frozen assignments and place the new rows, or --force to re-deal (invalidates trained models).',
    )
  }
  if (extend && !old) throw new Error('--extend needs an existing split.json')

  let P: Params
  let d: Dealt
  if (extend && old) {
    P = old.params as unknown as Params
    d = deal(man.rows, P, old)
  } else if (gapArg != null) {
    P = { seed, test: fr.test, val: fr.val, gapMin: Number(gapArg) }
    d = deal(man.rows, P, null)
  } else {
    // The coarsest session gap that covers every stratum; failing that, the
    // one with the fewest coverage problems (ties to the coarser).
    let best: { P: Params; d: Dealt } | null = null
    for (const g of GAP_LADDER_MIN) {
      const p = { seed, test: fr.test, val: fr.val, gapMin: g }
      const x = deal(man.rows, p, null)
      console.log(`  gap ${g} min: ${x.units.length} units, ${x.problems} coverage problems`)
      if (!best || x.problems < best.d.problems) best = { P: p, d: x }
      if (!x.problems) break
    }
    P = best!.P
    d = best!.d
  }
  const { units, assign, size, warnings, biggest } = d
  const N = man.rows.length
  const params = P as unknown as Record<string, unknown>

  // Report.
  const rowsOf = (s: SplitName) => man.rows.filter((r) => assign.get(r.id) === s)
  const unitCount = (s: SplitName) => units.filter((u) => u.split === s).length
  const comp: Record<string, Composition> = {}
  for (const s of [...SPLITS, 'excluded'] as SplitName[]) comp[s] = composition(rowsOf(s))

  const split: SplitFile = {
    version: 1,
    createdAt: new Date().toISOString(),
    manifest: { file: 'manifest.jsonl', sha256: man.sha256, rows: N },
    params,
    history: [
      ...(extend && old ? old.history : []),
      { at: new Date().toISOString(), mode: extend ? 'extend' : force ? 'force' : 'create', manifestSha256: man.sha256, rows: N },
    ],
    counts: { train: size.train, val: size.val, test: size.test, excluded: size.excluded },
    units: { train: unitCount('train'), val: unitCount('val'), test: unitCount('test'), excluded: unitCount('excluded') },
    composition: comp,
    warnings,
    assignments: Object.fromEntries([...man.rows].sort((a, b) => a.id - b.id).map((r) => [String(r.id), assign.get(r.id)!])),
  }

  console.log(`manifest ${man.sha256.slice(0, 12)}  ${N} rows  ${units.length} units (session gap ${P.gapMin} min + dupGroup), largest ${biggest}`)
  for (const s of SPLITS) console.log(describe(s.toUpperCase(), comp[s], unitCount(s)))
  if (size.excluded) console.log(describe('EXCLUDED', comp.excluded, unitCount('excluded')))
  for (const w of warnings) console.log(`WARNING: ${w}`)
  if (dry) {
    console.log('\n(dry run — nothing written)')
    return
  }
  fs.writeFileSync(outFile, JSON.stringify(split, null, 1) + '\n')
  console.log(`\nwritten ${outFile}`)
}

try {
  main()
} catch (e) {
  console.error(`split: ${(e as Error).message}`)
  process.exit(1)
}
