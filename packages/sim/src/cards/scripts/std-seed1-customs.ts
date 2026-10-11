/**
 * Bespoke effects for the "std-seed1" batch, registered into customs.ts. Each is
 * documented with the printed sentence it implements and tested in
 * src/__tests__/cards-std-seed1.test.ts.
 */
import { registerCustom, registerCustomCond } from '../../customs.js';
import type { PType } from '../../dsl.js';
import { pushUnits, slotsIn, type EnergyUnit } from '../../eval.js';
import { effectsPrevented } from '../../query.js';
import { emit, leaveHand, opp, rand } from '../../state.js';
import type { Player } from '../../types.js';

/**
 * Scraggy, Knock Off: "Discard a random card from your opponent's hand."
 * args: { who } ('opp' by default). The card is picked by the RNG, not by either player. No card in hand: nothing happens.
 */
registerCustom('std.discardRandomFromHand', (env, s, f, args) => {
  const who: Player = args.who === 'self' ? f.player : opp(f.player);
  const ps = s.p[who];
  if (!ps.hand.length) return 'next';
  const card = ps.hand[Math.floor(rand(s, who) * ps.hand.length)] as number;
  leaveHand(ps, card);
  ps.discard.push(card);
  emit(env, { type: 'discard', player: who, cards: [card] });
  return 'next';
});

/**
 * Hoothoot, Silent Wing: "Your opponent reveals their hand."
 * args: { who }. Every card in that hand becomes known to the other player until it leaves the hand.
 */
registerCustom('std.revealHand', (_env, s, f, args) => {
  const who: Player = args.who === 'self' ? f.player : opp(f.player);
  const ps = s.p[who];
  ps.revealed = ps.hand.slice();
  return 'next';
});

/**
 * Mow Rotom, Trimming Mower: "Discard a Stadium in play."
 * The Stadium goes to its owner's discard pile. No Stadium in play: nothing happens.
 */
registerCustom('std.discardStadium', (env, s) => {
  const st = s.stadium;
  if (!st) return 'next';
  s.stadium = null;
  s.p[st.owner].discard.push(st.card);
  emit(env, { type: 'discard', player: st.owner, cards: [st.card] });
  return 'next';
});

/**
 * Raikou, Electro Fall: "If you have at least 4 {L} Energy in play, ..."
 * Counts the Energy provided, as units of `type`, by Energy attached to all of the controller's Pokémon (Active and
 * Benched), into variable `as`. A card providing every type counts once for `type`.
 * args: { type, as }.
 */
registerCustom('std.energyInPlay', (env, s, f, args) => {
  const type = String(args.type) as PType;
  let n = 0;
  const units: EnergyUnit[] = [];
  for (const sl of slotsIn(s, f.player, 'myPokemon')) {
    for (const c of sl.energy) {
      units.length = 0;
      pushUnits(env, sl, c, units);
      n += units.filter((u) => u === type || u === 'Any').length;
    }
  }
  f.vars[String(args.as ?? 'n')] = n;
  return 'next';
});

/**
 * Krookodile, Vengeful Fang: "If any of your Pokémon were Knocked Out by damage from an attack during your
 * opponent's last turn, ..." True when the engine recorded such a Knock Out (a Pokémon damaged by the opponent's
 * attack, checked after that attack) in the turn before this one. A Checkup Knock Out does not count, and a
 * Prize card being withheld does not matter (Ruling #2245).
 */
registerCustomCond('std.attackKoLastTurn', (_env, s, ec) => s.p[ec.player].attackKoTurn === s.turn - 1);

/**
 * Spearow, Pluck: "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."
 * Each Tool goes to its owner's discard pile. An effect-prevention on the Defending Pokémon (Hide 'n' Sneak) stops it.
 */
registerCustom('std.discardOppActiveTools', (env, s, f) => {
  const target = s.p[opp(f.player)].active;
  if (!target || !target.tools.length) return 'next';
  if (effectsPrevented(env, s, target, f.player, 'attack')) return 'next';
  const tools = target.tools.splice(0);
  for (const c of tools) {
    const owner = env.ctx.owner[c] as Player;
    s.p[owner].discard.push(c);
    emit(env, { type: 'discard', player: owner, cards: [c] });
  }
  return 'next';
});
