/**
 * Bespoke effects for the "std-c37" batch (std-c37.ts). Names are prefixed `c37.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c37.test.ts.
 */
import { def, type Env } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import type { PType } from '../../dsl.js';
import { countersFixed, countersPrevented, effectsPrevented, ownerOf, statics } from '../../query.js';
import { emit, findSlot, opp, topCard } from '../../state.js';
import type { Slot, Val } from '../../types.js';

function slotIdOf(v: Val | undefined): number | undefined {
  return Array.isArray(v) ? (v[0] as number | undefined) : typeof v === 'number' ? v : undefined;
}

/**
 * Cofagrigus, Extended Damagriiigus: "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon."
 * args: { from, to } -- the variables holding the two chosen Pokémon. Nothing moves under a Watchful Eye-style lock. Otherwise
 * every damage counter leaves the first Pokémon; they land on the second unless it is protected from the effects of attacks or
 * from damage counters, in which case they just disappear (Compendium #2192: counters aimed at a Pokémon that blocks effects are lost).
 */
registerCustom('c37.moveAllCounters', (env, s, f, args) => {
  const fromId = slotIdOf(f.vars[String(args.from ?? 'from')]);
  const toId = slotIdOf(f.vars[String(args.to ?? 'to')]);
  const from = fromId === undefined ? undefined : findSlot(s, fromId);
  const to = toId === undefined ? undefined : findSlot(s, toId);
  if (!from || !to || from.slot === to.slot) return 'next';
  const all = statics(env, s);
  if (countersFixed(env, s, from.owner, all) || countersFixed(env, s, to.owner, all)) return 'next';
  const n = Math.floor(from.slot.damage / 10);
  if (n <= 0) return 'next';
  from.slot.damage -= n * 10;
  if (effectsPrevented(env, s, to.slot, f.player, 'attack', all) || countersPrevented(env, s, to.slot, f.player, 'attack', all)) return 'next';
  to.slot.damage += n * 10;
  emit(env, { type: 'counters', player: ownerOf(s, to.slot), slot: to.slot.id, n });
  return 'next';
});

/** The type of the Resistance printed on the Pokémon in this Slot (undefined for none). */
function resistanceOf(env: Env, slot: Slot): PType | undefined {
  return def(env.ctx, topCard(slot)).resistance?.type;
}

/**
 * Boldore, Smack Down: "If your opponent's Active Pokémon has {F} Resistance, ..."
 * args: { type }. The opponent's Active Pokémon has a Resistance of that type printed on it.
 */
registerCustomCond('c37.defenderResists', (env, s, ec, args) => {
  const t = s.p[opp(ec.player)].active;
  return !!t && resistanceOf(env, t) === (args.type as PType);
});
