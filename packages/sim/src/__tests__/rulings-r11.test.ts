/**
 * Rulings audit, batch 11: official Pokémon Rulings Compendium answers pinned against the simulator, one scenario each.
 * The ruling text itself stays on compendium.pokegym.net (this repository is public); every test carries its URL and a
 * one-line summary in our own words. `REVIEWED` lists the rulings that no scenario in the simulator can pin, with the reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance, legalActions } from '../flow.js';
import type { Game } from '../game.js';
import { energyUnits, retreatCost } from '../query.js';
import { scenario } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { CONFUSED } from '../types.js';
import { fromIds } from './decks.js';

// ----------------------------------------------------------------------------------------------- helpers

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
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const legal = (g: Game, p: 0 | 1 = 0) => legalActions(g.env, g.state, p);
const nameOf = (g: Game, iid: number): string => def(g.ctx, iid).name;
const names = (g: Game, iids: number[]): string[] => iids.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const activeName = (g: Game, p: 0 | 1): string => nameOf(g, topCard(g.state.p[p].active!));
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}
/** Answer a slot decision with the Pokémon whose slot id this is. */
function pickSlot(g: Game, id: number): void {
  const i = (g.decision!.values as number[]).indexOf(id);
  assert.ok(i >= 0, `slot ${id} is not offered: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
/** Put a Stadium card from a player's deck into play (as if that player had played it). */
function stadium(g: Game, name: string, owner: 0 | 1): void {
  const deck = g.state.p[owner].deck;
  const i = deck.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in the deck`);
  g.state.stadium = { card: deck.splice(i, 1)[0] as number, owner };
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 12]);
const IDS = [
  'me05-074', // Backtrack Badge
  'me01-104', // Mega Kangaskhan ex
  'me01-112', // Bewear
  'me04-022', // Mega Greninja ex
  'sv06-128', // Dreepy: Basic Dragon, 70 HP, no Weakness
  'sv06-129', // Drakloak
  'sv06-130', // Dragapult ex: a neutral 320-HP Tera target, Jet Headbutt {C} 70
  'me05-047', // Koraidon (Battle Claw)
  'me02.5-145', // Registeel ex
  'me01-028', // Cinderace
  'me05-038', // Mega Chandelure ex
  'me05-029', // Slowpoke: Retreat 2
  'me03-047', // Mega Zygarde ex
  'sv08.5-064', // Tyranitar ex
  'sv05-104', // Gengar ex
  'me01-086', // Mega Absol ex
  'sv06-025', // Teal Mask Ogerpon ex
  'me01-008', // Chikorita
  'me01-009', // Bayleef
  'me01-010', // Meganium
  'me02.5-197', // Nighttime Mine
  'me02-080', // Smeargle
  'me01-003', // Mega Venusaur ex
  'me01-012', // Celebi
  'sv06-167', // Legacy Energy
  'sv10-072', // Team Rocket's Mareep
  'sv10-073', // Team Rocket's Flaaffy
  'sv10-074', // Team Rocket's Ampharos
  'sv05-078', // Flutter Mane
  'sv06-149', // Festival Grounds
  'sv06-018', // Dipplin
  'sv08-043', // Spheal
  'sv08-045', // Walrein
  'me01-114', // Boss's Orders
  'sv07-014', // Hydrapple ex
  'sv06-059', // Finizen
  'sv06-060', // Palafin
  'sv06-061', // Palafin ex
  'me01-130', // Switch
  'sv06-145', // Carmine
  'sv05-112', // Mawile
  'sv08-076', // Latias ex
  'sv06-134', // Blissey ex
  'sv07-036', // Lumineon
  'sv10.5b-074', // Audino
  '30th-085', // Lycanroc
  'sv05-099', // Iron Boulder ex (Repulsor Axe)
  'me04-030', // Emolga (Sky Return)
];
const DK = fromIds('rulings-r11', [...IDS.map((id): [string, number] => [id, 4]), ...ENERGY]);

const FIR = 'Fire Energy';
const GRS = 'Grass Energy';
const WTR = 'Water Energy';
const LGT = 'Lightning Energy';
const PSY = 'Psychic Energy';
const FGT = 'Fighting Energy';
const DRK = 'Darkness Energy';
const MTL = 'Metal Energy';

// ----------------------------------------------------------------------------------------------- Backtrack Badge

// https://compendium.pokegym.net/ruling/2417/ : Backtrack Badge re-flips only the attack's own coins, never the Confusion check.
test('Backtrack Badge is not used for the Confusion flip, only for the flips of the attack (https://compendium.pokegym.net/ruling/2417/)', () => {
  const g = scenario(DK, DK, [
    { active: 'Mega Kangaskhan ex', energy: { active: [FIR, FIR, FIR] }, tools: { active: ['Backtrack Badge'] }, cond: CONFUSED },
    { active: 'Mega Greninja ex' },
  ]);
  // Confusion's flip (heads: the attack goes on), then the attack's own flips (tails at once: 0 heads), then the re-flip of the attack's flips only.
  g.state.forcedCoins = [true, false, true, false, true];
  choose(g, 'Attack: Rapid-Fire Combo');
  assert.equal(g.decision!.kind, 'yesno', "the Tool is offered after the attack's flips, not after Confusion's");
  assert.equal(g.state.forcedCoins.length, 3, "Confusion's coin and the attack's one were flipped, nothing else");
  g.submit([0]);
  assert.equal(g.state.forcedCoins.length, 1, "only the attack's flips were flipped again (heads, tails): Confusion's coin was not");
  assert.equal(dmg(g, 1), 200 + 50, 'one heads on the second try');
});

// https://compendium.pokegym.net/ruling/2416/ : Backtrack Badge re-flips every coin of the attack, not just the tails.
test('Backtrack Badge flips all of the attack\'s coins again, never only the tails (https://compendium.pokegym.net/ruling/2416/)', () => {
  const g = scenario(DK, DK, [
    { active: 'Bewear', energy: { active: [FIR, FIR, FIR] }, tools: { active: ['Backtrack Badge'] } },
    { active: 'Mega Greninja ex' },
  ]);
  // Hyper Lariat: this attack flips 2 coins; if both are heads it does 100 additional damage. First try: heads, tails.
  g.state.forcedCoins = [true, false, true, true];
  choose(g, 'Attack: Hyper Lariat');
  yes(g);
  assert.equal(dmg(g, 1), 100 + 100, 'both coins were flipped again: the first try\'s heads did not stay');
  assert.equal(g.state.forcedCoins.length, 0, 'four coins in all');
});

// ----------------------------------------------------------------------------------------------- Koraidon / Cinderace

// https://compendium.pokegym.net/ruling/2394/ : a Cinderace put into play from the starting hand is still an Evolution Pokemon for Battle Claw.
test('Koraidon, Battle Claw: the bonus applies to a lone Cinderace put in play without evolving (https://compendium.pokegym.net/ruling/2394/)', () => {
  const basic = scenario(DK, DK, [{ active: 'Koraidon', energy: { active: [FGT] } }, { active: 'Registeel ex' }]);
  choose(basic, 'Attack: Battle Claw');
  assert.equal(dmg(basic, 1), 30, 'a Basic Pokémon: no bonus');
  const evo = scenario(DK, DK, [{ active: 'Koraidon', energy: { active: [FGT] } }, { active: 'Cinderace' }]);
  assert.equal(evo.state.p[1].active!.cards.length, 1, 'Cinderace alone, as after Explosiveness: it never evolved');
  choose(evo, 'Attack: Battle Claw');
  assert.equal(dmg(evo, 1), 60, 'still an Evolution Pokémon: +30');
});

// ----------------------------------------------------------------------------------------------- Mega Chandelure ex

// https://compendium.pokegym.net/ruling/2392/ : Binding Flame stacks, so two Mega Chandelure ex add {C}{C}.
test('Mega Chandelure ex, Binding Flame stacks: two copies make the Retreat Cost {C}{C} more (https://compendium.pokegym.net/ruling/2392/)', () => {
  const one = scenario(DK, DK, [{ active: 'Slowpoke', bench: ['Mega Chandelure ex'] }, { active: 'Slowpoke' }]);
  assert.equal(retreatCost(one.envForInternals, one.state, one.state.p[1].active!), 3, 'Slowpoke Retreat 2, plus 1');
  const two = scenario(DK, DK, [{ active: 'Mega Chandelure ex', bench: ['Mega Chandelure ex'] }, { active: 'Slowpoke' }]);
  assert.equal(retreatCost(two.envForInternals, two.state, two.state.p[1].active!), 4, 'two Binding Flames: Retreat 2, plus 2');
  // The attack counts the extra {C} too: 130 + 50 per {C}.
  const hit = (chandelures: number): number => {
    const g = scenario(DK, DK, [
      { active: 'Mega Chandelure ex', energy: { active: [PSY, PSY] }, bench: chandelures === 2 ? ['Mega Chandelure ex'] : ['Dreepy'] },
      { active: 'Dragapult ex' },
    ]);
    choose(g, 'Attack: Phantom Maze');
    return dmg(g, 1);
  };
  const base = hit(1);
  assert.equal(hit(2) - base, 50, 'the second Binding Flame adds one more {C}: 50 more damage');
});

// ----------------------------------------------------------------------------------------------- Mega Zygarde ex

// https://compendium.pokegym.net/ruling/2316/ : Nullifying Zero flips one coin per opposing Pokemon, Tera ones included.
test('Mega Zygarde ex, Nullifying Zero: a coin for each of the opponent\'s Pokémon, Tera Benched ones too (https://compendium.pokegym.net/ruling/2316/)', () => {
  const run = (coins: boolean[], bench: string[]): Game => {
    const g = scenario(DK, DK, [{ active: 'Mega Zygarde ex', energy: { active: [FGT, FGT, FGT, FGT, FGT] } }, { active: 'Tyranitar ex', bench }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Nullifying Zero');
    return g;
  };
  // Active, then the Bench in order: heads, heads (Gengar ex, weak to Fighting), heads (Dragapult ex, Tera), tails (Mega Absol ex).
  const g = run([true, true, true, false], ['Gengar ex', 'Dragapult ex', 'Mega Absol ex']);
  assert.equal(g.state.forcedCoins.length, 0, 'four Pokémon in play, four coins: the Tera Pokémon too');
  assert.equal(dmg(g, 1), 150, 'the Active Pokémon');
  const b = g.state.p[1].bench;
  assert.equal(b[0]!.damage, 150, 'Gengar ex is weak to Fighting, but not on the Bench');
  assert.equal(b[1]!.damage, 0, "a Tera Pokémon can't be damaged on the Bench, though its coin was flipped");
  assert.equal(b[2]!.damage, 0, 'tails: nothing');
  const h = run([false, false, true], ['Gengar ex', 'Mega Absol ex']);
  assert.equal(dmg(h, 1), 0, 'tails on the Active Pokémon, whatever the Bench does');
  assert.equal(h.state.p[1].bench[0]!.damage, 0);
  assert.equal(h.state.p[1].bench[1]!.damage, 150);
});

// ----------------------------------------------------------------------------------------------- Meganium / Teal Mask Ogerpon ex

function ogerpon(wild: boolean, energy: string[]): Game {
  return scenario(DK, DK, [
    { active: 'Teal Mask Ogerpon ex', energy: { active: energy }, bench: ['Chikorita'], ...(wild ? { evolve: { 0: ['Bayleef', 'Meganium'] } } : {}) },
    { active: 'Mega Greninja ex' },
  ]);
}

// https://compendium.pokegym.net/ruling/2237/ : Energy a replacement like Wild Growth adds counts as attached, so Myriad Leaf Shower adds 180 with 3 Basic {G}.
test('Teal Mask Ogerpon ex, Myriad Leaf Shower: Wild Growth\'s extra Energy counts as attached, 3 Basic {G} is +180 (https://compendium.pokegym.net/ruling/2237/)', () => {
  const g = ogerpon(true, [GRS, GRS, GRS]);
  choose(g, 'Attack: Myriad Leaf Shower');
  assert.equal(dmg(g, 1), 30 + 180);
  const bare = ogerpon(false, [GRS, GRS, GRS]);
  choose(bare, 'Attack: Myriad Leaf Shower');
  assert.equal(dmg(bare, 1), 30 + 90, 'without Wild Growth, +90');
});

// https://compendium.pokegym.net/ruling/2288/ : under Nighttime Mine, 2 Basic {G} count as 4 with Wild Growth, which pays Myriad Leaf Shower's raised cost.
test('Teal Mask Ogerpon ex under Nighttime Mine: 2 Basic {G} Energy count as 4 with Wild Growth and pay for Myriad Leaf Shower (https://compendium.pokegym.net/ruling/2288/)', () => {
  const mine = (wild: boolean): Game => {
    const g = ogerpon(wild, [GRS, GRS]);
    stadium(g, 'Nighttime Mine', 0);
    refresh(g);
    return g;
  };
  assert.ok(has(mine(true), 'Attack: Myriad Leaf Shower'), 'with Wild Growth the cost of 4 is paid by 4 Energy');
  assert.ok(!has(mine(false), 'Attack: Myriad Leaf Shower'), 'without Wild Growth 2 Energy do not pay 4');
  const m = mine(true);
  assert.equal(energyUnits(m.env, m.state.p[0].active!, m.state).length, 4);
});

// ----------------------------------------------------------------------------------------------- Smeargle

// https://compendium.pokegym.net/ruling/2251/ : with heads on Energizing Sketch you may still choose to attach nothing.
test('Smeargle, Energizing Sketch: with heads you may attach no Energy at all (https://compendium.pokegym.net/ruling/2251/)', () => {
  const g = scenario(DK, DK, [{ active: 'Smeargle', bench: ['Slowpoke'], energy: { active: [FIR] }, discard: [FIR, WTR] }, { active: 'Dragapult ex' }]);
  g.state.forcedCoins = [true, true, true];
  choose(g, 'Attack: Energizing Sketch');
  g.submit([]);
  assert.deepEqual(energyNames(g, 0, 0), [], 'declined: nothing attached');
  assert.equal(g.state.p[0].discard.length, 2, 'both Energy cards stay in the discard pile');
  const takes = scenario(DK, DK, [{ active: 'Smeargle', bench: ['Slowpoke'], energy: { active: [FIR] }, discard: [FIR, WTR] }, { active: 'Dragapult ex' }]);
  takes.state.forcedCoins = [true, false, false];
  choose(takes, 'Attack: Energizing Sketch');
  pick(takes, [FIR]);
  assert.deepEqual(energyNames(takes, 0, 0), [FIR], 'the same attack does attach when the player wants it');
});

// ----------------------------------------------------------------------------------------------- Mega Venusaur ex

// https://compendium.pokegym.net/ruling/2216/ : Solar Transfer moves Basic {G} Energy only, never a Special Energy that provides {G}.
test('Mega Venusaur ex, Solar Transfer: a Special Energy providing {G} cannot be moved (https://compendium.pokegym.net/ruling/2216/)', () => {
  const special = scenario(DK, DK, [{ active: 'Mega Venusaur ex', bench: ['Celebi'], energy: { active: ['Legacy Energy'] } }, { active: 'Dragapult ex' }]);
  assert.ok(!has(special, 'Solar Transfer'), 'the only Energy that could provide {G} is a Special Energy: the Ability is not offered');
  const basic = scenario(DK, DK, [{ active: 'Mega Venusaur ex', bench: ['Celebi'], energy: { active: [GRS] } }, { active: 'Dragapult ex' }]);
  assert.ok(has(basic, 'Solar Transfer'), 'with a Basic {G} Energy it is');
  const both = scenario(DK, DK, [{ active: 'Mega Venusaur ex', bench: ['Celebi'], energy: { active: ['Legacy Energy', GRS] } }, { active: 'Dragapult ex' }]);
  choose(both, 'Solar Transfer');
  assert.deepEqual(energyNames(both, 0, 0), [GRS], 'the Basic Energy moved');
  assert.deepEqual(energyNames(both, 0, 'active'), ['Legacy Energy'], 'the Special Energy stayed');
});

// ----------------------------------------------------------------------------------------------- Team Rocket's Ampharos

// https://compendium.pokegym.net/ruling/2145/ : Darkest Impulse puts 4 counters on each of two Pokemon evolved in one turn; the restriction blocks only a second Ampharos.
test("Team Rocket's Ampharos, Darkest Impulse: both Pokémon the opponent evolves in a turn get 4 counters; two Ampharos don't double it (https://compendium.pokegym.net/ruling/2145/)", () => {
  const mk = (ampharos: number): Game => {
    const g = scenario(
      DK,
      DK,
      [
        { active: "Team Rocket's Mareep", evolve: { active: ["Team Rocket's Flaaffy", "Team Rocket's Ampharos"] }, bench: ["Team Rocket's Mareep"] },
        { active: 'Dreepy', bench: ['Dreepy'], hand: ['Drakloak', 'Drakloak'] },
      ],
      { turn: 4, current: 1, first: 0 },
    );
    if (ampharos === 2) {
      const deck = g.state.p[0].deck;
      for (const n of ["Team Rocket's Flaaffy", "Team Rocket's Ampharos"]) g.state.p[0].bench[0]!.cards.push(deck.splice(deck.findIndex((c) => nameOf(g, c) === n), 1)[0]!);
    }
    for (const sl of [g.state.p[1].active!, g.state.p[1].bench[0]!]) sl.enteredTurn = 0;
    refresh(g);
    return g;
  };
  const g = mk(1);
  choose(g, 'Evolve Dreepy (Active)');
  assert.equal(dmg(g, 1), 40, 'first evolution: 4 counters');
  choose(g, 'Evolve Dreepy');
  assert.equal(g.state.p[1].bench[0]!.damage, 40, 'second evolution the same turn: 4 counters as well');
  const two = mk(2);
  choose(two, 'Evolve Dreepy (Active)');
  assert.equal(dmg(two, 1), 40, 'two Ampharos in play: still 4, not 8');
});

// ----------------------------------------------------------------------------------------------- Festival Lead / Midnight Fluttering

// https://compendium.pokegym.net/ruling/2093/ : once Dipplin's attack Knocks Out the Flutter Mane, Festival Lead works again and a second attack is allowed.
test('Dipplin, Festival Lead: with Festival Grounds in play, after it Knocks Out the Flutter Mane that switched Abilities off, it may attack again (https://compendium.pokegym.net/ruling/2093/)', () => {
  const mk = (damage: number): Game => {
    const g = scenario(DK, DK, [
      { active: 'Dipplin', bench: ['Dreepy', 'Dreepy'], energy: { active: [GRS] } },
      { active: 'Flutter Mane', bench: ['Dreepy'], damage: { active: damage } },
    ]);
    stadium(g, 'Festival Grounds', 1);
    refresh(g);
    return g;
  };
  const kill = mk(60);
  choose(kill, 'Attack: Do the Wave'); // 20 for each of its 2 Benched Pokémon: 40 more on a Flutter Mane with 60 damage and 90 HP: Knocked Out
  assert.equal(activeName(kill, 1), 'Dreepy', 'its only Benched Pokémon came up');
  assert.deepEqual(labels(kill), ['Attack: Do the Wave', 'End turn'], 'Festival Lead works again: a second attack is offered');
  const stay = mk(0);
  choose(stay, 'Attack: Do the Wave');
  assert.equal(stay.state.current, 1, 'Flutter Mane is still there switching Festival Lead off: no second attack');
});

// ----------------------------------------------------------------------------------------------- Walrein

// https://compendium.pokegym.net/ruling/2055/ : Frigid Fangs' lock belongs to the opponent's Pokemon, so it lasts after Walrein goes to the Bench.
test('Walrein, Frigid Fangs: the attack lock stays on the opponent\'s Pokémon after Walrein moves to the Bench (https://compendium.pokegym.net/ruling/2055/)', () => {
  const mk = (): Game => {
    const g = scenario(DK, DK, [
      { active: 'Spheal', evolve: { active: ['Walrein'] }, energy: { active: [WTR] }, bench: ['Chikorita'] },
      { active: 'Dreepy', energy: { active: [FIR, PSY] }, hand: ["Boss's Orders"] },
    ]);
    choose(g, 'Attack: Frigid Fangs');
    return g;
  };
  const g = mk();
  assert.equal(g.state.current, 1);
  assert.ok(!legal(g, 1).some((a) => a.t === 'attack'), '2 Energy attached: it can\'t attack');
  choose(g, "Play Boss's Orders");
  if (g.decision!.kind === 'slots') pickSlot(g, g.state.p[0].bench[0]!.id);
  assert.equal(nameOf(g, g.state.p[0].bench[0]!.cards[0]!), 'Spheal', 'Walrein was moved to the Bench');
  assert.ok(!legal(g, 1).some((a) => a.t === 'attack'), 'still can\'t attack with Walrein on the Bench');
});

// ----------------------------------------------------------------------------------------------- Hydrapple ex / Teal Mask Ogerpon ex

// https://compendium.pokegym.net/ruling/2013/ : Ripening Charge attaching to Ogerpon does not also draw for Teal Dance; each Ability is used on its own.
test('Hydrapple ex, Ripening Charge on Teal Mask Ogerpon ex does not also draw a card for Teal Dance (https://compendium.pokegym.net/ruling/2013/)', () => {
  const g = scenario(DK, DK, [
    { active: 'Teal Mask Ogerpon ex', bench: ['Hydrapple ex'], hand: [GRS, GRS, 'Dreepy'], damage: { active: 60 } },
    { active: 'Dragapult ex' },
  ]);
  const hand = g.state.p[0].hand.length;
  const deck = g.state.p[0].deck.length;
  choose(g, 'Use Ripening Charge');
  while (g.decision && g.decision.kind !== 'main') {
    const d = g.decision;
    if (d.kind === 'slots') pickSlot(g, g.state.p[0].active!.id);
    else g.submit([0]);
  }
  assert.deepEqual(energyNames(g, 0, 'active'), [GRS], 'the Energy went onto Ogerpon');
  assert.equal(g.state.p[0].active!.damage, 30, 'Ripening Charge healed 30');
  assert.equal(g.state.p[0].hand.length, hand - 1, 'only the Energy left the hand: no card drawn');
  assert.equal(g.state.p[0].deck.length, deck, 'the deck is untouched');
  // Teal Dance is a separate Ability still available this turn, and it does draw.
  assert.ok(has(g, 'Teal Dance'), 'Teal Dance is still usable on its own');
  choose(g, 'Use Teal Dance');
  while (g.decision && g.decision.kind !== 'main') g.submit([0]);
  assert.equal(g.state.p[0].hand.length, hand - 1 - 1 + 1, 'Teal Dance: one Energy attached, one card drawn');
  assert.equal(g.state.p[0].deck.length, deck - 1);
});

// ----------------------------------------------------------------------------------------------- Palafin / Flutter Mane

// https://compendium.pokegym.net/ruling/2007/ : Zero to Hero triggers once Palafin is on the Bench, so Midnight Fluttering does not stop it.
test('Palafin, Zero to Hero is not blocked by Midnight Fluttering when Palafin is switched to the Bench (https://compendium.pokegym.net/ruling/2007/)', () => {
  const g = scenario(DK, DK, [
    { active: 'Finizen', evolve: { active: ['Palafin'] }, bench: ['Dreepy'], hand: ['Switch'] },
    { active: 'Flutter Mane' },
  ]);
  choose(g, 'Play Switch');
  assert.equal(g.decision!.kind, 'yesno', 'Zero to Hero is offered even though Flutter Mane\'s Ability is in play');
  g.submit([0]);
  assert.equal(g.decision!.kind, 'cards');
  assert.deepEqual([...new Set(labels(g))], ['Palafin ex'], 'a Palafin ex from the deck');
  g.submit([0]);
  const moved = g.state.p[0].bench.find((b) => names(g, b.cards).includes('Palafin ex'));
  assert.ok(moved, 'the Palafin ex is now on the Bench');
  assert.deepEqual(names(g, moved!.cards), ['Finizen', 'Palafin ex']);
});

// ----------------------------------------------------------------------------------------------- Carmine

// https://compendium.pokegym.net/ruling/1987/ : Carmine's first-turn permission is an extra, so it can be played on any turn.
test('Carmine can be played on any turn, not only on the first (https://compendium.pokegym.net/ruling/1987/)', () => {
  const later = scenario(DK, DK, [{ active: 'Dreepy', hand: ['Carmine', 'Dreepy', 'Switch'] }, { active: 'Dragapult ex' }], { turn: 5 });
  assert.ok(has(later, 'Play Carmine'), 'turn 5, going first: playable');
  choose(later, 'Play Carmine');
  assert.equal(later.state.p[0].hand.length, 5, 'the hand was discarded and 5 cards drawn');
  assert.deepEqual(names(later, later.state.p[0].discard), ['Carmine', 'Dreepy', 'Switch']);
  const other = scenario(DK, DK, [{ active: 'Dragapult ex' }, { active: 'Dreepy', hand: ['Carmine', 'Dreepy'] }], { turn: 4, current: 1, first: 0 });
  assert.ok(has(other, 'Play Carmine'), 'the second player on a later turn: playable');
});

// ----------------------------------------------------------------------------------------------- Mawile

// https://compendium.pokegym.net/ruling/1956/ : Invite and Strike hits only the new Active Pokemon, so with no Bench to switch in there is no damage.
test('Mawile, Invite and Strike: no Benched Pokémon means no switch and no damage (https://compendium.pokegym.net/ruling/1956/)', () => {
  const alone = scenario(DK, DK, [{ active: 'Mawile', energy: { active: [MTL, MTL] } }, { active: 'Latias ex' }]);
  choose(alone, 'Attack: Invite and Strike');
  assert.equal(dmg(alone, 1), 0);
  const benched = scenario(DK, DK, [{ active: 'Mawile', energy: { active: [MTL, MTL] } }, { active: 'Latias ex', bench: ['Dreepy'] }]);
  choose(benched, 'Attack: Invite and Strike'); // the only Benched Pokémon is switched in without a question
  assert.equal(activeName(benched, 1), 'Dreepy');
  assert.equal(dmg(benched, 1), 30, 'with a switch, the new Active Pokémon takes 30');
});

// ----------------------------------------------------------------------------------------------- Return

const RETURN_USERS: [string, string[], number][] = [
  ['Lumineon', [WTR, WTR], 20],
  ['Audino', [PSY, PSY], 30],
  ['Blissey ex', [PSY, PSY, PSY], 180],
];

// https://compendium.pokegym.net/ruling/573/ : on Return attacks you may draw nothing, but if you draw you finish at exactly the stated hand size.
// (Written for the five-card printings; Lumineon, Audino and Blissey ex say six, so six is the number here.)
test('Return (Lumineon, Audino, Blissey ex): drawing is optional, and if you draw you end at exactly six cards (https://compendium.pokegym.net/ruling/573/)', () => {
  for (const [who, energy, base] of RETURN_USERS) {
    const mk = (hand: string[]): Game => scenario(DK, DK, [{ active: who, energy: { active: energy }, hand }, { active: 'Dragapult ex' }]);
    const decline = mk([FIR, FIR]);
    choose(decline, 'Attack: Return');
    assert.equal(decline.decision!.kind, 'yesno', `${who}: asked`);
    no(decline);
    assert.equal(decline.state.p[0].hand.length, 2, `${who}: drew nothing`);
    const draw = mk([FIR, FIR]);
    choose(draw, 'Attack: Return');
    yes(draw);
    assert.equal(draw.state.p[0].hand.length, 6, `${who}: exactly six, no more no fewer`);
    assert.equal(dmg(draw, 1), base, `${who}: the damage was done`);
  }
});

// https://compendium.pokegym.net/ruling/572/ : with the target hand size already reached or passed, Return still does its damage and draws nothing.
test('Return (Lumineon, Audino, Blissey ex): with 6 or more cards in hand it just does its damage (https://compendium.pokegym.net/ruling/572/)', () => {
  for (const [who, energy, base] of RETURN_USERS) {
    const six = scenario(DK, DK, [{ active: who, energy: { active: energy }, hand: Array(6).fill(FIR) }, { active: 'Dragapult ex' }]);
    choose(six, 'Attack: Return');
    assert.equal(six.decision!.kind, 'main', `${who}: not even asked`);
    assert.equal(six.state.p[0].hand.length, 6, `${who}: hand unchanged`);
    assert.equal(dmg(six, 1), base, `${who}: base damage`);
    const eight = scenario(DK, DK, [{ active: who, energy: { active: energy }, hand: Array(8).fill(FIR) }, { active: 'Dragapult ex' }]);
    choose(eight, 'Attack: Return');
    assert.equal(eight.state.p[0].hand.length, 8, `${who}: no cards discarded, none drawn`);
    assert.equal(dmg(eight, 1), base);
  }
});

// ----------------------------------------------------------------------------------------------- Lycanroc

// https://compendium.pokegym.net/ruling/384/ : Counter looks at whether the Pokemon was damaged last turn, wherever it has moved since.
test('Lycanroc, Counter: still adds the attack damage it took last turn after Lycanroc went to the Bench and came back (https://compendium.pokegym.net/ruling/384/)', () => {
  const g = scenario(
    DK,
    DK,
    [
      { active: 'Lycanroc', bench: ['Dreepy'], energy: { active: [FGT] }, hand: ['Switch', 'Switch'] },
      { active: 'Dragapult ex', energy: { active: [PSY] } },
    ],
    { turn: 4, current: 1, first: 0 },
  );
  choose(g, 'Attack: Jet Headbutt');
  const taken = g.state.p[0].active!.damage;
  assert.ok(taken > 0, 'Lycanroc was damaged by the attack');
  const lycanroc = g.state.p[0].active!.id;
  choose(g, 'Play Switch'); // Dreepy up, Lycanroc to the Bench
  if (g.decision!.kind !== 'main') pickSlot(g, g.state.p[0].bench[0]!.id);
  assert.equal(activeName(g, 0), 'Dreepy', 'Lycanroc is on the Bench');
  choose(g, 'Play Switch'); // and back
  if (g.decision!.kind !== 'main') pickSlot(g, lycanroc);
  assert.equal(g.state.p[0].active!.id, lycanroc, 'Lycanroc is Active again');
  choose(g, 'Attack: Counter');
  assert.equal(dmg(g, 1), 10 + taken, 'the damage it took last turn is added although it left and returned');
});

// https://compendium.pokegym.net/ruling/588/ : an attack that puts its user into the hand (Sky Return) does so before delayed damage-counter effects on the attacking Pokémon (Repulsor Axe, standing in for the older Shell Trap) are applied, so no counters are placed.
test('Sky Return: Emolga goes to the hand with its Energy before Repulsor Axe puts counters on it, and nothing else gets them (https://compendium.pokegym.net/ruling/588/)', () => {
  // Emolga (Weak to Fighting) cannot survive Iron Boulder ex's own hit, so Dreepy takes it and then retreats for Emolga.
  const g = scenario(DK, DK, [
    { active: 'Iron Boulder ex', energy: { active: [FGT, FGT, FGT] } },
    { active: 'Dreepy', energy: { active: [LGT], 0: [LGT] }, bench: ['Emolga', 'Dragapult ex'] },
  ], { events: true });
  choose(g, 'Attack: Repulsor Axe');
  assert.equal(dmg(g, 1), 60);
  assert.equal(g.state.effects.filter((e) => e.static.k === 'react').length, 1, 'the delayed counters are established on Iron Boulder ex');
  choose(g, 'Retreat');
  choose(g, 'Emolga');
  assert.equal(activeName(g, 1), 'Emolga');
  const emolga = g.state.p[1].active!.id;
  const mark = g.events.length;
  choose(g, 'Attack: Sky Return');
  // Sequencing: no placement of damage counters targets Emolga's slot while it is still in play (or at all afterwards).
  const placed = g.events.slice(mark).filter((e) => e.type === 'counters');
  assert.ok(!placed.some((e) => (e as { slot: number }).slot === emolga), 'no damage counters were placed on Emolga');
  assert.equal(dmg(g, 0), 30, 'the 30 damage was done');
  const hand = names(g, g.state.p[1].hand);
  assert.ok(hand.includes('Emolga'), 'Emolga is in the hand');
  assert.ok(hand.includes(LGT), 'with its attached Energy');
  assert.ok(!g.state.p[1].bench.some((b) => b && nameOf(g, topCard(b)) === 'Emolga'), 'and no longer in play');
  const left = g.state.p[1].bench.filter((b) => b).map((b) => b!.damage);
  assert.ok(left.every((d) => d === 0 || d === 60), `no Pokémon in play took the 8 damage counters (damage: ${left})`);
  if (g.state.p[1].active) assert.ok(![80, 140].includes(g.state.p[1].active.damage), 'nor did a new Active Pokémon');
});

// Control for the test above: the same reaction does put its 8 counters on an attacker that stays in play.
test('Repulsor Axe: an attacker that stays in play does get the 8 damage counters (the control case for Sky Return, ruling 588)', () => {
  const g = scenario(DK, DK, [
    { active: 'Iron Boulder ex', energy: { active: [FGT, FGT, FGT] } },
    { active: 'Dragapult ex', energy: { active: [PSY] } },
  ], { events: true });
  choose(g, 'Attack: Repulsor Axe');
  const attacker = g.state.p[1].active!.id;
  const before = dmg(g, 1);
  const mark = g.events.length;
  choose(g, 'Attack: Jet Headbutt');
  const placed = g.events.slice(mark).filter((e) => e.type === 'counters' && (e as { slot: number }).slot === attacker);
  assert.equal(placed.length, 1, 'the reaction placed counters on the attacker once');
  assert.equal((placed[0] as { n: number }).n, 8);
  assert.equal(dmg(g, 1), before + 80, 'the attacker has 8 more damage counters');
});

// ----------------------------------------------------------------------------------------------- Not testable in the simulator

const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #1488',
    why: 'different text: the erratum fixes the Retreat Cost of the Sword & Shield Cinderace (36/202); the scripted Cinderace (me01-028) is the Mega Evolution series Stage 2 with its own printed Retreat Cost of none, a different card of the same name.',
  },
  {
    ruling: 'Compendium #1073',
    why: 'outside the game: a deck-building restriction (Lysandre and Boss\'s Orders may not share a deck); the simulator has no deck legality check (check_deck in the API owns it) and Lysandre is not in the frame snapshot.',
  },
];

test('every REVIEWED ruling is in the Compendium index', () => {
  const index = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number }[] };
  const ids = new Set(index.rulings.map((r) => r.id));
  for (const { ruling, why } of REVIEWED) {
    const id = Number(/#(\d+)/.exec(ruling)![1]);
    assert.ok(ids.has(id), `${ruling} is not in data/rulings-compendium.json`);
    assert.ok(why.length > 20, `${ruling}: give a reason`);
  }
});
