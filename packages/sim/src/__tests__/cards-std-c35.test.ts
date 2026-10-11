/**
 * Card tests, batch "std-c35": every card scripted in cards/scripts/std-c35.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED, type Decision } from '../types.js';
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
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([1]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** If a card choice is pending (an Ability or search asks even when only one card qualifies), answer it with this card. */
function pickIfAsked(g: Game, name: string): void {
  if (g.decision?.kind === 'cards') pick(g, [name]);
}

const IDS: Record<string, string> = {
  'Serperior ex': 'sv10.5b-003',
  Lilligant: 'sv10.5b-007',
  Maractus: 'sv10.5b-008',
  Amoonguss: 'sv10.5b-011',
  Victini: 'sv10.5b-012',
  Larvesta: 'sv10.5b-015',
  Volcarona: 'sv10.5b-016',
  Tympole: 'sv10.5b-019',
  Palpitoad: 'sv10.5b-020',
  Seismitoad: 'sv10.5b-021',
  Tirtouga: 'sv10.5b-022',
  Alomomola: 'sv10.5b-024',
  Beartic: 'sv10.5b-026',
  'Kyurem ex': 'sv10.5b-028',
  Eelektrik: 'sv10.5b-031',
  'Zekrom ex': 'sv10.5b-034',
  Munna: 'sv10.5b-035',
  Musharna: 'sv10.5b-036',
  Duosion: 'sv10.5b-038',
  Reuniclus: 'sv10.5b-039',
  Elgyem: 'sv10.5b-040',
  Beheeyem: 'sv10.5b-041',
  'Meloetta ex': 'sv10.5b-044',
  Fennel: 'sv10.5b-082',
  Solosis: 'sv05-070',
  Rellor: 'sv08-013',
  'Dragapult ex': 'sv06-130',
  'Hero\'s Cape': 'sv05-152',
  Switch: 'me01-130',
  'Jumbo Ice Cream': 'me02-091',
  'Mist Energy': 'sv05-161',
  'Legacy Energy': 'sv06-167',
  Snivy: 'me03-004',
};
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('c35', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FOE: SideLayout = { active: DRA };
const passRound = (g: Game): void => choose(g, 'End turn'); // the opponent does nothing and the turn comes back

// ------------------------------------------------------------------ Serperior ex

test('Serperior ex, Regal Cheer: attacks used by your Pokémon do 20 more damage to the Active Pokémon, and it stacks (Compendium #2186)', () => {
  const dk = deck('Serperior ex', 'Munna', 'Rellor', DRA);
  const hit = (bench: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Munna', energy: { active: [P] }, bench }, FOE]);
    choose(g, 'Attack: Mumble');
    return dmg(g, 1);
  };
  assert.equal(hit([]), 10, 'no Serperior ex: the printed 10');
  assert.equal(hit(['Serperior ex']), 30, '+20 from a Benched Serperior ex, for another Pokémon');
  // Ruling (TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2186/): Multiple copies of the bonus stack for cumulative effects.
  assert.equal(hit(['Serperior ex', 'Serperior ex']), 50, 'two Serperior ex: +40');
  // "to your opponent's Active Pokémon": the Bench is not touched, and the opponent's own attacks are not boosted.
  const spread = scenario(dk, dk, [{ active: 'Munna', energy: { active: [P] }, bench: ['Serperior ex'] }, { active: DRA, bench: ['Rellor'] }]);
  choose(spread, 'Attack: Mumble');
  assert.equal(spread.state.p[1].bench[0]!.damage, 0);
  const foe = scenario(dk, dk, [{ active: DRA }, { active: 'Munna', energy: { active: [P] }, bench: ['Serperior ex'] }], { current: 1 });
  choose(foe, 'Attack: Mumble');
  assert.equal(dmg(foe, 0), 30, "P2's own Serperior boosts P2's attack, not P1's");
  const mine = scenario(dk, dk, [{ active: 'Munna', energy: { active: [P] } }, { active: DRA, bench: ['Serperior ex'] }]);
  choose(mine, 'Attack: Mumble');
  assert.equal(dmg(mine, 1), 10, "the opponent's Serperior ex does nothing for my attacks");
});

test('Serperior ex, Command the Grass: 150 and you may search your deck for up to 3 cards into your hand', () => {
  const dk = deck('Serperior ex', DRA);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Serperior ex', energy: { active: [G, W, W, W] } }, FOE]);
  const g = mk();
  const hand0 = g.state.p[0].hand.length;
  const deck0 = g.state.p[0].deck.length;
  choose(g, 'Attack: Command the Grass');
  assert.equal(dmg(g, 1), 170, '150, +20 from its own Regal Cheer');
  yes(g);
  assert.equal(g.decision?.min, 0);
  assert.equal(g.decision?.max, 3, 'up to 3');
  pick(g, [R, R, W]);
  assert.deepEqual(namesOf(g, g.state.p[0].hand.slice(hand0)), [R, R, W].sort());
  assert.equal(g.state.p[0].deck.length, deck0 - 3);
  // Declining searches nothing.
  const n = mk();
  choose(n, 'Attack: Command the Grass');
  no(n);
  assert.equal(n.state.p[0].hand.length, hand0);
  assert.equal(n.state.p[0].deck.length, deck0);
  // Choosing none is allowed too.
  const z = mk();
  choose(z, 'Attack: Command the Grass');
  yes(z);
  z.submit([]);
  assert.equal(z.state.p[0].hand.length, hand0);
});

// ------------------------------------------------------------------ Lilligant

test('Lilligant, Bemusing Aroma: 30; heads Paralyzes and Poisons the Defending Pokémon, tails Confuses it', () => {
  const dk = deck('Lilligant', DRA);
  const side: SideLayout = { active: 'Lilligant', energy: { active: [G] } };
  const heads = scenario(dk, dk, [side, FOE]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Bemusing Aroma');
  assert.equal(dmg(heads, 1), 30 + 10, '30 plus 1 Poison counter at Checkup');
  assert.equal(heads.state.p[1].active!.cond & PARALYZED, PARALYZED);
  assert.equal(heads.state.p[1].active!.cond & POISONED, POISONED);
  assert.equal(heads.state.p[1].active!.cond & CONFUSED, 0);
  const tails = scenario(dk, dk, [side, FOE]);
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Bemusing Aroma');
  assert.equal(dmg(tails, 1), 30);
  assert.equal(tails.state.p[1].active!.cond, CONFUSED);
});

// ------------------------------------------------------------------ Maractus

test('Maractus, Lively Needles: 20, or 100 more if it was healed this turn (not if the heal removed nothing: Compendium #2198)', () => {
  const dk = deck('Maractus', DRA, 'Jumbo Ice Cream');
  const mk = (damage: number, hand: string[] = []): Game =>
    scenario(dk, dk, [{ active: 'Maractus', energy: { active: [G, G, G] }, damage: { active: damage }, hand }, FOE]);
  const plain = mk(50);
  choose(plain, 'Attack: Lively Needles');
  assert.equal(dmg(plain, 1), 20);
  const healed = mk(50, ['Jumbo Ice Cream']);
  choose(healed, 'Play Jumbo Ice Cream');
  assert.equal(healed.state.p[0].active!.damage, 0, 'healed 80, of which 50 were there');
  choose(healed, 'Attack: Lively Needles');
  assert.equal(dmg(healed, 1), 120);
  // Ruling (TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2198/): Healing that removes zero damage does not count as having healed.
  const clean = mk(0, ['Jumbo Ice Cream']);
  assert.ok(!has(clean, 'Play Jumbo Ice Cream'));
  choose(clean, 'Attack: Lively Needles');
  assert.equal(dmg(clean, 1), 20);
});

// ------------------------------------------------------------------ Amoonguss

test('Amoonguss, Dangerous Reaction: 30, or 120 more if the Defending Pokémon has any Special Condition', () => {
  const dk = deck('Amoonguss', DRA);
  const hit = (cond: number): number => {
    const g = scenario(dk, dk, [{ active: 'Amoonguss', energy: { active: [W] } }, { active: DRA, cond }]);
    g.state.forcedCoins = [false, false, false]; // Checkup: stays Asleep; Burn is not cured
    choose(g, 'Attack: Dangerous Reaction');
    return dmg(g, 1);
  };
  assert.equal(hit(0), 30);
  assert.equal(hit(ASLEEP), 150);
  assert.equal(hit(CONFUSED), 150);
  assert.equal(hit(PARALYZED), 150);
  assert.equal(hit(POISONED), 160, '150, and 1 Poison counter at Checkup');
  assert.equal(hit(BURNED), 170, '150, and 2 damage counters from the Burn at Checkup');
});

// ------------------------------------------------------------------ Victini

test('Victini, V-Force: 120 with 5 Benched Pokémon; with 4 or fewer, the attack does nothing', () => {
  const dk = deck('Victini', 'Rellor', 'Munna', DRA);
  const hit = (n: number): number => {
    const bench = ['Rellor', 'Rellor', 'Rellor', 'Munna', 'Munna'].slice(0, n);
    const g = scenario(dk, dk, [{ active: 'Victini', energy: { active: [R, R] }, bench }, FOE]);
    choose(g, 'Attack: V-Force');
    return dmg(g, 1);
  };
  assert.equal(hit(5), 120);
  assert.equal(hit(4), 0);
  assert.equal(hit(0), 0);
});

// ------------------------------------------------------------------ Larvesta

test("Larvesta, Peck Off: discard all Pokémon Tools from the opponent's Active Pokémon before damage; Benched Tools stay", () => {
  const dk = deck('Larvesta', DRA, "Hero's Cape", 'Munna');
  const g = scenario(dk, dk, [
    { active: 'Larvesta', energy: { active: [R] } },
    { active: DRA, tools: { active: ["Hero's Cape"], 0: ["Hero's Cape"] }, bench: ['Munna'] },
  ]);
  const cape = g.state.p[1].active!.tools[0]!;
  choose(g, 'Attack: Peck Off');
  assert.equal(dmg(g, 1), 10);
  assert.deepEqual(g.state.p[1].active!.tools, []);
  assert.ok(g.state.p[1].discard.includes(cape));
  assert.equal(g.state.p[1].bench[0]!.tools.length, 1, 'the Benched Pokémon keeps its Tool');
  // Before damage: a Pokémon whose Tool gave it +100 HP is no longer held up by it. Here: no Tool, the attack still does its 10.
  const bare = scenario(dk, dk, [{ active: 'Larvesta', energy: { active: [R] } }, FOE]);
  choose(bare, 'Attack: Peck Off');
  assert.equal(dmg(bare, 1), 10);
});

// ------------------------------------------------------------------ Volcarona

test("Volcarona, Torrid Scales: discard a Basic {R} Energy card from your hand to make the opponent's Active Pokémon Burned", () => {
  const dk = deck('Volcarona', DRA, 'Munna');
  const mk = (hand: string[], foe: SideLayout = FOE): Game => scenario(dk, dk, [{ active: 'Volcarona', hand }, foe]);
  const g = mk([R, W]);
  choose(g, 'Use Torrid Scales');
  pickIfAsked(g, R);
  assert.deepEqual(namesOf(g, g.state.p[0].hand), [W], 'only the {R} Energy is discarded');
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [R]);
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
  assert.ok(!has(g, 'Use Torrid Scales'), 'once during your turn');
  // The cost needs a Basic {R} Energy card: not offered with only other Energy, or a Pokémon in the hand.
  assert.ok(!has(mk([W, 'Munna']), 'Use Torrid Scales'));
  // An Ability that can't change anything can't be used (already Burned): the cost is not paid for nothing.
  assert.ok(!has(mk([R], { active: DRA, cond: BURNED }), 'Use Torrid Scales'));
});

// ------------------------------------------------------------------ Round

test('Tympole, Palpitoad and Seismitoad, Round: 20 / 40 / 70 damage for each of your Pokémon in play that has the Round attack', () => {
  const dk = deck('Tympole', 'Palpitoad', 'Seismitoad', 'Munna', DRA);
  const hit = (active: string, energy: string[], bench: string[], foeBench: string[] = []): number => {
    const g = scenario(dk, dk, [{ active, energy: { active: energy }, bench }, { active: DRA, bench: foeBench }]);
    choose(g, 'Attack: Round');
    return dmg(g, 1);
  };
  assert.equal(hit('Tympole', [W, W], []), 20, 'itself');
  assert.equal(hit('Tympole', [W, W], ['Palpitoad', 'Seismitoad', 'Munna']), 60, 'all three Round Pokémon; Munna has no Round');
  assert.equal(hit('Palpitoad', [W, W], []), 40);
  assert.equal(hit('Palpitoad', [W, W], ['Tympole', 'Tympole']), 120, 'Benched Round Pokémon count');
  assert.equal(hit('Seismitoad', [W, W, W], []), 70);
  assert.equal(hit('Seismitoad', [W, W, W], ['Palpitoad']), 140);
  assert.equal(hit('Tympole', [W, W], [], ['Tympole', 'Palpitoad']), 20, "the opponent's Round Pokémon are not yours");
});

// ------------------------------------------------------------------ Tirtouga

test("Tirtouga, Ancient Seaweed: 30 damage for each Item card in the opponent's discard pile (not yours, not other Trainers)", () => {
  const dk = deck('Tirtouga', DRA, 'Switch', "Hero's Cape", 'Fennel');
  const g = scenario(dk, dk, [
    { active: 'Tirtouga', energy: { active: [W] }, discard: ['Switch', 'Switch'] },
    { active: DRA, discard: ['Switch', 'Switch', 'Fennel', "Hero's Cape", W] },
  ]);
  choose(g, 'Attack: Ancient Seaweed');
  assert.equal(dmg(g, 1), 60, 'two Items (a Supporter, a Tool and an Energy do not count)');
  const none = scenario(dk, dk, [{ active: 'Tirtouga', energy: { active: [W] }, discard: ['Switch'] }, FOE]);
  choose(none, 'Attack: Ancient Seaweed');
  assert.equal(dmg(none, 1), 0);
});

// ------------------------------------------------------------------ Alomomola

test('Alomomola, Gentle Fin: from the Active Spot, put a Basic Pokémon with 70 HP or less from your discard pile onto your Bench', () => {
  const dk = deck('Alomomola', 'Munna', 'Tympole', 'Kyurem ex', 'Duosion', 'Rellor', DRA);
  const mk = (o: Partial<SideLayout> = {}): Game =>
    scenario(dk, dk, [{ active: 'Alomomola', discard: ['Munna', 'Tympole', 'Kyurem ex', 'Duosion'], ...o }, FOE]);
  const g = mk();
  choose(g, 'Use Gentle Fin');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.values?.length, 2, 'Munna and Tympole: Kyurem ex has 230 HP and Duosion is not Basic');
  pick(g, ['Munna']);
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map((b) => b.cards[0]!)), ['Munna']);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), ['Duosion', 'Kyurem ex', 'Tympole']);
  assert.ok(!has(g, 'Use Gentle Fin'), 'once during your turn');
  // Not from the Bench.
  const bench = scenario(dk, dk, [{ active: 'Rellor', bench: ['Alomomola'], discard: ['Munna'] }, FOE]);
  assert.ok(!has(bench, 'Use Gentle Fin'));
  // No such Pokémon in the discard pile, or no room on the Bench.
  assert.ok(!has(mk({ discard: ['Kyurem ex', 'Duosion'] }), 'Use Gentle Fin'));
  assert.ok(!has(mk({ bench: ['Rellor', 'Rellor', 'Rellor', 'Rellor', 'Tympole'] }), 'Use Gentle Fin'));
});

// ------------------------------------------------------------------ Beartic

test('Beartic, Continuous Headbutt: flip until tails, 50 damage for each heads', () => {
  const dk = deck('Beartic', DRA);
  const hit = (coins: boolean[]): number => {
    const g = scenario(dk, dk, [{ active: 'Beartic', energy: { active: [W] } }, FOE]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Continuous Headbutt');
    return dmg(g, 1);
  };
  assert.equal(hit([false]), 0);
  assert.equal(hit([true, false]), 50);
  assert.equal(hit([true, true, true, false]), 150);
});

test("Beartic, Sheer Cold: 150, and during the opponent's next turn the Defending Pokémon can't use attacks", () => {
  const dk = deck('Beartic', DRA, 'Munna');
  const foe: SideLayout = { active: DRA, energy: { active: [P] } };
  const g = scenario(dk, dk, [{ active: 'Beartic', energy: { active: [W, W, W, W] } }, foe]);
  choose(g, 'Attack: Sheer Cold');
  assert.equal(dmg(g, 1), 150);
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Attack: Jet Headbutt'), "the Defending Pokémon can't use attacks");
  passRound(g);
  // The turn after, the effect has run out.
  assert.equal(g.state.current, 0);
  choose(g, 'Attack: Sheer Cold');
  // Without Sheer Cold the same Defending Pokémon can attack.
  const other = scenario(dk, dk, [{ active: 'Beartic', energy: { active: [W] } }, foe]);
  other.state.forcedCoins = [false];
  choose(other, 'Attack: Continuous Headbutt');
  assert.ok(has(other, 'Attack: Jet Headbutt'));
});

// ------------------------------------------------------------------ Kyurem ex

test("Kyurem ex, Blizzard Burst: 130, and 10 damage to each of the opponent's Benched Pokémon for each Prize card they have taken", () => {
  const dk = deck('Kyurem ex', DRA, 'Munna', 'Rellor');
  const mk = (prizes: number): Game =>
    scenario(dk, dk, [{ active: 'Kyurem ex', energy: { active: [W, W, W] } }, { active: DRA, bench: ['Munna', 'Rellor'], prizes }]);
  const g = mk(3); // 3 taken
  choose(g, 'Attack: Blizzard Burst');
  assert.equal(dmg(g, 1), 130);
  assert.deepEqual(g.state.p[1].bench.map((b) => b.damage), [30, 30]);
  const none = mk(6);
  choose(none, 'Attack: Blizzard Burst');
  assert.equal(dmg(none, 1), 130);
  assert.deepEqual(none.state.p[1].bench.map((b) => b.damage), [0, 0], 'no Prize cards taken: nothing to the Bench');
  const mine = scenario(dk, dk, [{ active: 'Kyurem ex', energy: { active: [W, W, W] }, bench: ['Munna'], prizes: 2 }, { active: DRA, bench: ['Rellor'], prizes: 6 }]);
  choose(mine, 'Attack: Blizzard Burst');
  assert.deepEqual(mine.state.p[0].bench.map((b) => b.damage), [0], 'my own Bench is never hit');
  assert.deepEqual(mine.state.p[1].bench.map((b) => b.damage), [0], "the Prize cards that count are the opponent's");
});

// ------------------------------------------------------------------ Eelektrik

test('Eelektrik, Dynamotor: attach a Basic {L} Energy card from your discard pile to 1 of your Benched Pokémon (Compendium #2182: Basic only)', () => {
  const dk = deck('Eelektrik', 'Munna', 'Rellor', 'Legacy Energy', DRA);
  const mk = (o: Partial<SideLayout> = {}): Game =>
    scenario(dk, dk, [{ active: 'Eelektrik', bench: ['Munna', 'Rellor'], discard: [L, W], ...o }, FOE]);
  const g = mk();
  choose(g, 'Use Dynamotor');
  pickIfAsked(g, L);
  choose(g, 'Rellor');
  assert.deepEqual(namesOf(g, g.state.p[0].bench[1]!.energy), [L]);
  assert.deepEqual(namesOf(g, g.state.p[0].bench[0]!.energy), []);
  assert.deepEqual(namesOf(g, g.state.p[0].discard), [W]);
  assert.ok(!has(g, 'Use Dynamotor'), 'once during your turn');
  // Ruling (TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2182/): the card specifies Basic Energy, so Special Energy that provides the type does not qualify.
  assert.ok(!has(mk({ discard: ['Legacy Energy', W] }), 'Use Dynamotor'));
  // Needs a Benched Pokémon.
  assert.ok(!has(mk({ bench: [] }), 'Use Dynamotor'));
});

// ------------------------------------------------------------------ Zekrom ex

test('Zekrom ex, Voltage Burst: 130, +50 for each Prize card the opponent has taken, and 30 damage to itself', () => {
  const dk = deck('Zekrom ex', DRA);
  const mk = (prizes: number): Game =>
    scenario(dk, dk, [{ active: 'Zekrom ex', energy: { active: [L, L, W] } }, { active: DRA, prizes }]);
  const none = mk(6);
  choose(none, 'Attack: Voltage Burst');
  assert.equal(dmg(none, 1), 130);
  assert.equal(dmg(none, 0), 30, 'also does 30 damage to itself');
  const two = mk(4);
  choose(two, 'Attack: Voltage Burst');
  assert.equal(dmg(two, 1), 230, '2 Prize cards taken: +100');
  assert.equal(dmg(two, 0), 30);
});

// ------------------------------------------------------------------ Munna

test('Munna, Rest: this Pokémon is now Asleep and heals 30 damage from itself (only what it has)', () => {
  const dk = deck('Munna', DRA);
  const rest = (damage: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Munna', energy: { active: [P] }, damage: { active: damage } }, FOE]);
    g.state.forcedCoins = [false]; // Checkup: tails, it stays Asleep
    choose(g, 'Attack: Rest');
    return g;
  };
  const g = rest(50);
  assert.equal(dmg(g, 0), 20);
  assert.equal(g.state.p[0].active!.cond & ASLEEP, ASLEEP);
  assert.equal(dmg(g, 1), 0, 'no damage to the Defending Pokémon');
  assert.equal(dmg(rest(10), 0), 0);
});

// ------------------------------------------------------------------ Musharna

test('Musharna, Dream Calling: you may search your deck for any number of Fennel cards, reveal them and put them into your hand', () => {
  const dk = deck('Musharna', 'Fennel', DRA);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Musharna', energy: { active: [P] } }, FOE]);
  const g = mk();
  const hand0 = g.state.p[0].hand.length;
  choose(g, 'Attack: Dream Calling');
  yes(g);
  assert.equal(g.decision?.min, 0);
  assert.equal(g.decision?.max, 4, 'any number: all 4 Fennel in the deck');
  pick(g, ['Fennel', 'Fennel', 'Fennel']);
  assert.deepEqual(namesOf(g, g.state.p[0].hand.slice(hand0)), ['Fennel', 'Fennel', 'Fennel']);
  assert.equal(g.state.p[0].deck.filter((c) => nameOf(g, c) === 'Fennel').length, 1);
  const n = mk();
  choose(n, 'Attack: Dream Calling');
  no(n);
  assert.equal(n.state.p[0].hand.length, hand0);
});

test("Musharna, Sleep Pulse: 50, and the opponent's Active Pokémon is now Asleep", () => {
  const dk = deck('Musharna', DRA);
  const g = scenario(dk, dk, [{ active: 'Musharna', energy: { active: [P] } }, FOE]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Sleep Pulse');
  assert.equal(dmg(g, 1), 50);
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP);
});

// ------------------------------------------------------------------ Duosion

test('Duosion, Cellular Evolution: search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon', () => {
  const dk = deck('Duosion', 'Reuniclus', 'Solosis', 'Munna', DRA);
  const g = scenario(dk, dk, [{ active: 'Duosion', energy: { active: [P] }, bench: ['Solosis', 'Munna'] }, FOE]);
  choose(g, 'Attack: Cellular Evolution');
  assert.equal(g.decision?.kind, 'slots', 'first choose the Pokémon');
  choose(g, 'Solosis');
  assert.equal(g.decision?.kind, 'cards');
  assert.deepEqual(namesOf(g, g.decision!.values as number[]), ['Duosion', 'Duosion', 'Duosion'], 'only cards that evolve from Solosis');
  pick(g, ['Duosion']);
  assert.deepEqual(namesOf(g, g.state.p[0].bench[0]!.cards), ['Duosion', 'Solosis']);
  assert.equal(def(g.ctx, g.state.p[0].bench[0]!.cards.at(-1)!).name, 'Duosion', 'on top');
  assert.deepEqual(namesOf(g, g.state.p[0].bench[1]!.cards), ['Munna'], 'the other Pokémon is untouched');
  // The Active Duosion can be the one chosen, evolving into Reuniclus.
  const h = scenario(dk, dk, [{ active: 'Duosion', energy: { active: [P] }, bench: ['Munna'] }, FOE]);
  choose(h, 'Attack: Cellular Evolution');
  choose(h, 'Duosion');
  pick(h, ['Reuniclus']);
  assert.equal(def(h.ctx, h.state.p[0].active!.cards.at(-1)!).name, 'Reuniclus');
  // A Pokémon nothing evolves from: nothing is found.
  const none = scenario(dk, dk, [{ active: 'Duosion', energy: { active: [P] }, bench: ['Munna'] }, FOE]);
  choose(none, 'Attack: Cellular Evolution');
  choose(none, 'Munna');
  assert.equal(none.state.p[0].bench[0]!.cards.length, 1);
});

// ------------------------------------------------------------------ Reuniclus

test('Reuniclus, Cellular Ascension: for each of your Benched Pokémon, search your deck for a card that evolves from it and put it onto it', () => {
  const dk = deck('Reuniclus', 'Duosion', 'Solosis', 'Munna', DRA);
  const g = scenario(dk, dk, [{ active: 'Reuniclus', energy: { active: [P] }, bench: ['Solosis', 'Duosion', 'Munna'] }, FOE]);
  choose(g, 'Attack: Cellular Ascension');
  pick(g, ['Duosion']); // Solosis
  pick(g, ['Reuniclus']); // Duosion (Munna has nothing to evolve into: not asked)
  const bench = g.state.p[0].bench;
  assert.deepEqual(namesOf(g, bench[0]!.cards), ['Duosion', 'Solosis']);
  assert.deepEqual(namesOf(g, bench[1]!.cards), ['Duosion', 'Reuniclus']);
  assert.deepEqual(namesOf(g, bench[2]!.cards), ['Munna']);
  assert.equal(g.state.p[0].active!.cards.length, 1, 'the Active Pokémon is not Benched');
});

test('Reuniclus, Evo-Lariat: 40, and 40 more for each of your Evolution Pokémon in play', () => {
  const dk = deck('Reuniclus', 'Duosion', 'Solosis', DRA);
  const hit = (bench: string[], foeBench: string[] = []): number => {
    const g = scenario(dk, dk, [{ active: 'Reuniclus', energy: { active: [P] }, bench }, { active: DRA, bench: foeBench }]);
    choose(g, 'Attack: Evo-Lariat');
    return dmg(g, 1);
  };
  assert.equal(hit([]), 80, 'itself is an Evolution Pokémon');
  assert.equal(hit(['Duosion']), 120);
  assert.equal(hit(['Solosis', 'Duosion', 'Duosion']), 160, 'a Basic Pokémon does not count');
  assert.equal(hit([], ['Duosion']), 80, "the opponent's Evolution Pokémon do not count");
});

// ------------------------------------------------------------------ Elgyem

test("Elgyem, Slight Shift: move an Energy from 1 of the opponent's Pokémon to another of their Pokémon", () => {
  const dk = deck('Elgyem', DRA, 'Munna', 'Rellor', 'Mist Energy');
  const mk = (foe: SideLayout): Game => scenario(dk, dk, [{ active: 'Elgyem', energy: { active: [P] } }, foe]);
  const g = mk({ active: DRA, energy: { active: [P, W] }, bench: ['Munna', 'Rellor'] });
  choose(g, 'Attack: Slight Shift');
  assert.equal(g.decision?.kind, 'cards');
  choose(g, 'Water Energy on Dragapult ex');
  assert.equal(g.decision?.kind, 'slots', 'a choice between the two Benched Pokémon');
  assert.equal(g.decision?.values?.length, 2);
  choose(g, 'Rellor');
  const foe = g.state.p[1];
  assert.deepEqual(namesOf(g, foe.active!.energy), [P]);
  assert.deepEqual(namesOf(g, foe.bench[1]!.energy), [W]);
  assert.deepEqual(namesOf(g, foe.bench[0]!.energy), []);
  // From a Benched Pokémon to the Active Pokémon.
  const b = mk({ active: DRA, bench: ['Munna'] });
  b.state.p[1].bench[0]!.energy.push(b.state.p[1].deck.find((c) => nameOf(b, c) === W)!);
  b.state.p[1].deck = b.state.p[1].deck.filter((c) => !b.state.p[1].bench[0]!.energy.includes(c));
  choose(b, 'Attack: Slight Shift');
  pickIfAsked(b, W);
  assert.deepEqual(namesOf(b, b.state.p[1].active!.energy), [W], 'a single possible destination needs no question');
  // Only one Pokémon: nothing to move to.
  const solo = mk({ active: DRA, energy: { active: [P] } });
  choose(solo, 'Attack: Slight Shift');
  assert.deepEqual(namesOf(solo, solo.state.p[1].active!.energy), [P]);
  // Ruling (TPCi Rules Team 2026-06-04, https://compendium.pokegym.net/ruling/2375/): Mist Energy on the Defending Pokémon cannot be moved elsewhere.
  const mist = mk({ active: DRA, energy: { active: ['Mist Energy'] }, bench: ['Munna', 'Rellor'] });
  mist.state.p[1].bench[0]!.energy.push(mist.state.p[1].deck.find((c) => nameOf(mist, c) === W)!);
  mist.state.p[1].deck = mist.state.p[1].deck.filter((c) => !mist.state.p[1].bench[0]!.energy.includes(c));
  choose(mist, 'Attack: Slight Shift');
  pickIfAsked(mist, W);
  assert.deepEqual(namesOf(mist, mist.state.p[1].active!.energy), ['Mist Energy'], 'the protected Pokémon keeps its Energy');
  assert.deepEqual(namesOf(mist, mist.state.p[1].bench[0]!.energy), [], 'and the unprotected one moved its Energy to the other unprotected one');
  assert.deepEqual(namesOf(mist, mist.state.p[1].bench[1]!.energy), [W]);
});

// ------------------------------------------------------------------ Beheeyem

test('Beheeyem, Calm Mind: heal 40 damage from this Pokémon', () => {
  const dk = deck('Beheeyem', DRA);
  const g = scenario(dk, dk, [{ active: 'Beheeyem', energy: { active: [P] }, damage: { active: 70 } }, FOE]);
  choose(g, 'Attack: Calm Mind');
  assert.equal(dmg(g, 0), 30);
  const low = scenario(dk, dk, [{ active: 'Beheeyem', energy: { active: [P] }, damage: { active: 20 } }, FOE]);
  choose(low, 'Attack: Calm Mind');
  assert.equal(dmg(low, 0), 0);
});

test("Beheeyem, Psychic: 80, and 30 more for each Energy attached to the opponent's Active Pokémon", () => {
  const dk = deck('Beheeyem', DRA, 'Munna');
  const hit = (foe: SideLayout): number => {
    const g = scenario(dk, dk, [{ active: 'Beheeyem', energy: { active: [P, P, P] }, bench: ['Munna'] }, foe]);
    choose(g, 'Attack: Psychic');
    return dmg(g, 1);
  };
  assert.equal(hit(FOE), 80);
  assert.equal(hit({ active: DRA, energy: { active: [R, W] } }), 140);
  assert.equal(hit({ active: DRA, energy: { active: [R, W, W, L] }, bench: ['Munna'] }), 200);
});

// ------------------------------------------------------------------ Meloetta ex

test("Meloetta ex, Echoed Voice: 30; during your next turn it does 80 more, and the bonus doesn't stack (Compendium #2191)", () => {
  const dk = deck('Meloetta ex', DRA);
  const g = scenario(dk, dk, [{ active: 'Meloetta ex', energy: { active: [P] } }, FOE]);
  const dealt: number[] = [];
  let before = 0;
  for (let i = 0; i < 3; i++) {
    choose(g, 'Attack: Echoed Voice');
    dealt.push(dmg(g, 1) - before);
    before = dmg(g, 1);
    if (i < 2) passRound(g);
  }
  // Ruling (TPCi Rules Team 2025-07-17, https://compendium.pokegym.net/ruling/2191/): damage dealt is 30, then 110 on subsequent turns when bonused.
  assert.deepEqual(dealt, [30, 110, 110]);
  // Only the next turn: skip a turn (no attack) and the bonus is gone.
  const skip = scenario(dk, dk, [{ active: 'Meloetta ex', energy: { active: [P] } }, FOE]);
  choose(skip, 'Attack: Echoed Voice');
  passRound(skip); // the opponent's turn
  passRound(skip); // my turn: no attack
  passRound(skip); // the opponent's turn again
  choose(skip, 'Attack: Echoed Voice');
  assert.equal(dmg(skip, 1), 60);
});

test('Meloetta ex, Debut Performance: if you go first, it can use attacks during your first turn (Compendium #2181)', () => {
  const dk = deck('Meloetta ex', DRA, 'Munna');
  const first = scenario(dk, dk, [{ active: 'Meloetta ex', energy: { active: [P] } }, FOE], { turn: 1, current: 0, first: 0 });
  assert.ok(has(first, 'Attack: Echoed Voice'), 'the first player can attack on turn 1');
  choose(first, 'Attack: Echoed Voice');
  assert.equal(dmg(first, 1), 30);
  // A Pokémon without the Ability can not.
  const other = scenario(dk, dk, [{ active: 'Munna', energy: { active: [P] } }, FOE], { turn: 1, current: 0, first: 0 });
  assert.ok(!has(other, 'Attack: Mumble'));
});
