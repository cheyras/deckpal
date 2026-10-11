/**
 * Bespoke effects for the "excadrill" meta lane, registered into customs.ts.
 * Each is written from the printed text quoted above it and tested in
 * src/__tests__/cards-meta-excadrill.test.ts.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { cardMatches, slotsIn } from '../../eval.js';
import { emit, rand } from '../../state.js';

/**
 * Metang, Metal Maker: "Once during your turn, you may look at the top 4 cards of your deck and attach any number
 * of Basic {M} Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards and put them
 * on the bottom of your deck."
 * args: { n, filter } — look at the top n cards; choose any number of the cards matching `filter`, then a Pokémon
 * for each one in turn; the cards of the top n not attached are shuffled and put on the bottom of the deck.
 * Its state lives in the frame's variables (`__mm*`), so a half-finished use survives a state clone.
 */
registerCustom('lookAtTopAttach', (env, s, f, args, answer) => {
  const ps = s.p[f.player];
  const V = f.vars as Record<string, unknown>;
  const ask = (kind: 'cards' | 'slots', prompt: string, min: number, max: number, values: number[]): 'wait' => {
    s.pending = { decision: { player: f.player, kind, prompt, min, max, values }, resume: { k: 'frame', as: '__a', mode: kind } };
    return 'wait';
  };
  if (V.__mmStage === undefined) {
    const n = Number(args.n ?? 4);
    const filter = args.filter as Filter | undefined;
    const top = ps.deck.slice(Math.max(0, ps.deck.length - n));
    V.__mmTop = top;
    V.__mmLeft = [];
    V.__mmStage = 1;
    const opts = top.filter((c) => cardMatches(env, c, filter));
    if (opts.length) return ask('cards', `Attach any number of these (${def(env.ctx, f.src).name})`, 0, opts.length, opts);
  } else if (V.__mmStage === 1) {
    V.__mmLeft = Array.isArray(answer) ? (answer as number[]).slice() : [];
    V.__mmStage = 2;
  } else if (Array.isArray(answer) && answer.length) {
    const left = V.__mmLeft as number[];
    const card = left.shift() as number;
    const target = slotsIn(s, f.player, 'myPokemon').find((sl) => sl.id === (answer as number[])[0]);
    const i = ps.deck.indexOf(card);
    if (target && i >= 0) {
      ps.deck.splice(i, 1);
      target.energy.push(card);
      emit(env, { type: 'attach', player: f.player, card, slot: target.id });
    }
  }
  const left = V.__mmLeft as number[];
  if (left.length) {
    const slots = slotsIn(s, f.player, 'myPokemon').map((sl) => sl.id);
    return ask('slots', `Attach ${def(env.ctx, left[0] as number).name} to which Pokémon?`, 1, 1, slots);
  }
  // "Shuffle the other cards and put them on the bottom of your deck."
  const rest = (V.__mmTop as number[]).filter((c) => ps.deck.includes(c));
  ps.deck = ps.deck.filter((c) => !rest.includes(c));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s, f.player) * (i + 1));
    [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
  }
  ps.deck.unshift(...rest);
  ps.knownTop = Math.max(0, ps.knownTop - (V.__mmTop as number[]).length);
  delete V.__mmStage;
  delete V.__mmTop;
  delete V.__mmLeft;
  return 'next';
});
