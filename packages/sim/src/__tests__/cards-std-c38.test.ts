/**
 * Card tests, batch "std-c38": every card scripted in cards/scripts/std-c38.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { maxHp, retreatCost } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { POISONED, type Decision } from '../types.js';
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
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Sawk: 'sv10.5w-049',
  Archen: 'sv10.5w-050',
  Archeops: 'sv10.5w-051',
  Mienshao: 'sv10.5w-053',
  Terrakion: 'sv10.5w-054',
  Purrloin: 'sv10.5w-055',
  Scrafty: 'sv10.5w-058',
  Garbodor: 'sv10.5w-060',
  Zoroark: 'sv10.5w-062',
  Mandibuzz: 'sv10.5w-064',
  Ferrothorn: 'sv10.5w-069',
  Durant: 'sv10.5w-070',
  Druddigon: 'sv10.5w-071',
  Patrat: 'sv10.5w-072',
  Watchog: 'sv10.5w-073',
  Stoutland: 'sv10.5w-076',
  'Bouffalant ex': 'sv10.5w-077',
  Tornadus: 'sv10.5w-078',
  'Antique Plume Fossil': 'sv10.5w-079',
  Harlequin: 'sv10.5w-083',
  'Pikachu with Grey Felt Hat': 'svp-085',
  Picnicker: 'svp-114',
  Pecharunt: 'svp-129',
  'Paradise Resort': 'svp-150',
  // supporting cast
  'Dragapult ex': 'sv06-130', // 320 HP Tera, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
  Dreepy: 'sv06-128',
  Drakloak: 'sv06-129',
  'Fezandipiti ex': 'sv06.5-038', // 210 HP Basic ex, Weakness Fighting x2
  'Latias ex': 'sv08-076', // 210 HP Basic ex, Resistance Fighting -30
  Dhelmise: 'me05-039', // 140 HP Basic, Resistance Fighting -30, not an ex
  Shuppet: 'me05-033',
  Banette: 'me05-034', // Hide 'n' Sneak
  Psyduck: 'me02.5-039',
  Pikachu: 'svp-190',
  'Pikachu ex': 'me02.5-057',
  Zorua: 'sv10.5w-061',
  'Ultra Ball': 'me01-131',
  'Poké Ball': 'me03-080',
  'Air Balloon': 'me01-166',
  "Boss's Orders": 'me01-114',
  'Legacy Energy': 'sv06-167',
  'Telepathic Psychic Energy': 'me03-088',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c38', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex';
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const F = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const TPE = 'Telepathic Psychic Energy';
type Sides = [SideLayout, SideLayout];
const ALL = Object.keys(IDS);
const dk = deck(...ALL);
/** A game from the full deck: P0 to move (turn 3) unless `opts` says otherwise. */
const game = (sides: Sides, opts: Parameters<typeof scenario>[3] = {}) => scenario(dk, dk, sides, opts);
/** The same with the event log on (shuffles are read from it). */
const gameE = (sides: Sides) => game(sides, { events: true });
const OPP_TURN = { current: 1 as const, turn: 4 };
void [G, R, W, L, P];

// ------------------------------------------------------------------ Sawk

test("Sawk, Rising Chop: 90 to a Pokémon ex, and its damage isn't affected by Weakness (Fezandipiti ex is weak to {F})", () => {
  const g = game([{ active: 'Sawk', energy: { active: [F] } }, { active: 'Fezandipiti ex' }]);
  choose(g, 'Attack: Rising Chop');
  assert.equal(dmg(g, 1), 90, 'not 180');
});

test("Sawk, Rising Chop: its damage isn't affected by Resistance (Latias ex resists {F} by 30)", () => {
  const g = game([{ active: 'Sawk', energy: { active: [F] } }, { active: 'Latias ex' }]);
  choose(g, 'Attack: Rising Chop');
  assert.equal(dmg(g, 1), 90, 'not 60');
});

test("Sawk, Rising Chop: if the opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing", () => {
  const g = game([{ active: 'Sawk', energy: { active: [F] } }, { active: 'Dhelmise' }]);
  choose(g, 'Attack: Rising Chop');
  assert.equal(dmg(g, 1), 0);
});

// ------------------------------------------------------------------ Archen

test('Archen, Acrobatics: flip 2 coins; 30 more damage for each heads', () => {
  for (const [coins, total] of [
    [[true, true], 90],
    [[true, false], 60],
    [[false, true], 60],
    [[false, false], 30],
  ] as [boolean[], number][]) {
    const g = game([{ active: 'Archen', energy: { active: [F, F] } }, { active: DRA }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Acrobatics');
    assert.equal(dmg(g, 1), total, `coins ${coins.join(',')}`);
  }
});

test('Archen: evolves from an Antique Plume Fossil in play', () => {
  const g = game([{ active: 'Antique Plume Fossil', hand: ['Archen'] }, { active: DRA }]);
  choose(g, 'Evolve Antique Plume Fossil (Active) into Archen');
  assert.equal(nameOf(g, g.state.p[0].active!.cards[g.state.p[0].active!.cards.length - 1]!), 'Archen');
});

// ------------------------------------------------------------------ Archeops

test("Archeops, Ancient Wing: devolve 1 of your opponent's evolved Pokémon: the highest Stage Evolution card goes to their hand", () => {
  const g = game([
    { active: 'Archeops' },
    { active: 'Dreepy', evolve: { active: ['Drakloak', DRA] }, damage: { active: 30 }, cond: POISONED },
  ]);
  choose(g, 'Use Ancient Wing');
  const act = g.state.p[1].active!;
  assert.equal(act.cards.length, 2);
  assert.equal(nameOf(g, act.cards[act.cards.length - 1]!), 'Drakloak', 'Dragapult ex is gone from it');
  assert.deepEqual(namesOf(g, g.state.p[1].hand), [DRA], "into the opponent's hand");
  assert.equal(act.cond, 0, 'it recovers from Special Conditions, as when it evolves');
  assert.equal(act.damage, 30, 'its damage stays');
  assert.equal(g.state.p[0].hand.length, 0, 'not mine');
  assert.ok(!has(g, 'Use Ancient Wing'), 'once during your turn');
});

test("Archeops, Ancient Wing: with two evolved Pokémon the user chooses; the other is untouched", () => {
  const g = game([
    { active: 'Archeops' },
    { active: 'Dreepy', evolve: { active: ['Drakloak', DRA] }, bench: ['Dreepy'] },
  ]);
  const b = g.state.p[1].bench[0]!;
  b.cards.push(g.state.p[1].deck.splice(g.state.p[1].deck.findIndex((c) => nameOf(g, c) === 'Drakloak'), 1)[0]!);
  choose(g, 'Use Ancient Wing');
  assert.equal(g.decision?.kind, 'slots');
  assert.equal(g.decision?.player, 0);
  pick(g, ['Drakloak']);
  assert.equal(g.state.p[1].active!.cards.length, 3, 'the Active Pokémon is untouched');
  assert.equal(g.state.p[1].bench[0]!.cards.length, 1, 'the Benched one devolved to its Basic');
  assert.deepEqual(namesOf(g, g.state.p[1].hand), ['Drakloak']);
});

test('Archeops, Ancient Wing: only while this Pokémon is in the Active Spot', () => {
  const g = game([{ active: 'Purrloin', bench: ['Archeops'] }, { active: 'Dreepy', evolve: { active: ['Drakloak'] } }]);
  assert.ok(!has(g, 'Use Ancient Wing'));
});

test('Archeops, Ancient Wing (ruling 2178): an Evolution Pokémon put directly into play has nothing to devolve into', () => {
  // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2178/): "No, if an Evolution Pokemon that has been put directly into play cannot devolve since there is no Pokemon to devolve it into."
  const g = game([{ active: 'Archeops' }, { active: DRA, bench: ['Purrloin'] }]);
  assert.ok(!has(g, 'Use Ancient Wing'), 'not usable: no candidate');
  const mixed = game([{ active: 'Archeops' }, { active: DRA, bench: ['Dreepy'], evolve: { 0: ['Drakloak'] } }]);
  choose(mixed, 'Use Ancient Wing');
  assert.equal(mixed.state.p[1].active!.cards.length, 1, 'the directly played one is untouched');
  assert.equal(mixed.state.p[1].bench[0]!.cards.length, 1, 'the evolved one devolved');
});

test("Archeops, Ancient Wing: a Pokémon protected from the effects of Abilities (Hide 'n' Sneak) is left alone", () => {
  const g = game([{ active: 'Archeops' }, { active: 'Shuppet', evolve: { active: ['Banette'] } }]);
  choose(g, 'Use Ancient Wing');
  assert.equal(g.state.p[1].active!.cards.length, 2);
  assert.equal(g.state.p[1].hand.length, 0);
});

// ------------------------------------------------------------------ Mienshao

test("Mienshao, Smash Uppercut: 80, and its damage isn't affected by Resistance (Dhelmise resists {F} by 30)", () => {
  const g = game([{ active: 'Mienshao', energy: { active: [F, F] } }, { active: 'Dhelmise' }]);
  choose(g, 'Attack: Smash Uppercut');
  assert.equal(dmg(g, 1), 80, 'not 50');
  // control: Resistance applies to Low Sweep
  const c = game([{ active: 'Mienshao', energy: { active: [F, F] } }, { active: 'Dhelmise' }]);
  choose(c, 'Attack: Low Sweep');
  assert.equal(dmg(c, 1), 10, '40 − 30');
});

// ------------------------------------------------------------------ Terrakion

test("Terrakion, Retaliate: 80 more if one of your Pokémon was Knocked Out by damage from an attack during your opponent's last turn", () => {
  const g = game(
    [{ active: 'Purrloin', damage: { active: 50 }, bench: ['Terrakion'], energy: { 0: [F, F] } }, { active: DRA, energy: { active: [P] } }],
    OPP_TURN,
  );
  choose(g, 'Attack: Jet Headbutt'); // 70 on 10 HP remaining
  assert.equal(g.state.current, 0);
  assert.equal(g.state.p[1].prizesTaken, 1);
  choose(g, 'Attack: Retaliate');
  assert.equal(dmg(g, 1), 50 + 80);
});

test("Terrakion, Retaliate: 50 when none of your Pokémon was Knocked Out last turn", () => {
  const g = game([{ active: 'Terrakion', energy: { active: [F, F] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(g, 'Attack: Jet Headbutt'); // damages but does not Knock Out
  choose(g, 'Attack: Retaliate');
  assert.equal(dmg(g, 1), 50);
});

test('Terrakion, Retaliate (ruling 2200): a Knock Out that gives up no Prize card (Legacy Energy) still counts', () => {
  // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2200/): "Yes, you would. Even though the Pokemon with Legacy Energy attached does not give up a prize card, it still counts as a KO'd Pokemon."
  const g = game(
    [
      { active: 'Purrloin', damage: { active: 50 }, energy: { active: ['Legacy Energy'] }, bench: ['Terrakion'] },
      { active: DRA, energy: { active: [P] } },
    ],
    OPP_TURN,
  );
  g.state.p[0].bench[0]!.energy.push(...[F, F].map((n) => g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((c) => nameOf(g, c) === n), 1)[0]!));
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.state.p[1].prizesTaken, 0, 'Legacy Energy: no Prize card for this Knock Out');
  choose(g, 'Attack: Retaliate');
  assert.equal(dmg(g, 1), 130);
});

// ------------------------------------------------------------------ Purrloin

test('Purrloin, Invite Evil: search your deck for up to 3 {D} Pokémon, reveal them and put them into your hand', () => {
  const g = gameE([{ active: 'Purrloin', energy: { active: [D] } }, { active: DRA }]);
  choose(g, 'Attack: Invite Evil');
  assert.ok(!has(g, 'Sawk') && !has(g, 'Dhelmise'), 'only {D} Pokémon can be chosen');
  assert.ok(has(g, 'Zorua') && has(g, 'Garbodor'));
  pick(g, ['Zorua', 'Garbodor', 'Pecharunt']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Garbodor', 'Pecharunt', 'Zorua']);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

test('Purrloin, Invite Evil: up to 3, so fewer (even none) is allowed', () => {
  const g = game([{ active: 'Purrloin', energy: { active: [D] } }, { active: DRA }]);
  choose(g, 'Attack: Invite Evil');
  g.submit([0]);
  assert.equal(g.state.p[0].hand.length, 1);
  const none = game([{ active: 'Purrloin', energy: { active: [D] } }, { active: DRA }]);
  choose(none, 'Attack: Invite Evil');
  none.submit([]);
  assert.equal(none.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Scrafty

test('Scrafty, Ruffians Attack: flip a coin for each {D} Pokémon you have in play; 60 damage for each heads', () => {
  const mk = () =>
    game([
      { active: 'Scrafty', bench: ['Purrloin', 'Sawk', 'Zorua'], energy: { active: [D, D] } },
      { active: DRA, bench: ['Purrloin', 'Zorua'] },
    ]);
  const all = mk();
  all.state.forcedCoins = [true, true, true, true, true, true];
  choose(all, 'Attack: Ruffians Attack');
  assert.equal(dmg(all, 1), 180, "3 {D} Pokémon of yours (Scrafty, Purrloin, Zorua): 3 coins; not Sawk, not the opponent's");
  const some = mk();
  some.state.forcedCoins = [true, false, true];
  choose(some, 'Attack: Ruffians Attack');
  assert.equal(dmg(some, 1), 120);
  const none = mk();
  none.state.forcedCoins = [false, false, false];
  choose(none, 'Attack: Ruffians Attack');
  assert.equal(dmg(none, 1), 0);
});

// ------------------------------------------------------------------ Garbodor

test("Garbodor, Gunk Shot: 120, and the opponent's Active Pokémon is now Poisoned", () => {
  const g = game([{ active: 'Garbodor', energy: { active: [D, D, D] } }, { active: DRA }]);
  choose(g, 'Attack: Gunk Shot');
  assert.equal(dmg(g, 1), 120 + 10, 'plus 10 for Poison at Checkup');
  assert.ok(g.state.p[1].active!.cond & POISONED);
});

// ------------------------------------------------------------------ Zoroark

test("Zoroark, Mind Jack: 30 damage for each of your opponent's Benched Pokémon", () => {
  const three = game([{ active: 'Zoroark', energy: { active: [D] } }, { active: DRA, bench: ['Purrloin', 'Zorua', 'Sawk'] }]);
  choose(three, 'Attack: Mind Jack');
  assert.equal(dmg(three, 1), 90);
  const mine = game([{ active: 'Zoroark', bench: ['Purrloin', 'Zorua'], energy: { active: [D] } }, { active: DRA, bench: ['Sawk'] }]);
  choose(mine, 'Attack: Mind Jack');
  assert.equal(dmg(mine, 1), 30, 'only the opponent\'s Bench counts');
  const none = game([{ active: 'Zoroark', energy: { active: [D] } }, { active: DRA }]);
  choose(none, 'Attack: Mind Jack');
  assert.equal(dmg(none, 1), 0);
});

test("Zoroark, Foul Play: use 1 of your opponent's Active Pokémon's attacks as this attack, without its Energy cost (ruling 455)", () => {
  // Ruling (TPCi Rules Team 2011-04-28, https://compendium.pokegym.net/ruling/455/): "No, you do not have to meet the energy requirements for the attack."
  const g = game([{ active: 'Zoroark', energy: { active: [D, D, D] } }, { active: 'Terrakion', energy: { active: [F] } }]);
  choose(g, 'Attack: Foul Play');
  choose(g, 'Land Crush');
  assert.equal(dmg(g, 1), 100, "Zoroark has none of Land Crush's {F}{F}{C} and still deals 100");
  assert.equal(dmg(g, 0), 0);
});

test('Zoroark, Foul Play: the copied attack is the opponent\'s choice of nothing: the attacker chooses among the Defending Pokémon\'s attacks', () => {
  const g = game([{ active: 'Zoroark', energy: { active: [D, D, D] } }, { active: 'Terrakion' }]);
  choose(g, 'Attack: Foul Play');
  assert.ok(has(g, 'Retaliate') && has(g, 'Land Crush'), 'both attacks of the Defending Pokémon are offered');
  choose(g, 'Retaliate');
  assert.equal(dmg(g, 1), 50, 'Retaliate copied: no Knock Out last turn for Zoroark\'s owner, so 50');
});

// ------------------------------------------------------------------ Mandibuzz

test("Mandibuzz, Look for Prey: your opponent reveals their hand, and you put a Basic Pokémon with 70 HP or less you find there onto their Bench", () => {
  const g = game([
    { active: 'Mandibuzz' },
    { active: DRA, hand: ['Purrloin', 'Terrakion', 'Dragapult ex', F], bench: ['Zorua'] },
  ]);
  choose(g, 'Use Look for Prey');
  if (g.decision?.kind === 'cards') {
    assert.ok(has(g, 'Purrloin'));
    assert.ok(!has(g, 'Terrakion') && !has(g, 'Dragapult') && !has(g, 'Fighting'), 'only a Basic Pokémon with 70 HP or less');
    pick(g, ['Purrloin']);
  }
  assert.deepEqual(g.state.p[1].bench.map((b) => nameOf(g, b.cards[0]!)), ['Zorua', 'Purrloin'], 'onto the opponent\'s Bench');
  assert.deepEqual(namesOf(g, g.state.p[1].hand), ['Dragapult ex', 'Fighting Energy', 'Terrakion']);
  assert.ok(!has(g, 'Use Look for Prey'), 'once during your turn');
});

test('Mandibuzz, Look for Prey: nothing is put onto a full Bench, or when no Basic Pokémon has 70 HP or less', () => {
  const full = game([
    { active: 'Mandibuzz' },
    { active: DRA, hand: ['Purrloin'], bench: ['Zorua', 'Zorua', 'Zorua', 'Zorua', 'Sawk'] },
  ]);
  choose(full, 'Use Look for Prey');
  assert.equal(full.state.p[1].bench.length, 5);
  assert.deepEqual(namesOf(full, full.state.p[1].hand), ['Purrloin']);
  const big = game([{ active: 'Mandibuzz' }, { active: DRA, hand: ['Terrakion', 'Dhelmise'] }]);
  choose(big, 'Use Look for Prey');
  assert.equal(big.state.p[1].bench.length, 0);
  assert.equal(big.state.p[1].hand.length, 2);
  const empty = game([{ active: 'Mandibuzz' }, { active: DRA }]);
  assert.ok(!has(empty, 'Use Look for Prey'), 'nothing to reveal');
});

// ------------------------------------------------------------------ Ferrothorn

test("Ferrothorn, Power Whip: 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon", () => {
  const bench = game([{ active: 'Ferrothorn', energy: { active: [M, M, M] } }, { active: DRA, bench: ['Purrloin', 'Zorua'] }]);
  choose(bench, 'Attack: Power Whip');
  pick(bench, ['Zorua']);
  assert.equal(bench.state.p[1].bench[1]!.damage, 60);
  assert.equal(bench.state.p[1].bench[0]!.damage, 0);
  assert.equal(dmg(bench, 1), 0);
  const act = game([{ active: 'Ferrothorn', energy: { active: [M, M, M, M, F] } }, { active: DRA, bench: ['Purrloin'] }]);
  choose(act, 'Attack: Power Whip');
  pick(act, ['Dragapult']);
  assert.equal(dmg(act, 1), 100, '5 Energy');
});

// ------------------------------------------------------------------ Durant

test('Durant, Bite Together: 20, and 20 more if Durant is on your Bench (ruling 2188: once, however many)', () => {
  // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2188/): "No, you only get a maximum of +20 no matter how many Durant are on your bench."
  const none = game([{ active: 'Durant', energy: { active: [M] }, bench: ['Purrloin'] }, { active: DRA, bench: ['Durant'] }]);
  choose(none, 'Attack: Bite Together');
  assert.equal(dmg(none, 1), 20, "the opponent's Durant doesn't count");
  const one = game([{ active: 'Durant', energy: { active: [M] }, bench: ['Durant'] }, { active: DRA }]);
  choose(one, 'Attack: Bite Together');
  assert.equal(dmg(one, 1), 40);
  const two = game([{ active: 'Durant', energy: { active: [M] }, bench: ['Durant', 'Purrloin', 'Durant'] }, { active: DRA }]);
  choose(two, 'Attack: Bite Together');
  assert.equal(dmg(two, 1), 40, 'a maximum of +20');
});

// ------------------------------------------------------------------ Druddigon

test("Druddigon, Shred: 40, and its damage isn't affected by any effects on the opponent's Active Pokémon (Bouffer takes 30 less)", () => {
  const g = game([{ active: 'Druddigon', energy: { active: [R] } }, { active: 'Bouffalant ex' }]);
  choose(g, 'Attack: Shred');
  assert.equal(dmg(g, 1), 40, 'not 10');
});

test('Druddigon, Ambush: 90, and 60 more on heads', () => {
  const heads = game([{ active: 'Druddigon', energy: { active: [R, W, G] } }, { active: DRA }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Ambush');
  assert.equal(dmg(heads, 1), 150);
  const tails = game([{ active: 'Druddigon', energy: { active: [R, W, G] } }, { active: DRA }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Ambush');
  assert.equal(dmg(tails, 1), 90);
});

// ------------------------------------------------------------------ Patrat

test('Patrat, Procurement: search your deck for an Item card, reveal it and put it into your hand', () => {
  const g = gameE([{ active: 'Patrat', energy: { active: [F] } }, { active: DRA }]);
  choose(g, 'Attack: Procurement');
  assert.ok(has(g, 'Ultra Ball') && has(g, 'Poké Ball'));
  assert.ok(!has(g, 'Air Balloon') && !has(g, "Boss's Orders") && !has(g, 'Purrloin'), 'only Item cards');
  pick(g, ['Poké Ball']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), ['Poké Ball']);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

// ------------------------------------------------------------------ Watchog

test("Watchog, Hyper Fang: flip a coin; on tails this attack does nothing, on heads 80", () => {
  const heads = game([{ active: 'Watchog', energy: { active: [F] } }, { active: DRA }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Hyper Fang');
  assert.equal(dmg(heads, 1), 80);
  const tails = game([{ active: 'Watchog', energy: { active: [F] } }, { active: DRA }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Hyper Fang');
  assert.equal(dmg(tails, 1), 0);
});

test("Watchog, Focus Energy: during your next turn, Hyper Fang's base damage is 240 (80 on the turns after)", () => {
  const g = game([{ active: 'Watchog', energy: { active: [F, F] } }, { active: DRA }]);
  g.state.forcedCoins = [true, true, true, true];
  choose(g, 'Attack: Focus Energy');
  assert.equal(dmg(g, 1), 0);
  choose(g, 'End turn'); // the opponent's turn
  choose(g, 'Attack: Hyper Fang');
  assert.equal(dmg(g, 1), 240);
  g.state.p[1].active!.damage = 0;
  choose(g, 'End turn'); // the opponent's turn
  choose(g, 'Attack: Hyper Fang');
  assert.equal(dmg(g, 1), 80, 'only during your next turn');
});

test('Watchog, Focus Energy: tails still does nothing, and without Focus Energy Hyper Fang is 80', () => {
  const g = game([{ active: 'Watchog', energy: { active: [F, F] } }, { active: DRA }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Focus Energy');
  choose(g, 'End turn');
  choose(g, 'Attack: Hyper Fang');
  assert.equal(dmg(g, 1), 0, 'tails: nothing, not even the bonus');
});

test("Watchog, Focus Energy: the effect is gone once this Pokémon has left the Active Spot", () => {
  const g = game([
    { active: 'Watchog', bench: ['Purrloin'], energy: { active: [F, F], 0: [D] } },
    { active: DRA, hand: ["Boss's Orders"] },
  ]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Focus Energy');
  choose(g, "Play Boss's Orders");
  if (g.decision?.kind === 'slots') pick(g, ['Purrloin']);
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Purrloin');
  choose(g, 'End turn');
  choose(g, 'Retreat');
  if (g.decision?.kind === 'slots') pick(g, ['Watchog']);
  if (g.decision?.kind === 'cards') g.submit([0]);
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Watchog');
  choose(g, 'Attack: Hyper Fang');
  assert.equal(dmg(g, 1), 80, 'no 240: it left the Active Spot');
});

// ------------------------------------------------------------------ Stoutland

test('Stoutland, Odor Sleuth: flip 3 coins; put a number of cards up to the number of heads from your discard pile into your hand', () => {
  const disc = ['Purrloin', 'Sawk', 'Zorua', F];
  const two = game([{ active: 'Stoutland', energy: { active: [F, F] }, discard: disc }, { active: DRA }]);
  two.state.forcedCoins = [true, false, true];
  choose(two, 'Attack: Odor Sleuth');
  assert.equal(two.decision?.kind, 'cards');
  assert.equal(two.decision?.max, 2);
  pick(two, ['Sawk', 'Zorua']);
  assert.deepEqual(namesOf(two, two.state.p[0].hand), ['Sawk', 'Zorua']);
  assert.equal(two.state.p[0].discard.length, 2);
  const three = game([{ active: 'Stoutland', energy: { active: [F, F] }, discard: disc }, { active: DRA }]);
  three.state.forcedCoins = [true, true, true];
  choose(three, 'Attack: Odor Sleuth');
  assert.equal(three.decision?.max, 3);
  pick(three, ['Purrloin', 'Sawk', 'Zorua']);
  assert.equal(three.state.p[0].hand.length, 3);
  const none = game([{ active: 'Stoutland', energy: { active: [F, F] }, discard: disc }, { active: DRA }]);
  none.state.forcedCoins = [false, false, false];
  choose(none, 'Attack: Odor Sleuth');
  assert.equal(none.state.p[0].hand.length, 0);
  assert.equal(none.state.p[0].discard.length, 4);
});

test('Stoutland, Odor Sleuth (ruling 2199): with at least one heads you must take at least one card, if able', () => {
  // Ruling (Black Bolt/White Flare FAQ, TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2199/): "No, you must take at least one if you are able to."
  const g = game([{ active: 'Stoutland', energy: { active: [F, F] }, discard: ['Purrloin', 'Sawk'] }, { active: DRA }]);
  g.state.forcedCoins = [true, true, false];
  choose(g, 'Attack: Odor Sleuth');
  assert.equal(g.decision?.min, 1);
  const few = game([{ active: 'Stoutland', energy: { active: [F, F] }, discard: ['Purrloin'] }, { active: DRA }]);
  few.state.forcedCoins = [true, true, true];
  choose(few, 'Attack: Odor Sleuth');
  if (few.decision?.kind === 'cards') pick(few, ['Purrloin']);
  assert.deepEqual(namesOf(few, few.state.p[0].hand), ['Purrloin'], 'a one-card discard pile: that card');
});

test('Stoutland, Special Fang: 100, and 100 more if this Pokémon has any Special Energy attached', () => {
  const plain = game([{ active: 'Stoutland', energy: { active: [F, F, F, F] } }, { active: DRA }]);
  choose(plain, 'Attack: Special Fang');
  assert.equal(dmg(plain, 1), 100);
  const special = game([{ active: 'Stoutland', energy: { active: [F, F, F, TPE] } }, { active: DRA }]);
  choose(special, 'Attack: Special Fang');
  assert.equal(dmg(special, 1), 200);
  const bench = game([{ active: 'Stoutland', bench: ['Purrloin'], energy: { active: [F, F, F, F], 0: [TPE] } }, { active: DRA }]);
  choose(bench, 'Attack: Special Fang');
  assert.equal(dmg(bench, 1), 100, 'Special Energy on another Pokémon does not count');
});

// ------------------------------------------------------------------ Bouffalant ex

test('Bouffalant ex, Gold Breaker: 100, and 100 more if the opponent\'s Active Pokémon is a Pokémon ex', () => {
  const ex = game([{ active: 'Bouffalant ex', energy: { active: [F, F, F] } }, { active: DRA }]);
  choose(ex, 'Attack: Gold Breaker');
  assert.equal(dmg(ex, 1), 200);
  const plain = game([{ active: 'Bouffalant ex', energy: { active: [F, F, F] } }, { active: 'Garbodor' }]);
  choose(plain, 'Attack: Gold Breaker');
  assert.equal(dmg(plain, 1), 100);
});

test('Bouffalant ex, Bouffer: takes 30 less damage from attacks, never below 0', () => {
  const g = game([{ active: 'Bouffalant ex' }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 40, '70 − 30');
  // Psyduck Ram (20) rather than Sawk Elbow Strike (30): the printed Bouffalant ex is weak to Fighting x2, so Sawk now does 60 - 30.
  const small = game([{ active: 'Bouffalant ex' }, { active: 'Psyduck', energy: { active: [P, P] } }], OPP_TURN);
  choose(small, 'Attack: Ram');
  assert.equal(dmg(small, 0), 0, '20 − 30');
});

test('Bouffalant ex, Bouffer: also on the Bench', () => {
  const g = game([{ active: 'Purrloin', bench: ['Bouffalant ex'] }, { active: 'Ferrothorn', energy: { active: [M, M, M] } }], OPP_TURN);
  choose(g, 'Attack: Power Whip');
  pick(g, ['Bouffalant']);
  assert.equal(g.state.p[0].bench[0]!.damage, 30, '60 − 30');
});

// ------------------------------------------------------------------ Tornadus

test('Tornadus, Wrapped in Wind: attach a Basic Energy card from your hand to this Pokémon', () => {
  const g = game([{ active: 'Tornadus', energy: { active: [F] }, hand: [F, R, TPE, 'Purrloin'] }, { active: DRA }]);
  choose(g, 'Attack: Wrapped in Wind');
  assert.ok(!has(g, 'Telepathic') && !has(g, 'Purrloin'), 'a Basic Energy card only');
  pick(g, [R]);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [F, R].sort());
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [F, TPE, 'Purrloin'].sort());
});

test('Tornadus, Hurricane: 100, then move a Basic Energy from this Pokémon to 1 of your Benched Pokémon', () => {
  const g = game([{ active: 'Tornadus', bench: ['Purrloin'], energy: { active: [F, F, TPE] } }, { active: DRA }]);
  choose(g, 'Attack: Hurricane');
  assert.equal(dmg(g, 1), 100);
  assert.deepEqual(namesOf(g, g.state.p[0].bench[0]!.energy), [F]);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.energy), [F, TPE].sort());
});

test('Tornadus, Hurricane (rulings 488, 487): no Basic Energy attached, or no Benched Pokémon: that part is simply not done', () => {
  // Ruling (PUI Rules Team 2011-11-03, https://compendium.pokegym.net/ruling/488/): "If you don't have any Basic Energy cards attached to Tornadus, you simply ignore that part of the Hurricane attack."
  // Ruling (Emerging Powers FAQ 2011-09-01, https://compendium.pokegym.net/ruling/487/): "If you have no Benched Pokemon there is no place to move an energy card, so you would not do that part of the attack."
  const special = game([{ active: 'Tornadus', bench: ['Purrloin'], energy: { active: [TPE, TPE, TPE] } }, { active: DRA }]);
  choose(special, 'Attack: Hurricane');
  assert.equal(dmg(special, 1), 100);
  assert.equal(special.state.p[0].bench[0]!.energy.length, 0);
  assert.equal(special.state.p[0].active!.energy.length, 3);
  const alone = game([{ active: 'Tornadus', energy: { active: [F, F, F] } }, { active: DRA }]);
  choose(alone, 'Attack: Hurricane');
  assert.equal(dmg(alone, 1), 100);
  assert.equal(alone.state.p[0].active!.energy.length, 3);
});

// ------------------------------------------------------------------ Antique Plume Fossil

test("Antique Plume Fossil: benched from hand as a 60-HP Basic {C} Pokémon that can't retreat", () => {
  const g = game([{ active: 'Purrloin', hand: ['Antique Plume Fossil'] }, { active: DRA }]);
  choose(g, 'Bench Antique Plume Fossil');
  const sl = g.state.p[0].bench[0]!;
  assert.equal(maxHp(g.envForInternals, g.state, sl), 60);
  const act = game([{ active: 'Antique Plume Fossil', bench: ['Purrloin'], energy: { active: [F] } }, { active: DRA }]);
  assert.ok(!has(act, 'Retreat'), "can't retreat");
});

test("Antique Plume Fossil, Plume Protection: while on your Bench, all damage done to it by attacks from your opponent's Pokémon is prevented", () => {
  const g = game(
    [{ active: 'Purrloin', bench: ['Antique Plume Fossil', 'Zorua'] }, { active: 'Ferrothorn', energy: { active: [M, M] } }],
    OPP_TURN,
  );
  choose(g, 'Attack: Power Whip');
  pick(g, ['Antique Plume Fossil']);
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  const ctrl = game([{ active: 'Purrloin', bench: ['Antique Plume Fossil', 'Zorua'] }, { active: 'Ferrothorn', energy: { active: [M, M] } }], OPP_TURN);
  choose(ctrl, 'Attack: Power Whip');
  pick(ctrl, ['Zorua']);
  assert.equal(ctrl.state.p[0].bench[1]!.damage, 40, 'another Benched Pokémon is hit');
});

test('Antique Plume Fossil, Plume Protection: no protection in the Active Spot', () => {
  const g = game([{ active: 'Antique Plume Fossil', bench: ['Zorua'] }, { active: 'Sawk', energy: { active: [F] } }], OPP_TURN);
  choose(g, 'Attack: Elbow Strike');
  assert.equal(dmg(g, 0), 30);
});

// ------------------------------------------------------------------ Harlequin

test("Harlequin: each player shuffles their hand into their deck; on heads you draw 5 and your opponent draws 3", () => {
  const g = gameE([
    { active: 'Purrloin', hand: ['Harlequin', 'Sawk', 'Zorua'] },
    { active: DRA, hand: ['Terrakion', 'Dhelmise', 'Garbodor', 'Pecharunt'] },
  ]);
  const d0 = g.state.p[0].deck.length;
  const d1 = g.state.p[1].deck.length;
  g.state.forcedCoins = [true];
  choose(g, 'Play Harlequin');
  assert.equal(g.state.p[0].hand.length, 5);
  assert.equal(g.state.p[1].hand.length, 3);
  assert.equal(g.state.p[0].deck.length, d0 + 2 - 5, 'Sawk and Zorua went into the deck first');
  assert.equal(g.state.p[1].deck.length, d1 + 4 - 3);
  assert.equal(g.events.filter((e) => e.type === 'shuffle').length, 2, 'both decks are shuffled');
});

test('Harlequin: on tails you draw 3 and your opponent draws 5', () => {
  const g = game([{ active: 'Purrloin', hand: ['Harlequin', 'Sawk'] }, { active: DRA, hand: ['Terrakion'] }]);
  g.state.forcedCoins = [false];
  choose(g, 'Play Harlequin');
  assert.equal(g.state.p[0].hand.length, 3);
  assert.equal(g.state.p[1].hand.length, 5);
});

test('Harlequin: cannot be played when it would do nothing (no other cards in either hand, nothing in either deck)', () => {
  const g = game([
    { active: 'Purrloin', hand: ['Harlequin'], emptyDeck: true },
    { active: DRA, emptyDeck: true },
  ]);
  assert.ok(!has(g, 'Play Harlequin'));
  const live = game([{ active: 'Purrloin', hand: ['Harlequin'] }, { active: DRA }]);
  assert.ok(has(live, 'Play Harlequin'));
  const hand = game([
    { active: 'Purrloin', hand: ['Harlequin'], emptyDeck: true },
    { active: DRA, hand: ['Sawk'], emptyDeck: true },
  ]);
  assert.ok(has(hand, 'Play Harlequin'), "the opponent's hand can be shuffled into their deck");
});

// ------------------------------------------------------------------ Pikachu with Grey Felt Hat

test("Pikachu with Grey Felt Hat, Pika-Portrait: search your deck for a Pikachu and put it onto your Bench", () => {
  const g = gameE([{ active: 'Pikachu with Grey Felt Hat', bench: ['Purrloin'], energy: { active: [L] } }, { active: DRA }]);
  choose(g, 'Attack: Pika-Portrait');
  assert.ok(has(g, 'Pikachu'));
  assert.ok(!has(g, 'Pikachu ex') && !has(g, 'Grey Felt Hat'), 'a Pokémon named Pikachu');
  pick(g, ['Pikachu']);
  assert.deepEqual(g.state.p[0].bench.map((b) => nameOf(g, b.cards[0]!)), ['Purrloin', 'Pikachu']);
  assert.ok(g.events.some((e) => e.type === 'shuffle'));
});

test('Pikachu with Grey Felt Hat, Pika-Portrait: nothing happens with a full Bench', () => {
  const g = game([
    { active: 'Pikachu with Grey Felt Hat', bench: ['Purrloin', 'Purrloin', 'Purrloin', 'Purrloin', 'Sawk'], energy: { active: [L] } },
    { active: DRA },
  ]);
  choose(g, 'Attack: Pika-Portrait');
  assert.equal(g.state.p[0].bench.length, 5);
  assert.ok(g.state.p[0].bench.every((b) => nameOf(g, b.cards[0]!) !== 'Pikachu'));
});

// ------------------------------------------------------------------ Picnicker

test('Picnicker: flip a coin; heads draw 4 cards, tails draw 2 cards', () => {
  const heads = game([{ active: 'Purrloin', hand: ['Picnicker'] }, { active: DRA }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Play Picnicker');
  assert.equal(heads.state.p[0].hand.length, 4);
  const tails = game([{ active: 'Purrloin', hand: ['Picnicker'] }, { active: DRA }]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Play Picnicker');
  assert.equal(tails.state.p[0].hand.length, 2);
});

test('Picnicker: cannot be played with no cards in your deck (it would draw nothing)', () => {
  const g = game([{ active: 'Purrloin', hand: ['Picnicker'], emptyDeck: true }, { active: DRA }]);
  assert.ok(!has(g, 'Play Picnicker'));
});

// ------------------------------------------------------------------ Pecharunt

test("Pecharunt, Poison Chain: 10, the opponent's Active Pokémon is now Poisoned, and it can't retreat during their next turn", () => {
  const g = game([{ active: 'Pecharunt', energy: { active: [D, D] } }, { active: DRA, bench: ['Purrloin'], energy: { active: [P] } }]);
  choose(g, 'Attack: Poison Chain');
  assert.ok(g.state.p[1].active!.cond & POISONED);
  assert.equal(dmg(g, 1), 10 + 10 + 50, '10 + Poison 10 + Toxic Subjugation 5 more counters');
  assert.ok(!has(g, 'Retreat'), "can't retreat during the opponent's next turn");
  assert.ok(has(g, 'Attack: Jet Headbutt'), "it is the opponent's turn");
});

test("Pecharunt, Poison Chain: the Defending Pokémon can retreat again two turns later", () => {
  const g = game([{ active: 'Pecharunt', energy: { active: [D, D] } }, { active: DRA, bench: ['Purrloin'], energy: { active: [P] } }]);
  choose(g, 'Attack: Poison Chain');
  assert.ok(!has(g, 'Retreat'));
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Retreat'), "two turns later (the opponent's turn after next) it can");
});

test("Pecharunt, Toxic Subjugation: while in the Active Spot, 5 more damage counters on the opponent's Poisoned Pokémon at Checkup", () => {
  const g = game([{ active: 'Pecharunt' }, { active: DRA, cond: POISONED, bench: ['Purrloin'] }]);
  choose(g, 'End turn');
  assert.equal(dmg(g, 1), 10 + 50, '1 counter for Poison and 5 more');
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
  const calm = game([{ active: 'Pecharunt' }, { active: DRA }]);
  choose(calm, 'End turn');
  assert.equal(dmg(calm, 1), 0, 'not Poisoned: nothing');
});

test("Pecharunt, Toxic Subjugation: nothing from the Bench, and nothing for your own Poisoned Pokémon", () => {
  const bench = game([{ active: 'Purrloin', bench: ['Pecharunt'] }, { active: DRA, cond: POISONED }]);
  choose(bench, 'End turn');
  assert.equal(dmg(bench, 1), 10, 'just Poison');
  const own = game([{ active: 'Pecharunt', cond: POISONED }, { active: DRA }]);
  choose(own, 'End turn');
  assert.equal(dmg(own, 0), 10, 'just Poison');
});

test('Pecharunt, Toxic Subjugation (ruling 2090): a Pecharunt promoted after the Knock Out at Checkup adds nothing that Checkup', () => {
  // Ruling (TPCi Rules Team 2024-12-19, https://compendium.pokegym.net/ruling/2090/): "Both Poisoned Pokemon receive damage counters during Pokemon Checkup, then you check to see if any Pokemon are Knocked Out. A new Active Pokemon is promoted after the check for Special Conditions. So when Pecharunt is promoted Pokemon Checkup is already over and Toxic Subjugation would not apply."
  const g = game([
    { active: 'Garbodor', cond: POISONED },
    { active: 'Purrloin', damage: { active: 50 }, cond: POISONED, bench: ['Pecharunt'] },
  ]);
  choose(g, 'End turn');
  assert.equal(g.state.p[1].active!.cards.length > 0 && nameOf(g, g.state.p[1].active!.cards[0]!), 'Pecharunt', 'Pecharunt was promoted');
  assert.equal(dmg(g, 0), 10, 'only Poison');
});

// ------------------------------------------------------------------ Paradise Resort

test("Paradise Resort: the Retreat Cost of each Psyduck in play (yours and your opponent's) is {C} less", () => {
  const g = game([{ active: 'Psyduck', hand: ['Paradise Resort'], bench: ['Purrloin'] }, { active: 'Psyduck', bench: ['Dragapult ex'] }]);
  const env = g.envForInternals;
  const rc = (p: 0 | 1, bench?: number) => retreatCost(env, g.state, bench === undefined ? g.state.p[p].active! : g.state.p[p].bench[bench]!);
  assert.equal(rc(0), 1);
  assert.equal(rc(0, 0), 1);
  assert.equal(rc(1), 1);
  assert.equal(rc(1, 0), 1);
  choose(g, 'Play Paradise Resort');
  assert.equal(rc(0), 0, 'your Psyduck');
  assert.equal(rc(1), 0, "the opponent's Psyduck");
  assert.equal(rc(0, 0), 1, 'other Pokémon: no change');
  assert.equal(rc(1, 0), 1);
});
