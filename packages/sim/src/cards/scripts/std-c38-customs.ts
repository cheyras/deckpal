/**
 * Bespoke effects for the "std-c38" batch (std-c38.ts). Names are prefixed `c38.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c38.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { registerCustom, registerCustomCond } from '../../customs.js';
import { effectsPrevented } from '../../query.js';
import { allSlots, opp } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode: 'slots' } };
  return 'wait';
}

/**
 * Archeops, Ancient Wing: "...you may devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it
 * into your opponent's hand." (the asking half)
 * True when one of the opponent's Pokémon has a card under its top card, i.e. there is something to devolve it into. A Pokémon
 * put directly into play with no lower stage cannot devolve (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, ruling 2178).
 */
registerCustomCond('c38.oppHasDevolvable', (_env, s, ec) => allSlots(s.p[opp(ec.player)]).some((sl) => sl.cards.length >= 2));

/**
 * Archeops, Ancient Wing: devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into
 * your opponent's hand.
 * The user picks one of the opponent's Pokémon that has an Evolution card on it (no question with one). The top card of its stack
 * goes to its owner's hand, face up; the Pokémon recovers from all Special Conditions and loses the effects of attacks on it, as
 * when it evolves. An Ability's effect: a Pokémon protected from the effects of Abilities is left alone.
 */
registerCustom('c38.devolveOppAbility', (env, s, f, _args, answer) => {
  const owner = opp(f.player);
  const ps = s.p[owner];
  const cands = allSlots(ps).filter((sl) => sl.cards.length >= 2);
  if (!cands.length) return 'next';
  let id: number | undefined;
  if (answer !== undefined) id = (answer as number[])[0];
  else if (cands.length === 1) id = cands[0]!.id;
  else {
    return ask(s, {
      player: f.player,
      kind: 'slots',
      prompt: "Devolve which of your opponent's evolved Pokémon?",
      min: 1,
      max: 1,
      values: cands.map((x) => x.id),
    });
  }
  const sl = cands.find((x) => x.id === id);
  if (!sl) return 'next';
  if (effectsPrevented(env, s, sl, f.player, 'ability')) return 'next';
  const top = sl.cards.pop() as number;
  ps.hand.push(top);
  ps.revealed.push(top);
  sl.cond = 0;
  s.effects = s.effects.filter((x) => !(x.slot === sl.id && x.fromAttack));
  return 'next';
});
