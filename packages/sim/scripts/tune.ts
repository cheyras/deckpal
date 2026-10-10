/**
 * Tune the evaluation weights by paired self-play (not CI).
 *
 * A (1+λ) evolution strategy over `DEFAULT_WEIGHTS`: each generation perturbs
 * the current weights λ times (log-normal steps on a random subset of keys),
 * screens every candidate against the current weights, then re-plays the best
 * one on FRESH seeds and adopts it only when that confirmation is a significant
 * win (one-sided sign test on decisive games). Screening picks the best of λ,
 * so its own score is optimistic; the confirmation run is what decides.
 *
 * Every match is paired: the same game seed and the same per-seat pilot seeds
 * are played twice with the candidate in seat 0 and then seat 1, on a matchup
 * drawn from the account decks (the owner's two plus the gauntlet), so deck,
 * seat, shuffles and determinisation samples cancel and only the weights differ.
 *
 * The greedy pilot runs the loop (fast); the final weights are validated with
 * the search pilot on held-out seeds against the starting weights.
 *
 *   node --import tsx scripts/tune.ts [--gens 6] [--lambda 6] [--screen 24] [--confirm 60]
 *       [--validate 40] [--workers 6] [--sigma 0.3] [--pilot greedy] [--out weights.json]
 *   node --import tsx scripts/tune.ts --validate-only weights.json [--validate 40]
 *
 * Seed counts are PAIRS (each pair = 2 games).
 */
import { fork, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, type DeckInput, type GameContext } from '../src/context.js';
import { Game } from '../src/game.js';
import { playOut } from '../src/play.js';
import { DEFAULT_WEIGHTS, type EvalWeights } from '../src/pilot/eval.js';
import { makePilot, type PilotName } from '../src/pilot/index.js';
import { Rng } from '../src/rng.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from '../src/__tests__/decks.js';
import { GAUNTLET_LISTS, gauntletDeck } from '../src/__tests__/gauntlet.js';

const MAX_TURNS = 60;

/** Matchups: each owner deck against the other and against every gauntlet deck. */
function matchups(): [DeckInput, DeckInput][] {
  const g = Object.keys(GAUNTLET_LISTS).map(gauntletDeck);
  const out: [DeckInput, DeckInput][] = [[HIDE_N_SNEAK, TOOLBOX_SLOWKING]];
  for (const d of g) out.push([HIDE_N_SNEAK, d], [TOOLBOX_SLOWKING, d]);
  return out;
}

interface Job {
  id: number;
  /** Candidate and baseline weights. */
  wa: EvalWeights;
  wb: EvalWeights;
  seed: number;
  /** false: candidate in seat 0. */
  swap: boolean;
  pilot: PilotName;
}

/** +1 candidate won, -1 lost, 0 draw. */
type Outcome = 1 | -1 | 0;

const ctxCache = new Map<number, GameContext>();
let MATCHUPS: [DeckInput, DeckInput][] | null = null;

function playJob(j: Job): Outcome {
  MATCHUPS ??= matchups();
  const mi = j.seed % MATCHUPS.length;
  let ctx = ctxCache.get(mi);
  if (!ctx) {
    const [a, b] = MATCHUPS[mi] as [DeckInput, DeckInput];
    ctx = createContext(a, b, { maxTurns: MAX_TURNS });
    ctxCache.set(mi, ctx);
  }
  // Pilot seeds follow the SEAT, so both games of a pair see the same determinisation samples per seat.
  const s0 = j.seed * 31 + 1;
  const s1 = j.seed * 31 + 2;
  const cand = (seed: number) => makePilot(j.pilot, seed, { weights: j.wa });
  const base = (seed: number) => makePilot(j.pilot, seed, { weights: j.wb });
  const pilots = j.swap ? [base(s0), cand(s1)] : [cand(s0), base(s1)];
  const g = playOut(new Game(ctx, null, j.seed), pilots as [ReturnType<typeof cand>, ReturnType<typeof cand>]);
  const w = g.state.winner;
  if (w === null) return 0;
  const candSeat = j.swap ? 1 : 0;
  return w === candSeat ? 1 : -1;
}

// ---- parent side -----------------------------------------------------------
function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}
function sarg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

class Pool {
  private procs: ChildProcess[] = [];
  private idle: ChildProcess[] = [];
  private queue: { j: Job; res: (r: Outcome) => void }[] = [];
  private live = new Map<number, (r: Outcome) => void>();
  private next = 0;
  constructor(n: number) {
    const file = fileURLToPath(import.meta.url);
    for (let i = 0; i < n; i++) {
      const p = fork(file, ['--worker'], { execArgv: process.execArgv });
      p.on('message', (m: { id: number; r: Outcome }) => {
        const res = this.live.get(m.id);
        this.live.delete(m.id);
        res?.(m.r);
        this.idle.push(p);
        this.pump();
      });
      this.procs.push(p);
      this.idle.push(p);
    }
  }
  run(j: Omit<Job, 'id'>): Promise<Outcome> {
    return new Promise((res) => {
      this.queue.push({ j: { ...j, id: this.next++ }, res });
      this.pump();
    });
  }
  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const p = this.idle.pop() as ChildProcess;
      const { j, res } = this.queue.shift() as { j: Job; res: (r: Outcome) => void };
      this.live.set(j.id, res);
      p.send(j);
    }
  }
  close(): void {
    for (const p of this.procs) p.kill();
  }
}

interface Result {
  w: number;
  l: number;
  d: number;
  /** Pairs won outright (both games or one + a draw) / lost outright. */
  pw: number;
  pl: number;
}

async function match(pool: Pool, wa: EvalWeights, wb: EvalWeights, seeds: number[], pilot: PilotName): Promise<Result> {
  const r: Result = { w: 0, l: 0, d: 0, pw: 0, pl: 0 };
  await Promise.all(
    seeds.map(async (seed) => {
      const [x, y] = await Promise.all([false, true].map((swap) => pool.run({ wa, wb, seed, swap, pilot })));
      for (const o of [x, y]) {
        if (o === 1) r.w++;
        else if (o === -1) r.l++;
        else r.d++;
      }
      const net = (x as number) + (y as number);
      if (net > 0) r.pw++;
      else if (net < 0) r.pl++;
    }),
  );
  return r;
}

/** One-sided sign test: P(X >= w) for X ~ Binomial(w + l, 1/2). */
function signP(w: number, l: number): number {
  const n = w + l;
  if (n === 0) return 1;
  let p = 0;
  let logC = 0; // log C(n, k), built up incrementally to stay finite
  for (let k = 0; k <= n; k++) {
    if (k > 0) logC += Math.log(n - k + 1) - Math.log(k);
    if (k >= w) p += Math.exp(logC - n * Math.LN2);
  }
  return Math.min(1, p);
}

/** Wilson 95% interval for w successes in n. */
function wilson(w: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const ph = w / n;
  const den = 1 + (z * z) / n;
  const mid = (ph + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n))) / den;
  return [mid - half, mid + half];
}

function fmt(r: Result): string {
  const [lo, hi] = wilson(r.w, r.w + r.l);
  return (
    `${r.w}-${r.l}-${r.d} (n=${r.w + r.l + r.d} games; decisive win rate ${((r.w / Math.max(1, r.w + r.l)) * 100).toFixed(1)}%, ` +
    `Wilson95 [${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}], sign p=${signP(r.w, r.l).toFixed(4)}; pairs ${r.pw}-${r.pl}, pair sign p=${signP(r.pw, r.pl).toFixed(4)})`
  );
}

const FRACTIONS = new Set<keyof EvalWeights>(['benchThreat', 'energyBench']);
const INTEGERS = new Set<keyof EvalWeights>(['handCap', 'deckSafe']);
const FIXED = new Set<keyof EvalWeights>(['win']);

function perturb(w: EvalWeights, rng: Rng, sigma: number): EvalWeights {
  const out = { ...w };
  const keys = (Object.keys(w) as (keyof EvalWeights)[]).filter((k) => !FIXED.has(k));
  // Move ~a third of the keys per step, at least one.
  const pick = keys.filter(() => rng.next() < 0.35);
  if (!pick.length) pick.push(keys[Math.floor(rng.next() * keys.length)] as keyof EvalWeights);
  for (const k of pick) {
    // Box-Muller normal.
    const z = Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
    let v = (w[k] as number) * Math.exp(sigma * z);
    if (FRACTIONS.has(k)) v = Math.min(1.5, Math.max(0.05, v));
    if (INTEGERS.has(k)) v = Math.max(1, Math.round(v + (z > 0 ? 0.5 : -0.5)));
    else v = Number(v.toPrecision(3));
    out[k] = v;
  }
  return out;
}

function diff(a: EvalWeights, b: EvalWeights): string {
  return (Object.keys(a) as (keyof EvalWeights)[])
    .filter((k) => a[k] !== b[k])
    .map((k) => `${k} ${b[k]}→${a[k]}`)
    .join(', ');
}

async function main(): Promise<void> {
  const workers = arg('workers', 6);
  const pool = new Pool(workers);
  const t0 = Date.now();
  const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  const validatePairs = arg('validate', 40);
  const out = sarg('out');
  const only = sarg('validate-only');
  // Disjoint seed ranges: tuning seeds count up from 1, validation seeds start far away.
  const VALIDATE_FROM = 900_001;
  let seedCursor = arg('seed', 1);
  const fresh = (n: number) => Array.from({ length: n }, () => seedCursor++);

  let best: EvalWeights = DEFAULT_WEIGHTS;
  if (only) {
    best = JSON.parse(readFileSync(only, 'utf8')) as EvalWeights;
  } else {
    const gens = arg('gens', 6);
    const lambda = arg('lambda', 6);
    const screen = arg('screen', 24);
    const confirm = arg('confirm', 60);
    const sigma = arg('sigma', 0.3);
    const alpha = arg('alpha', 0.05);
    const pilot = (sarg('pilot') ?? 'greedy') as PilotName;
    const rng = new Rng(arg('rngseed', 12345));
    console.log(`tune: ${gens} gens × λ=${lambda}, screen ${screen} pairs, confirm ${confirm} pairs, σ=${sigma}, pilot ${pilot}, ${workers} workers`);
    for (let gen = 1; gen <= gens; gen++) {
      const cands = Array.from({ length: lambda }, () => perturb(best, rng, sigma));
      const seeds = fresh(screen);
      const rs = await Promise.all(cands.map((c) => match(pool, c, best, seeds, pilot)));
      let bi = 0;
      for (let i = 1; i < rs.length; i++) if ((rs[i] as Result).w - (rs[i] as Result).l > (rs[bi] as Result).w - (rs[bi] as Result).l) bi = i;
      const br = rs[bi] as Result;
      console.log(`gen ${gen} [${el()}] screen scores: ${rs.map((r) => r.w - r.l).join(' ')}; best ${br.w}-${br.l}-${br.d}: ${diff(cands[bi] as EvalWeights, best)}`);
      if (br.w <= br.l) continue;
      const cr = await match(pool, cands[bi] as EvalWeights, best, fresh(confirm), pilot);
      const p = signP(cr.w, cr.l);
      const ok = p < alpha;
      console.log(`  confirm ${fmt(cr)} → ${ok ? 'ADOPT' : 'reject'}`);
      if (ok) best = cands[bi] as EvalWeights;
    }
    console.log(`tuned [${el()}]: ${diff(best, DEFAULT_WEIGHTS) || '(unchanged)'}`);
    if (out) writeFileSync(out, JSON.stringify(best, null, 2));
  }

  if (best !== DEFAULT_WEIGHTS && validatePairs > 0) {
    const seeds = Array.from({ length: validatePairs }, (_, i) => VALIDATE_FROM + i);
    const vr = await match(pool, best, DEFAULT_WEIGHTS, seeds, 'search');
    console.log(`validate (search pilot, held-out seeds ${VALIDATE_FROM}..) [${el()}]: tuned vs default ${fmt(vr)}`);
    console.log(JSON.stringify(best));
  }
  pool.close();
}

// ---- entry: the parent forks copies of this file with --worker -------------
if (process.argv.includes('--worker')) {
  process.on('message', (j: Job) => {
    process.send?.({ id: j.id, r: playJob(j) });
  });
} else {
  await main();
}
