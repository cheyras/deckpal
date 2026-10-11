/**
 * Bespoke effects for the "std-c26" batch (std-c26.ts). Names are prefixed `c26.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c26.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { cardMatches } from '../../eval.js';
import { effectsPrevented } from '../../query.js';
import { allSlots, emit, opp, removeFrom } from '../../state.js';
import type { Decision, GameState, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function cardsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}

/**
 * Grafaiai, Mischievous Painting: "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way
 * you like."
 * Attaches each card in variable `args.cards` (chosen from the opponent's discard pile) to a Pokémon of the controller's
 * OPPONENT, the controller choosing the Pokémon for each card (no question when only one is possible). A Pokémon protected
 * from the effects of attacks can't be chosen; cards left over when none can take them stay in the discard pile.
 */
registerCustom('c26.attachToOppPokemon', (env, s, f, args, answer) => {
  const o = opp(f.player);
  const os = s.p[o];
  const cards = cardsOf(f.vars[String(args.cards ?? 'e')]);
  const pool = () => allSlots(os).filter((sl) => !effectsPrevented(env, s, sl, f.player, 'attack'));
  const attach = (card: number, slot: ReturnType<typeof pool>[number]): void => {
    if (!removeFrom(os.discard, card)) return;
    slot.energy.push(card);
    emit(env, { type: 'attach', player: o, card, slot: slot.id });
  };
  let i = (f.vars.__c26i as number | undefined) ?? 0;
  if (answer !== undefined) {
    const target = allSlots(os).find((sl) => sl.id === (answer as number[])[0]);
    if (target) attach(cards[i] as number, target);
    i++;
  }
  while (i < cards.length) {
    const cands = pool();
    if (!cands.length) break;
    if (cands.length > 1) {
      f.vars.__c26i = i;
      return ask(
        s,
        { player: f.player, kind: 'slots', prompt: `Attach ${def(env.ctx, cards[i] as number).name} to which of your opponent's Pokémon?`, min: 1, max: 1, values: cands.map((sl) => sl.id) },
        'slots',
      );
    }
    attach(cards[i] as number, cands[0]!);
    i++;
  }
  delete f.vars.__c26i;
  return 'next';
});

/**
 * Tatsugiri ex, Cinnabar Lure: "Look at the top 10 cards of your deck. You may put any number of Pokémon you find there onto
 * your Bench." (the look-and-choose half). args: { n, filter, as }. The controller picks any number (0 to all) of the cards
 * among the top n that match `filter`, no more than the Bench has room for, into variable `as`. Nothing moves yet.
 */
registerCustom('c26.lookTopChoose', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const as = String(args.as ?? 'found');
  const n = Number(args.n ?? 10);
  const filter = args.filter as Filter | undefined;
  const room = Math.max(0, 5 - ps.bench.length);
  const opts = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse().filter((c) => cardMatches(env, c, filter)); // top first
  if (answer !== undefined) {
    f.vars[as] = (answer as number[]).filter((c) => opts.includes(c)).slice(0, room);
    return 'next';
  }
  if (!opts.length || !room) {
    f.vars[as] = [];
    return 'next';
  }
  return ask(
    s,
    { player: f.player, kind: 'cards', prompt: `Put any number of these Pokémon onto your Bench (up to ${room})`, min: 0, max: Math.min(room, opts.length), values: opts },
    'cards',
  );
});
