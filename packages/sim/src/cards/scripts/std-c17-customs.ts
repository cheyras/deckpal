/**
 * Bespoke effects for the "std-c17" batch (std-c17.ts). Names are prefixed `c17.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c17.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { countersFixed, countersPrevented, effectsPrevented, ownerOf, statics } from '../../query.js';
import { allSlots, emit, findSlot, opp, takeFromZones } from '../../state.js';
import type { Decision, GameState, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function idsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}

/**
 * Jynx, Inviting Kiss: "If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the
 * new Benched Pokémon."
 * args: { cards } -- the variable holding the card just put onto the Bench. One Energy card attached to this Pokémon
 * moves to the Benched Pokémon that card became (the controller picks which when the choices differ); nothing happens
 * when this Pokémon has no Energy or the card is no longer on the Bench.
 */
registerCustom('c17.moveEnergyToNewBenched', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const me = findSlot(s, f.slot)?.slot;
  const cardId = idsOf(f.vars[String(args.cards ?? 'put')])[0];
  const dst = cardId === undefined ? undefined : ps.bench.find((b) => b.cards.includes(cardId));
  if (!me || !dst || !me.energy.length) return 'next';
  let card: number | undefined;
  if (answer !== undefined) card = (answer as number[])[0];
  else if (new Set(me.energy.map((c) => def(env.ctx, c).idx)).size === 1) card = me.energy[0];
  else {
    return ask(s, { player: f.player, kind: 'cards', prompt: 'Move which Energy to the new Benched Pokémon?', min: 1, max: 1, values: me.energy.slice() }, 'cards');
  }
  if (card === undefined || !me.energy.includes(card)) return 'next';
  me.energy = me.energy.filter((c) => c !== card);
  dst.energy.push(card);
  emit(env, { type: 'attach', player: f.player, card, slot: dst.id });
  return 'next';
});

/**
 * Wellspring Mask Ogerpon ex, Torrential Pump: "You may shuffle 3 Energy attached to this Pokémon into your deck."
 * (the choice half). args: { n, as } -- the controller picks exactly n of the Energy cards attached to this Pokémon (all
 * of them when it has n or fewer, with no question) into variable `as`; an empty list when it has none. Nothing moves yet:
 * the Energy leaves with `c17.selfEnergyToDeck`, after the attack's damage.
 * Ruling (TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2031/): with fewer than 3 Energy attached "you
 * must shuffle in SOME energy in order to get the bonus".
 */
registerCustom('c17.pickSelfEnergy', (env, s, f, args, answer) => {
  const as = String(args.as ?? 'e');
  const me = findSlot(s, f.slot)?.slot;
  const pool = me ? me.energy.slice() : [];
  const n = Number(args.n ?? 3);
  if (answer !== undefined) {
    f.vars[as] = (answer as number[]).filter((c) => pool.includes(c));
    return 'next';
  }
  if (pool.length <= n) {
    f.vars[as] = pool;
    return 'next';
  }
  return ask(s, { player: f.player, kind: 'cards', prompt: `Shuffle ${n} Energy attached to this Pokémon into your deck`, min: n, max: n, values: pool }, 'cards');
});

/**
 * Wellspring Mask Ogerpon ex, Torrential Pump: the shuffle half. args: { cards } -- puts the Energy cards in that
 * variable, if still attached to this Pokémon, into their owner's deck (the program shuffles next).
 */
registerCustom('c17.selfEnergyToDeck', (env, s, f, args) => {
  const me = findSlot(s, f.slot)?.slot;
  if (!me) return 'next';
  for (const c of idsOf(f.vars[String(args.cards ?? 'e')])) {
    if (!me.energy.includes(c)) continue;
    me.energy = me.energy.filter((x) => x !== c);
    s.p[env.ctx.owner[c] as 0 | 1].deck.push(c);
  }
  return 'next';
});

/**
 * Alakazam, Strange Hacking: "You may move any number of damage counters from your opponent's Pokémon to their other
 * Pokémon in any way you like."
 * The controller repeatedly picks one of the opponent's damaged Pokémon (picking none ends it) and another of their
 * Pokémon to receive one damage counter from it. A Pokémon that gave a counter never receives one in the same use, and
 * one that received a counter never gives one (any final spread is still reachable, and it always ends). Nothing happens
 * under a Watchful Eye-style lock, and a Pokémon protected from the effects of attacks or from damage counters cannot
 * receive any.
 */
registerCustom('c17.moveOppCounters', (env, s, f, _args, answer) => {
  const o = opp(f.player);
  const ps = s.p[o];
  const V = f.vars as Record<string, Val>;
  const all = statics(env, s);
  const finish = (): 'next' => {
    delete V.__c17q;
    delete V.__c17from;
    delete V.__c17d;
    delete V.__c17t;
    return 'next';
  };
  if (countersFixed(env, s, o, all)) return finish();
  const slots = allSlots(ps);
  const donors = idsOf(V.__c17d);
  const takers = idsOf(V.__c17t);
  const canTake = (sl: (typeof slots)[number]): boolean =>
    !donors.includes(sl.id) && !effectsPrevented(env, s, sl, f.player, 'attack') && !countersPrevented(env, s, sl, f.player, 'attack');
  const move = (from: number, to: number): void => {
    const a = slots.find((x) => x.id === from);
    const b = slots.find((x) => x.id === to);
    if (!a || !b || a === b || a.damage < 10) return;
    a.damage -= 10;
    b.damage += 10;
    donors.push(a.id);
    takers.push(b.id);
    V.__c17d = donors;
    V.__c17t = takers;
    emit(env, { type: 'counters', player: ownerOf(s, b), slot: b.id, n: 1 });
  };
  const askSource = (): 'next' | 'wait' => {
    const cands = slots.filter((sl) => sl.damage >= 10 && !takers.includes(sl.id) && slots.some((t) => t !== sl && canTake(t)));
    if (!cands.length) return finish();
    V.__c17q = 1;
    return ask(
      s,
      { player: f.player, kind: 'slots', prompt: "Move a damage counter from which of your opponent's Pokémon? (choose none to stop)", min: 0, max: 1, values: cands.map((c) => c.id) },
      'slots',
    );
  };
  const askTarget = (from: number): 'next' | 'wait' => {
    const cands = slots.filter((t) => t.id !== from && canTake(t));
    if (!cands.length) return finish();
    if (cands.length === 1) {
      move(from, (cands[0] as (typeof slots)[number]).id);
      return askSource();
    }
    V.__c17q = 2;
    V.__c17from = from;
    return ask(s, { player: f.player, kind: 'slots', prompt: 'Move it to which of their other Pokémon?', min: 1, max: 1, values: cands.map((c) => c.id) }, 'slots');
  };
  const q = V.__c17q;
  if (answer !== undefined && q === 1) {
    delete V.__c17q;
    const pick = (answer as number[])[0];
    if (pick === undefined) return finish();
    return askTarget(pick);
  }
  if (answer !== undefined && q === 2) {
    const from = V.__c17from as number;
    delete V.__c17q;
    delete V.__c17from;
    const to = (answer as number[])[0];
    if (to !== undefined) move(from, to);
  }
  return askSource();
});

/**
 * Morpeko, Snack Seek: "Once during your turn, you may look at the top card of your deck. You may discard that card."
 * The controller sees the top card of their deck and may discard it; it stays on top otherwise. Nothing happens with
 * an empty deck.
 */
registerCustom('c17.lookTopMayDiscard', (env, s, f, _args, answer) => {
  const ps = s.p[f.player];
  const top = ps.deck[ps.deck.length - 1];
  if (top === undefined) return 'next';
  if (answer === undefined) {
    return ask(s, { player: f.player, kind: 'cards', prompt: 'Discard the top card of your deck?', min: 0, max: 1, values: [top] }, 'cards');
  }
  if ((answer as number[]).includes(top) && takeFromZones(ps, top)) {
    ps.discard.push(top);
    emit(env, { type: 'discard', player: f.player, cards: [top] });
  }
  return 'next';
});

