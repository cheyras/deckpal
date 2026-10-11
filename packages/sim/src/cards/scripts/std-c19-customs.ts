/**
 * Bespoke effects for the "std-c19" batch (std-c19.ts). Names are prefixed `c19.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c19.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import { cardMatches } from '../../eval.js';
import { allSlots, draw, emit, findSlot, flipCoin, opp, removeFrom, shuffleDeck, slotCards, topCard } from '../../state.js';
import type { Decision, GameState, Player, Val } from '../../types.js';

function ask(s: GameState, d: Decision): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode: 'cards' } };
  return 'wait';
}
function first(v: Val | undefined): number | undefined {
  return Array.isArray(v) ? (v[0] as number | undefined) : typeof v === 'number' ? v : undefined;
}

/**
 * Farfetch'd, Impromptu Carrier: "... you may search your deck for a Pokémon Tool card and attach it to this Pokémon.
 * Then, shuffle your deck." (the program shuffles next).
 * The controller picks one Pokémon Tool in the deck (none is allowed: a search can come up empty) and it becomes the
 * Tool of this Pokémon. A Pokémon carries one Tool, so nothing is attached if it already has one.
 */
registerCustom('c19.attachToolFromDeck', (env, s, f, _args, answer) => {
  const ps = s.p[f.player];
  const loc = findSlot(s, f.slot);
  if (!loc || loc.owner !== f.player) return 'next';
  ps.prizesKnown = true; // the player looked through their deck
  const take = (cards: number[]): 'next' => {
    const c = cards[0];
    if (c !== undefined && loc.slot.tools.length === 0 && removeFrom(ps.deck, c)) loc.slot.tools.push(c);
    if (c !== undefined) emit(env, { type: 'search', player: f.player, found: [c] });
    return 'next';
  };
  if (answer !== undefined) return take(answer as number[]);
  const opts = ps.deck.filter((c) => cardMatches(env, c, { ttype: 'tool' }));
  if (!opts.length || loc.slot.tools.length) return 'next';
  return ask(s, { player: f.player, kind: 'cards', prompt: 'Attach a Pokémon Tool from your deck to this Pokémon', min: 0, max: 1, values: opts });
});

/**
 * Accompanying Flute: "Reveal the top 5 cards of your opponent's deck. You may choose any number of Basic Pokémon you find
 * there and put those Pokémon onto their Bench."
 * Ruling (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1986/): "No, since Accompanying Flute says "you may choose any number", you don't have to choose any Basic Pokemon if you don't want to."
 * args: { n, as } -- the controller picks any number (0 to the free Bench spaces) of the Basic Pokémon among the top n cards of
 * the opponent's deck into variable `as`; the program then puts them onto the opponent's Bench and shuffles that deck.
 */
registerCustom('c19.revealTopPick', (env, s, f, args, answer) => {
  const o = opp(f.player);
  const ps = s.p[o];
  const as = String(args.as ?? 'x');
  const n = Number(args.n ?? 5);
  const top = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse(); // top first
  const space = Math.max(0, 5 - ps.bench.length);
  const opts = top.filter((c) => cardMatches(env, c, { cat: 'pokemon', stage: 'basic' }));
  if (answer !== undefined) {
    f.vars[as] = (answer as number[]).filter((c) => opts.includes(c)).slice(0, space);
    return 'next';
  }
  if (!opts.length || !space) {
    f.vars[as] = [];
    return 'next';
  }
  return ask(s, {
    player: f.player,
    kind: 'cards',
    prompt: "Put any number of these Basic Pokémon onto your opponent's Bench",
    min: 0,
    max: Math.min(space, opts.length),
    values: opts,
  });
});

/**
 * Love Ball: "Search your deck for a Pokémon with the same name as 1 of your opponent's Pokémon in play, reveal it, and put
 * it into your hand." (the program shuffles next).
 * The controller picks one Pokémon in the deck whose name is the name of any of the opponent's Pokémon in play (none is
 * allowed: a search can come up empty); it is revealed and goes to the hand.
 */
registerCustom('c19.searchSameNameAsOpp', (env, s, f, _args, answer) => {
  const ps = s.p[f.player];
  ps.prizesKnown = true; // the player looked through their deck
  const take = (cards: number[]): 'next' => {
    for (const c of cards.slice(0, 1)) {
      if (!removeFrom(ps.deck, c)) continue;
      ps.hand.push(c);
      ps.revealed.push(c);
    }
    if (cards.length) emit(env, { type: 'search', player: f.player, found: cards.slice(0, 1) });
    return 'next';
  };
  if (answer !== undefined) return take(answer as number[]);
  const names = new Set(allSlots(s.p[opp(f.player)]).map((sl) => def(env.ctx, topCard(sl)).name));
  const opts = ps.deck.filter((c) => def(env.ctx, c).kind === 'pokemon' && names.has(def(env.ctx, c).name));
  if (!opts.length) return 'next';
  return ask(s, { player: f.player, kind: 'cards', prompt: "Reveal a Pokémon with the same name as one of your opponent's Pokémon in play", min: 0, max: 1, values: opts });
});

/**
 * Caretaker: "... shuffle this Caretaker into your deck instead of discarding it."
 * The card being played is held out of every zone until its program ends, when it would go to the discard pile; putting it
 * in the deck now and shuffling means it is no longer there to be discarded.
 */
registerCustom('c19.shuffleSelfIntoDeck', (env, s, f) => {
  if (!removeFrom(s.limbo, f.src)) return 'next';
  s.p[f.player].deck.push(f.src);
  shuffleDeck(env, s, f.player);
  return 'next';
});

/**
 * Lucian: "... each player flips a coin. If heads, that player draws 6 cards. If tails, they draw 3 cards."
 * args: { heads, tails } -- the player of the card flips first, then their opponent; each draws for their own coin.
 */
registerCustom('c19.coinDraw', (env, s, f, args) => {
  for (const p of [f.player, opp(f.player)] as Player[]) {
    const heads = flipCoin(env, s, p);
    draw(env, s, p, Number(heads ? (args.heads ?? 6) : (args.tails ?? 3)));
  }
  return 'next';
});

/**
 * Scoop Up Cyclone: "Put 1 of your Pokémon and all attached cards into your hand."
 * args: { slot } -- the Pokémon chosen into that variable. Its whole stack, Energy and Tool go to the hand, and timed
 * effects bound to it end. If it was the Active Pokémon, the usual promotion happens afterwards.
 */
registerCustom('c19.scoopUp', (_env, s, f, args) => {
  const id = first(f.vars[String(args.slot ?? 't')]);
  const loc = id === undefined ? undefined : findSlot(s, id);
  if (!loc || loc.owner !== f.player) return 'next';
  const ps = s.p[loc.owner];
  if (ps.active === loc.slot) ps.active = null;
  else ps.bench = ps.bench.filter((b) => b !== loc.slot);
  s.effects = s.effects.filter((x) => x.slot !== loc.slot.id);
  ps.hand.push(...slotCards(loc.slot));
  return 'next';
});

/** Community Center: "if they played a Supporter card from their hand this turn" -- the acting player did. */
registerCustomCond('c19.supporterPlayedThisTurn', (_env, s, ec) => s.p[ec.player].supporterPlayed);
