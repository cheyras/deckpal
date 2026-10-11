/**
 * Card tests, batch "std-30d": every card scripted in cards/scripts/std-30d.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { maxHp } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { ASLEEP, POISONED, type Decision } from '../types.js';
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
function pick(g: Game, names: string[]): void {
  const ls = labels(g);
  const used = new Set<number>();
  const idx = names.map((n) => {
    const i = ls.findIndex((l, j) => !used.has(j) && l.includes(n));
    assert.ok(i >= 0, `no option "${n}" in: ${ls.join(' | ')}`);
    used.add(i);
    return i;
  });
  g.submit(idx);
}
/** Pick when the engine is asking for cards (it may skip a question with only one answer). */
function maybePick(g: Game, names: string[]): void {
  if (g.decision?.kind === 'cards' || g.decision?.kind === 'slots') pick(g, names);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const endTurn = (g: Game): void => choose(g, 'End turn');
/** The engine's own order for effects at the same time (the first option) when the player is asked which goes first. */
const ord = (g: Game): void => {
  if (g.decision?.prompt === 'Which effect happens first?') g.submit([0]);
};
const dmg = (g: Game, p: 0 | 1, where: 'active' | number = 'active'): number =>
  (where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!).damage;
const energyOf = (g: Game, p: 0 | 1, where: 'active' | number = 'active'): string[] =>
  namesOf(g, (where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!).energy);

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 20]);
const IDS: Record<string, string> = {
  Gholdengo: '30th-108',
  'Salamence ex': '30th-109',
  'Jangmo-o': '30th-110',
  Meowth: '30th-113',
  Ditto: '30th-115',
  Eevee: '30th-116',
  Snorlax: '30th-119',
  Igglybuff: '30th-120',
  Lugia: '30th-121',
  Minior: '30th-124',
  Maushold: '30th-125',
  'Poké Pad': '30th-126',
  Switch: '30th-127',
  'Ultra Ball': '30th-128',
  'Alolan Exeggutor': 'mep-094',
  Moltres: 'mep-096',
  Articuno: 'mep-097',
  Zapdos: 'mep-098',
  'Greninja ex': 'mep-099',
  'Sylveon ex': 'mep-100',
  Nidorina: 'mep-101',
  Zeraora: 'mep-103',
  'Umbreon ex': 'mep-110',
  // supporting cast
  'Dragapult ex': 'sv06-130', // 320 HP Tera, no Weakness or Resistance: a neutral target
  Dreepy: 'sv06-128',
  Drakloak: 'sv06-129',
  'Fezandipiti ex': 'sv06.5-038', // 210 HP Basic ex, Weakness Fighting x2
  Dhelmise: 'me05-039', // 140 HP Basic
  'Legacy Energy': 'sv06-167',
};
const dk = fromIds('30d', [...Object.values(IDS).map((id): [string, number] => [id, 4]), ...ENERGY]);
const DRA = 'Dragapult ex';
const FEZ = 'Fezandipiti ex';
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const F = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
type Sides = [SideLayout, SideLayout];
/** A game from the full deck: P0 to move (turn 3) unless `opts` says otherwise. */
const game = (sides: Sides, opts: Parameters<typeof scenario>[3] = {}) => scenario(dk, dk, sides, opts);
void [F, D];

// ------------------------------------------------------------------ Gholdengo

const HAND30 = (n: number): string[] => Array.from({ length: n }, (_, i) => [G, W, R][i % 3]!);

test('Gholdengo, Celebration: with exactly 30 cards in hand take 2 Prize cards, then shuffle the hand into the deck', () => {
  // "If you have exactly 30 cards in your hand, take 2 Prize cards. If you do, shuffle your hand into your deck."
  const g = game([{ active: 'Gholdengo', energy: { active: [M] }, hand: HAND30(30) }, { active: DRA }], { events: true });
  assert.equal(g.state.p[0].hand.length, 30);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Celebration');
  assert.equal(g.state.p[0].prizes.length, 4, '2 Prize cards taken');
  assert.equal(g.state.p[0].hand.length, 0, 'the hand (with the 2 Prize cards) went into the deck');
  assert.equal(g.state.p[0].deck.length, deckBefore + 32);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

test('Gholdengo, Celebration: with 29 or 31 cards in hand nothing happens', () => {
  for (const n of [29, 31]) {
    const g = game([{ active: 'Gholdengo', energy: { active: [M] }, hand: HAND30(n) }, { active: DRA }]);
    choose(g, 'Attack: Celebration');
    assert.equal(g.state.p[0].prizes.length, 6, `${n} cards: no Prize cards`);
    assert.equal(g.state.p[0].hand.length, n, `${n} cards: hand kept`);
  }
});

test('Gholdengo, Triple Smash: flip 3 coins; 50 damage for each heads', () => {
  for (const [coins, total] of [
    [[true, true, true], 150],
    [[true, false, true], 100],
    [[false, false, true], 50],
    [[false, false, false], 0],
  ] as [boolean[], number][]) {
    const g = game([{ active: 'Gholdengo', energy: { active: [M] } }, { active: DRA }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Triple Smash');
    assert.equal(dmg(g, 1), total, `coins ${coins.join(',')}`);
  }
});

// ------------------------------------------------------------------ Salamence ex

test('Salamence ex, Booming Call: put up to 3 {N} Pokémon from your discard pile onto your Bench (any Stage, as many as the Bench has room for)', () => {
  // "Put up to 3 {N} Pokémon from your discard pile onto your Bench."
  const g = game([{ active: 'Salamence ex', energy: { active: [G] }, discard: ['Dreepy', 'Drakloak', DRA, 'Dhelmise', FEZ] }, { active: FEZ }]);
  choose(g, 'Attack: Booming Call');
  assert.ok(!has(g, 'Dhelmise') && !has(g, FEZ), 'only {N} Pokémon are offered');
  pick(g, ['Dreepy', 'Drakloak', DRA]);
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map((b) => b.cards[0]!)), ['Drakloak', DRA, 'Dreepy'].sort());
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Dhelmise', FEZ].sort());
});

test('Salamence ex, Booming Call: no more than the Bench has room for, and none is allowed ("up to" on an attack)', () => {
  const room = game([{ active: 'Salamence ex', energy: { active: [G] }, bench: ['Dhelmise', 'Dhelmise', 'Dhelmise'], discard: ['Dreepy', 'Drakloak', DRA] }, { active: FEZ }]);
  choose(room, 'Attack: Booming Call');
  pick(room, ['Dreepy', 'Drakloak']);
  assert.equal(room.state.p[0].bench.length, 5);
  assert.equal(room.state.p[0].discard.length, 1);
  const none = game([{ active: 'Salamence ex', energy: { active: [G] }, discard: ['Dreepy'] }, { active: FEZ }]);
  choose(none, 'Attack: Booming Call');
  pick(none, []);
  assert.equal(none.state.p[0].bench.length, 0);
});

test('Salamence ex, Dragon Pulse: 240, and discard the top 2 cards of your deck', () => {
  // "Discard the top 2 cards of your deck."
  const g = game([{ active: 'Salamence ex', energy: { active: [R, W] } }, { active: DRA }]);
  const deck = g.state.p[0].deck.length;
  const top2 = namesOf(g, g.state.p[0].deck.slice(-2));
  choose(g, 'Attack: Dragon Pulse');
  assert.equal(dmg(g, 1), 240);
  assert.equal(g.state.p[0].deck.length, deck - 2);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), top2);
});

// ------------------------------------------------------------------ Jangmo-o

test('Jangmo-o, Screech: during your next turn the Defending Pokémon takes 30 more damage from attacks', () => {
  // "During your next turn, the Defending Pokémon takes 30 more damage from attacks (after applying Weakness and Resistance)."
  const g = game([{ active: 'Jangmo-o', energy: { active: [L, F] } }, { active: DRA }]);
  choose(g, 'Attack: Screech');
  assert.equal(dmg(g, 1), 0, 'Screech itself does no damage');
  endTurn(g); // the opponent passes
  choose(g, 'Attack: Dragon Claw');
  assert.equal(dmg(g, 1), 40 + 30);
  // Control: without Screech, Dragon Claw does its printed 40.
  const c = game([{ active: 'Jangmo-o', energy: { active: [L, F] } }, { active: DRA }]);
  choose(c, 'Attack: Dragon Claw');
  assert.equal(dmg(c, 1), 40);
});

// ------------------------------------------------------------------ Meowth

test('Meowth, Pay Day: 30, and draw a card', () => {
  // "Draw a card."
  const g = game([{ active: 'Meowth', energy: { active: [G, G] } }, { active: DRA }]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Pay Day');
  assert.equal(dmg(g, 1), 30);
  assert.equal(g.state.p[0].hand.length, hand + 1);
});

// ------------------------------------------------------------------ Ditto

test('Ditto, Surprisingly Transform: heads: the Pokémon found takes Ditto\'s place with its Energy, damage and Special Conditions; Ditto goes into the deck', () => {
  // "Flip a coin. If heads, search your deck for a Pokémon and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck."
  const g = game([{ active: 'Ditto', energy: { active: [G, G] }, damage: { active: 20 }, cond: POISONED }, { active: FEZ }], { events: true });
  const ditto = g.state.p[0].active!.cards[0]!;
  const slot = g.state.p[0].active!.id;
  const dittos = g.state.p[0].deck.filter((c) => nameOf(g, c) === 'Ditto').length;
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Surprisingly Transform');
  pick(g, ['Drakloak']);
  const now = g.state.p[0].active!;
  assert.equal(now.id, slot, 'the same Pokémon in play');
  assert.deepEqual(namesOf(g, now.cards), ['Drakloak']);
  assert.deepEqual(energyOf(g, 0), [G, G].sort(), 'Energy stays');
  assert.equal(now.damage, 20 + 10, '20 damage stays; the Poison from Pokémon Checkup adds 10');
  assert.ok(now.cond & POISONED, 'Special Condition stays');
  assert.ok(g.state.p[0].deck.includes(ditto), 'the Ditto card is in the deck');
  assert.equal(g.state.p[0].deck.filter((c) => nameOf(g, c) === 'Ditto').length, dittos + 1);
  assert.ok(!g.state.p[0].discard.includes(ditto));
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

test('Ditto, Surprisingly Transform: tails does nothing; heads with the search declined leaves Ditto where it is', () => {
  const tails = game([{ active: 'Ditto', energy: { active: [G, G] } }, { active: FEZ }]);
  const deck = tails.state.p[0].deck.length;
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Surprisingly Transform');
  assert.deepEqual(namesOf(tails, tails.state.p[0].active!.cards), ['Ditto']);
  assert.equal(tails.state.p[0].deck.length, deck);
  const declined = game([{ active: 'Ditto', energy: { active: [G, G] } }, { active: FEZ }]);
  declined.state.forcedCoins = [true];
  choose(declined, 'Attack: Surprisingly Transform');
  declined.submit([]);
  assert.deepEqual(namesOf(declined, declined.state.p[0].active!.cards), ['Ditto'], 'no Pokémon switched: Ditto is not put into the deck');
});

// ------------------------------------------------------------------ Eevee

test('Eevee, Fetch and Hide: put an Item card from the opponent\'s revealed hand on the bottom of their deck', () => {
  // "Your opponent reveals their hand, and you put an Item card you find there on the bottom of your opponent's deck."
  const g = game([{ active: 'Eevee', energy: { active: [G] } }, { active: DRA, hand: ['Switch', 'Ultra Ball', 'Dhelmise'] }]);
  const sw = g.state.p[1].hand.find((c) => nameOf(g, c) === 'Switch')!;
  choose(g, 'Attack: Fetch and Hide');
  assert.ok(has(g, 'Switch') && has(g, 'Ultra Ball') && !has(g, 'Dhelmise'), 'only the Item cards are offered');
  pick(g, ['Switch']);
  assert.equal(g.state.p[1].deck[0], sw, 'on the bottom of their deck');
  assert.ok(!g.state.p[1].hand.includes(sw));
  assert.ok(g.state.p[1].hand.some((c) => nameOf(g, c) === 'Ultra Ball'), 'only 1 card moved');
});

test('Eevee, Fetch and Hide: no Item card in the hand: nothing moves', () => {
  const g = game([{ active: 'Eevee', energy: { active: [G] } }, { active: DRA, hand: ['Dhelmise', G] }]);
  const bottom = g.state.p[1].deck[0];
  choose(g, 'Attack: Fetch and Hide');
  assert.equal(g.state.p[1].deck[0], bottom);
  assert.ok(g.state.p[1].hand.some((c) => nameOf(g, c) === 'Dhelmise'));
});

// ------------------------------------------------------------------ Snorlax

test('Snorlax, Collapse: 130, and this Pokémon is now Asleep', () => {
  // "This Pokémon is now Asleep."
  const g = game([{ active: 'Snorlax', energy: { active: [G, G, G] } }, { active: DRA }]);
  g.state.forcedCoins = [true]; // wakes at the first Checkup
  choose(g, 'Attack: Collapse');
  assert.equal(dmg(g, 1), 130);
  const g2 = game([{ active: 'Snorlax', energy: { active: [G, G, G] } }, { active: DRA }]);
  g2.state.forcedCoins = [false]; // stays Asleep
  choose(g2, 'Attack: Collapse');
  assert.ok(g2.state.p[0].active!.cond & ASLEEP, 'asleep');
});

test('Snorlax, Good Sleep: if it remains Asleep during Pokémon Checkup, heal all damage from it; if it wakes up it is not healed', () => {
  // "If this Pokémon remains Asleep during Pokémon Checkup, heal all damage from this Pokémon."
  const stays = game([{ active: 'Snorlax', damage: { active: 80 }, cond: ASLEEP }, { active: DRA }]);
  stays.state.forcedCoins = [false];
  endTurn(stays);
  ord(stays);
  assert.equal(dmg(stays, 0), 0, 'remained Asleep: healed');
  const wakes = game([{ active: 'Snorlax', damage: { active: 80 }, cond: ASLEEP }, { active: DRA }]);
  wakes.state.forcedCoins = [true];
  endTurn(wakes);
  ord(wakes);
  assert.equal(dmg(wakes, 0), 80, 'woke up: not healed');
  const awake = game([{ active: 'Snorlax', damage: { active: 80 } }, { active: DRA }]);
  endTurn(awake);
  assert.equal(dmg(awake, 0), 80, 'never Asleep: not healed');
});

// ------------------------------------------------------------------ Igglybuff

test('Igglybuff, Bouncy Circle: 30 damage for each of your Benched Pokémon that has a maximum HP of 30', () => {
  // "This attack does 30 damage for each of your Benched Pokémon that has a maximum HP of 30."
  const two = game([{ active: 'Igglybuff', bench: ['Igglybuff', 'Igglybuff', 'Dhelmise'] }, { active: DRA }]);
  choose(two, 'Attack: Bouncy Circle');
  assert.equal(dmg(two, 1), 60, 'the two Benched Igglybuff, not the 140-HP Dhelmise');
  const none = game([{ active: 'Igglybuff', bench: ['Dhelmise'] }, { active: DRA }]);
  choose(none, 'Attack: Bouncy Circle');
  assert.equal(dmg(none, 1), 0);
  const active = game([{ active: 'Igglybuff' }, { active: DRA, bench: ['Igglybuff'] }]);
  choose(active, 'Attack: Bouncy Circle');
  assert.equal(dmg(active, 1), 0, 'this Pokémon is Active and the opponent\'s Benched Pokémon are not yours');
});

// ------------------------------------------------------------------ Lugia

test('Lugia, Elemental Blast: 250, and discard a {R} Energy, a {W} Energy and a {L} Energy from this Pokémon (the rest stays)', () => {
  // "Discard a {R} Energy, a {W} Energy, and a {L} Energy from this Pokémon."
  const g = game([{ active: 'Lugia', energy: { active: [R, W, L, R, G] } }, { active: DRA }]);
  choose(g, 'Attack: Elemental Blast');
  maybePick(g, [R]); // which of the 2 {R} Energy
  assert.equal(dmg(g, 1), 250);
  assert.deepEqual(energyOf(g, 0), [G, R].sort(), 'one of each type discarded, a second Fire and the Grass stay');
});

// ------------------------------------------------------------------ Minior

test('Minior, Shoot Meteors: discard all Energy from it; 120 damage to 1 of the opponent\'s Pokémon, with no Weakness or Resistance on the Bench', () => {
  // "Discard all Energy from this Pokémon, and this attack does 120 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
  const bench = game([{ active: 'Minior', energy: { active: [G, G, F] } }, { active: DRA, bench: [FEZ] }]);
  choose(bench, 'Attack: Shoot Meteors');
  choose(bench, FEZ);
  assert.equal(dmg(bench, 1, 0), 120);
  assert.equal(dmg(bench, 1), 0);
  assert.deepEqual(energyOf(bench, 0), []);
  const active = game([{ active: 'Minior', energy: { active: [G, G, G] } }, { active: DRA, bench: [FEZ] }]);
  choose(active, 'Attack: Shoot Meteors');
  choose(active, DRA);
  assert.equal(dmg(active, 1), 120);
  assert.equal(dmg(active, 1, 0), 0);
});

// ------------------------------------------------------------------ Maushold

test('Maushold, Gnaw Together: flip a coin for each Maushold you have in play; for each heads, discard the top 2 cards of the opponent\'s deck', () => {
  // "Flip a coin for each Maushold you have in play. For each heads, discard the top 2 cards of your opponent's deck."
  const three = game([{ active: 'Maushold', bench: ['Maushold', 'Maushold', 'Dhelmise'], energy: { active: [G] } }, { active: DRA }]);
  three.state.forcedCoins = [true, false, true];
  const top = namesOf(three, three.state.p[1].deck.slice(-4));
  choose(three, 'Attack: Gnaw Together');
  assert.equal(three.state.p[1].discard.length, 4, '2 heads of 3 Maushold: 4 cards');
  assert.deepEqual(namesOf(three, three.state.p[1].discard), top);
  const one = game([{ active: 'Maushold', bench: ['Dhelmise'], energy: { active: [G] } }, { active: DRA }]);
  one.state.forcedCoins = [true];
  choose(one, 'Attack: Gnaw Together');
  assert.equal(one.state.p[1].discard.length, 2, 'a lone Maushold flips 1 coin');
  const tails = game([{ active: 'Maushold', bench: ['Maushold'], energy: { active: [G] } }, { active: DRA }]);
  tails.state.forcedCoins = [false, false];
  choose(tails, 'Attack: Gnaw Together');
  assert.equal(tails.state.p[1].discard.length, 0);
});

// ------------------------------------------------------------------ Trainers

test('Poké Pad: search your deck for a Pokémon that has no Rule Box (no Pokémon ex), reveal it and put it into your hand', () => {
  // "Search your deck for a Pokémon that doesn't have a Rule Box, reveal it, and put it into your hand. Then, shuffle your deck."
  const g = game([{ active: 'Dhelmise', hand: ['Poké Pad'] }, { active: DRA }], { events: true });
  choose(g, 'Play Poké Pad');
  assert.ok(has(g, 'Dreepy') && !has(g, DRA) && !has(g, FEZ), 'Pokémon ex are not offered');
  pick(g, ['Dreepy']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Dreepy']);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
  const empty = game([{ active: 'Dhelmise', hand: ['Poké Pad'], emptyDeck: true }, { active: DRA }]);
  assert.ok(!has(empty, 'Play Poké Pad'), 'an empty deck: it would do nothing');
});

test('Switch: switch your Active Pokémon with 1 of your Benched Pokémon; not playable without a Benched Pokémon', () => {
  // "Switch your Active Pokémon with 1 of your Benched Pokémon."
  const g = game([{ active: 'Dhelmise', bench: ['Dreepy', 'Meowth'], hand: ['Switch'] }, { active: DRA }]);
  choose(g, 'Play Switch');
  pick(g, ['Meowth']);
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Meowth');
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map((b) => b.cards[0]!)), ['Dhelmise', 'Dreepy']);
  const none = game([{ active: 'Dhelmise', hand: ['Switch'] }, { active: DRA }]);
  assert.ok(!has(none, 'Play Switch'));
});

test('Ultra Ball: discard 2 other cards, then search for a Pokémon; not playable with fewer than 2 other cards, or with an empty deck (ruling 1188)', () => {
  // "You can use this card only if you discard 2 other cards from your hand."
  const g = game([{ active: 'Dhelmise', hand: ['Ultra Ball', G, R] }, { active: DRA }]);
  choose(g, 'Play Ultra Ball'); // exactly 2 other cards: both are the cost
  pick(g, [DRA]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [DRA]);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [G, R, 'Ultra Ball'].sort());
  assert.ok(!has(game([{ active: 'Dhelmise', hand: ['Ultra Ball', G] }, { active: DRA }]), 'Play Ultra Ball'), 'only 1 other card');
  // Ruling (TPCi Rules Team 2017-04-27, https://compendium.pokegym.net/ruling/1188/): "No, you cannot. Discarding the two cards is a cost not the effect, and you cannot play Trainer cards for no effect."
  const empty = game([{ active: 'Dhelmise', hand: ['Ultra Ball', G, R], emptyDeck: true }, { active: DRA }]);
  assert.ok(!has(empty, 'Play Ultra Ball'), 'no cards in the deck');
});

// ------------------------------------------------------------------ Alolan Exeggutor

test('Alolan Exeggutor, Scale Up: with 6 or more {G} Energy attached it gets +250 HP', () => {
  // "If this Pokémon has 6 or more {G} Energy attached, it gets +250 HP."
  const five = game([{ active: 'Alolan Exeggutor', energy: { active: [G, G, G, G, G, R] } }, { active: DRA }]);
  assert.equal(maxHp(five.envForInternals, five.state, five.state.p[0].active!), 150);
  const six = game([{ active: 'Alolan Exeggutor', energy: { active: [G, G, G, G, G, G] } }, { active: DRA }]);
  assert.equal(maxHp(six.envForInternals, six.state, six.state.p[0].active!), 400);
});

test('Alolan Exeggutor, Mega Drain: 150, and heal 50 damage from this Pokémon', () => {
  // "Heal 50 damage from this Pokémon."
  const g = game([{ active: 'Alolan Exeggutor', energy: { active: [G, G, G, G] }, damage: { active: 100 } }, { active: DRA }]);
  choose(g, 'Attack: Mega Drain');
  assert.equal(dmg(g, 1), 150);
  assert.equal(dmg(g, 0), 50);
});

// ------------------------------------------------------------------ Moltres, Articuno, Zapdos

test('Moltres, Fiery Flapping: with Articuno and Zapdos in play, attach a Basic {R} Energy card from your hand to this Pokémon (once during your turn)', () => {
  // "Once during your turn, if you have Articuno and Zapdos in play, you may use this Ability. Attach a Basic {R} Energy card from your hand to this Pokémon."
  const mk = (bench: string[], hand: string[]): Game => game([{ active: 'Dhelmise', bench, hand }, { active: DRA }]);
  const g = mk(['Moltres', 'Articuno', 'Zapdos'], [R, W, R]);
  choose(g, 'Use Fiery Flapping');
  maybePick(g, [R]);
  assert.deepEqual(energyOf(g, 0, 0), [R], 'attached to Moltres, which is on the Bench');
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [R, W].sort());
  assert.ok(!has(g, 'Use Fiery Flapping'), 'once during your turn');
  assert.ok(!has(mk(['Moltres', 'Articuno'], [R]), 'Use Fiery Flapping'), 'no Zapdos in play');
  assert.ok(!has(mk(['Moltres', 'Zapdos'], [R]), 'Use Fiery Flapping'), 'no Articuno in play');
  assert.ok(!has(mk(['Moltres', 'Articuno', 'Zapdos'], [W, G]), 'Use Fiery Flapping'), 'no Basic {R} Energy in hand');
  const act = game([{ active: 'Moltres', bench: ['Articuno', 'Zapdos'], hand: [R] }, { active: DRA }]);
  choose(act, 'Use Fiery Flapping');
  assert.deepEqual(energyOf(act, 0), [R], 'also from the Active Spot');
});

test('Moltres, Fire Spin: 130, and discard 2 Energy from this Pokémon', () => {
  // "Discard 2 Energy from this Pokémon."
  const g = game([{ active: 'Moltres', energy: { active: [R, R, W, G] } }, { active: DRA }]);
  choose(g, 'Attack: Fire Spin');
  maybePick(g, [W, G]);
  assert.equal(dmg(g, 1), 130);
  assert.equal(energyOf(g, 0).length, 2);
});

test('Articuno, Frosty Flapping: with Moltres and Zapdos in play, attach a Basic {W} Energy card from your hand to this Pokémon', () => {
  // "Once during your turn, if you have Moltres and Zapdos in play, you may use this Ability. Attach a Basic {W} Energy card from your hand to this Pokémon."
  const mk = (bench: string[], hand: string[]): Game => game([{ active: 'Articuno', bench, hand }, { active: DRA }]);
  const g = mk(['Moltres', 'Zapdos'], [R, W]);
  choose(g, 'Use Frosty Flapping');
  assert.deepEqual(energyOf(g, 0), [W]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [R]);
  assert.ok(!has(mk(['Moltres'], [W]), 'Use Frosty Flapping'), 'no Zapdos in play');
  assert.ok(!has(mk(['Zapdos'], [W]), 'Use Frosty Flapping'), 'no Moltres in play');
  assert.ok(!has(mk(['Moltres', 'Zapdos'], [R]), 'Use Frosty Flapping'), 'no Basic {W} Energy in hand');
});

test('Articuno, Hail: 30 damage to each of the opponent\'s Pokémon (no Weakness or Resistance on the Bench)', () => {
  // "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
  const g = game([{ active: 'Articuno', energy: { active: [W, W, G] } }, { active: DRA, bench: [FEZ, 'Dhelmise'] }]);
  choose(g, 'Attack: Hail');
  assert.equal(dmg(g, 1), 30);
  assert.equal(dmg(g, 1, 0), 30);
  assert.equal(dmg(g, 1, 1), 30);
  assert.equal(dmg(g, 0), 0);
});

test('Zapdos, Flash-Pop Flapping: with Moltres and Articuno in play, attach a Basic {L} Energy card from your hand to this Pokémon', () => {
  // "Once during your turn, if you have Moltres and Articuno in play, you may use this Ability. Attach a Basic {L} Energy card from your hand to this Pokémon."
  const mk = (bench: string[], hand: string[]): Game => game([{ active: 'Zapdos', bench, hand }, { active: DRA }]);
  const g = mk(['Moltres', 'Articuno'], [L, W]);
  choose(g, 'Use Flash-Pop Flapping');
  assert.deepEqual(energyOf(g, 0), [L]);
  assert.ok(!has(mk(['Articuno'], [L]), 'Use Flash-Pop Flapping'), 'no Moltres in play');
  assert.ok(!has(mk(['Moltres'], [L]), 'Use Flash-Pop Flapping'), 'no Articuno in play');
  assert.ok(!has(mk(['Moltres', 'Articuno'], [W]), 'Use Flash-Pop Flapping'), 'no Basic {L} Energy in hand');
});

test('Zapdos, Thundering Lightning: 210, and this Pokémon also does 60 damage to itself', () => {
  // "This Pokémon also does 60 damage to itself."
  const g = game([{ active: 'Zapdos', energy: { active: [L, L, L, G] } }, { active: DRA }]);
  choose(g, 'Attack: Thundering Lightning');
  assert.equal(dmg(g, 1), 210);
  assert.equal(dmg(g, 0), 60);
});

// ------------------------------------------------------------------ Greninja ex

test('Greninja ex, Stealthy Slash: 30 damage to 1 of the opponent\'s Pokémon for each damage counter on it (no Weakness or Resistance on the Bench)', () => {
  // "This attack does 30 damage to 1 of your opponent's Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
  const bench = game([{ active: 'Greninja ex', energy: { active: [W] } }, { active: DRA, bench: [FEZ], damage: { active: 20, 0: 50 } }]);
  choose(bench, 'Attack: Stealthy Slash');
  choose(bench, FEZ);
  assert.equal(dmg(bench, 1, 0), 50 + 150);
  assert.equal(dmg(bench, 1), 20);
  const active = game([{ active: 'Greninja ex', energy: { active: [W] } }, { active: DRA, bench: [FEZ], damage: { active: 20, 0: 50 } }]);
  choose(active, 'Attack: Stealthy Slash');
  choose(active, DRA);
  assert.equal(dmg(active, 1), 20 + 60);
  const clean = game([{ active: 'Greninja ex', energy: { active: [W] } }, { active: DRA }]);
  choose(clean, 'Attack: Stealthy Slash');
  assert.equal(dmg(clean, 1), 0, 'no damage counters: no damage');
});

// ------------------------------------------------------------------ Sylveon ex

test('Sylveon ex, Colorful Harmony: 50 damage for each type of Basic Energy attached to all of your Pokémon (Special Energy and the opponent\'s Energy do not count)', () => {
  // "This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon."
  const two = game([{ active: 'Sylveon ex', energy: { active: [P, G, G] } }, { active: DRA }]);
  choose(two, 'Attack: Colorful Harmony');
  assert.equal(dmg(two, 1), 100, '{P} and {G}');
  const three = game([
    { active: 'Sylveon ex', bench: ['Dhelmise', 'Dreepy', 'Meowth'], energy: { active: [P, G, G], 0: [R, R], 1: ['Legacy Energy'], 2: [G] } },
    { active: DRA, energy: { active: [W, L] } },
  ]);
  choose(three, 'Attack: Colorful Harmony');
  assert.equal(dmg(three, 1), 150, '{P}, {G} and {R}: not the Legacy Energy, nor the opponent\'s {W} and {L}');
});

// ------------------------------------------------------------------ Nidorina

test('Nidorina, Share Happiness: heal 30 damage from 1 of your Pokémon (once during your turn; only while one is damaged)', () => {
  // "Once during your turn, you may use this Ability. Heal 30 damage from 1 of your Pokémon."
  const g = game([{ active: 'Nidorina', bench: ['Dhelmise', 'Dreepy'], damage: { active: 40, 0: 20 } }, { active: DRA }]);
  choose(g, 'Use Share Happiness');
  pick(g, ['Dhelmise']);
  assert.equal(dmg(g, 0, 0), 0, 'only the 20 it had');
  assert.equal(dmg(g, 0), 40, 'the other one is untouched');
  assert.ok(!has(g, 'Use Share Happiness'), 'once during your turn');
  const h = game([{ active: 'Nidorina', damage: { active: 100 } }, { active: DRA }]);
  choose(h, 'Use Share Happiness');
  assert.equal(dmg(h, 0), 70, 'heals itself too');
  assert.ok(!has(game([{ active: 'Nidorina', bench: ['Dhelmise'] }, { active: DRA }]), 'Use Share Happiness'), 'nothing is damaged');
});

// ------------------------------------------------------------------ Zeraora

test('Zeraora, Rapid Draw: 20, and draw a card', () => {
  // "Draw a card."
  const g = game([{ active: 'Zeraora', energy: { active: [G] } }, { active: DRA }]);
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Rapid Draw');
  assert.equal(dmg(g, 1), 20);
  assert.equal(g.state.p[0].hand.length, hand + 1);
});

test('Zeraora, Electrobullet: 50, and also 20 damage to 1 of the opponent\'s Benched Pokémon (no Weakness or Resistance)', () => {
  // "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
  const g = game([{ active: 'Zeraora', energy: { active: [L, G] } }, { active: DRA, bench: [FEZ, 'Dhelmise'] }]);
  choose(g, 'Attack: Electrobullet');
  choose(g, FEZ);
  assert.equal(dmg(g, 1), 50);
  assert.equal(dmg(g, 1, 0), 20);
  assert.equal(dmg(g, 1, 1), 0);
});

// ------------------------------------------------------------------ Umbreon ex

test('Umbreon ex, Lunatic Claw: 100, and 140 more if the opponent\'s Active Pokémon already has damage counters', () => {
  // "If your opponent's Active Pokémon already has any damage counters on it, this attack does 140 more damage."
  const hit = game([{ active: 'Umbreon ex', energy: { active: [D, G] } }, { active: DRA, damage: { active: 10 } }]);
  choose(hit, 'Attack: Lunatic Claw');
  assert.equal(dmg(hit, 1), 10 + 240);
  const clean = game([{ active: 'Umbreon ex', energy: { active: [D, G] } }, { active: DRA }]);
  choose(clean, 'Attack: Lunatic Claw');
  assert.equal(dmg(clean, 1), 100);
});
