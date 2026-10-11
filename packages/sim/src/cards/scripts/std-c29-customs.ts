/**
 * Bespoke effects for the "std-c29" batch (std-c29.ts). Names are prefixed `c29.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c29.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { registerCustom } from '../../customs.js';
import type { Filter, PType } from '../../dsl.js';
import { cardMatches, slotMatches, slotsIn } from '../../eval.js';
import { energyUnits } from '../../query.js';
import { emit, findSlot, removeFrom, shuffleDeck } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/**
 * Maractus, Exploding Needles: "... put 6 damage counters on the Attacking Pokémon."
 * Stores the Pokémon that used the attack that Knocked this Pokémon Out into variable `as` (default `a`), even if it has since
 * left the Active Spot (an attack that switches its user out); empty when that Pokémon is no longer in play (Compendium #2106:
 * Lillie's Comfey's Fade Out puts it into the hand first, so the Ability "finds no valid target").
 */
registerCustom('c29.attackingPokemon', (_env, s, f, args) => {
  const id = s.attackBy;
  f.vars[String(args.as ?? 'a')] = id !== undefined && findSlot(s, id) ? [id] : [];
  return 'next';
});

/**
 * Roto-Stick: "Look at the top 4 cards of your deck. You may reveal any number of Supporter cards you find there and put them
 * into your hand. Shuffle the other cards back into your deck."
 * Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2377/): "Yes, the deck is shuffled." (even when every
 * card looked at was put into the hand).
 * args: { n, filter } -- the controller picks any number (0 to all) of the top n cards that match `filter`; they are revealed and
 * go to the hand; the deck is shuffled whatever is left.
 */
registerCustom('c29.lookTopTakeAny', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const n = Number(args.n ?? 4);
  const filter = args.filter as Filter | undefined;
  const looked = ps.deck.slice(Math.max(0, ps.deck.length - n));
  const opts = looked.slice().reverse().filter((c) => cardMatches(env, c, filter)); // top first
  const finish = (cards: number[]): 'next' => {
    for (const c of cards) {
      if (!removeFrom(ps.deck, c)) continue;
      ps.hand.push(c);
      ps.revealed.push(c);
    }
    emit(env, { type: 'search', player: f.player, found: cards.slice() });
    shuffleDeck(env, s, f.player);
    return 'next';
  };
  if (answer !== undefined) return finish((answer as number[]).filter((c) => opts.includes(c)));
  if (!opts.length) return finish([]);
  return ask(s, { player: f.player, kind: 'cards', prompt: 'Reveal any number of these Supporter cards and put them into your hand', min: 0, max: opts.length, values: opts }, 'cards');
});

/**
 * Iono's Voltorb, Voltaic Chain: "This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."
 * args: { zone, slotFilter, type, as } -- counts the Energy attached to all of the controller's Pokémon in `zone` that match
 * `slotFilter`, in units that provide `type` (an Energy that provides every type counts once, ruling 2119), into variable `as`.
 */
registerCustom('c29.countEnergyOnPokemon', (env, s, f, args) => {
  const type = args.type as PType;
  let n = 0;
  for (const sl of slotsIn(s, f.player, String(args.zone ?? 'myPokemon') as 'myPokemon')) {
    if (!slotMatches(env, sl, args.slotFilter as Filter | undefined)) continue;
    n += energyUnits(env, sl).filter((u) => u === type || u === 'Any').length;
  }
  f.vars[String(args.as ?? 'n')] = n;
  return 'next';
});
