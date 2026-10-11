/**
 * The one place a Pokémon's stack of cards changes by evolving or devolving.
 *
 * Whatever puts an Evolution card on a Pokémon (from the hand, the deck, Rare Candy, a Trainer, an Ability) or takes one off
 * (Claydol, Strange Timepiece, Espeon ex, ...) leaves the Pokémon in the same state, so every implementation goes through
 * here instead of repeating the bookkeeping (and forgetting a piece of it):
 *
 * - Special Conditions are removed, except Confusion where `keepConfusion` applies (Dizzying Valley);
 * - the effects of attacks on the Pokémon end, timed AND delayed (`clearAttackEffects`);
 * - "moved to the Active Spot this turn" is forgotten (TPCi ruling 2265);
 * - once-per-turn Ability use is per Ability: an Ability the new top card shares by name with the old one stays spent, the
 *   others are fresh (rules audit);
 * - evolving marks the Pokémon as evolved this turn (it can't evolve again). Devolving does not, except where the card says so.
 *
 * The caller emits the event and queues the card's triggers as its own text requires (the `evolve` event, `evolveFromHand`
 * triggers); where the evolution card comes from and where a devolved card goes is also the caller's business.
 */
import type { Env } from './context.js';
import { def } from './context.js';
import { confusionKept } from './query.js';
import { clearAttackEffects, topCard } from './state.js';
import { CONFUSED, type GameState, type Slot } from './types.js';

/** After the top card of `sl` changed by evolving or devolving: `oldTop` is the card that was on top before. */
function settleStackChange(env: Env, s: GameState, sl: Slot, oldTop: number): void {
  const spent = sl.usedAbilities.map((i) => def(env.ctx, oldTop).abilities[i]?.name);
  sl.usedAbilities = def(env.ctx, topCard(sl)).abilities.flatMap((ab, i) => (spent.includes(ab.name) ? [i] : []));
  sl.cond = confusionKept(env, s, sl) ? sl.cond & CONFUSED : 0;
  delete sl.movedActiveTurn;
  clearAttackEffects(s, sl.id);
}

/**
 * Put `card` (already taken out of its zone) on top of `sl` as an Evolution. Does everything evolving does to the Pokémon;
 * the caller emits the `evolve` event and queues any evolve triggers.
 */
export function evolveOnto(env: Env, s: GameState, sl: Slot, card: number): void {
  const oldTop = topCard(sl);
  sl.cards.push(card);
  sl.evolvedTurn = s.turn;
  settleStackChange(env, s, sl, oldTop);
}

/**
 * Take the top `n` cards (default 1) off `sl`, never the bottom card, and return them (bottom to top). Does everything evolving does to the Pokémon, like Claydol's
 * Devolution Ray before it; `cantEvolve` also marks it as evolved this turn (Strange Timepiece: "can't evolve this turn").
 * The caller moves the returned cards (to the hand, the deck) and handles protection from the effect before calling.
 */
export function devolve(env: Env, s: GameState, sl: Slot, n = 1, cantEvolve = false): number[] {
  const k = Math.max(0, Math.min(n, sl.cards.length - 1));
  if (!k) return [];
  const oldTop = topCard(sl);
  const removed = sl.cards.splice(sl.cards.length - k, k);
  if (cantEvolve) sl.evolvedTurn = s.turn;
  settleStackChange(env, s, sl, oldTop);
  return removed;
}
