/**
 * Bespoke effects for the "std-c28" batch (std-c28.ts). Names are prefixed `c28.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c28.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { devolve } from '../../evolve.js';
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { slotsIn } from '../../eval.js';
import { effectsPrevented, statics } from '../../query.js';
import { emit, opp, removeFrom, shuffleDeck, topCard } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots' | 'index'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/** Every HP a card can print (10 to 400): the guesses Tyme offers. */
const HP_GUESSES: number[] = Array.from({ length: 40 }, (_, i) => (i + 1) * 10);

/**
 * Tyme: "Tell your opponent the name of a Pokémon in your hand and put that Pokémon face down in front of you. Your opponent
 * guesses that Pokémon's HP, and then you reveal it." (the guessing half). args: { cards, as }. `cards` names the variable with
 * the chosen Pokémon (the whole card name is the prompt: Compendium #2068 wants the full name, "Ceruledge ex"). The opponent
 * is asked for the HP; variable `as` (default `right`) becomes 1 when the guess equals the Pokémon's HP (the card's printed
 * HP), else 0. The Pokémon stays in the hand throughout: it is returned there at the end, and nothing else looks at it.
 */
registerCustom('c28.tymeGuess', (env, s, f, args, answer) => {
  const as = String(args.as ?? 'right');
  const v = f.vars[String(args.cards ?? 'x')];
  const card = Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;
  if (card === undefined) {
    f.vars[as] = 0;
    return 'next';
  }
  const d = def(env.ctx, card);
  if (answer === undefined) {
    return ask(
      s,
      {
        player: opp(f.player),
        kind: 'option',
        prompt: `Guess the HP of ${d.name}`,
        min: 1,
        max: 1,
        labels: HP_GUESSES.map((h) => `${h} HP`),
      },
      'index',
    );
  }
  const guess = HP_GUESSES[(answer as number[])[0] ?? 0];
  f.vars[as] = guess === d.hp ? 1 : 0;
  return 'next';
});

/**
 * Glaceon ex, Euclase: "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it." (the choice half).
 * args: { counters, as }. Puts the opponent's Pokémon (Active or Benched) with exactly `counters` damage counters in variable
 * `as` (default `t`): the controller picks when there is more than one; an empty list when none has exactly that many. The
 * program's `knockOut` step does the Knock Out (and honours a Pokémon protected from the effects of attacks).
 */
registerCustom('c28.pickExactCounters', (env, s, f, args, answer) => {
  const as = String(args.as ?? 't');
  const want = Number(args.counters ?? 6) * 10;
  const cands = slotsIn(s, f.player, 'oppPokemon').filter((sl) => sl.damage === want);
  if (answer !== undefined) {
    const id = (answer as number[])[0];
    f.vars[as] = cands.some((c) => c.id === id) ? [id as number] : [];
    return 'next';
  }
  if (cands.length <= 1) {
    f.vars[as] = cands.map((c) => c.id);
    return 'next';
  }
  return ask(s, { player: f.player, kind: 'slots', prompt: `Knock Out which of your opponent's Pokémon?`, min: 1, max: 1, values: cands.map((c) => c.id) }, 'slots');
});

/**
 * Jolteon ex, Flashing Spear: "You may discard up to 2 Basic Energy from your Benched Pokémon. This attack does 90 more damage
 * for each card you discarded in this way." args: { max, as }. The controller picks 0 to `max` Basic Energy CARDS attached to
 * their Benched Pokémon (Special Energy can't be chosen); they go to the discard pile and the number of cards discarded lands
 * in `as` (default `n`).
 */
registerCustom('c28.discardBenchBasicEnergy', (env, s, f, args, answer) => {
  const as = String(args.as ?? 'n');
  const max = Number(args.max ?? 2);
  const ps = s.p[f.player];
  const pool: number[] = [];
  const labels: string[] = [];
  for (const sl of ps.bench) {
    for (const c of sl.energy) {
      if (!def(env.ctx, c).basicEnergy) continue;
      pool.push(c);
      labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
    }
  }
  if (!pool.length) {
    f.vars[as] = 0;
    return 'next';
  }
  if (answer === undefined) {
    return ask(s, { player: f.player, kind: 'cards', prompt: `Discard up to ${max} Basic Energy from your Benched Pokémon`, min: 0, max: Math.min(max, pool.length), values: pool, labels }, 'cards');
  }
  const chosen = (answer as number[]).filter((c) => pool.includes(c)).slice(0, max);
  for (const c of chosen) {
    for (const sl of ps.bench) if (removeFrom(sl.energy, c)) break;
    ps.discard.push(c);
  }
  if (chosen.length) emit(env, { type: 'discard', player: f.player, cards: chosen });
  f.vars[as] = chosen.length;
  return 'next';
});

/**
 * Espeon ex, Amazez: "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into
 * your opponent's deck." Every Pokémon of the opponent (Active and Benched) with an Evolution card on it loses its top card
 * (the highest Stage) into its owner's deck; attached cards stay. As with evolving, a devolved Pokémon recovers from all Special
 * Conditions and loses the effects of attacks on it (the `c02.devolve` precedent). A Pokémon protected from the effects of attacks
 * is left alone. The deck is shuffled once, afterwards, when any card went into it; a devolved Pokémon whose damage now
 * reaches its lower HP is Knocked Out at the next Knock Out check.
 */
registerCustom('c28.devolveOppToDeck', (env, s, f) => {
  const owner = opp(f.player);
  const all = statics(env, s);
  let shuffled = false;
  for (const sl of slotsIn(s, f.player, 'oppPokemon')) {
    if (sl.cards.length < 2) continue;
    if (f.kind === 'attack' && effectsPrevented(env, s, sl, f.player, 'attack', all)) continue;
    const [card] = devolve(env, s, sl);
    s.p[owner].deck.push(card as number);
    shuffled = true;
  }
  if (shuffled) shuffleDeck(env, s, owner);
  return 'next';
});
