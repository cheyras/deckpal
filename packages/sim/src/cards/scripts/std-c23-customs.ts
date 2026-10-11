/**
 * Bespoke effects for the "std-c23" batch (std-c23.ts). Names are prefixed `c23.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c23.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { evolveOnto as evolveStack } from '../../evolve.js';
import { def, type Env } from '../../context.js';
import { registerCustom, registerCustomCond } from '../../customs.js';
import { allSlots, emit, findSlot, removeFrom, topCard } from '../../state.js';
import type { Decision, Frame, GameState, Player, Slot } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots' | 'index'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

/** The player's own first turn (the second player's first turn is turn 2): no Pokémon can evolve then. */
function ownFirstTurn(s: GameState, p: Player): boolean {
  return s.turn === (p === s.first ? 1 : 2);
}

/** Put `card` (taken from the deck) on top of the Pokémon in `sl`, exactly as evolving does (clears Special Conditions and attack effects). */
function evolveOnto(env: Env, s: GameState, p: Player, sl: Slot, card: number): boolean {
  const ps = s.p[p];
  if (!removeFrom(ps.deck, card)) return false;
  ps.prizesKnown = true; // the player looked through their deck
  emit(env, { type: 'search', player: p, found: [card] });
  evolveStack(env, s, sl, card);
  emit(env, { type: 'evolve', player: p, card, slot: sl.id });
  return true;
}

/**
 * Exeggcute, Precocious Evolution: "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to
 * evolve it." (the program shuffles next). Unlike an ordinary evolution it works on the controller's first turn (the attack
 * says it can be used then). The controller may pick one Pokémon card in the deck whose "evolves from" is this Pokémon's name, or none.
 */
registerCustom('c23.evolveSelfFromDeck', (env, s, f, _args, answer) => {
  const p = f.player;
  const sl = findSlot(s, f.slot)?.slot;
  if (!sl) return 'next';
  if (answer === undefined) {
    if (sl.evolvedTurn >= s.turn) return 'next';
    const name = def(env.ctx, topCard(sl)).name;
    const opts = s.p[p].deck.filter((c) => {
      const d = def(env.ctx, c);
      return d.kind === 'pokemon' && d.stage >= 1 && d.evolvesFrom === name;
    });
    if (!opts.length) return 'next';
    return ask(s, { player: p, kind: 'cards', prompt: `Evolve ${name} with a card from your deck (or none)`, min: 0, max: 1, values: opts }, 'cards');
  }
  const pick = (answer as number[])[0];
  if (pick !== undefined) evolveOnto(env, s, p, sl, pick);
  return 'next';
});

/**
 * Basic Pokémon of `p` that Grand Tree may evolve: not on that player's own first turn, not one put into play this turn, not
 * one that evolved this turn.
 */
function grandTreeBasics(env: Env, s: GameState, p: Player): Slot[] {
  if (ownFirstTurn(s, p)) return [];
  return allSlots(s.p[p]).filter((sl) => {
    const d = def(env.ctx, topCard(sl));
    return d.kind === 'pokemon' && d.stage === 0 && sl.enteredTurn < s.turn && sl.evolvedTurn < s.turn;
  });
}

/** Stage 1 Pokémon cards in the deck that evolve from the name of one of these Basic Pokémon. */
function grandTreeStage1(env: Env, s: GameState, p: Player, basics: Slot[]): number[] {
  const names = basics.map((b) => def(env.ctx, topCard(b)).name);
  return s.p[p].deck.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'pokemon' && d.stage === 1 && d.evolvesFrom !== null && names.includes(d.evolvesFrom);
  });
}

/**
 * Grand Tree (the "can it be used" half): "Once during each player's turn, that player may search their deck for a Stage 1
 * Pokémon that evolves from 1 of their Basic Pokémon ..." Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2030/):
 * "No, you may not. There must be a known valid evolution path in order to use Grand Tree." True when one of the player's Basic
 * Pokémon in play can evolve (rules above) into a Stage 1 Pokémon card that is in their deck.
 */
registerCustomCond('c23.grandTreeUsable', (env, s, ec) => grandTreeStage1(env, s, ec.player, grandTreeBasics(env, s, ec.player)).length > 0);

/**
 * Grand Tree: "... search their deck for a Stage 1 Pokémon that evolves from 1 of their Basic Pokémon and put it onto that
 * Pokémon to evolve it. If that Pokémon was evolved in this way, that player may search their deck for a Stage 2 Pokémon that
 * evolves from that Pokémon and put it onto that Pokémon to evolve it." (the program shuffles next).
 * The user picks a Stage 1 card (or none), then which of their Basic Pokémon of that name receives it (no question when only one
 * can), then a Stage 2 card that evolves from it (or none). Neither is played from the hand, so no "when you play this Pokémon
 * from your hand to evolve" trigger runs (Compendium #2037).
 */
registerCustom('c23.grandTree', (env, s, f, _args, answer) => {
  const p = f.player;
  const phase = (f.vars.__gtPhase as number | undefined) ?? 0;
  const done = (): 'next' => {
    delete f.vars.__gtPhase;
    delete f.vars.__gtCard;
    delete f.vars.__gtSlot;
    return 'next';
  };
  if (phase === 0) {
    const basics = grandTreeBasics(env, s, p);
    if (answer === undefined) {
      const opts = grandTreeStage1(env, s, p, basics);
      if (!opts.length) return done();
      return ask(s, { player: p, kind: 'cards', prompt: 'Search your deck for a Stage 1 Pokémon that evolves from 1 of your Basic Pokémon (or none)', min: 0, max: 1, values: opts }, 'cards');
    }
    const pick = (answer as number[])[0];
    if (pick === undefined) return done();
    const from = def(env.ctx, pick).evolvesFrom;
    const targets = basics.filter((b) => def(env.ctx, topCard(b)).name === from);
    if (!targets.length) return done();
    f.vars.__gtCard = pick;
    if (targets.length === 1) {
      f.vars.__gtSlot = (targets[0] as Slot).id;
      f.vars.__gtPhase = 1;
      return grandTreeEvolve(env, s, f, done);
    }
    f.vars.__gtPhase = 1;
    return ask(s, { player: p, kind: 'slots', prompt: 'Evolve which Basic Pokémon?', min: 1, max: 1, values: targets.map((t) => t.id) }, 'slots');
  }
  if (phase === 1) {
    if (answer !== undefined) f.vars.__gtSlot = (answer as number[])[0] as number;
    return grandTreeEvolve(env, s, f, done);
  }
  // Phase 2: the Stage 2 card.
  const sl = findSlot(s, f.vars.__gtSlot as number)?.slot;
  const pick = answer === undefined ? undefined : (answer as number[])[0];
  if (sl && pick !== undefined) evolveOnto(env, s, p, sl, pick);
  return done();
});

/** Phase 1 of Grand Tree: evolve the chosen Basic with the chosen Stage 1, then offer the Stage 2 cards that evolve from it. */
function grandTreeEvolve(env: Env, s: GameState, f: Frame, done: () => 'next'): 'next' | 'wait' {
  const p = f.player;
  const sl = findSlot(s, f.vars.__gtSlot as number)?.slot;
  if (!sl || !evolveOnto(env, s, p, sl, f.vars.__gtCard as number)) return done();
  const name = def(env.ctx, topCard(sl)).name;
  const opts = s.p[p].deck.filter((c) => {
    const d = def(env.ctx, c);
    return d.kind === 'pokemon' && d.stage === 2 && d.evolvesFrom === name;
  });
  if (!opts.length) return done();
  f.vars.__gtPhase = 2;
  return ask(s, { player: p, kind: 'cards', prompt: `Search your deck for a Stage 2 Pokémon that evolves from ${name} (or none)`, min: 0, max: 1, values: opts }, 'cards');
}
