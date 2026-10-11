/**
 * Card tests, batch "std-c21": every card scripted in cards/scripts/std-c21.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAMES } from '../cards/frames-all.js';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
import type { StaticEffect } from '../dsl.js';
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
function endTurn(g: Game): void {
  choose(g, 'End turn');
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}
function damageOf(g: Game, p: 0 | 1, where: 'active' | number = 'active'): number {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return sl.damage;
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]): DeckInput {
  return fromIds('c21', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass, no Resistance
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting
const TURTLE = 'sv07-025'; // Turtonator: 130 HP, Fire, weak Water
const HYDRA = 'sv07-014'; // Hydrapple ex: 330 HP, Stage 2, Grass, weak Fire
const ROTOM = 'sv07-008'; // Mow Rotom: 90 HP, Grass; Reaping Dash for {C}: 30
const LEDIAN = 'sv07-003';
const KOFU = 'sv07-138';

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const M = 'Metal Energy';

/** A timed static on one Pokémon (as an attack or Ability of the opponent would leave it). */
function inject(g: Game, slotId: number, st: StaticEffect): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack: false, src: 0 });
}

type Sides = [SideLayout, SideLayout];
function game(dk: DeckInput, sides: Sides): Game {
  return scenario(dk, dk, sides);
}

// ------------------------------------------------------------------ Xerosic's Machinations

test("Xerosic's Machinations: the opponent discards (their choice) until they have 3 cards in hand", () => {
  const dk = deck('sv06.5-064', URSA);
  const play = (oppHand: string[]): Game =>
    game(dk, [{ active: 'Bloodmoon Ursaluna ex', hand: ["Xerosic's Machinations"] }, { active: 'Bloodmoon Ursaluna ex', hand: oppHand }]);
  // "Your opponent discards cards from their hand until they have 3 cards in their hand."
  const g = play([F, F, W, W, P]);
  choose(g, "Play Xerosic's Machinations");
  assert.equal(g.decision?.player, 1, 'your opponent chooses what to discard');
  assert.equal(g.decision?.kind, 'cards');
  pick(g, [W, W]);
  assert.deepEqual(names(g, g.state.p[1].hand), [F, F, P], 'exactly 3 cards left, the ones they kept');
  assert.deepEqual(names(g, g.state.p[1].discard), [W, W]);

  const four = play([F, F, W, P]);
  choose(four, "Play Xerosic's Machinations");
  pick(four, [P]);
  assert.equal(four.state.p[1].hand.length, 3, 'with 4 cards in hand they discard exactly 1');

  // A Trainer that would do nothing can't be played (TPCi 2014-11-13): 3 or fewer cards in their hand.
  assert.ok(!has(play([F, F, W]), "Play Xerosic's Machinations"), 'a hand of exactly 3: nothing to discard');
  assert.ok(!has(play([]), "Play Xerosic's Machinations"), 'an empty hand');
});

// ------------------------------------------------------------------ Ledian

/** The catalog has no Ledyba frame, so tests that evolve into Ledian bring a Basic named Ledyba of their own. */
function ledDeck(): DeckInput {
  const base = deck(LEDIAN, URSA, TURTLE);
  const applin = FRAMES['sv06-017'];
  assert.ok(applin, 'a Basic frame to model Ledyba on');
  return { ...base, cards: [...base.cards, { frame: { ...applin, cardId: 'sv07-002', name: 'Ledyba', hp: 60, types: ['Grass'] }, count: 4 }] };
}

test('Ledian, Glittering Star Pattern: on evolving from hand, switch in a Benched Pokémon with 90 HP or less remaining', () => {
  const dk = ledDeck();
  const evolve = (oppBench: string[], damage: SideLayout['damage']): Game => {
    const g = game(dk, [
      { active: 'Ledyba', hand: ['Ledian'] },
      { active: 'Turtonator', bench: oppBench, damage },
    ]);
    choose(g, 'Evolve Ledyba (Active) into Ledian');
    return g;
  };
  // "... you may switch in 1 of your opponent's Benched Pokémon that has 90 HP or less remaining to the Active Spot."
  // Ledian (90 HP, undamaged) and Bloodmoon Ursaluna ex (260 HP with 170 damage: 90 remaining) qualify; Turtonator (130 HP) does not.
  const g = evolve(['Ledian', 'Bloodmoon Ursaluna ex', 'Turtonator'], { 1: 170 });
  yes(g);
  assert.equal(g.decision?.kind, 'slots');
  assert.equal(g.decision?.player, 0, 'you choose');
  assert.equal(g.decision?.values?.length, 2, 'only the two Pokémon with 90 or less remaining are offered');
  choose(g, 'Bloodmoon Ursaluna ex');
  assert.equal(name(g, g.state.p[1].active!.cards[0] as number), 'Bloodmoon Ursaluna ex', 'the chosen Pokémon is now Active');
  assert.ok(names(g, g.state.p[1].bench.map((b) => b.cards[0] as number)).includes('Turtonator'), 'the old Active Pokémon went to the Bench');
  assert.equal(g.state.p[1].bench.length, 3);

  // 91 remaining is too much; with nobody qualifying the Ability isn't offered at all.
  const none = evolve(['Bloodmoon Ursaluna ex', 'Turtonator'], { 0: 169 });
  assert.notEqual(none.decision?.kind, 'yesno', 'no qualifying Benched Pokémon: no question');
  assert.equal(name(none, none.state.p[1].active!.cards[0] as number), 'Turtonator');

  // "you may": declining leaves everything as it is.
  const declined = evolve(['Ledian'], undefined);
  no(declined);
  assert.equal(name(declined, declined.state.p[1].active!.cards[0] as number), 'Turtonator');

  // A single qualifying Pokémon needs no choice.
  const one = evolve(['Ledian', 'Turtonator'], undefined);
  yes(one);
  assert.equal(name(one, one.state.p[1].active!.cards[0] as number), 'Ledian');
});

test("Ledian, Swift: the damage isn't affected by Weakness, Resistance or effects on the Defending Pokémon", () => {
  const dk = deck(LEDIAN, TYR);
  const hit = (setup?: (g: Game) => void): number => {
    const g = game(dk, [{ active: 'Ledian', energy: { active: [F, F] } }, { active: 'Tyranitar ex' }]);
    setup?.(g);
    choose(g, 'Attack: Swift');
    return damageOf(g, 1);
  };
  const defender = (g: Game): number => g.state.p[1].active!.id;
  // "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon."
  assert.equal(hit(), 70, 'Tyranitar ex is weak to {G}: still 70, not 140');
  assert.equal(hit((g) => inject(g, defender(g), { k: 'damageIn', amount: -30 })), 70, 'a -30 effect on the Defending Pokémon is ignored');
  assert.equal(hit((g) => inject(g, defender(g), { k: 'preventDamage' })), 70, 'damage prevention on the Defending Pokémon is ignored');
});

// ------------------------------------------------------------------ Cradily

test("Cradily, Selective Slime: flip a coin; on heads choose Burned, Confused or Poisoned for the opponent's Active Pokémon", () => {
  const dk = deck('sv07-006', URSA);
  const use = (coin: boolean, option: string | null, cond = 0): Game => {
    const g = game(dk, [{ active: 'Cradily' }, { active: 'Bloodmoon Ursaluna ex', cond }]);
    g.state.forcedCoins = [coin];
    choose(g, 'Selective Slime');
    if (option) choose(g, option);
    return g;
  };
  // "Once during your turn, you may flip a coin. If heads, choose Burned, Confused, or Poisoned. Your opponent's Active Pokémon is now affected by that Special Condition."
  assert.equal(use(true, 'Confused').state.p[1].active!.cond, CONFUSED);
  assert.equal(use(true, 'Poisoned').state.p[1].active!.cond, POISONED);
  assert.equal(use(true, 'Burned').state.p[1].active!.cond, BURNED);
  const tails = use(false, null);
  assert.equal(tails.state.p[1].active!.cond, 0, 'tails: no Special Condition');
  assert.notEqual(tails.decision?.kind, 'option', 'tails: no choice is offered');
  // Once during your turn.
  const again = use(false, null);
  assert.ok(!has(again, 'Selective Slime'), 'used once already this turn');
});

test('Cradily, Selective Slime: not usable while the Defending Pokémon is already Burned, Confused and Poisoned (ruling 2014)', () => {
  const dk = deck('sv07-006', URSA);
  const usable = (cond: number): boolean => has(game(dk, [{ active: 'Cradily' }, { active: 'Bloodmoon Ursaluna ex', cond }]), 'Selective Slime');
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2014/): Cannot use if opponent's Active is already Burned, Confused, and Poisoned.
  assert.equal(usable(BURNED | CONFUSED | POISONED), false, 'all three already: no');
  assert.equal(usable(BURNED | POISONED), true, 'Confused is still missing');
  assert.equal(usable(CONFUSED | POISONED), true, 'Burned is still missing');
  assert.equal(usable(BURNED | CONFUSED), true, 'Poisoned is still missing');
  assert.equal(usable(0), true);
  assert.equal(usable(PARALYZED), true, 'Paralyzed is not one of the three');
});

test("Cradily, Miasma Wind: 100 damage for each Special Condition affecting the opponent's Active Pokémon", () => {
  const dk = deck('sv07-006', HYDRA, 'sv05-152');
  // Hydrapple ex wears Hero's Cape (+100 HP) so that 300 damage plus Checkup damage does not Knock it Out.
  // Pokémon Checkup follows the attack: Poisoned adds 1 damage counter and Burned adds 2, which `damageOf` includes.
  const hit = (cond: number): number => {
    const g = game(dk, [{ active: 'Cradily', energy: { active: [G] } }, { active: 'Hydrapple ex', cond, tools: { active: ["Hero's Cape"] } }]);
    choose(g, 'Attack: Miasma Wind');
    return damageOf(g, 1) - (cond & POISONED ? 10 : 0) - (cond & BURNED ? 20 : 0);
  };
  // "This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon."
  assert.equal(hit(0), 0, 'none');
  assert.equal(hit(POISONED), 100);
  assert.equal(hit(PARALYZED), 100);
  assert.equal(hit(CONFUSED), 100);
  assert.equal(hit(POISONED | BURNED), 200);
  assert.equal(hit(POISONED | BURNED | CONFUSED), 300);
});

// ------------------------------------------------------------------ Carnivine

test('Carnivine, Nosh: heal 40 damage from this Pokémon', () => {
  const dk = deck('sv07-007', URSA);
  const nosh = (damage: number): number => {
    const g = game(dk, [{ active: 'Carnivine', energy: { active: [G] }, damage: { active: damage } }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Nosh');
    return damageOf(g, 0);
  };
  // "Heal 40 damage from this Pokémon."
  assert.equal(nosh(70), 30);
  assert.equal(nosh(30), 0, 'no more than the damage on it');
});

test('Carnivine, Loom Over: 10 less damage for each damage counter on this Pokémon', () => {
  const dk = deck('sv07-007', URSA);
  const hit = (damage: number): number => {
    const g = game(dk, [{ active: 'Carnivine', energy: { active: [G, G, G] }, damage: { active: damage } }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Loom Over');
    return damageOf(g, 1);
  };
  // "This attack does 10 less damage for each damage counter on this Pokémon."
  assert.equal(hit(0), 130);
  assert.equal(hit(40), 90);
  assert.equal(hit(100), 30);
});

// ------------------------------------------------------------------ Mow Rotom

test("Mow Rotom, Reaping Dash: discard all Tools and Special Energy from the opponent's Active Pokémon, then 30 damage", () => {
  const dk = deck(ROTOM, URSA, 'me01-166', 'me03-088');
  const g = game(dk, [
    { active: 'Mow Rotom', energy: { active: [G] } },
    { active: 'Bloodmoon Ursaluna ex', tools: { active: ['Air Balloon'] }, energy: { active: ['Telepathic Psychic Energy', P] } },
  ]);
  // "Before doing damage, discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon."
  choose(g, 'Attack: Reaping Dash');
  assert.deepEqual(names(g, g.state.p[1].discard), ['Air Balloon', 'Telepathic Psychic Energy'], 'the Tool and the Special Energy are discarded');
  assert.deepEqual(energyNames(g, 1, 'active'), [P], 'Basic Energy stays');
  assert.equal(g.state.p[1].active!.tools.length, 0);
  assert.equal(damageOf(g, 1), 30);
});

// ------------------------------------------------------------------ Eldegoss

test('Eldegoss, Breezy Gift: put this Pokémon and all attached cards into the deck, then search for up to 3 cards', () => {
  const dk = deck('sv07-011', LEDIAN, URSA);
  const g = game(dk, [
    { active: 'Eldegoss', energy: { active: [G] }, bench: ['Ledian'] },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  const deckBefore = g.state.p[0].deck.length;
  const handBefore = g.state.p[0].hand.length;
  // "Put this Pokémon and all attached cards into your deck. If you do, search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck."
  choose(g, 'Attack: Breezy Gift');
  assert.equal(g.state.p[0].deck.length, deckBefore + 2, 'Eldegoss and its Energy are in the deck');
  assert.equal(g.decision?.kind, 'cards');
  pick(g, ['Eldegoss', 'Ledian']);
  assert.equal(g.state.p[0].hand.length, handBefore + 2, 'up to 3: two taken');
  assert.deepEqual(names(g, g.state.p[0].hand.slice(handBefore)), ['Eldegoss', 'Ledian']);
  assert.ok(!g.state.p[0].bench.some((b) => name(g, b.cards[0] as number) === 'Eldegoss'));
  assert.notEqual(g.state.p[0].active?.cards[0], undefined, 'the Bench Pokémon replaced the Active Spot');
  assert.equal(name(g, g.state.p[0].active!.cards[0] as number), 'Ledian');
  const inDeck = names(g, g.state.p[0].deck).filter((n) => n === 'Eldegoss');
  assert.equal(inDeck.length, 3, 'the other three Eldegoss are still in the deck, none else was taken');
});

test('Eldegoss, Breezy Gift: usable with no cards in the deck (ruling 2018)', () => {
  const dk = deck('sv07-011', LEDIAN, URSA);
  const g = game(dk, [
    { active: 'Eldegoss', energy: { active: [G] }, bench: ['Ledian'], emptyDeck: true },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  assert.equal(g.state.p[0].deck.length, 0);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2018/): Can use even if deck is empty before putting Eldegoss into it.
  assert.ok(has(g, 'Attack: Breezy Gift'));
  choose(g, 'Attack: Breezy Gift');
  assert.equal(g.decision?.kind, 'cards');
  assert.deepEqual(names(g, (g.decision?.values ?? []) as number[]), [G, 'Eldegoss'].sort(), 'the cards it just put into the deck can be searched');
  pick(g, ['Eldegoss', G]);
  assert.deepEqual(names(g, g.state.p[0].hand.slice(-2)), [G, 'Eldegoss'].sort());
  assert.equal(g.state.p[0].deck.length, 0);
});

// ------------------------------------------------------------------ Dipplin

test('Dipplin, Coated Attack: during the opponent\'s next turn, prevent all damage from attacks by Basic Pokémon', () => {
  const dk = deck('sv07-013', ROTOM, LEDIAN);
  const hit = (attacker: string, atk: string): number => {
    const g = game(dk, [{ active: 'Dipplin', energy: { active: [G] } }, { active: attacker, energy: { active: [F, F] } }]);
    // "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon."
    choose(g, 'Attack: Coated Attack');
    assert.equal(damageOf(g, 1), 20, 'Coated Attack itself does 20');
    choose(g, `Attack: ${atk}`);
    return damageOf(g, 0);
  };
  assert.equal(hit('Mow Rotom', 'Reaping Dash'), 0, 'a Basic Pokémon does no damage');
  assert.equal(hit('Ledian', 'Swift'), 70, 'a Stage 1 Pokémon still does its 70');
});

// ------------------------------------------------------------------ Hydrapple ex

test('Hydrapple ex, Ripening Charge: attach a Basic {G} Energy from hand to a Pokémon and heal 30 damage from it', () => {
  const dk = deck(HYDRA, LEDIAN, URSA);
  const g = game(dk, [
    { active: 'Hydrapple ex', bench: ['Ledian'], hand: [G, F], damage: { active: 50, 0: 50 } },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  // "Once during your turn, you may attach a Basic {G} Energy card from your hand to 1 of your Pokémon. If you attached Energy to a Pokémon in this way, heal 30 damage from that Pokémon."
  choose(g, 'Ripening Charge');
  assert.equal(g.decision?.kind, 'slots');
  choose(g, 'Ledian');
  assert.deepEqual(energyNames(g, 0, 0), [G]);
  assert.equal(damageOf(g, 0, 0), 20, 'the Pokémon it was attached to is healed 30');
  assert.equal(damageOf(g, 0), 50, 'the others are not');
  assert.deepEqual(names(g, g.state.p[0].hand), [F], 'only the Grass Energy left the hand');
  assert.ok(!has(g, 'Ripening Charge'), 'once during your turn');
});

test('Hydrapple ex, Ripening Charge: not offered without a Basic {G} Energy in hand; no heal when nothing was attached', () => {
  const dk = deck(HYDRA, LEDIAN, URSA);
  const none = game(dk, [{ active: 'Hydrapple ex', hand: [F, W] }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(none, 'Ripening Charge'), 'a Fire and a Water Energy do not qualify');
  const blocked = game(dk, [{ active: 'Hydrapple ex', bench: ['Ledian'], hand: [G], damage: { 0: 50 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  inject(blocked, blocked.state.p[0].bench[0]!.id, { k: 'cantAttachFromHand' });
  choose(blocked, 'Ripening Charge');
  if (blocked.decision?.kind === 'slots') choose(blocked, 'Ledian');
  assert.equal(energyNames(blocked, 0, 0).length, 0, "the Energy couldn't be attached");
  assert.equal(damageOf(blocked, 0, 0), 50, 'so "if you attached" is false: no heal');
});

test('Hydrapple ex, Syrup Storm: 30 more damage for each {G} Energy attached to all of your Pokémon', () => {
  const dk = deck(HYDRA, LEDIAN, URSA);
  const hit = (energy: SideLayout['energy']): number => {
    const g = game(dk, [{ active: 'Hydrapple ex', bench: ['Ledian'], energy }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Syrup Storm');
    return damageOf(g, 1);
  };
  // "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon."
  assert.equal(hit({ active: [F, F] }), 30, 'no {G} Energy: the printed 30');
  assert.equal(hit({ active: [G, G] }), 90, 'two on the Active Pokémon');
  assert.equal(hit({ active: [G, F], 0: [G, G, W] }), 120, 'one Active and two Benched: 3 × 30 more');
});

// ------------------------------------------------------------------ Turtonator

test("Turtonator, Ring of Fire: 50 damage, the Defending Pokémon is Burned and can't retreat during the opponent's next turn", () => {
  const dk = deck(TURTLE, URSA, LEDIAN);
  const g = game(dk, [
    { active: 'Turtonator', energy: { active: [F, F, F] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Ledian'], energy: { active: [F, F, F] } },
  ]);
  // "Your opponent's Active Pokémon is now Burned. During your opponent's next turn, that Pokémon can't retreat."
  g.state.forcedCoins = [false]; // Burned's Checkup flip: tails, it stays Burned
  choose(g, 'Attack: Ring of Fire');
  assert.equal(damageOf(g, 1), 70, '50, plus the 2 damage counters of Burned at Pokémon Checkup');
  assert.ok((g.state.p[1].active!.cond & BURNED) !== 0, 'Burned');
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Retreat'), "can't retreat during the opponent's next turn");
  // Sanity: after Turtonator's other attack the same Pokémon can retreat.
  const control = game(dk, [
    { active: 'Turtonator', energy: { active: [F, F, F, F] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Ledian'], energy: { active: [F, F, F] } },
  ]);
  choose(control, 'Attack: Inferno Onrush');
  assert.ok(has(control, 'Retreat'), 'without the effect that Pokémon could retreat');
});

test('Turtonator, Inferno Onrush: 180 damage, and 60 damage to itself', () => {
  const dk = deck(TURTLE, URSA);
  const g = game(dk, [{ active: 'Turtonator', energy: { active: [F, F, F, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  // "This Pokémon also does 60 damage to itself."
  choose(g, 'Attack: Inferno Onrush');
  assert.equal(damageOf(g, 1), 180);
  assert.equal(damageOf(g, 0), 60);
});

// ------------------------------------------------------------------ Lapras ex

test('Lapras ex, Power Splash: 40 damage for each Energy attached to this Pokémon', () => {
  const dk = deck('sv07-032', URSA);
  const hit = (energy: string[]): number => {
    const g = game(dk, [{ active: 'Lapras ex', energy: { active: energy } }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Power Splash');
    return damageOf(g, 1);
  };
  // "This attack does 40 damage for each Energy attached to this Pokémon."
  assert.equal(hit([W]), 40);
  assert.equal(hit([W, F, P, M]), 160);
});

test('Lapras ex, Larimar Rain: attach any number of the Energy among the top 20 cards to your Pokémon; shuffle the rest', () => {
  const dk = fromIds('c21-lapras', [['sv07-032', 4], [LEDIAN, 30], [URSA, 4], ...ENERGY]);
  const top = [...Array(18).fill('Ledian'), F, W, L, L] as string[];
  const g = game(dk, [
    { active: 'Lapras ex', bench: ['Ledian'], energy: { active: [W, P, M] }, deckTop: top },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  const deckBefore = g.state.p[0].deck.length;
  // "Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck."
  choose(g, 'Attack: Larimar Rain');
  assert.equal(g.decision?.kind, 'cards');
  assert.deepEqual(names(g, (g.decision?.values ?? []) as number[]), [F, W].sort(), 'only the Energy among the top 20 (the two Lightning are 21st and 22nd)');
  pick(g, [F, W]);
  // Each card goes to a Pokémon of your choosing.
  assert.equal(g.decision?.kind, 'slots');
  choose(g, 'Ledian');
  choose(g, 'Lapras ex');
  assert.deepEqual(energyNames(g, 0, 0), [F], 'Fire Energy went to the Benched Ledian');
  assert.deepEqual(energyNames(g, 0, 'active'), [M, P, W, W].sort(), 'Water Energy to Lapras ex');
  assert.equal(g.state.p[0].deck.length, deckBefore - 2);
});

test('Lapras ex, Larimar Rain: you may attach none of them', () => {
  const dk = fromIds('c21-lapras', [['sv07-032', 4], [LEDIAN, 30], [URSA, 4], ...ENERGY]);
  const g = game(dk, [{ active: 'Lapras ex', energy: { active: [W, P, M] }, deckTop: [F, 'Ledian'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Larimar Rain');
  g.submit([]);
  assert.equal(g.state.p[0].deck.length, deckBefore, 'nothing left the deck');
  assert.equal(energyNames(g, 0, 'active').length, 3);
});

// ------------------------------------------------------------------ Carracosta

test("Carracosta, Primal Knowledge: attacks by your Pokémon do 30 more to the opponent's Active Evolution Pokémon", () => {
  const dk = deck('sv07-038', TURTLE, HYDRA, URSA);
  const hit = (mine: string, theirs: string, carracosta: boolean): number => {
    const g = game(dk, [
      { active: mine, bench: carracosta ? ['Carracosta'] : [], energy: { active: [F, F, F] } },
      { active: theirs },
    ]);
    choose(g, 'Attack: Ring of Fire');
    return damageOf(g, 1) - 20; // minus the Burned counters placed at Pokémon Checkup
  };
  // "Attacks used by your Pokémon do 30 more damage to your opponent's Active Evolution Pokémon (before applying Weakness and Resistance)."
  // Hydrapple ex (Stage 2) is weak to {R}: (50 + 30) × 2.
  assert.equal(hit('Turtonator', 'Hydrapple ex', true), 160, '30 more, before Weakness');
  assert.equal(hit('Turtonator', 'Hydrapple ex', false), 100, 'without Carracosta: 50 × 2');
  assert.equal(hit('Turtonator', 'Bloodmoon Ursaluna ex', true), 50, 'a Basic Pokémon: no bonus');
});

// ------------------------------------------------------------------ Greninja ex

test('Greninja ex, Shifting Shuriken: flip a coin; on heads, 100 more damage', () => {
  const dk = deck('sv07-041', URSA);
  const hit = (heads: boolean): number => {
    const g = game(dk, [{ active: 'Greninja ex', energy: { active: [W, W] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Shifting Shuriken');
    return damageOf(g, 1);
  };
  // "Flip a coin. If heads, this attack does 100 more damage."
  assert.equal(hit(true), 200);
  assert.equal(hit(false), 100);
});

// ------------------------------------------------------------------ Crabominable / Veluza

test('Crabominable, Food Prep: attacks cost {C} less for each Kofu card in your discard pile', () => {
  const dk = deck('sv07-042', URSA, KOFU);
  const canHaymaker = (kofu: number, energy: string[]): boolean => {
    const g = game(dk, [
      { active: 'Crabominable', energy: { active: energy }, discard: Array(kofu).fill('Kofu') as string[] },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
    return has(g, 'Attack: Haymaker');
  };
  // "Attacks used by this Pokémon cost {C} less for each Kofu card in your discard pile." Haymaker costs {W}{C}{C}{C}{C}.
  assert.equal(canHaymaker(0, [W, F, F]), false, 'three Energy, no Kofu');
  assert.equal(canHaymaker(1, [W, F, F]), false, 'one Kofu: still needs 4');
  assert.equal(canHaymaker(2, [W, F, F]), true, 'two Kofu: {W}{C}{C}');
  assert.equal(canHaymaker(4, [W]), true, 'four Kofu: {W}');
  assert.equal(canHaymaker(4, [F]), false, 'only {C} is reduced: {W} is still needed');
});

test("Crabominable, Haymaker: 250 damage; during your next turn this Pokémon can't use Haymaker", () => {
  const dk = deck('sv07-042', URSA);
  const g = game(dk, [
    { active: 'Crabominable', energy: { active: [W, W, W, W, W] } },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  choose(g, 'Attack: Haymaker');
  assert.equal(damageOf(g, 1), 250);
  endTurn(g);
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack: Haymaker'), "can't use Haymaker during your next turn");
});

test("Veluza, Food Prep and Sonic Edge: attacks cost {C} less per Kofu; the damage isn't affected by effects on the Defending Pokémon", () => {
  const dk = deck('sv07-045', URSA, KOFU);
  const setup = (kofu: number, energy: string[]): Game =>
    game(dk, [{ active: 'Veluza', energy: { active: energy }, discard: Array(kofu).fill('Kofu') as string[] }, { active: 'Bloodmoon Ursaluna ex' }]);
  // "Attacks used by this Pokémon cost {C} less for each Kofu card in your discard pile." Sonic Edge costs {C}{C}{C}{C}.
  assert.equal(has(setup(0, [W, W]), 'Attack: Sonic Edge'), false);
  assert.equal(has(setup(2, [W, W]), 'Attack: Sonic Edge'), true);
  assert.equal(has(setup(2, [W]), 'Attack: Sonic Edge'), false);
  // "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
  const hit = (st?: StaticEffect): number => {
    const g = setup(0, [W, W, W, W]);
    if (st) inject(g, g.state.p[1].active!.id, st);
    choose(g, 'Attack: Sonic Edge');
    return damageOf(g, 1);
  };
  assert.equal(hit(), 110);
  assert.equal(hit({ k: 'damageIn', amount: -30 }), 110, 'a -30 effect is ignored');
  assert.equal(hit({ k: 'preventDamage' }), 110, 'prevention is ignored');
});

// ------------------------------------------------------------------ Electivire

test("Electivire, Unleash Lightning: 220 damage; during your next turn your Pokémon can't attack, new ones included", () => {
  const dk = deck('sv07-047', 'sv07-055', URSA);
  const g = game(dk, [
    { active: 'Electivire', bench: ['Zeraora'], energy: { active: [L, L, L, L, L], 0: [L, L] } },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  // "During your next turn, your Pokémon can't attack. (This includes new Pokémon that come into play.)"
  choose(g, 'Attack: Unleash Lightning');
  assert.equal(damageOf(g, 1), 220);
  endTurn(g);
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack:'), 'Electivire can\'t attack');
  choose(g, 'Retreat');
  while (g.decision?.kind !== 'option' || !has(g, 'Attack:')) {
    if (g.decision?.kind === 'cards') g.submit([0, 1, 2].slice(0, g.decision.min));
    else if (g.decision?.kind === 'slots') g.submit([(g.decision.values as number[])[0] as number]);
    else break;
  }
  assert.equal(name(g, g.state.p[0].active!.cards[0] as number), 'Zeraora', 'the Benched Pokémon is Active now');
  assert.ok(!has(g, 'Attack:'), 'neither can the Pokémon that took its place');
});

// ------------------------------------------------------------------ Joltik

test('Joltik, Jolting Charge: attach up to 2 Basic {G} and up to 2 Basic {L} Energy from the deck to your Pokémon', () => {
  const dk = deck('sv07-050', LEDIAN, URSA);
  const g = game(dk, [{ active: 'Joltik', bench: ['Ledian'], energy: { active: [L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  // "Search your deck for up to 2 Basic {G} Energy cards and up to 2 Basic {L} Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck."
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Jolting Charge');
  assert.equal(g.decision?.kind, 'cards');
  pick(g, [G, G]); // up to 2 Grass
  assert.equal(g.decision?.kind, 'cards');
  pick(g, [L]); // "up to 2" Lightning: just one
  // Three cards to attach, each to a Pokémon of the controller's choosing.
  choose(g, 'Joltik');
  choose(g, 'Ledian');
  choose(g, 'Ledian');
  assert.deepEqual(energyNames(g, 0, 'active'), [G, L].sort());
  assert.deepEqual(energyNames(g, 0, 0), [G, L].sort());
  assert.equal(g.state.p[0].deck.length, deckBefore - 3);
});

test('Joltik, Jolting Charge: may take none', () => {
  const dk = deck('sv07-050', URSA);
  const g = game(dk, [{ active: 'Joltik', energy: { active: [L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Jolting Charge');
  g.submit([]);
  g.submit([]);
  assert.equal(g.state.p[0].deck.length, deckBefore);
  assert.deepEqual(energyNames(g, 0, 'active'), [L]);
});

// ------------------------------------------------------------------ Galvantula ex

test("Galvantula ex, Charged Web: 110 more damage if the opponent's Active Pokémon is a Pokémon ex", () => {
  const dk = deck('sv07-051', URSA, TURTLE);
  const hit = (theirs: string): number => {
    const g = game(dk, [{ active: 'Galvantula ex', energy: { active: [L, L] } }, { active: theirs }]);
    choose(g, 'Attack: Charged Web');
    return damageOf(g, 1);
  };
  // "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 110 more damage."
  assert.equal(hit('Bloodmoon Ursaluna ex'), 220);
  assert.equal(hit('Turtonator'), 110, 'not an ex: the printed 110');
});

test("Galvantula ex, Fulgurite: 180 damage, discard all Energy from this Pokémon; the opponent can't play Items from hand next turn", () => {
  const dk = deck('sv07-051', URSA, 'me01-130', 'me01-114');
  const setup = (): Game =>
    game(dk, [
      { active: 'Galvantula ex', energy: { active: [G, L, FI] }, bench: ['Bloodmoon Ursaluna ex'] },
      { active: 'Bloodmoon Ursaluna ex', hand: ['Switch', "Boss's Orders"], bench: ['Bloodmoon Ursaluna ex'] },
    ]);
  const control = setup();
  choose(control, 'Attack: Charged Web');
  assert.ok(has(control, 'Play Switch'), 'sanity: without Fulgurite the Item can be played');
  const g = setup();
  // "Discard all Energy from this Pokémon. During your opponent's next turn, they can't play any Item cards from their hand."
  choose(g, 'Attack: Fulgurite');
  assert.equal(damageOf(g, 1), 180);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Play Switch'), 'no Item cards');
  assert.ok(has(g, "Play Boss's Orders"), 'a Supporter is still fine');
});

// ------------------------------------------------------------------ Charjabug

test('Charjabug, Parallel Placement: search for up to 3 Charjabug and put them onto your Bench', () => {
  const dk = deck('sv07-052', URSA, LEDIAN);
  const g = game(dk, [{ active: 'Charjabug', energy: { active: [L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  // "Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck."
  choose(g, 'Attack: Parallel Placement');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.max, 3);
  pick(g, ['Charjabug', 'Charjabug', 'Charjabug']);
  assert.deepEqual(names(g, g.state.p[0].bench.map((b) => b.cards[0] as number)), ['Charjabug', 'Charjabug', 'Charjabug']);
  const full = game(dk, [{ active: 'Charjabug', energy: { active: [L] }, bench: ['Ledian', 'Ledian', 'Ledian'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(full, 'Attack: Parallel Placement');
  assert.equal(full.decision?.max, 2, 'only as many as the Bench has room for');
});

// ------------------------------------------------------------------ Togedemaru

test('Togedemaru, Electrifying Chance: 30 damage; Paralyzed only with exactly 1 Prize card remaining', () => {
  const dk = deck('sv07-054', URSA);
  const hit = (prizes: number): Game => {
    const g = game(dk, [{ active: 'Togedemaru', energy: { active: [L] }, prizes }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Electrifying Chance');
    return g;
  };
  // "If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed."
  assert.ok((hit(1).state.p[1].active!.cond & PARALYZED) !== 0, 'exactly 1 Prize card');
  assert.equal(hit(2).state.p[1].active!.cond & PARALYZED, 0, '2 remaining');
  assert.equal(damageOf(hit(1), 1), 30);
});

// ------------------------------------------------------------------ Zeraora

test("Zeraora, Combat Thunder: 20 more damage for each of your opponent's Benched Pokémon", () => {
  const dk = deck('sv07-055', URSA, LEDIAN);
  const hit = (bench: string[], mine: string[] = []): number => {
    const g = game(dk, [{ active: 'Zeraora', bench: mine, energy: { active: [L, L] } }, { active: 'Bloodmoon Ursaluna ex', bench }]);
    choose(g, 'Attack: Combat Thunder');
    return damageOf(g, 1);
  };
  // "This attack does 20 more damage for each of your opponent's Benched Pokémon."
  assert.equal(hit([]), 20);
  assert.equal(hit(['Ledian', 'Ledian', 'Ledian']), 80);
  assert.equal(hit([], ['Ledian', 'Ledian']), 20, 'my own Bench does not count');
});

// ------------------------------------------------------------------ Slowpoke

test('Slowpoke, Dangle Tail: put a Pokémon from your discard pile into your hand', () => {
  const dk = deck('sv07-057', URSA, LEDIAN);
  const g = game(dk, [{ active: 'Slowpoke', energy: { active: [P] }, discard: ['Ledian', G, 'Bloodmoon Ursaluna ex'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  // "Put a Pokémon from your discard pile into your hand."
  choose(g, 'Attack: Dangle Tail');
  assert.deepEqual(names(g, (g.decision?.values ?? []) as number[]), ['Bloodmoon Ursaluna ex', 'Ledian'], 'only Pokémon are offered');
  const handBefore = g.state.p[0].hand.length;
  pick(g, ['Ledian']);
  assert.equal(g.state.p[0].hand.length, handBefore + 1);
  assert.ok(g.state.p[0].hand.some((c) => name(g, c) === 'Ledian'));
  assert.deepEqual(names(g, g.state.p[0].discard), ['Bloodmoon Ursaluna ex', G]);
});

// ------------------------------------------------------------------ Drifloon

test('Drifloon, Expand: 10 damage; during the opponent\'s next turn this Pokémon takes 10 less damage from attacks', () => {
  const dk = deck('sv07-060', ROTOM, URSA);
  const g = game(dk, [{ active: 'Drifloon', energy: { active: [P] } }, { active: 'Mow Rotom', energy: { active: [F] } }]);
  // "During your opponent's next turn, this Pokémon takes 10 less damage from attacks (after applying Weakness and Resistance)."
  choose(g, 'Attack: Expand');
  assert.equal(damageOf(g, 1), 10);
  choose(g, 'Attack: Reaping Dash');
  assert.equal(damageOf(g, 0), 20, '30 - 10');
});
