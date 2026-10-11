/**
 * Bespoke effects for the "std-seed3" batch (std-seed3.ts). Names are prefixed `seed3.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-seed3.test.ts.
 *
 * Three of these are really small missing clauses (a count of Pokémon by attack name, "each of" for healing, a
 * per-Pokémon doubling of damage counters); they are written as small generic functions so they can be promoted
 * to clauses later.
 */
import { registerCustom, registerCustomCond } from '../../customs.js';
import { resolveSlot, slotsIn } from '../../eval.js';
import { countersPrevented, effectsPrevented, maxHp, ownerOf, statics } from '../../query.js';
import { emit, healSlot } from '../../state.js';
import type { SlotZone } from '../../dsl.js';

/**
 * Mega Floette ex, Gentle Light: "Heal 30 damage from each Pokémon (both yours and your opponent's)."
 * args: { amount, zone } -- every Pokémon in the controller-relative zone loses that much damage (to a floor of 0),
 * except an opponent's Pokémon that is protected from the effects of attacks (healing it is an effect of the attack).
 */
registerCustom('seed3.healEach', (env, s, f, args) => {
  const all = statics(env, s);
  for (const sl of slotsIn(s, f.player, String(args.zone ?? 'allPokemon') as SlotZone)) {
    if (f.kind === 'attack' && ownerOf(s, sl) !== f.player && effectsPrevented(env, s, sl, f.player, 'attack', all)) continue;
    healSlot(s, sl, Number(args.amount), env);
  }
  return 'next';
});

/**
 * N's Vanilluxe, Snow Coating: "Double the number of damage counters on each of your opponent's Pokémon."
 * Each Pokémon in `zone` that has damage counters gets that many MORE counters (Compendium #2293: 2 counters become 4,
 * not 6). Placing them is an effect, so a Pokémon protected from the effects of attacks (Hide 'n' Sneak) or from
 * having damage counters placed on it (Battle Cage, on the Bench) is left as it is (Compendium #2294).
 * args: { zone }.
 */
registerCustom('seed3.doubleCounters', (env, s, f, args) => {
  const kind = f.kind === 'ability' ? 'ability' : 'attack';
  const all = statics(env, s);
  for (const sl of slotsIn(s, f.player, String(args.zone ?? 'oppPokemon') as SlotZone)) {
    const n = sl.damage / 10;
    if (n <= 0) continue;
    if (effectsPrevented(env, s, sl, f.player, kind, all)) continue;
    if (countersPrevented(env, s, sl, f.player, kind, all)) continue;
    sl.damage += n * 10;
    emit(env, { type: 'counters', player: ownerOf(s, sl), slot: sl.id, n });
  }
  return 'next';
});

/**
 * Marshadow, Shadowy Side Kick: "If your opponent's Pokémon is Knocked Out by damage from this attack, ..."
 * True when the Defending Pokémon was damaged by this attack and now has damage at or above its HP (the Knock Out itself
 * is processed once the attack finishes, so a `post` program sees the Pokémon still in play).
 */
registerCustomCond('seed3.defenderKnockedOutByThisAttack', (env, s, ec) => {
  const sl = resolveSlot(s, ec, 'defender');
  return !!sl && (s.attackHits ?? []).includes(sl.id) && sl.damage >= maxHp(env, s, sl);
});
