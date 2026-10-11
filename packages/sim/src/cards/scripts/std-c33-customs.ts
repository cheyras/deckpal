/**
 * Bespoke effects for the "std-c33" batch (std-c33.ts). Names are prefixed `c33.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c33.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def, type Env } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { countersFixed, ownerOf, statics } from '../../query.js';
import { allSlots, emit, findSlot, opp, removeFrom, topCard } from '../../state.js';
import type { Decision, GameState, Player, Slot, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots' | 'order'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function idsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}

/**
 * Team Rocket's Dottler, Disruptive Radar: "Look at the top 5 cards of your opponent's deck and put them back in any order."
 * args: { n } (default 5). The controller is shown the top n cards of the opponent's deck (fewer if the deck is short) and
 * orders them; they go back on top in that order (first = top). With 0 or 1 cards nothing is asked. The opponent does not
 * know the new order, so the cards they had marked as known on top are no longer known.
 */
registerCustom('c33.reorderOppTop', (_env, s, f, args, answer) => {
  const o = opp(f.player);
  const ps = s.p[o];
  const n = Math.min(Number(args.n ?? 5), ps.deck.length);
  if (n <= 1) return 'next';
  const top = ps.deck.slice(ps.deck.length - n).reverse(); // top first
  if (answer === undefined) {
    return ask(
      s,
      { player: f.player, kind: 'order', prompt: `Put the top ${n} cards of your opponent's deck back in any order (first = top)`, min: n, max: n, values: top },
      'order',
    );
  }
  const order = (answer as number[]).map((i) => top[i] as number);
  ps.deck.splice(ps.deck.length - n, n, ...order.slice().reverse());
  ps.knownTop = 0;
  return 'next';
});

/**
 * Team Rocket's Orbeetle, Rocket Brain: "... move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your
 * Pokémon." The donor is in var `args.from`; this asks which OTHER Pokémon of the controller's gets the counter (no question
 * when only one qualifies) and moves one counter. Nothing happens under a Watchful Eye-style lock. The receiver may be left
 * with more damage than its HP (it is Knocked Out when Knock Outs are next checked; TPCi ruling 2152).
 */
registerCustom('c33.moveOneCounter', (env, s, f, args, answer) => {
  const fromId = idsOf(f.vars[String(args.from ?? 'from')])[0];
  const fromLoc = fromId === undefined ? null : findSlot(s, fromId);
  if (!fromLoc || fromLoc.slot.damage < 10) return 'next';
  const all = statics(env, s);
  if (countersFixed(env, s, fromLoc.owner, all)) return 'next';
  const cands = allSlots(s.p[f.player]).filter((x) => x !== fromLoc.slot);
  if (!cands.length) return 'next';
  let to: Slot | undefined;
  if (answer !== undefined) to = cands.find((x) => x.id === (answer as number[])[0]);
  else if (cands.length === 1) to = cands[0];
  else {
    return ask(
      s,
      { player: f.player, kind: 'slots', prompt: 'Move the damage counter to which of your other Pokémon?', min: 1, max: 1, values: cands.map((x) => x.id) },
      'slots',
    );
  }
  if (!to) return 'next';
  fromLoc.slot.damage -= 10;
  to.damage += 10;
  emit(env, { type: 'counters', player: ownerOf(s, to), slot: to.id, n: 1 });
  return 'next';
});

/**
 * Team Rocket's Crobat ex, Assassin's Return: "Put this Pokémon into your hand. (Discard all cards attached to this
 * Pokémon.)" This Pokémon leaves play: every Pokémon card of its evolution stack goes to its owner's hand, and its Energy
 * and Tool cards are discarded. Timed effects on it end. If it was the Active Pokémon, its owner promotes a new one when
 * Knock Outs are next checked.
 */
registerCustom('c33.selfToHandDiscardAttached', (env, s, f) => {
  const loc = findSlot(s, f.slot);
  if (!loc) return 'next';
  const ps = s.p[loc.owner];
  const sl = loc.slot;
  if (ps.active === sl) ps.active = null;
  else ps.bench = ps.bench.filter((b) => b !== sl);
  s.effects = s.effects.filter((x) => x.slot !== sl.id);
  if (s.delayed?.length) s.delayed = s.delayed.filter((d) => d.slot !== sl.id);
  ps.hand.push(...sl.cards);
  const attached = [...sl.energy, ...sl.tools];
  ps.discard.push(...attached);
  if (attached.length) emit(env, { type: 'discard', player: loc.owner, cards: attached });
  return 'next';
});

/** Cards in the player's deck that evolve from the Pokémon in this slot (by name). */
function evolutionsInDeck(env: Env, s: GameState, p: Player, sl: Slot): number[] {
  const name = def(env.ctx, topCard(sl)).name;
  return s.p[p].deck.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'pokemon' && d.stage >= 1 && d.evolvesFrom === name;
  });
}

/**
 * Team Rocket's Nidorina, Dark Awakening: "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck
 * for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck." (the program
 * shuffles next). The chosen Pokémon are in var `args.slots`. For each, in turn, the controller may pick one matching card from
 * the deck (none is allowed: a search can come up empty). The card goes on top of the Pokémon's stack, clearing its Special
 * Conditions and the effects of attacks on it, exactly as evolving from hand does -- but it is not played from the hand, so no
 * "when you play this Pokémon from your hand to evolve" trigger runs. Rules kept: no evolving on a player's own first turn,
 * and not a Pokémon that already evolved this turn. A Pokémon put into play this turn CAN be evolved this way (the same
 * reading as Compendium #2054 for the other search-and-evolve effects).
 */
registerCustom('c33.evolveChosen', (env, s, f, args, answer) => {
  const p = f.player;
  const ps = s.p[p];
  let ids = f.vars.__c33T as number[] | undefined;
  if (!ids) {
    ids = idsOf(f.vars[String(args.slots ?? 't')]);
    f.vars.__c33T = ids;
    f.vars.__c33I = 0;
  }
  const done = (): 'next' => {
    delete f.vars.__c33T;
    delete f.vars.__c33I;
    return 'next';
  };
  if (s.turn === (p === s.first ? 1 : 2)) return done(); // a player's own first turn
  for (;;) {
    const i = f.vars.__c33I as number;
    if (i >= ids.length) return done();
    const sl = findSlot(s, ids[i] as number)?.slot;
    if (answer !== undefined) {
      const pick = (answer as number[])[0];
      answer = undefined;
      f.vars.__c33I = i + 1;
      if (pick === undefined || !sl || !removeFrom(ps.deck, pick)) continue;
      ps.prizesKnown = true;
      emit(env, { type: 'search', player: p, found: [pick] });
      sl.cards.push(pick);
      sl.evolvedTurn = s.turn;
      sl.cond = 0;
      s.effects = s.effects.filter((x) => !(x.slot === sl.id && x.fromAttack));
      emit(env, { type: 'evolve', player: p, card: pick, slot: sl.id });
      continue;
    }
    const opts = sl && sl.evolvedTurn < s.turn ? evolutionsInDeck(env, s, p, sl) : [];
    if (!opts.length) {
      f.vars.__c33I = i + 1;
      continue;
    }
    return ask(
      s,
      { player: p, kind: 'cards', prompt: `Evolve ${def(env.ctx, topCard(sl as Slot)).name} with a card from your deck (or none)`, min: 0, max: 1, values: opts },
      'cards',
    );
  }
});
