/**
 * Card tests, batch "std-s01": every card scripted in cards/scripts/std-s01.ts does what its printed text says in a constructed
 * position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { StaticEffect } from '../dsl.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
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
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
function inject(g: Game, slotId: number, st: StaticEffect): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack: false, src: 0 });
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Rayquaza: 'me02.5-153',
  'Terapagos ex': 'me02.5-179',
  Dewgong: 'me02-022',
  'Thick Scale': 'me02.5-211',
  Malamar: 'sv06.5-034',
  "Xerosic's Machinations": 'sv06.5-064',
  'Munkidori ex': 'sv06.5-037',
  'Pecharunt ex': 'sv06.5-039',
  Hippowdon: 'me03-040',
  Tarragon: 'me03-085',
  Espurr: 'me04-036',
  Emma: 'me04-077',
  Deoxys: 'me04-033',
  Miraidon: 'me05-028',
  'Miraidon (promo)': 'mep-082',
  Cranidos: 'me05-044',
  Annihilape: 'me05-041',
  Magcargo: 'sv05-029',
  'Cornerstone Mask Ogerpon ex': 'sv06-112',
  Palafin: 'sv06-060',
  Slowpoke: 'me05-029',
  Rellor: 'sv08-013',
  'Dragapult ex': 'sv06-130',
  Switch: 'me01-130',
  "Boss's Orders": 'me01-114',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('s01', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const SLO = 'Slowpoke'; // Basic 70 HP {P}; Headbutt {C}{C} 20; retreat 2
const REL = 'Rellor'; // Basic 40 HP {G}; retreat 1
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
type Sides = [SideLayout, SideLayout];
const OPP_TURN = { current: 1 as const, turn: 4 };
const ALL_NAMES = [
  'Rayquaza', 'Terapagos ex', 'Dewgong', 'Thick Scale', 'Malamar', "Xerosic's Machinations", 'Munkidori ex', 'Pecharunt ex', 'Hippowdon', 'Tarragon',
  'Espurr', 'Emma', 'Deoxys', 'Miraidon', 'Cranidos', 'Annihilape', 'Magcargo', 'Cornerstone Mask Ogerpon ex', 'Palafin', SLO, REL, DRA, 'Switch', "Boss's Orders",
];
const dk = deck(...ALL_NAMES);
/** The same cards with the promo printing of Miraidon (mep-082) instead of the set printing (me05-028). */
const dkPromo = deck(...ALL_NAMES.filter((n) => n !== 'Miraidon'), 'Miraidon (promo)');
const S = (sides: Sides, o = {}, d = dk): Game => scenario(d, d, sides, o);

// ------------------------------------------------------------------ Rayquaza

test('Rayquaza, Breakthrough Assault: 20, and 90 more if it moved from the Bench to the Active Spot this turn', () => {
  const plain = S([{ active: 'Rayquaza', energy: { active: [L, L] } }, { active: DRA }]);
  choose(plain, 'Attack: Breakthrough Assault');
  assert.equal(dmg(plain, 1), 20);
  // Switched in from the Bench this turn: +90.
  const moved = S([{ active: SLO, bench: ['Rayquaza'], energy: { 0: [L, L] }, hand: ['Switch'] }, { active: DRA }]);
  choose(moved, 'Play Switch');
  if (moved.decision?.kind === 'slots') choose(moved, 'Rayquaza');
  assert.equal(moved.state.p[0].active!.cards.length, 1);
  assert.equal(nameOf(moved, moved.state.p[0].active!.cards[0]!), 'Rayquaza');
  choose(moved, 'Attack: Breakthrough Assault');
  assert.equal(dmg(moved, 1), 110, '20 + 90');
  // Moved last turn is not "this turn".
  const old = S([{ active: 'Rayquaza', energy: { active: [L, L] } }, { active: DRA }]);
  old.state.p[0].active!.movedActiveTurn = old.state.turn - 2;
  choose(old, 'Attack: Breakthrough Assault');
  assert.equal(dmg(old, 1), 20);
});

// ------------------------------------------------------------------ Terapagos ex

test('Terapagos ex, Unified Beatdown: 30 damage for each of your Benched Pokémon', () => {
  const g = S([{ active: 'Terapagos ex', bench: [REL, REL, SLO], energy: { active: [L, L] } }, { active: DRA }]);
  choose(g, 'Attack: Unified Beatdown');
  assert.equal(dmg(g, 1), 90);
  const none = S([{ active: 'Terapagos ex', energy: { active: [L, L] } }, { active: DRA }]);
  choose(none, 'Attack: Unified Beatdown');
  assert.equal(dmg(none, 1), 0, 'no Benched Pokémon: nothing');
});

test('Terapagos ex, Unified Beatdown: if you go second you cannot use it during your first turn; Crown Opal is not restricted', () => {
  const side: Sides = [{ active: DRA }, { active: 'Terapagos ex', bench: [REL], energy: { active: [G, W, L] } }];
  // The second player's first turn is turn 2.
  const second = S(side, { current: 1, turn: 2, first: 0 });
  assert.ok(!has(second, 'Attack: Unified Beatdown'), 'second player, first turn');
  assert.ok(has(second, 'Attack: Crown Opal'));
  // ... and their second turn is turn 4.
  assert.ok(has(S(side, { current: 1, turn: 4, first: 0 }), 'Attack: Unified Beatdown'), 'second player, second turn');
  // The player who went first is not restricted on a later turn (turn 3 is their second).
  assert.ok(has(S([{ active: 'Terapagos ex', bench: [REL], energy: { active: [G, W, L] } }, { active: DRA }], { current: 0, turn: 3, first: 0 }), 'Attack: Unified Beatdown'));
  // Going second with the roles swapped (player 1 went first, player 0 is second): turn 2 is player 0's first turn.
  const swapped = S([{ active: 'Terapagos ex', bench: [REL], energy: { active: [G, W, L] } }, { active: DRA }], { current: 0, turn: 2, first: 1 });
  assert.ok(!has(swapped, 'Attack: Unified Beatdown'));
});

test('Terapagos ex, Crown Opal: 180, then prevent all damage from attacks by Basic non-{C} Pokémon during the opponent\'s next turn', () => {
  const hit = (attacker: string, atk: string, energy: string[], bench: string[] = []): number => {
    const g = S([{ active: 'Terapagos ex', energy: { active: [G, W, L] } }, { active: attacker, bench, energy: { active: energy } }]);
    choose(g, 'Attack: Crown Opal');
    assert.equal(dmg(g, 1), 180);
    assert.equal(g.state.turn, 4);
    choose(g, `Attack: ${atk}`);
    return dmg(g, 0);
  };
  assert.equal(hit('Munkidori ex', 'Dirty Headbutt', [D, D, D]), 0, 'Basic {D}: prevented');
  assert.equal(hit('Terapagos ex', 'Unified Beatdown', [L, L], [REL]), 30, 'Basic {C}: not prevented');
  assert.equal(hit(DRA, 'Jet Headbutt', [P]), 70, 'a Stage 2 {N} Pokémon: not prevented');
  // It lasts one turn only: the opponent's turn after that is not covered.
  const g = S([{ active: 'Terapagos ex', energy: { active: [G, W, L] } }, { active: 'Munkidori ex', energy: { active: [D, D, D] } }]);
  choose(g, 'Attack: Crown Opal');
  choose(g, 'End turn'); // the opponent's next turn (4)
  choose(g, 'End turn'); // mine (5)
  assert.equal(g.state.turn, 6);
  choose(g, 'Attack: Dirty Headbutt');
  assert.equal(dmg(g, 0), 190, 'two turns later the damage is no longer prevented');
});

// ------------------------------------------------------------------ Dewgong

test('Dewgong, Slam: flip 2 coins, 70 damage for each heads', () => {
  for (const [coins, expected] of [[[true, true], 140], [[true, false], 70], [[false, false], 0]] as [boolean[], number][]) {
    const g = S([{ active: 'Dewgong', energy: { active: [W, W] } }, { active: DRA }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Slam');
    assert.equal(dmg(g, 1), expected);
    assert.deepEqual(g.state.forcedCoins, []);
  }
});

test('Dewgong, Thick Fat: 30 less damage from attacks of the opponent\'s {R} or {W} Pokémon (after Weakness and Resistance)', () => {
  const hit = (attacker: string, atk: string, energy: string[]): number => {
    const g = S([{ active: 'Dewgong' }, { active: attacker, energy: { active: energy } }], OPP_TURN);
    choose(g, `Attack: ${atk}`);
    return dmg(g, 0);
  };
  assert.equal(hit('Magcargo', 'Heat Blast', [R, R, R]), 70, '{R}: 100 - 30');
  assert.equal(hit('Palafin', 'Wave Splash', [W, W]), 0, '{W}: 30 - 30');
  assert.equal(hit('Annihilape', 'Ghostly Blow', [P, P]), 100, '{P}: no reduction');
  assert.equal(hit(DRA, 'Jet Headbutt', [P]), 70, '{N}: no reduction');
  // After Weakness: a {L} attacker is doubled but not reduced (Dewgong is weak to {L}); control for the order of the steps.
  // A {W} attacker that Dewgong's Weakness does not touch is reduced from its printed damage only.
  const own = S([{ active: 'Dewgong', energy: { active: [W, W] } }, { active: 'Dewgong', energy: { active: [W, W] } }]);
  own.state.forcedCoins = [true, true];
  choose(own, 'Attack: Slam');
  assert.equal(dmg(own, 1), 110, 'a {W} Dewgong hits the other: 140 - 30');
});

// ------------------------------------------------------------------ Thick Scale

test('Thick Scale: the {N} Pokémon takes 50 less damage from {G}, {R}, {W} or {L} Pokémon (after Weakness and Resistance); nothing on other Pokémon', () => {
  const hit = (holder: string, attacker: string, atk: string, energy: string[]): number => {
    const g = S([{ active: holder, tools: { active: ['Thick Scale'] } }, { active: attacker, energy: { active: energy } }], OPP_TURN);
    choose(g, `Attack: ${atk}`);
    return dmg(g, 0);
  };
  assert.equal(hit('Rayquaza', 'Magcargo', 'Heat Blast', [R, R, R]), 50, '{N} holder, {R} attacker: 100 - 50');
  assert.equal(hit('Rayquaza', 'Palafin', 'Wave Splash', [W, W]), 0, '{W} attacker: 30 - 50 is 0');
  assert.equal(hit('Rayquaza', 'Annihilape', 'Ghostly Blow', [P, P]), 100, '{P} attacker: no reduction');
  assert.equal(hit('Rayquaza', DRA, 'Jet Headbutt', [P]), 70, '{N} attacker: no reduction');
  assert.equal(hit('Munkidori ex', 'Magcargo', 'Heat Blast', [R, R, R]), 100, 'a {D} holder: the Tool does nothing');
});

// ------------------------------------------------------------------ Malamar

test('Malamar, Colluding Tentacles: with Xerosic\'s Machinations played this turn, switch in a Benched Pokémon and do 120 to it; otherwise nothing', () => {
  const base = (): Sides => [
    { active: 'Malamar', energy: { active: [D] }, hand: ["Xerosic's Machinations"] },
    { active: SLO, bench: [DRA], hand: [R, R, R, R, R] },
  ];
  const g = S(base());
  choose(g, "Play Xerosic's Machinations");
  g.submit([0, 1]); // the opponent discards down to 3
  choose(g, 'Attack: Colluding Tentacles');
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), DRA, 'switched in');
  assert.equal(dmg(g, 1), 120, 'the new Active Pokémon took 120');
  assert.equal(g.state.p[1].bench.length, 1);
  assert.equal(g.state.p[1].bench[0]!.damage, 0, 'the old Active Pokémon took nothing');

  const without = S(base());
  choose(without, 'Attack: Colluding Tentacles');
  assert.equal(nameOf(without, without.state.p[1].active!.cards[0]!), SLO, 'no switch without Xerosic\'s Machinations');
  assert.equal(dmg(without, 1), 0);
  assert.equal(without.state.p[1].bench[0]!.damage, 0);

  // Nothing to switch in: Xerosic's Machinations was played but the opponent has no Benched Pokémon, so "if you do" fails.
  const alone = S([base()[0], { active: SLO, hand: [R, R, R, R, R] }]);
  choose(alone, "Play Xerosic's Machinations");
  alone.submit([0, 1]);
  choose(alone, 'Attack: Colluding Tentacles');
  assert.equal(dmg(alone, 1), 0);
});

// ------------------------------------------------------------------ Munkidori ex

test('Munkidori ex, Oh No You Don\'t: Knocked Out by damage from an attack with a Pecharunt ex in play, the opponent takes 1 fewer Prize card', () => {
  const ko = (bench: string[]): number => {
    const g = S([{ active: 'Munkidori ex', bench, damage: { active: 200 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    choose(g, 'Attack: Jet Headbutt');
    return g.state.p[1].prizesTaken;
  };
  assert.equal(ko(['Pecharunt ex']), 1, '2 Prize cards for a Pokémon ex, 1 fewer');
  assert.equal(ko([REL]), 2, 'no Pecharunt ex: both Prize cards');
});

test('Munkidori ex, Dirty Headbutt: 190, and it cannot use Dirty Headbutt during your next turn (only)', () => {
  const g = S([{ active: 'Munkidori ex', energy: { active: [D, D, D] } }, { active: DRA }]);
  choose(g, 'Attack: Dirty Headbutt');
  assert.equal(dmg(g, 1), 190);
  choose(g, 'End turn'); // the opponent's turn 4
  assert.equal(g.state.turn, 5);
  assert.ok(!has(g, 'Attack: Dirty Headbutt'), 'your next turn');
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.equal(g.state.turn, 7);
  assert.ok(has(g, 'Attack: Dirty Headbutt'), 'the turn after that');
});

// ------------------------------------------------------------------ Hippowdon, Espurr

test('Hippowdon, Twister Spewing: 80, and with Tarragon played from your hand this turn, discard the top 3 cards of the opponent\'s deck', () => {
  const mk = (): Game => S([{ active: 'Hippowdon', energy: { active: [FI, FI, FI] }, hand: ['Tarragon'], discard: [FI] }, { active: DRA }]);
  const g = mk();
  const deck1 = g.state.p[1].deck.length;
  choose(g, 'Play Tarragon');
  g.submit([0]);
  choose(g, 'Attack: Twister Spewing');
  assert.equal(dmg(g, 1), 80);
  assert.equal(g.state.p[1].discard.length, 3, 'the top 3 cards are in the opponent discard pile');
  assert.equal(g.state.p[1].deck.length, deck1 - 3 - 1, '3 discarded, and the opponent drew 1 for their turn');
  const without = mk();
  choose(without, 'Attack: Twister Spewing');
  assert.equal(dmg(without, 1), 80);
  assert.equal(without.state.p[1].discard.length, 0, 'Tarragon not played: nothing is discarded');
  assert.equal(without.state.p[1].deck.length, deck1 - 1);
});

test('Espurr, Buddy Attack: 10, and 60 more if you played Emma from your hand this turn', () => {
  const mk = (hand: string[]): Game => S([{ active: 'Espurr', energy: { active: [P] }, hand }, { active: DRA, hand: [REL] }]);
  const plain = mk([]);
  choose(plain, 'Attack: Buddy Attack');
  assert.equal(dmg(plain, 1), 10);
  const g = mk(['Emma']);
  choose(g, 'Play Emma');
  if (g.decision?.player === 0 && g.decision.kind !== 'main') g.submit([]);
  choose(g, 'Attack: Buddy Attack');
  assert.equal(dmg(g, 1), 70, '10 + 60');
});

// ------------------------------------------------------------------ Deoxys

test('Deoxys, Psy Protection: 80, then prevent all damage from attacks by Pokémon that have an Ability during the opponent\'s next turn', () => {
  const hit = (attacker: string, atk: string, energy: string[]): [number, number] => {
    const g = S([{ active: 'Deoxys', energy: { active: [P, P, P] } }, { active: attacker, energy: { active: energy } }]);
    choose(g, 'Attack: Psy Protection');
    assert.equal(dmg(g, 1), 80);
    choose(g, `Attack: ${atk}`);
    return [dmg(g, 0), g.state.turn];
  };
  assert.equal(hit('Magcargo', 'Heat Blast', [R, R, R])[0], 0, 'Magcargo has Lava Zone: prevented');
  assert.equal(hit(DRA, 'Jet Headbutt', [P])[0], 70, 'Dragapult ex has no Ability: not prevented');
});

// ------------------------------------------------------------------ Miraidon

for (const [label, d, thunder] of [
  ['me05-028', dk, 'This Pokémon also does 30 damage to itself.'],
  ['mep-082', dkPromo, 'This Pokémon does 30 damage to itself.'],
] as const) {
  const T = (sides: Sides, o = {}): Game => S(sides, o, d);

  test(`${label} Miraidon, Thunder: 90, and 30 damage to itself ("${thunder}")`, () => {
    const g = T([{ active: 'Miraidon', energy: { active: [L, L] } }, { active: DRA }]);
    choose(g, 'Attack: Thunder');
    assert.equal(dmg(g, 1), 90);
    assert.equal(g.state.p[0].active!.damage, 30);
  });

  test(`${label} Miraidon, Photon Cord: Knocked Out in the Active Spot by damage from an attack, move 1 or 2 Basic {L} Energy to a Benched Pokémon (ruling 2399)`, () => {
    const ko = (): Game => {
      const g = T([{ active: 'Miraidon', bench: [REL], energy: { active: [L, L, R] }, damage: { active: 110 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
      choose(g, 'Attack: Jet Headbutt');
      return g;
    };
    const both = ko();
    // Ruling (Pitch Black FAQ, TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2399/): at least one Basic Lightning Energy must be moved (only attacks can choose zero).
    assert.equal(cardsMin(both), 1, 'at least one is moved');
    both.submit([0, 1]);
    // Rellor was the only Benched Pokémon; with Miraidon Knocked Out it is the Active Pokémon now.
    assert.deepEqual(both.state.p[0].active!.energy.map((c) => nameOf(both, c)), [L, L], 'both Lightning Energy are on the Pokémon that was Benched');
    assert.equal(both.state.p[1].prizesTaken, 1);
    assert.ok(both.state.p[0].discard.some((c) => nameOf(both, c) === R), 'the Fire Energy went to the discard pile with Miraidon');
    assert.ok(!both.state.p[0].discard.some((c) => nameOf(both, c) === L), 'the moved Energy did not');

    const one = ko();
    one.submit([0]);
    assert.deepEqual(one.state.p[0].active!.energy.map((c) => nameOf(one, c)), [L]);
    assert.ok(one.state.p[0].discard.some((c) => nameOf(one, c) === L), 'the other Lightning Energy was discarded with Miraidon');
  });

  test(`${label} Miraidon, Photon Cord: asks which Benched Pokémon; nothing without a Basic {L} Energy card, or a Benched Pokémon, or a Knock Out`, () => {
    const g = T([{ active: 'Miraidon', bench: [REL, SLO], energy: { active: [L] }, damage: { active: 110 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    choose(g, 'Attack: Jet Headbutt');
    assert.equal(g.decision?.kind, 'slots', 'which Benched Pokémon');
    choose(g, SLO);
    choose(g, REL); // the Knocked Out Miraidon is replaced
    assert.equal(g.state.p[0].active!.energy.length, 0);
    assert.deepEqual(g.state.p[0].bench[0]!.energy.map((c) => nameOf(g, c)), [L]);
    assert.equal(nameOf(g, g.state.p[0].bench[0]!.cards[0]!), SLO);

    const noL = T([{ active: 'Miraidon', bench: [REL], energy: { active: [R, R] }, damage: { active: 110 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    choose(noL, 'Attack: Jet Headbutt');
    assert.equal(noL.state.p[0].active!.energy.length, 0, 'no Basic {L} Energy to move');
    const noBench = T([{ active: 'Miraidon', energy: { active: [L] }, damage: { active: 110 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    choose(noBench, 'Attack: Jet Headbutt');
    assert.equal(noBench.state.p[1].prizesTaken, 1);

    // Not Knocked Out: no move.
    const alive = T([{ active: 'Miraidon', bench: [REL], energy: { active: [L] } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    choose(alive, 'Attack: Jet Headbutt');
    assert.equal(alive.state.p[0].bench[0]!.energy.length, 0);
    assert.equal(dmg(alive, 0), 70);
  });

  test(`${label} Miraidon, Photon Cord: still usable when an attack moves it to the Bench before it is Knocked Out, but the Energy cannot go onto itself (ruling 2400)`, () => {
    // Ruling (Pitch Black FAQ, TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2400/): Photon Cord works when Miraidon moves to the Bench, but Energy cannot go onto Miraidon itself.
    // Cranidos's Push Down does 70 ({F} Weakness doubles it to 140) and then switches Miraidon out.
    const mk = (bench: string[]): Game => {
      const g = T([{ active: 'Miraidon', bench, energy: { active: [L, L] } }, { active: 'Cranidos', energy: { active: [FI, FI] } }], OPP_TURN);
      choose(g, 'Attack: Push Down');
      return g;
    };
    const two = mk([REL, SLO]);
    assert.equal((two.decision as Decision).player, 0, 'the opponent chooses the new Active Pokémon');
    choose(two, REL);
    // Miraidon is on the Bench now, over its HP: Photon Cord still happens. Rellor is Active, so the only other Benched Pokémon is Slowpoke.
    if (two.decision?.kind === 'cards') two.submit([0, 1]);
    assert.equal(nameOf(two, two.state.p[0].active!.cards[0]!), REL);
    assert.equal(two.state.p[0].bench.length, 1, 'Miraidon was Knocked Out');
    assert.equal(nameOf(two, two.state.p[0].bench[0]!.cards[0]!), SLO);
    assert.deepEqual(two.state.p[0].bench[0]!.energy.map((c) => nameOf(two, c)), [L, L], 'moved to the other Benched Pokémon');
    assert.equal(two.state.p[1].prizesTaken, 1);

    // Rellor is the only other Pokémon, so after the switch Miraidon is the only Benched Pokémon: nowhere to move the Energy.
    const one = mk([REL]);
    assert.equal(nameOf(one, one.state.p[0].active!.cards[0]!), REL, 'Rellor was promoted (the only choice)');
    assert.equal(one.state.p[0].bench.length, 0, 'Miraidon was Knocked Out');
    assert.equal(one.state.p[0].active!.energy.length, 0, 'the Energy did not move onto itself or to the Active Pokémon');
    assert.equal(one.state.p[1].prizesTaken, 1);
    assert.equal(one.state.p[0].discard.filter((c) => nameOf(one, c) === L).length, 2, 'the Energy was discarded with Miraidon');
  });
}
/** The minimum of the current decision (a cards choice). */
function cardsMin(g: Game): number {
  assert.equal(g.decision?.kind, 'cards');
  return (g.decision as Decision & { min: number }).min;
}

// ------------------------------------------------------------------ Annihilape

test('Annihilape, Durable Body: when it would be Knocked Out by damage from an attack, flip a coin; heads leaves it with 10 HP remaining', () => {
  const run = (coins: boolean[]): Game => {
    const g = S([{ active: 'Annihilape', damage: { active: 140 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Jet Headbutt');
    assert.deepEqual(g.state.forcedCoins, []);
    return g;
  };
  const heads = run([true]);
  assert.equal(nameOf(heads, heads.state.p[0].active!.cards[0]!), 'Annihilape', 'not Knocked Out');
  assert.equal(150 - dmg(heads, 0), 10, 'remaining HP is 10');
  assert.equal(heads.state.p[1].prizesTaken, 0);
  const tails = run([false]);
  assert.equal(tails.state.p[0].active, null, 'Knocked Out');
  assert.equal(tails.state.p[1].prizesTaken, 1);
});

test('Annihilape, Ghostly Blow: 100, and 5 damage counters on 1 of the opponent\'s Benched Pokémon (no Weakness or Resistance)', () => {
  const g = S([{ active: 'Annihilape', energy: { active: [P, P] } }, { active: DRA, bench: [REL, SLO] }]);
  choose(g, 'Attack: Ghostly Blow');
  assert.equal(g.decision?.kind, 'slots');
  choose(g, SLO);
  assert.equal(dmg(g, 1), 100);
  assert.equal(g.state.p[1].bench[1]!.damage, 50, '5 damage counters');
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
  const none = S([{ active: 'Annihilape', energy: { active: [P, P] } }, { active: DRA }]);
  choose(none, 'Attack: Ghostly Blow');
  assert.equal(dmg(none, 1), 100, 'no Benched Pokémon: just the damage');
  // Counters ignore Weakness: Slowpoke is weak to {D}, but Annihilape is {P}; use a Rellor (40 HP): 5 counters Knock it Out.
  const ko = S([{ active: 'Annihilape', energy: { active: [P, P] } }, { active: DRA, bench: [REL] }]);
  choose(ko, 'Attack: Ghostly Blow');
  assert.equal(ko.state.p[0].prizesTaken, 1, 'the Benched Rellor (40 HP) is Knocked Out by 50');
});

// ------------------------------------------------------------------ Magcargo

test('Magcargo, Lava Zone: whenever the opponent\'s Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Burned', () => {
  const retreat = (mine: SideLayout): Game => {
    const g = S([mine, { active: REL, bench: [SLO], energy: { active: [G] } }], OPP_TURN);
    choose(g, 'Retreat');
    if (g.decision?.kind === 'cards') g.submit([0]); // which Energy to discard for the Retreat Cost
    return g;
  };
  const g = retreat({ active: DRA, bench: ['Magcargo'] });
  assert.equal(nameOf(g, g.state.p[1].active!.cards[0]!), SLO);
  assert.ok(g.state.p[1].active!.cond & BURNED, 'the new Active Pokémon is Burned');
  assert.equal(g.state.p[1].bench[0]!.cond & BURNED, 0, 'the one that moved to the Bench is not');
  // Without Magcargo: nothing.
  assert.equal(retreat({ active: DRA, bench: [REL] }).state.p[1].active!.cond & BURNED, 0);
  // Magcargo is also active in the Active Spot (the Ability needs no particular spot).
  assert.ok(retreat({ active: 'Magcargo' }).state.p[1].active!.cond & BURNED);
  // "During their turn": a switch on your own turn (Boss's Orders) does not burn.
  const boss = S([{ active: DRA, bench: ['Magcargo'], hand: ["Boss's Orders"] }, { active: REL, bench: [SLO] }]);
  choose(boss, "Play Boss's Orders");
  if (boss.decision?.kind === 'slots') choose(boss, SLO);
  assert.equal(nameOf(boss, boss.state.p[1].active!.cards[0]!), SLO);
  assert.equal(boss.state.p[1].active!.cond & BURNED, 0, 'it moved on your turn, not theirs');
});

// ------------------------------------------------------------------ Cornerstone Mask Ogerpon ex

test('Cornerstone Mask Ogerpon ex, Cornerstone Stance: prevent all damage from attacks by the opponent\'s Pokémon that have an Ability', () => {
  const hit = (attacker: string, atk: string, energy: string[]): number => {
    const g = S([{ active: 'Cornerstone Mask Ogerpon ex' }, { active: attacker, energy: { active: energy } }], OPP_TURN);
    choose(g, `Attack: ${atk}`);
    return dmg(g, 0);
  };
  assert.equal(hit('Magcargo', 'Heat Blast', [R, R, R]), 0, 'Magcargo has Lava Zone');
  assert.equal(hit(SLO, 'Headbutt', [P, P]), 20, 'no Ability: damaged');
  assert.equal(hit(DRA, 'Jet Headbutt', [P]), 70);
});

test('Cornerstone Mask Ogerpon ex, Demolish: 140, not affected by Weakness, Resistance or effects on the opponent\'s Active Pokémon', () => {
  const hit = (defender: string, prep?: (g: Game) => void): number => {
    const g = S([{ active: 'Cornerstone Mask Ogerpon ex', energy: { active: [FI, FI, FI] } }, { active: defender }]);
    prep?.(g);
    choose(g, 'Attack: Demolish');
    return dmg(g, 1);
  };
  assert.equal(hit('Pecharunt ex'), 140, 'Weakness {F} x2 does not apply');
  assert.equal(hit('Annihilape'), 140, 'Resistance {F} -30 does not apply');
  assert.equal(hit(DRA), 140, 'control');
  assert.equal(hit(DRA, (g) => inject(g, g.state.p[1].active!.id, { k: 'damageIn', amount: -50 })), 140, 'a 50 damage reduction is ignored');
  assert.equal(hit(DRA, (g) => inject(g, g.state.p[1].active!.id, { k: 'preventDamage' })), 140, 'damage prevention is ignored');
});
