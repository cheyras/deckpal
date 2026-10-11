/**
 * Bespoke effects for the "std-seed2" batch (std-seed2.ts). Names are prefixed `seed2.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-seed2.test.ts.
 *
 * Several of these are really missing DSL clauses (evolve from the deck, "each of your Pokémon" for heal, a sum
 * over several Pokémon, a random card from a hand); they are written as small generic functions so they can be
 * promoted to clauses later. A custom that asks a decision sets `s.pending` (the answer comes back as `answer`)
 * and returns 'wait'.
 */
import { evolveOnto } from '../../evolve.js';
import { def, type Env } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { slotsIn } from '../../eval.js';
import { effectsPrevented, energyUnits } from '../../query.js';
import { emit, findSlot, healSlot, opp, rand, removeFrom, topCard } from '../../state.js';
import type { Decision, GameState, Player, Slot } from '../../types.js';
import type { SlotZone } from '../../dsl.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots' | 'index'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/** The player's own first turn (the second player's first turn is turn 2): no Pokémon can evolve then. */
function ownFirstTurn(s: GameState, p: Player): boolean {
  return s.turn === (p === s.first ? 1 : 2);
}

/** Cards in the controller's deck that evolve from the Pokémon in this slot (by name). */
function evolutionsInDeck(env: Env, s: GameState, p: Player, sl: Slot): number[] {
  const name = def(env.ctx, topCard(sl)).name;
  return s.p[p].deck.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'pokemon' && d.stage >= 1 && d.evolvesFrom === name;
  });
}

/**
 * Misdreavus, Ascension / Vivillon, Evo-Powder: "Search your deck for a card that evolves from <that Pokémon> and put it
 * onto <that Pokémon> to evolve it." (the program shuffles next).
 * args: { zone: 'self' | 'bench' } -- this Pokémon, or each of the controller's Benched Pokémon in turn.
 *
 * For each target the controller may pick one matching card from the deck (none is allowed: a search can come up
 * empty). The card goes on top of the Pokémon's stack, which clears its Special Conditions and the effects of
 * attacks on it, exactly as evolving from hand does -- but it is not played from the hand, so no "when you play this
 * Pokémon from your hand to evolve" trigger runs. Rules kept: no evolving on a player's own first turn, and not a
 * Pokémon that already evolved this turn. A Pokémon put into play this turn CAN be evolved this way (Compendium #2054).
 */
registerCustom('seed2.evolveFromDeck', (env, s, f, args, answer) => {
  const p = f.player;
  const ps = s.p[p];
  let ids = f.vars.__evT as number[] | undefined;
  if (!ids) {
    ids = args.zone === 'bench' ? ps.bench.map((b) => b.id) : [f.slot];
    f.vars.__evT = ids;
    f.vars.__evI = 0;
  }
  const done = (): 'next' => {
    delete f.vars.__evT;
    delete f.vars.__evI;
    return 'next';
  };
  if (ownFirstTurn(s, p)) return done();
  for (;;) {
    const i = f.vars.__evI as number;
    if (i >= ids.length) return done();
    const sl = findSlot(s, ids[i] as number)?.slot;
    if (answer !== undefined) {
      const pick = (answer as number[])[0];
      answer = undefined;
      f.vars.__evI = i + 1;
      if (pick === undefined || !sl || !removeFrom(ps.deck, pick)) continue;
      ps.prizesKnown = true;
      emit(env, { type: 'search', player: p, found: [pick] });
      evolveOnto(env, s, sl, pick);
      emit(env, { type: 'evolve', player: p, card: pick, slot: sl.id });
      continue;
    }
    const opts = sl && sl.evolvedTurn < s.turn ? evolutionsInDeck(env, s, p, sl) : [];
    if (!opts.length) {
      f.vars.__evI = i + 1;
      continue;
    }
    return ask(
      s,
      { player: p, kind: 'cards', prompt: `Evolve ${def(env.ctx, topCard(sl as Slot)).name} with a card from your deck (or none)`, min: 0, max: 1, values: opts },
      'cards',
    );
  }
});

/**
 * Delcatty, Energy Crush / Wash Rotom, Gadget Show: "<n> damage for each Energy attached to all of your opponent's Pokémon"
 * / "for each Pokémon Tool attached to all of your Pokémon". Sets variable `as` (default `n`) to the total over every
 * Pokémon in `zone` (controller-relative): Energy counted in units provided, as an "each Energy" count is; or Tools.
 * args: { kind: 'energy' | 'tool', zone, as }.
 */
registerCustom('seed2.sumAttached', (env, s, f, args) => {
  const zone = String(args.zone) as SlotZone;
  let n = 0;
  for (const sl of slotsIn(s, f.player, zone)) n += args.kind === 'tool' ? sl.tools.length : energyUnits(env, sl).length;
  f.vars[String(args.as ?? 'n')] = n;
  return 'next';
});

/**
 * Wash Rotom, Manual Wash: "Heal 10 damage from each of your Pokémon."
 * args: { amount, zone } -- every Pokémon in the controller-relative zone loses that much damage (to a floor of 0).
 */
registerCustom('seed2.healEach', (_env, s, f, args) => {
  for (const sl of slotsIn(s, f.player, String(args.zone ?? 'myPokemon') as SlotZone)) {
    healSlot(s, sl, Number(args.amount));
  }
  return 'next';
});

/**
 * Team Rocket's Meowth, Paw-cket Pilfer / Tyranitar ex, Tyrannical Crush: "Choose a random card from your opponent's hand."
 * Puts one uniformly random card of the opponent's hand in variable `as` (default `x`), or an empty list for an empty
 * hand. The program then moves it (revealed: shuffled into their deck; or discarded).
 */
registerCustom('seed2.randomOppHandCard', (_env, s, f, args) => {
  const o = opp(f.player);
  const hand = s.p[o].hand;
  f.vars[String(args.as ?? 'x')] = hand.length ? [hand[Math.min(hand.length - 1, Math.floor(rand(s, o) * hand.length))] as number] : [];
  return 'next';
});

/**
 * Team Rocket's Murkrow, Torment: "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next
 * turn, that Pokémon can't use that attack."
 * The controller picks among the attack names printed on the Defending Pokémon (skipped when it has none; no question
 * when it has just one) and the Pokémon can't use that attack through the end of the opponent's next turn. Like other
 * attack effects it ends if that Pokémon leaves the Active Spot, and a Pokémon that is protected from the effects of
 * this attack is not affected.
 */
registerCustom('seed2.tormentDefender', (env, s, f, _args, answer) => {
  const t = s.p[opp(f.player)].active;
  if (!t) return 'next';
  const names = def(env.ctx, topCard(t)).attacks.map((a) => a.name);
  if (!names.length) return 'next';
  let pick: number;
  if (answer !== undefined) pick = (answer as number[])[0] ?? 0;
  else if (names.length === 1) pick = 0;
  else return ask(s, { player: f.player, kind: 'option', prompt: "Choose 1 of your opponent's Active Pokémon's attacks", min: 1, max: 1, labels: names }, 'index');
  if (effectsPrevented(env, s, t, f.player, 'attack')) return 'next';
  s.effects.push({
    static: { k: 'cantUseAttack', attack: names[pick] as string },
    slot: t.id,
    player: opp(f.player),
    until: s.turn + 1,
    fromAttack: true,
    src: f.src,
  });
  return 'next';
});

/**
 * Landorus, Screw Knuckle: "Put an Energy attached to this Pokémon into your hand."
 * The controller picks which Energy card (no question when the choices are identical); it goes to their hand
 * and is not discarded.
 */
registerCustom('seed2.energyToHand', (env, s, f, _args, answer) => {
  const loc = findSlot(s, f.slot);
  if (!loc || !loc.slot.energy.length) return 'next';
  const pool = loc.slot.energy.slice();
  let card: number;
  if (answer !== undefined) card = (answer as number[])[0] as number;
  else if (new Set(pool.map((c) => def(env.ctx, c).idx)).size === 1) card = pool[0] as number;
  else return ask(s, { player: f.player, kind: 'cards', prompt: 'Put which Energy into your hand?', min: 1, max: 1, values: pool }, 'cards');
  if (!removeFrom(loc.slot.energy, card)) return 'next';
  s.p[loc.owner].hand.push(card);
  return 'next';
});
