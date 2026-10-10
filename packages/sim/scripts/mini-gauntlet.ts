/**
 * Quick sanity gauntlet with the search pilot on both sides (not CI):
 *   node --import tsx scripts/mini-gauntlet.ts [deck="Hide 'n' Sneak"] [pairsPerOpponent=2]
 */
import { createContext } from '../src/context.js';
import { Game } from '../src/game.js';
import { playOut } from '../src/play.js';
import { makePilot } from '../src/pilot/index.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from '../src/__tests__/decks.js';
import { GAUNTLET_LISTS, gauntletDeck } from '../src/__tests__/gauntlet.js';

const subject = process.argv[2] === 'slowking' ? TOOLBOX_SLOWKING : HIDE_N_SNEAK;
const pairs = Number(process.argv[3] ?? 2);
const t0 = Date.now();
let total = 0;
for (const name of Object.keys(GAUNTLET_LISTS)) {
  const opp = gauntletDeck(name);
  let w = 0;
  let l = 0;
  let d = 0;
  let turns = 0;
  const reasons: string[] = [];
  for (let k = 0; k < pairs; k++) {
    for (const seat of [0, 1] as const) {
      const ctx = createContext(seat === 0 ? subject : opp, seat === 0 ? opp : subject, { first: 0, maxTurns: 60 });
      const seed = 7000 + k;
      const g = playOut(new Game(ctx, null, seed), [makePilot('search', seed * 2 + 1), makePilot('search', seed * 2 + 2)]);
      const me = seat;
      if (g.state.winner === me) w++;
      else if (g.state.winner === null) d++;
      else l++;
      turns += g.state.turn;
      reasons.push(g.state.winReason ?? '?');
      total++;
    }
  }
  console.log(`${subject.name} vs ${name}: ${w}-${l}-${d}, avg ${(turns / (2 * pairs)).toFixed(1)} turns, ends: ${reasons.join(',')}`);
}
console.log(`${total} games in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
