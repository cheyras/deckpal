/**
 * Card tests, batch "std-c09": every card scripted in cards/scripts/std-c09.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { maxHp } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { ASLEEP, POISONED } from '../types.js';
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
function benchNames(g: Game, p: 0 | 1): string[] {
  return g.state.p[p].bench.map((b) => name(g, topCard(b)));
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]): DeckInput {
  return fromIds('c09', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const LATIAS = 'me01-100'; // Mega Latias ex: 280 HP, Dragon, no Weakness: a target whose damage is exactly what the attack says
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting, Retreat 3
const MANECTRIC = 'me01-158'; // Mega Manectric ex: 330 HP, Lightning, Retreat 0
const DUN = 'sv05-128'; // Dunsparce: 60 HP, weak Fighting, Retreat 0
const QUILLADIN = 'me04-006'; // Quilladin: 100 HP Grass, Vine Whip {G}{G}{C} 80 (no effect text)
const OKIDOGI = 'me02.5-122'; // Okidogi: 140 HP, weak Psychic, not a Tera Pokémon (Koraidon ex me02.5-121 is Tera: no Bench damage)

const F = 'Fire Energy';
const W = 'Water Energy';
const G = 'Grass Energy';
const P = 'Psychic Energy';

type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Hole-Digging Shovel

test('Hole-Digging Shovel: discards the top 2 cards of your deck; not playable with an empty deck', () => {
  const dk = deck('me03-074', DUN);
  const g = scenario(dk, dk, [{ active: 'Dunsparce', hand: ['Hole-Digging Shovel'], deckTop: [F, W, G] }, { active: 'Dunsparce' }]);
  const before = g.state.p[0].deck.length;
  const discardBefore = g.state.p[0].discard.length;
  choose(g, 'Play Hole-Digging Shovel');
  assert.equal(g.state.p[0].deck.length, before - 2);
  assert.deepEqual(names(g, g.state.p[0].discard.slice(discardBefore)), [F, W, 'Hole-Digging Shovel'].sort(), 'the top 2 (Fire, Water) and the Shovel itself');
  assert.equal(name(g, g.state.p[0].deck[g.state.p[0].deck.length - 1]!), G, 'the third card is untouched');
  // Nothing to discard: the card can't be played.
  const e = scenario(dk, dk, [{ active: 'Dunsparce', hand: ['Hole-Digging Shovel'], emptyDeck: true }, { active: 'Dunsparce' }]);
  assert.ok(!has(e, 'Hole-Digging Shovel'));
});

// ------------------------------------------------------------------ Jacinthe

test('Jacinthe: heals 150 from 1 of your damaged {P} Pokémon only; not playable without one', () => {
  const dk = deck('me03-075', 'sv08-076', 'me05-039', DUN);
  // Latias ex ({P}, 210 HP) has 170 damage: 150 healed leaves 20. Dunsparce ({C}) is damaged too but can't be chosen.
  const g = scenario(dk, dk, [{ active: 'Latias ex', bench: ['Dunsparce', 'Dhelmise'], damage: { active: 170, 0: 40, 1: 30 }, hand: ['Jacinthe'] }, { active: 'Dunsparce' }]);
  choose(g, 'Play Jacinthe');
  assert.deepEqual(labels(g).map((l) => l.replace(/ \(.*/, '')).sort(), ['Dhelmise', 'Latias ex'], 'only {P} Pokémon with damage are offered');
  choose(g, 'Latias ex');
  assert.equal(g.state.p[0].active!.damage, 20);
  assert.equal(g.state.p[0].bench[0]!.damage, 40, 'the {C} Pokémon is untouched');
  // Less than 150 on the Pokémon: all of it is healed.
  const h = scenario(dk, dk, [{ active: 'Dunsparce', bench: ['Dhelmise'], damage: { 0: 100 }, hand: ['Jacinthe'] }, { active: 'Dunsparce' }]);
  choose(h, 'Play Jacinthe');
  assert.equal(h.state.p[0].bench[0]!.damage, 0);
  // No damaged {P} Pokémon: not playable (a damaged {C} one doesn't count).
  const n = scenario(dk, dk, [{ active: 'Dunsparce', bench: ['Dhelmise'], damage: { active: 40 }, hand: ['Jacinthe'] }, { active: 'Dunsparce' }]);
  assert.ok(!has(n, 'Play Jacinthe'));
});

// ------------------------------------------------------------------ Lumiose City

test("Lumiose City: either player may search for a Basic Pokémon onto their Bench once a turn, and then their turn ends", () => {
  const dk = deck('me03-077', DUN, 'me05-039', LATIAS);
  const g = scenario(dk, dk, [{ active: 'Mega Latias ex', hand: ['Lumiose City'] }, { active: 'Mega Latias ex' }]);
  choose(g, 'Play Lumiose City');
  assert.ok(has(g, 'Use the Stadium'));
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Use the Stadium');
  choose(g, 'Dunsparce');
  assert.deepEqual(benchNames(g, 0), ['Dunsparce']);
  assert.equal(g.state.p[0].deck.length, deckBefore - 1);
  // "their turn ends": it is now the opponent's turn, and they may use the Stadium on theirs.
  assert.equal(g.state.current, 1, "P1's turn");
  assert.equal(g.state.turn, 4);
  assert.ok(has(g, 'Use the Stadium'), 'the opponent may use it on their turn');
  choose(g, 'Use the Stadium');
  choose(g, 'Dhelmise');
  assert.deepEqual(benchNames(g, 1), ['Dhelmise']);
  assert.equal(g.state.current, 0, "and their turn ends too");
});

test('Lumiose City: not usable with a full Bench; only a Basic Pokémon can be fetched', () => {
  const dk = deck('me03-077', DUN, 'me04-006', LATIAS);
  const full = scenario(dk, dk, [{ active: 'Mega Latias ex', bench: ['Dunsparce', 'Dunsparce', 'Dunsparce', 'Dunsparce', 'Mega Latias ex'], hand: ['Lumiose City'] }, { active: 'Mega Latias ex' }]);
  choose(full, 'Play Lumiose City');
  assert.ok(!has(full, 'Use the Stadium'), 'a full Bench: nothing to put there');
  const g = scenario(dk, dk, [{ active: 'Mega Latias ex', hand: ['Lumiose City'] }, { active: 'Mega Latias ex' }]);
  choose(g, 'Play Lumiose City');
  choose(g, 'Use the Stadium');
  assert.ok(!labels(g).some((l) => l.includes('Quilladin')), 'a Stage 1 is not offered');
  assert.ok(labels(g).some((l) => l.includes('Dunsparce')));
});

// ------------------------------------------------------------------ Lumiose Galette

test('Lumiose Galette: heals 20 from the Active Pokémon and removes one Special Condition of your choice', () => {
  const dk = deck('me03-078', LATIAS);
  const g = scenario(dk, dk, [{ active: 'Mega Latias ex', damage: { active: 60 }, cond: ASLEEP | POISONED, hand: ['Lumiose Galette'] }, { active: 'Mega Latias ex' }]);
  choose(g, 'Play Lumiose Galette');
  choose(g, 'Poisoned');
  assert.equal(g.state.p[0].active!.damage, 40);
  assert.equal(g.state.p[0].active!.cond, ASLEEP, 'only the chosen condition is removed');
  // One condition: no question. Healing more than the damage just clears it.
  const h = scenario(dk, dk, [{ active: 'Mega Latias ex', damage: { active: 10 }, cond: POISONED, hand: ['Lumiose Galette'] }, { active: 'Mega Latias ex' }]);
  choose(h, 'Play Lumiose Galette');
  assert.equal(h.state.p[0].active!.damage, 0);
  assert.equal(h.state.p[0].active!.cond, 0);
});

test('Lumiose Galette: playable when the Active Pokémon is only damaged or only has a condition, not when it has neither', () => {
  const dk = deck('me03-078', LATIAS);
  const side = (l: Partial<SideLayout>): Game => scenario(dk, dk, [{ active: 'Mega Latias ex', bench: ['Mega Latias ex'], hand: ['Lumiose Galette'], ...l }, { active: 'Mega Latias ex' }]);
  assert.ok(has(side({ damage: { active: 20 } }), 'Play Lumiose Galette'));
  assert.ok(has(side({ cond: POISONED }), 'Play Lumiose Galette'));
  assert.ok(!has(side({}), 'Play Lumiose Galette'));
  assert.ok(!has(side({ damage: { 0: 50 } }), 'Play Lumiose Galette'), 'damage on a Benched Pokémon is not the Active Pokémon');
});

// ------------------------------------------------------------------ Naveen

test('Naveen: discard any number of cards from your hand first, then draw until you have 5', () => {
  const dk = deck('me03-079', LATIAS);
  const hand = ['Naveen', F, F, W, W, G, G, P];
  const play = (discard: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Latias ex', hand }, { active: 'Mega Latias ex' }]);
    choose(g, 'Play Naveen');
    if (discard.length) pick(g, discard);
    else g.submit([]);
    return g;
  };
  assert.equal(play([F, F, W]).state.p[0].hand.length, 5, '7 cards, 3 discarded: 4 left, draw 1');
  assert.equal(play([F, F, W, W, G, G, P]).state.p[0].hand.length, 5, 'the whole hand discarded: draw 5');
  const none = play([]);
  assert.equal(none.state.p[0].hand.length, 7, 'with 7 cards in hand and no discard nothing is drawn');
  const g = play([F, F]);
  assert.equal(g.state.p[0].hand.length, 5);
  assert.equal(g.state.p[0].discard.length, 3, 'the 2 Fire Energy and Naveen');
  // A short hand just draws up to 5, with nothing worth discarding.
  const s = scenario(dk, dk, [{ active: 'Mega Latias ex', hand: ['Naveen', F] }, { active: 'Mega Latias ex' }]);
  choose(s, 'Play Naveen');
  s.submit([]);
  assert.equal(s.state.p[0].hand.length, 5);
  // Needs a card to draw.
  const e = scenario(dk, dk, [{ active: 'Mega Latias ex', hand: ['Naveen', F], emptyDeck: true }, { active: 'Mega Latias ex' }]);
  assert.ok(!has(e, 'Play Naveen'));
});

// ------------------------------------------------------------------ Poké Ball

test('Poké Ball: heads searches your deck for a Pokémon, tails does nothing', () => {
  const dk = deck('me03-080', DUN, 'me04-006');
  const heads = scenario(dk, dk, [{ active: 'Dunsparce', hand: ['Poké Ball'] }, { active: 'Dunsparce' }]);
  heads.state.forcedCoins = [true];
  choose(heads, 'Play Poké Ball');
  assert.ok(labels(heads).every((l) => l.includes('Dunsparce') || l.includes('Quilladin')), 'only Pokémon can be taken');
  choose(heads, 'Quilladin');
  assert.deepEqual(names(heads, heads.state.p[0].hand), ['Quilladin']);
  const tails = scenario(dk, dk, [{ active: 'Dunsparce', hand: ['Poké Ball'] }, { active: 'Dunsparce' }]);
  tails.state.forcedCoins = [false];
  const deckBefore = tails.state.p[0].deck.length;
  choose(tails, 'Play Poké Ball');
  assert.equal(tails.state.p[0].hand.length, 0);
  assert.equal(tails.state.p[0].deck.length, deckBefore);
});

// ------------------------------------------------------------------ Potion

test('Potion: heals 30 from 1 of your Pokémon, or all of it when there is less (Compendium #1120)', () => {
  const dk = deck('me03-083', LATIAS);
  const g = scenario(dk, dk, [{ active: 'Mega Latias ex', bench: ['Mega Latias ex', 'Mega Latias ex'], damage: { active: 50, 0: 20 }, hand: ['Potion'] }, { active: 'Mega Latias ex' }]);
  choose(g, 'Play Potion');
  assert.equal(labels(g).length, 2, 'only damaged Pokémon can be chosen');
  g.submit([0]);
  assert.equal(g.state.p[0].active!.damage, 20, '50 - 30');
  // Ruling (TPCi Rules Team 2017-05-18, https://compendium.pokegym.net/ruling/1120/): less than 30 on the Pokémon -> "heal all of it".
  const h = scenario(dk, dk, [{ active: 'Mega Latias ex', bench: ['Mega Latias ex'], damage: { 0: 20 }, hand: ['Potion'] }, { active: 'Mega Latias ex' }]);
  choose(h, 'Play Potion');
  assert.equal(h.state.p[0].bench[0]!.damage, 0);
  // No damage anywhere: can't be played.
  const n = scenario(dk, dk, [{ active: 'Mega Latias ex', hand: ['Potion'] }, { active: 'Mega Latias ex' }]);
  assert.ok(!has(n, 'Play Potion'));
});

// ------------------------------------------------------------------ Growing Grass Energy

test('Growing Grass Energy: provides {G} and gives the {G} Pokémon it is attached to +20 HP, not other types', () => {
  const dk = deck('me03-086', QUILLADIN, DUN);
  const g = scenario(dk, dk, [{ active: 'Quilladin', bench: ['Dunsparce'], energy: { active: ['Growing Grass Energy'], 0: ['Growing Grass Energy'] } }, { active: 'Dunsparce' }]);
  const env = g.envForInternals;
  assert.equal(maxHp(env, g.state, g.state.p[0].active!), 120, 'Quilladin ({G}, 100 HP) gets +20');
  assert.equal(maxHp(env, g.state, g.state.p[0].bench[0]!), 60, 'Dunsparce ({C}, 60 HP) gets nothing');
  // It provides {G}: Quilladin pays Vine Whip {G}{G}{C} with it, a Grass Energy and one more.
  const a = scenario(dk, dk, [{ active: 'Quilladin', energy: { active: ['Growing Grass Energy', G, F] } }, { active: 'Dunsparce' }]);
  assert.ok(has(a, 'Attack: Vine Whip'));
  const b = scenario(dk, dk, [{ active: 'Quilladin', energy: { active: ['Growing Grass Energy', F, F] } }, { active: 'Dunsparce' }]);
  assert.ok(!has(b, 'Attack: Vine Whip'), 'only one {G} provided');
});

// ------------------------------------------------------------------ Kakuna

test('Kakuna, Exoskeleton: takes 20 less damage from attacks (after Weakness)', () => {
  const dk = deck('me04-002', QUILLADIN, 'me04-010');
  const g = scenario(dk, dk, [{ active: 'Quilladin', energy: { active: [G, G, G] } }, { active: 'Kakuna' }]);
  choose(g, 'Attack: Vine Whip');
  assert.equal(g.state.p[1].active!.damage, 60, '80 - 20');
  // Weakness first, then the reduction: Kakuna is weak to Fire (x2), so Ho-Oh's 130 is 260 - 20 = 240 on the Defending Pokémon.
  const f = scenario(dk, dk, [{ active: 'Ho-Oh', energy: { active: [F, F, F] } }, { active: 'Kakuna', bench: ['Quilladin'] }]);
  choose(f, 'Attack: Bright Wing');
  assert.equal(f.state.p[1].active!.damage, 240, '(130 x 2) - 20');
});

// ------------------------------------------------------------------ Beedrill ex

test("Beedrill ex, Rumbling Bees: 110 for each of your Beedrill and Beedrill ex in play, Active and Benched (Compendium #2355)", () => {
  const dk = deck('me04-003', 'me04-002', LATIAS);
  const hit = (bench: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Beedrill ex', bench, energy: { active: [G] } }, { active: 'Mega Latias ex' }]);
    choose(g, 'Attack: Rumbling Bees');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([]), 110);
  assert.equal(hit(['Beedrill ex']), 220, 'a Benched Beedrill ex counts');
  // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2355/): only "Beedrill" and "Beedrill ex" count, "things like Beedrill V" do not --
  // matched by exact name, so any other Pokémon (here Kakuna, its pre-evolution) adds nothing.
  assert.equal(hit(['Kakuna', 'Beedrill ex']), 220);
});

// ------------------------------------------------------------------ Carnivine

test("Carnivine, Chomp Whole: 80, or 160 if your opponent's Active Pokémon has no Retreat Cost", () => {
  const dk = deck('me04-004', LATIAS, MANECTRIC, 'sv10.5b-079');
  const hit = (target: string, tools: string[] = []): number => {
    const g = scenario(dk, dk, [{ active: 'Carnivine', energy: { active: [G, G, G] } }, { active: target, tools: { active: tools } }]);
    choose(g, 'Attack: Chomp Whole');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit('Mega Latias ex'), 80, 'Retreat Cost 1');
  assert.equal(hit('Mega Manectric ex'), 160, 'Retreat Cost 0');
  // The Retreat Cost it has now: an Air Balloon (-2) takes Latias's 1 down to 0.
  assert.equal(hit('Mega Latias ex', ['Air Balloon']), 160);
});

// ------------------------------------------------------------------ Quilladin

test('Quilladin, Leafy Charge: 20, then a Basic {G} Energy from the deck onto this Pokémon', () => {
  const dk = deck(QUILLADIN, LATIAS);
  const g = scenario(dk, dk, [{ active: 'Quilladin', energy: { active: [G] } }, { active: 'Mega Latias ex' }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Leafy Charge');
  if (g.decision?.kind === 'cards') choose(g, G);
  assert.equal(g.state.p[1].active!.damage, 20);
  assert.deepEqual(energyNames(g, 0, 'active'), [G, G]);
  assert.equal(g.state.p[0].deck.length, deckBefore - 1);
  // Only a Basic {G} Energy: the deck offers Grass Energy and nothing else.
  const h = scenario(dk, dk, [{ active: 'Quilladin', energy: { active: [G] } }, { active: 'Mega Latias ex' }]);
  choose(h, 'Attack: Leafy Charge');
  if (h.decision?.kind === 'cards') assert.ok(labels(h).every((l) => l.includes(G)));
});

// ------------------------------------------------------------------ Chesnaught

test("Chesnaught, Needly Armor: 3 damage counters on the Attacking Pokémon for each {G} Energy attached, counting Legacy Energy (Compendium #2347)", () => {
  const dk = deck('me04-007', QUILLADIN, 'sv06-167', 'me04-001');
  // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2347/): 2 {G} + 1 Legacy Energy = 3 x 3 = 9 counters.
  const g = scenario(dk, dk, [
    { active: 'Chesnaught', energy: { active: [G, G, 'Legacy Energy'] } },
    { active: 'Quilladin', energy: { active: [G, G, G] } },
  ], { current: 1 });
  choose(g, 'Attack: Vine Whip');
  assert.equal(g.state.p[0].active!.damage, 80, 'Chesnaught took 80');
  assert.equal(g.state.p[1].active!.damage, 90, '9 damage counters on the Attacking Pokémon');
  // Two {G} only: 6 counters.
  const h = scenario(dk, dk, [{ active: 'Chesnaught', energy: { active: [G, G, F] } }, { active: 'Quilladin', energy: { active: [G, G, G] } }], { current: 1 });
  choose(h, 'Attack: Vine Whip');
  assert.equal(h.state.p[1].active!.damage, 60);
});

test('Chesnaught, Needly Armor: still places the counters when Chesnaught is Knocked Out, and only from the Active Spot', () => {
  const dk = deck('me04-007', QUILLADIN, 'me04-001');
  const ko = scenario(dk, dk, [
    { active: 'Chesnaught', bench: ['Weedle'], energy: { active: [G, G] }, damage: { active: 120 } },
    { active: 'Quilladin', energy: { active: [G, G, G] } },
  ], { current: 1 });
  choose(ko, 'Attack: Vine Whip');
  assert.ok(names(ko, ko.state.p[0].discard).includes('Chesnaught'), 'Chesnaught is Knocked Out (120 + 80 >= 180)');
  assert.equal(ko.state.p[1].active!.damage, 60, 'even so, 2 {G} -> 6 counters on the attacker');
  // On the Bench the Ability does nothing: the Active Pokémon here is a Weedle.
  const bench = scenario(dk, dk, [
    { active: 'Weedle', bench: ['Chesnaught'], energy: { 0: [G, G] } },
    { active: 'Quilladin', energy: { active: [G, G, G] } },
  ], { current: 1 });
  choose(bench, 'Attack: Vine Whip');
  assert.equal(bench.state.p[1].active!.damage, 0);
});

test("Chesnaught, Impound: 160, and the Defending Pokémon can't retreat during your opponent's next turn", () => {
  const dk = deck('me04-007', LATIAS);
  const side1: SideLayout = { active: 'Mega Latias ex', bench: ['Mega Latias ex'], energy: { active: [W, W] } };
  const g = scenario(dk, dk, [{ active: 'Chesnaught', energy: { active: [G, G, G] } }, side1]);
  choose(g, 'Attack: Impound');
  assert.equal(g.state.p[1].active!.damage, 160);
  assert.equal(g.state.current, 1);
  assert.ok(!has(g, 'Retreat'), "the Defending Pokémon can't retreat");
  // Control: with no Impound the same position retreats.
  const c = scenario(dk, dk, [{ active: 'Chesnaught', energy: { active: [G, G, G] } }, side1], { current: 1 });
  assert.ok(has(c, 'Retreat'));
});

// ------------------------------------------------------------------ Ho-Oh

test('Ho-Oh, Flames of Revival: up to 3 Basic Pokémon from the discard pile onto the Bench, 0 allowed (Compendium #2351)', () => {
  const dk = deck('me04-010', DUN, 'me04-002', 'me04-020', LATIAS);
  const run = (bench: string[], discard: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Ho-Oh', bench, discard, energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
    choose(g, 'Attack: Flames of Revival');
    return g;
  };
  const g = run([], ['Dunsparce', 'Dunsparce', 'Froakie', 'Dunsparce', 'Kakuna']);
  assert.ok(!labels(g).some((l) => l.includes('Kakuna')), 'a Stage 1 is not a Basic Pokémon');
  pick(g, ['Dunsparce', 'Froakie', 'Dunsparce']);
  assert.deepEqual(benchNames(g, 0).sort(), ['Dunsparce', 'Dunsparce', 'Froakie']);
  assert.deepEqual(names(g, g.state.p[0].discard).filter((n) => n !== 'Kakuna'), ['Dunsparce'], 'the rest stays in the discard pile');
  // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2351/): "You are not required to put a Basic Pokemon on your bench to use the attack."
  const none = run([], ['Dunsparce']);
  none.submit([]);
  assert.deepEqual(benchNames(none, 0), []);
  // Only as many as the Bench has room for: 4 already there leaves room for 1.
  const full = run(['Dunsparce', 'Dunsparce', 'Dunsparce', 'Dunsparce'], ['Froakie', 'Froakie']);
  assert.equal((full.decision as Decision).max, 1);
  full.submit([0]);
  assert.equal(benchNames(full, 0).length, 5);
});

test('Ho-Oh, Bright Wing: 130, then discard a {R} Energy from this Pokémon', () => {
  const dk = deck('me04-010', LATIAS);
  const g = scenario(dk, dk, [{ active: 'Ho-Oh', energy: { active: [F, F, F, W] } }, { active: 'Mega Latias ex' }]);
  choose(g, 'Attack: Bright Wing');
  if (g.decision?.kind === 'cards') choose(g, F);
  assert.equal(g.state.p[1].active!.damage, 130);
  assert.deepEqual(energyNames(g, 0, 'active'), [F, F, W].sort(), 'one Fire Energy discarded, the Water stays');
});

// ------------------------------------------------------------------ Delphox

test("Delphox, Flaring Magic: discard a Basic {R} Energy from your hand, draw until you have 7; not with 8 or more cards (Compendium #2343)", () => {
  const dk = deck('me04-013', LATIAS);
  const run = (hand: string[]): Game => scenario(dk, dk, [{ active: 'Delphox', hand }, { active: 'Mega Latias ex' }]);
  const g = run([F, W, W]);
  choose(g, 'Flaring Magic');
  assert.equal(g.state.p[0].hand.length, 7, '3 cards, 1 discarded, drawn up to 7');
  assert.ok(names(g, g.state.p[0].discard).includes(F));
  // 7 cards is the most that can use it: discard 1 -> 6, draw 1.
  const seven = run([F, W, W, W, G, G, P]);
  choose(seven, 'Flaring Magic');
  assert.equal(seven.state.p[0].hand.length, 7);
  assert.equal(seven.state.p[0].discard.length, 1);
  // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2343/): 8 or more cards -> you can't use it, and the Energy isn't discarded.
  const eight = run([F, W, W, W, G, G, P, P]);
  assert.ok(!has(eight, 'Flaring Magic'));
  // Needs a Basic {R} Energy card in hand.
  const noFire = run([W, W]);
  assert.ok(!has(noFire, 'Flaring Magic'));
  // Once during your turn.
  assert.ok(!has(g, 'Flaring Magic'));
});

test('Delphox, Energized Storm: 30 damage for each Energy attached to all Pokémon (both players)', () => {
  const dk = deck('me04-013', LATIAS, 'me04-002');
  const g = scenario(dk, dk, [
    { active: 'Delphox', bench: ['Kakuna'], energy: { active: [F, F], 0: [G] } },
    { active: 'Mega Latias ex', bench: ['Mega Latias ex'], energy: { active: [W, W, W], 0: [W] } },
  ]);
  choose(g, 'Attack: Energized Storm');
  assert.equal(g.state.p[1].active!.damage, 210, '(2 + 1 + 3 + 1) x 30');
});

// ------------------------------------------------------------------ Delibird

test('Delibird, Pleasing Present: your opponent attaches up to 3 Basic Energy from their hand first, then you, in any way you like (Compendium #2353)', () => {
  const dk = deck('me04-018', DUN, 'me05-033', LATIAS, 'sv06-167');
  const g = scenario(dk, dk, [
    { active: 'Delibird', bench: ['Mega Latias ex'], energy: { active: [W] }, hand: [F, F, W] },
    { active: 'Shuppet', bench: ['Dunsparce'], hand: [G, G, G, P, 'Legacy Energy'] },
  ]);
  choose(g, 'Attack: Pleasing Present');
  // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2353/): "Make sure your opponent has executed this choice, then execute your choice."
  assert.equal(g.decision?.player, 1, 'the opponent chooses first');
  assert.equal((g.decision as Decision).max, 3, 'up to 3');
  assert.equal(labels(g).length, 4, 'only Basic Energy cards: the Legacy Energy is not offered');
  pick(g, [G, G, P]);
  // Each card goes to a Pokémon of the opponent's choosing.
  assert.equal(g.decision?.player, 1);
  choose(g, 'Dunsparce');
  choose(g, 'Dunsparce');
  // Ruling (TPCi Rules Team 2026-05-21, https://compendium.pokegym.net/ruling/2354/): a Pokémon that prevents the attack's effects (here Shuppet, Hide 'n' Sneak)
  // can't take the Energy: "the energy cards are discarded, after they execute their choice."
  choose(g, 'Shuppet');
  assert.equal(g.decision?.player, 0, 'then it is your turn to choose');
  assert.equal((g.decision as Decision).max, 3);
  pick(g, [F, F, W]);
  choose(g, 'Mega Latias ex');
  choose(g, 'Mega Latias ex');
  choose(g, 'Delibird');
  assert.deepEqual(energyNames(g, 1, 0), [G, G], 'two Grass Energy on the Benched Dunsparce');
  assert.deepEqual(energyNames(g, 1, 'active'), [], 'nothing stays on the protected Shuppet');
  assert.ok(names(g, g.state.p[1].discard).includes(P), 'the Psychic Energy is discarded');
  assert.ok(names(g, g.state.p[1].hand).includes('Legacy Energy') && names(g, g.state.p[1].hand).includes(G), 'what was not chosen stays in hand');
  assert.deepEqual(energyNames(g, 0, 0), [F, F]);
  assert.deepEqual(energyNames(g, 0, 'active'), [W, W]);
});

test('Delibird, Pleasing Present: either player may attach nothing; a short hand just attaches what it has', () => {
  const dk = deck('me04-018', DUN, LATIAS);
  const g = scenario(dk, dk, [{ active: 'Delibird', energy: { active: [W] }, hand: [F] }, { active: 'Dunsparce', hand: [G] }]);
  choose(g, 'Attack: Pleasing Present');
  g.submit([]); // the opponent attaches none
  assert.equal(g.decision?.player, 0);
  pick(g, [F]); // one Pokémon only: no question
  assert.deepEqual(energyNames(g, 0, 'active'), [F, W]);
  assert.deepEqual(energyNames(g, 1, 'active'), []);
  assert.ok(names(g, g.state.p[1].hand).includes(G), 'the declined Energy stays in hand');
});

// ------------------------------------------------------------------ Mega Greninja ex

test("Mega Greninja ex, Mortal Shuriken: from the Active Spot, discard a Basic {W} Energy card from your hand to place 6 damage counters on 1 of your opponent's Pokémon", () => {
  const dk = deck('me04-022', LATIAS, URSA);
  const g = scenario(dk, dk, [{ active: 'Mega Greninja ex', hand: [W, W, F] }, { active: 'Mega Latias ex', bench: ['Bloodmoon Ursaluna ex'] }]);
  choose(g, 'Use Mortal Shuriken');
  assert.deepEqual(labels(g), [W, W], 'only Basic {W} Energy cards can be discarded');
  g.submit([0]);
  choose(g, 'Bloodmoon Ursaluna ex');
  assert.equal(g.state.p[1].bench[0]!.damage, 60, '6 damage counters, no Weakness or modifiers');
  assert.equal(g.state.p[1].active!.damage, 0);
  assert.deepEqual(names(g, g.state.p[0].discard), [W]);
  assert.deepEqual(names(g, g.state.p[0].hand), [F, W]);
  assert.ok(!has(g, 'Mortal Shuriken'), 'once during your turn');
  // Not from the Bench, and not without a Basic {W} Energy card in hand.
  const bench = scenario(dk, dk, [{ active: 'Mega Latias ex', bench: ['Mega Greninja ex'], hand: [W] }, { active: 'Mega Latias ex' }]);
  assert.ok(!has(bench, 'Mortal Shuriken'));
  const none = scenario(dk, dk, [{ active: 'Mega Greninja ex', hand: [F] }, { active: 'Mega Latias ex' }]);
  assert.ok(!has(none, 'Mortal Shuriken'));
});

test('Mega Greninja ex, Ninja Spinner: 120, or 200 if you put a {W} Energy attached to it into your hand', () => {
  const dk = deck('me04-022', LATIAS);
  const run = (answer: 'yes' | 'no'): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Greninja ex', energy: { active: [W, W, W] } }, { active: 'Mega Latias ex' }]);
    choose(g, 'Attack: Ninja Spinner');
    if (answer === 'yes') yes(g);
    else no(g);
    return g;
  };
  const y = run('yes');
  assert.equal(y.state.p[1].active!.damage, 200);
  assert.deepEqual(energyNames(y, 0, 'active'), [W, W]);
  assert.deepEqual(names(y, y.state.p[0].hand).filter((n) => n === W), [W], 'the Energy went to the hand, not the discard pile');
  assert.equal(y.state.p[0].discard.length, 0);
  const n = run('no');
  assert.equal(n.state.p[1].active!.damage, 120);
  assert.deepEqual(energyNames(n, 0, 'active'), [W, W, W]);
});

test('Mega Greninja ex, Ninja Spinner: the Energy only returns to the hand after the damage (Compendium #2385)', () => {
  const dk = deck('me04-022', LATIAS, 'me05-062', 'sv05-162');
  // Ruling (TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2385/): with a basic Water and a Neo Upper Energy attached (3 Energy as Mega Greninja ex is a Stage 2),
  // putting the Neo Upper Energy back "is not returned to the hand until after damage is done. Mega Greninja ex has 3 Energy attached when the damage is done, so Ancient Bulwark will not prevent the damage."
  const g = scenario(dk, dk, [{ active: 'Mega Greninja ex', energy: { active: [W, 'Neo Upper Energy'] } }, { active: 'Mega Latias ex', bench: ['Bastiodon'] }]);
  choose(g, 'Attack: Ninja Spinner');
  yes(g);
  choose(g, 'Neo Upper Energy');
  assert.equal(g.state.p[1].active!.damage, 200, "Bastiodon's Ancient Bulwark (2 or less Energy) does not stop it");
  assert.ok(names(g, g.state.p[0].hand).includes('Neo Upper Energy'));
  assert.deepEqual(energyNames(g, 0, 'active'), [W]);
  // Control: with just 2 Energy attached, the same attack is stopped by Ancient Bulwark -- and the Energy still goes to the hand.
  const c = scenario(dk, dk, [{ active: 'Mega Greninja ex', energy: { active: [W, W] } }, { active: 'Mega Latias ex', bench: ['Bastiodon'] }]);
  choose(c, 'Attack: Ninja Spinner');
  yes(c);
  assert.equal(c.state.p[1].active!.damage, 0);
  assert.deepEqual(energyNames(c, 0, 'active'), [W]);
});

// ------------------------------------------------------------------ Avalugg

test('Avalugg, Iceberg Breaker: discard the top 6 cards of your deck, 60 damage for each Basic {W} Energy card among them', () => {
  const dk = deck('me04-024', LATIAS, DUN);
  const run = (top: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Avalugg', energy: { active: [W] }, deckTop: top }, { active: 'Mega Latias ex' }]);
    choose(g, 'Attack: Iceberg Breaker');
    return g;
  };
  const g = run([W, F, W, 'Dunsparce', W, G, W]);
  assert.equal(g.state.p[1].active!.damage, 180, 'three Water Energy among the top 6; the 7th card is not discarded');
  assert.equal(g.state.p[0].discard.length, 6);
  assert.ok(names(g, g.state.p[0].discard).includes('Dunsparce'), 'every card is discarded, not only the Energy');
  assert.equal(run([F, G, P, F, 'Dunsparce', G, W]).state.p[1].active!.damage, 0, 'no Basic {W} Energy among the top 6: no damage');
});

// ------------------------------------------------------------------ Golisopod

test("Golisopod, Critical Slash: 30; if that Knocks Out the Defending Pokémon, all damage from and effects of attacks are prevented during your opponent's next turn", () => {
  const dk = deck('me04-026', DUN, QUILLADIN, LATIAS);
  const g = scenario(dk, dk, [
    { active: 'Golisopod', energy: { active: [W] } },
    { active: 'Dunsparce', bench: ['Quilladin'], damage: { active: 40 }, energy: { 0: [G, G, G] } },
  ]);
  choose(g, 'Attack: Critical Slash');
  assert.equal(g.state.p[0].prizes.length, 5, 'the Dunsparce was Knocked Out');
  choose(g, 'Quilladin'); // the opponent promotes
  assert.equal(g.state.current, 1);
  choose(g, 'Attack: Vine Whip');
  assert.equal(g.state.p[0].active!.damage, 0, 'all damage to Golisopod is prevented');
  // Not Knocked Out: the Defending Pokémon is hit for 30 and Golisopod is not protected.
  const h = scenario(dk, dk, [{ active: 'Golisopod', energy: { active: [W] } }, { active: 'Quilladin', energy: { active: [G, G, G] } }]);
  choose(h, 'Attack: Critical Slash');
  assert.equal(h.state.p[1].active!.damage, 30);
  choose(h, 'Attack: Vine Whip');
  assert.equal(h.state.p[0].active!.damage, 80);
});

test("Golisopod, Boundless Power: 150, and during your next turn this Pokémon can't use attacks", () => {
  const dk = deck('me04-026', LATIAS);
  const g = scenario(dk, dk, [{ active: 'Golisopod', energy: { active: [W, W, W] } }, { active: 'Mega Latias ex' }]);
  choose(g, 'Attack: Boundless Power');
  assert.equal(g.state.p[1].active!.damage, 150);
  endTurn(g); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack:'), "can't use attacks during your next turn");
  endTurn(g);
  endTurn(g);
  assert.ok(has(g, 'Attack: Boundless Power'), 'the turn after, it can');
});

// ------------------------------------------------------------------ Ampharos

test('Ampharos, Synchro Pulse: attacks do 80 more to the Active Pokémon while you and your opponent have the same number of cards in hand', () => {
  const dk = deck('me04-029', LATIAS);
  const hit = (h0: string[], h1: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Ampharos', energy: { active: ['Lightning Energy', W] }, hand: h0 }, { active: 'Mega Latias ex', hand: h1 }]);
    choose(g, 'Attack: Flashing Bolt');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([], []), 220, '0 and 0 cards');
  assert.equal(hit([F, W], [G, P]), 220, '2 and 2 cards');
  assert.equal(hit([F, W], [G]), 140, '2 and 1 cards');
  assert.equal(hit([F], [G, P]), 140);
});

test("Ampharos, Flashing Bolt: during your next turn, this Pokémon can't use Flashing Bolt", () => {
  const dk = deck('me04-029', LATIAS);
  const g = scenario(dk, dk, [{ active: 'Ampharos', energy: { active: ['Lightning Energy', W] } }, { active: 'Mega Latias ex' }]);
  choose(g, 'Attack: Flashing Bolt');
  endTurn(g);
  assert.ok(!has(g, 'Attack: Flashing Bolt'));
  endTurn(g);
  endTurn(g);
  assert.ok(has(g, 'Attack: Flashing Bolt'), 'usable again the turn after');
});

// ------------------------------------------------------------------ Deoxys

test("Deoxys (Genome Charge / Psychic): up to 2 Basic {P} Energy from the deck onto it; 80 plus 20 for each Energy on the opponent's Active Pokémon", () => {
  const dk = deck('me04-031', LATIAS);
  const g = scenario(dk, dk, [{ active: 'Deoxys', energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
  choose(g, 'Attack: Genome Charge');
  assert.ok(labels(g).every((l) => l.includes(P)), 'only Basic {P} Energy');
  pick(g, [P, P]);
  assert.deepEqual(energyNames(g, 0, 'active'), [F, P, P].sort());
  const hit = (oppEnergy: string[]): number => {
    const h = scenario(dk, dk, [{ active: 'Deoxys', energy: { active: [P, P, F] } }, { active: 'Mega Latias ex', energy: { active: oppEnergy } }]);
    choose(h, 'Attack: Psychic');
    return h.state.p[1].active!.damage;
  };
  assert.equal(hit([]), 80);
  assert.equal(hit([W, W, F]), 140, '3 Energy');
});

test("Deoxys, Psyspear: 120; with at least 2 extra Energy attached, also 120 to 1 of your opponent's Benched Pokémon, with no Weakness", () => {
  const dk = deck('me04-032', LATIAS, OKIDOGI);
  const run = (energy: string[], bench: string[] = ['Okidogi']): Game => {
    const g = scenario(dk, dk, [{ active: 'Deoxys', energy: { active: energy } }, { active: 'Mega Latias ex', bench }]);
    choose(g, 'Attack: Psyspear');
    return g;
  };
  const three = run([P, P, P]);
  assert.equal(three.state.p[1].active!.damage, 120);
  assert.equal(three.state.p[1].bench[0]!.damage, 0, 'no extra Energy');
  assert.equal(run([P, P, P, F]).state.p[1].bench[0]!.damage, 0, '1 extra Energy is not enough');
  const five = run([P, P, P, F, F]);
  assert.equal(five.state.p[1].active!.damage, 120);
  assert.equal(five.state.p[1].bench[0]!.damage, 120, 'Okidogi is weak to {P} but Weakness is not applied to the Bench');
  // No Benched Pokémon: just the 120.
  const alone = run([P, P, P, F, F], []);
  assert.equal(alone.state.p[1].active!.damage, 120);
});
