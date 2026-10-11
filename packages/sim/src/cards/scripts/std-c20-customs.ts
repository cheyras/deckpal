/**
 * Bespoke effects for the "std-c20" batch (std-c20.ts). Names are prefixed `c20.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c20.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { opp, shuffleDeck } from '../../state.js';
import type { Decision, GameState, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'bool'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function idsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? (v as number[]).slice() : typeof v === 'number' ? [v] : [];
}

/**
 * Inkay, Mischievous Tentacles: "Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."
 * The controller is shown the top card of the opponent's deck (in the question) and answers yes/no; yes shuffles the
 * opponent's deck. An empty deck: nothing to look at, nothing happens. (The sim does not record that the controller now
 * knows that card; the question itself shows it.)
 */
registerCustom('c20.peekOppTop', (env, s, f, _args, answer) => {
  const o = opp(f.player);
  const deck = s.p[o].deck;
  if (!deck.length) return 'next';
  if (answer !== undefined) {
    if (answer === true) shuffleDeck(env, s, o);
    return 'next';
  }
  const top = deck[deck.length - 1] as number;
  return ask(
    s,
    { player: f.player, kind: 'yesno', prompt: `The top card of your opponent's deck is ${def(env.ctx, top).name}. Have your opponent shuffle their deck?`, min: 1, max: 1, labels: ['Yes', 'No'] },
    'bool',
  );
});

/**
 * Eevee, Colorful Catch: "... reveal them, and put them into your hand."
 * args: { cards } (default `found`). Marks the cards in that variable as revealed to the opponent, so that when they are
 * moved to the hand the opponent knows what they are.
 */
registerCustom('c20.revealFound', (_env, s, f, args) => {
  void s;
  const cards = idsOf(f.vars[String(args.cards ?? 'found')]);
  f.vars.__revealed = [...((f.vars.__revealed as number[] | undefined) ?? []), ...cards];
  return 'next';
});
