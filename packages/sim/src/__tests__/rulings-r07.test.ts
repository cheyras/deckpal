/**
 * Rulings audit, lane 07: official rulings from the Pokémon Rulings Compendium, each pinned by a scenario that fails if the
 * simulator did the other thing. Each test cites its ruling as https://compendium.pokegym.net/ruling/<id>/ with a one-line
 * summary in our own words (the ruling text itself stays on the Compendium). Rulings no scenario can express are in REVIEWED.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
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
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, iid: number): string => def(g.ctx, iid).name;
const names = (g: Game, iids: number[]): string[] => iids.map((c) => nameOf(g, c)).sort();
const activeName = (g: Game, p: 0 | 1): string => nameOf(g, topCard(g.state.p[p].active!));
const benchNames = (g: Game, p: 0 | 1): string[] => g.state.p[p].bench.map((b) => nameOf(g, topCard(b)));
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** Put the Stadium card from this player's deck into play, as if that player had played it. */
function stadium(g: Game, name: string, owner: 0 | 1 = 0): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in P${owner + 1}'s deck`);
  g.state.stadium = { card: dk.splice(i, 1)[0] as number, owner };
  refresh(g);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]): DeckInput {
  return fromIds('r07', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}

const NINETALES = 'me01-020'; // Supernatural Shapeshifter {C}
const ERI = 'sv05-146';
const LILLIE = 'me01-119'; // Lillie's Determination: shuffle the hand into the deck, draw 6 (8 with exactly 6 Prizes left)
const BOSS = 'me01-114';
const ULTRA = 'me01-131'; // Ultra Ball (Item)
const SWITCH = 'me01-130'; // Switch (Item)
const SCREAM_TAIL = 'sv06-094';
const DREEPY = 'sv06-128'; // 70 HP, Dragon, no Weakness
const DRAGAPULT = 'sv06-130'; // 320 HP, no Weakness
const DIPPLIN = 'sv06-018';
const FESTIVAL = 'sv06-149';
const POLICY = 'me04-074'; // Adversity Policy
const ZORUA = 'sv09-097'; // N's Zorua: Darkness, Grass-weak
const STUNKY = 'me04-053';
const SKUNTANK = 'me04-054'; // Darkness, Smash Turn {D}{D}{C}: 100, then switch
const MEWTWO_EX = 'me02.5-079'; // Team Rocket's Mewtwo ex: 280 HP Psychic, Darkness-weak
const MEOWTH_EX = 'me03-062';
const WATCHTOWER = 'sv10-180';
const GRIMSLEY = 'me02-090';
const SANDILE = 'me02-063';
const BULBASAUR = 'me01-001';
const IVYSAUR = 'me01-002';
const MEGA_VENUSAUR = 'me01-003';
const FOREST = 'me01-117';
const MANKEY = 'sv10-090';
const PRIMEAPE = 'sv10-091'; // Drag Off {F}: 30 to the new Active
const RUFFLET = 'sv08-152';
const BRAVIARY = 'sv08-153'; // Drag Off {C}{C}: 40
const CRYOGONAL = 'sv10.5b-027'; // Drag Off {W}: 20
const MAGIKARP = 'sv10-048'; // Misty's Magikarp, So Submerged
const SURFER = 'sv08-187';
const YANMA = 'sv10-002';
const YANMEGA = 'sv10-003';
const VOLCANION = 'sv09-031';
const TAUROS = 'sv07-112'; // Destructive Horn {C}{C}{C}: 70, coin: discard an Energy
const ORTHWORM = 'sv07-110'; // 220 HP Metal, Pummeling Payback
const KYUREM = 'sv06.5-047';
const TENACITY = 'sv06.5-057'; // Colress's Tenacity
const DRIFLOON = 'mep-005';
const PANCHAM = 'me02.5-115';
const PANGORO = 'sv07-093';
const TOEDSCOOL = 'sv10-109';
const TOEDSCRUEL = 'sv10-110';
const LARVESTA = 'sv08-024';
const VOLCARONA = 'sv08-025'; // Leech Life {C}: 30
const PARAS = 'sv09-004'; // Leech Life {G}: 10
const VIRIZION = 'sv10.5w-010'; // Giga Drain {G}: 30
const PHANTUMP_GRASS = 'sv06-012';
const TREVENANT_GRASS = 'sv06-013'; // Giga Drain {G}{C}: 50

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';

type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Trainers used through Ninetales' attack

test('https://compendium.pokegym.net/ruling/2376/ Eri used through Ninetales, Supernatural Shapeshifter may discard zero Items; played from the hand it needs at least one', () => {
  const dk = deck(NINETALES, ERI, ULTRA, SWITCH, DREEPY);
  const layout = (me: SideLayout): Sides => [me, { active: 'Dreepy', hand: ['Ultra Ball', 'Switch'] }];
  // Through the attack: Eri is on top of the deck, is discarded and its effect is used. The choice may be left at none.
  const g = scenario(dk, dk, layout({ active: 'Ninetales', energy: { active: [F] }, deckTop: ['Eri'] }));
  const before = g.state.p[1].hand.slice();
  choose(g, 'Attack: Supernatural Shapeshifter');
  assert.equal(g.decision?.kind, 'cards', 'Eri asks which Items to discard');
  assert.equal(g.decision?.player, 0);
  assert.equal(g.decision?.min, 0, 'used through an attack, zero Item cards is allowed');
  assert.equal(g.decision?.max, 2);
  g.submit([]);
  assert.deepEqual(g.state.p[1].hand.slice(0, before.length), before, 'nothing was discarded from their hand');
  assert.deepEqual(g.state.p[1].discard, []);
  // Choosing one is still possible.
  const h = scenario(dk, dk, layout({ active: 'Ninetales', energy: { active: [F] }, deckTop: ['Eri'] }));
  choose(h, 'Attack: Supernatural Shapeshifter');
  pick(h, ['Ultra Ball']);
  assert.deepEqual(names(h, h.state.p[1].discard), ['Ultra Ball']);
  // Played as a Supporter from the hand: at least one Item must go.
  const played = scenario(dk, dk, layout({ active: 'Dreepy', hand: ['Eri'] }));
  choose(played, 'Play Eri');
  assert.equal(played.decision?.kind, 'cards');
  assert.equal(played.decision?.min, 1, 'played from the hand, "up to 2" is 1 to 2');
});

test('https://compendium.pokegym.net/ruling/2227/ the Supporter revealed by Ninetales, Supernatural Shapeshifter is used, there is no way to decline it', () => {
  const dk = deck(NINETALES, LILLIE, DREEPY);
  const g = scenario(dk, dk, [{ active: 'Ninetales', energy: { active: [F] }, hand: ['Dreepy'], deckTop: ["Lillie's Determination"] }, { active: 'Dreepy' }]);
  choose(g, 'Attack: Supernatural Shapeshifter');
  assert.notEqual(g.decision?.kind, 'yesno', 'no question: the effect is used');
  assert.equal(g.state.p[0].hand.length, 8, "Lillie's Determination ran (8 cards with exactly 6 Prizes left)");
  assert.deepEqual(names(g, g.state.p[0].discard), ["Lillie's Determination"], 'the card itself was only discarded from the deck');
});

test('https://compendium.pokegym.net/ruling/2226/ Ninetales, Supernatural Shapeshifter works even when you are not allowed to play Supporters', () => {
  const dk = deck(NINETALES, LILLIE, BOSS, DREEPY);
  const g = scenario(dk, dk, [{ active: 'Ninetales', energy: { active: [F] }, hand: ["Boss's Orders"], deckTop: ["Lillie's Determination"] }, { active: 'Dreepy' }]);
  // The player may not play Supporters (as after Scream Tail ex's Scream).
  g.state.effects.push({ static: { k: 'playLock', what: 'supporter' }, slot: -1, player: 0, until: g.state.turn + 1, fromAttack: true, src: 0 });
  refresh(g);
  assert.ok(!has(g, "Play Boss's Orders"), "the lock really stops Supporters from the hand");
  choose(g, 'Attack: Supernatural Shapeshifter');
  assert.equal(g.state.p[0].hand.length, 8, "Lillie's Determination's effect was used");
});

test('https://compendium.pokegym.net/ruling/2225/ after playing a Supporter, Ninetales, Supernatural Shapeshifter can still use a Supporter effect, and it is not a second Supporter played', () => {
  const dk = deck(NINETALES, LILLIE, DREEPY);
  const mk = (played: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Ninetales', energy: { active: [F] }, hand: ['Dreepy'], deckTop: ["Lillie's Determination"] }, { active: 'Dreepy' }]);
    g.state.p[0].supporterPlayed = played;
    return g;
  };
  const after = mk(true);
  choose(after, 'Attack: Supernatural Shapeshifter');
  assert.equal(after.state.p[0].hand.length, 8, 'the effect was used although a Supporter was already played');
  const fresh = mk(false);
  choose(fresh, 'Attack: Supernatural Shapeshifter');
  assert.equal(fresh.state.p[0].hand.length, 8);
  assert.equal(fresh.state.p[0].supporterPlayed, false, 'using the effect did not count as playing a Supporter');
});

// ------------------------------------------------------------------ Adversity Policy

test('https://compendium.pokegym.net/ruling/2359/ Festival Lead: Dipplin attacks twice, Adversity Policy on a Grass-weak defender draws 3 for each attack (6 in all)', () => {
  const dk = deck(DIPPLIN, ZORUA, DREEPY, FESTIVAL, POLICY);
  const g = scenario(dk, dk, [
    { active: 'Dipplin', bench: ['Dreepy'], energy: { active: [G] } },
    { active: "N's Zorua", bench: ['Dreepy'], tools: { active: ['Adversity Policy'] } },
  ]);
  stadium(g, 'Festival Grounds', 1);
  const hand = g.state.p[1].hand.length;
  choose(g, 'Attack: Do the Wave'); // 20 for the one Benched Pokémon, doubled by Weakness
  assert.equal(g.state.p[1].hand.length, hand + 3, 'three cards for the first attack');
  assert.equal(g.state.current, 0, 'Dipplin may attack again');
  choose(g, 'Attack: Do the Wave');
  assert.equal(g.state.p[1].hand.length, hand + 6 + 1, 'three more for the second attack (and the card for their turn, which follows)');
});

test('https://compendium.pokegym.net/ruling/2358/ Adversity Policy still draws 3 when the attacker (Skuntank, Smash Turn) switches itself to the Bench after the damage', () => {
  const dk = deck(SKUNTANK, STUNKY, MEWTWO_EX, POLICY);
  const run = (tool: boolean): Game => {
    const g = scenario(dk, dk, [
      { active: 'Stunky', evolve: { active: ['Skuntank'] }, bench: ['Stunky'], energy: { active: [D, D, D] } },
      { active: "Team Rocket's Mewtwo ex", tools: tool ? { active: ['Adversity Policy'] } : {} },
    ]);
    choose(g, 'Attack: Smash Turn');
    return g;
  };
  const control = run(false);
  const g = run(true);
  assert.equal(dmg(g, 1), 100 * 2, 'Darkness against a Darkness-weak Pokémon: 100 doubled');
  assert.equal(activeName(g, 0), 'Stunky', 'Skuntank switched to the Bench');
  assert.equal(benchNames(g, 0).includes('Skuntank'), true);
  assert.equal(g.state.p[1].hand.length - control.state.p[1].hand.length, 3, 'the three cards were drawn');
});

// ------------------------------------------------------------------ Team Rocket's Watchtower / Meowth ex

test("https://compendium.pokegym.net/ruling/2334/ Team Rocket's Watchtower in play: a Meowth ex put onto the Bench has no Last-Ditch Catch", () => {
  const dk = deck(MEOWTH_EX, WATCHTOWER, DREEPY, BOSS);
  const mk = (tower: boolean): Game => scenario(dk, dk, [{ active: 'Dreepy', hand: tower ? ["Team Rocket's Watchtower", 'Meowth ex'] : ['Meowth ex'] }, { active: 'Dreepy' }]);
  const g = mk(true);
  choose(g, "Play Team Rocket's Watchtower");
  choose(g, 'Bench Meowth ex');
  assert.equal(g.decision?.kind, 'main', 'Last-Ditch Catch was not offered');
  assert.equal(g.state.p[0].hand.length, 0, 'nothing was searched for');
  const control = mk(false);
  choose(control, 'Bench Meowth ex');
  assert.equal(control.decision?.kind, 'yesno', 'without the Stadium Last-Ditch Catch is offered');
});

// ------------------------------------------------------------------ Grimsley's Move, Forest of Vitality

test("https://compendium.pokegym.net/ruling/2258/ Grimsley's Move can put a Stage 1 {D} Pokémon straight onto the Bench", () => {
  const dk = deck(GRIMSLEY, SKUNTANK, SANDILE, DREEPY);
  const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ["Grimsley's Move"], deckTop: ['Skuntank', 'Dreepy', 'Dreepy'] }, { active: 'Dreepy' }]);
  choose(g, "Play Grimsley's Move");
  assert.ok(has(g, 'Skuntank'), `Skuntank (Stage 1) is offered: ${labels(g).join(' | ')}`);
  choose(g, 'Skuntank');
  assert.deepEqual(benchNames(g, 0), ['Skuntank']);
});

test('https://compendium.pokegym.net/ruling/2229/ Forest of Vitality: a Basic {G} Pokémon can evolve twice in the turn it is played (but not on the first turn of the game)', () => {
  const dk = deck(BULBASAUR, IVYSAUR, MEGA_VENUSAUR, FOREST, DREEPY);
  const mk = (turn: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Bulbasaur'], hand: ['Ivysaur', 'Mega Venusaur ex'] }, { active: 'Dreepy' }], { turn, current: 0, first: 0 });
    g.state.p[0].bench[0]!.enteredTurn = g.state.turn; // just played
    stadium(g, 'Forest of Vitality', 1);
    return g;
  };
  const g = mk(3);
  choose(g, 'into Ivysaur');
  choose(g, 'into Mega Venusaur ex');
  assert.deepEqual(
    g.state.p[0].bench[0]!.cards.map((c) => nameOf(g, c)),
    ['Bulbasaur', 'Ivysaur', 'Mega Venusaur ex'],
  );
  const first = mk(1);
  assert.ok(!has(first, 'into Ivysaur'), 'not on the first turn of the game');
});

// ------------------------------------------------------------------ Drag Off against Misty's Magikarp

test("https://compendium.pokegym.net/ruling/2155/ Drag Off aimed at a Benched Misty's Magikarp (So Submerged) is not switched in, so no damage is done to anything", () => {
  const dk = deck(PRIMEAPE, MANKEY, BRAVIARY, RUFFLET, CRYOGONAL, MAGIKARP, DREEPY);
  const attackers: [string, SideLayout, number][] = [
    ['Primeape', { active: 'Mankey', evolve: { active: ['Primeape'] }, energy: { active: [FI] } }, 30],
    ['Braviary', { active: 'Rufflet', evolve: { active: ['Braviary'] }, energy: { active: [F, F] } }, 40],
    ['Cryogonal', { active: 'Cryogonal', energy: { active: [W] } }, 20],
  ];
  for (const [who, me, amount] of attackers) {
    const mk = (): Game => scenario(dk, dk, [me, { active: 'Dreepy', bench: ["Misty's Magikarp", 'Dreepy'] }]);
    const g = mk();
    choose(g, 'Attack: Drag Off');
    choose(g, "Misty's Magikarp");
    assert.equal(activeName(g, 1), 'Dreepy', `${who}: the Magikarp stayed on the Bench`);
    assert.equal(g.state.p[1].bench.length, 2, `${who}: both were still on the Bench or the old Active unchanged`);
    assert.equal(g.state.p[1].active!.damage, 0, `${who}: no damage to the Active Pokémon that stayed`);
    assert.equal(g.state.p[1].bench.find((b) => nameOf(g, topCard(b)) === "Misty's Magikarp")!.damage, 0);
    // The converse: a Pokémon that can be switched in takes the damage.
    const h = mk();
    choose(h, 'Attack: Drag Off');
    const ls = labels(h);
    const other = ls.findIndex((l) => !l.includes('Magikarp'));
    h.submit([other]);
    assert.equal(h.state.p[1].active!.damage, amount, `${who}: the new Active Pokémon took ${amount}`);
  }
});

// ------------------------------------------------------------------ Surfer

test('https://compendium.pokegym.net/ruling/2142/ Surfer switching in Yanmega ex: finish Surfer (draw up to 5) before Buzzing Boost is used', () => {
  const dk = deck(SURFER, YANMA, YANMEGA, DREEPY);
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Yanma'], evolve: { 0: ['Yanmega ex'] }, hand: ['Surfer', 'Dreepy'] }, { active: 'Dreepy' }]);
  choose(g, 'Play Surfer');
  if (g.decision?.kind !== 'yesno') choose(g, 'Yanmega ex'); // which Benched Pokémon
  assert.equal(g.decision?.kind, 'yesno', `Buzzing Boost is offered: ${g.decision?.prompt}`);
  assert.equal(g.state.p[0].hand.length, 5, 'Surfer had already drawn up to 5 when Buzzing Boost was offered');
  yes(g);
  assert.equal(g.decision?.kind, 'cards');
});

test('https://compendium.pokegym.net/ruling/2067/ Surfer cannot be played with no Benched Pokémon', () => {
  const dk = deck(SURFER, DREEPY);
  const none = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Surfer'] }, { active: 'Dreepy' }]);
  assert.ok(!has(none, 'Play Surfer'), 'Surfer was offered with an empty Bench');
  const some = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], hand: ['Surfer'] }, { active: 'Dreepy' }]);
  assert.ok(has(some, 'Play Surfer'));
});

test('https://compendium.pokegym.net/ruling/2066/ Surfer can be played with an empty deck: the switch still happens', () => {
  const dk = deck(SURFER, DREEPY, TOEDSCOOL);
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Arven\'s Toedscool'], hand: ['Surfer'], emptyDeck: true }, { active: 'Dreepy' }]);
  assert.equal(g.state.p[0].deck.length, 0);
  choose(g, 'Play Surfer');
  if (g.decision?.kind !== 'main') choose(g, 'Toedscool');
  assert.equal(activeName(g, 0), "Arven's Toedscool");
  assert.equal(g.state.p[0].supporterPlayed, true);
});

// ------------------------------------------------------------------ Volcanion ex

test("https://compendium.pokegym.net/ruling/2118/ Volcanion ex's Scorching Cyclone with no Benched Pokémon still does its damage and moves no Energy", () => {
  const dk = deck(VOLCANION, DRAGAPULT, DREEPY);
  const alone = scenario(dk, dk, [{ active: 'Volcanion ex', energy: { active: [F, F, F] } }, { active: 'Dragapult ex' }]);
  choose(alone, 'Attack: Scorching Cyclone');
  assert.equal(dmg(alone, 1), 160, 'the damage was done');
  assert.equal(alone.state.p[0].active!.energy.length, 3, 'no Energy left Volcanion ex');
  assert.equal(alone.state.p[0].discard.length, 0, 'nothing was discarded');
  // The converse: with a Benched Pokémon an Energy is moved to it.
  const bench = scenario(dk, dk, [{ active: 'Volcanion ex', energy: { active: [F, F, F] }, bench: ['Dreepy'] }, { active: 'Dragapult ex' }]);
  choose(bench, 'Attack: Scorching Cyclone');
  assert.equal(bench.state.p[0].active!.energy.length, 2);
  assert.equal(bench.state.p[0].bench[0]!.energy.length, 1);
});

// ------------------------------------------------------------------ Kyurem

test("https://compendium.pokegym.net/ruling/2000/ Kyurem's Plasma Bane: Colress's Tenacity in the opponent's discard pile counts as a card with Colress in its name", () => {
  const dk = deck(KYUREM, TENACITY, DREEPY);
  const mk = (discard: string[]): Game => scenario(dk, dk, [{ active: 'Kyurem', energy: { active: [W] } }, { active: 'Dreepy', bench: ['Dreepy', 'Dreepy'], discard }]);
  assert.ok(has(mk(["Colress's Tenacity"]), 'Attack: Trifrost'), 'Trifrost costs {C} with the Tenacity in the discard pile');
  assert.ok(!has(mk([]), 'Attack: Trifrost'), 'one Energy is not enough without it');
  assert.ok(!has(mk(['Dreepy']), 'Attack: Trifrost'), 'another card in the discard pile does not count');
});

// ------------------------------------------------------------------ Orthworm ex

test('https://compendium.pokegym.net/ruling/2012/ Pummeling Payback counts the Metal Energy left when it triggers: Tauros discarded the only one, so no counters', () => {
  const dk = deck(TAUROS, ORTHWORM, DREEPY);
  const run = (energy: string[]): Game => {
    const g = scenario(dk, dk, [
      { active: 'Tauros', energy: { active: [L, L, L] } },
      { active: 'Orthworm ex', energy: { active: energy } },
    ]);
    g.state.forcedCoins = [true];
    choose(g, 'Attack: Destructive Horn');
    if (g.decision?.kind === 'cards') g.submit([0]); // which of two identical Energy to discard
    return g;
  };
  const one = run([M]);
  assert.equal(one.state.p[1].active!.energy.length, 0, 'the Metal Energy was discarded');
  assert.equal(dmg(one, 1), 70);
  assert.equal(one.state.p[0].active!.damage, 0, 'no damage counters on Tauros');
  const two = run([M, M]);
  assert.equal(two.state.p[1].active!.energy.length, 1);
  assert.equal(two.state.p[0].active!.damage, 20, 'one Metal Energy left: 2 counters');
});

// ------------------------------------------------------------------ Pull

test("https://compendium.pokegym.net/ruling/1511/ Pull: the attacking player chooses which of the opponent's Benched Pokémon becomes Active", () => {
  const dk = deck(DRIFLOON, PANGORO, PANCHAM, TOEDSCRUEL, TOEDSCOOL, DREEPY, DRAGAPULT);
  const cases: [string, SideLayout][] = [
    ['Drifloon', { active: 'Drifloon', energy: { active: [P] } }],
    ['Pangoro', { active: 'Pancham', evolve: { active: ['Pangoro'] }, energy: { active: [D] } }],
    ["Arven's Toedscruel", { active: "Arven's Toedscool", evolve: { active: ["Arven's Toedscruel"] }, energy: { active: [F] } }],
  ];
  for (const [who, me] of cases) {
    const g = scenario(dk, dk, [me, { active: 'Dragapult ex', bench: ['Dreepy', 'Pancham'] }]);
    g.state.forcedCoins = [true];
    choose(g, 'Attack: Pull');
    assert.equal(g.decision?.kind, 'slots', `${who}: asks which Pokémon`);
    assert.equal(g.decision?.player, 0, `${who}: the attacking player chooses`);
    choose(g, 'Pancham');
    assert.equal(activeName(g, 1), 'Pancham', `${who}: the chosen Pokémon is Active`);
    assert.deepEqual(benchNames(g, 1).sort(), ['Dragapult ex', 'Dreepy'], `${who}: the old Active went to the Bench`);
  }
});

// ------------------------------------------------------------------ Leech Life / Giga Drain

test('https://compendium.pokegym.net/ruling/505/ Leech Life doing 10 damage heals one damage counter (10 damage)', () => {
  const dk = deck(PARAS, DRAGAPULT, DREEPY);
  const g = scenario(dk, dk, [{ active: 'Paras', energy: { active: [G] }, damage: { active: 40 } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Leech Life');
  assert.equal(dmg(g, 1), 10);
  assert.equal(g.state.p[0].active!.damage, 30, 'one counter healed');
});

test('https://compendium.pokegym.net/ruling/504/ Leech Life heals for all the damage the attack does even if the Defending Pokémon needed less to be Knocked Out', () => {
  const dk = deck(VOLCARONA, LARVESTA, DREEPY);
  const g = scenario(dk, dk, [
    { active: 'Larvesta', evolve: { active: ['Volcarona'] }, energy: { active: [F] }, damage: { active: 80 } },
    { active: 'Dreepy', damage: { active: 60 }, bench: ['Dreepy'] },
  ]);
  choose(g, 'Attack: Leech Life'); // 30 damage to a Dreepy with 10 HP left
  assert.equal(g.state.p[0].prizes.length, 5, 'the Defending Pokémon was Knocked Out');
  assert.equal(g.state.p[0].active!.damage, 50, 'all 3 damage counters healed (80 - 30)');
  // With fewer than 3 counters on the attacker, all of them go.
  const few = scenario(dk, dk, [
    { active: 'Larvesta', evolve: { active: ['Volcarona'] }, energy: { active: [F] }, damage: { active: 20 } },
    { active: 'Dreepy', damage: { active: 60 }, bench: ['Dreepy'] },
  ]);
  choose(few, 'Attack: Leech Life');
  assert.equal(few.state.p[0].active!.damage, 0);
});

test('https://compendium.pokegym.net/ruling/462/ Giga Drain heals the full amount of damage the attack does, even when the Defending Pokémon had less HP left', () => {
  const dk = deck(VIRIZION, PHANTUMP_GRASS, TREVENANT_GRASS, DREEPY);
  const vir = scenario(dk, dk, [
    { active: 'Virizion', energy: { active: [G] }, damage: { active: 50 } },
    { active: 'Dreepy', damage: { active: 60 }, bench: ['Dreepy'] },
  ]);
  choose(vir, 'Attack: Giga Drain'); // 30 damage to a Dreepy with 10 HP left
  assert.equal(vir.state.p[0].prizes.length, 5, 'the Defending Pokémon was Knocked Out');
  assert.equal(vir.state.p[0].active!.damage, 20, 'all 30 healed (50 - 30)');
  const tre = scenario(dk, dk, [
    { active: 'Phantump', evolve: { active: ['Trevenant'] }, energy: { active: [G, G] }, damage: { active: 80 } },
    { active: 'Dreepy', damage: { active: 60 }, bench: ['Dreepy'] },
  ]);
  choose(tre, 'Attack: Giga Drain'); // 50 damage to a Dreepy with 10 HP left
  assert.equal(tre.state.p[0].active!.damage, 30, 'all 50 healed (80 - 50)');
});

// ------------------------------------------------------------------ Rulings no scenario can express

const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #2032',
    why: 'unscripted card: the answer turns on Pokémon League Headquarters adding to an attack cost that Plasma Bane sets to one; Pokémon League Headquarters has no printing in the simulator\'s Standard card set (no frame, no script), so the position cannot be built. The attackCostSet half of the answer (a set cost is not raised by other cost effects) has no second effect in the simulator to be raised by.',
  },
  {
    ruling: 'Compendium #1965',
    why: 'outside the game: which cards are legal to search for in a tournament format (Salvatore and a card of a banned or rotated-out kind); the simulator has no format legality, its decks contain only cards it scripts, and the card Salvatore evolves into is decided by the Stage rules, which a legal-card filter would not change.',
  },
  {
    ruling: 'Compendium #720',
    why: 'outside the game: deck building (a misspelt Pokémon name counts as the correct name when applying the four-copies rule); the simulator checks no deck list and has no card spelled "Drowsee".',
  },
];

test('REVIEWED rulings: every listed id is in the Compendium index', () => {
  const file = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number }[] } | { id: number }[];
  const ids = new Set((Array.isArray(file) ? file : file.rulings).map((r) => r.id));
  for (const r of REVIEWED) {
    const id = Number(r.ruling.replace('Compendium #', ''));
    assert.ok(ids.has(id), `${r.ruling} is not in data/rulings-compendium.json`);
    assert.ok(r.why.length > 40, `${r.ruling}: say why`);
  }
});
