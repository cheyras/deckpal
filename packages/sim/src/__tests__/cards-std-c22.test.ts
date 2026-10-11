/**
 * Card tests, batch "std-c22": every card scripted in cards/scripts/std-c22.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import type { Decision } from '../types.js';
import { CONFUSED, POISONED } from '../types.js';
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
function activeName(g: Game, p: 0 | 1): string {
  return name(g, g.state.p[p].active!.cards[g.state.p[p].active!.cards.length - 1] as number);
}
/** The names of the cards offered by the current card decision. */
function offered(g: Game): string[] {
  assert.equal(g.decision?.kind, 'cards', `expected a card decision, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  return [...new Set(((g.decision as Decision).values as number[]).map((c) => name(g, c)))].sort();
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]): DeckInput {
  return fromIds('c22', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}

const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass, no Resistance
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting
const TURTLE = 'sv07-025'; // Turtonator: 130 HP, Fire, weak Water
const ROTOM = 'sv07-008'; // Mow Rotom: 90 HP, Grass
const OGERPON = 'sv06-040'; // Hearthflame Mask Ogerpon ex: a Tera Pokémon
const CAPE = 'sv05-152'; // Hero's Cape: +100 HP
const MIST = 'sv05-161'; // Mist Energy
const BOOMERANG = 'sv06-166'; // Boomerang Energy (Special)
const IGNITION = 'sv10.5w-086'; // Ignition Energy (Special; {C}{C}{C} on an Evolution Pokémon)
const SWITCH = 'me01-130';
const XEROSIC = 'sv06.5-064'; // a Supporter
const COMMON = [TYR, URSA, TURTLE, CAPE, MIST, BOOMERANG, IGNITION, SWITCH];

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';

type Sides = [SideLayout, SideLayout];
function game(dk: DeckInput, sides: Sides, o?: ScenarioOptions): Game {
  return scenario(dk, dk, sides, o);
}

// ------------------------------------------------------------------ Drifblim

test('Drifblim, Everyone Explode Now: 50 damage for each Drifloon and Drifblim in play, and 30 damage to each of them', () => {
  const dk = deck('sv07-061', 'sv07-060', 'sv07-063', ...COMMON);
  // "This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim."
  const g = game(dk, [{ active: 'Drifblim', bench: ['Drifloon', 'Drifloon', 'Comfey'], energy: { active: [P] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Everyone Explode Now');
  assert.equal(damageOf(g, 1), 150, '3 Pokémon named Drifloon or Drifblim: 50 x 3');
  assert.equal(damageOf(g, 0), 30, 'this Drifblim is one of "each of your Drifloon and Drifblim"');
  assert.equal(damageOf(g, 0, 0), 30);
  assert.equal(damageOf(g, 0, 1), 30);
  assert.equal(damageOf(g, 0, 2), 0, 'Comfey is neither');
});

test('Drifblim, Everyone Explode Now: only the most evolved card of a Pokémon counts and is damaged (ruling 2021)', () => {
  const dk = deck('sv07-061', 'sv07-060', 'sv07-063', ...COMMON);
  // Ruling (Stellar Crown FAQ, TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2021/): "No, you only count the most evolved stage of a Pokemon in play. The previous stages are now part of that Pokemon."
  const g = game(dk, [
    { active: 'Drifblim', bench: ['Drifloon', 'Comfey'], evolve: { 0: ['Drifblim'] }, energy: { active: [P] } },
    { active: 'Tyranitar ex' },
  ]);
  assert.equal(g.state.p[0].bench[0]!.cards.length, 2, 'a Drifloon with a Drifblim on it');
  choose(g, 'Attack: Everyone Explode Now');
  assert.equal(damageOf(g, 1), 100, 'two Pokémon (the Drifloon under the Drifblim is not a third): 50 x 2');
  assert.equal(damageOf(g, 0, 0), 30, 'the evolved Pokémon takes 30 once');
  assert.equal(damageOf(g, 0, 1), 0);
});

// ------------------------------------------------------------------ Comfey

test('Comfey, Flower Shower: each player draws 3 cards', () => {
  const dk = deck('sv07-063', ...COMMON);
  const g = game(dk, [{ active: 'Comfey', energy: { active: [P] } }, { active: 'Tyranitar ex' }]);
  const mine = g.state.p[0].hand.length;
  const theirs = g.state.p[1].hand.length;
  choose(g, 'Attack: Flower Shower');
  assert.equal(g.state.p[0].hand.length, mine + 3);
  assert.equal(g.state.p[1].hand.length, theirs + 3 + 1, '3 from the attack, and 1 for their own turn that follows');
});

test('Comfey, Play Rough: flip a coin; on heads 20 more damage', () => {
  const dk = deck('sv07-063', ...COMMON);
  const hit = (coin: boolean): number => {
    const g = game(dk, [{ active: 'Comfey', energy: { active: [P] } }, { active: 'Tyranitar ex' }]);
    g.state.forcedCoins = [coin];
    choose(g, 'Attack: Play Rough');
    return damageOf(g, 1);
  };
  assert.equal(hit(true), 40, 'heads: 20 + 20');
  assert.equal(hit(false), 20, 'tails: 20');
});

// ------------------------------------------------------------------ Alcremie

test('Alcremie, Colorful Confection: up to 5 Pokémon of a type of a Basic Energy attached, revealed, into your hand', () => {
  const dk = deck('sv07-065', 'sv07-063', TURTLE, 'sv07-090', TYR, ROTOM, MIST);
  const g = game(dk, [{ active: 'Alcremie', energy: { active: [P, F] } }, { active: 'Tyranitar ex' }]);
  const before = g.state.p[0].hand.length;
  choose(g, 'Attack: Colorful Confection');
  // {P} and {R} Pokémon only: Koraidon ({F}), Tyranitar ex ({D}) and Mow Rotom ({G}) don't qualify.
  assert.deepEqual(offered(g), ['Alcremie', 'Comfey', 'Turtonator']);
  assert.equal(g.decision?.min, 0, '"up to": it can be none');
  assert.equal(g.decision?.max, 5);
  // Ruling (Stellar Crown FAQ, TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2019/): "You can search for more than one type of Pokemon as long as they match any Basic Energy card types attached to Alcremie. And if you want, more than one of them can be the same Energy type."
  pick(g, ['Comfey', 'Comfey', 'Turtonator', 'Alcremie']);
  assert.deepEqual(names(g, g.state.p[0].hand.slice(before)), ['Alcremie', 'Comfey', 'Comfey', 'Turtonator']);
  assert.deepEqual(names(g, g.state.p[0].revealed ?? []), ['Alcremie', 'Comfey', 'Comfey', 'Turtonator'], 'the cards are revealed');
  assert.equal(g.state.current, 1, 'the attack is over');
});

test('Alcremie, Colorful Confection: a Special Energy gives no type, and no Basic Energy finds nothing (ruling 2020)', () => {
  const dk = deck('sv07-065', 'sv07-063', TURTLE, TYR, 'sv06-167');
  // Ruling (Stellar Crown FAQ, TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2020/): "No, while Luminous Energy provides all types of Energy at the same time, it is not a Basic Energy card."
  const special = game(dk, [{ active: 'Alcremie', energy: { active: ['Legacy Energy'] } }, { active: 'Tyranitar ex' }]);
  const before = special.state.p[0].hand.length;
  choose(special, 'Attack: Colorful Confection');
  assert.notEqual(special.decision?.kind, 'cards', 'no Pokémon to search for');
  assert.equal(special.state.p[0].hand.length, before);
  assert.equal(special.state.current, 1);
});

test('Alcremie, Colorful Confection: choosing none is allowed', () => {
  const dk = deck('sv07-065', 'sv07-063', TYR);
  const g = game(dk, [{ active: 'Alcremie', energy: { active: [P] } }, { active: 'Tyranitar ex' }]);
  const before = g.state.p[0].hand.length;
  choose(g, 'Attack: Colorful Confection');
  g.submit([]);
  assert.equal(g.state.p[0].hand.length, before);
});

// ------------------------------------------------------------------ Dachsbun ex

function dachsbunGame(layout: { fidoughDamage?: number; evoDamage?: number }): Game {
  const dk = deck('sv07-067', 'sv07-066', 'sv07-080', 'sv07-063', ...COMMON);
  return game(dk, [
    {
      active: 'Fidough',
      hand: ['Dachsbun ex'],
      bench: ['Medicham ex', 'Medicham ex', 'Comfey'],
      damage: { active: layout.fidoughDamage ?? 0, 0: layout.evoDamage ?? 0, 2: 30 },
      energy: { active: [F, W], 0: [FI, FI], 1: [M], 2: [P] },
    },
    { active: 'Tyranitar ex' },
  ]);
}

test('Dachsbun ex, Time to Chow Down: heal all damage from each Evolution Pokémon, then discard all their Energy', () => {
  const g = dachsbunGame({ fidoughDamage: 20, evoDamage: 50 });
  choose(g, 'Evolve Fidough (Active) into Dachsbun ex');
  yes(g);
  // Ruling (Stellar Crown FAQ, TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2016/): "Yes." (the Dachsbun ex that just evolved is healed too)
  assert.equal(activeName(g, 0), 'Dachsbun ex');
  assert.equal(damageOf(g, 0), 0, 'the new Dachsbun ex is healed');
  assert.deepEqual(energyNames(g, 0, 'active'), [], 'and discards its Energy');
  assert.equal(damageOf(g, 0, 0), 0, 'the damaged Benched Medicham ex is healed');
  assert.deepEqual(energyNames(g, 0, 0), []);
  // The undamaged Evolution Pokémon keeps its Energy; a Basic Pokémon is not an Evolution Pokémon.
  assert.deepEqual(energyNames(g, 0, 1), [M]);
  assert.equal(damageOf(g, 0, 2), 30, 'Comfey is a Basic Pokémon');
  assert.deepEqual(energyNames(g, 0, 2), [P]);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, FI, FI, W].sort());
});

test('Dachsbun ex, Time to Chow Down: the Energy of an Evolution Pokémon that had no damage stays (ruling 2015: all or nothing)', () => {
  // Ruling (Stellar Crown FAQ, TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2015/): "No, you choose to use the Ability or not. Once you choose to use it, you have to heal all of your Evolution Pokemon and discard Energy from all of them that were healed."
  const g = dachsbunGame({ fidoughDamage: 0, evoDamage: 10 });
  choose(g, 'Evolve Fidough (Active) into Dachsbun ex');
  yes(g);
  assert.equal(damageOf(g, 0, 0), 0, 'healed, even with a single damage counter');
  assert.deepEqual(energyNames(g, 0, 0), [], 'so it discards its Energy');
  assert.deepEqual(energyNames(g, 0, 'active'), [F, W].sort(), 'Dachsbun ex had nothing to heal: its Energy stays');
  assert.deepEqual(names(g, g.state.p[0].discard), [FI, FI]);
});

test('Dachsbun ex, Time to Chow Down: "you may" decline, and with no damaged Evolution Pokémon it is not offered', () => {
  const declined = dachsbunGame({ fidoughDamage: 20, evoDamage: 50 });
  choose(declined, 'Evolve Fidough (Active) into Dachsbun ex');
  no(declined);
  assert.equal(damageOf(declined, 0), 20);
  assert.equal(damageOf(declined, 0, 0), 50);
  assert.equal(declined.state.p[0].discard.length, 0);

  const none = dachsbunGame({});
  choose(none, 'Evolve Fidough (Active) into Dachsbun ex');
  assert.notEqual(none.decision?.kind, 'yesno', 'nothing to heal');
  assert.deepEqual(energyNames(none, 0, 'active'), [F, W].sort());
});

test('Dachsbun ex, Wonder Shine: 130 damage and the Defending Pokémon is Confused', () => {
  const dk = deck('sv07-067', ...COMMON);
  const g = game(dk, [{ active: 'Dachsbun ex', energy: { active: [F, F] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Wonder Shine');
  assert.equal(damageOf(g, 1), 130);
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Iron Boulder

test("Iron Boulder, Adjusted Horn: 170 damage, but nothing if the hands aren't the same size", () => {
  const dk = deck('sv07-071', ...COMMON);
  const hit = (mine: string[], theirs: string[]): number => {
    const g = game(dk, [
      { active: 'Iron Boulder', energy: { active: [P, F] }, hand: mine },
      { active: 'Bloodmoon Ursaluna ex', hand: theirs },
    ]);
    choose(g, 'Attack: Adjusted Horn');
    return damageOf(g, 1);
  };
  // "If you don't have the same number of cards in your hand as your opponent, this attack does nothing."
  assert.equal(hit([F], [W]), 170, '1 and 1');
  assert.equal(hit([], []), 170, 'both empty');
  assert.equal(hit([F, F], [W]), 0, '2 and 1');
  assert.equal(hit([F], [W, W, W]), 0, '1 and 3');
});

// ------------------------------------------------------------------ Marowak

test("Marowak, Growl: during the opponent's next turn the Defending Pokémon's attacks do 40 less damage", () => {
  const dk = deck('sv07-073', 'sv07-067', ...COMMON);
  // Dachsbun ex (Psychic, 130) attacks Marowak (Fighting) in both positions, so Weakness never applies.
  const control = game(
    dk,
    [{ active: 'Marowak', tools: { active: [`Hero's Cape`] } }, { active: 'Dachsbun ex', energy: { active: [F, F] } }],
    { current: 1 },
  );
  choose(control, 'Attack: Wonder Shine');
  assert.equal(damageOf(control, 0), 130, 'without Growl');

  const g = game(dk, [
    { active: 'Marowak', energy: { active: [FI] }, tools: { active: [`Hero's Cape`] } },
    { active: 'Dachsbun ex', energy: { active: [F, F] } },
  ]);
  choose(g, 'Attack: Growl');
  assert.equal(g.state.current, 1);
  // "During your opponent's next turn, attacks used by the Defending Pokémon do 40 less damage (before applying Weakness and Resistance)."
  choose(g, 'Attack: Wonder Shine');
  assert.equal(damageOf(g, 0), 90, '130 - 40');
});

test('Marowak, Bone Vengeance: 120 more damage if any of your Benched Cubone has damage counters', () => {
  const dk = deck('sv07-073', 'sv07-072', 'sv07-063', ...COMMON);
  const hit = (bench: string[], damage: SideLayout['damage']): number => {
    const g = game(dk, [{ active: 'Marowak', bench, damage, energy: { active: [F, F] } }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Bone Vengeance');
    return damageOf(g, 1);
  };
  // "If any of your Benched Cubone have any damage counters on them, this attack does 120 more damage."
  assert.equal(hit(['Cubone'], { 0: 10 }), 180, '60 + 120');
  assert.equal(hit(['Comfey', 'Cubone'], { 1: 30 }), 180, 'any Benched Cubone');
  assert.equal(hit(['Cubone'], undefined), 60, 'an undamaged Cubone');
  assert.equal(hit(['Comfey'], { 0: 30 }), 60, 'a damaged Pokémon that is not a Cubone');
  assert.equal(hit([], undefined), 60, 'no Cubone');
});

// ------------------------------------------------------------------ Rhydon and Tauros

for (const [id, nm, base, cost] of [
  ['sv07-075', 'Rhydon', 80, [FI, F, F]],
  ['sv07-112', 'Tauros', 70, [F, F, F]],
] as const) {
  test(`${nm}, Destructive Horn: ${base} damage; flip a coin, and on heads discard an Energy from the opponent's Active Pokémon`, () => {
    const dk = deck(id, ...COMMON);
    const hit = (coin: boolean, energy: string[]): Game => {
      const g = game(dk, [{ active: nm, energy: { active: [...cost] } }, { active: 'Tyranitar ex', energy: { active: energy } }]);
      g.state.forcedCoins = [coin];
      choose(g, 'Attack: Destructive Horn');
      return g;
    };
    // "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon."
    const heads = hit(true, [W, L]);
    assert.equal(heads.decision?.player, 0, 'the attacking player chooses which Energy');
    pick(heads, [L]);
    assert.equal(damageOf(heads, 1), base);
    assert.deepEqual(energyNames(heads, 1, 'active'), [W]);
    assert.deepEqual(names(heads, heads.state.p[1].discard), [L]);

    const tails = hit(false, [W, L]);
    assert.deepEqual(energyNames(tails, 1, 'active'), [L, W].sort(), 'tails: nothing discarded');
    assert.equal(damageOf(tails, 1), base);

    const one = hit(true, [W]);
    assert.deepEqual(energyNames(one, 1, 'active'), [], 'a single Energy needs no choice');
    const none = hit(true, []);
    assert.equal(damageOf(none, 1), base, 'no Energy to discard: just the damage');
  });
}

// ------------------------------------------------------------------ Medicham ex

test("Medicham ex, Chi-Atsu: put damage counters on the opponent's Active Pokémon until its remaining HP is 50", () => {
  const dk = deck('sv07-080', ...COMMON);
  const use = (damage: number, tools?: string[]): number => {
    const g = game(dk, [
      { active: 'Medicham ex', energy: { active: [F, F] } },
      { active: 'Tyranitar ex', damage: { active: damage }, tools: tools ? { active: tools } : undefined },
    ]);
    choose(g, 'Attack: Chi-Atsu');
    return damageOf(g, 1);
  };
  // "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50."
  assert.equal(use(0), 290, '340 HP: 29 counters');
  assert.equal(use(100), 290, 'the same remaining HP whatever it had');
  assert.equal(use(300), 300, '40 HP remaining already: nothing is healed');
  assert.equal(use(0, [`Hero's Cape`]), 390, '440 HP with Hero\'s Cape');
});

test("Medicham ex, Yoga Kick: 190 damage that isn't affected by Weakness or Resistance", () => {
  const dk = deck('sv07-080', 'sv07-071', ...COMMON);
  const hit = (defender: string): number => {
    const g = game(dk, [
      { active: 'Medicham ex', energy: { active: [FI, F, F] } },
      { active: defender, tools: { active: [`Hero's Cape`] } },
    ]);
    choose(g, 'Attack: Yoga Kick');
    return damageOf(g, 1);
  };
  // Bloodmoon Ursaluna ex is weak to {F} (260 + 100 HP: ×2 would be Knocked Out); Iron Boulder resists {F}.
  assert.equal(hit('Bloodmoon Ursaluna ex'), 190, 'no ×2');
  assert.equal(hit('Iron Boulder'), 190, 'no -30');
});

// ------------------------------------------------------------------ Diancie

test("Diancie, Diffuse Reflection: 40 damage for each Special Energy card attached to all of the opponent's Pokémon", () => {
  const dk = deck('sv07-086', 'sv07-067', 'sv07-063', ...COMMON);
  const hit = (oppActive: string[], oppBench: string[]): number => {
    const g = game(dk, [
      { active: 'Diancie', energy: { active: ['Boomerang Energy'] } },
      { active: 'Dachsbun ex', bench: ['Comfey'], energy: { active: oppActive, 0: oppBench } },
    ]);
    choose(g, 'Attack: Diffuse Reflection');
    return damageOf(g, 1);
  };
  // "This attack does 40 damage for each Special Energy attached to all of your opponent's Pokémon."
  // Ruling (TPCi Rules Team 2024-09-05, https://compendium.pokegym.net/ruling/2010/): "The damage is calculated based on the number of Special Energy CARDS, not the amount of energy the card provides."
  // Ignition Energy provides {C}{C}{C} on an Evolution Pokémon (Dachsbun ex), and still counts once. Diancie's own Boomerang Energy is not counted.
  assert.equal(hit(['Ignition Energy'], []), 40, 'one card providing 3 Energy: +40, not +120');
  assert.equal(hit(['Ignition Energy', 'Boomerang Energy'], ['Mist Energy', F]), 120, 'Active and Bench: 3 Special Energy cards; Basic Energy is not counted');
  assert.equal(hit([F, W], [G]), 0, 'only Basic Energy: nothing');
});

// ------------------------------------------------------------------ Falinks

test('Falinks, Form Ranks: search for up to 2 Basic Pokémon and put them onto your Bench', () => {
  const dk = deck('sv07-088', 'sv07-063', 'sv07-090', TURTLE, TYR, 'sv07-067');
  const bench = (b: string[]): Game => {
    const g = game(dk, [{ active: 'Falinks', bench: b, energy: { active: [F] } }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Form Ranks');
    return g;
  };
  // "Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck."
  const g = bench(['Comfey']);
  assert.deepEqual(offered(g), ['Comfey', 'Falinks', 'Koraidon', 'Turtonator'], 'Basic Pokémon only (Dachsbun ex is a Stage 1, Tyranitar ex a Stage 2)');
  assert.equal(g.decision?.min, 0);
  assert.equal(g.decision?.max, 2);
  pick(g, ['Koraidon', 'Turtonator']);
  assert.deepEqual(names(g, g.state.p[0].bench.map((b) => b.cards[0] as number)), ['Comfey', 'Koraidon', 'Turtonator']);

  const nearlyFull = bench(['Comfey', 'Comfey', 'Comfey', 'Comfey']);
  assert.equal(nearlyFull.decision?.max, 1, 'only 1 space on the Bench');
  pick(nearlyFull, ['Koraidon']);
  assert.equal(nearlyFull.state.p[0].bench.length, 5);

  const full = bench(['Comfey', 'Comfey', 'Comfey', 'Comfey', 'Turtonator']);
  assert.notEqual(full.decision?.kind, 'cards', 'a full Bench: nothing to search for');
});

test('Falinks, All-Out Attack: 90 more damage if it used Form Ranks during your last turn', () => {
  const dk = deck('sv07-088', 'sv07-063', 'sv07-090', TYR);
  const second = (formRanks: boolean): number => {
    const g = game(dk, [{ active: 'Falinks', bench: ['Comfey'], energy: { active: [F, F] } }, { active: 'Tyranitar ex' }]);
    if (formRanks) {
      choose(g, 'Attack: Form Ranks');
      g.submit([]); // find nothing
      endTurn(g);
    } else {
      endTurn(g);
      endTurn(g);
    }
    assert.equal(g.state.current, 0);
    choose(g, 'Attack: All-Out Attack');
    return damageOf(g, 1);
  };
  // "If this Pokémon used Form Ranks during your last turn, this attack does 90 more damage."
  assert.equal(second(true), 120, '30 + 90');
  assert.equal(second(false), 30, 'it did not use Form Ranks last turn');
});

test('Falinks, All-Out Attack: the bonus is a game-state check, kept after retreating and switching back in (ruling 2017)', () => {
  const dk = deck('sv07-088', 'sv07-063', TYR, SWITCH);
  const g = game(dk, [{ active: 'Falinks', bench: ['Comfey'], energy: { active: [F, F, F, F] }, hand: ['Switch'] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Form Ranks');
  g.submit([]);
  endTurn(g);
  // Ruling (Stellar Crown FAQ, TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2017/): "It will do 120, since it's a game state check that the attack was used last turn and not an effect on the Pokemon."
  choose(g, 'Retreat');
  while (g.decision?.kind === 'cards' || (g.decision?.kind as string) === 'slots') {
    if (g.decision!.kind === 'cards') g.submit([0, 1].slice(0, g.decision!.min));
    else g.submit([(g.decision!.values as number[])[0] as number]);
  }
  assert.equal(activeName(g, 0), 'Comfey', 'Falinks retreated');
  choose(g, 'Play Switch');
  while ((g.decision?.kind as string) === 'slots') g.submit([(g.decision!.values as number[])[0] as number]);
  assert.equal(activeName(g, 0), 'Falinks', 'and is back in the Active Spot');
  choose(g, 'Attack: All-Out Attack');
  assert.equal(damageOf(g, 1), 120);
});

// ------------------------------------------------------------------ Koraidon

test("Koraidon, Resolute Fang: 70 more damage if the opponent's Active Pokémon is a Pokémon ex", () => {
  const dk = deck('sv07-090', ...COMMON);
  const hit = (defender: string): number => {
    const g = game(dk, [{ active: 'Koraidon', energy: { active: [FI, FI] } }, { active: defender }]);
    choose(g, 'Attack: Resolute Fang');
    return damageOf(g, 1);
  };
  // "If your opponent's Active Pokémon is a Pokémon ex, this attack does 70 more damage."
  assert.equal(hit('Tyranitar ex'), 120, '50 + 70');
  assert.equal(hit('Turtonator'), 50, 'not an ex');
});

// ------------------------------------------------------------------ Swalot

test("Swalot, Devouring Mouth: 160 more damage if it has more Energy attached than the opponent's Active Pokémon", () => {
  const dk = deck('sv07-092', ...COMMON);
  const hit = (mine: string[], theirs: string[]): number => {
    const g = game(dk, [{ active: 'Swalot', energy: { active: mine } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: theirs } }]);
    choose(g, 'Attack: Devouring Mouth');
    return damageOf(g, 1);
  };
  // "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage."
  assert.equal(hit([D, D], [F]), 170, '2 > 1');
  assert.equal(hit([D], []), 170, '1 > 0');
  assert.equal(hit([D], [F]), 10, 'the same number');
  assert.equal(hit([D], [F, F]), 10, 'fewer');
});

test("Swalot, Venomous Hit: 100 damage and the opponent's Active Pokémon is Poisoned", () => {
  const dk = deck('sv07-092', ...COMMON);
  const g = game(dk, [{ active: 'Swalot', energy: { active: [D, D, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Venomous Hit');
  assert.ok(g.state.p[1].active!.cond & POISONED);
  assert.equal(damageOf(g, 1), 110, '100 + 1 damage counter at Pokémon Checkup');
});

// ------------------------------------------------------------------ Grimmsnarl

test("Grimmsnarl, Goad 'n' Grab: switch out the opponent's Active Pokémon (they choose); 160 damage to the new Active Pokémon", () => {
  const dk = deck('sv07-096', ...COMMON);
  const g = game(dk, [
    { active: 'Grimmsnarl', energy: { active: [F, F] } },
    { active: 'Tyranitar ex', bench: ['Turtonator', 'Bloodmoon Ursaluna ex'] },
  ]);
  choose(g, "Attack: Goad 'n' Grab");
  assert.equal(g.decision?.player, 1, 'the opponent chooses the new Active Pokémon');
  choose(g, 'Bloodmoon Ursaluna ex');
  assert.equal(activeName(g, 1), 'Bloodmoon Ursaluna ex');
  assert.equal(damageOf(g, 1), 160, '"does 160 damage to the new Active Pokémon"');
  assert.equal(damageOf(g, 1, 0), 0, 'the old Active Pokémon took nothing');
  assert.deepEqual(names(g, g.state.p[1].bench.map((b) => b.cards[0] as number)), ['Turtonator', 'Tyranitar ex']);
});

test("Grimmsnarl, Goad 'n' Grab: with no new Active Pokémon (no Bench, or the switch is stopped) there is no damage (ruling 2025)", () => {
  const dk = deck('sv07-096', ...COMMON);
  // Ruling (Stellar Crown FAQ, TPCi Rules Team 2024-09-12, https://compendium.pokegym.net/ruling/2025/): "No, it will not do any damage because there isn't a NEW Active Pokemon."
  const mist = game(dk, [
    { active: 'Grimmsnarl', energy: { active: [F, F] } },
    { active: 'Tyranitar ex', bench: ['Turtonator'], energy: { active: ['Mist Energy'] } },
  ]);
  choose(mist, "Attack: Goad 'n' Grab");
  assert.equal(activeName(mist, 1), 'Tyranitar ex', 'Mist Energy stops the switch');
  assert.equal(damageOf(mist, 1), 0, 'and the Pokémon that stays takes no damage');
  assert.equal(damageOf(mist, 1, 0), 0);

  const lone = game(dk, [{ active: 'Grimmsnarl', energy: { active: [F, F] } }, { active: 'Tyranitar ex' }]);
  choose(lone, "Attack: Goad 'n' Grab");
  assert.equal(damageOf(lone, 1), 0, 'no Benched Pokémon: no switch, no damage');

  // A single Benched Pokémon takes the place with no choice.
  const single = game(dk, [{ active: 'Grimmsnarl', energy: { active: [F, F] } }, { active: 'Tyranitar ex', bench: ['Bloodmoon Ursaluna ex'] }]);
  choose(single, "Attack: Goad 'n' Grab");
  assert.equal(damageOf(single, 1), 160);
});

test('Grimmsnarl, Knuckle Sandwich: 160 damage, then discard 2 Energy from this Pokémon', () => {
  const dk = deck('sv07-096', ...COMMON);
  const g = game(dk, [{ active: 'Grimmsnarl', energy: { active: [D, F, W, L] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Knuckle Sandwich');
  assert.equal(damageOf(g, 1), 160);
  pick(g, [F, W]);
  assert.deepEqual(energyNames(g, 0, 'active'), [D, L].sort());
  assert.deepEqual(names(g, g.state.p[0].discard), [F, W].sort());
});

// ------------------------------------------------------------------ Jirachi

test('Jirachi, Swelling Wish: attach a Basic Energy card from your discard pile to 1 of your Benched Pokémon', () => {
  const dk = deck('sv07-098', 'sv07-063', ...COMMON);
  const g = game(dk, [
    { active: 'Jirachi', bench: ['Comfey', 'Turtonator'], energy: { active: [M] }, discard: [F, W, `Hero's Cape`, 'Boomerang Energy'] },
    { active: 'Tyranitar ex' },
  ]);
  choose(g, 'Attack: Swelling Wish');
  assert.deepEqual(offered(g), [F, W].sort(), 'Basic Energy cards only');
  assert.equal(g.decision?.min, 1);
  pick(g, [W]);
  assert.equal(g.decision?.kind, 'slots');
  choose(g, 'Turtonator');
  assert.deepEqual(energyNames(g, 0, 1), [W]);
  assert.deepEqual(energyNames(g, 0, 0), []);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, `Hero's Cape`, 'Boomerang Energy'].sort());
});

test('Jirachi, Swelling Wish: with no Benched Pokémon nothing is attached', () => {
  const dk = deck('sv07-098', ...COMMON);
  const g = game(dk, [{ active: 'Jirachi', energy: { active: [M] }, discard: [F] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Swelling Wish');
  assert.deepEqual(names(g, g.state.p[0].discard), [F], 'the Energy stays in the discard pile');
  assert.equal(g.state.current, 1);
});

// ------------------------------------------------------------------ Meltan

test('Meltan, Knickknack Carrying: search your deck for a Pokémon Tool card, reveal it and put it into your hand', () => {
  const dk = deck('sv07-103', 'sv06-158', XEROSIC, ...COMMON);
  const g = game(dk, [{ active: 'Meltan', energy: { active: [M] } }, { active: 'Tyranitar ex' }]);
  const before = g.state.p[0].hand.length;
  choose(g, 'Attack: Knickknack Carrying');
  assert.deepEqual(offered(g), [`Hero's Cape`, 'Lucky Helmet'], 'Pokémon Tools only (not the Supporter or the Switch Item)');
  assert.equal(g.decision?.max, 1);
  pick(g, ['Lucky Helmet']);
  assert.deepEqual(names(g, g.state.p[0].hand.slice(before)), ['Lucky Helmet']);
  assert.deepEqual(names(g, g.state.p[0].revealed ?? []), ['Lucky Helmet'], 'it is revealed');
});

// ------------------------------------------------------------------ Melmetal

test("Melmetal, Reforged Axe: discard all Pokémon Tools from this Pokémon first, then 250 damage; with none it does nothing", () => {
  const dk = deck('sv07-104', ...COMMON);
  const use = (tools: string[] | undefined): Game => {
    const g = game(dk, [
      { active: 'Melmetal', energy: { active: [M, F, W] }, tools: tools ? { active: tools } : undefined },
      { active: 'Tyranitar ex', tools: { active: [`Hero's Cape`] } },
    ]);
    choose(g, 'Attack: Reforged Axe');
    return g;
  };
  // "Before doing damage, discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing."
  const withTool = use([`Hero's Cape`]);
  assert.equal(damageOf(withTool, 1), 250);
  assert.equal(withTool.state.p[0].active!.tools.length, 0, 'the Tool is gone');
  assert.deepEqual(names(withTool, withTool.state.p[0].discard), [`Hero's Cape`], 'into its owner\'s discard pile');
  assert.equal(withTool.state.p[1].active!.tools.length, 1, "the opponent's Tool stays");

  const bare = use(undefined);
  assert.equal(damageOf(bare, 1), 0, 'no Tool to discard: does nothing');
});

// ------------------------------------------------------------------ Duraludon

test('Duraludon, Raging Hammer: 10 more damage for each damage counter on this Pokémon', () => {
  const dk = deck('sv07-106', ...COMMON);
  const hit = (damage: number): number => {
    const g = game(dk, [{ active: 'Duraludon', energy: { active: [M, M, F] }, damage: { active: damage } }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Raging Hammer');
    return damageOf(g, 1);
  };
  // "This attack does 10 more damage for each damage counter on this Pokémon."
  assert.equal(hit(0), 80);
  assert.equal(hit(50), 130, '80 + 5 x 10');
  assert.equal(hit(120), 200, '80 + 12 x 10');
});

// ------------------------------------------------------------------ Archaludon

test('Archaludon, Metal Bridge: your Pokémon that have {M} Energy attached have no Retreat Cost', () => {
  const dk = deck('sv07-107', 'sv07-063', ...COMMON);
  const canRetreat = (bench: string[], energy: string[], active = 'Bloodmoon Ursaluna ex'): boolean => {
    const g = game(dk, [{ active, bench, energy: { active: energy } }, { active: 'Tyranitar ex' }]);
    return has(g, 'Retreat');
  };
  // "All of your Pokémon that have {M} Energy attached have no Retreat Cost."
  assert.equal(canRetreat(['Archaludon'], [M]), true, 'Bloodmoon Ursaluna ex (Retreat Cost 3) with {M} Energy attached');
  assert.equal(canRetreat(['Archaludon'], [F]), false, 'no {M} Energy attached: it cannot pay 3');
  assert.equal(canRetreat(['Comfey'], [M]), false, 'without Archaludon in play');
  assert.equal(canRetreat(['Comfey'], [M, M, M]), true, 'sanity: it can pay 3 when it has the Energy');
});

test('Archaludon, Metal Bridge: Archaludon itself retreats for free while it has {M} Energy', () => {
  const dk = deck('sv07-107', 'sv07-063', ...COMMON);
  const metal = game(dk, [{ active: 'Archaludon', bench: ['Comfey'], energy: { active: [M] } }, { active: 'Tyranitar ex' }]);
  assert.ok(has(metal, 'Retreat'));
  choose(metal, 'Retreat');
  assert.equal(metal.decision?.kind, 'cards');
  assert.equal(metal.decision?.min, 0, 'a Retreat Cost of 0: no Energy has to be discarded');
  metal.submit([]);
  assert.equal(activeName(metal, 0), 'Comfey');
  assert.deepEqual(energyNames(metal, 0, 0), [M], 'no Energy was discarded');
  const fire = game(dk, [{ active: 'Archaludon', bench: ['Comfey'], energy: { active: [F] } }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(fire, 'Retreat'), 'a {R} Energy does not make it free (Retreat Cost 2)');
});

test("Archaludon, Iron Blaster: 160 damage; during your next turn this Pokémon can't attack", () => {
  const dk = deck('sv07-107', ...COMMON);
  const g = game(dk, [{ active: 'Archaludon', energy: { active: [M, M, F] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Iron Blaster');
  assert.equal(damageOf(g, 1), 160);
  endTurn(g);
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack:'), "Archaludon can't attack during your next turn");
});

// ------------------------------------------------------------------ Noctowl

test('Noctowl, Jewel Seeker: on evolving, with a Tera Pokémon in play, search for up to 2 Trainer cards, reveal them and put them into your hand', () => {
  const dk = deck('sv07-115', 'sv07-114', OGERPON, XEROSIC, SWITCH, CAPE, TYR, TURTLE);
  const evolve = (bench: string[]): Game => {
    const g = game(dk, [{ active: 'Hoothoot', bench, hand: ['Noctowl'] }, { active: 'Tyranitar ex' }]);
    choose(g, 'Evolve Hoothoot (Active) into Noctowl');
    return g;
  };
  const g = evolve(['Hearthflame Mask Ogerpon ex']);
  yes(g);
  const before = g.state.p[0].hand.length;
  assert.deepEqual(offered(g), [`Hero's Cape`, 'Switch', "Xerosic's Machinations"], 'Trainer cards only');
  assert.equal(g.decision?.min, 1, '"up to 2" on an Ability is 1 to 2');
  assert.equal(g.decision?.max, 2);
  pick(g, ['Switch', "Xerosic's Machinations"]);
  assert.deepEqual(names(g, g.state.p[0].hand.slice(before)), ['Switch', "Xerosic's Machinations"]);
  assert.deepEqual(names(g, g.state.p[0].revealed ?? []), ['Switch', "Xerosic's Machinations"], 'they are revealed');

  // "you may": declining searches for nothing.
  const declined = evolve(['Hearthflame Mask Ogerpon ex']);
  no(declined);
  assert.equal(declined.state.p[0].hand.length, 0);

  // "if you have any Tera Pokémon in play": none in play, no Ability use.
  const none = evolve(['Turtonator']);
  assert.notEqual(none.decision?.kind, 'yesno', 'no Tera Pokémon in play');
  assert.equal(none.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Bouffalant

test("Bouffalant, Boundless Power: 130 damage; during your next turn this Pokémon can't attack", () => {
  const dk = deck('sv07-119', ...COMMON);
  const g = game(dk, [{ active: 'Bouffalant', energy: { active: [F, F, F] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Boundless Power');
  assert.equal(damageOf(g, 1), 130);
  endTurn(g);
  assert.ok(!has(g, 'Attack:'), "can't attack during your next turn");
});

test("Bouffalant, Curly Wall: with another Bouffalant in play, your Basic {C} Pokémon take 60 less damage from the opponent's attacks (no stacking)", () => {
  const dk = deck('sv07-119', 'sv07-067', 'sv07-115', 'sv07-114', 'sv07-063', ...COMMON);
  // Dachsbun ex (Psychic, 130, no Weakness hit on these) attacks the player's Active Pokémon, which wears Hero's Cape.
  const hit = (active: string, bench: string[]): number => {
    const g = game(
      dk,
      [{ active, bench, tools: { active: [`Hero's Cape`] } }, { active: 'Dachsbun ex', energy: { active: [F, F] } }],
      { current: 1 },
    );
    choose(g, 'Attack: Wonder Shine');
    return damageOf(g, 0);
  };
  // "As long as you have at least 1 other Bouffalant in play, all of your Basic {C} Pokémon take 60 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Curly Wall doesn't stack."
  assert.equal(hit('Bouffalant', ['Bouffalant']), 70, '130 - 60');
  assert.equal(hit('Bouffalant', ['Comfey']), 130, 'no other Bouffalant');
  assert.equal(hit('Bouffalant', []), 130, 'alone');
  assert.equal(hit('Bouffalant', ['Bouffalant', 'Bouffalant']), 70, "doesn't stack: still 60 less with three");
  assert.equal(hit('Hoothoot', ['Bouffalant', 'Bouffalant']), 70, 'another Basic {C} Pokémon is covered');
  assert.equal(hit('Noctowl', ['Bouffalant', 'Bouffalant']), 130, 'a Stage 1 {C} Pokémon is not Basic');
  assert.equal(hit('Comfey', ['Bouffalant', 'Bouffalant']), 130, 'a {P} Pokémon is not {C}');
});

// ------------------------------------------------------------------ Tornadus

test('Tornadus, Storm Barrier: 100 damage; during the opponent\'s next turn this Pokémon takes 50 less damage from attacks', () => {
  const dk = deck('sv07-120', 'sv07-067', ...COMMON);
  const g = game(dk, [
    { active: 'Tornadus', energy: { active: [F, F, F] }, tools: { active: [`Hero's Cape`] } },
    { active: 'Dachsbun ex', energy: { active: [F, F] } },
  ]);
  choose(g, 'Attack: Storm Barrier');
  assert.equal(damageOf(g, 1), 100);
  // "During your opponent's next turn, this Pokémon takes 50 less damage from attacks (after applying Weakness and Resistance)."
  choose(g, 'Attack: Wonder Shine');
  assert.equal(damageOf(g, 0), 80, '130 - 50');
});
