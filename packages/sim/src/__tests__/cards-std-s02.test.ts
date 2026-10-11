/**
 * Card tests, batch "std-s02": every card scripted in cards/scripts/std-s02.ts does what its printed text says in a constructed
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
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c));
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
/** Submit the cards (instance ids among the current decision's values) by their option indexes. */
function submitCards(g: Game, ...cards: number[]): void {
  g.submit(cards.map((c) => g.decision!.values!.indexOf(c)));
}
const topOf = (sl: { cards: number[] }): number => sl.cards[sl.cards.length - 1]!;
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  "Team Rocket's Nidoking ex": 'sv10-119',
  Hoothoot: 'sv08.5-077',
  Snom: 'sv05-045',
  Bouffalant: 'sv08-151',
  Zamazenta: 'sv10-146',
  'Flutter Mane': 'sv08-096',
  Miraidon: 'sv08-069',
  'Reboot Pod': 'sv05-158',
  'Heavy Baton': 'sv05-151',
  Galvantula: 'sv06.5-002',
  Volbeat: 'sv06-009',
  Salvatore: 'sv05-160',
  Riolu: 'me01-076',
  'Mega Lucario ex': 'me01-077',
  'Lucario ex': 'sv08.5-051',
  Joltik: 'sv06.5-001', // its Evolution Galvantula has an Ability
  Illumise: 'sv06-010',
  'Great Tusk': 'sv05-097',
  'Iron Moth': 'sv06.5-009',
  'Iron Crown ex': 'sv05-081',
  Rellor: 'sv08-013',
  Noctowl: 'sv05-127', // an Evolution, not a Basic: Quick Sign must not find it
  'Dragapult ex': 'sv06-130',
  'Mist Energy': 'sv05-161',
  Onix: 'me01-070',
  Cranidos: 'me05-044',
  Slowpoke: 'mep-086',
  "Boss's Orders": 'me01-114',
  'Cyclizar ex': 'sv08-159',
  "Marnie's Grimmsnarl ex": 'sv10-136',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('s02', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const NID = "Team Rocket's Nidoking ex"; // 330 HP {D}; Tainted Horn {D}{D}{C} 100; Kingly Impact {D}{D}{D}{C} 240
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const REL = 'Rellor'; // Basic 40 HP {G}; Rollout {G} 10
const G = 'Grass Energy';
const R = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
type Sides = [SideLayout, SideLayout];
const OPP_TURN = { current: 1 as const, turn: 4 };
const S = (d: ReturnType<typeof deck>, sides: Sides, o = {}): Game => scenario(d, d, sides, o);

// ------------------------------------------------------------------ Team Rocket's Nidoking ex

test("Team Rocket's Nidoking ex, Tainted Horn: 100 damage, Poisoned, and 8 damage counters at EVERY Pokémon Checkup instead of 1", () => {
  const dk = deck(NID, DRA);
  const g = S(dk, [{ active: NID, energy: { active: [D, D, R] } }, { active: DRA }]);
  choose(g, 'Attack: Tainted Horn');
  assert.ok(g.state.p[1].active!.cond & POISONED, 'Poisoned');
  assert.equal(dmg(g, 1), 100 + 80, '100 and the first Checkup');
  choose(g, 'End turn'); // the opponent's turn ends: their Checkup
  assert.equal(dmg(g, 1), 100 + 160, 'again at the next Checkup');
  // Kingly Impact has no effect text: 240.
  const big = S(dk, [{ active: NID, energy: { active: [D, D, D, R] } }, { active: DRA }]);
  choose(big, 'Attack: Kingly Impact');
  assert.equal(dmg(big, 1), 240);
  assert.equal(big.state.p[1].active!.cond, 0);
});

// ------------------------------------------------------------------ Hoothoot

test("Hoothoot, Insomnia: this Pokémon can't be Asleep (Rellor can); an Asleep one recovers at once; lost with its Abilities", () => {
  const dk = deck('Hoothoot', 'Snom', REL, DRA);
  const sleep = (target: string): Game => {
    const g = S(dk, [{ active: target, bench: [REL] }, { active: 'Snom', energy: { active: [W] } }], OPP_TURN);
    g.state.forcedCoins = [false]; // tails at Checkup: an Asleep Pokémon stays Asleep
    choose(g, 'Attack: Powder Snow');
    return g;
  };
  assert.equal(sleep('Hoothoot').state.p[0].active!.cond & ASLEEP, 0, 'not Asleep');
  assert.equal(dmg(sleep('Hoothoot'), 0), 10, 'the damage still lands');
  assert.ok(sleep(REL).state.p[0].active!.cond & ASLEEP, 'a Pokémon without it falls Asleep');
  // Already Asleep (before the Ability was on): it recovers.
  const cured = S(dk, [{ active: 'Hoothoot', cond: ASLEEP, hand: [P] }, { active: DRA }]);
  choose(cured, 'Attach Psychic Energy');
  assert.equal(cured.state.p[0].active!.cond & ASLEEP, 0);
  // An Ability: with no Abilities it falls Asleep.
  const off = S(dk, [{ active: 'Hoothoot', bench: [REL] }, { active: 'Snom', energy: { active: [W] } }], OPP_TURN);
  off.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 1, scope: 'oppPokemon', until: 5, fromAttack: false, src: 0 });
  off.state.forcedCoins = [false];
  choose(off, 'Attack: Powder Snow');
  assert.ok(off.state.p[0].active!.cond & ASLEEP);
});

// ------------------------------------------------------------------ Bouffalant

test("Bouffalant, Ready to Ram: 40 damage; if it is damaged by an attack during the opponent's next turn (even if Knocked Out), 6 damage counters on the Attacking Pokémon", () => {
  const dk = deck('Bouffalant', DRA, REL, 'Mist Energy');
  const mk = (oppEnergy: string[], damage = 0): Game => {
    const g = S(dk, [{ active: 'Bouffalant', energy: { active: [R, R] }, bench: [REL], damage: { active: damage } }, { active: DRA, energy: { active: oppEnergy } }]);
    choose(g, 'Attack: Ready to Ram');
    assert.equal(dmg(g, 1), 40);
    return g;
  };
  const g = mk([P]);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 70, 'the attack damaged Bouffalant');
  assert.equal(dmg(g, 1), 40 + 60, '6 damage counters on the Attacking Pokémon');
  // Even if that Knocks it Out.
  const ko = mk([P], 100);
  choose(ko, 'Attack: Jet Headbutt');
  assert.ok(ko.state.p[0].discard.some((c) => nameOf(ko, c) === 'Bouffalant'), 'Knocked Out');
  assert.equal(dmg(ko, 1), 40 + 60);
  // Ruling (TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1958/), same kind of effect: Mist Energy on the Attacking Pokémon prevents the counters.
  const mist = mk(['Mist Energy']);
  choose(mist, 'Attack: Jet Headbutt');
  assert.equal(dmg(mist, 0), 70, 'the damage was done');
  assert.equal(dmg(mist, 1), 40, 'but the 6 damage counters were blocked');
  // It lasts for that turn only.
  const later = mk([P]);
  choose(later, 'End turn');
  assert.equal(later.state.effects.filter((e) => e.static.k === 'react').length, 0);
  // A damaged Bouffalant that is not hit (the opponent does not attack): nothing is placed.
  const quiet = mk([P]);
  assert.equal(dmg(quiet, 1), 40);
});

test('Bouffalant, Smashing Headbutt: 150 damage, discard 2 Energy from this Pokémon', () => {
  const dk = deck('Bouffalant', DRA);
  const g = S(dk, [{ active: 'Bouffalant', energy: { active: [R, R, R, R, W] } }, { active: DRA }]);
  choose(g, 'Attack: Smashing Headbutt');
  assert.equal(dmg(g, 1), 150);
  assert.equal(g.decision?.kind, 'cards', 'the player chooses which 2 Energy cards');
  assert.equal(g.decision?.min, 2);
  assert.equal(g.decision?.max, 2);
  g.submit([0, 4]);
  assert.equal(g.state.p[0].active!.energy.length, 3, '2 of the 5 were discarded');
  assert.equal(g.state.p[0].discard.length, 2);
});

// ------------------------------------------------------------------ Zamazenta

test('Zamazenta, Strong Bash: 70 damage; if it is damaged by an attack during the opponent\'s next turn (even if Knocked Out), damage counters on the Attacking Pokémon equal to the damage done', () => {
  const dk = deck('Zamazenta', DRA, REL, "Marnie's Grimmsnarl ex");
  const mk = (oppActive: string, oppEnergy: string[], damage = 0): Game => {
    const g = S(dk, [{ active: 'Zamazenta', energy: { active: [M, M, R] }, bench: [REL], damage: { active: damage } }, { active: oppActive, energy: { active: oppEnergy } }]);
    choose(g, 'Attack: Strong Bash');
    assert.equal(dmg(g, 1), 70);
    return g;
  };
  const g = mk(DRA, [P]);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 70);
  assert.equal(dmg(g, 1), 70 + 70, '70 damage done: 7 damage counters');
  // Ruling (Destined Rivals FAQ, TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2165/): damage done to a Pokémon can be more than its maximum HP.
  // An undamaged 130 HP Zamazenta hit for 180: 18 damage counters, not 13.
  const big = mk("Marnie's Grimmsnarl ex", [D, D]);
  choose(big, 'Attack: Shadow Bullet');
  assert.ok(big.state.p[0].discard.some((c) => nameOf(big, c) === 'Zamazenta'), 'Knocked Out');
  assert.equal(dmg(big, 1), 70 + 180, '180 damage done to Zamazenta, even though it only had 130 HP');
  // Hit while already damaged: the damage done counts, not what the Pokémon had.
  const hurt = mk(DRA, [P], 30);
  choose(hurt, 'Attack: Jet Headbutt');
  assert.equal(dmg(hurt, 1), 70 + 70);
  // No damage done (prevented): no counters.
  const prevented = mk(DRA, [P]);
  inject(prevented, prevented.state.p[0].active!.id, { k: 'preventDamage' });
  choose(prevented, 'Attack: Jet Headbutt');
  assert.equal(dmg(prevented, 0), 0);
  assert.equal(dmg(prevented, 1), 70, 'nothing was damaged, nothing is placed');
  // It lasts for the opponent's next turn only.
  const later = mk(DRA, [P]);
  choose(later, 'End turn');
  assert.equal(later.state.effects.filter((e) => e.static.k === 'react').length, 0);
});

// ------------------------------------------------------------------ Flutter Mane

test("Flutter Mane, Perplexing Transfer: move all damage counters from 1 of your Benched Ancient Pokémon to your opponent's Active Pokémon (not an untagged one)", () => {
  const dk = deck('Flutter Mane', 'Great Tusk', 'Iron Moth', REL, DRA);
  const g = S(dk, [{ active: 'Flutter Mane', energy: { active: [P, P] }, bench: ['Great Tusk', REL, 'Great Tusk'], damage: { 0: 70, 1: 30, 2: 20 } }, { active: DRA }]);
  const bench = g.state.p[0].bench;
  choose(g, 'Attack: Perplexing Transfer');
  assert.equal(g.decision?.kind, 'slots');
  assert.equal(g.decision?.values?.length, 2, 'the two Great Tusks (Rellor is not Ancient)');
  g.submit([0]); // the first Great Tusk
  assert.equal(dmg(g, 1), 70, 'all 7 counters, placed on the Active Pokémon (no Weakness)');
  assert.equal(bench[0]!.damage, 0, 'taken off');
  assert.equal(bench[1]!.damage, 30, 'Rellor untouched');
  assert.equal(bench[2]!.damage, 20, 'the other Great Tusk untouched');
  assert.equal(dmg(g, 0), 0, 'Flutter Mane itself unaffected');
  // Only an Ancient Pokémon: Rellor alone, and a Future one, are nothing to move from.
  const none = S(dk, [{ active: 'Flutter Mane', energy: { active: [P, P] }, bench: [REL, 'Iron Moth'], damage: { 0: 30, 1: 50 } }, { active: DRA }]);
  choose(none, 'Attack: Perplexing Transfer');
  assert.equal(dmg(none, 1), 0);
  assert.equal(none.state.p[0].bench[0]!.damage, 30);
  assert.equal(none.state.p[0].bench[1]!.damage, 50);
  // A Benched Ancient Pokémon with no damage: nothing to move.
  const clean = S(dk, [{ active: 'Flutter Mane', energy: { active: [P, P] }, bench: ['Great Tusk'] }, { active: DRA }]);
  choose(clean, 'Attack: Perplexing Transfer');
  assert.equal(dmg(clean, 1), 0);
});

test("Flutter Mane, Moonblast: 70 damage; during the opponent's next turn, attacks used by the Defending Pokémon do 30 less damage", () => {
  const dk = deck('Flutter Mane', DRA);
  const g = S(dk, [{ active: 'Flutter Mane', energy: { active: [P, P] } }, { active: DRA, energy: { active: [P] } }]);
  choose(g, 'Attack: Moonblast');
  assert.equal(dmg(g, 1), 70);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 40, '70 - 30');
  // It ends after that turn.
  const later = S(dk, [{ active: 'Flutter Mane', energy: { active: [P, P] } }, { active: DRA, energy: { active: [P] } }]);
  choose(later, 'Attack: Moonblast');
  choose(later, 'End turn');
  choose(later, 'End turn');
  choose(later, 'Attack: Jet Headbutt');
  assert.equal(dmg(later, 0), 70, 'two turns later it is gone');
});

// ------------------------------------------------------------------ Miraidon

test("Miraidon, C.O.D.E.: Protect: 40 damage; during the opponent's next turn, damage from attacks by Pokémon ex to each of your Future Pokémon is prevented (Active and Benched; others are not)", () => {
  const dk = deck('Miraidon', 'Iron Moth', 'Great Tusk', REL, DRA, 'Cyclizar ex', 'Onix');
  const mk = (oppActive: string, oppEnergy: string[]): Game => {
    const g = S(dk, [{ active: 'Miraidon', energy: { active: [L, R] }, bench: ['Iron Moth', 'Great Tusk', REL] }, { active: oppActive, energy: { active: oppEnergy } }]);
    choose(g, 'Attack: C.O.D.E.: Protect');
    assert.equal(dmg(g, 1), 40);
    return g;
  };
  // An ex's attack on the Active Future Pokémon: prevented.
  const ex = mk(DRA, [P]);
  choose(ex, 'Attack: Jet Headbutt');
  assert.equal(dmg(ex, 0), 0, 'Miraidon takes nothing from Dragapult ex');
  // A Pokémon that is not an ex: not prevented.
  const plain = mk('Onix', [R, R]);
  choose(plain, 'Attack: Bind');
  assert.equal(dmg(plain, 0), 60, "Onix is not a Pokémon ex: Bind 30, doubled by Miraidon's {F} Weakness");
  // Benched Pokémon: Cyclizar ex's Break Through does 130 to the Active Pokémon and 30 to 1 Benched Pokémon.
  const bench = (target: string): Game => {
    const g = mk('Cyclizar ex', [R, R, R]);
    choose(g, 'Attack: Break Through');
    choose(g, target);
    return g;
  };
  const moth = bench('Iron Moth');
  assert.equal(moth.state.p[0].bench[0]!.damage, 0, 'a Benched Future Pokémon is protected too');
  assert.equal(dmg(moth, 0), 0);
  const tusk = bench('Great Tusk');
  assert.equal(tusk.state.p[0].bench[1]!.damage, 30, 'an Ancient Pokémon is not a Future one');
  const rel = bench(REL);
  assert.equal(rel.state.p[0].bench[2]!.damage, 30, 'and neither is Rellor');
  // It lasts through the opponent's next turn only.
  const later = mk(DRA, [P]);
  choose(later, 'End turn');
  choose(later, 'End turn');
  choose(later, 'Attack: Jet Headbutt');
  assert.equal(dmg(later, 0), 70, 'two turns later damage lands');
});

test('Miraidon, C.O.D.E.: Protect: if this Pokémon is no longer your Active Pokémon, the effect ends', () => {
  const dk = deck('Miraidon', 'Iron Moth', DRA, "Boss's Orders");
  const g = S(dk, [{ active: 'Miraidon', energy: { active: [L, R] }, bench: ['Iron Moth'] }, { active: DRA, energy: { active: [P] }, hand: ["Boss's Orders"] }]);
  choose(g, 'Attack: C.O.D.E.: Protect');
  // The opponent brings Iron Moth to the Active Spot: Miraidon is on the Bench now, so nothing protects Iron Moth.
  choose(g, "Play Boss's Orders"); // the only Benched Pokémon: no choice
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), 'Iron Moth');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 70, 'the effect ended when Miraidon left the Active Spot');
  // Without the switch, the same attack is prevented.
  const kept = S(dk, [{ active: 'Miraidon', energy: { active: [L, R] }, bench: ['Iron Moth'] }, { active: DRA, energy: { active: [P] } }]);
  choose(kept, 'Attack: C.O.D.E.: Protect');
  choose(kept, 'Attack: Jet Headbutt');
  assert.equal(dmg(kept, 0), 0);
});

// ------------------------------------------------------------------ Reboot Pod

test('Reboot Pod: attach a Basic Energy card from your discard pile to each of your Future Pokémon', () => {
  const dk = deck('Reboot Pod', 'Iron Moth', 'Miraidon', 'Great Tusk', REL, DRA, 'Mist Energy');
  const g = S(dk, [
    { active: 'Iron Moth', bench: ['Miraidon', 'Great Tusk', REL], hand: ['Reboot Pod'], discard: [R, R, W, 'Mist Energy'] },
    { active: DRA },
  ]);
  const [moth, mirai, tusk, rel] = [g.state.p[0].active!, ...g.state.p[0].bench];
  choose(g, 'Play Reboot Pod');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 2, 'one for each of the 2 Future Pokémon');
  assert.equal(g.decision?.max, 2);
  assert.equal(g.decision?.values?.length, 3, 'Basic Energy cards only: not the Mist Energy');
  const options = labels(g);
  g.submit([options.indexOf('Fire Energy'), options.indexOf('Water Energy')]);
  // Each card goes to a Future Pokémon, no Pokémon taking both.
  assert.equal(g.decision?.kind, 'slots');
  assert.deepEqual(g.decision!.values!.slice().sort(), [moth.id, mirai!.id].sort());
  choose(g, 'Miraidon'); // the Fire Energy
  assert.deepEqual(names(g, mirai!.energy), ['Fire Energy']);
  assert.deepEqual(names(g, moth.energy), ['Water Energy'], 'the other Future Pokémon got the other card, without a question');
  assert.equal(tusk!.energy.length + rel!.energy.length, 0, 'neither Ancient nor untagged Pokémon');
  assert.deepEqual(names(g, g.state.p[0].discard).sort(), ['Fire Energy', 'Mist Energy', 'Reboot Pod'], 'one Fire Energy and the Special Energy remain (and the Item)');
});

test('Reboot Pod: fewer Basic Energy cards than Future Pokémon; not playable with no Future Pokémon or no Basic Energy in the discard pile', () => {
  const dk = deck('Reboot Pod', 'Iron Moth', 'Miraidon', 'Iron Crown ex', 'Great Tusk', DRA, 'Mist Energy');
  const g = S(dk, [{ active: 'Iron Moth', bench: ['Miraidon', 'Iron Crown ex'], hand: ['Reboot Pod'], discard: [R] }, { active: DRA }]);
  choose(g, 'Play Reboot Pod');
  assert.equal(g.decision?.min, 1, 'one card for three Future Pokémon');
  g.submit([0]);
  if (g.decision?.kind === 'slots') choose(g, 'Iron Crown ex');
  const all = [g.state.p[0].active!, ...g.state.p[0].bench];
  assert.equal(all.reduce((n, sl) => n + sl.energy.length, 0), 1, 'exactly one Energy attached');
  assert.equal(g.state.p[0].discard.filter((c) => nameOf(g, c) === 'Fire Energy').length, 0);
  // No Future Pokémon in play.
  const none = S(dk, [{ active: 'Great Tusk', hand: ['Reboot Pod'], discard: [R, W] }, { active: DRA }]);
  assert.ok(!has(none, 'Reboot Pod'));
  // No Basic Energy card in the discard pile (a Special Energy is not one).
  const empty = S(dk, [{ active: 'Iron Moth', hand: ['Reboot Pod'], discard: ['Mist Energy'] }, { active: DRA }]);
  assert.ok(!has(empty, 'Reboot Pod'));
});

// ------------------------------------------------------------------ Heavy Baton

test("Heavy Baton: if the Pokémon has a Retreat Cost of exactly 4, is in the Active Spot, and is Knocked Out by damage from an attack, move up to 3 Basic Energy cards to your Benched Pokémon in any way you like", () => {
  const dk = deck('Heavy Baton', 'Onix', REL, 'Slowpoke', DRA, 'Mist Energy');
  const mk = (energy: string[], sides1: Partial<SideLayout> = {}): Game =>
    S(dk, [{ active: 'Onix', tools: { active: ['Heavy Baton'] }, energy: { active: energy }, bench: [REL, 'Slowpoke'], damage: { active: 60 } }, { active: DRA, energy: { active: [P] }, ...sides1 }], OPP_TURN);
  // Onix (Retreat Cost 4) is Knocked Out in the Active Spot by Dragapult ex's 70.
  const g = mk([FI, FI, W, 'Mist Energy']);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 1, 'at least one: only an attack can choose zero');
  assert.equal(g.decision?.max, 3);
  assert.equal(g.decision?.values?.length, 3, 'Basic Energy cards only: not the Mist Energy');
  g.submit([0, 1, 2]);
  // Each card goes to a Benched Pokémon of the player's choosing.
  assert.equal(g.decision?.kind, 'slots');
  choose(g, 'Rellor');
  choose(g, 'Slowpoke');
  choose(g, 'Slowpoke');
  while (g.decision && g.decision.kind !== 'main') g.submit([0]); // promote a new Active Pokémon
  const all = [g.state.p[0].active!, ...g.state.p[0].bench];
  const total = (n: string) => all.filter((sl) => nameOf(g, sl.cards[0]!) === n).flatMap((sl) => names(g, sl.energy));
  assert.equal(total(REL).length + total('Slowpoke').length, 3, 'three Basic Energy cards moved');
  assert.equal(g.state.p[0].discard.filter((c) => nameOf(g, c) === 'Mist Energy').length, 1, 'the Special Energy went to the discard pile with Onix');
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Onix'));
  assert.equal(g.state.p[1].prizesTaken, 1);
});

test('Heavy Baton: up to 3 (not 4) Basic Energy cards; no question with one card or one Benched Pokémon', () => {
  const dk = deck('Heavy Baton', 'Onix', REL, 'Slowpoke', DRA);
  const four = S(dk, [{ active: 'Onix', tools: { active: ['Heavy Baton'] }, energy: { active: [FI, FI, W, R] }, bench: [REL], damage: { active: 60 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(four, 'Attack: Jet Headbutt');
  assert.equal(four.decision?.max, 3);
  four.submit([0, 1, 2]); // the single Benched Pokémon takes all of them without a question
  assert.equal(four.state.p[0].active!.energy.length, 3, 'Rellor (promoted) holds the 3 moved cards');
  assert.equal(four.state.p[0].discard.filter((c) => def(four.ctx, c).kind === 'energy').length, 1, 'the fourth went to the discard pile with Onix');
  const one = S(dk, [{ active: 'Onix', tools: { active: ['Heavy Baton'] }, energy: { active: [FI] }, bench: [REL, 'Slowpoke'], damage: { active: 60 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(one, 'Attack: Jet Headbutt');
  assert.equal(one.decision?.kind, 'slots', 'the one Energy card is chosen for you; only where it goes is asked');
});

test('Heavy Baton: the Retreat Cost must be exactly 4 (with the effects that change it)', () => {
  const dk = deck('Heavy Baton', 'Onix', REL, DRA);
  const run = (delta: number): Game => {
    const g = S(dk, [{ active: 'Onix', tools: { active: ['Heavy Baton'] }, energy: { active: [FI, FI] }, bench: [REL], damage: { active: 60 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
    if (delta) inject(g, g.state.p[0].active!.id, { k: 'retreatCost', delta });
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  const four = run(0);
  assert.equal(four.state.p[0].active!.energy.length, 2, 'exactly 4: the Energy moved to the Benched Pokémon (now Active)');
  const three = run(-1);
  assert.equal(three.state.p[0].active!.energy.length, 0, 'a Retreat Cost of 3: no move');
  assert.equal(three.state.p[0].discard.filter((c) => def(three.ctx, c).kind === 'energy').length, 2);
  const five = run(1);
  assert.equal(five.state.p[0].active!.energy.length, 0, 'a Retreat Cost of 5: no move');
  // A Retreat Cost of 1 (Rellor) is not 4 either.
  const rel = S(dk, [{ active: REL, tools: { active: ['Heavy Baton'] }, energy: { active: [G] }, bench: ['Onix'], damage: { active: 30 } }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(rel, 'Attack: Jet Headbutt');
  assert.equal(rel.state.p[0].active!.energy.length, 0);
});

test('Heavy Baton: not when the Pokémon is Knocked Out on the Bench, or by Poison; and not when it is not Knocked Out', () => {
  const dk = deck('Heavy Baton', 'Onix', REL, 'Cyclizar ex', DRA);
  // Knocked Out on the Bench by the 30 damage of Break Through: it was never in the Active Spot.
  const bench = S(dk, [{ active: DRA, bench: ['Onix', REL], tools: { 0: ['Heavy Baton'] }, energy: { 0: [FI, FI] }, damage: { 0: 100 } }, { active: 'Cyclizar ex', energy: { active: [R, R, R] } }], OPP_TURN);
  choose(bench, 'Attack: Break Through');
  choose(bench, 'Onix');
  assert.ok(bench.state.p[0].discard.some((c) => nameOf(bench, c) === 'Onix'), 'Onix was Knocked Out');
  assert.equal(bench.state.p[0].bench[0]!.energy.length + bench.state.p[0].active!.energy.length, 0, 'nothing moved');
  // Knocked Out by Poison at Checkup: not by damage from an attack.
  const poison = S(dk, [{ active: 'Onix', tools: { active: ['Heavy Baton'] }, energy: { active: [FI, FI] }, bench: [REL], damage: { active: 110 }, cond: POISONED }, { active: DRA }], OPP_TURN);
  choose(poison, 'End turn');
  assert.ok(poison.state.p[0].discard.some((c) => nameOf(poison, c) === 'Onix'), 'Knocked Out by Poison');
  assert.equal(poison.state.p[0].active!.energy.length, 0);
  // Damaged but not Knocked Out: nothing.
  const alive = S(dk, [{ active: 'Onix', tools: { active: ['Heavy Baton'] }, energy: { active: [FI, FI] }, bench: [REL] }, { active: DRA, energy: { active: [P] } }], OPP_TURN);
  choose(alive, 'Attack: Jet Headbutt');
  assert.equal(alive.state.p[0].active!.energy.length, 2);
  assert.equal(alive.state.p[0].bench[0]!.energy.length, 0);
});

test('Heavy Baton: still works when the attack that Knocks the Pokémon Out moves it to the Bench (ruling 1992), but the Energy cannot stay on it', () => {
  // Ruling (TPCi Rules Team 2024-06-20, https://compendium.pokegym.net/ruling/1992/): "Yes. Heavy Baton checks for two things here: Iron Hands ex was damaged by an attack while it was your Active Pokemon, and Iron Hands ex was Knocked Out by that attack.  So even though you don't check for a KO until the attack is completed, the criteria for using Heavy Baton has been met, so it can be used."
  // Cranidos's Push Down does 70 ({F} Weakness would double it, Onix has {G}) and then switches Onix out.
  const dk = deck('Heavy Baton', 'Onix', REL, 'Slowpoke', 'Cranidos');
  const g = S(dk, [{ active: 'Onix', tools: { active: ['Heavy Baton'] }, energy: { active: [FI, W] }, bench: [REL, 'Slowpoke'], damage: { active: 60 } }, { active: 'Cranidos', energy: { active: [FI, FI] } }], OPP_TURN);
  choose(g, 'Attack: Push Down');
  assert.equal((g.decision as Decision).player, 0, 'the opponent chooses the new Active Pokémon');
  choose(g, REL);
  // Onix is on the Bench, over its HP: Heavy Baton still happens, and the Energy goes to the only OTHER Benched Pokémon.
  while (g.decision?.kind === 'cards') g.submit([0, 1]);
  assert.equal(nameOf(g, g.state.p[0].active!.cards[0]!), REL);
  assert.equal(g.state.p[0].bench.length, 1, 'Onix was Knocked Out');
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy).sort(), ['Fighting Energy', 'Water Energy'], 'moved to the other Benched Pokémon');
  assert.equal(g.state.p[0].active!.energy.length, 0);
  // Not pushed to the Bench: only Rellor left, it takes them.
});

// ------------------------------------------------------------------ Galvantula

test("Galvantula, Compound Eyes: attacks used by this Pokémon do 50 more damage to your opponent's Active Pokémon that has an Ability", () => {
  const dk = deck('Galvantula', 'Iron Crown ex', DRA, REL);
  const hit = (oppActive: string, o: { lightning?: boolean; oppBench?: string[] } = {}): Game => {
    const g = S(dk, [{ active: 'Galvantula', energy: { active: [G, o.lightning ? L : W] } }, { active: oppActive, bench: o.oppBench }]);
    choose(g, 'Attack: Shocking Web');
    return g;
  };
  assert.equal(dmg(hit(DRA), 1), 50, 'no Ability on Dragapult ex: 50');
  assert.equal(dmg(hit('Iron Crown ex'), 1), 100, 'Iron Crown ex has an Ability: +50');
  // Only the Active Pokémon: a Benched Pokémon with an Ability does not matter (the Active one has none).
  assert.equal(dmg(hit(DRA, { oppBench: ['Iron Crown ex'] }), 1), 50);
  // Compound Eyes is an Ability: with Galvantula's Abilities off there is no bonus either.
  const mute = S(dk, [{ active: 'Galvantula', energy: { active: [G, W] } }, { active: 'Iron Crown ex' }]);
  mute.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 1, scope: 'oppPokemon', until: 5, fromAttack: false, src: 0 });
  choose(mute, 'Attack: Shocking Web');
  assert.equal(dmg(mute, 1), 50);
});

test('Galvantula, Shocking Web: 50 damage; 80 more if this Pokémon has any {L} Energy attached', () => {
  const dk = deck('Galvantula', 'Iron Crown ex', DRA);
  const hit = (energy: string[], oppActive = DRA): number => {
    const g = S(dk, [{ active: 'Galvantula', energy: { active: energy } }, { active: oppActive }]);
    choose(g, 'Attack: Shocking Web');
    return dmg(g, 1);
  };
  assert.equal(hit([G, W]), 50);
  assert.equal(hit([G, L]), 130, 'with a Lightning Energy');
  assert.equal(hit([G, L, L]), 130, 'not per Energy: any');
  assert.equal(hit([G, L], 'Iron Crown ex'), 180, 'with Compound Eyes on top');
  // {L} Energy on another Pokémon doesn't count.
  const other = S(dk, [{ active: 'Galvantula', energy: { active: [G, W], 0: [L] }, bench: [DRA] }, { active: DRA }]);
  choose(other, 'Attack: Shocking Web');
  assert.equal(dmg(other, 1), 50);
});

// ------------------------------------------------------------------ Volbeat

test("Volbeat, Quick Sign: if you go first, you can use this attack during your first turn; search your deck for up to 2 Basic Pokémon and put them onto your Bench", () => {
  const dk = deck('Volbeat', 'Illumise', REL, 'Noctowl', DRA);
  // Turn 1, the first player: Quick Sign is usable, Coordinated Strike (not a first-turn attack) is not.
  const g = S(dk, [{ active: 'Volbeat', energy: { active: [R, R] } }, { active: DRA }], { turn: 1, current: 0, first: 0 });
  assert.ok(has(g, 'Attack: Quick Sign'), 'usable during the first turn');
  assert.ok(!has(g, 'Attack: Coordinated Strike'), 'an ordinary attack is not');
  choose(g, 'Attack: Quick Sign');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 0, 'up to 2 on an attack: 0 to 2');
  assert.equal(g.decision?.max, 2);
  assert.ok(g.decision!.values!.every((c) => def(g.ctx, c).kind === 'pokemon' && def(g.ctx, c).stage === 0), 'Basic Pokémon only: not the Noctowl');
  const rellor = g.decision!.values!.find((c) => nameOf(g, c) === REL)!;
  const illumise = g.decision!.values!.find((c) => nameOf(g, c) === 'Illumise')!;
  submitCards(g, rellor, illumise);
  assert.equal(g.state.p[0].bench.length, 2, 'two Basic Pokémon onto the Bench');
  assert.deepEqual(names(g, g.state.p[0].bench.map((b) => b.cards[0]!)).sort(), ['Illumise', REL].sort());
  // Ruling (Twilight Masquerade FAQ, TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1978/): "You can use it on any turn, not just your first turn."
  const later = S(dk, [{ active: 'Volbeat', energy: { active: [R, R] } }, { active: DRA }]);
  assert.ok(has(later, 'Attack: Quick Sign'));
  // The second player's first turn is turn 2: attacks are usable then as for anyone.
  const second = S(dk, [{ active: DRA }, { active: 'Volbeat', energy: { active: [R, R] } }], { turn: 2, current: 1, first: 0 });
  assert.ok(has(second, 'Attack: Quick Sign'));
  // Only as many as the Bench has room for.
  const crowded = S(dk, [{ active: 'Volbeat', energy: { active: [R, R] }, bench: [REL, REL, REL, REL] }, { active: DRA }]);
  choose(crowded, 'Attack: Quick Sign');
  assert.equal(crowded.decision?.max, 1, 'room for 1 more');
  crowded.submit([0]);
  assert.equal(crowded.state.p[0].bench.length, 5, 'the Bench holds 5');
});

test('Volbeat, Quick Sign: it is only Quick Sign that is usable on the first turn; the first-turn rule still blocks other attacks', () => {
  const dk = deck('Volbeat', DRA);
  // The first player on turn 1 can't use ordinary attacks (here: Dragapult ex).
  const g = S(dk, [{ active: DRA, energy: { active: [P] } }, { active: 'Volbeat' }], { turn: 1, current: 0, first: 0 });
  assert.ok(!has(g, 'Attack: Jet Headbutt'));
});

test('Volbeat, Coordinated Strike: 20 damage; 60 more if Illumise is on your Bench', () => {
  const dk = deck('Volbeat', 'Illumise', REL, DRA);
  const hit = (mine: Partial<SideLayout>, theirs: Partial<SideLayout> = {}): number => {
    const g = S(dk, [{ active: 'Volbeat', energy: { active: [R, R] }, ...mine }, { active: DRA, ...theirs }]);
    choose(g, 'Attack: Coordinated Strike');
    return dmg(g, 1);
  };
  assert.equal(hit({}), 20);
  assert.equal(hit({ bench: [REL, 'Illumise'] }), 80, 'Illumise on the Bench');
  assert.equal(hit({}, { bench: ['Illumise'] }), 20, "the opponent's Bench is not yours");
  // Illumise as the Active Pokémon is not on the Bench.
  const active = S(dk, [{ active: 'Illumise', energy: { active: [R, R] }, bench: ['Volbeat'] }, { active: DRA }]);
  assert.ok(!has(active, 'Coordinated Strike'));
});

// ------------------------------------------------------------------ Salvatore

test('Salvatore: search the deck for a card with no Abilities that evolves from 1 of your Pokémon and put it onto that Pokémon; shuffle', () => {
  const dk = deck('Salvatore', 'Riolu', 'Mega Lucario ex', 'Lucario ex', DRA);
  const g = S(dk, [{ active: DRA, bench: ['Riolu'], hand: ['Salvatore'] }, { active: DRA }]);
  const riolu = g.state.p[0].bench[0]!;
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Salvatore');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 0, 'a search may find nothing');
  assert.equal(g.decision?.max, 1);
  assert.deepEqual(names(g, g.decision!.values!).filter((n, i, a) => a.indexOf(n) === i).sort(), ['Lucario ex', 'Mega Lucario ex'], 'only cards that evolve from a Pokémon in play');
  submitCards(g, g.decision!.values!.find((c) => nameOf(g, c) === 'Mega Lucario ex')!);
  assert.equal(nameOf(g, riolu.cards[riolu.cards.length - 1]!), 'Mega Lucario ex', 'one Pokémon, so no question which');
  assert.equal(riolu.cards.length, 2);
  assert.equal(riolu.evolvedTurn, g.state.turn);
  assert.equal(g.state.p[0].deck.length, deckBefore - 1);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Salvatore']);
});

test('Salvatore: works on a Pokémon put into play this turn, but not on one that already evolved this turn', () => {
  const dk = deck('Salvatore', 'Riolu', 'Mega Lucario ex', DRA);
  const fresh = S(dk, [{ active: DRA, bench: ['Riolu'], hand: ['Salvatore'] }, { active: DRA }]);
  fresh.state.p[0].bench[0]!.enteredTurn = fresh.state.turn; // put into play this turn
  choose(fresh, 'Play Salvatore');
  submitCards(fresh, fresh.decision!.values![0]!);
  assert.equal(nameOf(fresh, topOf(fresh.state.p[0].bench[0]!)), 'Mega Lucario ex');
  const spent = S(dk, [{ active: DRA, bench: ['Riolu'], hand: ['Salvatore'] }, { active: DRA }]);
  spent.state.p[0].bench[0]!.evolvedTurn = spent.state.turn;
  const deckBefore = spent.state.p[0].deck.length;
  choose(spent, 'Play Salvatore'); // playable (a search), but there is nothing to find: no question
  assert.notEqual(spent.decision?.kind, 'cards');
  assert.equal(spent.state.p[0].bench[0]!.cards.length, 1);
  assert.equal(spent.state.p[0].deck.length, deckBefore);
});

test('Salvatore: a card with an Ability is not found (Galvantula); choosing none leaves the Pokémon as it was', () => {
  const dk = deck('Salvatore', 'Joltik', 'Galvantula', 'Riolu', 'Mega Lucario ex', DRA);
  const g = S(dk, [{ active: DRA, bench: ['Joltik'], hand: ['Salvatore'] }, { active: DRA }]);
  choose(g, 'Play Salvatore'); // nothing eligible: Galvantula has an Ability, and no Riolu is in play
  assert.notEqual(g.decision?.kind, 'cards');
  assert.equal(g.state.p[0].bench[0]!.cards.length, 1);
  const none = S(dk, [{ active: DRA, bench: ['Riolu'], hand: ['Salvatore'] }, { active: DRA }]);
  choose(none, 'Play Salvatore');
  none.submit([]);
  assert.equal(none.state.p[0].bench[0]!.cards.length, 1);
  assert.deepEqual(names(none, none.state.p[0].discard), ['Salvatore']);
});

test('Salvatore: with 2 Pokémon it could evolve, the controller says which one', () => {
  const dk = deck('Salvatore', 'Riolu', 'Mega Lucario ex', DRA);
  const g = S(dk, [{ active: 'Riolu', bench: ['Riolu'], hand: ['Salvatore'] }, { active: DRA }]);
  const [a, b] = [g.state.p[0].active!, g.state.p[0].bench[0]!];
  choose(g, 'Play Salvatore');
  submitCards(g, g.decision!.values![0]!);
  assert.equal(g.decision?.kind, 'slots');
  assert.deepEqual(g.decision!.values!.slice().sort(), [a.id, b.id].sort());
  g.submit([g.decision!.values!.indexOf(b.id)]);
  assert.equal(a.cards.length, 1);
  assert.equal(b.cards.length, 2);
});
