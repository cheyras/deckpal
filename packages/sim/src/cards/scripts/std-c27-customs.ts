/**
 * Bespoke effects for the "std-c27" batch (std-c27.ts). Names are prefixed `c27.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c27.test.ts.
 *
 * A custom that asks a decision sets `s.pending` (the answer comes back as `answer`) and returns 'wait'.
 */
import { def, type Env } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter, SlotZone } from '../../dsl.js';
import { cardMatches, slotMatches, slotsIn } from '../../eval.js';
import { benchLimit } from '../../query.js';
import { allSlots, emit, findSlot, healSlot, newSlot, opp, rand, removeFrom, shuffleDeck, takeFromZones } from '../../state.js';
import type { Decision, GameState, Val } from '../../types.js';

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function cardsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}
/** True when every card in the pool is the same card (identical Energy need no question). */
function allSame(env: Env, pool: number[]): boolean {
  return new Set(pool.map((c) => def(env.ctx, c).idx)).size <= 1;
}

/**
 * Maushold, Familial March: "Search your deck for up to 2 in any combination of Maushold and Maushold ex and put them onto
 * your Bench. Then, shuffle your deck."
 * args: { names, max }. The Pokémon are put onto the Bench as they are, whatever their Stage (a Stage 1 put there this way
 * evolves nothing), as many as fit (up to `max`); the controller picks 0 to that many of the deck's Pokémon whose name is
 * listed. With a full Bench nothing happens (no search, no shuffle); otherwise the deck is shuffled.
 */
registerCustom('c27.searchToBench', (env, s, f, args, answer) => {
  const p = f.player;
  const ps = s.p[p];
  const space = benchLimit(env, s, p) - ps.bench.length;
  if (space <= 0) return 'next';
  const names = (args.names as string[]) ?? [];
  const max = Math.min(Number(args.max ?? 1), space);
  if (answer === undefined) {
    const opts = ps.deck.filter((c) => {
      const d = def(env.ctx, c);
      return d.kind === 'pokemon' && names.includes(d.name);
    });
    if (opts.length) {
      return ask(s, { player: p, kind: 'cards', prompt: `Put up to ${max} ${names.join(' or ')} onto your Bench`, min: 0, max: Math.min(max, opts.length), values: opts }, 'cards');
    }
    emit(env, { type: 'search', player: p, found: [] });
    shuffleDeck(env, s, p);
    return 'next';
  }
  const chosen = (answer as number[]).slice(0, max);
  emit(env, { type: 'search', player: p, found: chosen.slice() });
  for (const c of chosen) {
    if (ps.bench.length >= benchLimit(env, s, p) || !takeFromZones(ps, c)) continue;
    const sl = newSlot(s, c);
    ps.bench.push(sl);
    emit(env, { type: 'play_to_bench', player: p, card: c, slot: sl.id });
  }
  shuffleDeck(env, s, p);
  return 'next';
});

/**
 * Chill Teaser Toy: "Put an Energy attached to 1 of your opponent's Pokémon into their hand."
 * args: { slot } -- the Pokémon chosen into that variable. The controller picks which attached Energy card (no question when
 * the choices are identical); it goes to its owner's hand. Nothing happens when the Pokémon has no Energy.
 */
registerCustom('c27.slotEnergyToHand', (env, s, f, args, answer) => {
  const id = cardsOf(f.vars[String(args.slot ?? 't')])[0];
  const loc = id === undefined ? null : findSlot(s, id);
  if (!loc || !loc.slot.energy.length) return 'next';
  const pool = loc.slot.energy.slice();
  let card: number;
  if (answer !== undefined) card = (answer as number[])[0] as number;
  else if (allSame(env, pool)) card = pool[0] as number;
  else return ask(s, { player: f.player, kind: 'cards', prompt: "Put which of your opponent's Energy into their hand?", min: 1, max: 1, values: pool }, 'cards');
  if (!removeFrom(loc.slot.energy, card)) return 'next';
  s.p[loc.owner].hand.push(card);
  return 'next';
});

/**
 * Clemont's Quick Wit: "Heal 60 damage from each of your {L} Pokémon."
 * args: { amount, zone, filter } -- every Pokémon in the controller-relative zone that matches the filter loses that much
 * damage (to a floor of 0).
 */
registerCustom('c27.healEach', (env, s, f, args) => {
  const filter = args.filter as Filter | undefined;
  for (const sl of slotsIn(s, f.player, String(args.zone ?? 'myPokemon') as SlotZone)) {
    if (slotMatches(env, sl, filter)) healSlot(s, sl, Number(args.amount));
  }
  return 'next';
});

/**
 * Deduction Kit: "... or shuffle them and put them on the bottom of your deck."
 * args: { n } -- the top n cards of the controller's deck are shuffled among themselves (random order) and put on the bottom.
 */
registerCustom('c27.topToBottomShuffled', (env, s, f, args) => {
  const ps = s.p[f.player];
  const n = Math.min(Number(args.n ?? 3), ps.deck.length);
  if (n <= 0) return 'next';
  const top = ps.deck.splice(ps.deck.length - n, n);
  ps.knownTop = Math.max(0, ps.knownTop - n);
  for (let i = top.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s, f.player) * (i + 1));
    const t = top[i] as number;
    top[i] = top[j] as number;
    top[j] = t;
  }
  ps.deck.unshift(...top); // the bottom of the deck is index 0
  emit(env, { type: 'shuffle', player: f.player });
  return 'next';
});

/**
 * Drayton / Dusk Ball: "Look at the top 7 cards of your deck. You may reveal a Pokémon and a Trainer card you find there and
 * put them into your hand. Shuffle the other cards back into your deck." / "Look at the bottom 7 cards of your deck. You may
 * reveal a Pokémon you find there and put it into your hand. Shuffle the other cards back into your deck."
 * args: { from: 'top' | 'bottom', n, picks: Filter[] }. Looks at that many cards from that end of the deck. For each filter in
 * `picks`, in order, the controller may choose 1 of the looked-at cards that match it (not one already chosen; 0 is allowed,
 * no question when none matches). The chosen cards are revealed and go to the hand; then the whole deck is shuffled.
 */
registerCustom('c27.lookDeckPick', (env, s, f, args, answer) => {
  const p = f.player;
  const ps = s.p[p];
  const V = f.vars as Record<string, unknown>;
  const picks = (args.picks as Filter[]) ?? [];
  const n = Number(args.n ?? 7);
  const look = args.from === 'bottom' ? ps.deck.slice(0, n) : ps.deck.slice(Math.max(0, ps.deck.length - n)).reverse();
  let i = (V.__c27i as number | undefined) ?? 0;
  const got = ((V.__c27got as number[] | undefined) ?? []).slice();
  if (answer !== undefined) {
    const c = (answer as number[])[0];
    if (c !== undefined && look.includes(c) && !got.includes(c) && cardMatches(env, c, picks[i])) got.push(c);
    i++;
  }
  for (; i < picks.length; i++) {
    const opts = look.filter((c) => !got.includes(c) && cardMatches(env, c, picks[i]));
    if (!opts.length) continue;
    V.__c27i = i;
    V.__c27got = got;
    const what = picks[i]?.cat === 'trainer' ? 'a Trainer card' : picks[i]?.cat === 'pokemon' ? 'a Pokémon' : 'a card';
    return ask(s, { player: p, kind: 'cards', prompt: `You may reveal ${what} you find there and put it into your hand`, min: 0, max: 1, values: opts }, 'cards');
  }
  delete V.__c27i;
  delete V.__c27got;
  for (const c of got) {
    if (!takeFromZones(ps, c)) continue;
    ps.hand.push(c);
    ps.revealed.push(c);
  }
  emit(env, { type: 'search', player: p, found: got.slice() });
  shuffleDeck(env, s, p);
  return 'next';
});

/**
 * Megaton Blower: "Discard all Pokémon Tools and Special Energy from all of your opponent's Pokémon."
 * Every Pokémon Tool and every Special Energy card attached to any of the controller's opponent's Pokémon (Active and Benched)
 * goes to its owner's discard pile.
 */
registerCustom('c27.discardOppToolsAndSpecialEnergy', (env, s, f) => {
  const o = opp(f.player);
  const gone: number[] = [];
  for (const sl of allSlots(s.p[o])) {
    gone.push(...sl.tools.splice(0));
    for (const c of sl.energy.slice()) {
      if (cardMatches(env, c, { cat: 'energy', basicEnergy: false }) && removeFrom(sl.energy, c)) gone.push(c);
    }
  }
  if (gone.length) {
    s.p[o].discard.push(...gone);
    emit(env, { type: 'discard', player: o, cards: gone });
  }
  return 'next';
});

/**
 * Scramble Switch: "... you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon."
 * args: { from, to } -- the Pokémon chosen into those variables. The controller picks 1 or more of the Energy cards attached to
 * `from` (nothing happens when it has none); they move to `to`.
 */
registerCustom('c27.moveEnergyBetween', (env, s, f, args, answer) => {
  const from = findSlot(s, cardsOf(f.vars[String(args.from ?? 'old')])[0] ?? -1);
  const to = findSlot(s, cardsOf(f.vars[String(args.to ?? 't')])[0] ?? -1);
  if (!from || !to || !from.slot.energy.length) return 'next';
  if (answer === undefined) {
    const pool = from.slot.energy.slice();
    return ask(s, { player: f.player, kind: 'cards', prompt: 'Move any amount of Energy to the new Active Pokémon', min: 1, max: pool.length, values: pool }, 'cards');
  }
  for (const c of answer as number[]) {
    if (!removeFrom(from.slot.energy, c)) continue;
    to.slot.energy.push(c);
    emit(env, { type: 'attach', player: f.player, card: c, slot: to.slot.id });
  }
  return 'next';
});
