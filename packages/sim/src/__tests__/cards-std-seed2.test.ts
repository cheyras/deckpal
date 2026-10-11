/**
 * Card tests, batch "std-seed2": every card scripted in cards/scripts/std-seed2.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { BURNED, CONFUSED, PARALYZED, POISONED } from '../types.js';
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
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function stack(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return sl.cards.map((c) => name(g, c));
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]) {
  return fromIds('seed2', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak to Grass, Stage 2
const REG = 'me02.5-145'; // Registeel ex: 230 HP, Metal
const CRE = 'me02-039'; // Cresselia: 120 HP, Psychic, resists Fighting
const SLO = 'me05-029'; // Slowpoke
const REL = 'sv08-013'; // Rellor
const BOSS = 'me01-114'; // Boss's Orders (Supporter)
const BALL = 'me01-131'; // Ultra Ball (Item)
const BALLOON = 'me01-166'; // Air Balloon (Tool)
type Sides = [SideLayout, SideLayout];

const F = 'Fire Energy';
const P = 'Psychic Energy';
const W = 'Water Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const FI = 'Fighting Energy';
const L = 'Lightning Energy';

// ------------------------------------------------------------------ Misdreavus

test('Misdreavus, Ascension: puts a card that evolves from it onto it from the deck, clears its conditions, then shuffles', () => {
  const dk = deck('me02.5-085', 'me02.5-086', 'me02-036', TYR, SLO);
  const g = scenario(dk, dk, [{ active: 'Misdreavus', energy: { active: [P] }, cond: CONFUSED }, { active: 'Slowpoke' }]);
  const before = g.state.p[0].deck.slice();
  choose(g, 'Attack: Ascension');
  // Both Mismagius cards evolve from Misdreavus; nothing else (Tyranitar ex evolves from Pupitar) is offered.
  assert.deepEqual([...new Set(labels(g))].sort(), ['Mismagius', 'Mismagius ex']);
  pick(g, ['Mismagius ex']);
  assert.deepEqual(stack(g, 0, 'active'), ['Misdreavus', 'Mismagius ex']);
  assert.equal(g.state.p[0].active!.cond & CONFUSED, 0, 'evolving clears Special Conditions');
  assert.equal(g.state.p[0].deck.length, before.length - 1);
  assert.notDeepEqual(g.state.p[0].deck, before.filter((c) => c !== g.state.p[0].active!.cards[1]), 'the deck was not shuffled');
});

test('Misdreavus, Ascension: with no card that evolves from it in the deck nothing happens; none is a legal pick', () => {
  const dk = deck('me02.5-085', SLO);
  const g = scenario(dk, dk, [{ active: 'Misdreavus', energy: { active: [P] } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Ascension');
  assert.deepEqual(stack(g, 0, 'active'), ['Misdreavus']);
  const dk2 = deck('me02.5-085', 'me02.5-086', SLO);
  const h = scenario(dk2, dk2, [{ active: 'Misdreavus', energy: { active: [P] } }, { active: 'Slowpoke' }]);
  choose(h, 'Attack: Ascension');
  h.submit([]);
  assert.deepEqual(stack(h, 0, 'active'), ['Misdreavus'], 'declined, yet it evolved');
});

test("Misdreavus, Ascension: a player can't evolve on their own first turn (the second player's first attack included)", () => {
  const dk = deck('me02.5-085', 'me02.5-086', SLO);
  const g = scenario(dk, dk, [{ active: 'Slowpoke' }, { active: 'Misdreavus', energy: { active: [P] } }], { turn: 2, current: 1, first: 0 });
  choose(g, 'Attack: Ascension');
  assert.deepEqual(stack(g, 1, 'active'), ['Misdreavus']);
});

// ------------------------------------------------------------------ Spritzee

test('Spritzee, Sweet Scent: heals 30 from 1 of your Pokémon of your choice (to a floor of 0)', () => {
  const dk = deck('me03-035', SLO);
  const g = scenario(dk, dk, [{ active: 'Spritzee', bench: ['Slowpoke'], energy: { active: [P] }, damage: { active: 20, 0: 50 } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Sweet Scent');
  choose(g, 'Slowpoke');
  assert.equal(g.state.p[0].bench[0]!.damage, 20);
  assert.equal(g.state.p[0].active!.damage, 20, 'only the chosen Pokémon is healed');
  const h = scenario(dk, dk, [{ active: 'Spritzee', bench: ['Slowpoke'], energy: { active: [P] }, damage: { active: 20, 0: 50 } }, { active: 'Slowpoke' }]);
  choose(h, 'Attack: Sweet Scent');
  choose(h, 'Spritzee');
  assert.equal(h.state.p[0].active!.damage, 0);
  assert.equal(h.state.p[0].bench[0]!.damage, 50);
});

// ------------------------------------------------------------------ Koraidon

test('Koraidon, Battle Claw: 30, or 60 against an Evolution Pokémon -- a card that is an Evolution even if it never evolved in play (TPCi 2026-07-16, #2394)', () => {
  const dk = deck('me05-047', TYR, REG);
  const basic = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [FI] } }, { active: 'Registeel ex' }]);
  choose(basic, 'Attack: Battle Claw');
  assert.equal(basic.state.p[1].active!.damage, 30);
  // Tyranitar ex is put into play as the Active straight from the "starting hand": no Basic under it, still an Evolution Pokémon card.
  const evo = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [FI] } }, { active: 'Tyranitar ex' }]);
  assert.equal(evo.state.p[1].active!.cards.length, 1);
  choose(evo, 'Attack: Battle Claw');
  assert.equal(evo.state.p[1].active!.damage, 60);
});

test('Koraidon, Gaia Impact: 190, then every Energy on it is discarded', () => {
  const dk = deck('me05-047', REG);
  const g = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [FI, FI, F] } }, { active: 'Registeel ex' }]);
  choose(g, 'Attack: Gaia Impact');
  assert.equal(g.state.p[1].active!.damage, 190);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.deepEqual(names(g, g.state.p[0].discard), [FI, FI, F]);
});

// ------------------------------------------------------------------ Inkay

test('Inkay, Procurement: finds an Item (only an Item), reveals it, puts it into your hand', () => {
  const dk = deck('me05-051', BALL, BOSS, BALLOON, SLO);
  const g = scenario(dk, dk, [{ active: 'Inkay', energy: { active: [D] } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Procurement');
  assert.deepEqual([...new Set(labels(g))], ['Ultra Ball'], 'only Item cards may be taken');
  choose(g, 'Ultra Ball');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Ultra Ball']);
  assert.ok(g.state.p[0].revealed.includes(g.state.p[0].hand[0]!), 'the card was not revealed');
});

// ------------------------------------------------------------------ Iron Hands

test('Iron Hands, Volt Wave: 30, and heads Paralyzes the Defending Pokémon (tails does not)', () => {
  const dk = deck('sv05-061', SLO);
  const run = (heads: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Iron Hands', energy: { active: [L, F] } }, { active: 'Slowpoke' }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Volt Wave');
    return g;
  };
  const h = run(true);
  assert.equal(h.state.p[1].active!.damage, 30);
  assert.ok(h.state.p[1].active!.cond & PARALYZED);
  const t = run(false);
  assert.equal(t.state.p[1].active!.damage, 30);
  assert.equal(t.state.p[1].active!.cond & PARALYZED, 0);
});

test('Iron Hands, Superalloy Hands: 80, or 160 against a Pokémon ex', () => {
  const dk = deck('sv05-061', TYR, CRE);
  const ex = scenario(dk, dk, [{ active: 'Iron Hands', energy: { active: [L, L, F] } }, { active: 'Tyranitar ex' }]);
  choose(ex, 'Attack: Superalloy Hands');
  assert.equal(ex.state.p[1].active!.damage, 160);
  const plain = scenario(dk, dk, [{ active: 'Iron Hands', energy: { active: [L, L, F] } }, { active: 'Cresselia' }]);
  choose(plain, 'Attack: Superalloy Hands');
  assert.equal(plain.state.p[1].active!.damage, 80);
});

// ------------------------------------------------------------------ Hearthflame Mask Ogerpon

test('Hearthflame Mask Ogerpon, Fire Kagura: finds a Basic {R} Energy (not other Energy) and attaches it to a Pokémon of your choice', () => {
  const dk = deck('sv10-044', SLO);
  const g = scenario(dk, dk, [{ active: 'Hearthflame Mask Ogerpon', bench: ['Slowpoke'], energy: { active: [F] } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Fire Kagura');
  assert.deepEqual([...new Set(labels(g))], ['Fire Energy']);
  choose(g, 'Fire Energy');
  choose(g, 'Slowpoke');
  assert.deepEqual(energyNames(g, 0, 0), [F]);
  assert.deepEqual(energyNames(g, 0, 'active'), [F], 'the Active kept only its own Energy');
});

test('Hearthflame Mask Ogerpon, Searing Flame: 80 and the Defending Pokémon is Burned', () => {
  const dk = deck('sv10-044', REG, TYR);
  const g = scenario(dk, dk, [{ active: 'Hearthflame Mask Ogerpon', energy: { active: [F, F, F] } }, { active: 'Tyranitar ex' }]);
  g.state.forcedCoins = [false]; // the Burn check at Pokémon Checkup: tails, it stays Burned
  choose(g, 'Attack: Searing Flame');
  assert.equal(g.state.p[1].active!.damage, 80 + 20, '80, plus the 2 damage counters of Burn at Pokémon Checkup');
  assert.ok(g.state.p[1].active!.cond & BURNED);
});

// ------------------------------------------------------------------ Lopunny

test("Lopunny, Dashing Kick: 50 to 1 of your opponent's Benched Pokémon of your choice, nothing to the Active", () => {
  const dk = deck('me01-108', TYR, REG);
  const g = scenario(dk, dk, [{ active: 'Lopunny', energy: { active: [F] } }, { active: 'Tyranitar ex', bench: ['Registeel ex', 'Tyranitar ex'] }]);
  choose(g, 'Attack: Dashing Kick');
  assert.ok(!has(g, 'Active'), 'the Active Pokémon is not a Benched Pokémon');
  choose(g, 'Registeel ex');
  assert.equal(g.state.p[1].bench[0]!.damage, 50);
  assert.equal(g.state.p[1].bench[1]!.damage, 0);
  assert.equal(g.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Cresselia

test('Cresselia, Swelling Light: up to 2 Basic {P} Energy from the deck onto this Pokémon (0, 1 or 2)', () => {
  const dk = deck('me02-039', SLO);
  const g = scenario(dk, dk, [{ active: 'Cresselia', energy: { active: [P] }, prizes: 6 }, { active: 'Slowpoke' }]);
  const deckEnergy = g.state.p[0].deck.length;
  choose(g, 'Attack: Swelling Light');
  assert.ok(labels(g).every((l) => l === 'Psychic Energy'), `only Basic {P} Energy may be taken: ${labels(g).join(' | ')}`);
  pick(g, ['Psychic Energy', 'Psychic Energy']);
  assert.deepEqual(energyNames(g, 0, 'active'), [P, P, P]);
  assert.equal(g.state.p[0].deck.length, deckEnergy - 2);
  const none = scenario(dk, dk, [{ active: 'Cresselia', energy: { active: [P] } }, { active: 'Slowpoke' }]);
  choose(none, 'Attack: Swelling Light');
  none.submit([]);
  assert.deepEqual(energyNames(none, 0, 'active'), [P], 'an attack\'s "up to" includes 0');
});

// ------------------------------------------------------------------ Alcremie

test('Alcremie, Sweet Circle: 20 for each of your Pokémon in play (the Active counts)', () => {
  const dk = deck('me02-044', TYR, SLO, REL);
  const three = scenario(dk, dk, [{ active: 'Alcremie', bench: ['Slowpoke', 'Rellor'], energy: { active: [P] } }, { active: 'Tyranitar ex' }]);
  choose(three, 'Attack: Sweet Circle');
  assert.equal(three.state.p[1].active!.damage, 60);
  const four = scenario(dk, dk, [{ active: 'Alcremie', bench: ['Slowpoke', 'Rellor', 'Slowpoke'], energy: { active: [P] } }, { active: 'Tyranitar ex' }]);
  choose(four, 'Attack: Sweet Circle');
  assert.equal(four.state.p[1].active!.damage, 80);
});

// ------------------------------------------------------------------ Gliscor

test("Gliscor, Poison Ring: 50, Poisoned, and the Defending Pokémon can't retreat during their next turn", () => {
  const dk = deck('me02-050', TYR, SLO);
  const layout = (): Sides => [
    { active: 'Gliscor', energy: { active: [FI] } },
    { active: 'Tyranitar ex', bench: ['Slowpoke'], energy: { active: [F, F, F] } },
  ];
  const control = scenario(dk, dk, layout(), { current: 1 });
  assert.ok(has(control, 'Retreat'), 'control: Tyranitar ex should be able to retreat');
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Poison Ring');
  assert.ok(g.state.p[1].active!.damage >= 50);
  assert.ok(g.state.p[1].active!.cond & POISONED);
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Retreat'), 'retreat was offered under Poison Ring');
});

// ------------------------------------------------------------------ Registeel ex

test('Registeel ex, Regi Charge: attaches up to 2 Basic {M} Energy from the discard pile to this Pokémon, no other Energy', () => {
  const dk = deck(REG, SLO);
  const g = scenario(dk, dk, [{ active: 'Registeel ex', energy: { active: [M] }, discard: [M, M, M, F] }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Regi Charge');
  assert.ok(labels(g).every((l) => l === 'Metal Energy'), `only Basic {M} Energy: ${labels(g).join(' | ')}`);
  pick(g, ['Metal Energy', 'Metal Energy']);
  assert.deepEqual(energyNames(g, 0, 'active'), [M, M, M]);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, M]);
});

test("Registeel ex, Protecting Steel: 140, then 50 less damage from attacks during the opponent's next turn", () => {
  const dk = deck(REG, TYR);
  const g = scenario(dk, dk, [{ active: 'Registeel ex', energy: { active: [M, M, M, M] } }, { active: 'Tyranitar ex', energy: { active: [D, D, D] } }]);
  choose(g, 'Attack: Protecting Steel');
  assert.equal(g.state.p[1].active!.damage, 140);
  assert.equal(g.decision?.player, 1);
  choose(g, 'Attack: Grind');
  assert.equal(g.state.p[0].active!.damage, 100, 'Grind does 150, less 50');
});

// ------------------------------------------------------------------ N's Vanillish

test("N's Vanillish, Sheer Cold: 60, and the Defending Pokémon can't use attacks during the opponent's next turn", () => {
  const dk = deck('me02.5-050', CRE);
  const layout = (): Sides => [{ active: "N's Vanillish", energy: { active: [W, W, W] } }, { active: 'Cresselia', energy: { active: [P, P, P] } }];
  const control = scenario(dk, dk, layout(), { current: 1 });
  assert.ok(has(control, 'Attack: Aurora Beam'), 'control: Cresselia should be able to attack');
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Sheer Cold');
  assert.equal(g.state.p[1].active!.damage, 60);
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Attack:'), 'an attack was offered under Sheer Cold');
});

// ------------------------------------------------------------------ Team Rocket's Murkrow

test("Team Rocket's Murkrow, Deceit: finds a Supporter (only a Supporter), reveals it, puts it into your hand", () => {
  const dk = deck('me02.5-126', BALL, BOSS, BALLOON, SLO);
  const g = scenario(dk, dk, [{ active: "Team Rocket's Murkrow", energy: { active: [F] } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Deceit');
  assert.deepEqual([...new Set(labels(g))], ["Boss's Orders"]);
  choose(g, "Boss's Orders");
  assert.deepEqual(names(g, g.state.p[0].hand), ["Boss's Orders"]);
  assert.ok(g.state.p[0].revealed.includes(g.state.p[0].hand[0]!));
});

test("Team Rocket's Murkrow, Torment: 30, then you choose 1 of the Defending Pokémon's attacks and it can't use that one next turn", () => {
  const dk = deck('me02.5-126', REG, 'me02-044');
  const layout = (): Sides => [
    { active: "Team Rocket's Murkrow", energy: { active: [D, F] } },
    { active: 'Registeel ex', energy: { active: [M, M, M, M] } },
  ];
  const g = scenario(dk, dk, layout());
  choose(g, 'Attack: Torment');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.deepEqual(labels(g).sort(), ['Protecting Steel', 'Regi Charge']);
  choose(g, 'Protecting Steel');
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Attack: Protecting Steel'), 'the chosen attack was offered');
  assert.ok(has(g, 'Attack: Regi Charge'), 'the other attack was locked too');
  // A Defending Pokémon with a single attack is locked without a question.
  const one = scenario(dk, dk, [layout()[0], { active: 'Alcremie', energy: { active: [P] } }]);
  choose(one, 'Attack: Torment');
  assert.equal(one.decision?.player, 1);
  assert.ok(!has(one, 'Attack: Sweet Circle'));
});

// ------------------------------------------------------------------ Galarian Obstagoon

test('Galarian Obstagoon, Scarring Shout: 70 for each damage counter on the Defending Pokémon', () => {
  const dk = deck('me02.5-132', TYR);
  const g = scenario(dk, dk, [{ active: 'Galarian Obstagoon', energy: { active: [D, F] } }, { active: 'Tyranitar ex', damage: { active: 30 } }]);
  choose(g, 'Attack: Scarring Shout');
  assert.equal(g.state.p[1].active!.damage, 30 + 3 * 70);
  const none = scenario(dk, dk, [{ active: 'Galarian Obstagoon', energy: { active: [D, F] } }, { active: 'Tyranitar ex' }]);
  choose(none, 'Attack: Scarring Shout');
  assert.equal(none.state.p[1].active!.damage, 0);
});

test('Galarian Obstagoon, Punk Smash: 160, then you discard an Energy of your choice from it', () => {
  const dk = deck('me02.5-132', TYR);
  const g = scenario(dk, dk, [{ active: 'Galarian Obstagoon', energy: { active: [D, D, D, F] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Punk Smash');
  assert.equal(g.state.p[1].active!.damage, 160);
  choose(g, 'Fire Energy');
  assert.deepEqual(energyNames(g, 0, 'active'), [D, D, D]);
  assert.deepEqual(names(g, g.state.p[0].discard), [F]);
});

// ------------------------------------------------------------------ Noivern

test("Noivern, Agility: 40; heads prevents all damage from attacks done to it during the opponent's next turn, tails does not", () => {
  const dk = deck('me02.5-157', REG, CRE);
  const run = (heads: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Noivern', energy: { active: [F, F] } }, { active: 'Cresselia', energy: { active: [P, P, P] } }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Agility');
    assert.equal(g.state.p[1].active!.damage, 40);
    choose(g, 'Attack: Aurora Beam');
    return g;
  };
  assert.equal(run(true).state.p[0].active!.damage, 0);
  assert.equal(run(false).state.p[0].active!.damage, 90);
});

test('Noivern, Enhanced Blade: 70, or 140 if this Pokémon has a Pokémon Tool attached', () => {
  const dk = deck('me02.5-157', REG, BALLOON);
  const plain = scenario(dk, dk, [{ active: 'Noivern', energy: { active: [P, D] } }, { active: 'Registeel ex' }]);
  choose(plain, 'Attack: Enhanced Blade');
  assert.equal(plain.state.p[1].active!.damage, 70);
  const tooled = scenario(dk, dk, [{ active: 'Noivern', energy: { active: [P, D] }, tools: { active: ['Air Balloon'] } }, { active: 'Registeel ex' }]);
  choose(tooled, 'Attack: Enhanced Blade');
  assert.equal(tooled.state.p[1].active!.damage, 140);
  // A Tool on the OPPONENT's Pokémon, or on another of yours, doesn't count.
  const other = scenario(dk, dk, [{ active: 'Noivern', energy: { active: [P, D] } }, { active: 'Registeel ex', tools: { active: ['Air Balloon'] } }]);
  choose(other, 'Attack: Enhanced Blade');
  assert.equal(other.state.p[1].active!.damage, 70);
});

// ------------------------------------------------------------------ Team Rocket's Meowth

test("Team Rocket's Meowth, Paw-cket Pilfer: a random card from the opponent's hand is shuffled into their deck (every card can be the one)", () => {
  const dk = deck('me02.5-161', SLO, REL, BOSS);
  const taken = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const g = scenario(dk, dk, [{ active: "Team Rocket's Meowth", energy: { active: [F] } }, { active: 'Slowpoke', hand: ['Slowpoke', 'Rellor', "Boss's Orders"] }], {}, seed);
    const deckBefore = g.state.p[1].deck.length;
    choose(g, 'Attack: Paw-cket Pilfer');
    const hand = names(g, g.state.p[1].hand);
    assert.equal(hand.length, 2 + 1, 'one card left the hand (plus the opponent\'s draw for turn)');
    assert.equal(g.state.p[1].deck.length, deckBefore + 1 - 1, 'the card went into the deck (and a card was drawn)');
    const all = ['Slowpoke', 'Rellor', "Boss's Orders"];
    for (const n of all) if (!hand.includes(n)) taken.add(n);
  }
  assert.deepEqual([...taken].sort(), ['Boss\'s Orders', 'Rellor', 'Slowpoke'], 'the pick is not random');
  // An empty hand is no problem.
  const e = scenario(dk, dk, [{ active: "Team Rocket's Meowth", energy: { active: [F] } }, { active: 'Slowpoke' }]);
  choose(e, 'Attack: Paw-cket Pilfer');
  assert.equal(e.decision?.player, 1);
});

test("Team Rocket's Meowth, Fury Swipes: 20 for each heads of 3 coins", () => {
  const dk = deck('me02.5-161', REG);
  for (const [coins, dmg] of [[[true, false, true], 40], [[false, false, false], 0], [[true, true, true], 60]] as [boolean[], number][]) {
    const g = scenario(dk, dk, [{ active: "Team Rocket's Meowth", energy: { active: [F, F] } }, { active: 'Registeel ex' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Fury Swipes');
    assert.equal(g.state.p[1].active!.damage, dmg);
  }
});

// ------------------------------------------------------------------ Delcatty

test("Delcatty, Energy Crush: 40 for each Energy attached to all of the opponent's Pokémon (not its own)", () => {
  const dk = deck('me02.5-166', TYR, REG, CRE);
  const g = scenario(dk, dk, [
    { active: 'Delcatty', energy: { active: [F, F, F] } },
    { active: 'Tyranitar ex', bench: ['Registeel ex', 'Cresselia'], energy: { active: [D, D], 0: [M], 1: [P, P] } },
  ]);
  choose(g, 'Attack: Energy Crush');
  assert.equal(g.state.p[1].active!.damage, 5 * 40);
  const none = scenario(dk, dk, [{ active: 'Delcatty', energy: { active: [F, F] } }, { active: 'Tyranitar ex' }]);
  choose(none, 'Attack: Energy Crush');
  assert.equal(none.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Clefairy

test("Clefairy, Follow Me: you choose which of the opponent's Benched Pokémon is switched into the Active Spot", () => {
  const dk = deck('me03-030', REG, CRE, TYR);
  const g = scenario(dk, dk, [{ active: 'Clefairy', energy: { active: [P] } }, { active: 'Tyranitar ex', bench: ['Registeel ex', 'Cresselia'] }]);
  choose(g, 'Attack: Follow Me');
  choose(g, 'Cresselia');
  assert.equal(name(g, topCard(g.state.p[1].active!)), 'Cresselia');
  assert.deepEqual(names(g, g.state.p[1].bench.map((b) => topCard(b))), ['Registeel ex', 'Tyranitar ex']);
});

// ------------------------------------------------------------------ Landorus

test("Landorus, Rock Tumble: 50, not reduced by Resistance (the Defending Pokémon resists {F})", () => {
  const dk = deck('me03-041', CRE);
  const g = scenario(dk, dk, [{ active: 'Landorus', energy: { active: [FI, FI] } }, { active: 'Cresselia' }]);
  choose(g, 'Attack: Rock Tumble');
  assert.equal(g.state.p[1].active!.damage, 50, 'Resistance -30 was applied');
});

test('Landorus, Screw Knuckle: 120, then an Energy of your choice attached to it goes into your hand (not the discard pile)', () => {
  const dk = deck('me03-041', TYR);
  const g = scenario(dk, dk, [{ active: 'Landorus', energy: { active: [FI, FI, W] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Screw Knuckle');
  assert.equal(g.state.p[1].active!.damage, 120);
  choose(g, 'Water Energy');
  assert.deepEqual(energyNames(g, 0, 'active'), [FI, FI]);
  assert.deepEqual(names(g, g.state.p[0].hand), [W]);
  assert.equal(g.state.p[0].discard.length, 0);
});

// ------------------------------------------------------------------ Ninetales

test('Ninetales, Eerie Glow: 90, and the Defending Pokémon is Burned and Confused', () => {
  const dk = deck('sv06-027', TYR);
  const g = scenario(dk, dk, [{ active: 'Ninetales', energy: { active: [F, F] } }, { active: 'Tyranitar ex' }]);
  g.state.forcedCoins = [false]; // the Burn check at Pokémon Checkup: tails, it stays Burned
  choose(g, 'Attack: Eerie Glow');
  assert.equal(g.state.p[1].active!.damage, 90 + 20, '90, plus the 2 damage counters of Burn at Pokémon Checkup');
  assert.ok(g.state.p[1].active!.cond & BURNED);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Girafarig (sv06-083)

test('Girafarig (Dual Headbutt): 30, and also 10 to 1 of your Benched Pokémon with no Weakness applied', () => {
  const dk = deck('sv06-083', 'me05-047', REG, SLO);
  const g = scenario(dk, dk, [{ active: 'Girafarig', bench: ['Slowpoke', 'Koraidon'], energy: { active: [P] } }, { active: 'Registeel ex' }]);
  choose(g, 'Attack: Dual Headbutt');
  choose(g, 'Koraidon'); // Koraidon is weak to {P}: still only 10
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[0].bench[1]!.damage, 10);
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  assert.equal(g.state.p[0].active!.damage, 0);
  // With no Bench there is no one to hurt, and the attack still does its 30.
  const solo = scenario(dk, dk, [{ active: 'Girafarig', energy: { active: [P] } }, { active: 'Registeel ex' }]);
  choose(solo, 'Attack: Dual Headbutt');
  assert.equal(solo.state.p[1].active!.damage, 30);
});

// ------------------------------------------------------------------ Bronzor

test('Bronzor, Mirror Attack: 10, or 40 against a {M} Pokémon', () => {
  const dk = deck('me05-063', REG, TYR);
  const metal = scenario(dk, dk, [{ active: 'Bronzor', energy: { active: [M] } }, { active: 'Registeel ex' }]);
  choose(metal, 'Attack: Mirror Attack');
  assert.equal(metal.state.p[1].active!.damage, 40);
  const other = scenario(dk, dk, [{ active: 'Bronzor', energy: { active: [M] } }, { active: 'Tyranitar ex' }]);
  choose(other, 'Attack: Mirror Attack');
  assert.equal(other.state.p[1].active!.damage, 10);
});

// ------------------------------------------------------------------ Girafarig (sv05-066)

test('Girafarig (Psychic Assault): 20, and 10 more for each damage counter on the Defending Pokémon', () => {
  const dk = deck('sv05-066', TYR);
  const hurt = scenario(dk, dk, [{ active: 'Girafarig', energy: { active: [P, F] } }, { active: 'Tyranitar ex', damage: { active: 40 } }]);
  choose(hurt, 'Attack: Psychic Assault');
  assert.equal(hurt.state.p[1].active!.damage, 40 + 20 + 4 * 10);
  const fresh = scenario(dk, dk, [{ active: 'Girafarig', energy: { active: [P, F] } }, { active: 'Tyranitar ex' }]);
  choose(fresh, 'Attack: Psychic Assault');
  assert.equal(fresh.state.p[1].active!.damage, 20);
});

// ------------------------------------------------------------------ Wash Rotom

test('Wash Rotom, Manual Wash: 20, then heal 10 from each of your Pokémon (the Active and the Bench, never below 0)', () => {
  const dk = deck('sv10-061', TYR, SLO, REL);
  const g = scenario(dk, dk, [
    { active: 'Wash Rotom', bench: ['Slowpoke', 'Rellor', 'Slowpoke'], energy: { active: [W] }, damage: { active: 30, 0: 5 + 5, 1: 0, 2: 40 } },
    { active: 'Tyranitar ex', damage: { active: 50 } },
  ]);
  choose(g, 'Attack: Manual Wash');
  assert.equal(g.state.p[1].active!.damage, 70, "the opponent's Pokémon aren't healed");
  assert.deepEqual([g.state.p[0].active!.damage, ...g.state.p[0].bench.map((b) => b.damage)], [20, 0, 0, 30]);
});

test('Wash Rotom, Gadget Show: 30 for each Pokémon Tool attached to all of your Pokémon (the opponent\'s Tools do not count)', () => {
  const dk = deck('sv10-061', TYR, SLO, BALLOON);
  const g = scenario(dk, dk, [
    { active: 'Wash Rotom', bench: ['Slowpoke', 'Slowpoke'], energy: { active: [F, F] }, tools: { active: ['Air Balloon'], 1: ['Air Balloon'] } },
    { active: 'Tyranitar ex', tools: { active: ['Air Balloon'] } },
  ]);
  choose(g, 'Attack: Gadget Show');
  assert.equal(g.state.p[1].active!.damage, 60);
  const none = scenario(dk, dk, [{ active: 'Wash Rotom', energy: { active: [F, F] } }, { active: 'Tyranitar ex', tools: { active: ['Air Balloon'] } }]);
  choose(none, 'Attack: Gadget Show');
  assert.equal(none.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Tyranitar ex

test('Tyranitar ex, Grind: 50 for each Energy attached to this Pokémon', () => {
  const dk = deck(TYR, REG);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', energy: { active: [D, D, F] } }, { active: 'Registeel ex' }]);
  choose(g, 'Attack: Grind');
  assert.equal(g.state.p[1].active!.damage, 150);
});

test("Tyranitar ex, Tyrannical Crush: 150, then a random card from the opponent's hand is discarded", () => {
  const dk = deck(TYR, REG, SLO, REL, BOSS);
  const gone = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const g = scenario(dk, dk, [{ active: 'Tyranitar ex', energy: { active: [D, F, F] } }, { active: 'Registeel ex', hand: ['Slowpoke', 'Rellor', "Boss's Orders"] }], {}, seed);
    choose(g, 'Attack: Tyrannical Crush');
    assert.equal(g.state.p[1].active!.damage, 150);
    assert.equal(g.state.p[1].discard.length, 1);
    gone.add(name(g, g.state.p[1].discard[0]!));
  }
  assert.deepEqual([...gone].sort(), ["Boss's Orders", 'Rellor', 'Slowpoke'], 'the discarded card is not random');
  const empty = scenario(dk, dk, [{ active: 'Tyranitar ex', energy: { active: [D, F, F] } }, { active: 'Registeel ex' }]);
  choose(empty, 'Attack: Tyrannical Crush');
  assert.equal(empty.state.p[1].discard.length, 0);
});

// ------------------------------------------------------------------ Vivillon

test("Vivillon, Evo-Powder: for each Benched Pokémon, a card that evolves from THAT Pokémon, even one put into play this turn (TPCi 2024-11-07, #2054)", () => {
  const dk = deck('sv08-007', 'sv08-005', 'sv08-006', 'sv09-080', 'sv09-081', TYR, SLO);
  const g = scenario(dk, dk, [{ active: 'Vivillon', bench: ['Scatterbug', 'Larvitar', 'Slowpoke'], energy: { active: [F] } }, { active: 'Slowpoke' }]);
  g.state.p[0].bench[0]!.enteredTurn = g.state.turn; // Scatterbug came into play this turn
  choose(g, 'Attack: Evo-Powder');
  assert.deepEqual([...new Set(labels(g))], ['Spewpa'], 'only a card that evolves from Scatterbug');
  choose(g, 'Spewpa');
  assert.deepEqual([...new Set(labels(g))], ['Pupitar'], 'Tyranitar ex evolves from Pupitar, not Larvitar');
  choose(g, 'Pupitar');
  // Slowpoke has no evolution in the deck: no question.
  assert.deepEqual(stack(g, 0, 0), ['Scatterbug', 'Spewpa']);
  assert.deepEqual(stack(g, 0, 1), ['Larvitar', 'Pupitar']);
  assert.deepEqual(stack(g, 0, 2), ['Slowpoke']);
  assert.deepEqual(stack(g, 0, 'active'), ['Vivillon']);
});

test('Vivillon, Evo-Powder: each Benched Pokémon may be skipped', () => {
  const dk = deck('sv08-007', 'sv08-005', 'sv08-006', 'sv09-080', 'sv09-081', SLO);
  const g = scenario(dk, dk, [{ active: 'Vivillon', bench: ['Scatterbug', 'Larvitar'], energy: { active: [F] } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Evo-Powder');
  g.submit([]);
  choose(g, 'Pupitar');
  assert.deepEqual(stack(g, 0, 0), ['Scatterbug']);
  assert.deepEqual(stack(g, 0, 1), ['Larvitar', 'Pupitar']);
});

// ------------------------------------------------------------------ Altaria

test('Altaria, Humming Charge: up to 2 Basic Energy cards from the deck onto your Pokémon in any way you like', () => {
  const dk = deck('sv08-134', SLO);
  const g = scenario(dk, dk, [{ active: 'Altaria', bench: ['Slowpoke'], energy: { active: [W] } }, { active: 'Slowpoke' }]);
  choose(g, 'Attack: Humming Charge');
  choose(g, 'Fire Energy');
  choose(g, 'Slowpoke');
  choose(g, 'Water Energy');
  choose(g, 'Altaria');
  assert.deepEqual(energyNames(g, 0, 0), [F]);
  assert.deepEqual(energyNames(g, 0, 'active'), [W, W]);
  // Both onto the same Pokémon; or none at all.
  const same = scenario(dk, dk, [{ active: 'Altaria', bench: ['Slowpoke'], energy: { active: [W] } }, { active: 'Slowpoke' }]);
  choose(same, 'Attack: Humming Charge');
  choose(same, 'Fire Energy');
  choose(same, 'Slowpoke');
  choose(same, 'Fire Energy');
  choose(same, 'Slowpoke');
  assert.deepEqual(energyNames(same, 0, 0), [F, F]);
  const none = scenario(dk, dk, [{ active: 'Altaria', bench: ['Slowpoke'], energy: { active: [W] } }, { active: 'Slowpoke' }]);
  choose(none, 'Attack: Humming Charge');
  none.submit([]);
  none.submit([]);
  assert.deepEqual(energyNames(none, 0, 'active'), [W]);
  assert.deepEqual(energyNames(none, 0, 0), []);
});

test("Altaria, Cotton Wings: 100; heads prevents all damage done to it by attacks during the opponent's next turn, tails does not", () => {
  const dk = deck('sv08-134', REG, CRE);
  const run = (heads: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Altaria', energy: { active: [W, M] } }, { active: 'Cresselia', energy: { active: [P, P, P] } }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Cotton Wings');
    assert.equal(g.state.p[1].active!.damage, 100);
    choose(g, 'Attack: Aurora Beam');
    return g;
  };
  assert.equal(run(true).state.p[0].active!.damage, 0);
  assert.equal(run(false).state.p[0].active!.damage, 90);
});
