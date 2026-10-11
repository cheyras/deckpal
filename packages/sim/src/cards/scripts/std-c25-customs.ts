/**
 * Bespoke effects for the "std-c25" batch (std-c25.ts). Names are prefixed `c25.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c25.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { registerCustom, registerCustomCond } from '../../customs.js';
import { countersPrevented, effectsPrevented, maxHp, statics } from '../../query.js';
import { allSlots, emit, findSlot, opp, shuffleDeck, slotCards } from '../../state.js';
import type { Decision, GameState, Player, TimedEffect, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function cardsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}

/**
 * Espathra, Mystical Eyes: "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it
 * into your opponent's hand."
 * The attacker picks one of the opponent's Pokémon that has an Evolution card on it (no question with one). The top card of
 * its stack goes to its owner's hand, face up; the Pokémon recovers from all Special Conditions and loses the effects of
 * attacks on it, as when it evolves. A Pokémon protected from the effects of attacks (Hide 'n' Sneak) is left alone.
 */
registerCustom('c25.devolveOpp', (env, s, f, _args, answer) => {
  const owner = opp(f.player);
  const ps = s.p[owner];
  const cands = allSlots(ps).filter((sl) => sl.cards.length >= 2);
  if (!cands.length) return 'next';
  let id: number | undefined;
  if (answer !== undefined) id = (answer as number[])[0];
  else if (cands.length === 1) id = cands[0]!.id;
  else {
    return ask(
      s,
      { player: f.player, kind: 'slots', prompt: "Devolve which of your opponent's evolved Pokémon?", min: 1, max: 1, values: cands.map((x) => x.id) },
      'slots',
    );
  }
  const sl = cands.find((x) => x.id === id);
  if (!sl) return 'next';
  if (effectsPrevented(env, s, sl, f.player, 'attack')) return 'next';
  const top = sl.cards.pop() as number;
  ps.hand.push(top);
  ps.revealed.push(top);
  sl.cond = 0;
  s.effects = s.effects.filter((x) => !(x.slot === sl.id && x.fromAttack));
  return 'next';
});

/**
 * Palossand ex, Barite Jail: "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100."
 * args: { hp }. Each Benched Pokémon of the opponent with more than `hp` HP remaining (HP with any changes, minus damage)
 * gets enough damage counters to leave exactly that much (a Pokémon already at or below it gets none). Counters, not damage:
 * no Weakness, Resistance or modifiers. A Pokémon protected from the effects of attacks, or from damage counters, gets none.
 */
registerCustom('c25.benchCountersUntilHp', (env, s, f, args) => {
  const hp = Number(args.hp ?? 100);
  const all = statics(env, s);
  const owner = opp(f.player);
  for (const sl of s.p[owner].bench.slice()) {
    if (effectsPrevented(env, s, sl, f.player, 'attack', all)) continue;
    if (countersPrevented(env, s, sl, f.player, 'attack', all)) continue;
    const n = Math.floor((maxHp(env, s, sl, all) - sl.damage - hp) / 10);
    if (n <= 0) continue;
    sl.damage += n * 10;
    emit(env, { type: 'counters', player: owner, slot: sl.id, n });
  }
  return 'next';
});

/**
 * Sylveon ex, Angelite: "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your
 * opponent's deck."
 * Every Pokémon chosen into variable `args.slot` leaves play with all attached cards (Energy, Tools, previous Evolutions) for
 * its owner's deck, which is shuffled once afterwards. A Pokémon protected from the effects of attacks stays where it is.
 */
registerCustom('c25.shuffleSlotsIntoDeck', (env, s, f, args) => {
  const owners = new Set<Player>();
  for (const id of cardsOf(f.vars[String(args.slot ?? 't')])) {
    const loc = findSlot(s, id);
    if (!loc) continue;
    if (effectsPrevented(env, s, loc.slot, f.player, 'attack')) continue;
    const ps = s.p[loc.owner];
    if (ps.active === loc.slot) ps.active = null;
    else ps.bench = ps.bench.filter((b) => b !== loc.slot);
    s.effects = s.effects.filter((x) => x.slot !== loc.slot.id);
    ps.deck.push(...slotCards(loc.slot));
    owners.add(loc.owner);
  }
  for (const o of owners) shuffleDeck(env, s, o);
  return 'next';
});

/** The marker a player carries after one of their Pokémon used an attack: a timed effect that blocks no real attack. */
function usedMarker(attack: string): string {
  return `\u0000used25:${attack}`;
}

/**
 * Sylveon ex, Angelite: "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used." (the remembering half)
 * Records that the Pokémon using this attack used `args.attack`: a marker effect on it that lasts through the end of its
 * controller's NEXT turn. A copy of the attack (Mew ex, Genome Hacking) is not a use of it: TPCi Rules Team 2025-01-09,
 * https://compendium.pokegym.net/ruling/2094/ ("the 'attack' it did was Genome Hacking"), so no marker is left.
 */
registerCustom('c25.rememberUsed', (_env, s, f, args) => {
  if (f.code.endsWith(':copy')) return 'next';
  const e: TimedEffect = {
    static: { k: 'cantUseAttack', attack: usedMarker(String(args.attack)) },
    slot: f.slot,
    player: f.player,
    until: s.turn + 2,
    fromAttack: false,
    src: f.src,
  };
  s.effects = [...s.effects, e];
  return 'next';
});

/**
 * Sylveon ex, Angelite: "If 1 of your Pokémon used Angelite during your last turn, ..." (the asking half)
 * True when any Pokémon of the controller carries the marker `c25.rememberUsed` left for `args.attack` during their previous turn.
 */
registerCustomCond('c25.usedLastTurn', (_env, s, ec, args) => {
  const mark = usedMarker(String(args.attack));
  return s.effects.some((e) => e.player === ec.player && e.static.k === 'cantUseAttack' && e.static.attack === mark);
});
