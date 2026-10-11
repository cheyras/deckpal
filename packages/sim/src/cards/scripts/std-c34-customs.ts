/**
 * Bespoke effects for the "std-c34" batch (std-c34.ts). Names are prefixed `c34.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c34.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { cardMatches } from '../../eval.js';
import { allSlots, emit, opp, topCard } from '../../state.js';
import type { Decision, GameState, Slot } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/**
 * Forretress, Iron Shake-Up: "You may move any amount of {M} Energy from your Pokémon to your other Pokémon in
 * any way you like."
 * args: { filter } -- which attached Energy cards may move. The controller repeatedly picks one matching Energy card attached to
 * one of their Pokémon (or none, to stop) and a different Pokémon of theirs to move it to. Each card moves at most once (every
 * end position is still reachable). The choice names the Pokémon each Energy is on. Nothing is asked with a single Pokémon in
 * play or no matching Energy.
 */
registerCustom('c34.moveEnergyAny', (env, s, f, args, answer) => {
  const filter = args.filter as Filter | undefined;
  const ps = s.p[f.player];
  const slots = allSlots(ps);
  const moved = (f.vars.__c34moved as number[] | undefined) ?? [];
  const finish = (): 'next' => {
    delete f.vars.__c34moved;
    delete f.vars.__c34card;
    return 'next';
  };
  if (slots.length < 2) return finish();
  for (;;) {
    let card = f.vars.__c34card as number | undefined;
    if (card === undefined) {
      if (answer !== undefined) {
        card = (answer as number[])[0];
        answer = undefined;
        if (card === undefined) return finish();
        f.vars.__c34card = card;
      } else {
        const pool: number[] = [];
        const labels: string[] = [];
        for (const sl of slots) {
          for (const c of sl.energy) {
            if (moved.includes(c) || !cardMatches(env, c, filter)) continue;
            pool.push(c);
            labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
          }
        }
        if (!pool.length) return finish();
        return ask(s, { player: f.player, kind: 'cards', prompt: 'Move an Energy (or none to stop)', min: 0, max: 1, values: pool, labels }, 'cards');
      }
    }
    const src = slots.find((sl) => sl.energy.includes(card as number));
    const dests = slots.filter((sl) => sl !== src);
    let to: Slot | undefined;
    if (!src || !dests.length) {
      delete f.vars.__c34card;
      continue;
    }
    if (answer !== undefined) {
      to = dests.find((sl) => sl.id === (answer as number[])[0]);
      answer = undefined;
    } else if (dests.length === 1) to = dests[0];
    else {
      return ask(s, { player: f.player, kind: 'slots', prompt: 'Move it to which Pokémon?', min: 1, max: 1, values: dests.map((d) => d.id) }, 'slots');
    }
    delete f.vars.__c34card;
    if (to) {
      src.energy = src.energy.filter((c) => c !== card);
      to.energy.push(card as number);
      emit(env, { type: 'attach', player: f.player, card: card as number, slot: to.id });
      moved.push(card as number);
      f.vars.__c34moved = moved;
    }
  }
});

/**
 * Team Rocket's Persian ex, Haughty Order: "Reveal the top 10 cards of your opponent's deck. You may choose an attack from a
 * Pokémon you find there and use it as this attack." (the program then runs `useAttackOf` and shuffles that deck)
 * args: { n, as } -- the controller picks 0 or 1 of the Pokémon that have an attack among the top n cards of the opponent's
 * deck into variable `as` (an empty variable when they pick none or none qualifies). The copied attack's cost is not paid
 * (Compendium #2157).
 */
registerCustom('c34.revealOppTopPick', (env, s, f, args, answer) => {
  const o = opp(f.player);
  const deck = s.p[o].deck;
  const as = String(args.as ?? 'c');
  const n = Number(args.n ?? 10);
  const top = deck.slice(Math.max(0, deck.length - n)).reverse(); // top first
  const opts = top.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'pokemon' && d.attacks.length > 0;
  });
  if (answer !== undefined) {
    f.vars[as] = (answer as number[]).filter((c) => opts.includes(c)).slice(0, 1);
    return 'next';
  }
  f.vars[as] = [];
  if (!opts.length) return 'next';
  return ask(
    s,
    { player: f.player, kind: 'cards', prompt: `Revealed: the top ${top.length} cards of your opponent's deck. Choose a Pokémon whose attack to use (or none)`, min: 0, max: 1, values: opts },
    'cards',
  );
});
