/**
 * Bespoke effects for the "std-c03" batch (std-c03.ts). Names are prefixed `c03.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c03.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import { queueStadiumBench } from '../../interp.js';
import { emit, newSlot, rand } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/**
 * Grimsley's Move (the condition half of "You can't use this card during your first turn"): true on the turn that is
 * the controller's own first turn -- turn 1 for the player who went first, turn 2 for the other. (The engine's own
 * Supporter rule only bans the first player's turn 1.)
 */
registerCustomCond('c03.ownFirstTurn', (_env, s, ec) => s.turn === (ec.player === s.first ? 1 : 2));

/**
 * Grimsley's Move: "Look at the top 7 cards of your deck and put a {D} Pokémon you find there onto your Bench.
 * Shuffle the other cards and put them on the bottom of your deck."
 * Ruling (TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2258/): "Yes, when using this Supporter you can place any stage of {D} Pokemon you find directly onto your bench."
 * args: { n } cards to look at (default 7).
 * The controller picks one {D} Pokémon of any Stage among the top cards (no question when only one kind is there) and it
 * goes onto the Bench if there is room. All the other cards are shuffled and go to the bottom of the deck; with a full
 * Bench the {D} Pokémon goes to the bottom with them.
 */
registerCustom('c03.grimsleysMove', (env, s, f, args, answer) => {
  const p = f.player;
  const ps = s.p[p];
  const n = Number(args.n ?? 7);
  const top = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse(); // top first
  if (!top.length) return 'next';
  const dark = top.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'pokemon' && d.types.includes('Darkness');
  });
  let pick: number | undefined;
  if (ps.bench.length < 5 && dark.length) {
    if (answer !== undefined) pick = (answer as number[])[0];
    else if (new Set(dark.map((c) => def(env.ctx, c).idx)).size === 1) pick = dark[0];
    else {
      return ask(
        s,
        { player: p, kind: 'cards', prompt: 'Put a Darkness Pokémon onto your Bench', min: 1, max: 1, values: dark },
        'cards',
      );
    }
  }
  ps.deck.splice(ps.deck.length - top.length, top.length);
  ps.knownTop = Math.max(0, ps.knownTop - top.length);
  const rest = top.filter((c) => c !== pick);
  if (pick !== undefined && dark.includes(pick)) {
    const sl = newSlot(s, pick);
    ps.bench.push(sl);
    emit(env, { type: 'play_to_bench', player: p, card: pick, slot: sl.id });
    queueStadiumBench(env, s, sl, p);
  } else if (pick !== undefined) {
    rest.push(pick);
  }
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s, p) * (i + 1));
    const t = rest[i] as number;
    rest[i] = rest[j] as number;
    rest[j] = t;
  }
  ps.deck.unshift(...rest); // the bottom of the deck is index 0
  emit(env, { type: 'shuffle', player: p });
  return 'next';
});
