/**
 * Bespoke effects for the "std-30d" batch (std-30d.ts). Names are prefixed `n30d.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-30d.test.ts.
 */
import { registerCustom } from '../../customs.js';
import type { PType } from '../../dsl.js';
import { cardMatches, slotsIn } from '../../eval.js';
import { maxHp } from '../../query.js';

const BASIC_TYPES: PType[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];

/**
 * Sylveon ex, Colorful Harmony: "This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon."
 * Sets variable `as` (default `n`) to the number of different Basic Energy types among the Basic Energy cards attached to
 * the controller's Pokémon, Active and Benched. Special Energy cards don't count, however many types they provide.
 */
registerCustom('n30d.basicEnergyTypes', (env, s, f, args) => {
  let n = 0;
  const mine = slotsIn(s, f.player, 'myPokemon');
  for (const t of BASIC_TYPES) {
    if (mine.some((sl) => sl.energy.some((c) => cardMatches(env, c, { basicEnergy: true, energyType: t })))) n++;
  }
  f.vars[String(args.as ?? 'n')] = n;
  return 'next';
});

/**
 * Igglybuff, Bouncy Circle: "... for each of your Benched Pokémon that has a maximum HP of 30."
 * Sets variable `as` (default `n`) to the number of the controller's Benched Pokémon whose maximum HP right now (printed HP and
 * every effect that changes it) is exactly `hp`. args: { hp, as }.
 */
registerCustom('n30d.benchWithMaxHp', (env, s, f, args) => {
  const hp = Number(args.hp);
  const n = slotsIn(s, f.player, 'myBench').filter((sl) => maxHp(env, s, sl) === hp).length;
  f.vars[String(args.as ?? 'n')] = n;
  return 'next';
});
