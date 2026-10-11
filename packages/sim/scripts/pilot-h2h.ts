/**
 * Paired head-to-head: a candidate pilot against a baseline pilot.
 *
 *   node --import tsx scripts/pilot-h2h.ts --cand=search:flag --base=search [--rounds=2] [--workers=3] [--pool=all|meta|owner] [--maxTurns=60]
 *
 * Pilot specs are those of scripts/lib/pilotSpec.ts (`search`, `greedy`, `search:-flag`, `search:nodes=200`, ...).
 *
 * Design. For every pair of decks {A, B} in the pool (mirrors included) and every round (a game seed),
 * four games are played with the SAME game seed and pilot seeds:
 *    candidate pilots A in seat 0 / seat 1 against the baseline pilots B, and
 *    candidate pilots B in seat 0 / seat 1 against the baseline pilots A.
 * So each deck is piloted by both pilots, in both seats, against the same opponent deck: deck strength and
 * the first-player edge cancel and what is left is pilot against pilot. The score is the candidate's wins
 * (a draw counts half). Two 95% intervals are printed: Wilson on games, and a t-interval over the per-(pair,round)
 * cluster means (the four games of a cluster share a seed, so they are not independent); the wider is the one to
 * trust. A change is kept only when the candidate's score is >= 50% and does not look worse.
 */
import { spawn } from 'node:child_process';
import { createContext } from '../src/context.js';
import { Game } from '../src/game.js';
import { playOut } from '../src/play.js';
import { wilson } from '../src/stats.js';
import { t95 } from '../src/compare.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING, fromIds } from '../src/__tests__/decks.js';
import { META_LISTS } from '../src/__tests__/meta/index.js';
import { parsePilotSpec } from './lib/pilotSpec.js';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1] as string, m[2] ?? '1');
}
const cand = args.get('cand') ?? 'search';
const base = args.get('base') ?? 'search';
const rounds = Number(args.get('rounds') ?? 2);
const firstRound = Number(args.get('from') ?? 0);
const maxTurns = Number(args.get('maxTurns') ?? 60);
const poolName = args.get('pool') ?? 'all';
const workers = Number(args.get('workers') ?? 3);
const shard = args.get('shard');

const meta = Object.entries(META_LISTS).map(([n, l]) => fromIds(n, l));
const owner = [HIDE_N_SNEAK, TOOLBOX_SLOWKING];
const pool = poolName === 'meta' ? meta : poolName === 'owner' ? owner : [...owner, ...meta];

interface Job {
  a: number;
  b: number;
  round: number;
  seed: number;
}
/**
 * A game seed from the job's unique (round, pair) ordinal. An odd multiplier on the low 30 bits is a bijection, so
 * distinct jobs get distinct seeds (the old `9100 + round*131 + a*7 + b` collided: pairs (0,8) and (1,1)).
 */
const seedOf = (ordinal: number): number => {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= 2 ** 30) throw new Error(`pilot-h2h: job ordinal ${ordinal} out of range`);
  return 9100 + (Math.imul(ordinal + 1, 0x9e3779b1) & 0x3fffffff);
};
const jobs: Job[] = [];
for (let r = firstRound; r < firstRound + rounds; r++) for (let a = 0; a < pool.length; a++) for (let b = a; b < pool.length; b++) jobs.push({ a, b, round: r, seed: seedOf(r * pool.length * pool.length + a * pool.length + b) });
if (new Set(jobs.map((j) => j.seed)).size !== jobs.length) throw new Error('pilot-h2h: two jobs share a game seed');

/** One cluster: four games. Returns the candidate's score in each (1 win, 0.5 draw, 0 loss) and the turn count. */
function runJob(j: Job): { j: Job; scores: number[]; turns: number[]; reasons: string[] } {
  const scores: number[] = [];
  const turns: number[] = [];
  const reasons: string[] = [];
  const seed = j.seed;
  for (const [mine, theirs] of [
    [j.a, j.b],
    [j.b, j.a],
  ] as const) {
    for (const seat of [0, 1] as const) {
      const dm = pool[mine]!;
      const dt = pool[theirs]!;
      const ctx = createContext(seat === 0 ? dm : dt, seat === 0 ? dt : dm, { first: 0, maxTurns });
      const pc = parsePilotSpec(cand, seed * 2 + 1);
      const pb = parsePilotSpec(base, seed * 2 + 2);
      const g = playOut(new Game(ctx, null, seed), seat === 0 ? [pc, pb] : [pb, pc]);
      const w = g.state.winner;
      scores.push(w === seat ? 1 : w === null ? 0.5 : 0);
      turns.push(g.state.turn);
      reasons.push(g.state.winReason ?? '?');
    }
  }
  return { j, scores, turns, reasons };
}

if (shard) {
  const [k, n] = shard.split('/').map(Number) as [number, number];
  for (let i = k; i < jobs.length; i += n) process.stdout.write(`${JSON.stringify(runJob(jobs[i]!))}\n`);
  process.exit(0);
}

const t0 = Date.now();
const results: ReturnType<typeof runJob>[] = [];
await Promise.all(
  Array.from({ length: workers }, (_, k) =>
    new Promise<void>((resolve, reject) => {
      const passArgs = process.argv.slice(2).filter((a) => !a.startsWith('--shard') && !a.startsWith('--workers'));
      const ch = spawn(process.execPath, ['--import', 'tsx', 'scripts/pilot-h2h.ts', ...passArgs, `--shard=${k}/${workers}`], { stdio: ['ignore', 'pipe', 'inherit'] });
      let buf = '';
      ch.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) results.push(JSON.parse(line));
        }
      });
      ch.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`worker ${k} exited ${c}`))));
    }),
  ),
);

const games = results.flatMap((r) => r.scores);
const n = games.length;
const wins = games.filter((x) => x === 1).length;
const draws = games.filter((x) => x === 0.5).length;
const losses = n - wins - draws;
const score = games.reduce((a, b) => a + b, 0) / n;
const w = wilson(Math.round(score * n), n);
const clusters = results.map((r) => r.scores.reduce((a, b) => a + b, 0) / r.scores.length);
const cm = clusters.reduce((a, b) => a + b, 0) / clusters.length;
const cv = clusters.reduce((a, b) => a + (b - cm) ** 2, 0) / Math.max(1, clusters.length - 1);
const half = t95(Math.max(1, clusters.length - 1)) * Math.sqrt(cv / clusters.length);
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const decisive = wins + losses;
console.log(`candidate [${cand}] vs baseline [${base}]  pool=${poolName} (${pool.length} decks) rounds=${rounds} maxTurns=${maxTurns}`);
console.log(`n=${n} games: ${wins}-${losses}-${draws} (W-L-D)   candidate score ${pct(score)}   decisive win rate ${pct(decisive ? wins / decisive : 0.5)}`);
console.log(`95% interval: Wilson on games [${pct(w?.lo ?? 0)}, ${pct(w?.hi ?? 1)}]   clusters (n=${clusters.length}) [${pct(cm - half)}, ${pct(cm + half)}]`);
const lo = Math.min(w?.lo ?? 0, cm - half);
const hi = Math.max(w?.hi ?? 1, cm + half);
console.log(`verdict: ${lo > 0.5 ? 'candidate stronger' : hi < 0.5 ? 'candidate WEAKER' : 'no significant difference'} (wider interval [${pct(lo)}, ${pct(hi)}]) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
// How each side's losses ended (the candidate's wins are the baseline's losses).
const lossBy = (cand: boolean) => {
  const m = new Map<string, number>();
  for (const r of results) r.reasons.forEach((x, i) => { const s = r.scores[i] as number; if (s !== 0.5 && (s === 1) !== cand) m.set(x, (m.get(x) ?? 0) + 1); });
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
};
console.log(`candidate lost by: ${lossBy(true)}`);
console.log(`baseline lost by:  ${lossBy(false)}`);
console.log(`draws: ${draws}   avg turns ${(results.flatMap((r) => r.turns).reduce((a, b) => a + b, 0) / n).toFixed(1)}`);
