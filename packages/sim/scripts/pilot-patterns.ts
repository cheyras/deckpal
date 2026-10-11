/**
 * Where does a pilot lose games? Plays the pilot against itself over the deck pool and prints, per deck,
 * the patterns the head-to-head cannot show: decking out, no attack by the third own turn, turns that
 * attach nothing / play no Supporter / attack, and how the losses end.
 *
 *   node --import tsx scripts/pilot-patterns.ts [--pilot=search] [--rounds=1] [--pool=all|meta|owner]
 */
import { createContext, def } from '../src/context.js';
import { Game } from '../src/game.js';
import { playOut } from '../src/play.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING, fromIds } from '../src/__tests__/decks.js';
import { META_LISTS } from '../src/__tests__/meta/index.js';
import { parsePilotSpec } from './lib/pilotSpec.js';

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1] as string, m[2] ?? '1');
}
const spec = args.get('pilot') ?? 'search';
const rounds = Number(args.get('rounds') ?? 1);
const poolName = args.get('pool') ?? 'all';
const meta = Object.entries(META_LISTS).map(([n, l]) => fromIds(n, l));
const owner = [HIDE_N_SNEAK, TOOLBOX_SLOWKING];
const pool = poolName === 'meta' ? meta : poolName === 'owner' ? owner : [...owner, ...meta];

interface Agg {
  games: number;
  wins: number;
  deckOutLosses: number;
  deckOutWins: number;
  noPokemonLosses: number;
  turnsPlayed: number;
  noAttack3: number; // games where no attack was made by the player's 3rd own turn
  firstAttackTurn: number;
  firstAttackN: number;
  ownTurns: number;
  withAttach: number;
  withSupporter: number;
  withAttack: number;
  endedWithCards: number; // hand size when ending a turn
  prizesTakenInLoss: number;
  losses: number;
  stranded: number; // own turns that ended with no Pokémon able to attack next turn... (approx: no attack and no attach)
}
const blank = (): Agg => ({ games: 0, wins: 0, deckOutLosses: 0, deckOutWins: 0, noPokemonLosses: 0, turnsPlayed: 0, noAttack3: 0, firstAttackTurn: 0, firstAttackN: 0, ownTurns: 0, withAttach: 0, withSupporter: 0, withAttack: 0, endedWithCards: 0, prizesTakenInLoss: 0, losses: 0, stranded: 0 });
const byDeck = new Map<string, Agg>();
const t0 = Date.now();
let total = 0;
for (let r = 0; r < rounds; r++) {
  for (let a = 0; a < pool.length; a++) {
    for (let b = a; b < pool.length; b++) {
      for (const swap of a === b ? [false] : [false, true]) {
        const [x, y] = swap ? [pool[b]!, pool[a]!] : [pool[a]!, pool[b]!];
        const seed = 5200 + r * 97 + a * 7 + b;
        const ctx = createContext(x, y, { first: 0, maxTurns: 60, events: true });
        const g = playOut(new Game(ctx, null, seed), [parsePilotSpec(spec, seed * 2 + 1), parsePilotSpec(spec, seed * 2 + 2)]);
        total++;
        for (const p of [0, 1] as const) {
          const name = (p === 0 ? x : y).name;
          const ag = byDeck.get(name) ?? blank();
          byDeck.set(name, ag);
          ag.games++;
          const won = g.state.winner === p;
          if (won) ag.wins++;
          const reason = g.state.winReason ?? '';
          if (g.state.winner !== null && !won) {
            ag.losses++;
            ag.prizesTakenInLoss += g.state.p[p].prizesTaken;
            if (/deck/i.test(reason)) ag.deckOutLosses++;
            if (/no pok/i.test(reason)) ag.noPokemonLosses++;
          }
          if (won && /deck/i.test(reason)) ag.deckOutWins++;
          // Own turns from the event log.
          let ownTurn = 0;
          let att = false;
          let sup = false;
          let atk = false;
          let attacked3 = false;
          let first = true;
          for (const e of g.events) {
            if (e.type === 'turn_start' && e.player === p) {
              ownTurn++;
              att = sup = atk = false;
            } else if ('player' in e && e.player === p) {
              if (e.type === 'attach') att = true;
              if (e.type === 'play_trainer' && def(ctx, e.card).ttype === 'supporter') sup = true;
              if (e.type === 'attack') {
                atk = true;
                if (ownTurn <= 3) attacked3 = true;
                if (first) {
                  ag.firstAttackTurn += ownTurn;
                  ag.firstAttackN++;
                  first = false;
                }
              }
              if (e.type === 'end_turn') {
                ag.ownTurns++;
                if (att) ag.withAttach++;
                if (sup) ag.withSupporter++;
                if (atk) ag.withAttack++;
              }
            }
          }
          if (!attacked3 && ownTurn >= 3) ag.noAttack3++;
        }
      }
    }
  }
}
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
console.log(`pilot ${spec}, pool ${poolName}, ${total} self-play games in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log('deck'.padEnd(36) + 'games  win  deckOutLoss  noMonLoss  noAtkBy3  firstAtk  attach/turn  supp/turn  atk/turn  prizes-in-loss');
const sum = blank();
for (const [name, ag] of [...byDeck].sort()) {
  for (const k of Object.keys(ag) as (keyof Agg)[]) sum[k] += ag[k];
  console.log(
    name.slice(0, 35).padEnd(36) +
      `${String(ag.games).padStart(5)}  ${pct(ag.wins, ag.games).padStart(4)}  ${pct(ag.deckOutLosses, ag.games).padStart(10)}  ${pct(ag.noPokemonLosses, ag.games).padStart(9)}  ${pct(ag.noAttack3, ag.games).padStart(8)}  ${(ag.firstAttackTurn / Math.max(1, ag.firstAttackN)).toFixed(1).padStart(8)}  ${pct(ag.withAttach, ag.ownTurns).padStart(11)}  ${pct(ag.withSupporter, ag.ownTurns).padStart(9)}  ${pct(ag.withAttack, ag.ownTurns).padStart(8)}  ${(ag.prizesTakenInLoss / Math.max(1, ag.losses)).toFixed(1).padStart(14)}`,
  );
}
console.log(
  'ALL'.padEnd(36) +
    `${String(sum.games).padStart(5)}  ${pct(sum.wins, sum.games).padStart(4)}  ${pct(sum.deckOutLosses, sum.games).padStart(10)}  ${pct(sum.noPokemonLosses, sum.games).padStart(9)}  ${pct(sum.noAttack3, sum.games).padStart(8)}  ${(sum.firstAttackTurn / Math.max(1, sum.firstAttackN)).toFixed(1).padStart(8)}  ${pct(sum.withAttach, sum.ownTurns).padStart(11)}  ${pct(sum.withSupporter, sum.ownTurns).padStart(9)}  ${pct(sum.withAttack, sum.ownTurns).padStart(8)}  ${(sum.prizesTakenInLoss / Math.max(1, sum.losses)).toFixed(1).padStart(14)}`,
);
