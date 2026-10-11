/**
 * Bespoke effects for the "std-c22" batch (std-c22.ts). Names are prefixed `c22.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c22.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter, PType, SlotZone } from '../../dsl.js';
import { cardMatches, slotMatches, slotsIn } from '../../eval.js';
import { emit, findSlot, healSlot } from '../../state.js';
import type { Decision, GameState, Slot } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/**
 * Alcremie, Colorful Confection: "Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached
 * to this Pokémon, reveal them, and put them into your hand." (the search half; the program moves and shuffles)
 * The types are those the Basic Energy CARDS attached to this Pokémon provide (a Special Energy, even one providing every
 * type, adds none: TPCi Rules Team 2024-09-12, ruling 2020). The controller picks 0 to 5 Pokémon from their deck whose type is
 * any of those; several may share a type (ruling 2019). The picks land in variable `args.as` (default `found`) and are
 * revealed to the opponent; nothing leaves the deck yet.
 */
registerCustom('c22.searchAttachedTypes', (env, s, f, args, answer) => {
  const as = String(args.as ?? 'found');
  const ps = s.p[f.player];
  ps.prizesKnown = true; // the player looked through their deck
  if (answer !== undefined) {
    const picked = answer as number[];
    f.vars[as] = picked;
    f.vars.__revealed = [...((f.vars.__revealed as number[] | undefined) ?? []), ...picked];
    emit(env, { type: 'search', player: f.player, found: picked.slice() });
    return 'next';
  }
  const loc = findSlot(s, f.slot);
  const types = new Set<PType>();
  if (loc) {
    for (const c of loc.slot.energy) {
      const d = def(env.ctx, c);
      if (d.kind === 'energy' && d.basicEnergy) for (const t of d.provides) types.add(t);
    }
  }
  const filter: Filter = { cat: 'pokemon', type: [...types] };
  const opts = types.size ? ps.deck.filter((c) => cardMatches(env, c, filter)) : [];
  if (!opts.length) {
    f.vars[as] = [];
    emit(env, { type: 'search', player: f.player, found: [] });
    return 'next';
  }
  const max = Math.min(Number(args.max ?? 5), opts.length);
  return ask(s, { player: f.player, kind: 'cards', prompt: 'Search for Pokémon of the same type as a Basic Energy attached', min: 0, max, values: opts }, 'cards');
});

/**
 * Dachsbun ex, Time to Chow Down: "... you may heal all damage from each of your Evolution Pokémon. If you healed any
 * damage in this way, discard all Energy from those Pokémon."
 * Every one of the controller's Evolution Pokémon (Stage 1 or Stage 2, the Pokémon that just evolved included: TPCi
 * Rules Team 2024-09-12, ruling 2016) that has damage on it loses all of it, and then those Pokémon, and only those,
 * discard every Energy attached. Using the Ability is all or nothing (ruling 2015).
 */
registerCustom('c22.healEvolutions', (env, s, f) => {
  const healed: Slot[] = [];
  for (const sl of slotsIn(s, f.player, 'myPokemon')) {
    if (sl.damage > 0 && slotMatches(env, sl, { stage: 'evolution' }, true, s)) {
      healSlot(s, sl, sl.damage);
      healed.push(sl);
    }
  }
  for (const sl of healed) {
    const gone = sl.energy.splice(0);
    if (!gone.length) continue;
    s.p[f.player].discard.push(...gone);
    emit(env, { type: 'discard', player: f.player, cards: gone });
  }
  return 'next';
});

/**
 * Diancie, Diffuse Reflection: "... for each Special Energy attached to all of your opponent's Pokémon."
 * args: { zone, filter, as } -- counts the Energy CARDS attached to the Pokémon in the controller-relative zone that match
 * the filter (cards, not the Energy they provide: TPCi Rules Team 2024-09-05, ruling 2010), into variable `as` (default `n`).
 */
registerCustom('c22.countAttachedIn', (env, s, f, args) => {
  const filter = args.filter as Filter | undefined;
  let n = 0;
  for (const sl of slotsIn(s, f.player, String(args.zone ?? 'oppPokemon') as SlotZone)) n += sl.energy.filter((c) => cardMatches(env, c, filter)).length;
  f.vars[String(args.as ?? 'n')] = n;
  return 'next';
});

/**
 * Melmetal, Reforged Axe: "Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, ..."
 * Every Tool attached to this Pokémon goes to its owner's discard pile. The number discarded lands in variable `as`
 * (default `n`; 0 when it had none).
 */
registerCustom('c22.discardSelfTools', (env, s, f, args) => {
  const loc = findSlot(s, f.slot);
  const tools = loc ? loc.slot.tools.splice(0) : [];
  for (const c of tools) {
    const owner = env.ctx.owner[c] as 0 | 1;
    s.p[owner].discard.push(c);
    emit(env, { type: 'discard', player: owner, cards: [c] });
  }
  f.vars[String(args.as ?? 'n')] = tools.length;
  return 'next';
});
