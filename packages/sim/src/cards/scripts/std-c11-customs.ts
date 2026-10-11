/**
 * Bespoke effects for the "std-c11" batch (std-c11.ts). Names are prefixed `c11.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c11.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { cardMatches } from '../../eval.js';
import { countersPrevented, effectsPrevented, retreatCost } from '../../query.js';
import { emit, findSlot, opp, removeFrom, shuffleDeck, topCard } from '../../state.js';
import type { GameState, Decision, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function idsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? (v as number[]).slice() : typeof v === 'number' ? [v] : [];
}

/**
 * Tropius, Fruity Aroma: "Look at the top 6 cards of your deck, and you may reveal any number of Pokémon you find there
 * and put them into your hand. Shuffle the other cards back into your deck."
 * Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2403/): you don't shuffle if no cards go back into the deck.
 * args: { n, filter } -- the controller picks any number (0 to all) of the cards among the top n that match `filter`;
 * they are revealed and go to the hand. The deck is shuffled only if some of the looked-at cards stay in it.
 */
registerCustom('c11.lookTakeAny', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const n = Number(args.n ?? 6);
  const filter = args.filter as Filter | undefined;
  const looked = ps.deck.slice(Math.max(0, ps.deck.length - n));
  if (!looked.length) return 'next';
  const opts = looked.slice().reverse().filter((c) => cardMatches(env, c, filter)); // top first
  const finish = (cards: number[]): 'next' => {
    for (const c of cards) {
      if (!removeFrom(ps.deck, c)) continue;
      ps.hand.push(c);
      ps.revealed.push(c);
    }
    if (cards.length) emit(env, { type: 'search', player: f.player, found: cards.slice() });
    if (looked.length - cards.length > 0) shuffleDeck(env, s, f.player);
    return 'next';
  };
  if (answer !== undefined) return finish((answer as number[]).filter((c) => opts.includes(c)));
  if (!opts.length) return finish([]);
  return ask(s, { player: f.player, kind: 'cards', prompt: 'Reveal any number of these Pokémon and put them into your hand', min: 0, max: opts.length, values: opts }, 'cards');
});

/**
 * Sizzlipede, Bug Out: "Reveal the bottom 7 cards of your deck, and this attack does 50 damage for each Pokémon you find
 * there that has the Bug Out attack. Then, shuffle any revealed Pokémon back into your deck. Discard the other cards."
 * Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2401/): all revealed Pokémon get shuffled back; non-Pokémon are discarded.
 * args: { n, attack, as } -- looks at the bottom n cards (all of them if the deck is smaller), counts the Pokémon among them
 * that have the attack named `attack` into variable `as`, discards every revealed card that is not a Pokémon, and shuffles
 * the deck if a Pokémon was revealed (the revealed Pokémon never left it).
 */
registerCustom('c11.revealBottom', (env, s, f, args) => {
  const ps = s.p[f.player];
  const n = Number(args.n ?? 7);
  const attack = String(args.attack);
  const bottom = ps.deck.slice(0, n); // index 0 is the bottom of the deck
  let count = 0;
  let pokemon = 0;
  const gone: number[] = [];
  for (const c of bottom) {
    if (def(env.ctx, c).kind !== 'pokemon') {
      gone.push(c);
      continue;
    }
    pokemon++;
    if (cardMatches(env, c, { cat: 'pokemon', hasAttack: attack })) count++;
  }
  f.vars[String(args.as ?? 'n')] = count;
  for (const c of gone) {
    removeFrom(ps.deck, c);
    ps.discard.push(c);
  }
  if (gone.length) emit(env, { type: 'discard', player: f.player, cards: gone });
  if (pokemon) shuffleDeck(env, s, f.player);
  return 'next';
});

/**
 * Spiritomb, Spiritual End: "... quadruple the number of damage counters on each of them."
 * Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2411/): multiply existing counters by 4; if none, no counters appear.
 * args: { slots, factor } -- each Pokémon chosen into variable `slots` that has damage counters gets (factor - 1) times
 * that many MORE counters. Placing them is an effect, so a Pokémon protected from the effects of attacks or from having
 * damage counters placed on it is left as it is.
 */
registerCustom('c11.multiplyCounters', (env, s, f, args) => {
  const factor = Number(args.factor ?? 2);
  const kind = f.kind === 'ability' ? 'ability' : 'attack';
  for (const id of idsOf(f.vars[String(args.slots ?? 't')])) {
    const loc = findSlot(s, id);
    if (!loc) continue;
    const sl = loc.slot;
    const n = (sl.damage / 10) * (factor - 1);
    if (n <= 0) continue;
    if (loc.owner !== f.player && effectsPrevented(env, s, sl, f.player, kind)) continue;
    if (countersPrevented(env, s, sl, f.player, kind)) continue;
    sl.damage += n * 10;
    emit(env, { type: 'counters', player: loc.owner, slot: sl.id, n });
  }
  return 'next';
});

/**
 * Mega Chandelure ex, Phantom Maze: "This attack does 50 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost."
 * Ruling (TPCi Rules Team 2026-04-02, https://compendium.pokegym.net/ruling/2386/): Antique Fossils have no Retreat Cost at all (not a cost of zero); that is fixed, so Binding Flame cannot give them one.
 * args: { as } -- sets variable `as` (default `n`) to the Retreat Cost the Defending Pokémon has right now, after every
 * effect that changes it, or 0 when that "Pokémon" is a Trainer card played as one (an Antique fossil has no Retreat
 * Cost for an effect to add to).
 */
registerCustom('c11.retreatCostOf', (env, s, f, args) => {
  const t = s.p[opp(f.player)].active;
  f.vars[String(args.as ?? 'n')] = t && def(env.ctx, topCard(t)).kind === 'pokemon' ? retreatCost(env, s, t) : 0;
  return 'next';
});

/**
 * Rampardos ex, Destructive Headbutting: "... discard an Energy from your opponent's Active Pokémon."
 * Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2393/): Hide 'n' Sneak blocks energy discard from Destructive Headbutting.
 * The controller picks which Energy card is discarded (no question when the choices are identical). A Defending Pokémon
 * protected from the effects of Abilities (or attacks, when an attack uses this) keeps its Energy: the plain
 * `discardEnergy` step only honours that protection for attacks.
 */
registerCustom('c11.discardOppActiveEnergy', (env, s, f, _args, answer) => {
  const o = opp(f.player);
  const t = s.p[o].active;
  if (!t || !t.energy.length) return 'next';
  if (effectsPrevented(env, s, t, f.player, f.kind === 'ability' ? 'ability' : 'attack')) return 'next';
  let card: number;
  if (answer !== undefined) card = (answer as number[])[0] as number;
  else if (new Set(t.energy.map((c) => def(env.ctx, c).idx)).size === 1) card = t.energy[0] as number;
  else return ask(s, { player: f.player, kind: 'cards', prompt: "Discard which of your opponent's Active Pokémon's Energy?", min: 1, max: 1, values: t.energy.slice() }, 'cards');
  if (!removeFrom(t.energy, card)) return 'next';
  s.p[o].discard.push(card);
  emit(env, { type: 'discard', player: o, cards: [card] });
  return 'next';
});
