/**
 * Bespoke conditions for the "std-c14" batch (std-c14.ts). Names are prefixed `c14.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c14.test.ts.
 */
import { registerCustomCond } from '../../customs.js';
import { resolveSlot } from '../../eval.js';
import { hasNoAbilities } from '../../query.js';

/**
 * Walking Wake ex, Azure Seas: the Ability only does anything while it is on.
 * True when this Pokémon (the one whose attack this is) is in play and no effect has turned its Abilities off
 * (Flutter Mane's Midnight Fluttering, Team Rocket's Watchtower, ...).
 */
registerCustomCond('c14.abilitiesOn', (env, s, ec) => {
  const sl = resolveSlot(s, ec, 'self');
  return !!sl && !hasNoAbilities(env, s, sl);
});
