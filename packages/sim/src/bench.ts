/**
 * `pnpm bench`: engine speed under random play, and seconds per full game for
 * the greedy and search pilots on the owner's two decks (Hide 'n' Sneak vs
 * Toolbox Slowking). The simulation runner's budget is ~30 search-vs-search
 * games in 45 s of serverless time, so a game must stay well under 1.5 s.
 *
 *   pnpm bench                 # defaults
 *   pnpm bench -- --games 20 --nodes 160 --worlds 2
 */
import { createContext } from './context.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from './__tests__/decks.js';
import { Game } from './game.js';
import { playOut } from './play.js';
import { makePilot, type PilotName } from './pilot/index.js';
import { RandomPilot } from './pilot/random.js';
import type { SearchOptions } from './pilot/search.js';

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const games = arg('games', 10);
const maxTurns = arg('turns', 50);
const searchOpts: SearchOptions = {
  nodes: arg('nodes', NaN) || undefined,
  worlds: arg('worlds', NaN) || undefined,
};
const ctx = createContext(HIDE_N_SNEAK, TOOLBOX_SLOWKING, { maxTurns });

// 1. Engine steps/second under random play (one core).
{
  const t0 = performance.now();
  let steps = 0;
  let decisions = 0;
  const n = 300;
  for (let seed = 1; seed <= n; seed++) {
    const g = new Game(ctx, null, seed).start();
    const pilots = [new RandomPilot(seed * 7), new RandomPilot(seed * 13)] as const;
    while (!g.over) {
      const d = g.decision!;
      g.submit(pilots[d.player].choose(g, d));
      decisions++;
    }
    steps += g.state.steps;
  }
  const s = (performance.now() - t0) / 1000;
  console.log(
    `random play: ${n} games in ${s.toFixed(2)} s — ${Math.round(steps / s).toLocaleString()} engine steps/s, ` +
      `${Math.round(decisions / s).toLocaleString()} decisions/s, ${((s / n) * 1000).toFixed(1)} ms/game`,
  );
}

// 2. Full games per pilot pairing (paired seeds: same seed, seats swapped).
function pairing(a: PilotName, b: PilotName): void {
  const t0 = performance.now();
  let aw = 0;
  let bw = 0;
  let dr = 0;
  let turns = 0;
  let worst = 0;
  for (let seed = 1; seed <= games; seed++) {
    for (const swap of [false, true]) {
      const g0 = performance.now();
      const A = makePilot(a, seed * 31 + 1, searchOpts);
      const B = makePilot(b, seed * 31 + 2, searchOpts);
      const g = playOut(new Game(ctx, null, seed), swap ? [B, A] : [A, B]);
      worst = Math.max(worst, performance.now() - g0);
      turns += g.state.turn;
      if (g.state.winner === null) dr++;
      else if ((g.state.winner === 0) !== swap) aw++;
      else bw++;
    }
  }
  const n = games * 2;
  const s = (performance.now() - t0) / 1000;
  console.log(
    `${a} vs ${b}: ${(s / n).toFixed(3)} s/game (worst ${(worst / 1000).toFixed(2)} s), avg ${(turns / n).toFixed(1)} turns; ` +
      `${a} ${aw}-${bw}-${dr} over ${n} paired games`,
  );
}

pairing('greedy', 'greedy');
pairing('search', 'search');
pairing('search', 'greedy');
