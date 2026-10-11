/**
 * How often a pilot picks what a real player picked, from the same position.
 *
 *   node --import tsx scripts/pilot-agreement.ts [--pilots=policy,greedy,search] [--logs=a.txt,b.txt] [--examples=3] [--json=out.json]
 *
 * Every anonymised PTCG Live log in src/__tests__/fixtures/live-logs is replayed through the engine
 * (src/replay/replay.ts). At each decision the LOG answered — a main-phase action (attack, Trainer,
 * attach, evolve, retreat, Ability, bench, tool, Stadium, end turn) or a choice inside one (cards,
 * Pokémon, promote, option) — the position is copied, and each pilot is asked what it would do. It
 * answers through its normal public boundary (the pilot gets the real state of the replay, exactly as
 * in a game, and determinises it from the deciding player's seat), so it never sees the opponent's hand.
 *
 * Reading the numbers. Agreement is a PROXY: players make mistakes, the logs are one player's games,
 * and the replay can only show a hand as it knew it — a card the log never showed is a hidden filler
 * until it is played. So the headline figure is for decisions where the deciding player's hand held no
 * filler ("clean"); the all-decisions figure is printed beside it. Read it together with the strength
 * numbers from scripts/pilot-h2h.ts: a pilot may rightly disagree with a human.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayLog, type ReplayObservation } from '../src/replay/replay.js';
import { def } from '../src/context.js';
import type { Action, Decision } from '../src/types.js';
import { parsePilotSpec } from './lib/pilotSpec.js';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1] as string, m[2] ?? '1');
}
const dir = 'src/__tests__/fixtures/live-logs';
const logs = args.get('logs')
  ? (args.get('logs') as string).split(',')
  : readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .sort()
      .map((f) => join(dir, f));
const specs = (args.get('pilots') ?? 'policy,greedy,search').split(',');
const nExamples = Number(args.get('examples') ?? 3);
/** --show=cards prints every disagreement of that group (clean decisions) with the options on offer. */
const show = args.get('show');

/** The kind of an option: for a main decision the action type (a Trainer by its Trainer type), else the decision kind. */
function kindOf(o: ReplayObservation, idx: number): string {
  const d = o.decision;
  if (d.kind !== 'main') return d.kind;
  const a = (d.actions as Action[])[idx];
  if (!a) return '?';
  if (a.t === 'trainer') {
    const x = def(o.game.ctx, a.card);
    return `trainer:${x.ttype}`;
  }
  return a.t;
}

/** Decision kind a sample is counted under (by what the human did). */
function groupOf(o: ReplayObservation): string {
  return o.decision.kind === 'main' ? kindOf(o, o.choice[0] as number) : o.decision.kind;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();

interface Sample {
  log: string;
  o: ReplayObservation;
}

const samples: Sample[] = [];
const logInfo: { log: string; replayed: string; samples: number }[] = [];
for (const f of logs) {
  const r = replayLog(readFileSync(f, 'utf8'), { observe: () => collector() });
  const obs = (r.observed ?? []) as ReplayObservation[];
  for (const o of obs) samples.push({ log: f.replace(/^.*[\\/]/, ''), o });
  logInfo.push({ log: f, replayed: `${r.replayed}/${r.actions}${r.divergence ? ` (diverged line ${r.divergence.line})` : ''}`, samples: obs.length });
}
function collector() {
  const out: ReplayObservation[] = [];
  return {
    decision(o: ReplayObservation) {
      if (!o.known) return;
      // Own copy: the replay carries on mutating its game.
      const g = o.game.clone();
      out.push({ ...o, game: g, decision: g.decision as Decision });
    },
    finish: () => out,
  };
}

console.log(`Replayed ${logs.length} logs: ${logInfo.map((l) => `${l.log.replace(/^.*[\\/]/, '')} ${l.replayed}`).join(', ')}`);
// Single-option decisions are not decisions.
const usable = samples.filter(({ o }) => (o.options.length ?? 0) > 1 && !(o.decision.min === o.decision.max && o.decision.max === o.options.length && o.decision.kind !== 'main'));
// What the human did from each main decision to the end of that turn (by option text), for the order-forgiving metric.
const rest = new Map<ReplayObservation, Set<string>>();
{
  const byTurn = new Map<string, ReplayObservation[]>();
  for (const { log, o } of usable) {
    if (o.decision.kind !== 'main') continue;
    const k = `${log}|${o.event?.turn ?? o.game.state.turn}|${o.decision.player}`;
    byTurn.set(k, [...(byTurn.get(k) ?? []), o]);
  }
  for (const list of byTurn.values()) {
    const acc = new Set<string>();
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i] as ReplayObservation;
      acc.add(o.options[o.choice[0] as number] as string);
      rest.set(o, new Set(acc));
    }
  }
}
const clean = usable.filter(({ o }) => o.fillersInHand === 0);
console.log(`${usable.length} decisions the log answered with a real choice; ${clean.length} with no hidden filler in the deciding player's hand ("clean").\n`);

interface Stat {
  n: number;
  hit: number;
  nClean: number;
  hitClean: number;
  /** Main: the pilot at least picked the same TYPE of action. */
  typeHit: number;
  /** Main: the pilot picked something the human did at this point OR LATER IN THE SAME TURN (order forgiven). */
  planHit: number;
}
const blank = (): Stat => ({ n: 0, hit: 0, nClean: 0, hitClean: 0, typeHit: 0, planHit: 0 });
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '  - ');

interface Disagreement {
  key: string;
  count: number;
  ex: { log: string; line: string; human: string; pilot: string }[];
}
const result: Record<string, { byGroup: Record<string, Stat>; overall: Stat; top: Disagreement[] }> = {};

for (const spec of specs) {
  const byGroup: Record<string, Stat> = {};
  const overall = blank();
  const dis = new Map<string, Disagreement>();
  const t0 = Date.now();
  let seq = 0;
  const pilotsByLog = new Map<string, ReturnType<typeof parsePilotSpec>>();
  for (const { log, o } of usable) {
    // One pilot per log (its rng advances with the decisions asked), as in a game.
    let pilot = pilotsByLog.get(log);
    if (!pilot) {
      pilot = parsePilotSpec(spec, 11 + logs.indexOf(logs.find((l) => l.endsWith(log)) as string));
      pilotsByLog.set(log, pilot);
    }
    const g = o.game.clone();
    const d = g.decision as Decision;
    let pick: number[];
    try {
      pick = pilot.choose(g, d);
    } catch (e) {
      throw new Error(`${spec} threw at ${log} line ${o.event?.line}: ${(e as Error).message}`);
    }
    const hit = sameSet(pick, o.choice);
    const grp = groupOf(o);
    const st = (byGroup[grp] ??= blank());
    for (const s of [st, overall]) {
      s.n++;
      if (hit) s.hit++;
      if (o.fillersInHand === 0) {
        s.nClean++;
        if (hit) s.hitClean++;
      }
    }
    if (d.kind === 'main' && kindOf(o, pick[0] as number) === grp) {
      st.typeHit++;
      overall.typeHit++;
    }
    if (d.kind === 'main' && rest.get(o)?.has(o.options[pick[0] as number] as string)) {
      st.planHit++;
      overall.planHit++;
    }
    if (!hit && show && grp === show && o.fillersInHand === 0) {
      const t = (i: number[]) => i.map((k) => readable(o.options[k] as string, d.player)).join(' | ');
      console.log(`  [${spec}] ${log} ${o.event ? `line ${o.event.line}` : `T${o.game.state.turn}`} "${d.prompt}" options: ${o.options.map((x) => readable(x, d.player)).join(' / ')}
      human: ${t(o.choice)}   pilot: ${t(pick)}`);
    }
    if (!hit) {
      const show = (i: number) => readable(o.options[i] as string, d.player);
      const human = o.choice.map(show).join(' | ') || '(none)';
      const chose = pick.map(show).join(' | ') || '(none)';
      const hk = d.kind === 'main' ? grp : `${d.kind}`;
      const pk = d.kind === 'main' ? kindOf(o, pick[0] as number) : `${d.kind}`;
      const key = d.kind === 'main' ? `${hk} -> ${pk}` : `${d.kind}: ${truncate(d.prompt, 60)}`;
      const e = dis.get(key) ?? { key, count: 0, ex: [] };
      e.count++;
      if (e.ex.length < nExamples && o.fillersInHand === 0) e.ex.push({ log, line: String(o.event?.line ?? `T${o.game.state.turn}`), human, pilot: chose });
      dis.set(key, e);
    }
    seq++;
  }
  const top = [...dis.values()].sort((a, b) => b.count - a.count);
  result[spec] = { byGroup, overall, top };
  console.log(`=== ${spec}  (${seq} decisions in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const mainN = Object.entries(byGroup).filter(([g]) => !['cards', 'slots', 'promote', 'option'].includes(g)).reduce((a, [, s]) => a + s.n, 0);
  console.log(`main-phase actions only: exact ${pct(Object.entries(byGroup).filter(([g]) => !['cards', 'slots', 'promote', 'option'].includes(g)).reduce((a, [, s]) => a + s.hit, 0), mainN)}, same-type ${pct(overall.typeHit, mainN)}, in-turn-plan ${pct(overall.planHit, mainN)} (n=${mainN}, all hands)`);
  console.log(`overall: clean ${pct(overall.hitClean, overall.nClean)} (${overall.hitClean}/${overall.nClean})   all ${pct(overall.hit, overall.n)} (${overall.hit}/${overall.n})`);
  const rows = Object.entries(byGroup).sort((a, b) => b[1].n - a[1].n);
  for (const [g, s] of rows) {
    const t = g === 'cards' || g === 'slots' || g === 'promote' || g === 'option' ? '' : `   same-type ${pct(s.typeHit, s.n)}   in-turn-plan ${pct(s.planHit, s.n)}`;
    console.log(`  ${g.padEnd(18)} clean ${pct(s.hitClean, s.nClean).padStart(6)} (${s.hitClean}/${s.nClean})   all ${pct(s.hit, s.n).padStart(6)} (${s.hit}/${s.n})${t}`);
  }
  console.log('  most common disagreements (examples are clean decisions):');
  for (const e of top.slice(0, 8)) {
    console.log(`   ${String(e.count).padStart(3)}x ${e.key}`);
    for (const x of e.ex) console.log(`        ${x.log}:${x.line}  human: ${truncate(x.human)}  |  pilot: ${truncate(x.pilot)}`);
  }
  console.log();
}

/** A Pokémon option's signature ("owner|active|name|damage|cond|energy|tools") as text; other options unchanged. */
function readable(opt: string, who: number): string {
  const m = /^(\d)\|(true|false)\|([^|]*)\|(\d+)\|(\d+)\|([^|]*)\|(.*)$/.exec(opt);
  if (!m) return opt;
  const [, owner, active, nm, dmg, , en, tools] = m;
  return `${Number(owner) === who ? 'my' : 'their'} ${nm} (${active === 'true' ? 'active' : 'bench'}${dmg !== '0' ? `, ${dmg} dmg` : ''}${en ? `, ${en}` : ''}${tools ? `, ${tools}` : ''})`;
}

function truncate(s: string, n = 90): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

if (args.get('json')) writeFileSync(args.get('json') as string, JSON.stringify(result, null, 1));
