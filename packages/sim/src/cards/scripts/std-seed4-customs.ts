/**
 * Bespoke effects for the "std-seed4" batch (std-seed4.ts). Names are prefixed `seed4.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-seed4.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def, type Env } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { cardMatches } from '../../eval.js';
import { queueStadiumBench } from '../../interp.js';
import { benchLimit, effectsPrevented, retreatCost } from '../../query.js';
import { allSlots, emit, findSlot, newSlot, opp, removeFrom, shuffleDeck, slotCards, takeFromZones, topCard } from '../../state.js';
import type { Decision, GameState, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function cardsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}
/** True when every card in the pool is the same card (identical Energy need no question). */
function allSame(env: Env, pool: number[]): boolean {
  return new Set(pool.map((c) => def(env.ctx, c).idx)).size <= 1;
}

/**
 * Marshadow, Shadowy Knot / Iron Bundle, Gusting Collision: "for each {C} in your opponent's Active Pokémon's Retreat Cost".
 * Sets variable `as` (default `n`) to the Retreat Cost the Defending Pokémon has right now, after every effect that
 * changes it (Air Balloon's -2 leaves {C}, a Pokémon with an effect that sets it to 0 has none).
 */
registerCustom('seed4.retreatCostOf', (env, s, f, args) => {
  const t = s.p[opp(f.player)].active;
  f.vars[String(args.as ?? 'n')] = t ? retreatCost(env, s, t) : 0;
  return 'next';
});

/**
 * Reuniclus, Summoning Gate: "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there
 * onto your Bench. Shuffle the other cards back into your deck."
 * Ruling (TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1962/): Cannot exceed bench limits; with a full bench, nothing happens and no cards are revealed.
 * Ruling (TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1959/): non-Basic Pokémon can be placed directly onto the bench from revealed cards. (non-Basic Pokémon go straight to the Bench)
 * args: { n } cards to look at (default 8).
 * With the Bench full nothing happens (no look, no shuffle). Otherwise the controller picks 0 to (free Bench spaces) of the
 * Pokémon among the top cards -- of any Stage -- and they are put onto the Bench; the deck is then shuffled.
 */
registerCustom('seed4.summoningGate', (env, s, f, args, answer) => {
  const p = f.player;
  const ps = s.p[p];
  const free = benchLimit(env, s, p) - ps.bench.length;
  if (free <= 0) return 'next';
  const n = Number(args.n ?? 8);
  if (answer === undefined) {
    const top = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse(); // top first
    const opts = top.filter((c) => def(env.ctx, c).kind === 'pokemon');
    if (opts.length) {
      return ask(
        s,
        { player: p, kind: 'cards', prompt: `Put any number of these Pokémon onto your Bench (up to ${free})`, min: 0, max: Math.min(free, opts.length), values: opts },
        'cards',
      );
    }
    shuffleDeck(env, s, p);
    return 'next';
  }
  for (const c of (answer as number[]).slice(0, free)) {
    if (!takeFromZones(ps, c)) continue;
    const sl = newSlot(s, c);
    ps.bench.push(sl);
    emit(env, { type: 'play_to_bench', player: p, card: c, slot: sl.id });
    queueStadiumBench(env, s, sl, p);
  }
  shuffleDeck(env, s, p);
  return 'next';
});

/**
 * Raging Bolt ex, Bellowing Thunder: "You may discard any amount of Basic Energy from your Pokémon." (the choice half)
 * The controller picks any number (0 to all) of the Basic Energy cards attached to any of their Pokémon, Active or
 * Benched. Nothing is discarded yet: the picked cards land in variable `as` (default `d`) for `seed4.discardPicked`,
 * which the attack runs AFTER its damage -- "Bellowing Thunder does damage first, and then the energy is discarded".
 */
registerCustom('seed4.pickBasicEnergyAmong', (env, s, f, args, answer) => {
  const as = String(args.as ?? 'd');
  const pool: number[] = [];
  const labels: string[] = [];
  for (const sl of allSlots(s.p[f.player])) {
    for (const c of sl.energy) {
      if (!cardMatches(env, c, { basicEnergy: true })) continue;
      pool.push(c);
      labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
    }
  }
  if (answer !== undefined) {
    f.vars[as] = (answer as number[]).filter((c) => pool.includes(c));
    return 'next';
  }
  if (!pool.length) {
    f.vars[as] = [];
    return 'next';
  }
  return ask(s, { player: f.player, kind: 'cards', prompt: 'Discard any amount of Basic Energy from your Pokémon', min: 0, max: pool.length, values: pool, labels }, 'cards');
});

/**
 * Raging Bolt ex, Bellowing Thunder: "...for each card you discarded in this way." (the discard half)
 * Discards the Energy cards in variable `args.cards` from whichever of the controller's Pokémon they are attached to.
 */
registerCustom('seed4.discardPicked', (env, s, f, args) => {
  const ps = s.p[f.player];
  const picked = cardsOf(f.vars[String(args.cards ?? 'd')]);
  const gone: number[] = [];
  for (const c of picked) {
    for (const sl of allSlots(ps)) {
      if (removeFrom(sl.energy, c)) {
        ps.discard.push(c);
        gone.push(c);
        break;
      }
    }
  }
  if (gone.length) emit(env, { type: 'discard', player: f.player, cards: gone });
  return 'next';
});

/**
 * Unfezant, Opposing Winds: "You may put 2 Energy attached to your opponent's Active Pokémon into their hand."
 * (the "may" is the program's). args: { n } Energy cards (default 2). The attacker picks which; with fewer than n
 * attached, all of them go. A Defending Pokémon protected from the effects of attacks keeps its Energy.
 */
registerCustom('seed4.energyToOppHand', (env, s, f, args, answer) => {
  const t = s.p[opp(f.player)].active;
  if (!t || !t.energy.length) return 'next';
  if (effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
  const n = Number(args.n ?? 2);
  let chosen: number[];
  if (answer !== undefined) chosen = (answer as number[]).filter((c) => t.energy.includes(c));
  else if (t.energy.length <= n) chosen = t.energy.slice();
  else if (allSame(env, t.energy)) chosen = t.energy.slice(0, n);
  else return ask(s, { player: f.player, kind: 'cards', prompt: `Put ${n} Energy into your opponent's hand`, min: n, max: n, values: t.energy.slice() }, 'cards');
  for (const c of chosen) {
    removeFrom(t.energy, c);
    s.p[opp(f.player)].hand.push(c);
  }
  return 'next';
});

/**
 * Sylveon, Mystical Return: "Shuffle that Pokémon and all attached cards into their deck."
 * The Pokémon is the one chosen into variable `args.slot` (a Benched Pokémon of the opponent). Its whole stack,
 * Energy and Tools go into its owner's deck, which is then shuffled. A Pokémon protected from the effects of attacks
 * (Hide 'n' Sneak) stays where it is and nothing is shuffled.
 */
registerCustom('seed4.shuffleSlotIntoDeck', (env, s, f, args) => {
  const id = cardsOf(f.vars[String(args.slot ?? 't')])[0];
  const loc = id === undefined ? null : findSlot(s, id);
  if (!loc) return 'next';
  if (effectsPrevented(env, s, loc.slot, f.player, 'attack')) return 'next';
  const ps = s.p[loc.owner];
  if (ps.active === loc.slot) ps.active = null;
  else ps.bench = ps.bench.filter((b) => b !== loc.slot);
  s.effects = s.effects.filter((x) => x.slot !== loc.slot.id);
  ps.deck.push(...slotCards(loc.slot));
  shuffleDeck(env, s, loc.owner);
  return 'next';
});
