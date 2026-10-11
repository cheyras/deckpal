/**
 * Bespoke effects for lane "metal" cards (see customs.ts for the contract).
 * Names are prefixed `metal.` so lanes can't collide. Each is exercised by a
 * card test in src/__tests__/cards-metal.test.ts.
 */
import { def, type Env } from '../../context.js';
import { registerCustom } from '../../customs.js';
import type { Filter } from '../../dsl.js';
import { defMatches } from '../../eval.js';
import { allSlots, emit, findSlot, takeFromZones } from '../../state.js';
import type { Decision, Frame, GameState, Player } from '../../types.js';

function matches(env: Env, c: number, f: Filter | undefined): boolean {
  return defMatches(def(env.ctx, c), f);
}

function ask(s: GameState, d: Decision, mode: 'cards' | 'slots'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}

function slotIds(f: Frame, key: string): number[] {
  const v = f.vars[key];
  return Array.isArray(v) ? v : typeof v === 'number' ? [v] : [];
}

/** Mega Skarmory ex, Sonic Ripper: "Shuffle all Energy attached to this Pokémon into your deck" (the program shuffles next). */
registerCustom('metal.energyToDeck', (env, s, f) => {
  const loc = findSlot(s, f.slot);
  if (!loc) return 'next';
  for (const c of loc.slot.energy.splice(0)) s.p[env.ctx.owner[c] as Player].deck.push(c);
  return 'next';
});

/**
 * Energy Switch: "Move a Basic Energy from 1 of your Pokémon to another of your Pokémon."
 * args: { from: var holding the source slot, filter: which attached Energy may move }.
 * Asks which Energy (only when the candidates differ) and then where to (only when there is a choice).
 */
registerCustom('metal.moveEnergy', (env, s, f, args, answer) => {
  const src = findSlot(s, slotIds(f, String(args.from))[0] ?? -1);
  if (!src) return 'next';
  const filter = args.filter as Filter | undefined;
  let card = f.vars.__mvE as number | undefined;
  if (card === undefined) {
    const pool = src.slot.energy.filter((c) => matches(env, c, filter));
    if (!pool.length) return 'next';
    if (answer !== undefined) card = (answer as number[])[0];
    else if (new Set(pool.map((c) => env.ctx.cardDef[c])).size === 1) card = pool[0];
    else {
      return ask(s, { player: f.player, kind: 'cards', prompt: 'Move which Energy?', min: 1, max: 1, values: pool }, 'cards');
    }
    f.vars.__mvE = card as number;
    answer = undefined;
  }
  const dests = allSlots(s.p[src.owner]).filter((x) => x.id !== src.slot.id);
  let to: number | undefined;
  if (answer !== undefined) to = (answer as number[])[0];
  else if (dests.length === 1) to = dests[0]!.id;
  else if (dests.length > 1) {
    return ask(
      s,
      { player: f.player, kind: 'slots', prompt: 'Move it to which Pokémon?', min: 1, max: 1, values: dests.map((x) => x.id) },
      'slots',
    );
  }
  delete f.vars.__mvE;
  const dst = dests.find((x) => x.id === to);
  if (!dst || card === undefined) return 'next';
  const i = src.slot.energy.indexOf(card);
  if (i < 0) return 'next';
  src.slot.energy.splice(i, 1);
  dst.energy.push(card);
  emit(env, { type: 'attach', player: src.owner, card, slot: dst.id });
  return 'next';
});

/**
 * Janine's Secret Art: "For each of those Pokémon, search your deck for a <filter> card and attach it to that Pokémon."
 * args: { slots: var of chosen slots, filter, hit: var to receive the slots that got a card }.
 * Also sets `activeHit` (1/0): whether the controller's Active Pokémon got one.
 * Every matching card has the same definition for the cards that use this (Basic Energy of one type), so the
 * engine takes them without asking; it always finds one when it can (the "may fail to find" option is not offered).
 */
registerCustom('metal.attachFromDeckToEach', (env, s, f, args) => {
  const ps = s.p[f.player];
  ps.prizesKnown = true; // the player looked through their deck
  const filter = args.filter as Filter | undefined;
  const hit: number[] = [];
  for (const id of slotIds(f, String(args.slots))) {
    const loc = findSlot(s, id);
    if (!loc || loc.owner !== f.player) continue;
    const c = ps.deck.find((x) => matches(env, x, filter));
    if (c === undefined) break;
    takeFromZones(ps, c);
    loc.slot.energy.push(c);
    emit(env, { type: 'attach', player: f.player, card: c, slot: id });
    hit.push(id);
  }
  f.vars[String(args.hit ?? 'hit')] = hit;
  f.vars.activeHit = ps.active && hit.includes(ps.active.id) ? 1 : 0;
  return 'next';
});

/**
 * Tool Scrapper: "Choose up to 2 Pokémon Tools attached to Pokémon (yours or your opponent's) and discard them."
 * args: { max }. Each Tool goes to its owner's discard pile. Labels name the Pokémon each Tool is on.
 */
registerCustom('metal.discardTools', (env, s, f, args, answer) => {
  const tools: number[] = [];
  const where: string[] = [];
  for (const p of [0, 1] as Player[]) {
    for (const sl of allSlots(s.p[p])) {
      for (const t of sl.tools) {
        tools.push(t);
        where.push(`${def(env.ctx, t).name} on ${p === f.player ? 'your' : "your opponent's"} ${def(env.ctx, sl.cards[sl.cards.length - 1] as number).name}`);
      }
    }
  }
  if (!tools.length) return 'next';
  let chosen: number[];
  if (answer !== undefined) chosen = answer as number[];
  else if (tools.length === 1) chosen = tools.slice();
  else {
    const max = Math.min(Number(args.max ?? 2), tools.length);
    return ask(s, { player: f.player, kind: 'cards', prompt: `Discard up to ${max} Pokémon Tools`, min: 1, max, values: tools, labels: where }, 'cards');
  }
  for (const c of chosen) {
    for (const p of [0, 1] as Player[]) {
      for (const sl of allSlots(s.p[p])) {
        const i = sl.tools.indexOf(c);
        if (i < 0) continue;
        sl.tools.splice(i, 1);
        const owner = env.ctx.owner[c] as Player;
        s.p[owner].discard.push(c);
        emit(env, { type: 'discard', player: owner, cards: [c] });
      }
    }
  }
  return 'next';
});
