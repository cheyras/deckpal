/**
 * Bespoke effects for the "std-30b" batch (std-30b.ts). Names are prefixed `n30b.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-30b.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { devolve } from '../../evolve.js';
import { registerCustom } from '../../customs.js';
import { slotsIn } from '../../eval.js';
import { effectsPrevented, statics } from '../../query.js';
import { emit, opp, takeFromZones } from '../../state.js';
import type { Decision, GameState } from '../../types.js';

function ask(s: GameState, d: Decision): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode: 'cards' } };
  return 'wait';
}

/**
 * Espeon, Miraculous Shine: "Devolve each of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it
 * into your opponent's hand."
 * Every Pokémon of the opponent (Active and Benched) with an Evolution card on it loses its top card (the highest Stage) to its
 * owner's hand, face up; attached cards stay. As with evolving, a devolved Pokémon recovers from all Special Conditions and loses
 * the effects of attacks on it. A Pokémon protected from the effects of attacks (Hide 'n' Sneak) is left alone. A devolved Pokémon
 * whose damage now reaches its lower HP is Knocked Out at the next Knock Out check.
 */
registerCustom('n30b.devolveOppAllToHand', (env, s, f) => {
  const owner = opp(f.player);
  const all = statics(env, s);
  for (const sl of slotsIn(s, f.player, 'oppPokemon')) {
    if (sl.cards.length < 2) continue;
    if (f.kind === 'attack' && effectsPrevented(env, s, sl, f.player, 'attack', all)) continue;
    const [card] = devolve(env, s, sl);
    s.p[owner].hand.push(card as number);
    s.p[owner].revealed.push(card as number);
  }
  return 'next';
});

/**
 * Morpeko, Select a Snack: "Discard the top 3 cards of your deck and put 1 of them into your hand."
 * args: { n } (default 3). The top n cards of the controller's deck (fewer if the deck is smaller) are discarded; then the
 * controller puts 1 of THOSE cards (no other card in the discard pile) from the discard pile into their hand (no question when
 * only one could be taken). A card that "can't be put into your hand or deck from the discard pile" can't be the one. With an
 * empty deck nothing happens.
 */
registerCustom('n30b.discardTopPickToHand', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  let discarded = f.vars.__snack as number[] | undefined;
  if (answer === undefined) {
    const n = Number(args.n ?? 3);
    const top = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse(); // top first
    const gone: number[] = [];
    for (const c of top) if (takeFromZones(ps, c)) gone.push(c);
    ps.discard.push(...gone);
    if (gone.length) emit(env, { type: 'discard', player: f.player, cards: gone });
    discarded = gone;
    f.vars.__snack = gone;
  }
  const opts = (discarded ?? []).filter((c) => !def(env.ctx, c).script?.noRecoverFromDiscard);
  if (!opts.length) return 'next';
  let pick: number | undefined;
  if (answer !== undefined) pick = (answer as number[])[0];
  else if (opts.length === 1) pick = opts[0];
  else return ask(s, { player: f.player, kind: 'cards', prompt: 'Put 1 of the discarded cards into your hand', min: 1, max: 1, values: opts });
  if (pick === undefined || !takeFromZones(ps, pick)) return 'next';
  ps.hand.push(pick);
  return 'next';
});
