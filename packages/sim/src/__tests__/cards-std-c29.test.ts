/**
 * Card tests, batch "std-c29": every card scripted in cards/scripts/std-c29.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { Decision, Slot } from '../types.js';
import { ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED } from '../types.js';
import { fromIds } from './decks.js';

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function has(g: Game, text: string): boolean {
  return labels(g).some((l) => l.includes(text));
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
/** Pick options of a multi-select by card/slot name (each name once, in order). */
function pick(g: Game, ns: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = ns.map((n) => {
    const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
    assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
    used.add(i);
    return i;
  });
  g.submit(idx);
}
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([1]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const countIn = (g: Game, cards: number[], nm: string): number => cards.filter((c) => name(g, c) === nm).length;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy. */
function deck(...ids: string[]): DeckInput {
  return fromIds('c29', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const ALL = [
  'sv08.5-115', 'sv08.5-116', 'sv08.5-127', 'sv08.5-131', 'sv09-003', 'sv09-004', 'sv09-005', 'sv09-008', 'sv09-011',
  'sv09-012', 'sv09-013', 'sv09-014', 'sv09-017', 'sv09-018', 'sv09-020', 'sv09-034', 'sv09-042', 'sv09-043', 'sv09-047', 'sv09-048',
];
const DRA_ID = 'sv06-130'; // Dragapult ex: Tera, Stage 2, Dragon, 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const DRA = 'Dragapult ex';
const SLO_ID = 'me05-029'; // Slowpoke: Basic Psychic 70 HP, weak Darkness; Headbutt {C}{C} 20; retreat 2
const SLO = 'Slowpoke';
const REL_ID = 'sv08-013'; // Rellor: Basic Grass 40 HP, weak Fire
const REL = 'Rellor';
const LUNA_ID = 'me01-074'; // Lunatone: Basic, weak Grass
const LIL = "Lillie's Determination"; // a Supporter
const BOSS = "Boss's Orders"; // a Supporter
const MEOWTH_ID = 'me03-062'; // Meowth ex: Tuck Tail {C}{C}{C} 60, then it goes to its owner's hand
const COMMON = [DRA_ID, SLO_ID, REL_ID, LUNA_ID, MEOWTH_ID, 'me01-119', 'me01-114', 'me01-131', 'sv10.5b-079', 'sv05-151', 'sv06-167'];
const DK = deck(...ALL, ...COMMON);
const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const LEGACY = 'Legacy Energy'; // a Special Energy card that provides every type
type Sides = [SideLayout, SideLayout];
const game = (sides: Sides, o: Parameters<typeof scenario>[3] = {}): Game => scenario(DK, DK, sides, o);
const OPP_TURN = { current: 1 as const, turn: 4 };
function pickSlot(g: Game, sl: Slot): void {
  const values = (g.decision as unknown as { values: number[] }).values;
  const i = values.indexOf(sl.id);
  assert.ok(i >= 0, `slot ${sl.id} is not offered: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
void pickSlot;

// ------------------------------------------------------------------ Larry's Skill

test("Larry's Skill: discard your hand, then search for a Pokémon, a Supporter and a Basic Energy card, reveal them, into your hand", () => {
  const g = game([{ hand: ["Larry's Skill", REL, SLO, 'Ultra Ball'], active: DRA }, { active: DRA }], { events: true });
  choose(g, "Play Larry's Skill");
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === REL) && g.state.p[0].discard.some((c) => name(g, c) === SLO), 'the hand was discarded');
  assert.ok(g.state.p[0].discard.some((c) => name(g, c) === 'Ultra Ball'));
  assert.equal(g.state.p[0].hand.length, 0, 'nothing is left in the hand before the search');
  // One optional pick per kind, in order: a Pokémon, a Supporter card, a Basic Energy card.
  choose(g, 'Lunatone');
  assert.ok(!labels(g).some((l) => l.includes('Lunatone') || l.includes('Energy')), 'only Supporter cards are offered next');
  choose(g, BOSS);
  assert.ok(labels(g).every((l) => l.includes('Energy')), 'only Basic Energy cards are offered last');
  choose(g, 'Lightning Energy');
  const hand = g.state.p[0].hand;
  assert.deepEqual(names(g, hand), [BOSS, 'Lightning Energy', 'Lunatone'].sort());
  assert.ok(g.events.some((e) => e.type === 'shuffle' && (e as { player: number }).player === 0), 'then the deck is shuffled');
});

test("Larry's Skill: playable with an empty deck while the hand holds another card; not with an empty deck and an empty hand", () => {
  const empty = game([{ hand: ["Larry's Skill", REL], active: DRA, emptyDeck: true }, { active: DRA }]);
  assert.ok(has(empty, "Play Larry's Skill"), 'discarding the hand is an effect');
  const nothing = game([{ hand: ["Larry's Skill"], active: DRA, emptyDeck: true }, { active: DRA }]);
  assert.ok(!has(nothing, "Play Larry's Skill"), 'it would do nothing');
  const lone = game([{ hand: ["Larry's Skill"], active: DRA }, { active: DRA }]);
  assert.ok(has(lone, "Play Larry's Skill"), 'a deck to search is enough');
});

// ------------------------------------------------------------------ Max Rod

test('Max Rod: put up to 5 Pokémon and Basic Energy cards in any combination from the discard pile into your hand', () => {
  const g = game([{ hand: ['Max Rod'], discard: [REL, SLO, G, F, W, 'Ultra Ball', LIL], active: DRA }, { active: DRA }]);
  choose(g, 'Play Max Rod');
  assert.ok(!labels(g).some((l) => l.includes('Ultra Ball') || l.includes(LIL)), 'only Pokémon and Basic Energy cards are offered');
  pick(g, [REL, SLO, G, F, W]);
  assert.deepEqual(names(g, g.state.p[0].hand), [F, G, REL, SLO, W].sort());
  assert.deepEqual(names(g, g.state.p[0].discard.filter((c) => name(g, c) !== 'Max Rod')), ['Ultra Ball', LIL].sort());
});

test('Max Rod: up to 5 means 5 at most (the sixth stays), and it can not be played with nothing to take', () => {
  const g = game([{ hand: ['Max Rod'], discard: [REL, SLO, G, F, W, P, L], active: DRA }, { active: DRA }]);
  choose(g, 'Play Max Rod');
  pick(g, [REL, SLO, G, F, W]);
  assert.equal(g.state.p[0].hand.length, 5);
  assert.equal(g.state.p[0].discard.filter((c) => [P, L].includes(name(g, c))).length, 2);
  const bare = game([{ hand: ['Max Rod'], discard: ['Ultra Ball', LIL], active: DRA }, { active: DRA }]);
  assert.ok(!has(bare, 'Play Max Rod'), 'no Pokémon or Basic Energy card in the discard pile');
});

// ------------------------------------------------------------------ Roto-Stick

test('Roto-Stick: look at the top 4, reveal any number of Supporter cards into your hand, shuffle the rest back', () => {
  const g = game([{ hand: ['Roto-Stick'], active: DRA, deckTop: [LIL, REL, BOSS, SLO] }, { active: DRA }], { events: true });
  const before = g.state.p[0].deck.length;
  choose(g, 'Play Roto-Stick');
  pick(g, [LIL, BOSS]);
  assert.deepEqual(names(g, g.state.p[0].hand), [BOSS, LIL].sort());
  assert.equal(g.state.p[0].deck.length, before - 2);
  assert.ok(g.state.p[0].deck.some((c) => name(g, c) === REL) && g.state.p[0].deck.some((c) => name(g, c) === SLO), 'the other cards went back into the deck');
  assert.ok(g.events.some((e) => e.type === 'shuffle' && (e as { player: number }).player === 0));
});

test('Roto-Stick: you may take none, and only Supporter cards are offered', () => {
  const g = game([{ hand: ['Roto-Stick'], active: DRA, deckTop: [LIL, REL, 'Ultra Ball', SLO] }, { active: DRA }]);
  choose(g, 'Play Roto-Stick');
  assert.ok(!labels(g).some((l) => l.includes('Ultra Ball') || l.includes(REL)));
  g.submit([]);
  assert.equal(g.state.p[0].hand.length, 0);
});

test('Roto-Stick: four Supporter cards all put into the hand, the deck is still shuffled (Compendium #2377)', () => {
  // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2377/): "Yes, the deck is shuffled."
  const g = game([{ hand: ['Roto-Stick'], active: DRA, deckTop: [LIL, BOSS, LIL, BOSS] }, { active: DRA }], { events: true });
  choose(g, 'Play Roto-Stick');
  pick(g, [LIL, BOSS, LIL, BOSS]);
  assert.equal(g.state.p[0].hand.length, 4);
  const search = g.events.findIndex((e) => e.type === 'search');
  assert.ok(g.events.findIndex((e, i) => i > search && e.type === 'shuffle' && (e as { player: number }).player === 0) > search, 'shuffled although no looked-at card stayed');
});

test('Roto-Stick: can not be played with an empty deck', () => {
  const g = game([{ hand: ['Roto-Stick'], active: DRA, emptyDeck: true }, { active: DRA }]);
  assert.ok(!has(g, 'Play Roto-Stick'));
});

// ------------------------------------------------------------------ Treasure Tracker

test('Treasure Tracker: search for up to 5 Pokémon Tool cards, reveal them, into your hand, shuffle', () => {
  const g = game([{ hand: ['Treasure Tracker'], active: DRA }, { active: DRA }], { events: true });
  choose(g, 'Play Treasure Tracker');
  assert.ok(!labels(g).some((l) => l.includes(LIL) || l.includes(G)), 'only Tools are offered');
  pick(g, ['Air Balloon', 'Air Balloon', 'Air Balloon', 'Heavy Baton', 'Heavy Baton']);
  assert.equal(g.state.p[0].hand.length, 5);
  assert.equal(countIn(g, g.state.p[0].hand, 'Air Balloon'), 3);
  assert.equal(countIn(g, g.state.p[0].hand, 'Heavy Baton'), 2);
  assert.ok(g.events.some((e) => e.type === 'shuffle' && (e as { player: number }).player === 0));
});

// ------------------------------------------------------------------ Butterfree

test('Butterfree, Scale Hurricane: flip 4 coins, 60 for each heads; Paralyzed with at least 2 heads', () => {
  const run = (coins: boolean[]): Game => {
    const g = game([{ active: 'Butterfree', energy: { active: [G] } }, { active: DRA }]);
    g.state.forcedCoins = coins.slice();
    choose(g, 'Attack: Scale Hurricane');
    return g;
  };
  const four = run([true, true, true, true]);
  assert.equal(dmg(four, 1), 240);
  assert.ok(four.state.p[1].active!.cond & PARALYZED);
  const two = run([true, false, true, false]);
  assert.equal(dmg(two, 1), 120);
  assert.ok(two.state.p[1].active!.cond & PARALYZED, 'exactly 2 heads is enough');
  const one = run([false, true, false, false]);
  assert.equal(dmg(one, 1), 60);
  assert.equal(one.state.p[1].active!.cond & PARALYZED, 0, 'one heads: no Paralysis');
  const none = run([false, false, false, false]);
  assert.equal(dmg(none, 1), 0);
  assert.equal(none.state.p[1].active!.cond & PARALYZED, 0);
});

// ------------------------------------------------------------------ Paras

test('Paras, Leech Life: heal from this Pokémon the same amount of damage you did to the Defending Pokémon', () => {
  const g = game([{ active: 'Paras', energy: { active: [G] }, damage: { active: 30 } }, { active: DRA, damage: { active: 100 } }]);
  choose(g, 'Attack: Leech Life');
  assert.equal(dmg(g, 1), 110);
  assert.equal(dmg(g, 0), 20, 'healed 10, not the damage already on the Defending Pokémon');
  // After Weakness: Lunatone is weak to {G}, so the attack does 20 and heals 20.
  const weak = game([{ active: 'Paras', energy: { active: [G] }, damage: { active: 30 } }, { active: 'Lunatone' }]);
  choose(weak, 'Attack: Leech Life');
  assert.equal(dmg(weak, 1), 20);
  assert.equal(dmg(weak, 0), 10);
});

// ------------------------------------------------------------------ Parasect

test('Parasect, Spore: the opponent\'s Active Pokémon is now Asleep', () => {
  const g = game([{ active: 'Parasect', energy: { active: [G] } }, { active: DRA }]);
  g.state.forcedCoins = [false]; // Checkup: tails, it stays Asleep
  choose(g, 'Attack: Spore');
  assert.ok(g.state.p[1].active!.cond & ASLEEP);
  assert.equal(dmg(g, 1), 0);
});

test('Parasect, Scissor Swing: 60, flip 2 coins, 30 more for each heads', () => {
  const run = (coins: boolean[]): number => {
    const g = game([{ active: 'Parasect', energy: { active: [G, G] } }, { active: DRA }]);
    g.state.forcedCoins = coins.slice();
    choose(g, 'Attack: Scissor Swing');
    return dmg(g, 1);
  };
  assert.equal(run([true, true]), 120);
  assert.equal(run([true, false]), 90);
  assert.equal(run([false, false]), 60);
});

// ------------------------------------------------------------------ Maractus

test("Maractus, Corner: 20, and during the opponent's next turn the Defending Pokémon can't retreat", () => {
  const g = game([{ active: 'Maractus', energy: { active: [G] } }, { active: DRA, bench: [REL], energy: { active: [P] } }]);
  choose(g, 'Attack: Corner');
  assert.equal(dmg(g, 1), 20);
  assert.ok(has(g, 'Attack: Jet Headbutt'));
  assert.ok(!has(g, 'Retreat'), "the Defending Pokémon can't retreat during the opponent's next turn");
});

test("Maractus, Exploding Needles: Active and Knocked Out by damage from an attack, 6 damage counters on the Attacking Pokémon", () => {
  const g = game(
    [{ active: 'Maractus', bench: [REL], damage: { active: 60 } }, { active: DRA, energy: { active: [P] } }],
    OPP_TURN,
  );
  choose(g, 'Attack: Jet Headbutt'); // 70 on 60 damage: 130 on 110 HP
  assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === 'Maractus').length, 1, 'Maractus was Knocked Out');
  assert.equal(dmg(g, 1), 60, '6 damage counters on the Attacking Pokémon');
});

test("Maractus, Exploding Needles: not while Benched, and not when it is not Knocked Out", () => {
  // A Benched Maractus Knocked Out by Regice's Blizzard (10 to each Benched Pokémon): no counters.
  const benched = game(
    [{ active: 'Regice', energy: { active: [W, W, W] } }, { active: DRA, bench: ['Maractus'], damage: { 0: 100 } }],
  );
  choose(benched, 'Attack: Blizzard');
  assert.equal(benched.state.p[1].discard.filter((c) => name(benched, c) === 'Maractus').length, 1, 'the Benched Maractus was Knocked Out');
  assert.equal(dmg(benched, 0), 0, 'not in the Active Spot: no counters');
  // Active but surviving: nothing happens.
  const survive = game([{ active: 'Maractus', bench: [REL] }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(survive, 'Attack: Jet Headbutt');
  assert.equal(dmg(survive, 1), 0);
  assert.equal(dmg(survive, 0), 70);
});

test('Maractus, Exploding Needles: the Pokémon that used the attack gets the counters even after it switched out; none if it has left play (Compendium #2106)', () => {
  // Accelgor's Poisonous Ploy switches the attacker with a Benched Pokémon before Knock Outs are checked.
  const sw = game(
    [{ active: 'Maractus', bench: [REL], damage: { active: 60 } }, { active: 'Accelgor', bench: [SLO], energy: { active: [G, G] } }],
    OPP_TURN,
  );
  choose(sw, 'Attack: Poisonous Ploy'); // 70 on 60 damage: Knocked Out
  const accelgor = sw.state.p[1].bench.find((b) => name(sw, b.cards[0]!) === 'Accelgor') ?? sw.state.p[1].active!;
  assert.equal(name(sw, accelgor.cards[0]!), 'Accelgor');
  assert.equal(accelgor.damage, 60, 'the Attacking Pokémon, now on the Bench');
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2106/): "No, Lillie's Comfey would go to the hand first
  // and then Exploding Needles would be triggered and find no valid target." The same shape: Meowth ex's Tuck Tail does damage, then goes to the hand.
  const tuck = game(
    [{ active: 'Maractus', bench: [REL], damage: { active: 60 } }, { active: 'Meowth ex', bench: [SLO], damage: { active: 120 }, energy: { active: [G, G, G] } }],
    OPP_TURN,
  );
  choose(tuck, 'Attack: Tuck Tail'); // 60 on 60 damage: Knocked Out
  assert.equal(tuck.state.p[0].discard.filter((c) => name(tuck, c) === 'Maractus').length, 1);
  assert.equal(countIn(tuck, tuck.state.p[1].hand, 'Meowth ex'), 1, 'Meowth ex went to the hand');
  assert.equal(tuck.state.p[1].discard.filter((c) => name(tuck, c) === 'Meowth ex').length, 0, 'and was not Knocked Out by the 6 counters');
});

// ------------------------------------------------------------------ Amoonguss ex

test("Amoonguss ex, Spore Ball: 30, and the opponent's Active Pokémon is now Asleep", () => {
  const g = game([{ active: 'Amoonguss ex', energy: { active: [G] } }, { active: DRA }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Spore Ball');
  assert.equal(dmg(g, 1), 30);
  assert.ok(g.state.p[1].active!.cond & ASLEEP);
});

test("Amoonguss ex, Champignon's Swing: 100, 80 more if the flip is heads", () => {
  const run = (heads: boolean): number => {
    const g = game([{ active: 'Amoonguss ex', energy: { active: [G, G] } }, { active: DRA }]);
    g.state.forcedCoins = [heads];
    choose(g, "Attack: Champignon's Swing");
    return dmg(g, 1);
  };
  assert.equal(run(true), 180);
  assert.equal(run(false), 100);
});

// ------------------------------------------------------------------ Shelmet

test("Shelmet, Shell Smack: 20; on heads, prevent all damage done to Shelmet by attacks during the opponent's next turn", () => {
  const run = (heads: boolean): Game => {
    const g = game([{ active: 'Shelmet', energy: { active: [G, G] } }, { active: DRA, energy: { active: [P] } }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Shell Smack');
    assert.equal(dmg(g, 1), 20);
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  assert.equal(dmg(run(true), 0), 0, 'heads: the 70 damage is prevented');
  const tails = run(false);
  assert.equal(tails.state.p[0].discard.filter((c) => name(tails, c) === 'Shelmet').length, 1, 'tails: no protection, the 70 damage Knocks Out Shelmet (70 HP)');
});

// ------------------------------------------------------------------ Accelgor

test('Accelgor, Poisonous Ploy: 70, the Defending Pokémon is Confused and Poisoned, then switch this Pokémon with a Benched Pokémon', () => {
  const g = game([{ active: 'Accelgor', bench: [REL], energy: { active: [G, G] } }, { active: DRA }]);
  choose(g, 'Attack: Poisonous Ploy');
  assert.equal(dmg(g, 1), 80, '70 + 10 for Poison at Checkup');
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
  assert.ok(g.state.p[1].active!.cond & POISONED);
  assert.equal(name(g, g.state.p[0].active!.cards[0]!), REL, 'Rellor is now Active');
  assert.equal(g.state.p[0].bench.filter((b) => name(g, b.cards[0]!) === 'Accelgor').length, 1);
  // Nothing to switch with: the rest of the attack still happens.
  const lone = game([{ active: 'Accelgor', energy: { active: [G, G] } }, { active: DRA }]);
  choose(lone, 'Attack: Poisonous Ploy');
  assert.ok(lone.state.p[1].active!.cond & CONFUSED);
  assert.equal(name(lone, lone.state.p[0].active!.cards[0]!), 'Accelgor');
});

// ------------------------------------------------------------------ Durant

test('Durant, Crunch: 50; on heads discard an Energy from the opponent\'s Active Pokémon, on tails nothing', () => {
  const run = (heads: boolean): Game => {
    const g = game([{ active: 'Durant', energy: { active: [G, G] } }, { active: DRA, energy: { active: [P, W] } }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Crunch');
    return g;
  };
  const h = run(true);
  assert.equal(dmg(h, 1), 50);
  choose(h, 'Water Energy');
  assert.deepEqual(names(h, h.state.p[1].active!.energy), [P]);
  assert.equal(h.state.p[1].discard.filter((c) => name(h, c) === W).length, 1);
  const t = run(false);
  assert.equal(dmg(t, 1), 50);
  assert.equal(t.state.p[1].active!.energy.length, 2);
});

// ------------------------------------------------------------------ Floragato

test('Floragato, Magical Leaf: 30; on heads 30 more and heal 30 damage from this Pokémon', () => {
  const run = (heads: boolean): Game => {
    const g = game([{ active: 'Floragato', energy: { active: [G, G] }, damage: { active: 50 } }, { active: DRA }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Magical Leaf');
    return g;
  };
  const h = run(true);
  assert.equal(dmg(h, 1), 60);
  assert.equal(dmg(h, 0), 20);
  const t = run(false);
  assert.equal(dmg(t, 1), 30);
  assert.equal(dmg(t, 0), 50, 'tails: no healing');
});

// ------------------------------------------------------------------ Meowscarada

test('Meowscarada, Rising Bloom: 90, or 90 more against a Pokémon ex', () => {
  const ex = game([{ active: 'Meowscarada', energy: { active: [G, G] } }, { active: DRA }]);
  choose(ex, 'Attack: Rising Bloom');
  assert.equal(dmg(ex, 1), 180);
  const plain = game([{ active: 'Meowscarada', energy: { active: [G, G] } }, { active: 'Regice' }]);
  choose(plain, 'Attack: Rising Bloom');
  assert.equal(dmg(plain, 1), 90);
});

test('Meowscarada, Showtime: once during your turn, if it is on your Bench, switch it with your Active Pokémon', () => {
  const g = game([{ active: DRA, bench: ['Meowscarada', REL] }, { active: DRA }]);
  choose(g, 'Use Showtime');
  assert.equal(name(g, g.state.p[0].active!.cards[0]!), 'Meowscarada');
  assert.ok(g.state.p[0].bench.some((b) => name(g, b.cards[0]!) === DRA));
  assert.ok(!has(g, 'Use Showtime'), 'it is Active now (and the Ability was used)');
  // Once per turn: a second Meowscarada on the Bench still can use its own copy, but this one can't be used again.
  const active = game([{ active: 'Meowscarada', bench: [REL] }, { active: DRA }]);
  assert.ok(!has(active, 'Use Showtime'), 'not usable while it is the Active Pokémon');
});

// ------------------------------------------------------------------ Magmar

test("Magmar, Searing Flame: 30; flip a coin, if heads the opponent's Active Pokémon is now Burned", () => {
  const h = game([{ active: 'Magmar', energy: { active: [F, F] } }, { active: DRA }]);
  h.state.forcedCoins = [true, false]; // attack flip, then the Burn flip at Checkup (tails: stays Burned)
  choose(h, 'Attack: Searing Flame');
  assert.ok(h.state.p[1].active!.cond & BURNED);
  assert.equal(dmg(h, 1), 50, '30 + 20 for Burn');
  const t = game([{ active: 'Magmar', energy: { active: [F, F] } }, { active: DRA }]);
  t.state.forcedCoins = [false];
  choose(t, 'Attack: Searing Flame');
  assert.equal(t.state.p[1].active!.cond & BURNED, 0);
  assert.equal(dmg(t, 1), 30);
});

// ------------------------------------------------------------------ Octillery

test("Octillery, Aqua Wash: 20, and you may put an Energy attached to the opponent's Active Pokémon into their hand", () => {
  const g = game([{ active: 'Octillery', energy: { active: [W] } }, { active: DRA, energy: { active: [P, F] } }]);
  choose(g, 'Attack: Aqua Wash');
  assert.equal(dmg(g, 1), 20);
  yes(g);
  choose(g, 'Fire Energy');
  assert.deepEqual(names(g, g.state.p[1].active!.energy), [P]);
  assert.equal(countIn(g, g.state.p[1].hand, F), 1, 'into their hand, not the discard pile');
  assert.equal(g.state.p[1].discard.filter((c) => name(g, c) === F).length, 0);
  const declined = game([{ active: 'Octillery', energy: { active: [W] } }, { active: DRA, energy: { active: [P, F] } }]);
  choose(declined, 'Attack: Aqua Wash');
  no(declined);
  assert.equal(declined.state.p[1].active!.energy.length, 2);
  const bare = game([{ active: 'Octillery', energy: { active: [W] } }, { active: DRA }]);
  choose(bare, 'Attack: Aqua Wash');
  assert.equal(dmg(bare, 1), 20, 'no Energy to put into their hand: no question');
  assert.equal(bare.state.current, 1);
});

test('Octillery, Octo Beatdown: flip a coin until you get tails, 90 for each heads', () => {
  const run = (coins: boolean[]): number => {
    const g = game([{ active: 'Octillery', energy: { active: [W, W, W] } }, { active: DRA }]);
    g.state.forcedCoins = coins.slice();
    choose(g, 'Attack: Octo Beatdown');
    return dmg(g, 1);
  };
  assert.equal(run([true, true, false]), 180);
  assert.equal(run([true, false]), 90);
  assert.equal(run([false]), 0);
});

// ------------------------------------------------------------------ Regice

test('Regice, Blizzard: 90, and 10 damage to each of the opponent\'s Benched Pokémon (no Weakness)', () => {
  const g = game([{ active: 'Regice', energy: { active: [W, W, W] } }, { active: DRA, bench: ['Magmar', REL] }]);
  choose(g, 'Attack: Blizzard');
  assert.equal(dmg(g, 1), 90);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [10, 10], "Magmar is weak to {W}, but a Benched Pokémon takes no Weakness");
  const mine = game([{ active: 'Regice', bench: [REL], energy: { active: [W, W, W] } }, { active: DRA }]);
  choose(mine, 'Attack: Blizzard');
  assert.equal(mine.state.p[0].bench[0]!.damage, 0, 'my own Bench is untouched');
});

// ------------------------------------------------------------------ Veluza ex

test('Veluza ex, Purging Strike: 120; you may discard your hand, and if you did, 120 more', () => {
  const g = game([{ active: 'Veluza ex', hand: [REL, SLO, LIL], energy: { active: [W, W, W] } }, { active: DRA }]);
  choose(g, 'Attack: Purging Strike');
  yes(g);
  assert.equal(dmg(g, 1), 240);
  assert.equal(g.state.p[0].hand.length, 0);
  assert.equal(g.state.p[0].discard.length, 3);
  const declined = game([{ active: 'Veluza ex', hand: [REL, SLO], energy: { active: [W, W, W] } }, { active: DRA }]);
  choose(declined, 'Attack: Purging Strike');
  no(declined);
  assert.equal(dmg(declined, 1), 120);
  assert.equal(declined.state.p[0].hand.length, 2);
  const empty = game([{ active: 'Veluza ex', energy: { active: [W, W, W] } }, { active: DRA }]);
  choose(empty, 'Attack: Purging Strike');
  assert.equal(dmg(empty, 1), 120, 'an empty hand: nothing discarded, no bonus, no question');
  assert.equal(empty.state.current, 1);
});

// ------------------------------------------------------------------ Iono's Voltorb

test("Iono's Voltorb, Voltaic Chain: 20, and 20 more for each {L} Energy attached to all of your Iono's Pokémon", () => {
  const g = game([
    {
      active: "Iono's Voltorb",
      bench: ["Iono's Electrode", REL],
      energy: { active: [L, L, F], 0: [L], 1: [L] },
    },
    { active: DRA },
  ]);
  choose(g, 'Attack: Voltaic Chain');
  assert.equal(dmg(g, 1), 80, '20 + 3 x 20: two on Voltorb and one on Electrode; Rellor is not an Iono\'s Pokémon, the {F} Energy is not {L}');
  const bare = game([{ active: "Iono's Voltorb", energy: { active: [F, F] } }, { active: DRA }]);
  choose(bare, 'Attack: Voltaic Chain');
  assert.equal(dmg(bare, 1), 20);
});

test("Iono's Voltorb, Voltaic Chain: an Energy that provides every type counts, the opponent's Iono's Pokémon do not (Compendium #2119)", () => {
  // Ruling (Journey Together FAQ, TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2119/): "Yes. The attack does not specify that it has to be
  // Basic {L} Energy, so Luminous Energy will count while it is attached to one of Iono's Pokemon." Legacy Energy is the same kind of Energy in this catalog.
  const g = game([
    { active: "Iono's Voltorb", bench: ["Iono's Electrode"], energy: { active: [L, F], 0: [LEGACY] } },
    { active: DRA, bench: ["Iono's Voltorb"], energy: { 0: [L, L] } },
  ]);
  choose(g, 'Attack: Voltaic Chain');
  assert.equal(dmg(g, 1), 60, '20 + one {L} + the Legacy Energy');
});

// ------------------------------------------------------------------ Iono's Electrode

test("Iono's Electrode, Thump-Thump Boom: 100 damage to itself; on heads the opponent's Active Pokémon is Knocked Out", () => {
  const g = game([
    { active: "Iono's Electrode", bench: [REL], energy: { active: [L, L] } },
    { active: DRA, bench: [SLO] },
  ]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Thump-Thump Boom');
  assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === "Iono's Electrode").length, 1, 'it Knocked itself Out (100 HP)');
  assert.equal(g.state.p[1].discard.filter((c) => name(g, c) === DRA).length, 1, 'heads: Dragapult ex was Knocked Out');
  assert.equal(g.state.p[0].prizes.length, 4, 'the owner of Electrode took 2 Prizes for the ex');
  assert.equal(g.state.p[1].prizes.length, 5, 'and the opponent 1 for Electrode');
});

test("Iono's Electrode, Thump-Thump Boom: tails, only Electrode takes the 100 damage", () => {
  const g = game([
    { active: "Iono's Electrode", bench: [REL], energy: { active: [L, L] }, damage: { active: 0 } },
    { active: DRA, bench: [SLO] },
  ]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Thump-Thump Boom');
  assert.equal(dmg(g, 1), 0);
  assert.equal(g.state.p[1].discard.filter((c) => name(g, c) === DRA).length, 0);
  assert.equal(g.state.p[0].discard.filter((c) => name(g, c) === "Iono's Electrode").length, 1);
});
