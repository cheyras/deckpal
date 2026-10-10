/**
 * Bespoke effects for lane "misc" cards (see misc.ts). Each is registered by
 * name and called from a script as `{ op: 'custom', fn: '<name>', args }`.
 * Tested through the cards that use them (src/__tests__/cards-misc.test.ts).
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { abilityLost, effectsPrevented, hasNoAbilities, maxHp, statics } from '../../query.js';
import { allSlots, emit, opp, removeFrom, topCard } from '../../state.js';
import type { Player } from '../../types.js';

/**
 * Froslass, Freezing Shroud: "During Pokémon Checkup, put 1 damage counter on each Pokémon that has an
 * Ability (both yours and your opponent's), except any Froslass."
 * A Pokémon whose Abilities are switched off (Team Rocket's Watchtower, Damp on a self-KO-only Pokémon)
 * has no Ability and is skipped; effects of Abilities can be prevented (Hide 'n' Sneak).
 */
registerCustom('freezingShroud', (env, s, f) => {
  const all = statics(env, s);
  for (const p of [0, 1] as Player[]) {
    for (const sl of allSlots(s.p[p])) {
      const d = def(env.ctx, topCard(sl));
      if (d.name === 'Froslass') continue;
      if (hasNoAbilities(env, s, sl, all)) continue;
      if (!d.abilities.some((ab) => !abilityLost(env, s, sl, ab, all))) continue;
      if (effectsPrevented(env, s, sl, f.player, 'ability', all)) continue;
      sl.damage += 10;
      emit(env, { type: 'counters', player: p, slot: sl.id, n: 1 });
    }
  }
  return 'next';
});

/**
 * Hisuian Zoroark, Swirling Resentment: "Place damage counters on your opponent's Active Pokémon until its
 * remaining HP is 50." Sets `args.as` (default `n`) to the counter count; a `counters` step places them.
 */
registerCustom('countersUntilHp', (env, s, f, args) => {
  const t = s.p[opp(f.player)].active;
  const hp = Number(args.hp ?? 50);
  f.vars[String(args.as ?? 'n')] = t ? Math.max(0, Math.floor((maxHp(env, s, t) - t.damage - hp) / 10)) : 0;
  return 'next';
});

/** Ignition Energy: "discard it at the end of your turn" — the source card (Energy or Tool) leaves its Pokémon for the discard pile. */
registerCustom('discardThisCard', (env, s, f) => {
  const owner = env.ctx.owner[f.src] as Player;
  for (const sl of allSlots(s.p[owner])) {
    if (removeFrom(sl.energy, f.src) || removeFrom(sl.tools, f.src)) {
      s.p[owner].discard.push(f.src);
      emit(env, { type: 'discard', player: owner, cards: [f.src] });
      break;
    }
  }
  return 'next';
});
