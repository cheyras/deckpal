/**
 * Bespoke effects for the "std-c08" batch (std-c08.ts). Names are prefixed `c08.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c08.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { PType, SlotZone } from '../../dsl.js';
import { slotsIn } from '../../eval.js';
import { effectsPrevented, maxHp, statics } from '../../query.js';
import { emit, flipCoin } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode: 'cards' } };
  return 'wait';
}

/**
 * Mega Zygarde ex, Nullifying Zero: "For each of your opponent's Pokémon, flip a coin. If heads, ..."
 * args: { zone, as }. Flips one coin for every Pokémon in the controller-relative zone (the Active Spot first, then the
 * Bench in order) and stores the Pokémon whose coin was heads in variable `as` (a list of slots, possibly empty).
 * Every Pokémon is flipped for, including one that cannot be damaged (a Benched Tera Pokémon, Compendium #2316).
 */
registerCustom('c08.flipEach', (env, s, f, args) => {
  const zone = String(args.zone ?? 'oppPokemon') as SlotZone;
  const heads: number[] = [];
  for (const sl of slotsIn(s, f.player, zone)) if (flipCoin(env, s, f.player)) heads.push(sl.id);
  f.vars[String(args.as ?? 'hit')] = heads;
  return 'next';
});

/**
 * Yveltal ex, Soul Destroyer: "Knock Out each of your opponent's Pokémon that has 50 HP or less remaining."
 * args: { max } (default 50). Every Pokémon of the opponent whose remaining HP (HP minus damage) is at most `max` is
 * Knocked Out, Active and Benched alike. Knocking Out is not damage, so a Benched Tera Pokémon is not protected; a
 * Pokémon protected from the effects of attacks (Hide 'n' Sneak) is skipped.
 */
registerCustom('c08.koLowHp', (env, s, f, args) => {
  const max = Number(args.max ?? 50);
  const all = statics(env, s);
  for (const t of slotsIn(s, f.player, 'oppPokemon')) {
    const hp = maxHp(env, s, t, all);
    if (hp - t.damage > max) continue;
    if (f.kind === 'attack' && effectsPrevented(env, s, t, f.player, 'attack', all)) continue;
    t.damage = Math.max(t.damage, hp);
  }
  return 'next';
});

/**
 * Fletchling, Chirp: "Search your deck for up to 2 Pokémon with {F} Resistance, reveal them, and put them into your hand."
 * (the search half). args: { type, max, as }. The controller picks up to `max` (0 allowed) Pokémon cards in their deck whose
 * printed Resistance is `type`, into variable `as`; they are revealed. Nothing leaves the deck yet: the program moves them
 * to the hand and shuffles.
 */
registerCustom('c08.pickByResistance', (env, s, f, args, answer) => {
  const type = args.type as PType;
  const max = Number(args.max ?? 2);
  const as = String(args.as ?? 'found');
  const ps = s.p[f.player];
  ps.prizesKnown = true; // the player looked through their deck
  const opts = ps.deck.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'pokemon' && d.resistance?.type === type;
  });
  const finish = (picked: number[]): 'next' => {
    f.vars[as] = picked;
    f.vars.__revealed = [...((f.vars.__revealed as number[] | undefined) ?? []), ...picked];
    emit(env, { type: 'search', player: f.player, found: picked.slice() });
    return 'next';
  };
  if (answer !== undefined) return finish((answer as number[]).filter((c) => opts.includes(c)));
  if (!opts.length) return finish([]);
  return ask(s, { player: f.player, kind: 'cards', prompt: `Search for up to ${max} Pokémon with ${type} Resistance`, min: 0, max: Math.min(max, opts.length), values: opts });
});
