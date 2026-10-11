/**
 * Speed + determinism probe for search-vs-search play (not CI): plays fixed
 * seeds across the account matchups, hashes every choice either pilot made and
 * every final result into one signature, and reports ms/game. A speed change
 * that must not change play has to leave the signature identical.
 *
 *   node --import tsx scripts/replay-sig.ts [games=20]
 *   node --cpu-prof --import tsx scripts/replay-sig.ts 8     # profile
 */
import { createContext, type DeckInput } from '../src/context.js';
import { Game } from '../src/game.js';
import { playOut } from '../src/play.js';
import { makePilot } from '../src/pilot/index.js';
import type { Pilot } from '../src/pilot/types.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from '../src/__tests__/decks.js';
import { GAUNTLET_LISTS, gauntletDeck } from '../src/__tests__/gauntlet.js';

const games = Number(process.argv[2] ?? 20);
const opps: DeckInput[] = [TOOLBOX_SLOWKING, ...Object.keys(GAUNTLET_LISTS).map(gauntletDeck)];

let h = 0x811c9dc5;
const mix = (x: number) => {
  h ^= x & 0xffff;
  h = Math.imul(h, 0x01000193);
  h ^= x >>> 16;
  h = Math.imul(h, 0x01000193);
};
const logged = (p: Pilot): Pilot => ({
  name: p.name,
  choose(g, d) {
    const c = p.choose(g, d);
    mix(c.length);
    for (const i of c) mix(i);
    return c;
  },
});

let ms = 0;
let decisive = 0;
for (let k = 0; k < games; k++) {
  const opp = opps[k % opps.length] as DeckInput;
  const ctx = createContext(k % 2 ? opp : HIDE_N_SNEAK, k % 2 ? HIDE_N_SNEAK : opp, { maxTurns: 60 });
  const seed = 3000 + k;
  const t = performance.now();
  const g = playOut(new Game(ctx, null, seed), [logged(makePilot('search', seed * 2 + 1)), logged(makePilot('search', seed * 2 + 2))]);
  ms += performance.now() - t;
  mix(g.state.winner ?? 9);
  mix(g.state.turn);
  if (g.state.winner !== null) decisive++;
}
console.log(`${games} games, ${decisive} decisive: ${(ms / games).toFixed(0)} ms/game; signature ${(h >>> 0).toString(16)}`);
