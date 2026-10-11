/**
 * Card tests, batch "std-c14": every card scripted in cards/scripts/std-c14.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { hasNoAbilities } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot, topCard } from '../state.js';
import type { StaticEffect } from '../dsl.js';
import type { Decision } from '../types.js';
import { CONFUSED } from '../types.js';
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
  return fromIds('c14', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass, no Resistance -- the target for non-Grass attackers
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting
const SLO = 'me05-029'; // Slowpoke: 70 HP, Psychic, Headbutt for {C}{C} 20
const LILLIE = 'me01-119'; // Lillie's Determination
const SWITCH = 'me01-130'; // Switch (an Item)

const F = 'Fire Energy';
const P = 'Psychic Energy';
const W = 'Water Energy';
const FI = 'Fighting Energy';
const L = 'Lightning Energy';

type Sides = [SideLayout, SideLayout];

/** A timed static on one Pokémon (as an attack or Ability of the opponent would leave it). */
function inject(g: Game, slotId: number, st: StaticEffect): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack: false, src: 0 });
}

// ------------------------------------------------------------------ Walking Wake ex

test('Walking Wake ex, Catharsis Roar: +120 if the Defending Pokémon has any Special Condition', () => {
  const dk = deck('sv05-050', TYR);
  const hit = (cond?: number): number => {
    const g = scenario(dk, dk, [{ active: 'Walking Wake ex', energy: { active: [W, W, W] } }, { active: 'Tyranitar ex', cond }]);
    choose(g, 'Attack: Catharsis Roar');
    return damageOf(g, 1);
  };
  // "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 120 more damage."
  assert.equal(hit(), 120, 'no Special Condition: the printed 120');
  assert.equal(hit(CONFUSED), 240, 'Confused: 120 more');
});

test("Walking Wake ex, Azure Seas: this Pokémon's attack damage isn't affected by effects on the Defending Pokémon, while the Ability is on", () => {
  const dk = deck('sv05-050', TYR);
  const hit = (setup: (g: Game) => void): number => {
    const g = scenario(dk, dk, [{ active: 'Walking Wake ex', energy: { active: [W, W, W] } }, { active: 'Tyranitar ex' }]);
    setup(g);
    choose(g, 'Attack: Catharsis Roar');
    return damageOf(g, 1);
  };
  const defender = (g: Game): number => g.state.p[1].active!.id;
  const turnOff = (g: Game): void => {
    // Something is turning this Pokémon's Abilities off (as Midnight Fluttering would).
    g.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 1, scope: 'oppPokemon', until: g.state.turn + 1, fromAttack: false, src: 0 });
  };
  // "Damage from attacks used by this Pokémon isn't affected by any effects on your opponent's Active Pokémon."
  assert.equal(hit((g) => inject(g, defender(g), { k: 'damageIn', amount: -30 })), 120 - 0, 'a -30 effect on the Defending Pokémon is ignored');
  assert.equal(hit((g) => inject(g, defender(g), { k: 'preventDamage' })), 120, 'a damage-prevention effect on the Defending Pokémon is ignored');
  // With the Ability turned off, the effects count again.
  assert.equal(
    hit((g) => {
      inject(g, defender(g), { k: 'damageIn', amount: -30 });
      turnOff(g);
    }),
    90,
    'Ability off: the -30 applies',
  );
  assert.equal(
    hit((g) => {
      inject(g, defender(g), { k: 'preventDamage' });
      turnOff(g);
    }),
    0,
    'Ability off: the prevention applies',
  );
  assert.equal(hit(turnOff), 120, 'Ability off with nothing to ignore: plain damage');
});

// ------------------------------------------------------------------ Raichu

test('Raichu, Collateral Bolts: 50 damage to every damaged Pokémon, both sides, except this Pokémon', () => {
  const dk = deck('sv05-052', TYR, URSA);
  const g = scenario(dk, dk, [
    { active: 'Raichu', bench: ['Bloodmoon Ursaluna ex', 'Tyranitar ex'], energy: { active: [L, L] }, damage: { active: 20, 0: 30 } },
    { active: 'Tyranitar ex', bench: ['Bloodmoon Ursaluna ex', 'Tyranitar ex'], damage: { active: 50, 0: 40 } },
  ]);
  // "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
  choose(g, 'Attack: Collateral Bolts');
  assert.equal(damageOf(g, 0), 20, 'this Pokémon is not hit, though it has damage counters');
  assert.equal(damageOf(g, 0, 0), 80, 'my damaged Benched Pokémon: 30 + 50');
  assert.equal(damageOf(g, 0, 1), 0, 'my undamaged Benched Pokémon is not hit');
  assert.equal(damageOf(g, 1), 100, "the opponent's damaged Active Pokémon: 50 + 50");
  assert.equal(damageOf(g, 1, 0), 90, "the opponent's damaged Benched Pokémon: 40 + 50");
  assert.equal(damageOf(g, 1, 1), 0, "the opponent's undamaged Benched Pokémon is not hit");
});

test('Raichu, Collateral Bolts: the opponent\'s Active Pokémon takes Weakness, a Benched Pokémon does not', () => {
  const dk = deck('sv05-052', 'sv05-050');
  const g = scenario(dk, dk, [
    { active: 'Raichu', energy: { active: [L, L] } },
    { active: 'Walking Wake ex', bench: ['Walking Wake ex'], damage: { active: 10, 0: 10 } },
  ]);
  choose(g, 'Attack: Collateral Bolts');
  assert.equal(damageOf(g, 1), 110, 'Weakness (Lightning ×2) applies to the Active Pokémon: 10 + 100');
  assert.equal(damageOf(g, 1, 0), 60, 'no Weakness on the Bench: 10 + 50');
});

// ------------------------------------------------------------------ Electivire

test('Electivire, Short-Circuit Knuckle: +120 if the opponent has any {W} Pokémon in play (Active or Benched)', () => {
  const dk = deck('sv05-054', 'sv05-050', TYR);
  const hit = (opp: SideLayout): number => {
    const g = scenario(dk, dk, [{ active: 'Electivire', energy: { active: [L, L] } }, opp]);
    choose(g, 'Attack: Short-Circuit Knuckle');
    return damageOf(g, 1);
  };
  // "If your opponent has any {W} Pokémon in play, this attack does 120 more damage."
  assert.equal(hit({ active: 'Tyranitar ex' }), 40, 'no {W} Pokémon');
  assert.equal(hit({ active: 'Tyranitar ex', bench: ['Walking Wake ex'] }), 160, 'a Benched {W} Pokémon');
  // A {W} Active Pokémon is Weak to Lightning: (40 + 120) × 2 = 320, Knocking Out Walking Wake ex (220 HP).
  const ko = scenario(dk, dk, [{ active: 'Electivire', energy: { active: [L, L] } }, { active: 'Walking Wake ex', bench: ['Tyranitar ex'] }]);
  choose(ko, 'Attack: Short-Circuit Knuckle');
  assert.deepEqual(names(ko, ko.state.p[1].discard), ['Walking Wake ex'], 'the Active Pokémon is {W}: the bonus applied (40 alone would not Knock it Out)');
  const own = scenario(dk, dk, [{ active: 'Electivire', bench: ['Walking Wake ex'], energy: { active: [L, L] } }, { active: 'Tyranitar ex' }]);
  choose(own, 'Attack: Short-Circuit Knuckle');
  assert.equal(damageOf(own, 1), 40, 'my own {W} Pokémon does not count');
});

// ------------------------------------------------------------------ Vikavolt

test('Vikavolt, Circuit Cannon: +80 for each of your Benched Charjabug', () => {
  const dk = deck('sv05-056', 'sv07-052', TYR);
  const hit = (bench: string[], active = 'Tyranitar ex'): number => {
    const g = scenario(dk, dk, [{ active: 'Vikavolt', bench, energy: { active: [L, L] } }, { active }]);
    choose(g, 'Attack: Circuit Cannon');
    return damageOf(g, 1);
  };
  // "This attack does 80 more damage for each of your Benched Charjabug."
  assert.equal(hit([]), 120);
  assert.equal(hit(['Charjabug']), 200);
  assert.equal(hit(['Charjabug', 'Charjabug']), 280);
  assert.equal(hit(['Charjabug', 'Tyranitar ex']), 200, 'only Charjabug count');
});

// ------------------------------------------------------------------ Boltund

test('Boltund, Electrifying Dash: 50 damage, then up to 2 Basic {L} Energy from the deck onto Benched Pokémon in any way you like', () => {
  const dk = deck('sv05-059', TYR, 'sv05-056');
  const side = (): Sides => [
    { active: 'Boltund', bench: ['Tyranitar ex', 'Vikavolt'], energy: { active: [L] } },
    { active: 'Tyranitar ex' },
  ];
  // "Search your deck for up to 2 Basic {L} Energy cards and attach them to your Benched Pokémon in any way you like. Then, shuffle your deck."
  const g = scenario(dk, dk, side());
  const before = g.state.p[0].deck.length;
  choose(g, 'Attack: Electrifying Dash');
  pick(g, [L, L]);
  choose(g, 'Vikavolt');
  choose(g, 'Vikavolt');
  assert.equal(damageOf(g, 1), 50);
  assert.deepEqual(energyNames(g, 0, 1), [L, L], 'both onto the same Benched Pokémon');
  assert.deepEqual(energyNames(g, 0, 0), []);
  assert.equal(g.state.p[0].deck.length, before - 2);
  // One each.
  const h = scenario(dk, dk, side());
  choose(h, 'Attack: Electrifying Dash');
  pick(h, [L, L]);
  choose(h, 'Tyranitar ex');
  choose(h, 'Vikavolt');
  assert.deepEqual(energyNames(h, 0, 0), [L]);
  assert.deepEqual(energyNames(h, 0, 1), [L]);
  // "up to 2": taking one, or none, is allowed on an attack.
  const one = scenario(dk, dk, side());
  choose(one, 'Attack: Electrifying Dash');
  pick(one, [L]);
  choose(one, 'Tyranitar ex');
  assert.equal(energyNames(one, 0, 0).length + energyNames(one, 0, 1).length, 1);
  const none = scenario(dk, dk, side());
  choose(none, 'Attack: Electrifying Dash');
  pick(none, []);
  assert.equal(energyNames(none, 0, 0).length + energyNames(none, 0, 1).length, 0);
  // Only Basic {L} Energy: the Active Pokémon's own Energy is untouched and the Bench is the only target.
  assert.deepEqual(energyNames(g, 0, 'active'), [L]);
});

// ------------------------------------------------------------------ Wugtrio ex

test("Wugtrio ex, Tricolor Pump: discard up to 3 Energy cards from your hand; 60 damage to 1 of your opponent's Pokémon for each", () => {
  const dk = deck('sv05-060', 'sv05-050', TYR, SWITCH);
  const side = (hand: string[]): Sides => [
    { active: 'Wugtrio ex', energy: { active: [W] }, hand },
    { active: 'Walking Wake ex', bench: ['Walking Wake ex'] },
  ];
  // "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)"
  const active = scenario(dk, dk, side([F, P, 'Switch']));
  choose(active, 'Attack: Tricolor Pump');
  pick(active, [F]);
  active.submit([0]);
  assert.deepEqual(names(active, active.state.p[0].discard), [F]);
  assert.equal(damageOf(active, 1), 120, "one Energy: 60, doubled by the Active Pokémon's Weakness to Lightning");
  assert.equal(damageOf(active, 1, 0), 0);
  const bench = scenario(dk, dk, side([F, F, P]));
  choose(bench, 'Attack: Tricolor Pump');
  pick(bench, [F, F, P]);
  const ls = labels(bench);
  assert.equal(ls.length, 2, 'two targets: the Active Pokémon and the Benched one');
  bench.submit([1]);
  assert.equal(damageOf(bench, 1, 0), 180, 'three Energy: 180 to the Benched Pokémon, with no Weakness');
  assert.equal(damageOf(bench, 1), 0);
  // Discarding none does nothing (and there is no target to choose).
  const none = scenario(dk, dk, side([F]));
  choose(none, 'Attack: Tricolor Pump');
  pick(none, []);
  assert.equal(damageOf(none, 1), 0);
  assert.equal(none.state.p[0].discard.length, 0);
  // Only Energy cards can be discarded, and at most 3.
  const cap = scenario(dk, dk, side([F, F, F, F]));
  choose(cap, 'Attack: Tricolor Pump');
  assert.ok(!labels(cap).some((l) => l.includes('Switch')));
  cap.submit([0, 1, 2]);
  choose(cap, 'Walking Wake ex');
  assert.equal(cap.state.p[0].discard.length, 3);
});

test("Wugtrio ex, Numbing Hold: 120 damage, and during your opponent's next turn the Defending Pokémon can't retreat", () => {
  const dk = deck('sv05-060', TYR);
  const g = scenario(dk, dk, [
    { active: 'Wugtrio ex', energy: { active: [W, W] } },
    { active: 'Tyranitar ex', bench: ['Tyranitar ex'], energy: { active: [F, F, F, F] } },
  ]);
  // "During your opponent's next turn, the Defending Pokémon can't retreat."
  choose(g, 'Attack: Numbing Hold');
  assert.equal(damageOf(g, 1), 120);
  assert.equal(g.decision?.player, 1);
  assert.ok(!has(g, 'Retreat'), 'cannot retreat during the opponent\'s next turn');
  // The effect ends with that turn: after both turns the Defending Pokémon may retreat again.
  const h = scenario(dk, dk, [
    { active: 'Wugtrio ex', energy: { active: [W, W] } },
    { active: 'Tyranitar ex', bench: ['Tyranitar ex'], energy: { active: [F, F, F, F] } },
  ]);
  choose(h, 'Attack: Numbing Hold');
  endTurn(h); // P2's turn: no retreat
  assert.ok(h.decision?.player === 0);
  endTurn(h);
  assert.ok(has(h, 'Retreat'), 'a turn later it can retreat again');
});

// ------------------------------------------------------------------ Mr. Mime

test('Mr. Mime, Look-Alike Show: the opponent reveals their hand and you may use the effect of a Supporter you find there', () => {
  const dk = deck('sv05-063', TYR, LILLIE, SWITCH);
  const mk = (hand: string[]): Game => scenario(dk, dk, [{ active: 'Mr. Mime', energy: { active: [P] }, hand: [] }, { active: 'Tyranitar ex', hand, prizes: 4 }]);
  // "Your opponent reveals their hand. You may use the effect of a Supporter card you find there as the effect of this attack."
  const g = mk(["Lillie's Determination", 'Switch']);
  choose(g, 'Attack: Look-Alike Show');
  assert.deepEqual(names(g, g.state.p[1].revealed ?? []), ["Lillie's Determination", 'Switch'], "the opponent's hand is revealed");
  yes(g);
  // The effect is mine: "exactly 6 Prize cards remaining" is checked for me (6, so 8 cards drawn), the card stays in their hand.
  assert.equal(g.state.p[0].hand.length, 8, "my hand was shuffled away and I drew 8 (6 Prize cards)");
  // (the opponent's turn then began and they drew a card)
  assert.ok(["Lillie's Determination", 'Switch'].every((n) => names(g, g.state.p[1].hand).includes(n)), 'their Supporter is not played, discarded or used up');
  assert.equal(g.state.p[1].hand.length, 3);
  assert.equal(g.state.p[1].discard.length, 0);
  // "You may": declining leaves everything as it was.
  const d = mk(["Lillie's Determination"]);
  choose(d, 'Attack: Look-Alike Show');
  no(d);
  assert.equal(d.state.p[0].hand.length, 0);
  assert.equal(d.state.p[1].hand.length, 2, 'their one card, and the card they drew');
  // Only a Supporter can be used: no question when there is none.
  const n = mk(['Switch']);
  choose(n, 'Attack: Look-Alike Show');
  assert.notEqual(n.decision?.kind, 'yesno');
  assert.equal(n.state.p[0].hand.length, 0);
  assert.deepEqual(names(n, n.state.p[1].revealed ?? []), ['Switch']);
});

test("Mr. Mime, Eerie Wave: 20 damage and the opponent's Active Pokémon is now Confused", () => {
  const dk = deck('sv05-063', TYR);
  const g = scenario(dk, dk, [{ active: 'Mr. Mime', energy: { active: [P] } }, { active: 'Tyranitar ex' }]);
  // "Your opponent's Active Pokémon is now Confused."
  choose(g, 'Attack: Eerie Wave');
  assert.equal(damageOf(g, 1), 20);
  assert.ok((g.state.p[1].active!.cond & CONFUSED) !== 0);
});

// ------------------------------------------------------------------ Marill

test('Marill, Ball Roll: flip until tails, 10 damage for each heads', () => {
  const dk = deck('sv05-064', TYR);
  const hit = (coins: boolean[]): number => {
    const g = scenario(dk, dk, [{ active: 'Marill', energy: { active: [P] } }, { active: 'Tyranitar ex' }]);
    g.state.forcedCoins = coins.slice();
    choose(g, 'Attack: Ball Roll');
    return damageOf(g, 1);
  };
  // "Flip a coin until you get tails. This attack does 10 damage for each heads."
  assert.equal(hit([false]), 0);
  assert.equal(hit([true, false]), 10);
  assert.equal(hit([true, true, true, false]), 30);
});

// ------------------------------------------------------------------ Bronzor

test("Bronzor, Mirror Attack: +30 if the opponent's Active Pokémon is a {P} Pokémon", () => {
  const dk = deck('sv05-068', 'sv05-063', TYR);
  const hit = (active: string): number => {
    const g = scenario(dk, dk, [{ active: 'Bronzor', energy: { active: [P] } }, { active }]);
    choose(g, 'Attack: Mirror Attack');
    return damageOf(g, 1);
  };
  // "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage."
  assert.equal(hit('Tyranitar ex'), 10);
  assert.equal(hit('Mr. Mime'), 40);
});

// ------------------------------------------------------------------ Flutter Mane

test("Flutter Mane, Midnight Fluttering: while Active, the opponent's Active Pokémon has no Abilities, except Midnight Fluttering (and Hide 'n' Sneak, Compendium #2426)", () => {
  const dk = deck('sv05-078', TYR, 'sv06.5-038', 'me05-034');
  const off = (g: Game, p: 0 | 1, where: 'active' | number): boolean => {
    const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
    return hasNoAbilities(g.envForInternals, g.state, sl);
  };
  // "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering."
  const g = scenario(dk, dk, [{ active: 'Flutter Mane', bench: ['Fezandipiti ex'] }, { active: 'Fezandipiti ex', bench: ['Fezandipiti ex'] }]);
  assert.ok(off(g, 1, 'active'), "the opponent's Active Pokémon has no Abilities");
  assert.ok(!off(g, 1, 0), "the opponent's Benched Pokémon keeps its Abilities");
  assert.ok(!off(g, 0, 0), 'my own Pokémon keep theirs');
  assert.ok(!off(g, 0, 'active'), 'Flutter Mane keeps its own');
  // Not in the Active Spot: no effect.
  const b = scenario(dk, dk, [{ active: 'Fezandipiti ex', bench: ['Flutter Mane'] }, { active: 'Fezandipiti ex' }]);
  assert.ok(!off(b, 1, 'active'), 'Flutter Mane on the Bench does not turn Abilities off');
  // Two Flutter Manes keep their Ability ("except for Midnight Fluttering").
  const both = scenario(dk, dk, [{ active: 'Flutter Mane' }, { active: 'Flutter Mane' }]);
  assert.ok(!off(both, 1, 'active'));
  assert.ok(!off(both, 0, 'active'));
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2426/): "Hide 'n' Sneak takes precedence over Midnight Fluttering. It doesn't matter which one comes into play first. Hide 'n' Sneak keeps working."
  const h = scenario(dk, dk, [{ active: 'Flutter Mane' }, { active: 'Banette' }]);
  assert.ok(!off(h, 1, 'active'), "Banette's Hide 'n' Sneak is not turned off");
  assert.ok(def(h.ctx, topCard(h.state.p[1].active!)).abilities.some((a) => a.name === "Hide 'n' Sneak"));
});

test("Flutter Mane, Hex Hurl: 90 damage, and 2 damage counters on the opponent's Benched Pokémon in any way you like", () => {
  const dk = deck('sv05-078', TYR, URSA);
  const mk = (bench: string[]): Game => scenario(dk, dk, [{ active: 'Flutter Mane', energy: { active: [P, P, P] } }, { active: 'Tyranitar ex', bench }]);
  // "Put 2 damage counters on your opponent's Benched Pokémon in any way you like."
  const g = mk(['Bloodmoon Ursaluna ex', 'Tyranitar ex']);
  choose(g, 'Attack: Hex Hurl');
  choose(g, 'Bloodmoon Ursaluna ex');
  choose(g, 'Bloodmoon Ursaluna ex');
  assert.equal(damageOf(g, 1), 90);
  assert.equal(damageOf(g, 1, 0), 20, 'both counters on one Pokémon');
  assert.equal(damageOf(g, 1, 1), 0);
  const split = mk(['Bloodmoon Ursaluna ex', 'Tyranitar ex']);
  choose(split, 'Attack: Hex Hurl');
  choose(split, 'Bloodmoon Ursaluna ex');
  choose(split, 'Tyranitar ex');
  assert.equal(damageOf(split, 1, 0), 10);
  assert.equal(damageOf(split, 1, 1), 10);
  const one = mk(['Tyranitar ex']);
  choose(one, 'Attack: Hex Hurl');
  assert.equal(damageOf(one, 1, 0), 20, 'a single Benched Pokémon takes both');
  const none = mk([]);
  choose(none, 'Attack: Hex Hurl');
  assert.equal(damageOf(none, 1), 90, 'no Bench: only the damage');
});

// ------------------------------------------------------------------ Iron Valiant

test("Iron Valiant, Gemini Laser: 20 damage, and 20 to 1 of the opponent's Benched Pokémon with no Weakness", () => {
  const dk = deck('sv05-079', TYR, 'sv05-050');
  const g = scenario(dk, dk, [
    { active: 'Iron Valiant', energy: { active: [P] } },
    { active: 'Tyranitar ex', bench: ['Walking Wake ex', 'Tyranitar ex'] },
  ]);
  // "This attack also does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
  choose(g, 'Attack: Gemini Laser');
  choose(g, 'Tyranitar ex');
  assert.equal(damageOf(g, 1), 20);
  assert.equal(damageOf(g, 1, 1), 20);
  assert.equal(damageOf(g, 1, 0), 0);
  const none = scenario(dk, dk, [{ active: 'Iron Valiant', energy: { active: [P] } }, { active: 'Tyranitar ex' }]);
  choose(none, 'Attack: Gemini Laser');
  assert.equal(damageOf(none, 1), 20, 'no Bench: only the Defending Pokémon');
});

test("Iron Valiant, Zen Blade: 120 damage, and during your next turn this Pokémon can't use Zen Blade", () => {
  const dk = deck('sv05-079', TYR);
  const g = scenario(dk, dk, [{ active: 'Iron Valiant', energy: { active: [P, P, P] } }, { active: 'Tyranitar ex' }]);
  // "During your next turn, this Pokémon can't use Zen Blade."
  choose(g, 'Attack: Zen Blade');
  assert.equal(damageOf(g, 1), 120);
  endTurn(g); // the opponent's turn
  assert.equal(g.decision?.player, 0);
  assert.ok(!has(g, 'Attack: Zen Blade'), 'not during my next turn');
  assert.ok(has(g, 'Attack: Gemini Laser'), 'its other attack is fine');
  endTurn(g);
  endTurn(g);
  assert.ok(has(g, 'Attack: Zen Blade'), 'the turn after, it can use it again');
});

// ------------------------------------------------------------------ Drilbur

test('Drilbur, Dig Dig Dig: when played to the Bench from hand, you may search for up to 3 Basic {F} Energy cards and discard them', () => {
  const dk = deck('sv05-085', TYR);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Drilbur'] }, { active: 'Tyranitar ex' }]);
  // "When you play this Pokémon from your hand onto your Bench during your turn, you may search your deck for up to 3 Basic {F} Energy cards and discard them. Then, shuffle your deck."
  const g = mk();
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Bench Drilbur');
  yes(g);
  pick(g, [FI, FI, FI]);
  assert.deepEqual(names(g, g.state.p[0].discard), [FI, FI, FI]);
  assert.equal(g.state.p[0].deck.length, deckBefore - 3);
  // "up to 3" on an Ability is 1 to 3 (TPCi 2026-02-19): at least one card is found.
  const fewer = mk();
  choose(fewer, 'Bench Drilbur');
  yes(fewer);
  pick(fewer, [FI]);
  assert.equal(fewer.state.p[0].discard.length, 1);
  // "you may": declining finds nothing.
  const declined = mk();
  choose(declined, 'Bench Drilbur');
  no(declined);
  assert.equal(declined.state.p[0].discard.length, 0);
  // With no Basic {F} Energy in the deck there is nothing to search for, so it is not offered.
  const bare = fromIds('bare', [
    ['sv05-085', 4],
    [TYR, 4],
    ['mee-003', 20],
  ]);
  const b = scenario(bare, bare, [{ active: 'Tyranitar ex', hand: ['Drilbur'] }, { active: 'Tyranitar ex' }]);
  choose(b, 'Bench Drilbur');
  assert.equal(b.decision?.kind, 'main');
  assert.equal(b.state.p[0].discard.length, 0);
});

// ------------------------------------------------------------------ Golurk

test("Golurk, Iron Defense: flip a coin; if heads, during your opponent's next turn prevent all damage done to this Pokémon by attacks", () => {
  const dk = deck('sv05-088', SLO);
  const run = (coin: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Golurk', energy: { active: [FI] } }, { active: 'Slowpoke', energy: { active: [P, P] } }]);
    g.state.forcedCoins = [coin];
    choose(g, 'Attack: Iron Defense');
    choose(g, 'Attack: Headbutt');
    return g;
  };
  assert.equal(damageOf(run(true), 0), 0, 'heads: the 20 damage is prevented');
  assert.equal(damageOf(run(false), 0), 20, 'tails: Slowpoke\'s Headbutt hits');
});

test("Golurk, Fighting Fist: +120 if the opponent's Active Pokémon is a Pokémon ex", () => {
  const dk = deck('sv05-088', TYR, 'sv05-096');
  const hit = (active: string): number => {
    const g = scenario(dk, dk, [{ active: 'Golurk', energy: { active: [FI, FI, FI, FI] } }, { active }]);
    choose(g, 'Attack: Fighting Fist');
    return damageOf(g, 1);
  };
  // "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 120 more damage."
  assert.equal(hit('Tyranitar ex'), 240);
  assert.equal(hit('Great Tusk'), 120);
});

// ------------------------------------------------------------------ Lycanroc

test('Lycanroc, Turbo Edge: 50 damage, then up to 2 Basic {F} Energy cards from your discard pile onto your Benched Pokémon in any way you like', () => {
  const dk = deck('sv05-090', TYR);
  const mk = (discard: string[], bench: string[]): Game => scenario(dk, dk, [{ active: 'Lycanroc', bench, energy: { active: [FI] }, discard }, { active: 'Tyranitar ex' }]);
  // "Attach up to 2 Basic {F} Energy cards from your discard pile to your Benched Pokémon in any way you like."
  const g = mk([FI, FI, FI, F], ['Tyranitar ex', 'Tyranitar ex']);
  choose(g, 'Attack: Turbo Edge');
  assert.equal(damageOf(g, 1), 50);
  pick(g, [FI, FI]);
  const ls = labels(g);
  g.submit([0]);
  g.submit([ls.length > 1 ? 1 : 0]);
  assert.equal(energyNames(g, 0, 0).length + energyNames(g, 0, 1).length, 2);
  assert.ok([...energyNames(g, 0, 0), ...energyNames(g, 0, 1)].every((n) => n === FI));
  assert.deepEqual(names(g, g.state.p[0].discard), [FI, F]);
  // One Pokémon takes both.
  const one = mk([FI, FI], ['Tyranitar ex']);
  choose(one, 'Attack: Turbo Edge');
  pick(one, [FI, FI]);
  assert.deepEqual(energyNames(one, 0, 0), [FI, FI]);
  assert.equal(one.state.p[0].discard.length, 0);
  // Only Basic {F} Energy; with none in the discard pile, nothing happens.
  const noF = mk([F, W], ['Tyranitar ex']);
  choose(noF, 'Attack: Turbo Edge');
  assert.deepEqual(energyNames(noF, 0, 0), []);
  assert.equal(noF.state.p[0].discard.length, 2);
});

// ------------------------------------------------------------------ Mudsdale

test('Mudsdale, Mud Stock: a Basic {F} Energy card from your discard pile onto each of your Benched Pokémon', () => {
  const dk = deck('sv05-092', TYR);
  const mk = (discard: string[], bench: string[]): Game =>
    scenario(dk, dk, [{ active: 'Mudsdale', bench, energy: { active: [FI] }, discard }, { active: 'Tyranitar ex' }]);
  // "Attach a Basic {F} Energy card from your discard pile to each of your Benched Pokémon."
  const all = mk([FI, FI, FI, F], ['Tyranitar ex', 'Tyranitar ex']);
  choose(all, 'Attack: Mud Stock');
  pick(all, [FI, FI]);
  choose(all, 'Tyranitar ex'); // the first card; the second then has only one Pokémon left
  assert.deepEqual(energyNames(all, 0, 0), [FI]);
  assert.deepEqual(energyNames(all, 0, 1), [FI]);
  assert.deepEqual(names(all, all.state.p[0].discard), [FI, F], 'two Basic {F} Energy used, the Fire Energy left');
  // Fewer cards than Benched Pokémon: each card goes to a different Pokémon, of my choosing.
  const few = mk([FI, FI], ['Tyranitar ex', 'Tyranitar ex', 'Tyranitar ex']);
  choose(few, 'Attack: Mud Stock');
  if (few.decision?.kind === 'cards') pick(few, [FI, FI]);
  choose(few, 'Tyranitar ex'); // the first card: any of the 3
  choose(few, 'Tyranitar ex'); // the second: either of the 2 left
  const got = [0, 1, 2].map((i) => energyNames(few, 0, i).length);
  assert.equal(got.reduce((a, b) => a + b, 0), 2);
  assert.ok(got.every((n) => n <= 1), 'no Pokémon gets two');
  assert.equal(few.state.p[0].discard.length, 0);
  // No Basic {F} Energy card in the discard pile: nothing.
  const none = mk([F], ['Tyranitar ex']);
  choose(none, 'Attack: Mud Stock');
  assert.deepEqual(energyNames(none, 0, 0), []);
});

test('Mudsdale, High Horsepower: 140 damage, and this Pokémon also does 40 damage to itself', () => {
  const dk = deck('sv05-092', TYR);
  const g = scenario(dk, dk, [{ active: 'Mudsdale', energy: { active: [FI, FI, FI] } }, { active: 'Tyranitar ex' }]);
  // "This Pokémon also does 40 damage to itself."
  choose(g, 'Attack: High Horsepower');
  assert.equal(damageOf(g, 1), 140);
  assert.equal(damageOf(g, 0), 40);
});

// ------------------------------------------------------------------ Coalossal

test('Coalossal, Gatling Tar: +80 for each {R} Energy attached to this Pokémon', () => {
  const dk = deck('sv05-095', TYR);
  const hit = (energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Coalossal', energy: { active: energy } }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Gatling Tar');
    return damageOf(g, 1);
  };
  // "This attack does 80 more damage for each {R} Energy attached to this Pokémon."
  assert.equal(hit([FI]), 40);
  assert.equal(hit([FI, F]), 120);
  assert.equal(hit([FI, F, F]), 200);
  assert.equal(hit([FI, W, F]), 120, 'only {R} Energy counts');
});

test("Coalossal, Cragalanche: 150 damage and discard the top 2 cards of your opponent's deck", () => {
  const dk = deck('sv05-095', TYR);
  const g = scenario(dk, dk, [
    { active: 'Coalossal', energy: { active: [FI, FI, FI, FI] } },
    { active: 'Tyranitar ex', discard: [], hand: [], ...{ deckTop: [W, L, F] } },
  ]);
  // "Discard the top 2 cards of your opponent's deck."
  const before = g.state.p[1].deck.length;
  choose(g, 'Attack: Cragalanche');
  assert.equal(damageOf(g, 1), 150);
  assert.deepEqual(names(g, g.state.p[1].discard), [L, W]);
  // The opponent then drew for their turn: the third card, which was left on top.
  assert.equal(g.state.p[1].deck.length, before - 3);
  assert.deepEqual(names(g, g.state.p[1].hand), [F]);
});

// ------------------------------------------------------------------ Great Tusk

test('Great Tusk, Wrathful Charge: +80 if your Benched Pokémon have any damage counters on them', () => {
  const dk = deck('sv05-096', TYR);
  const hit = (damage: SideLayout['damage']): number => {
    const g = scenario(dk, dk, [{ active: 'Great Tusk', bench: ['Tyranitar ex', 'Tyranitar ex'], energy: { active: [FI, FI, FI] }, damage }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Wrathful Charge');
    return damageOf(g, 1);
  };
  // "If your Benched Pokémon have any damage counters on them, this attack does 80 more damage."
  assert.equal(hit({}), 80);
  assert.equal(hit({ 1: 10 }), 160, 'one damaged Benched Pokémon is enough');
  assert.equal(hit({ 0: 10, 1: 10 }), 160, 'it does not stack');
  assert.equal(hit({ active: 50 }), 80, 'damage on the Active Pokémon itself does not count');
});
