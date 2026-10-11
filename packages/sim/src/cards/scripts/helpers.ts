/** Clause shorthands shared by card scripts. Each is plain data — see dsl.ts. */
import type { AbilityScript, Expr, Filter, Program, Step } from '../../dsl.js';

export const NO_RULE_BOX: Filter = { cat: 'pokemon', ruleBox: false };

/** "Search your deck for <filter> (up to n), reveal it, and put it into your hand. Then, shuffle your deck." */
export function searchToHand(filter: Filter, n: Expr = 1, o: { reveal?: boolean; min?: Expr } = {}): Program {
  return [
    { op: 'chooseCards', from: 'deck', filter, min: o.min ?? 0, max: n, as: 'found', reveal: o.reveal ?? true },
    { op: 'move', cards: 'found', to: 'hand' },
    { op: 'shuffle' },
  ];
}

/** Free Bench space for the controller. */
export const BENCH_SPACE: Expr = { sub: [5, { pokemon: { zone: 'myBench' } }] };

/** "Search your deck for up to n <filter> and put them onto your Bench. Then, shuffle your deck." */
export function searchToBench(filter: Filter, n: number): Program {
  return [
    { op: 'chooseCards', from: 'deck', filter: { ...filter, stage: 'basic' }, min: 0, max: { min: [n, BENCH_SPACE] }, as: 'found' },
    { op: 'move', cards: 'found', to: 'bench' },
    { op: 'shuffle' },
  ];
}

/** "You can use this card only if you discard n other cards from your hand." — the cost step. */
export function discardOthers(n: number): Step[] {
  return [
    { op: 'chooseCards', from: 'hand', min: n, max: n, as: 'cost', others: true, prompt: `Discard ${n} other cards` },
    { op: 'move', cards: 'cost', to: 'discard' },
  ];
}

/** Hide 'n' Sneak: "Prevent all effects of your opponent's Pokémon's attacks and Abilities done to this Pokémon. (Damage is not an effect.)" */
export const HIDE_N_SNEAK: AbilityScript = {
  name: "Hide 'n' Sneak",
  statics: [{ effect: { k: 'preventEffects', from: ['attack', 'ability'] }, scope: 'self' }],
};

/** Count of a filter in the controller's discard pile. */
export function inDiscard(filter: Filter): Expr {
  return { count: { zone: 'discard', filter } };
}

/** Choose 1 of the opponent's Pokémon (zone) and do attack damage to it. */
export function damageOneOf(zone: 'oppPokemon' | 'oppBench', amount: Expr, filter?: Filter): Program {
  return [
    { op: 'chooseSlots', from: zone, filter, min: 1, max: 1, as: 't', prompt: 'Choose a Pokémon to damage' },
    { op: 'damage', amount, to: { v: 't' } },
  ];
}
