/**
 * Bespoke effects for the "std-c09" batch (std-c09.ts). Names are prefixed `c09.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c09.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def, type Env } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter, PType } from '../../dsl.js';
import { cardMatches } from '../../eval.js';
import { queueOppAttachTriggers } from '../../interp.js';
import { canAttachFromHand, cardUnits, effectsPrevented } from '../../query.js';
import { allSlots, emit, findSlot, opp, removeFrom, takeFromZones } from '../../state.js';
import { ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED } from '../../types.js';
import type { Decision, GameState, Player, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots' | 'index'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function numsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}

/**
 * Lumiose City: "...If a player searches their deck in this way, their turn ends."
 * Ends the turn of the player using it once the stack is empty, exactly as using an attack does (but no attack is used,
 * so nothing counts as damaged by an attack this turn).
 */
registerCustom('c09.endTurn', (_env, s) => {
  s.attacked = true;
  s.attackHits = [];
  return 'next';
});

const CONDITION_BITS: [string, number][] = [
  ['Asleep', ASLEEP],
  ['Confused', CONFUSED],
  ['Paralyzed', PARALYZED],
  ['Poisoned', POISONED],
  ['Burned', BURNED],
];

/**
 * Lumiose Galette: "...remove a Special Condition from your Active Pokémon."
 * Removes exactly one Special Condition from the controller's Active Pokémon; the controller picks which when it has
 * more than one (no question with one, nothing happens with none).
 */
registerCustom('c09.removeCondition', (_env, s, f, _args, answer) => {
  const t = s.p[f.player].active;
  if (!t) return 'next';
  const have = CONDITION_BITS.filter(([, bit]) => t.cond & bit);
  if (!have.length) return 'next';
  let pick: number;
  if (answer !== undefined) pick = (answer as number[])[0] ?? 0;
  else if (have.length === 1) pick = 0;
  else return ask(s, { player: f.player, kind: 'option', prompt: 'Remove which Special Condition?', min: 1, max: 1, labels: have.map(([n]) => n) }, 'index');
  const bit = (have[pick] ?? have[0]!)[1];
  t.cond &= ~bit;
  return 'next';
});

/**
 * Avalugg, Iceberg Breaker: "Discard the top 6 cards of your deck, and this attack does 60 damage for each Basic {W}
 * Energy card you discarded in this way."
 * args: { n, filter, as } -- discards the top n cards of the controller's deck (fewer if the deck is smaller) and stores
 * in variable `as` (default `n`) how many of the discarded cards match `filter`.
 */
registerCustom('c09.discardTopCount', (env, s, f, args) => {
  const ps = s.p[f.player];
  const n = Number(args.n ?? 1);
  const top = ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse();
  const gone: number[] = [];
  for (const c of top) if (takeFromZones(ps, c)) gone.push(c);
  ps.discard.push(...gone);
  if (gone.length) emit(env, { type: 'discard', player: f.player, cards: gone });
  f.vars[String(args.as ?? 'n')] = gone.filter((c) => cardMatches(env, c, args.filter as Filter | undefined)).length;
  return 'next';
});

/** Is this Basic Energy card (in a hand)? */
const BASIC_ENERGY: Filter = { basicEnergy: true };

/**
 * Delibird, Pleasing Present: "Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in
 * any way they like. Your opponent does this first."
 * args: { max } (default 3). The opponent chooses 0..max Basic Energy cards from their hand and which of their Pokémon
 * gets each, then the controller does the same. A card goes to a Pokémon that can take Energy from the hand; the cards
 * of both players count as attached at the same time, so the attach triggers ("whenever your opponent attaches an Energy
 * card from their hand...") only fire after both players have finished.
 * Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2354/): Energy a player attaches to a Pokémon that is
 * protected from the attack's effects (Skeledirge, Unaware) is discarded once that player has made their choice.
 * Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2353/): the opponent chooses first.
 */
registerCustom('c09.pleasingPresent', (env, s, f, args, answer) => {
  const max = Number(args.max ?? 3);
  const order: Player[] = [opp(f.player), f.player];
  const v = f.vars;
  const finish = (): 'next' => {
    const fired = numsOf(v.__ppFired);
    for (let k = 0; k + 1 < fired.length; k += 2) {
      const loc = findSlot(s, fired[k + 1] as number);
      if (loc) queueOppAttachTriggers(env, s, fired[k] as Player, loc.slot);
    }
    for (const key of ['__ppI', '__ppStage', '__ppCards', '__ppJ', '__ppFired']) delete v[key];
    return 'next';
  };
  for (;;) {
    const i = typeof v.__ppI === 'number' ? v.__ppI : 0;
    if (i >= order.length) return finish();
    const p = order[i] as Player;
    const ps = s.p[p];
    const stage = typeof v.__ppStage === 'number' ? v.__ppStage : 0;
    if (stage === 0) {
      const pool = ps.hand.filter((c) => cardMatches(env, c, BASIC_ENERGY));
      if (answer === undefined) {
        const takers = allSlots(ps).filter((sl) => effectsPrevented(env, s, sl, f.player, 'attack') || canAttachFromHand(env, s, sl));
        if (!pool.length || !takers.length) {
          v.__ppI = i + 1;
          continue;
        }
        v.__ppI = i;
        v.__ppStage = 0;
        return ask(
          s,
          { player: p, kind: 'cards', prompt: `Attach up to ${max} Basic Energy cards from your hand to your Pokémon`, min: 0, max: Math.min(max, pool.length), values: pool },
          'cards',
        );
      }
      const chosen = (answer as number[]).filter((c) => pool.includes(c)).slice(0, max);
      answer = undefined;
      if (!chosen.length) {
        v.__ppI = i + 1;
        continue;
      }
      v.__ppCards = chosen;
      v.__ppJ = 0;
      v.__ppStage = 1;
      continue;
    }
    // stage 1: a Pokémon for each chosen card
    const cards = numsOf(v.__ppCards);
    let j = typeof v.__ppJ === 'number' ? v.__ppJ : 0;
    const attachTo = (card: number, slotId: number): void => {
      const sl = allSlots(ps).find((x) => x.id === slotId);
      if (!sl || !takeFromZones(ps, card)) return;
      if (effectsPrevented(env, s, sl, f.player, 'attack')) {
        ps.discard.push(card);
        emit(env, { type: 'discard', player: p, cards: [card] });
        return;
      }
      sl.energy.push(card);
      emit(env, { type: 'attach', player: p, card, slot: sl.id });
      v.__ppFired = [...numsOf(v.__ppFired), p, sl.id];
    };
    if (answer !== undefined) {
      const slotId = (answer as number[])[0];
      answer = undefined;
      if (slotId !== undefined) attachTo(cards[j] as number, slotId);
      j++;
    }
    while (j < cards.length) {
      const cands = allSlots(ps).filter((sl) => effectsPrevented(env, s, sl, f.player, 'attack') || canAttachFromHand(env, s, sl));
      if (!cands.length) {
        j = cards.length;
        break;
      }
      if (cands.length === 1) {
        attachTo(cards[j] as number, (cands[0] as { id: number }).id);
        j++;
        continue;
      }
      v.__ppJ = j;
      return ask(
        s,
        { player: p, kind: 'slots', prompt: `Attach ${def(env.ctx, cards[j] as number).name} to which Pokémon?`, min: 1, max: 1, values: cands.map((sl) => sl.id) },
        'slots',
      );
    }
    v.__ppI = i + 1;
    v.__ppStage = 0;
    delete v.__ppCards;
    delete v.__ppJ;
  }
});

/**
 * Mega Greninja ex, Ninja Spinner: "You may put a {W} Energy attached to this Pokémon into your hand..." (the move half)
 * args: { type, n } (n default 1). The controller picks `n` of this Pokémon's attached Energy cards that PROVIDE `type`
 * where they are attached -- Basic or Special, and an Energy that provides every type counts (Neo Upper Energy on a
 * Stage 2, Compendium #2385's example) -- and they go to the controller's hand, not the discard pile (all of them when
 * it has fewer; no question when the choices are identical).
 */
registerCustom('c09.energyToHand', (env, s, f, args, answer) => {
  const loc = findSlot(s, f.slot);
  if (!loc) return 'next';
  const n = Number(args.n ?? 1);
  const type = args.type as PType;
  const pool = loc.slot.energy.filter((c) => cardUnits(env, loc.slot, c).some((u) => u === type || u === 'Any'));
  if (!pool.length) return 'next';
  let chosen: number[];
  if (answer !== undefined) chosen = (answer as number[]).filter((c) => pool.includes(c));
  else if (pool.length <= n) chosen = pool.slice();
  else if (new Set(pool.map((c) => def(env.ctx, c).idx)).size === 1) chosen = pool.slice(0, n);
  else return ask(s, { player: f.player, kind: 'cards', prompt: `Put ${n} Energy into your hand`, min: n, max: n, values: pool }, 'cards');
  for (const c of chosen) {
    if (removeFrom(loc.slot.energy, c)) s.p[loc.owner].hand.push(c);
  }
  return 'next';
});
