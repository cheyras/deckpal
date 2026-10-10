/**
 * Heavy random-play fuzz across every pair of account decks (not part of CI).
 *   node --import tsx scripts/fuzz.ts [seedsPerPair=10]
 * Prints failures (deck pair, seed, decision index, error) and engine throughput.
 */
import { Game } from '../src/game.js';
import { RandomPilot } from '../src/pilot/random.js';
import { allSlots, slotCards } from '../src/state.js';
import { HIDE_N_SNEAK, TOOLBOX_SLOWKING } from '../src/__tests__/decks.js';
import { GAUNTLET_LISTS, gauntletDeck } from '../src/__tests__/gauntlet.js';

const per = Number(process.argv[2] ?? 10);
const decks = [HIDE_N_SNEAK, TOOLBOX_SLOWKING, ...Object.keys(GAUNTLET_LISTS).map(gauntletDeck)];

function zonesOk(g: Game): string | null {
  const s = g.state;
  for (const p of [0, 1] as const) {
    const ps = s.p[p];
    const all = [...ps.deck, ...ps.hand, ...ps.discard, ...ps.prizes, ...ps.lost, ...allSlots(ps).flatMap(slotCards), ...s.limbo.filter((c) => g.ctx.owner[c] === p)];
    if (s.stadium?.owner === p) all.push(s.stadium.card);
    if (new Set(all).size !== all.length) return `P${p} duplicate card`;
    if (all.length !== g.ctx.iids[p].length) return `P${p} has ${all.length} cards`;
    if (all.some((c) => g.ctx.owner[c] !== p)) return `P${p} holds an opponent card`;
  }
  return null;
}

let games = 0;
let steps = 0;
let fails = 0;
const reasons = new Map<string, number>();
const t0 = Date.now();
for (let i = 0; i < decks.length; i++) {
  for (let j = 0; j < decks.length; j++) {
    for (let k = 0; k < per; k++) {
      const seed = 50000 + i * 1000 + j * 50 + k;
      const g = new Game(decks[i]!, decks[j]!, seed, { maxTurns: 80 }).start();
      const pilots = [new RandomPilot(seed * 3), new RandomPilot(seed * 5)] as const;
      let n = 0;
      try {
        while (!g.over && n < 8000) {
          const d = g.decision!;
          g.submit(pilots[d.player].choose(g, d));
          n++;
          const z = zonesOk(g);
          if (z) throw new Error(z);
        }
        if (!g.over) throw new Error('unfinished');
        reasons.set(g.state.winReason ?? '?', (reasons.get(g.state.winReason ?? '?') ?? 0) + 1);
      } catch (e) {
        fails++;
        if (fails <= 25) console.log(`FAIL ${decks[i]!.name} vs ${decks[j]!.name} seed ${seed} decision ${n}: ${(e as Error).message.split('\n')[0]}`);
      }
      games++;
      steps += g.state.steps;
    }
  }
}
const ms = Date.now() - t0;
console.log(`${games} games, ${fails} failures, ${(steps / (ms / 1000)).toFixed(0)} steps/s, ${(ms / games).toFixed(1)} ms/game`);
console.log('end reasons', Object.fromEntries(reasons));
