/**
 * Card tests, batch "std-c11": every card scripted in cards/scripts/std-c11.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { retreatCost } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot, topCard } from '../state.js';
import { CUSTOMS } from '../customs.js';
import type { CardFrame, Decision, Frame } from '../types.js';
import { ASLEEP, BURNED, CONFUSED } from '../types.js';
import type { StaticEffect } from '../dsl.js';
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
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function benchNames(g: Game, p: 0 | 1): string[] {
  return g.state.p[p].bench.map((b) => name(g, topCard(b)));
}
function activeName(g: Game, p: 0 | 1): string {
  return name(g, topCard(g.state.p[p].active!));
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** Put an effect on a Pokémon, as if an attack had left it there (lasts through the next turn). */
function inject(g: Game, slotId: number, st: StaticEffect): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack: true, src: 0 });
}
/** Put these cards (by name) at the bottom of a player's deck, bottom first. */
function setBottom(g: Game, p: 0 | 1, ns: string[]): void {
  const deck = g.state.p[p].deck;
  const taken = ns.map((n) => {
    const i = deck.findIndex((c) => name(g, c) === n);
    assert.ok(i >= 0, `no ${n} left in the deck`);
    return deck.splice(i, 1)[0] as number;
  });
  deck.unshift(...taken);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card (or the count given) plus plenty of every basic Energy. */
function deck(ids: string[], counts: Record<string, number> = {}): DeckInput {
  return fromIds('c11', [...[...new Set(ids)].map((id): [string, number] => [id, counts[id] ?? 4]), ...ENERGY]);
}

const TROPIUS = 'me05-001';
const HEATRAN = 'me05-007';
const DELPHOX = 'me05-008';
const BRAIXEN = 'me04-012';
const SIZZLIPEDE = 'me05-009';
const ARMAROUGE = 'me05-012';
const SEAKING = 'me05-014';
const WAILORD = 'me05-016';
const RELICANTH = 'me05-017';
const PRIMARINA = 'me05-020';
const PALAFIN = 'me05-022';
const MANECTRIC = 'me05-024';
const VIKAVOLT = 'me05-026';
const ZERAORA = 'me05-027';
const SPIRITOMB = 'me05-035';
const LAMPENT = 'me05-037';
const CHANDELURE = 'me05-038';
const CRANIDOS = 'me05-044';
const RAMPARDOS = 'me05-045';
const MANDIBUZZ = 'me05-050';
const SLO = 'me05-029'; // Slowpoke: Basic, 70 HP, Psychic, Retreat 2, Headbutt {C}{C} 20
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting, Retreat 3
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass, Retreat 3
const SHUPPET = 'me05-033'; // Hide 'n' Sneak
const FOSSIL = 'me05-072'; // Antique Armor Fossil
const BOOMERANG = 'sv06-166'; // Boomerang Energy (a Special Energy)
const VOLTAIC = 'me05-084'; // Voltaic Lightning Energy

const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';

type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Tropius

test('Tropius, Fruity Aroma: look at the top 6, take any number of the Pokémon there (also none); the other cards are shuffled back', () => {
  const dk = deck([TROPIUS, SLO, URSA]);
  const top6 = ['Slowpoke', F, 'Slowpoke', F, F, F];
  const mk = (top: string[]): Game => scenario(dk, dk, [{ active: 'Tropius', energy: { active: [G] }, deckTop: top }, { active: 'Bloodmoon Ursaluna ex' }]);
  // Two Pokémon among the six: take both; the 4 Energy are shuffled back in with the rest.
  const g = mk(top6);
  const hand = g.state.p[0].hand.length;
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Attack: Fruity Aroma');
  assert.deepEqual(labels(g).sort(), ['Slowpoke', 'Slowpoke'].map((n) => labels(g).find((l) => l.includes(n))!).sort(), 'only the Pokémon can be taken');
  assert.equal(labels(g).length, 2);
  pick(g, ['Slowpoke', 'Slowpoke']);
  assert.equal(g.state.p[0].hand.length, hand + 2);
  assert.equal(names(g, g.state.p[0].hand.slice(-2)).join(), 'Slowpoke,Slowpoke');
  assert.equal(g.state.p[0].deck.length, deckSize - 2);
  assert.equal(g.state.p[0].knownTop, 0, 'the deck was shuffled');
  // Take only one of them
  const one = mk(top6);
  choose(one, 'Attack: Fruity Aroma');
  pick(one, ['Slowpoke']);
  assert.equal(one.state.p[0].hand.length, hand + 1);
  // Take none ("you may"): the 6 cards are shuffled back
  const none = mk(top6);
  choose(none, 'Attack: Fruity Aroma');
  none.submit([]);
  assert.equal(none.state.p[0].hand.length, hand);
  assert.equal(none.state.p[0].deck.length, deckSize);
  assert.equal(none.state.p[0].knownTop, 0);
});

test('Tropius, Fruity Aroma: with no Pokémon among the top 6 the deck is still shuffled; with all 6 taken it is NOT (Compendium #2403)', () => {
  const dk = deck([TROPIUS, SLO, URSA], { [SLO]: 10 });
  const mk = (top: string[]): Game => scenario(dk, dk, [{ active: 'Tropius', energy: { active: [G] }, deckTop: top }, { active: 'Bloodmoon Ursaluna ex' }]);
  const dud = mk([F, F, F, F, F, F]);
  const handBefore = dud.state.p[0].hand.length;
  choose(dud, 'Attack: Fruity Aroma');
  assert.equal(dud.state.p[0].hand.length, handBefore, 'nothing to take');
  assert.equal(dud.state.p[0].knownTop, 0, 'six cards went back: shuffled');
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2403/): "No, since you are not putting any cards back into the deck, you do not shuffle your deck."
  const all = mk(['Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke']);
  const before = all.state.p[0].deck.slice();
  choose(all, 'Attack: Fruity Aroma');
  pick(all, ['Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke']);
  assert.equal(all.state.p[0].hand.filter((c) => name(all, c) === 'Slowpoke').length >= 6, true);
  assert.deepEqual(all.state.p[0].deck, before.slice(0, before.length - 6), 'the rest of the deck is in the order it was: no shuffle');
  assert.equal(all.state.p[0].knownTop, 6);
});

// ------------------------------------------------------------------ Heatran

test("Heatran, Singe: the opponent's Active Pokémon is now Burned", () => {
  const dk = deck([HEATRAN, URSA]);
  const g = scenario(dk, dk, [{ active: 'Heatran', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  g.state.forcedCoins = [false]; // Checkup: the Burn flip is tails, it stays Burned
  choose(g, 'Attack: Singe');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
  assert.equal(dmg(g, 1), 20, 'and the Burn put 2 damage counters on it at Checkup');
});

test('Heatran, Lava Wall: 120, and during the opponent\'s next turn attacks from Burned Pokémon do no damage to it (others do)', () => {
  const dk = deck([HEATRAN, WAILORD, SLO]);
  const run = (cond: number, attacker: string, attack: string): Game => {
    const g = scenario(dk, dk, [{ active: 'Heatran', energy: { active: [F, F, F] } }, { active: attacker, energy: { active: [W, W, W] }, cond }]);
    g.state.forcedCoins = [false, false, false];
    choose(g, 'Attack: Lava Wall');
    choose(g, `Attack: ${attack}`);
    return g;
  };
  const burned = run(BURNED, 'Wailord ex', 'Surf');
  assert.equal(dmg(burned, 1) >= 120, true, 'Lava Wall did 120');
  assert.equal(dmg(burned, 0), 0, 'Surf (120, x2 for Heatran\'s Water weakness) from the Burned Wailord ex is prevented');
  const clean = run(0, 'Wailord ex', 'Surf');
  assert.equal(name(clean, clean.state.p[0].discard.find((c) => name(clean, c) === 'Heatran')!), 'Heatran', 'an unburned attacker is not stopped: 240 Knocks Heatran Out');
});

// ------------------------------------------------------------------ Mega Delphox ex

test('Mega Delphox ex, Trick Portal: look at the top 9, put any number of Pokémon there (any Stage) onto the Bench, shuffle the rest', () => {
  const dk = deck([DELPHOX, SLO, BRAIXEN, URSA], { [SLO]: 10 });
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Mega Delphox ex', energy: { active: [F] }, bench: ['Slowpoke', 'Slowpoke'], deckTop: ['Slowpoke', F, 'Braixen', F, 'Slowpoke', F, F, F, 'Slowpoke'] },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
  const g = mk();
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Attack: Trick Portal');
  assert.equal(labels(g).length, 4, 'every Pokémon among the top 9 can be chosen');
  pick(g, ['Slowpoke', 'Braixen']);
  assert.deepEqual(benchNames(g, 0), ['Slowpoke', 'Slowpoke', 'Slowpoke', 'Braixen'], 'a Stage 1 goes straight to the Bench');
  assert.equal(g.state.p[0].deck.length, deckSize - 2);
  assert.equal(g.state.p[0].knownTop, 0, 'shuffled');
  // The Bench has room for only so many: 3 already there, so at most 2 of the 4 Pokémon
  const full = scenario(dk, dk, [
    { active: 'Mega Delphox ex', energy: { active: [F] }, bench: ['Slowpoke', 'Slowpoke', 'Slowpoke'], deckTop: ['Slowpoke', F, 'Braixen', F, 'Slowpoke', F, F, F, 'Slowpoke'] },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  choose(full, 'Attack: Trick Portal');
  assert.equal(full.decision?.max, 2);
});

test("Mega Delphox ex, Eerie Glow: 200, and the opponent's Active Pokémon is now Burned and Confused", () => {
  const dk = deck([DELPHOX, TYR]);
  const g = scenario(dk, dk, [{ active: 'Mega Delphox ex', energy: { active: [F, F, F] } }, { active: 'Tyranitar ex' }]);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Eerie Glow');
  assert.equal(dmg(g, 1), 200 + 20, 'and the Burn put 2 damage counters on it at Checkup');
  assert.equal(g.state.p[1].active!.cond & BURNED, BURNED);
  assert.equal(g.state.p[1].active!.cond & CONFUSED, CONFUSED);
});

// ------------------------------------------------------------------ Sizzlipede

test("Sizzlipede, Controlled Burn: discard the top card of the opponent's deck", () => {
  const dk = deck([SIZZLIPEDE, SLO, URSA]);
  const g = scenario(dk, dk, [{ active: 'Sizzlipede', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex', deckTop: ['Slowpoke'] }]);
  const deckSize = g.state.p[1].deck.length;
  const top = g.state.p[1].deck[deckSize - 1] as number;
  choose(g, 'Attack: Controlled Burn');
  assert.ok(g.state.p[1].discard.includes(top));
  assert.equal(name(g, top), 'Slowpoke');
  assert.equal(g.state.p[1].discard.length, 1);
  assert.equal(g.state.p[1].deck.length, deckSize - 2, 'the top card was discarded, then the opponent drew for their turn');
});

test('Sizzlipede, Bug Out: 50 for each Pokémon with Bug Out among the bottom 7; every revealed Pokémon is shuffled back, the other cards discarded (Compendium #2401)', () => {
  const dk = deck([SIZZLIPEDE, SLO, URSA], { [SLO]: 10 });
  const mk = (bottom: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Sizzlipede', energy: { active: [F, F, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    setBottom(g, 0, bottom);
    return g;
  };
  const g = mk(['Sizzlipede', 'Sizzlipede', 'Slowpoke', F, F, P, 'Sizzlipede']);
  const deckSize = g.state.p[0].deck.length;
  const slowpokes = g.state.p[0].deck.filter((c) => name(g, c) === 'Slowpoke').length;
  choose(g, 'Attack: Bug Out');
  assert.equal(dmg(g, 1), 150, '3 Pokémon with Bug Out');
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2401/): "No, all Pokemon get shuffled back into the deck whether they have the Bug Out attack or not.  Other non-Pokemon cards like Trainer or Energy cards would get discarded."
  assert.deepEqual(names(g, g.state.p[0].discard), [F, F, P].sort(), 'only the Energy cards are discarded');
  assert.equal(g.state.p[0].deck.length, deckSize - 3);
  assert.equal(g.state.p[0].deck.filter((c) => name(g, c) === 'Slowpoke').length, slowpokes, 'the Slowpoke is back in the deck');
  assert.equal(g.state.p[0].knownTop, 0);
  // Only the bottom 7 are looked at: an 8th Sizzlipede above them does not count
  const o = mk(['Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke', 'Sizzlipede']);
  choose(o, 'Attack: Bug Out');
  assert.equal(dmg(o, 1), 0);
  assert.equal(o.state.p[0].discard.length, 0, 'no Energy among them: nothing discarded');
});

// ------------------------------------------------------------------ Armarouge

test('Armarouge, Flame Legion: 40, and 40 more for each Benched Pokémon with any {R} Energy attached (not the Active one)', () => {
  const dk = deck([ARMAROUGE, SLO, URSA]);
  const hit = (sides: Sides): number => {
    const g = scenario(dk, dk, sides);
    choose(g, 'Attack: Flame Legion');
    return dmg(g, 1);
  };
  const base: SideLayout = { active: 'Armarouge', energy: { active: [F] } };
  assert.equal(hit([{ ...base, bench: ['Slowpoke'] }, { active: 'Bloodmoon Ursaluna ex' }]), 40, 'no Energy on the Bench');
  assert.equal(hit([{ ...base, bench: ['Slowpoke', 'Slowpoke', 'Slowpoke'], energy: { active: [F], 0: [F], 2: [F, F] } }, { active: 'Bloodmoon Ursaluna ex' }]), 120, 'two Benched Pokémon have {R} Energy (a second Fire Energy on one adds nothing)');
  assert.equal(hit([{ ...base, bench: ['Slowpoke', 'Slowpoke'], energy: { active: [F], 0: [W], 1: [P, F] } }, { active: 'Bloodmoon Ursaluna ex' }]), 80, 'a {W} Energy does not count');
});

// ------------------------------------------------------------------ Seaking

test("Seaking, Hydro Jet: 30 to 1 of the opponent's Pokémon for each {W} Energy on it; no Weakness on a Benched Pokémon", () => {
  const dk = deck([SEAKING, HEATRAN, URSA]);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Seaking', energy: { active: [W, W, L] } }, { active: 'Heatran', bench: ['Heatran'] }]);
  const act = mk();
  choose(act, 'Attack: Hydro Jet');
  act.submit([0]);
  assert.equal(dmg(act, 1), 120, '2 {W} = 60, doubled by Heatran\'s Water Weakness');
  const bench = mk();
  choose(bench, 'Attack: Hydro Jet');
  bench.submit([1]); // the second Heatran: the Benched one
  assert.equal(dmg(bench, 1), 0, 'the Active Pokémon is untouched');
  assert.equal(bench.state.p[1].bench[0]!.damage, 60, 'no Weakness on the Bench');
  const none = scenario(dk, dk, [{ active: 'Seaking', energy: { active: [L, L, L] } }, { active: 'Heatran' }]);
  choose(none, 'Attack: Hydro Jet');
  assert.equal(dmg(none, 1), 0, 'no {W} Energy: no damage');
});

// ------------------------------------------------------------------ Wailord ex

test('Wailord ex, Falling Down: 270, and this Pokémon is now Asleep', () => {
  const dk = deck([WAILORD, TYR]);
  const g = scenario(dk, dk, [{ active: 'Wailord ex', energy: { active: [W, W, W, W, W] } }, { active: 'Tyranitar ex' }]);
  g.state.forcedCoins = [false]; // Checkup: tails, it stays Asleep
  choose(g, 'Attack: Falling Down');
  assert.equal(dmg(g, 1), 270);
  assert.equal(g.state.p[0].active!.cond & ASLEEP, ASLEEP);
  const surf = scenario(dk, dk, [{ active: 'Wailord ex', energy: { active: [W, W, W, W, W] } }, { active: 'Tyranitar ex' }]);
  choose(surf, 'Attack: Surf');
  assert.equal(surf.state.p[0].active!.cond & ASLEEP, 0, 'Surf does not put it to sleep');
});

// ------------------------------------------------------------------ Relicanth

test('Relicanth, Fossil Beatdown: 10, and 30 more for each Benched Pokémon with "Antique" in its name', () => {
  const dk = deck([RELICANTH, SLO, FOSSIL, TYR]);
  const hit = (bench: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Relicanth', energy: { active: [W] }, bench }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Fossil Beatdown');
    return dmg(g, 1);
  };
  assert.equal(hit(['Slowpoke']), 10);
  assert.equal(hit(['Slowpoke', 'Antique Armor Fossil']), 40);
  assert.equal(hit(['Antique Armor Fossil', 'Slowpoke', 'Antique Armor Fossil']), 70);
});

// ------------------------------------------------------------------ Primarina

/** The catalog has no Brionne frame, so the Basic Primarina evolves from is made here. */
const BRIONNE: CardFrame = {
  cardId: 'test-brionne', name: 'Brionne', category: 'Pokemon', hp: 90, stage: 'Stage1', evolvesFrom: 'Popplio', types: ['Water'], retreat: 1,
  attacks: [], abilities: [], weaknesses: [{ type: 'Lightning', value: '×2' }], resistances: [],
} as CardFrame;
function primDeck(): DeckInput {
  const base = deck([PRIMARINA, SLO, TYR]);
  return { ...base, cards: [...base.cards, { frame: BRIONNE, count: 4 }] };
}

test('Primarina, Enriching Melody: when it evolves a Pokémon from your hand you may heal all damage from 1 of your Pokémon', () => {
  const dk = primDeck();
  const mk = (): Game => scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Brionne', 'Slowpoke'], hand: ['Primarina'], damage: { active: 60, 0: 40, 1: 30 } }, { active: 'Tyranitar ex' }]);
  const g = mk();
  choose(g, 'Evolve Brionne');
  yes(g);
  assert.equal(g.decision?.kind, 'slots');
  choose(g, 'Slowpoke');
  const total = g.state.p[0].active!.damage + g.state.p[0].bench.reduce((a, b) => a + b.damage, 0);
  assert.equal(total, 70, 'exactly one of the three damaged Pokémon was healed completely');
  const bench1 = mk();
  choose(bench1, 'Evolve Brionne');
  yes(bench1);
  choose(bench1, 'Primarina'); // the Pokémon that just evolved (40 damage)
  assert.equal(bench1.state.p[0].bench[0]!.damage, 0, 'all 40 healed');
  assert.equal(bench1.state.p[0].active!.damage, 60);
  const declined = mk();
  choose(declined, 'Evolve Brionne');
  no(declined);
  assert.equal(declined.state.p[0].active!.damage + declined.state.p[0].bench.reduce((a, b) => a + b.damage, 0), 130, 'declined: nothing healed');
});

test('Primarina, Aqua Return: 120, then Primarina and all attached cards are shuffled into your deck', () => {
  const dk = primDeck();
  const g = scenario(dk, dk, [{ active: 'Primarina', bench: ['Slowpoke'], energy: { active: [W, P] } }, { active: 'Tyranitar ex' }]);
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Attack: Aqua Return');
  assert.equal(dmg(g, 1), 120);
  assert.equal(g.state.p[0].deck.length, deckSize + 3, 'Primarina and 2 Energy');
  assert.equal(activeName(g, 0), 'Slowpoke', 'the Bench Pokémon was promoted');
  assert.equal(g.state.p[0].discard.length, 0);
  assert.equal(g.state.p[0].deck.filter((c) => name(g, c) === 'Primarina').length, 4);
});

// ------------------------------------------------------------------ Palafin

test('Palafin, Knuckle Justice: 80, or 280 if the opponent has exactly 1 Prize card remaining (not 2)', () => {
  const dk = deck([PALAFIN, TYR]);
  const hit = (prizes: number): number => {
    const g = scenario(dk, dk, [{ active: 'Palafin', energy: { active: [W, W] } }, { active: 'Tyranitar ex', prizes }]);
    choose(g, 'Attack: Knuckle Justice');
    return dmg(g, 1);
  };
  assert.equal(hit(1), 280);
  assert.equal(hit(2), 80);
  assert.equal(hit(6), 80);
});

// ------------------------------------------------------------------ Manectric

test('Manectric, Flashing Barrier: 50, and during the opponent\'s next turn attacks from Evolution Pokémon do no damage to it; Basic Pokémon do (Compendium #2397)', () => {
  const dk = deck([MANECTRIC, BRAIXEN, SLO, TYR]);
  const run = (attacker: string, energy: string[], attack: string): Game => {
    const g = scenario(dk, dk, [{ active: 'Manectric', energy: { active: [L, L] } }, { active: attacker, energy: { active: energy } }]);
    choose(g, 'Attack: Flashing Barrier');
    choose(g, `Attack: ${attack}`);
    return g;
  };
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2397/): "Yes. Even though Cinderace is not an "Evolved Pokemon" it is still an "Evolution Pokemon" card, and therefore meets the condition of Flashing Barrier to have its damage blocked."
  // (a Braixen put into play directly, without evolving, is still an Evolution Pokémon card)
  const evo = run('Braixen', [F, F], 'Flamethrower');
  assert.equal(dmg(evo, 1), 50);
  assert.equal(dmg(evo, 0), 0, 'Flamethrower (80) from the Evolution Pokémon is prevented');
  const basic = run('Slowpoke', [P, P], 'Headbutt');
  assert.equal(dmg(basic, 1), 50);
  assert.equal(dmg(basic, 0), 20, 'a Basic Pokémon is not stopped');
  // The prevention lasts only through the opponent's next turn
  const later = scenario(dk, dk, [{ active: 'Manectric', energy: { active: [L, L] } }, { active: 'Braixen', energy: { active: [F, F] } }]);
  choose(later, 'Attack: Flashing Barrier');
  choose(later, 'End turn'); // the opponent's turn
  choose(later, 'End turn'); // your turn
  choose(later, 'Attack: Flamethrower'); // the opponent's second turn
  assert.equal(dmg(later, 0), 80);
});

test("Manectric, Sonic Edge: 110, not affected by effects on the opponent's Active Pokémon", () => {
  const dk = deck([MANECTRIC, URSA]);
  const hit = (effect?: StaticEffect): number => {
    const g = scenario(dk, dk, [{ active: 'Manectric', energy: { active: [L, L, L] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    if (effect) inject(g, g.state.p[1].active!.id, effect);
    choose(g, 'Attack: Sonic Edge');
    return dmg(g, 1);
  };
  assert.equal(hit(), 110);
  assert.equal(hit({ k: 'damageIn', amount: -50 }), 110, 'a damage reduction on the Defending Pokémon is ignored');
  assert.equal(hit({ k: 'preventDamage' }), 110, 'so is a prevention');
});

// ------------------------------------------------------------------ Vikavolt

test("Vikavolt, Quick Dive: 50 to 1 of the opponent's Pokémon, no Weakness on the Bench", () => {
  const dk = deck([VIKAVOLT, SLO, URSA]);
  const mk = (): Game => scenario(dk, dk, [{ active: 'Vikavolt', energy: { active: [L] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke'] }]);
  const b = mk();
  choose(b, 'Attack: Quick Dive');
  choose(b, 'Slowpoke');
  assert.equal(b.state.p[1].bench[0]!.damage, 50);
  assert.equal(dmg(b, 1), 0);
  const a = mk();
  choose(a, 'Attack: Quick Dive');
  choose(a, 'Bloodmoon');
  assert.equal(dmg(a, 1), 50);
});

test('Vikavolt, Giga Railgun: 260, but nothing without a Voltaic {L} Energy attached', () => {
  const dk = deck([VIKAVOLT, TYR, VOLTAIC]);
  const hit = (energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Vikavolt', energy: { active: energy } }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Giga Railgun');
    return dmg(g, 1);
  };
  const voltaicBonus = (() => {
    const g = scenario(dk, dk, [{ active: 'Vikavolt', energy: { active: ['Voltaic Lightning Energy'] } }, { active: 'Tyranitar ex' }]);
    return def(g.ctx, g.state.p[0].active!.energy[0]!).statics.some((s) => s.effect.k === 'damageOut') ? 20 : 0;
  })();
  assert.equal(hit(['Voltaic Lightning Energy', L, L]), 260 + voltaicBonus);
  assert.equal(hit([L, L]), 0, 'two Basic Lightning Energy: the attack does nothing');
});

// ------------------------------------------------------------------ Mega Zeraora ex

test('Mega Zeraora ex, Thunderous Fist: 60 for each {L} Energy attached to this Pokémon', () => {
  const dk = deck([ZERAORA, TYR]);
  const hit = (energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Mega Zeraora ex', energy: { active: energy } }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Thunderous Fist');
    return dmg(g, 1);
  };
  assert.equal(hit([L]), 60);
  assert.equal(hit([L, L, F]), 120);
  assert.equal(hit([L, L, L, L, F, F]), 240);
});

test('Mega Zeraora ex, Zepto Turn: 150, then switch it with 1 of your Benched Pokémon; the Knock Out is processed after (Compendium #2414)', () => {
  const dk = deck([ZERAORA, SLO, TYR]);
  const g = scenario(dk, dk, [{ active: 'Mega Zeraora ex', bench: ['Slowpoke', 'Slowpoke'], energy: { active: [L, L, L] } }, { active: 'Tyranitar ex', bench: ['Slowpoke'] }]);
  choose(g, 'Attack: Zepto Turn');
  assert.equal(dmg(g, 1), 150);
  choose(g, 'Slowpoke'); // which Benched Pokémon comes up
  assert.equal(activeName(g, 0), 'Slowpoke', 'switched out');
  assert.deepEqual(benchNames(g, 0).sort(), ['Mega Zeraora ex', 'Slowpoke']);
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2414/): "Attack effects are completed before KO's are taken, so you switch Mega Zerora ex to the Bench first and promote a new Active, then your opponent would process the KO and bring up a new Active."
  const ko = scenario(dk, dk, [{ active: 'Mega Zeraora ex', bench: ['Slowpoke', 'Slowpoke'], energy: { active: [L, L, L] } }, { active: 'Tyranitar ex', bench: ['Slowpoke'], damage: { active: 200 } }]);
  choose(ko, 'Attack: Zepto Turn');
  assert.equal(ko.decision?.player, 0, 'you switch first');
  assert.equal(ko.state.p[1].active!.damage, 350, 'the Defending Pokémon is still there, Knocked Out afterwards');
  choose(ko, 'Slowpoke');
  assert.equal(activeName(ko, 0), 'Slowpoke');
  assert.equal(ko.decision?.player, 1, 'then the opponent brings up a new Active Pokémon');
  choose(ko, 'Slowpoke');
  assert.equal(activeName(ko, 1), 'Slowpoke');
  assert.equal(ko.state.p[0].prizes.length, 4, 'Tyranitar ex gave 2 Prize cards');
});

// ------------------------------------------------------------------ Spiritomb

test("Spiritomb, Spiritual End: with 13 or more Pokémon with Hide 'n' Sneak in your discard pile (not 12), quadruple the damage counters on 2 of the opponent's Pokémon (Compendium #2411)", () => {
  const dk = deck([SPIRITOMB, SHUPPET, SLO, URSA], { [SHUPPET]: 14 });
  const mk = (n: number): Game =>
    scenario(dk, dk, [
      { active: 'Spiritomb', energy: { active: [P] }, discard: Array(n).fill('Shuppet') },
      { active: 'Bloodmoon Ursaluna ex', bench: ['Slowpoke', 'Slowpoke'], damage: { active: 30, 0: 10 } },
    ]);
  const g = mk(13);
  choose(g, 'Attack: Spiritual End');
  pick(g, ['Bloodmoon', 'Slowpoke']);
  assert.equal(dmg(g, 1), 120, '3 counters become 12');
  assert.equal(g.state.p[1].bench[0]!.damage, 40, '1 counter becomes 4');
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2411/): "No damage counters are placed on that Pokemon. For example, 0 times 4 is 0; ..."
  assert.equal(g.state.p[1].bench[1]!.damage, 0, 'a Pokémon with no damage counters, and the one not chosen, stay as they are');
  const none = mk(12);
  choose(none, 'Attack: Spiritual End');
  assert.equal(dmg(none, 1), 30, '12 is not enough: nothing happens');
  assert.equal(none.state.p[1].bench[0]!.damage, 10);
  // A chosen Pokémon with no counters gets none
  const zero = mk(13);
  choose(zero, 'Attack: Spiritual End');
  pick(zero, ['Slowpoke', 'Slowpoke']);
  assert.equal(zero.state.p[1].bench[0]!.damage, 40);
  assert.equal(zero.state.p[1].bench[1]!.damage, 0, '0 x 4 = 0');
  assert.equal(dmg(zero, 1), 30, 'the Active Pokémon was not chosen');
});

// ------------------------------------------------------------------ Lampent

test('Lampent, Spreading Light: search your deck for up to 3 Lampent and put them onto your Bench, then shuffle', () => {
  const dk = deck([LAMPENT, SLO, URSA], { [LAMPENT]: 6 });
  const g = scenario(dk, dk, [{ active: 'Lampent', energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Attack: Spreading Light');
  assert.equal(labels(g).length >= 1, true);
  pick(g, ['Lampent', 'Lampent', 'Lampent']);
  assert.deepEqual(benchNames(g, 0), ['Lampent', 'Lampent', 'Lampent'], 'Stage 1 cards go straight to the Bench');
  assert.equal(g.state.p[0].deck.length, deckSize - 3);
  assert.equal(g.state.p[0].knownTop, 0, 'shuffled');
  // "up to": fewer is fine; and only as many as the Bench has room for
  const full = scenario(dk, dk, [{ active: 'Lampent', energy: { active: [P] }, bench: ['Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(full, 'Attack: Spreading Light');
  assert.equal(full.decision?.max, 1, 'one free Bench spot');
  pick(full, ['Lampent']);
  assert.equal(full.state.p[0].bench.length, 5);
  const few = scenario(dk, dk, [{ active: 'Lampent', energy: { active: [P] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(few, 'Attack: Spreading Light');
  pick(few, ['Lampent']);
  assert.deepEqual(benchNames(few, 0), ['Lampent']);
});

// ------------------------------------------------------------------ Mega Chandelure ex

test("Mega Chandelure ex, Binding Flame: your opponent's Active Pokémon's Retreat Cost is {C} more (also from the Bench)", () => {
  const dk = deck([CHANDELURE, SLO, URSA]);
  const g = scenario(dk, dk, [{ active: 'Slowpoke', bench: ['Mega Chandelure ex'] }, { active: 'Slowpoke', bench: ['Slowpoke'] }]);
  const env = g.envForInternals;
  assert.equal(retreatCost(env, g.state, g.state.p[1].active!), 3, 'Slowpoke: Retreat 2, plus 1');
  assert.equal(retreatCost(env, g.state, g.state.p[0].active!), 2, 'your own Active Pokémon is not affected');
  assert.equal(retreatCost(env, g.state, g.state.p[1].bench[0]!), 2, 'nor is their Bench');
});

test("Mega Chandelure ex, Phantom Maze: 130, and 50 more for each {C} in the opponent's Active Pokémon's Retreat Cost (counting Binding Flame); none for an Antique fossil (Compendium #2386)", () => {
  const dk = deck([CHANDELURE, ZERAORA, DELPHOX, FOSSIL, SLO]);
  const hit = (defender: string): number => {
    const g = scenario(dk, dk, [{ active: 'Mega Chandelure ex', energy: { active: [P, P] } }, { active: defender }]);
    choose(g, 'Attack: Phantom Maze');
    return dmg(g, 1);
  };
  assert.equal(hit('Mega Zeraora ex'), 130 + 50 * 2, 'Retreat 1, plus Binding Flame');
  assert.equal(hit('Mega Delphox ex'), 130 + 50 * 3, 'Retreat 2, plus Binding Flame');
  // Ruling (TPCi Rules Team 2026-04-02, https://compendium.pokegym.net/ruling/2386/): "... The text on all Antique Fossil cards say they have no Retreat cost. Not zero, "no" retreat cost. It is a fixed attribute and it cannot be changed."
  const f = scenario(dk, dk, [{ active: 'Mega Chandelure ex' }, { active: 'Antique Armor Fossil' }]);
  const fossil = f.state.p[1].active!;
  assert.equal(retreatCost(f.envForInternals, f.state, fossil), 1, 'Binding Flame alone would give the fossil a Retreat Cost');
  const frame: Frame = { code: '', pc: 0, vars: {}, player: 0, src: 0, slot: f.state.p[0].active!.id, kind: 'attack' };
  CUSTOMS['c11.retreatCostOf']!(f.envForInternals, f.state, frame, { as: 'n' }, undefined);
  assert.equal(frame.vars.n, 0, 'but it has no Retreat Cost to count');
});

// ------------------------------------------------------------------ Cranidos

test("Cranidos, Push Down: 70, and the opponent's Active Pokémon is switched out; the opponent chooses the new Active Pokémon", () => {
  const dk = deck([CRANIDOS, SLO, TYR]);
  const g = scenario(dk, dk, [{ active: 'Cranidos', energy: { active: [FI, FI] } }, { active: 'Tyranitar ex', bench: ['Slowpoke', 'Slowpoke'], damage: { 1: 20 } }]);
  choose(g, 'Attack: Push Down');
  assert.equal(g.decision?.player, 1, 'the opponent picks');
  const handle = g.state.p[1].bench.map((b) => b.damage);
  assert.deepEqual(handle, [0, 20]);
  g.submit([1]);
  assert.equal(g.state.p[1].active!.damage, 20, 'the second Slowpoke they chose is Active');
  assert.equal(g.state.p[1].bench.find((b) => name(g, topCard(b)) === 'Tyranitar ex')!.damage, 70);
});

// ------------------------------------------------------------------ Rampardos ex

test('Rampardos ex, Rowdy Hammer: 150, and during your next turn its attacks do 150 more; it tops out at 300, not 450 (Compendium #2407)', () => {
  const dk = deck([RAMPARDOS, TYR]);
  const g = scenario(dk, dk, [{ active: 'Rampardos ex', energy: { active: [FI, FI] } }, { active: 'Tyranitar ex' }], { first: 0 });
  choose(g, 'Attack: Rowdy Hammer');
  assert.equal(dmg(g, 1), 150);
  choose(g, 'End turn'); // the opponent's turn
  g.state.p[1].active!.damage = 0;
  choose(g, 'Attack: Rowdy Hammer');
  assert.equal(dmg(g, 1), 300, '150 + 150');
  choose(g, 'End turn');
  g.state.p[1].active!.damage = 0;
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2407/): "No, Rowdy Hammer tops out at 300. ... it does not accumulate on successive turns."
  choose(g, 'Attack: Rowdy Hammer');
  assert.equal(dmg(g, 1), 300, 'not 450');
});

test("Rampardos ex, Rowdy Hammer: the extra 150 is not an effect, so Hide 'n' Sneak doesn't stop it (Compendium #2398); it's gone after that turn", () => {
  const dk = deck([RAMPARDOS, TYR]);
  const g = scenario(dk, dk, [{ active: 'Rampardos ex', energy: { active: [FI, FI] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Rowdy Hammer');
  choose(g, 'End turn');
  g.state.p[1].active!.damage = 0;
  inject(g, g.state.p[1].active!.id, { k: 'preventEffects', from: ['attack', 'ability'] });
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2398/): "The extra damage done by Rowdy Hammer is due a game state check and damage calculations; it is not an effect that can be blocked by Hide 'n' Sneak. The extra damage for Rowdy Hammer takes place."
  choose(g, 'Attack: Rowdy Hammer');
  assert.equal(dmg(g, 1), 300);
});

test("Rampardos ex, Destructive Headbutting: Active Spot only, and only if the opponent's Active Pokémon has Energy; heads discards an Energy from it", () => {
  const dk = deck([RAMPARDOS, TYR, SLO]);
  const mk = (sides: Sides): Game => scenario(dk, dk, sides);
  const ability = 'Use Destructive Headbutting';
  const act = mk([{ active: 'Rampardos ex' }, { active: 'Tyranitar ex', energy: { active: [D, D] } }]);
  assert.ok(has(act, ability));
  act.state.forcedCoins = [true];
  choose(act, ability);
  assert.equal(act.state.p[1].active!.energy.length, 1, 'heads: one Energy discarded');
  assert.equal(act.state.p[1].discard.length, 1);
  const tails = mk([{ active: 'Rampardos ex' }, { active: 'Tyranitar ex', energy: { active: [D, D] } }]);
  tails.state.forcedCoins = [false];
  choose(tails, ability);
  assert.equal(tails.state.p[1].active!.energy.length, 2, 'tails: nothing');
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2393/): "... you would not be able to use Destructive Headbutting if the opponent's Active Pokemon has no Energy attached."
  assert.ok(!has(mk([{ active: 'Rampardos ex' }, { active: 'Tyranitar ex', bench: ['Slowpoke'], energy: { 0: [D] } }]), ability), 'no Energy on the Active Pokémon');
  assert.ok(!has(mk([{ active: 'Slowpoke', bench: ['Rampardos ex'] }, { active: 'Tyranitar ex', energy: { active: [D] } }]), ability), 'Benched');
  // ... "You can use the Destructive Headbutting Ability but Hide 'n' Sneak will prevent Energy from getting discarded."
  const hns = mk([{ active: 'Rampardos ex' }, { active: 'Tyranitar ex', energy: { active: [D, D] } }]);
  inject(hns, hns.state.p[1].active!.id, { k: 'preventEffects', from: ['attack', 'ability'] });
  hns.state.forcedCoins = [true];
  choose(hns, ability);
  assert.equal(hns.state.p[1].active!.energy.length, 2, 'protected: nothing discarded');
});

// ------------------------------------------------------------------ Mandibuzz

test("Mandibuzz, Bone Sniper: 70 to 1 of the opponent's Pokémon that has any Special Energy attached (no Weakness on the Bench); nothing without one", () => {
  const dk = deck([MANDIBUZZ, TYR, 'me05-039', BOOMERANG]);
  const mk = (opp: SideLayout): Game => scenario(dk, dk, [{ active: 'Mandibuzz', energy: { active: [D] } }, opp]);
  // Dhelmise (140 HP) is weak to {D}: a doubled 70 would Knock it Out, so surviving with 70 shows no Weakness was applied
  const bench = mk({ active: 'Tyranitar ex', energy: { active: [F] }, bench: ['Dhelmise', 'Dhelmise'] });
  bench.state.p[1].bench[1]!.energy.push(bench.state.p[1].deck.splice(bench.state.p[1].deck.findIndex((c) => name(bench, c) === 'Boomerang Energy'), 1)[0] as number);
  choose(bench, 'Attack: Bone Sniper');
  assert.equal(bench.state.p[1].bench[1]!.damage, 70, 'the only Pokémon with a Special Energy, on the Bench: no Weakness');
  assert.equal(bench.state.p[1].bench[0]!.damage, 0);
  assert.equal(dmg(bench, 1), 0);
  const act = mk({ active: 'Tyranitar ex', energy: { active: ['Boomerang Energy'] }, bench: ['Dhelmise'] });
  choose(act, 'Attack: Bone Sniper');
  assert.equal(dmg(act, 1), 70);
  assert.equal(act.state.p[1].bench[0]!.damage, 0);
  const nothing = mk({ active: 'Tyranitar ex', energy: { active: [F] }, bench: ['Dhelmise'] });
  choose(nothing, 'Attack: Bone Sniper');
  assert.equal(dmg(nothing, 1), 0);
  assert.equal(nothing.state.p[1].bench[0]!.damage, 0, 'a Pokémon with only Basic Energy can not be chosen');
});
