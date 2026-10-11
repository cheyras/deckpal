/**
 * Rulings audit, lane 06: one scenario test per Compendium ruling filed under these cards. Each test cites the ruling by
 * https://compendium.pokegym.net/ruling/<id>/ and carries a one-line summary in our own words (the Compendium's text is not
 * copied into this repository). Rulings that cannot be pinned by a simulator test are listed in REVIEWED with the reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { BURNED, type Decision } from '../types.js';
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
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const namesOf = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

/** Rulings that no simulator test can pin. Format: Compendium id and the specific reason. */
const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #1542',
    why: "unscripted card: the ruling hinges on Blissey V's Blissful Blast (attach Energy from the discard pile based on the damage done), which is not a card in the simulator's snapshot (only Blissey ex exists); Dunsparce's Dig is pinned by its own card tests",
  },
];

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 12]);
const IDS: [string, number][] = [
  ['me02-085', 2], // Battle Cage
  ['me05-035', 2], // Spiritomb
  ['me05-033', 14], // Shuppet (Hide 'n' Sneak) for Spiritomb's discard pile
  ['sv06-128', 8], // Dreepy
  ['sv06-130', 4], // Dragapult ex (320 HP, no Weakness): a neutral target and attacker
  ['me04-080', 2], // Prism Tower
  ['me04-068', 2], // Goodra
  ['me02.5-051', 2], // N's Vanilluxe
  ['sv09-042', 2], // Regice
  ['me02-087', 2], // Dawn
  ['sv05-041', 2], // Feraligatr
  ['sv05-040', 2], // Croconaw
  ['sv05-039', 2], // Totodile
  ['me01-118', 4], // Iron Defender
  ['me04-060', 4], // Metang
  ['sv10.5w-046', 2], // Roggenrola
  ['sv09-002', 2], // Metapod
  ['me01-008', 2], // Chikorita (Grass, Razor Leaf 20)
  ['me01-012', 2], // Celebi (Grass, Solar Cutter 30)
  ['sv09-030', 2], // Reshiram ex (Fire, Fire Wing 40)
  ['me01-114', 2], // Boss's Orders
  ['sv10-119', 2], // Team Rocket's Nidoking ex
  ['sv09-157', 2], // Ruffian
  ['sv10.5b-079', 2], // Air Balloon
  ['me03-088', 2], // Telepathic Psychic Energy (Special)
  ['sv08-153', 2], // Braviary
  ['sv10-091', 2], // Primeape
  ['sv10.5b-027', 2], // Cryogonal
  ['sv07-088', 2], // Falinks
  ['sv07-131', 2], // Area Zero Underdepths
  ['sv07-128', 2], // Terapagos ex (Tera)
  ['sv06-167', 1], // Legacy Energy
  ['sv06-096', 2], // Fezandipiti
  ['sv08.5-082', 2], // Lugia ex
  ['sv09-058', 2], // Mr. Mime
  ['sv08.5-064', 2], // Tyranitar ex
  ['sv09-081', 2], // Pupitar
  ['sv09-080', 2], // Larvitar
  ['sv05-162', 1], // Neo Upper Energy
  ['sv06-129', 2], // Drakloak
  ['me05-039', 4], // Dhelmise (a Basic for Dawn)
  ...ENERGY,
];
const DK = fromIds('r06', IDS);
const R = 'Fire Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const F = 'Fighting Energy';
const G = 'Grass Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const C = 'Lightning Energy';
const at = (sides: [SideLayout, SideLayout], o: Parameters<typeof scenario>[3] = {}): Game => scenario(DK, DK, sides, o);
const DRA = 'Dragapult ex';

function setStadium(g: Game, owner: 0 | 1, nm: string): void {
  const deckCards = g.state.p[owner].deck;
  const i = deckCards.findIndex((c) => nameOf(g, c) === nm);
  assert.ok(i >= 0, `no ${nm} in the deck`);
  g.state.stadium = { card: deckCards.splice(i, 1)[0]!, owner };
}

// ------------------------------------------------------------------ Battle Cage

// https://compendium.pokegym.net/ruling/2412/ : with Battle Cage in play, Spiritomb's quadrupling does nothing to a chosen Benched Pokémon that has damage counters.
test("Battle Cage x Spiritomb, Spiritual End (ruling 2412): a chosen Benched Pokémon is protected, the chosen Active is not", () => {
  for (const owner of [0, 1] as const) {
    const g = at([
      { active: 'Spiritomb', energy: { active: [P] }, discard: Array(13).fill('Shuppet') },
      { active: DRA, bench: ['Drakloak'], damage: { active: 30, 0: 20 } },
    ]);
    setStadium(g, owner, 'Battle Cage');
    choose(g, 'Attack: Spiritual End'); // 2 Pokémon in play: both are chosen
    assert.equal(dmg(g, 1), 120, `owner ${owner}: the Active Pokémon goes from 3 counters to 12`);
    assert.equal(g.state.p[1].bench[0]!.damage, 20, `owner ${owner}: the Benched Pokémon is protected by Battle Cage`);
  }
  const free = at([
    { active: 'Spiritomb', energy: { active: [P] }, discard: Array(13).fill('Shuppet') },
    { active: DRA, bench: ['Drakloak'], damage: { active: 30, 0: 20 } },
  ]);
  choose(free, 'Attack: Spiritual End');
  assert.equal(free.state.p[1].bench[0]!.damage, 80, 'without Battle Cage the Benched Pokémon gets 8 counters');
});

// https://compendium.pokegym.net/ruling/2294/ : Snow Coating can't double the counters on a Benched Pokémon under Battle Cage, since doubling places counters.
test("Battle Cage x N's Vanilluxe, Snow Coating (ruling 2294): a Benched Pokémon's counters are not doubled", () => {
  const g = at([
    { active: "N's Vanilluxe", energy: { active: [W, W] } },
    { active: DRA, bench: ['Dreepy'], damage: { active: 20, 0: 30 } },
  ]);
  setStadium(g, 1, 'Battle Cage');
  choose(g, 'Attack: Snow Coating');
  assert.equal(dmg(g, 1), 40, 'the Active Pokémon is doubled');
  assert.equal(g.state.p[1].bench[0]!.damage, 30, 'the Benched Pokémon (3 counters) is protected');
  const free = at([
    { active: "N's Vanilluxe", energy: { active: [W, W] } },
    { active: DRA, bench: ['Dreepy'], damage: { active: 20, 0: 30 } },
  ]);
  choose(free, 'Attack: Snow Coating');
  assert.equal(free.state.p[1].bench[0]!.damage, 60, 'without Battle Cage the Benched Pokémon is doubled');
});

// https://compendium.pokegym.net/ruling/2289/ : Battle Cage stops counters, not damage: Blizzard's 10 damage to each Benched Pokémon is still taken.
test("Battle Cage x Blizzard (ruling 2289): the 10 damage to each Benched Pokémon is still done", () => {
  for (const [who, attacker, cost] of [
    ["N's Vanilluxe", "N's Vanilluxe", [W, W, W]],
    ['Regice', 'Regice', [W, W, W]],
  ] as const) {
    const g = at([
      { active: attacker, energy: { active: [...cost] } },
      { active: DRA, bench: ['Dreepy', 'Dreepy'] },
    ]);
    setStadium(g, 1, 'Battle Cage');
    choose(g, 'Attack: Blizzard');
    assert.deepEqual([g.state.p[1].bench[0]!.damage, g.state.p[1].bench[1]!.damage], [10, 10], `${who}: Battle Cage does not stop damage`);
  }
});

// https://compendium.pokegym.net/ruling/2261/ : Battle Cage only blocks the opponent's effects; your own Ability still puts counters on your own Benched Pokémon.
// (Gardevoir ex's Psychic Embrace is not in the card snapshot; Feraligatr's Torrential Heart is the same shape: your own Ability, counters on your own Pokémon.)
test("Battle Cage (ruling 2261): your own Ability still places damage counters on your own Benched Pokémon", () => {
  for (const owner of [0, 1] as const) {
    const g = at([
      { active: DRA, bench: ['Totodile'], evolve: { 0: ['Croconaw', 'Feraligatr'] } },
      { active: DRA },
    ]);
    setStadium(g, owner, 'Battle Cage');
    assert.equal(g.state.p[0].bench.length, 1);
    choose(g, 'Torrential Heart');
    assert.equal(g.state.p[0].bench[0]!.damage, 50, `owner ${owner}: 5 counters on the Benched Feraligatr`);
  }
});

// ------------------------------------------------------------------ Prism Tower

// https://compendium.pokegym.net/ruling/2363/ : Prism Tower can't be used with fewer than 2 cards in hand (it must be able to discard 2).
test('Prism Tower (ruling 2363): not usable with only one card in hand', () => {
  const use = 'Use the Stadium (Prism Tower)';
  const one = at([{ active: DRA, hand: ['Prism Tower', 'Dreepy'] }, { active: DRA }]);
  choose(one, 'Play Prism Tower');
  assert.ok(!has(one, use), 'Prism Tower was usable with 1 card in hand');
  const two = at([{ active: DRA, hand: ['Prism Tower', 'Dreepy', 'Dreepy'] }, { active: DRA }]);
  choose(two, 'Play Prism Tower');
  assert.ok(has(two, use), 'Prism Tower was not usable with 2 cards in hand');
  choose(two, use);
  assert.equal(two.state.p[0].hand.length, 1, 'two discarded, one drawn');
  assert.equal(two.state.p[0].discard.length, 2);
});

// https://compendium.pokegym.net/ruling/2362/ : Prism Tower can't be used with an empty deck (no discarding 2 cards for no effect).
test('Prism Tower (ruling 2362): not usable with no cards in the deck', () => {
  const use = 'Use the Stadium (Prism Tower)';
  const empty = at([{ active: DRA, hand: ['Prism Tower', 'Dreepy', 'Dreepy'], emptyDeck: true }, { active: DRA }]);
  assert.equal(empty.state.p[0].deck.length, 0);
  choose(empty, 'Play Prism Tower');
  assert.ok(!has(empty, use), 'Prism Tower was usable with an empty deck');
});

// ------------------------------------------------------------------ Goodra

// https://compendium.pokegym.net/ruling/2348/ : after a tails on Slimy Sliding the retreat is used up for the turn, even though nothing was paid and nothing switched.
test("Goodra, Slimy Sliding (ruling 2348): a failed retreat uses up the turn's retreat", () => {
  const g = at(
    [
      { active: 'Goodra', bench: ['Dreepy'], energy: { active: [W, P] } },
      { active: 'Dreepy', bench: ['Dreepy'], energy: { active: [P, P] } },
    ],
    { current: 1, first: 0, turn: 4 },
  );
  const mine = g.state.p[1].active!;
  g.state.forcedCoins = [false];
  choose(g, 'Retreat');
  assert.equal(g.state.p[1].active, mine, 'tails: no switch');
  assert.equal(mine.energy.length, 2, 'tails: no Energy discarded');
  assert.ok(!has(g, 'Retreat'), 'a second retreat is not offered this turn');
});

// ------------------------------------------------------------------ Dawn

// https://compendium.pokegym.net/ruling/2263/ : Dawn's three searches may each come up empty by choice: take one, two, three or none of the cards.
test('Dawn (ruling 2263): each of the three searches may be declined, up to none at all', () => {
  /** One answer per search (Basic, Stage 1, Stage 2): a card name, or null to take none. */
  const run = (answers: (string | null)[]): string[] => {
    const g = at([{ active: DRA, hand: ['Dawn'] }, { active: DRA }]);
    choose(g, 'Play Dawn');
    for (const a of answers) {
      if (a === null) g.submit([]);
      else choose(g, a);
    }
    return namesOf(g, g.state.p[0].hand);
  };
  assert.deepEqual(run(['Dreepy', 'Drakloak', DRA]), [DRA, 'Drakloak', 'Dreepy'], 'all three');
  assert.deepEqual(run(['Dreepy', null, null]), ['Dreepy'], 'only the Basic');
  assert.deepEqual(run([null, 'Drakloak', null]), ['Drakloak'], 'only the Stage 1');
  assert.deepEqual(run([null, null, null]), [], 'none at all');
});

// ------------------------------------------------------------------ Iron Defender

// https://compendium.pokegym.net/ruling/2230/ : Iron Defender stacks: each copy played takes another 30 off damage to your {M} Pokémon.
test('Iron Defender (ruling 2230): two copies take 60 off, one takes 30', () => {
  const play = (copies: number): number => {
    const g = at([
      { active: 'Metang', hand: Array(copies).fill('Iron Defender') },
      { active: DRA, energy: { active: [R] } },
    ]);
    for (let i = 0; i < copies; i++) choose(g, 'Play Iron Defender');
    choose(g, 'End turn');
    choose(g, 'Attack: Jet Headbutt');
    return g.state.p[0].active!.damage;
  };
  assert.equal(play(0), 70);
  assert.equal(play(1), 40);
  assert.equal(play(2), 10);
});

// ------------------------------------------------------------------ Harden

/** P0's `holder` uses Harden; P1's `striker` then attacks it with `attack`. Returns the holder's damage. */
function hardenVs(holder: SideLayout, striker: SideLayout, hardenCost: string, attack: string): number {
  const g = at([holder, striker]);
  choose(g, hardenCost);
  choose(g, attack);
  return g.state.p[0].active!.damage;
}

// https://compendium.pokegym.net/ruling/2197/ : Roggenrola's Harden compares the damage AFTER Weakness: 30 + Weakness is not prevented, 20 + Weakness is.
test('Roggenrola, Harden (ruling 2197): Weakness is applied before the 40-or-less check', () => {
  const holder: SideLayout = { active: 'Roggenrola', energy: { active: [F] } };
  assert.equal(hardenVs(holder, { active: 'Celebi', energy: { active: [G] } }, 'Attack: Harden', 'Attack: Solar Cutter'), 60, '30 x2 = 60 > 40: taken');
  assert.equal(hardenVs(holder, { active: 'Chikorita', energy: { active: [G] } }, 'Attack: Harden', 'Attack: Razor Leaf'), 0, '20 x2 = 40: prevented');
});

// https://compendium.pokegym.net/ruling/472/ : the same order for an older Harden (Seedot's): Weakness first, then the threshold. Metapod's 60-or-less is the same text in our pool.
test('Metapod, Harden (ruling 472): Weakness is applied before the 60-or-less check', () => {
  const holder: SideLayout = { active: 'Metapod', energy: { active: [G] } };
  assert.equal(hardenVs(holder, { active: 'Reshiram ex', energy: { active: [R] } }, 'Attack: Harden', 'Attack: Fire Wing'), 80, '40 x2 = 80 > 60: taken');
});

// https://compendium.pokegym.net/ruling/2196/ : once Roggenrola leaves the Active Spot, Harden no longer protects it (damage to it on the Bench is taken).
test('Roggenrola, Harden (ruling 2196): the protection ends when it is switched to the Bench', () => {
  const g = at([
    { active: 'Roggenrola', bench: [DRA], energy: { active: [F] } },
    { active: 'Regice', hand: ["Boss's Orders"], energy: { active: [W, W, W] } },
  ]);
  choose(g, 'Attack: Harden');
  choose(g, "Play Boss's Orders"); // the only Benched Pokémon is switched in
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), DRA, 'Roggenrola was switched to the Bench');
  choose(g, 'Attack: Blizzard');
  assert.equal(g.state.p[0].bench[0]!.damage, 10, 'Blizzard\'s 10 to the Benched Roggenrola is taken');
});

// ------------------------------------------------------------------ Tainted Horn

// https://compendium.pokegym.net/ruling/2166/ : Tainted Horn's 8 counters are for the Poison only; an already Burned Defending Pokémon takes the usual Burn counters.
test('Team Rocket\'s Nidoking ex, Tainted Horn (ruling 2166): a Burned Defender still takes only 2 counters for the Burn', () => {
  const g = at([
    { active: "Team Rocket's Nidoking ex", energy: { active: [D, D, D] } },
    { active: DRA, cond: BURNED },
  ]);
  g.state.forcedCoins = [false]; // the Burn flip at Checkup: tails, the Burn stays
  choose(g, 'Attack: Tainted Horn');
  assert.equal(dmg(g, 1), 100 + 80 + 20, '100 damage, 8 counters (Poison), 2 counters (Burn)');
});

// ------------------------------------------------------------------ Ruffian

// https://compendium.pokegym.net/ruling/2120/ : Ruffian discards a Tool and a Special Energy from the SAME Pokémon, never one of each from two.
test('Ruffian (ruling 2120): the Tool and the Special Energy come from the one Pokémon chosen', () => {
  const g = at([
    { active: DRA, hand: ['Ruffian'] },
    { active: DRA, bench: ['Dreepy'], energy: { active: ['Telepathic Psychic Energy'] }, tools: { 0: ['Air Balloon'] } },
  ]);
  choose(g, 'Play Ruffian');
  pick(g, [DRA]);
  const opp = g.state.p[1];
  assert.equal(opp.active!.energy.length, 0, "the Active's Special Energy is discarded");
  assert.equal(opp.bench[0]!.tools.length, 1, "the other Pokémon's Tool is left alone");
  // And the Tool and the Special Energy on one Pokémon both go.
  const both = at([
    { active: DRA, hand: ['Ruffian'] },
    { active: DRA, energy: { active: ['Telepathic Psychic Energy'] }, tools: { active: ['Air Balloon'] } },
  ]);
  choose(both, 'Play Ruffian');
  const o = both.state.p[1].active!;
  assert.equal(o.energy.length + o.tools.length, 0, 'both are discarded from the one Pokémon');
});

// ------------------------------------------------------------------ Drag Off

// https://compendium.pokegym.net/ruling/2052/ and https://compendium.pokegym.net/ruling/415/ : with no Benched Pokémon to switch in there is no new Active Pokémon, so Drag Off does no damage.
test('Drag Off (rulings 2052 and 415): no damage when the opponent has no Bench; the new Active takes it otherwise', () => {
  const cases: [string, string, string[], number][] = [
    ['Braviary', 'Attack: Drag Off', [C, C], 40],
    ['Primeape', 'Attack: Drag Off', [F], 30],
    ['Cryogonal', 'Attack: Drag Off', [W], 20],
  ];
  for (const [name, atk, en, amount] of cases) {
    const none = at([{ active: name, energy: { active: en } }, { active: DRA }]);
    choose(none, atk);
    assert.equal(dmg(none, 1), 0, `${name}: no Bench, no switch, no damage`);
    const some = at([{ active: name, energy: { active: en } }, { active: DRA, bench: ['Dreepy'] }]);
    choose(some, atk);
    assert.equal(nameOf(some, some.state.p[1].active!.cards[0]!), 'Dreepy', `${name}: the Benched Pokémon is switched in`);
    assert.equal(dmg(some, 1), amount, `${name}: the new Active Pokémon takes ${amount}`);
  }
});

// ------------------------------------------------------------------ Falinks

// https://compendium.pokegym.net/ruling/2024/ : Form Ranks counts the Bench space when the attack is used; with no Tera Pokémon in play yet, one open space means one Pokémon even if the first is a Tera one.
test('Falinks, Form Ranks x Area Zero Underdepths (ruling 2024): one open space is one Pokémon, Tera or not', () => {
  const g = at([
    { active: 'Falinks', bench: ['Dreepy', 'Dreepy', 'Dreepy', 'Dreepy'], energy: { active: [F] } },
    { active: DRA },
  ]);
  setStadium(g, 0, 'Area Zero Underdepths');
  choose(g, 'Attack: Form Ranks');
  assert.equal(g.decision!.max, 1, 'only one Pokémon can be put onto the Bench');
  pick(g, ['Terapagos ex']);
  assert.equal(g.state.p[0].bench.length, 5);
  // With a Tera Pokémon already in play the Bench holds 8, so two fit.
  const tera = at([
    { active: 'Falinks', bench: ['Terapagos ex', 'Dreepy', 'Dreepy', 'Dreepy'], energy: { active: [F] } },
    { active: DRA },
  ]);
  setStadium(tera, 0, 'Area Zero Underdepths');
  choose(tera, 'Attack: Form Ranks');
  assert.equal(tera.decision!.max, 2, 'with a Tera Pokémon in play two fit');
});

// ------------------------------------------------------------------ Legacy Energy x Fezandipiti

// https://compendium.pokegym.net/ruling/1969/ : a lone Legacy Energy (one Energy, every type) pays for Energy Feather and also counts as {D} for Adrena-Pheromone.
test('Legacy Energy x Fezandipiti (ruling 1969): the one Energy attacks and also enables Adrena-Pheromone', () => {
  const mk = (heads: boolean): Game => {
    const g = at([
      { active: 'Fezandipiti', energy: { active: ['Legacy Energy'] } },
      { active: DRA, energy: { active: [R] } },
    ]);
    choose(g, 'Attack: Energy Feather');
    assert.equal(dmg(g, 1), 30, 'Energy Feather: 30 for the one Energy');
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  assert.equal(dmg(mk(true), 0), 0, 'heads: the damage is prevented');
  assert.equal(dmg(mk(false), 0), 70, 'tails: the damage is taken');
});

// ------------------------------------------------------------------ Lugia ex

// https://compendium.pokegym.net/ruling/732/ : when an attack discards an Energy from the Defending Pokémon, the attacking player picks which one.
test('Lugia ex, Hyper Whirlpool (ruling 732): the attacking player chooses the Energy discarded', () => {
  const g = at([
    { active: 'Lugia ex', energy: { active: [C, C, C] } },
    { active: DRA, energy: { active: [R, P] } },
  ]);
  g.state.forcedCoins = [true, false];
  choose(g, 'Attack: Hyper Whirlpool');
  assert.equal(g.decision!.player, 0, 'the attacker is asked');
  const i = labels(g).findIndex((l) => l.includes('Psychic'));
  assert.ok(i >= 0);
  g.submit([i]);
  const left = namesOf(g, g.state.p[1].active!.energy);
  assert.equal(left.length, 1);
  assert.ok(left[0]!.includes('Fire'), 'the chosen Psychic Energy was discarded, the Fire stays');
});

// ------------------------------------------------------------------ Mr. Mime, Mimic

// https://compendium.pokegym.net/ruling/520/ : Mimic can be used when the opponent's hand is empty: your hand is shuffled in and you draw nothing.
test('Mr. Mime, Mimic (ruling 520): usable against an empty hand; shuffles your hand away and draws nothing', () => {
  const g = at([{ active: 'Mr. Mime', hand: ['Dreepy', 'Dreepy', 'Dreepy'], energy: { active: [P] } }, { active: DRA }]);
  const deckBefore = g.state.p[0].deck.length;
  assert.equal(g.state.p[1].hand.length, 0);
  choose(g, 'Attack: Mimic');
  assert.equal(g.state.p[0].hand.length, 0);
  assert.equal(g.state.p[0].deck.length, deckBefore + 3);
});

// https://compendium.pokegym.net/ruling/519/ : Mimic can be used with an empty hand of your own; the deck is shuffled first, then you draw.
test('Mr. Mime, Mimic (ruling 519): usable with no cards in hand, the deck is shuffled before the draw', () => {
  // Three Dhelmise on top of the deck: drawn unshuffled, the hand would be exactly those three.
  const g = at([
    { active: 'Mr. Mime', energy: { active: [P] }, deckTop: ['Dhelmise', 'Dhelmise', 'Dhelmise'] },
    { active: DRA, hand: ['Dreepy', 'Dreepy', 'Dreepy'] },
  ]);
  assert.equal(g.state.p[0].hand.length, 0);
  assert.deepEqual(namesOf(g, g.state.p[0].deck.slice(-3)), ['Dhelmise', 'Dhelmise', 'Dhelmise'], 'precondition: the top three are Dhelmise');
  choose(g, 'Attack: Mimic');
  assert.equal(g.state.p[0].hand.length, 3, "drew a card for each card in the opponent's hand");
  assert.notDeepEqual(namesOf(g, g.state.p[0].hand), ['Dhelmise', 'Dhelmise', 'Dhelmise'], 'the deck was shuffled before drawing');
});

// ------------------------------------------------------------------ Grind

// https://compendium.pokegym.net/ruling/466/ : Grind counts Energy provided, not Energy cards: one card that provides 2 Energy counts twice.
test('Tyranitar ex, Grind (ruling 466): a single Energy card providing 2 Energy counts as 2', () => {
  const g = at([
    { active: 'Larvitar', evolve: { active: ['Pupitar', 'Tyranitar ex'] }, energy: { active: ['Neo Upper Energy'] } },
    { active: DRA },
  ]);
  choose(g, 'Attack: Grind');
  assert.equal(dmg(g, 1), 100, '2 Energy x 50, from one card');
});

// ------------------------------------------------------------------ the REVIEWED table

test('REVIEWED entries all exist in the Compendium index', () => {
  const index = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number }[] };
  const ids = new Set(index.rulings.map((r) => r.id));
  for (const r of REVIEWED) {
    const n = Number(r.ruling.replace(/\D/g, ''));
    assert.ok(ids.has(n), `${r.ruling} is not in data/rulings-compendium.json`);
    assert.ok(r.why.length > 20);
  }
});
