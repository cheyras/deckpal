/**
 * Card tests, batch "std-engine7": every card scripted in cards/scripts/std-engine7.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from the frames.
 * The engine features themselves are tested in engine-features-7.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, StaticEffect } from '../dsl.js';
import * as evalMod from '../eval.js';
import { advance, legalActions } from '../flow.js';
import { Game } from '../game.js';
import { energyUnits, maxHp } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
import { CONFUSED, type Decision } from '../types.js';
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
/** Answer a slot decision with the Pokémon whose slot id this is. */
function pickSlot(g: Game, id: number): void {
  const i = (g.decision!.values as number[]).indexOf(id);
  assert.ok(i >= 0, `slot ${id} is not offered: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
/** Answer a cards decision with the cards of these names (in the order given). */
function pickCards(g: Game, wanted: string[]): void {
  const vals = (g.decision!.values as number[]).slice();
  const idx: number[] = [];
  for (const n of wanted) {
    const i = vals.findIndex((c, j) => nameOf(g, c) === n && !idx.includes(j));
    assert.ok(i >= 0, `no ${n} among: ${vals.map((c) => nameOf(g, c)).join(', ')}`);
    idx.push(i);
  }
  g.submit(idx);
}
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c));
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);
const acts = (g: Game, p: 0 | 1 = 0) => legalActions(g.env, g.state, p);
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Dreepy: 'sv06-128', // Dragon, 70 HP, no Weakness; Petty Grudge {P} 10
  Chikorita: 'me01-008', // Grass, 70 HP, Fire-weak
  Bayleef: 'me01-009',
  Meganium: 'me01-010', // Stage 2, 160 HP
  "N's Darumaka": 'me02.5-032', // Fire, 80 HP; Rolling Tackle {C}{C} 20
  Squawkabilly: 'sv09-141', // Colorless, 70 HP, Lightning-weak
  'Rotom ex': 'me02-029',
  'Fan Rotom': 'me02.5-171',
  "Hero's Cape": 'sv05-152',
  'Air Balloon': 'me01-166',
  Minccino: 'me04-072',
  'Cinccino ex': 'me04-073',
  Fezandipiti: 'sv06-096',
  'Legacy Energy': 'sv06-167',
  Kecleon: 'sv08-150',
  'Tatsugiri ex': 'sv08-142',
  Goomy: 'me04-066',
  Sliggoo: 'me04-095',
  Goodra: 'me04-068',
  'Backtrack Badge': 'me05-074',
  'Mega Kangaskhan ex': 'me01-104', // Colorless, 300 HP, Fighting-weak
  Bewear: 'me01-112',
  'Dizzying Valley': 'me02-088',
  'Rare Candy': 'me01-125',
  'Teal Mask Ogerpon ex': 'sv06-025',
  'Nighttime Mine': 'me02.5-197',
  Cinderace: 'me01-028',
  Scorbunny: 'me01-026',
  Raboot: 'me01-027',
  Manectric: 'me05-024',
  'Tremendous Bomb': 'me05-082',
  Amarys: 'sv08.5-093',
  'Iron Treads': 'sv05-118',
  Finizen: 'sv06-059',
  Palafin: 'sv06-060',
  'Palafin ex': 'sv06-061',
  'Flutter Mane': 'sv05-078',
  Switch: 'me01-130',
  "Boss's Orders": 'me01-114',
  Feebas: 'sv06-049',
  Milotic: 'sv06-050',
  Froakie: 'me04-020',
  Frogadier: 'me04-021',
  'Mega Greninja ex': 'me04-022',
  'Meowth ex': 'me03-062',
  'Ange Floette': 'me04-075',
  'Prism Tower': 'me04-080',
  'Mega Floette ex': 'me04-035',
  'Nitro Fire Energy': 'me04-086',
  Charmander: 'mep-038',
  Relicanth: 'sv05-084',
  Rowlet: 'me03-010',
  Dartrix: 'me03-011',
  'Decidueye ex': 'me03-012',
  'Neutralization Zone': 'sv06.5-060',
  'Poké Vital A': 'sv06.5-062',
  "Team Rocket's Energy": 'me02.5-217',
  "Team Rocket's Zubat": 'sv10-120',
  "Team Rocket's Mewtwo ex": 'me02.5-079',
  Spheal: 'sv08-043',
  Walrein: 'sv08-045',
  Klang: 'sv07-100',
  Klinklang: 'sv07-101',
  Dedenne: 'sv08-087',
  Potion: 'me03-083',
};
function deck(...cards: string[]): DeckInput {
  return fromIds('engine7', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const FIR = 'Fire Energy';
const GRS = 'Grass Energy';
const WTR = 'Water Energy';
const LGT = 'Lightning Energy';
const PSY = 'Psychic Energy';
const FGT = 'Fighting Energy';
const DRK = 'Darkness Energy';
const MTL = 'Metal Energy';

/** A player-level timed effect on a player (or on that player's Pokémon). */
function injectPlayer(g: Game, player: 0 | 1, st: StaticEffect, scope?: 'myPokemon' | 'allPokemon'): void {
  g.state.effects.push({ static: st, slot: -1, player, until: g.state.turn + 1, fromAttack: false, src: 0, ...(scope ? { scope } : {}) });
}
/** An attack of this card that does `amount` damage and nothing else (a stand-in: the cost stays the printed one). */
const hits = (id: string, name: string, attack: string, amount: number): CardScript => ({ id, name, attacks: { [attack]: { program: [{ op: 'damage', amount, to: 'defender' }] } } });
const DARUMAKA_20 = (amount = 20): CardScript => hits('me02.5-032', "N's Darumaka", 'Rolling Tackle', amount);
const tackle = (g: Game): void => choose(g, 'Attack: Rolling Tackle');

// ------------------------------------------------------------------ Rotom ex

test('Rotom ex, Multi Adapter: each of your Pokémon with "Rotom" in its name may have up to 2 Tools; the others still 1 (rulings 2242, 2292)', () => {
  const dk = deck('Rotom ex', 'Fan Rotom', 'Dreepy', "Hero's Cape", 'Air Balloon');
  const g = scenario(dk, dk, [{ active: 'Rotom ex', bench: ['Fan Rotom', 'Dreepy'], tools: { active: ["Hero's Cape"], 0: ["Hero's Cape"], 1: ["Hero's Cape"] }, hand: ['Air Balloon'] }, { active: 'Dreepy' }]);
  const rotom = g.state.p[0].active!;
  const fan = g.state.p[0].bench[0]!;
  const targets = acts(g).filter((a) => a.t === 'tool').map((a) => (a as { slot: number }).slot);
  // Ruling (TPCi Rules Team 2025-11-13, 2242): "Sure, any Pokemon with Rotom in its name qualifies." (2026-01-22, 2292: Fan Rotom and Rotom ex.)
  assert.deepEqual(targets.sort(), [rotom.id, fan.id].sort(), 'Rotom ex and Fan Rotom, not the Dreepy');
  choose(g, 'Attach Air Balloon to Fan Rotom');
  assert.equal(fan.tools.length, 2);
  assert.equal(maxHp(g.env, g.state, fan), 170, "both Tools work: Hero's Cape +100");
  assert.ok(!acts(g).some((a) => a.t === 'tool' && (a as { slot: number }).slot === fan.id), 'two is the most');
});

test('Rotom ex, Multi Adapter: if the Ability goes away, Tools are discarded from those Pokémon until only 1 remains on each; their owner chooses', () => {
  const dk = deck('Rotom ex', 'Fan Rotom', 'Dreepy', "Hero's Cape", 'Air Balloon');
  const g = scenario(dk, dk, [{ active: 'Fan Rotom', bench: ['Rotom ex'], tools: { active: ["Hero's Cape", 'Air Balloon'], 0: ["Hero's Cape"] }, hand: [FIR] }, { active: 'Dreepy' }]);
  choose(g, 'Attach Fire Energy to Fan Rotom');
  assert.equal(g.state.p[0].active!.tools.length, 2, 'the Ability is on: nothing to discard');
  // The Ability goes away (here: an effect of the opponent's takes the Abilities of Rotom ex away).
  g.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 1, until: g.state.turn + 1, fromAttack: false, src: 0, scope: 'oppPokemon', filter: { name: 'Rotom ex' } });
  g.state.p[0].energyAttached = false;
  g.state.p[0].hand.push(g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((c) => nameOf(g, c) === 'Fire Energy'), 1)[0]!);
  refresh(g);
  choose(g, 'Attach Fire Energy to Rotom ex');
  assert.equal(g.decision!.player, 0);
  assert.match(g.decision!.prompt, /Discard 1 Pokémon Tool card from Fan Rotom/);
  assert.equal(g.state.p[0].bench[0]!.tools.length, 1, 'Rotom ex has its 1');
  pickCards(g, ['Air Balloon']);
  assert.deepEqual(names(g, g.state.p[0].active!.tools), ["Hero's Cape"]);
});

test('Rotom ex, Thunderbolt: 130 damage, then all Energy discarded from it', () => {
  const dk = deck('Rotom ex', 'Mega Kangaskhan ex');
  const g = scenario(dk, dk, [{ active: 'Rotom ex', energy: { active: [LGT, LGT, FIR] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Attack: Thunderbolt');
  assert.equal(g.state.p[1].active!.damage, 130);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.equal(g.state.p[0].discard.length, 3);
});

// ------------------------------------------------------------------ Damage-time coin flips

test('Cinccino ex, Smooth Coat: if any damage is done to it by attacks, flip a coin; heads prevents it', () => {
  const dk = deck('Minccino', 'Cinccino ex', "N's Darumaka");
  const mk = (coin: boolean | null): Game => {
    const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Minccino', evolve: { active: ['Cinccino ex'] } }], { scripts: [DARUMAKA_20()], events: true });
    if (coin !== null) g.state.forcedCoins = [coin];
    tackle(g);
    return g;
  };
  assert.equal(mk(true).state.p[1].active!.damage, 0, 'heads: prevented');
  assert.equal(mk(false).state.p[1].active!.damage, 20, 'tails: the damage is done');
  const flips = mk(true).events.filter((e) => e.type === 'coin_flip');
  assert.deepEqual(flips.map((e) => (e as { player: number }).player), [1], "the Pokémon's owner flips");
});

test('Cinccino ex, Energized Slap: 40 damage for each Energy attached to this Pokémon', () => {
  const dk = deck('Minccino', 'Cinccino ex', 'Mega Kangaskhan ex');
  const g = scenario(dk, dk, [{ active: 'Minccino', evolve: { active: ['Cinccino ex'] }, energy: { active: [FIR, WTR, GRS] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Attack: Energized Slap');
  assert.equal(g.state.p[1].active!.damage, 120);
  const one = scenario(dk, dk, [{ active: 'Minccino', evolve: { active: ['Cinccino ex'] }, energy: { active: [FIR] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(one, 'Attack: Energized Slap');
  assert.equal(one.state.p[1].active!.damage, 40);
});

test('Fezandipiti, Adrena-Pheromone: with any {D} Energy attached, a coin is flipped when it is damaged by an attack; heads prevents it', () => {
  const dk = deck('Fezandipiti', "N's Darumaka", 'Legacy Energy');
  const mk = (energy: string[], coin = true): Game => {
    const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Fezandipiti', energy: { active: energy } }], { scripts: [DARUMAKA_20()] });
    g.state.forcedCoins = [coin];
    tackle(g);
    return g;
  };
  const d = mk([DRK]);
  assert.equal(d.state.p[1].active!.damage, 0, 'a Darkness Energy: heads, prevented');
  assert.equal(d.state.forcedCoins.length, 0);
  assert.equal(mk([DRK], false).state.p[1].active!.damage, 20, 'tails: damaged');
  const none = mk([PSY]);
  assert.equal(none.state.p[1].active!.damage, 20, 'no {D} Energy: no flip');
  assert.equal(none.state.forcedCoins.length, 1);
  const bare = mk([]);
  assert.equal(bare.state.forcedCoins.length, 1);
  // Ruling (TPCi Rules Team 2024-05-23, 1969): Legacy Energy provides all types all the time, so it counts as {D} Energy.
  const legacy = mk(['Legacy Energy']);
  assert.equal(legacy.state.p[1].active!.damage, 0);
  assert.equal(legacy.state.forcedCoins.length, 0, 'it flipped');
});

test('Fezandipiti, Energy Feather: 30 damage for each Energy attached; with only Legacy Energy it attacks and is protected too (ruling 1969)', () => {
  const dk = deck('Fezandipiti', 'Mega Kangaskhan ex', "N's Darumaka", 'Legacy Energy');
  const g = scenario(dk, dk, [{ active: 'Fezandipiti', energy: { active: [PSY, DRK, FIR] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Attack: Energy Feather');
  assert.equal(g.state.p[1].active!.damage, 90);
  // "Yes, although Legacy Energy only provides one unit of energy, it is providing all energy types all the time."
  const l = scenario(dk, dk, [{ active: 'Fezandipiti', energy: { active: ['Legacy Energy'] } }, { active: "N's Darumaka", energy: { active: [FIR, FIR] } }], { scripts: [DARUMAKA_20()] });
  choose(l, 'Attack: Energy Feather');
  assert.equal(l.state.p[1].active!.damage, 30, 'one Energy: 30');
  // The opponent's turn: the Ability protects it.
  assert.equal(l.state.current, 1);
  l.state.forcedCoins = [true];
  tackle(l);
  assert.equal(l.state.p[0].active!.damage, 0);
});

test('Kecleon, Expert Hider: a coin flip when it is damaged by an attack; not for an attack that is not affected by effects on the Defending Pokémon (ruling 2040)', () => {
  const dk = deck('Kecleon', "N's Darumaka", 'Tatsugiri ex', 'Dreepy');
  const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Kecleon', bench: ['Dreepy'] }], { scripts: [DARUMAKA_20()] });
  g.state.forcedCoins = [true];
  tackle(g);
  assert.equal(g.state.p[1].active!.damage, 0);
  // Tatsugiri ex's Surprise Pump: "This attack's damage isn't affected by any effects on your opponent's Active Pokémon."
  // Ruling (TPCi Rules Team 2024-11-07, 2040): "Surprise Pump will do 100 damage. The attack ignores the damage reduction because Expert Hider is an effect."
  const t = scenario(dk, dk, [{ active: 'Tatsugiri ex', energy: { active: [FIR, WTR] } }, { active: 'Kecleon', bench: ['Dreepy'] }]);
  t.state.forcedCoins = [true];
  choose(t, 'Attack: Surprise Pump');
  assert.equal(t.state.forcedCoins.length, 1, 'no coin was flipped');
  assert.equal(t.state.p[0].prizesTaken, 1, '100 damage Knocked Out the 70-HP Kecleon');
});

test('Kecleon, Lick Whip: 30 damage to 1 of your opponent\'s Pokémon (no Weakness or Resistance for a Benched one)', () => {
  const dk = deck('Kecleon', 'Dreepy', 'Chikorita', 'Squawkabilly');
  const g = scenario(dk, dk, [{ active: 'Kecleon', energy: { active: [FIR, FIR] } }, { active: 'Squawkabilly', bench: ['Chikorita', 'Dreepy'] }]);
  choose(g, 'Attack: Lick Whip');
  assert.equal(g.decision!.kind, 'slots');
  pickSlot(g, g.state.p[1].bench[0]!.id);
  assert.equal(g.state.p[1].bench[0]!.damage, 30);
  assert.equal(g.state.p[1].active!.damage, 0);
  const a = scenario(dk, dk, [{ active: 'Kecleon', energy: { active: [FIR, FIR] } }, { active: 'Squawkabilly', bench: ['Chikorita'] }]);
  choose(a, 'Attack: Lick Whip');
  pickSlot(a, a.state.p[1].active!.id);
  assert.equal(a.state.p[1].active!.damage, 30, 'no Weakness on Squawkabilly for a Colorless attacker');
});

test('Goodra, Slimy Sliding: when the opponent retreats, they flip; tails and nothing is discarded and they stay, the retreat used up (ruling 2348); it does not touch your own retreat', () => {
  const dk = deck('Goomy', 'Sliggoo', 'Goodra', 'Dreepy', 'Chikorita');
  const mk = (retreating: 0 | 1): Game => {
    const goodra: SideLayout = { active: 'Goomy', evolve: { active: ['Sliggoo', 'Goodra'] }, bench: ['Chikorita'], energy: { active: [WTR] } };
    const other: SideLayout = { active: 'Dreepy', bench: ['Chikorita'], energy: { active: [PSY] } };
    return retreating === 1 ? scenario(dk, dk, [goodra, other], { current: 1, first: 0, turn: 4 }) : scenario(dk, dk, [other, goodra], { current: 0, first: 0, turn: 3 });
  };
  const g = mk(1);
  const dreepy = g.state.p[1].active!;
  g.state.forcedCoins = [false];
  choose(g, 'Retreat');
  assert.equal(g.state.p[1].active, dreepy, "tails: they don't switch");
  assert.equal(dreepy.energy.length, 1, 'the Energy for the Retreat Cost is not discarded');
  assert.ok(!has(g, 'Retreat'), "the retreat for the turn is used up: they can't try again");
  const h = mk(1);
  h.state.forcedCoins = [true];
  choose(h, 'Retreat');
  assert.equal(nameOf(h, h.state.p[1].active!.cards[0]!), 'Chikorita', 'heads: it retreats as usual');
  // Your own retreat: no flip.
  const mine = scenario(dk, dk, [{ active: 'Goomy', evolve: { active: ['Sliggoo', 'Goodra'] }, bench: ['Chikorita'], energy: { active: [WTR, PSY, FIR] } }, { active: 'Dreepy' }]);
  mine.state.forcedCoins = [false];
  choose(mine, 'Retreat');
  assert.equal(mine.state.forcedCoins.length, 1, 'no flip for the Goodra player');
});

test('Goodra, Dragon Pulse: 160 damage, then the top card of your deck is discarded', () => {
  const dk = deck('Goomy', 'Sliggoo', 'Goodra', 'Mega Kangaskhan ex');
  const g = scenario(dk, dk, [{ active: 'Goomy', evolve: { active: ['Sliggoo', 'Goodra'] }, energy: { active: [WTR, PSY] } }, { active: 'Mega Kangaskhan ex' }]);
  const top = g.state.p[0].deck[g.state.p[0].deck.length - 1]!;
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Attack: Dragon Pulse');
  assert.equal(g.state.p[1].active!.damage, 160);
  assert.equal(g.state.p[0].deck.length, deckSize - 1);
  assert.ok(g.state.p[0].discard.includes(top));
});

// ------------------------------------------------------------------ Backtrack Badge

test('Backtrack Badge: after the coin flips of an attack of the {C} Pokémon, you may ignore them and flip them again (once during your turn)', () => {
  const dk = deck('Mega Kangaskhan ex', 'Mega Greninja ex', "Backtrack Badge", 'Dreepy');
  const mk = (): Game => scenario(dk, dk, [{ active: 'Mega Kangaskhan ex', energy: { active: [FIR, FIR, FIR] }, tools: { active: ['Backtrack Badge'] } }, { active: 'Mega Greninja ex' }]);
  // Rapid-Fire Combo: "Flip a coin until you get tails. This attack does 50 more damage for each heads." (200 + 50 for each heads)
  const no = mk();
  no.state.forcedCoins = [true, true, false];
  choose(no, 'Attack: Rapid-Fire Combo');
  assert.equal(no.decision!.kind, 'yesno');
  assert.match(no.decision!.prompt, /flip them again/);
  no.submit([1]);
  assert.equal(no.state.p[1].active!.damage, 300, 'kept: 2 heads');
  const yes = mk();
  yes.state.forcedCoins = [true, true, false, true, false];
  choose(yes, 'Attack: Rapid-Fire Combo');
  yes.submit([0]);
  assert.equal(yes.state.p[1].active!.damage, 250, 'the new flips count: 1 heads');
  // The Tool is spent for this turn; the next turn it is back.
  assert.equal(yes.state.p[0].toolUsed!.length, 1);
  // A Pokémon that is not {C}: no question.
  const fire = scenario(dk, dk, [{ active: 'Mega Kangaskhan ex', energy: { active: [FIR, FIR, FIR] } }, { active: 'Mega Greninja ex' }]);
  fire.state.forcedCoins = [false];
  choose(fire, 'Attack: Rapid-Fire Combo');
  assert.equal(fire.state.p[1].active!.damage, 200, 'no Tool: no question');
});

test('Backtrack Badge: all the attack\'s flips are flipped again, never only the tails (ruling 2416)', () => {
  const dk = deck('Bewear', 'Mega Greninja ex', 'Backtrack Badge');
  const mk = (): Game => scenario(dk, dk, [{ active: 'Bewear', energy: { active: [FIR, FIR, FIR] }, tools: { active: ['Backtrack Badge'] } }, { active: 'Mega Greninja ex' }]);
  // Hyper Lariat: "Flip 2 coins. If both of them are heads, this attack does 100 more damage."
  const g = mk();
  g.state.forcedCoins = [true, false, true, true];
  choose(g, 'Attack: Hyper Lariat');
  g.submit([0]);
  assert.equal(g.state.p[1].active!.damage, 200, 'heads and heads on the second try: the first heads was flipped again too');
  assert.equal(g.state.forcedCoins.length, 0, 'both coins were flipped again (4 coins in all)');
});

test('Backtrack Badge: not for the Confusion flip, only for the flips that are part of the attack (ruling 2417)', () => {
  const dk = deck('Mega Kangaskhan ex', 'Mega Greninja ex', 'Backtrack Badge');
  const g = scenario(dk, dk, [{ active: 'Mega Kangaskhan ex', energy: { active: [FIR, FIR, FIR] }, tools: { active: ['Backtrack Badge'] }, cond: CONFUSED }, { active: 'Mega Greninja ex' }]);
  // Confusion's flip (heads: the attack goes on), then the attack's own flips (tails at once: 0 heads).
  g.state.forcedCoins = [true, false, true, false, true];
  choose(g, 'Attack: Rapid-Fire Combo');
  assert.equal(g.decision!.kind, 'yesno', "asked after the attack's flips, not after Confusion's");
  assert.equal(g.state.forcedCoins.length, 3, "Confusion's coin and the attack's one were flipped");
  g.submit([0]);
  assert.equal(g.state.forcedCoins.length, 1, "only the attack's flips again (heads, tails): Confusion's was not flipped again");
  assert.equal(g.state.p[1].active!.damage, 250);
});

// ------------------------------------------------------------------ Dizzying Valley

test('Dizzying Valley: Confused Pokémon, yours and your opponent\'s, don\'t recover from Confusion when they evolve', () => {
  const dk = deck('Chikorita', 'Bayleef', 'Dizzying Valley');
  const mk = (valley: boolean, side: 0 | 1): Game => {
    const lay = (confused: boolean): SideLayout => ({ active: 'Chikorita', hand: ['Bayleef'], ...(confused ? { cond: CONFUSED } : {}) });
    const g = side === 0 ? scenario(dk, dk, [lay(true), lay(false)], { turn: 4 }) : scenario(dk, dk, [lay(false), lay(true)], { current: 1, first: 0, turn: 4 });
    g.state.p[side].active!.enteredTurn = 0;
    if (valley) {
      const owner = side === 0 ? 1 : 0; // the Stadium can be either player's
      const c = g.state.p[owner].deck.splice(g.state.p[owner].deck.findIndex((x) => nameOf(g, x) === 'Dizzying Valley'), 1)[0]!;
      g.state.stadium = { card: c, owner };
    }
    refresh(g);
    return g;
  };
  for (const side of [0, 1] as const) {
    const g = mk(true, side);
    choose(g, 'Evolve Chikorita (Active) into Bayleef');
    assert.equal(g.state.p[side].active!.cond, CONFUSED, `player ${side + 1}'s Pokémon is still Confused`);
    const n = mk(false, side);
    choose(n, 'Evolve Chikorita (Active) into Bayleef');
    assert.equal(n.state.p[side].active!.cond, 0, 'without the Stadium it recovers');
  }
  // The Stadium leaves play: the next evolution clears it again.
  const h = mk(true, 0);
  h.state.stadium = null;
  refresh(h);
  choose(h, 'Evolve Chikorita (Active) into Bayleef');
  assert.equal(h.state.p[0].active!.cond, 0);
});

// ------------------------------------------------------------------ Meganium

test('Meganium, Wild Growth: each Basic {G} Energy on your Pokémon provides {G}{G}; everything that counts attached Energy counts the extra (rulings 2237, 2288)', () => {
  const dk = deck('Teal Mask Ogerpon ex', 'Chikorita', 'Bayleef', 'Meganium', 'Mega Greninja ex', 'Nighttime Mine');
  const mk = (wild: boolean, energy = [GRS, GRS, GRS]): Game =>
    scenario(dk, dk, [{ active: 'Teal Mask Ogerpon ex', energy: { active: energy }, bench: ['Chikorita'], ...(wild ? { evolve: { 0: ['Bayleef', 'Meganium'] } } : {}) }, { active: 'Mega Greninja ex' }]);
  // Myriad Leaf Shower: "This attack does 30 more damage for each Energy attached to both Active Pokémon."
  // Ruling (TPCi Rules Team 2025-10-23, 2237): with 3 Basic {G} Energy and none on the Defending Pokémon "You get +180 more damage."
  const g = mk(true);
  choose(g, 'Attack: Myriad Leaf Shower');
  assert.equal(g.state.p[1].active!.damage, 30 + 180);
  const bare = mk(false);
  choose(bare, 'Attack: Myriad Leaf Shower');
  assert.equal(bare.state.p[1].active!.damage, 30 + 90, 'without Wild Growth, +90');
  // Ruling (Ascending Heroes FAQ 2026-01-22, 2288): Nighttime Mine makes the Tera Pokémon's attack cost {C} more; 2 Basic {G} Energy count as 4.
  const mine = (wild: boolean): Game => {
    const m = mk(wild, [GRS, GRS]);
    const c = m.state.p[0].deck.splice(m.state.p[0].deck.findIndex((x) => nameOf(m, x) === 'Nighttime Mine'), 1)[0]!;
    m.state.stadium = { card: c, owner: 0 };
    refresh(m);
    return m;
  };
  assert.ok(has(mine(true), 'Attack: Myriad Leaf Shower'), 'yes: the cost of 4 is paid by 4 Energy');
  assert.ok(!has(mine(false), 'Attack: Myriad Leaf Shower'), 'without Wild Growth, 2 Energy do not pay 4');
});

test('Meganium, Wild Growth: only Basic {G} Energy, only your Pokémon (Active and Benched); two copies do not add up (ruling 2236)', () => {
  const dk = deck('Chikorita', 'Bayleef', 'Meganium', 'Dreepy');
  const g = scenario(dk, dk, [
    { active: 'Dreepy', bench: ['Chikorita', 'Chikorita'], energy: { active: [GRS, FIR], 0: [GRS], 1: [GRS] }, evolve: { 0: ['Bayleef', 'Meganium'] } },
    { active: 'Chikorita', energy: { active: [GRS, GRS] } },
  ]);
  const units = (p: 0 | 1, slot: 'active' | number): number => {
    const sl = slot === 'active' ? g.state.p[p].active! : g.state.p[p].bench[slot]!;
    return energyUnits(g.env, sl, g.state).length;
  };
  assert.equal(units(0, 'active'), 3, 'Basic {G} counts 2, the Fire Energy 1');
  assert.equal(units(0, 0), 2, 'on the Bench: the Meganium itself');
  assert.equal(units(0, 1), 2);
  assert.equal(units(1, 'active'), 2, "your opponent's Energy is as it was");
  // Ruling (TPCi Rules Team 2025-10-23, 2236): "Each Ability is a replacement effect, not an additive effect... you would still wind up with each Basic Grass energy providing 2 Grass energy."
  const two = scenario(dk, dk, [
    { active: 'Chikorita', bench: ['Chikorita', 'Chikorita'], energy: { active: [GRS, GRS] }, evolve: { 0: ['Bayleef', 'Meganium'], 1: ['Bayleef', 'Meganium'] } },
    { active: 'Dreepy' },
  ]);
  assert.equal(energyUnits(two.env, two.state.p[0].active!, two.state.p[0].bench.length ? two.state : two.state).length, 4, 'two Meganium: still {G}{G} for each');
  // Wild Growth goes away with the Pokémon: the Energy provides what it prints again.
  const lost = scenario(dk, dk, [{ active: 'Chikorita', bench: ['Chikorita'], energy: { active: [GRS, GRS] }, evolve: { 0: ['Bayleef', 'Meganium'] } }, { active: 'Dreepy' }]);
  assert.equal(energyUnits(lost.env, lost.state.p[0].active!, lost.state).length, 4);
  lost.state.p[0].bench = [];
  assert.equal(energyUnits(lost.env, lost.state.p[0].active!, lost.state).length, 2);
});

// ------------------------------------------------------------------ Cinderace

test('Cinderace, Explosiveness: if it is in your hand when you set up, you may put it face down in the Active Spot', () => {
  const list = fromIds('cinderace', [['me01-028', 30], ['me01-026', 10], ['mee-002', 20]]);
  let tested = 0;
  for (let seed = 1; seed <= 30 && tested < 2; seed++) {
    const s = new Game(list, list, seed, { first: 0 }).start();
    let guard = 0;
    while (s.decision && s.decision.kind !== 'setupActive' && guard++ < 10) s.submit([0]);
    const d = s.decision!;
    const inHand = s.state.p[d.player].hand.filter((c) => nameOf(s, c) === 'Cinderace');
    if (!inHand.length) continue;
    tested++;
    assert.ok(inHand.every((c) => (d.values as number[]).includes(c)), 'offered as an Active Pokémon');
    s.submit([(d.values as number[]).indexOf(inHand[0]!)]);
    const active = s.state.p[d.player].active!;
    assert.equal(nameOf(s, active.cards[0]!), 'Cinderace');
    assert.ok(!s.state.p[d.player].hand.includes(inHand[0]!));
    // The rest of setup goes on as usual: the other Pokémon go to the Bench and the game begins.
    let more = 0;
    while (s.decision && s.state.phase === 'setup' && more++ < 20) s.submit(s.decision.kind === 'setupBench' ? [] : [0]);
    assert.equal(s.state.phase, 'main');
  }
  assert.ok(tested > 0);
});

test('Cinderace is an Evolution Pokémon even when put into play this way, so effects about Evolution Pokémon apply (rulings 2394, 2397)', () => {
  const dk = deck('Cinderace', 'Dreepy', 'Manectric');
  // Manectric's Flashing Barrier: "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Evolution Pokémon."
  const mk = (attacker: string): Game => {
    const g = scenario(dk, dk, [{ active: attacker, energy: { active: [FIR, PSY] } }, { active: 'Manectric', energy: { active: [LGT, LGT] } }], { current: 1, first: 0, turn: 4 });
    choose(g, 'Attack: Flashing Barrier');
    return g;
  };
  // Ruling (TPCi Rules Team 2026-07-16, 2397): "Yes. Even though Cinderace is not an "Evolved Pokemon" it is still an "Evolution Pokemon" card, and therefore meets the condition of Flashing Barrier to have its damage blocked."
  const c = mk('Cinderace');
  assert.equal(c.state.p[0].active!.cards.length, 1, 'a lone Stage 2 card, as after Explosiveness');
  choose(c, 'Attack: Turbo Flare');
  assert.equal(c.state.p[1].active!.damage, 0, 'blocked');
  const d = mk('Dreepy');
  choose(d, 'Attack: Petty Grudge');
  assert.equal(d.state.p[1].active!.damage, 10, 'a Basic Pokémon is not blocked');
});

test('Cinderace, Turbo Flare: 50 damage; search your deck for up to 3 Basic Energy cards and attach them to your Benched Pokémon in any way you like; shuffle', () => {
  const dk = deck('Cinderace', 'Dreepy', 'Chikorita', 'Mega Kangaskhan ex');
  const g = scenario(dk, dk, [{ active: 'Cinderace', energy: { active: [FIR] }, bench: ['Chikorita', 'Dreepy'] }, { active: 'Mega Kangaskhan ex' }]);
  const [chik, dree] = g.state.p[0].bench;
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Turbo Flare');
  assert.equal(g.state.p[1].active!.damage, 50);
  // First Energy: a Fire Energy to Chikorita.
  assert.equal(g.decision!.kind, 'cards');
  pickCards(g, ['Fire Energy']);
  pickSlot(g, chik!.id);
  pickCards(g, ['Water Energy']);
  pickSlot(g, dree!.id);
  pickCards(g, ['Fire Energy']);
  pickSlot(g, chik!.id);
  assert.deepEqual(names(g, chik!.energy), ['Fire Energy', 'Fire Energy']);
  assert.deepEqual(names(g, dree!.energy), ['Water Energy']);
  assert.equal(g.state.p[0].deck.length, deckBefore - 3);
  assert.equal(g.state.p[0].active!.energy.length, 1, 'only Benched Pokémon');
  // "Up to 3": it can stop early.
  const h = scenario(dk, dk, [{ active: 'Cinderace', energy: { active: [FIR] }, bench: ['Chikorita'] }, { active: 'Mega Kangaskhan ex' }]);
  choose(h, 'Attack: Turbo Flare');
  pickCards(h, ['Grass Energy']); // (one Benched Pokémon: no question where)
  h.submit([]); // none this time
  assert.equal(h.state.p[0].bench[0]!.energy.length, 1);
  assert.equal(h.state.current, 1);
});

// ------------------------------------------------------------------ Tremendous Bomb

test('Tremendous Bomb: 240 or more damage from a Mega Evolution Pokémon ex puts 12 damage counters on the Attacker and discards the Tool', () => {
  const dk = deck('Mega Kangaskhan ex', 'Palafin ex', 'Tremendous Bomb', 'Decidueye ex', 'Dreepy');
  const mk = (attacker: string, holder = 'Palafin ex', damage = 0): Game =>
    scenario(dk, dk, [{ active: attacker, energy: { active: [GRS, GRS, GRS, GRS] } }, { active: holder, tools: { active: ['Tremendous Bomb'] }, damage: { active: damage }, bench: ['Dreepy'] }]);
  // Rapid-Fire Combo: 200 + 50 for each heads.
  const g = mk('Mega Kangaskhan ex');
  g.state.forcedCoins = [true, false];
  choose(g, 'Attack: Rapid-Fire Combo');
  assert.equal(g.state.p[1].active!.damage, 250);
  assert.equal(g.state.p[0].active!.damage, 120, '12 damage counters on the Attacking Pokémon');
  assert.deepEqual(names(g, g.state.p[1].active!.tools), [], 'the Tool was discarded');
  assert.ok(g.state.p[1].discard.some((c) => nameOf(g, c) === 'Tremendous Bomb'));
  // 239 would not do: 200 + 0 heads is 200, below 240.
  const less = mk('Mega Kangaskhan ex');
  less.state.forcedCoins = [false];
  choose(less, 'Attack: Rapid-Fire Combo');
  assert.equal(less.state.p[1].active!.damage, 200);
  assert.equal(less.state.p[0].active!.damage, 0);
  assert.equal(less.state.p[1].active!.tools.length, 1, 'nothing happened to the Tool');
  // 240 from a Pokémon ex that is not a Mega Evolution Pokémon ex: nothing.
  const ex = mk('Decidueye ex');
  choose(ex, 'Attack: Crushing Arrow');
  assert.equal(ex.state.p[1].active!.damage, 240);
  assert.equal(ex.state.p[0].active!.damage, 0);
  assert.equal(ex.state.p[1].active!.tools.length, 1);
});

test('Tremendous Bomb: not on a Mega Evolution Pokémon ex; only the Active Spot; works even if the Pokémon is Knocked Out', () => {
  const dk = deck('Mega Kangaskhan ex', 'Palafin ex', 'Tremendous Bomb', 'Dreepy');
  const KANG = (program: unknown[]): CardScript => ({ id: 'me01-104', name: 'Mega Kangaskhan ex', attacks: { 'Rapid-Fire Combo': { program } } } as CardScript);
  // The Pokémon this card is attached to is a Mega Evolution Pokémon ex: nothing.
  const mega = scenario(dk, dk, [{ active: 'Mega Kangaskhan ex', energy: { active: [FIR, FIR, FIR] } }, { active: 'Mega Kangaskhan ex', tools: { active: ['Tremendous Bomb'] } }]);
  mega.state.forcedCoins = [true, true];
  choose(mega, 'Attack: Rapid-Fire Combo');
  assert.equal(mega.state.p[0].active!.damage, 0);
  // Benched: "is in the Active Spot".
  const bench = scenario(dk, dk, [{ active: 'Mega Kangaskhan ex', energy: { active: [FIR, FIR, FIR] } }, { active: 'Dreepy', bench: ['Palafin ex'], tools: { 0: ['Tremendous Bomb'] } }], {
    scripts: [KANG([{ op: 'damage', amount: 250, to: { each: 'oppBench' } }])],
  });
  choose(bench, 'Attack: Rapid-Fire Combo');
  assert.equal(bench.state.p[1].bench[0]!.damage, 250);
  assert.equal(bench.state.p[0].active!.damage, 0);
  // "(even if this Pokémon is Knocked Out)": 340 HP, 100 damage already, 250 more.
  const ko = scenario(dk, dk, [{ active: 'Mega Kangaskhan ex', energy: { active: [FIR, FIR, FIR] } }, { active: 'Palafin ex', tools: { active: ['Tremendous Bomb'] }, damage: { active: 100 }, bench: ['Dreepy'] }], {
    scripts: [KANG(deal250)],
  });
  choose(ko, 'Attack: Rapid-Fire Combo');
  assert.equal(ko.state.p[0].prizesTaken, 2, 'Palafin ex was Knocked Out');
  assert.equal(ko.state.p[0].active!.damage, 120, 'and the counters went on the Attacker all the same');
  assert.ok(ko.state.p[1].discard.some((c) => nameOf(ko, c) === 'Tremendous Bomb'));
});
const deal250 = [{ op: 'damage' as const, amount: 250, to: 'defender' as const }];

// ------------------------------------------------------------------ Amarys

test('Amarys: draw 4 cards; at the end of the turn, with 5 or more cards in hand, discard the hand', () => {
  const dk = deck('Dreepy', 'Amarys', 'Potion');
  const mk = (extra: string[]): Game => scenario(dk, dk, [{ active: 'Dreepy', hand: ['Amarys', ...extra] }, { active: 'Dreepy' }]);
  const four = mk([]);
  choose(four, 'Play Amarys');
  assert.equal(four.state.p[0].hand.length, 4);
  choose(four, 'End turn');
  assert.equal(four.state.p[0].hand.length, 4, '4 cards: kept');
  const five = mk(['Dreepy']);
  choose(five, 'Play Amarys');
  assert.equal(five.state.p[0].hand.length, 5);
  assert.ok(five.state.p[0].hand.length >= 5 && five.state.p[0].discard.length === 1, 'the Amarys is in the discard pile only');
  choose(five, 'End turn');
  assert.equal(five.state.p[0].hand.length, 0, '5 or more at the end of the turn: discarded');
  assert.equal(five.state.p[0].discard.length, 6, 'Amarys and the 5 cards');
  // Cards played afterwards change the count: down to 4 by playing the Potion.
  const play = mk(['Dreepy', 'Dreepy']);
  choose(play, 'Play Amarys');
  assert.equal(play.state.p[0].hand.length, 6);
  choose(play, 'Bench Dreepy');
  choose(play, 'Bench Dreepy');
  assert.equal(play.state.p[0].hand.length, 4);
  choose(play, 'End turn');
  assert.equal(play.state.p[0].hand.length, 4, 'checked at the end of the turn');
});

test('Amarys: with another effect at the end of the turn, the player chooses the order (ruling 2135)', () => {
  const dk = deck('Dreepy', 'Amarys', 'Potion', "Hero's Cape");
  // A stand-in for Togekiss's "At the end of your turn, if this Pokémon is in the Active Spot, you may draw cards until you have 8 cards in hand."
  const PRECIOUS: CardScript = { id: 'sv05-152', name: "Hero's Cape", triggers: [{ on: 'endOfTurn', program: [{ op: 'draw', n: { sub: [8, { handSize: 'self' }] } }] }] };
  const mk = (): Game => scenario(dk, dk, [{ active: 'Dreepy', tools: { active: ["Hero's Cape"] }, hand: ['Amarys', 'Potion'] }, { active: 'Dreepy' }], { scripts: [PRECIOUS] });
  const a = mk();
  choose(a, 'Play Amarys');
  choose(a, 'End turn');
  assert.equal(a.decision!.kind, 'option');
  assert.deepEqual(labels(a).sort(), ['Amarys', "Hero's Cape"]);
  // Drawing first (up to 8), then the hand is discarded: nothing left.
  choose(a, "Hero's Cape");
  assert.equal(a.state.p[0].hand.length, 0);
  // Discarding first, then drawing up to 8: 8 cards.
  const b = mk();
  choose(b, 'Play Amarys');
  choose(b, 'End turn');
  choose(b, 'Amarys');
  assert.equal(b.state.p[0].hand.length, 8);
});

// ------------------------------------------------------------------ Iron Treads

/** A deck with a Pokémon Tool that is not in the card snapshot: the Future Booster Energy Capsule (an unscripted Tool can be attached by a scenario). */
function treadsDeck(): DeckInput {
  const base = deck('Iron Treads', 'Mega Kangaskhan ex', 'Dreepy');
  const capsule = { cardId: 'test-capsule', name: 'Future Booster Energy Capsule', category: 'Trainer' as const, trainerType: 'Tool', effect: 'Test stand-in.' };
  return { ...base, cards: [...base.cards, { frame: capsule, count: 2 }] };
}

test('Iron Treads, Dual Core: with a Future Booster Energy Capsule attached it is {F} and {M} type (Weakness is applied for both)', () => {
  const dk = treadsDeck();
  const mk = (tool: boolean): Game =>
    scenario(dk, dk, [{ active: 'Iron Treads', energy: { active: [MTL, MTL] }, bench: ['Dreepy'], ...(tool ? { tools: { active: ['Future Booster Energy Capsule'] } } : {}) }, { active: 'Mega Kangaskhan ex' }]);
  const types = (g: Game): string[] => [...evalMod.slotTypes(g.env, g.state.p[0].active!)];
  assert.deepEqual(types(mk(false)), ['Metal']);
  assert.deepEqual(types(mk(true)), ['Fighting', 'Metal']);
  // Mega Kangaskhan ex is weak to {F}: Wheel Pass's 60 becomes 120 only with the Capsule.
  const g = mk(true);
  choose(g, 'Attack: Wheel Pass');
  assert.equal(g.state.p[1].active!.damage, 120);
  const b = mk(false);
  choose(b, 'Attack: Wheel Pass');
  assert.equal(b.state.p[1].active!.damage, 60);
  assert.ok(evalMod.slotMatches(g.env, mk(true).state.p[0].active!, { type: 'Fighting' }));
});

test('Iron Treads, Wheel Pass: 60 damage; move an Energy from this Pokémon to 1 of your Benched Pokémon', () => {
  const dk = treadsDeck();
  const g = scenario(dk, dk, [{ active: 'Iron Treads', energy: { active: [MTL, FIR, MTL] }, bench: ['Dreepy'] }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Attack: Wheel Pass');
  assert.equal(g.decision!.kind, 'cards', 'which Energy');
  pickCards(g, ['Fire Energy']);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), ['Fire Energy']);
  assert.equal(g.state.p[0].active!.energy.length, 2);
  // Nowhere to move it: just the damage.
  const alone = scenario(dk, dk, [{ active: 'Iron Treads', energy: { active: [MTL, MTL] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(alone, 'Attack: Wheel Pass');
  assert.equal(alone.state.p[1].active!.damage, 60);
  assert.equal(alone.state.p[0].active!.energy.length, 2);
});

// ------------------------------------------------------------------ Palafin, Palafin ex

test('Palafin, Zero to Hero: when it moves to the Bench you may switch it with a Palafin ex from your deck; everything stays, the Palafin goes into the deck, shuffle (ruling 1977)', () => {
  const dk = deck('Finizen', 'Palafin', 'Palafin ex', 'Dreepy', 'Switch', "Hero's Cape");
  const mk = (): Game =>
    scenario(dk, dk, [{ active: 'Finizen', evolve: { active: ['Palafin'] }, energy: { active: [WTR, WTR] }, tools: { active: ["Hero's Cape"] }, damage: { active: 30 }, cond: CONFUSED, bench: ['Dreepy'], hand: ['Switch'] }, { active: 'Dreepy' }]);
  const g = mk();
  const slot = g.state.p[0].active!;
  const palafin = slot.cards[1]!;
  const deckSize = g.state.p[0].deck.length;
  const handSize = g.state.p[0].hand.length;
  choose(g, 'Play Switch');
  assert.equal(g.decision!.kind, 'yesno', 'asked, since it is "you may"');
  g.submit([0]);
  assert.equal(g.decision!.kind, 'cards');
  assert.deepEqual([...new Set(labels(g))], ['Palafin ex'], 'a Palafin ex from the deck');
  g.submit([0]);
  const moved = g.state.p[0].bench.find((b) => b.id === slot.id)!;
  assert.deepEqual(names(g, moved.cards), ['Finizen', 'Palafin ex'], 'Finizen stays in play, underneath the Palafin ex');
  assert.deepEqual(names(g, moved.energy), ['Water Energy', 'Water Energy'], 'attached cards');
  assert.deepEqual(names(g, moved.tools), ["Hero's Cape"]);
  assert.equal(moved.damage, 30, 'damage counters');
  assert.equal(moved.id, slot.id, 'the same Pokémon in play: turns in play and every effect on it stay');
  assert.ok(g.state.p[0].deck.includes(palafin), 'the Palafin went into the deck');
  assert.equal(g.state.p[0].deck.length, deckSize, 'a Palafin ex came out, a Palafin went in');
  assert.equal(g.state.p[0].hand.length, handSize - 1, 'only the Switch left the hand');
  // Declined: nothing changes.
  const n = mk();
  choose(n, 'Play Switch');
  n.submit([1]);
  assert.deepEqual(names(n, n.state.p[0].bench.find((b) => b.id === n.state.p[0].bench[n.state.p[0].bench.length - 1]!.id)!.cards), ['Finizen', 'Palafin']);
});

test('Palafin, Zero to Hero: on your turn only; not blocked by the Active Pokémon having no Abilities, as it has moved to the Bench (ruling 2007)', () => {
  const dk = deck('Finizen', 'Palafin', 'Palafin ex', 'Dreepy', 'Switch', "Boss's Orders", 'Flutter Mane');
  // Flutter Mane's Midnight Fluttering: "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities."
  const g = scenario(dk, dk, [{ active: 'Finizen', evolve: { active: ['Palafin'] }, bench: ['Dreepy'], hand: ['Switch'] }, { active: 'Flutter Mane' }]);
  assert.ok(evalMod.slotMatches(g.env, g.state.p[0].active!, {}));
  choose(g, 'Play Switch');
  assert.equal(g.decision!.kind, 'yesno', 'the Ability is used after the move: Midnight Fluttering no longer applies to it');
  // In the opponent's turn it is not "your turn": Boss's Orders brings it to the Bench, nothing is offered.
  const h = scenario(dk, dk, [{ active: 'Finizen', evolve: { active: ['Palafin'] }, bench: ['Dreepy'] }, { active: 'Dreepy', hand: ["Boss's Orders"] }], { current: 1, first: 0, turn: 4 });
  choose(h, "Play Boss's Orders");
  if (h.decision!.kind === 'slots') pickSlot(h, h.state.p[0].bench[0]!.id);
  assert.equal(h.decision!.kind, 'main', 'no question for the Palafin: it is not its controller\'s turn');
  assert.equal(h.state.p[0].bench.length, 1);
  assert.deepEqual(names(h, h.state.p[0].bench[0]!.cards), ['Finizen', 'Palafin']);
});

test('Palafin ex, Hero\'s Spirit: it can only be put into play by Zero to Hero, never from the hand', () => {
  const dk = deck('Finizen', 'Palafin', 'Palafin ex', 'Rare Candy');
  const g = scenario(dk, dk, [{ active: 'Finizen', hand: ['Palafin ex', 'Palafin'] }, { active: 'Finizen' }], { turn: 4 });
  g.state.p[0].active!.enteredTurn = 0;
  refresh(g);
  const evolves = acts(g).filter((a) => a.t === 'evolve').map((a) => nameOf(g, (a as { card: number }).card));
  assert.deepEqual(evolves, ['Palafin'], 'only the Palafin evolves from the hand');
});

test('Palafin ex, Giga Impact: 250 damage, then it can\'t attack during your next turn', () => {
  const dk = deck('Finizen', 'Palafin ex', 'Mega Greninja ex');
  const g = scenario(dk, dk, [{ active: 'Finizen', evolve: { active: ['Palafin ex'] }, energy: { active: [WTR, WTR] } }, { active: 'Mega Greninja ex', energy: { active: [WTR, WTR] } }]);
  choose(g, 'Attack: Giga Impact');
  assert.equal(g.state.p[1].active!.damage, 250);
  choose(g, 'End turn'); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(!acts(g).some((a) => a.t === 'attack'), "it can't attack during your next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(acts(g).some((a) => a.t === 'attack'), 'the turn after, it can');
});

// ------------------------------------------------------------------ Milotic

test('Milotic, Mentally Calm: an Energy that an attack would put into the hand stays attached, and the attack still gets its bonus (ruling 2370)', () => {
  const dk = deck('Froakie', 'Frogadier', 'Mega Greninja ex', 'Feebas', 'Milotic', 'Dreepy', 'Mega Kangaskhan ex');
  const mk = (milotic: boolean): Game =>
    scenario(dk, dk, [{ active: 'Froakie', evolve: { active: ['Frogadier', 'Mega Greninja ex'] }, energy: { active: [WTR, WTR] } }, { active: 'Mega Kangaskhan ex', bench: milotic ? ['Feebas'] : ['Dreepy'], ...(milotic ? { evolve: { 0: ['Milotic'] } } : {}) }]);
  // Ninja Spinner: "You may put a {W} Energy attached to this Pokémon into your hand and have this attack do 80 more damage."
  const g = mk(true);
  choose(g, 'Attack: Ninja Spinner');
  assert.equal(g.decision!.kind, 'yesno');
  g.submit([0]);
  assert.equal(g.state.p[1].active!.damage, 200, 'Ruling (TPCi Rules Team 2026-06-04, 2370): "You may CHOOSE to try to do so and will get the bonus damage"');
  assert.equal(g.state.p[0].active!.energy.length, 2, '"the Water Energy would stay attached to Mega Greninja ex due to Milotic\'s Mentally Calm ability"');
  const free = mk(false);
  choose(free, 'Attack: Ninja Spinner');
  free.submit([0]);
  assert.equal(free.state.p[1].active!.damage, 200);
  assert.equal(free.state.p[0].active!.energy.length, 1, 'without Milotic it goes to the hand');
});

test('Milotic, Mentally Calm: your opponent\'s Pokémon and the cards attached stay in play, but only your opponent\'s (ruling 2129)', () => {
  const dk = deck('Meowth ex', 'Feebas', 'Milotic', 'Dreepy');
  const mk = (miloticSide: 0 | 1): Game => {
    const meowth: SideLayout = { active: 'Meowth ex', energy: { active: [PSY, PSY, FIR] }, bench: ['Dreepy'] };
    const milotic: SideLayout = { active: 'Feebas', evolve: { active: ['Milotic'] } };
    return miloticSide === 1 ? scenario(dk, dk, [meowth, milotic]) : scenario(dk, dk, [{ ...meowth, bench: ['Feebas', 'Dreepy'], evolve: { 0: ['Milotic'] } }, { active: 'Dreepy' }]);
  };
  // Tuck Tail: "Put this Pokémon and all attached cards into your hand."
  const g = mk(1);
  const meowth = g.state.p[0].active!;
  choose(g, 'Attack: Tuck Tail');
  assert.equal(g.state.p[0].active!.id, meowth.id, 'still in the Active Spot');
  assert.equal(g.state.p[0].active!.energy.length, 3, 'with every card attached');
  assert.ok(!g.state.p[0].hand.some((c) => nameOf(g, c) === 'Meowth ex'));
  // Milotic is on the Meowth player's own side: it protects nothing of theirs.
  const own = mk(0);
  choose(own, 'Attack: Tuck Tail');
  assert.ok(own.state.p[0].hand.some((c) => nameOf(own, c) === 'Meowth ex'));
});

// ------------------------------------------------------------------ Ange Floette

test('Ange Floette: each Mega Floette ex in play (both yours and your opponent\'s) gets +150 HP; other Pokémon don\'t', () => {
  const dk = deck('Mega Floette ex', 'Dreepy', 'Ange Floette');
  const g = scenario(dk, dk, [{ active: 'Mega Floette ex', bench: ['Dreepy'] }, { active: 'Mega Floette ex' }]);
  assert.equal(maxHp(g.env, g.state, g.state.p[0].active!), 250);
  const c = g.state.p[1].deck.splice(g.state.p[1].deck.findIndex((x) => nameOf(g, x) === 'Ange Floette'), 1)[0]!;
  g.state.stadium = { card: c, owner: 1 };
  assert.equal(maxHp(g.env, g.state, g.state.p[0].active!), 400, 'yours');
  assert.equal(maxHp(g.env, g.state, g.state.p[1].active!), 400, "your opponent's");
  assert.equal(maxHp(g.env, g.state, g.state.p[0].bench[0]!), 70, 'a Dreepy');
  g.state.stadium = null;
  assert.equal(maxHp(g.env, g.state, g.state.p[0].active!), 250);
});

test('Ange Floette: playable only if you discard a Prism Tower in play, in the turn it was played too; the Prism Tower is discarded', () => {
  const dk = deck('Dreepy', 'Prism Tower', 'Ange Floette');
  const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Prism Tower', 'Ange Floette'] }, { active: 'Dreepy' }]);
  assert.ok(!has(g, 'Play Ange Floette'), 'no Prism Tower in play');
  choose(g, 'Play Prism Tower');
  assert.ok(has(g, 'Play Ange Floette'), 'the same turn you play Prism Tower');
  choose(g, 'Play Ange Floette');
  assert.equal(nameOf(g, g.state.stadium!.card), 'Ange Floette');
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Prism Tower'));
});

// ------------------------------------------------------------------ Nitro Fire Energy

test('Nitro Fire Energy: discarded by an effect of its {R} Pokémon\'s own attack, it goes into your hand after the attack', () => {
  const dk = deck('Charmander', 'Dreepy', 'Nitro Fire Energy');
  // Ember: "Discard an Energy from this Pokémon."
  const g = scenario(dk, dk, [{ active: 'Charmander', energy: { active: ['Nitro Fire Energy'] } }, { active: 'Dreepy' }]);
  assert.equal(energyUnits(g.env, g.state.p[0].active!, g.state)[0], 'Fire', 'it provides {R} Energy');
  choose(g, 'Attack: Ember');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[0].active!.energy.length, 0);
  assert.deepEqual(names(g, g.state.p[0].hand.filter((c) => nameOf(g, c) === 'Nitro Fire Energy')), ['Nitro Fire Energy'], 'in the hand');
  // With another Energy attached the player chooses which to discard: the Fire Energy goes to the discard pile as usual.
  const h = scenario(dk, dk, [{ active: 'Charmander', energy: { active: ['Nitro Fire Energy', FIR] } }, { active: 'Dreepy' }]);
  choose(h, 'Attack: Ember');
  pickCards(h, [FIR]);
  assert.ok(h.state.p[0].discard.some((c) => nameOf(h, c) === 'Fire Energy'));
  assert.equal(h.state.p[0].hand.filter((c) => nameOf(h, c) === 'Nitro Fire Energy').length, 0);
  assert.equal(h.state.p[0].active!.energy.length, 1);
});

// ------------------------------------------------------------------ Relicanth

test('Relicanth, Memory Dive: each evolved Pokémon of yours can use the attacks of its previous Evolutions with the Energy they need (ruling 2311)', () => {
  const dk = deck('Relicanth', 'Rowlet', 'Dartrix', 'Decidueye ex', 'Dreepy');
  const mk = (relicanth: boolean, hand = 5): Game => {
    const g = scenario(dk, dk, [{ active: 'Rowlet', evolve: { active: ['Dartrix', 'Decidueye ex'] }, energy: { active: [GRS] }, bench: relicanth ? ['Relicanth'] : ['Dreepy'] }, { active: 'Dreepy', hand: rep(GRS, hand) }]);
    refresh(g);
    return g;
  };
  const attacks = (g: Game) => labels(g).filter((l) => l.startsWith('Attack')).sort();
  assert.deepEqual(attacks(mk(true)), ['Attack: Find a Friend', 'Attack: Leafage'], "Rowlet's {G} attack and Dartrix's {G} attack; the Decidueye ex's own needs 4 Energy");
  assert.deepEqual(attacks(mk(false)), [], 'without it, one Energy pays for nothing');
  const g = mk(true);
  choose(g, 'Attack: Leafage');
  assert.equal(g.state.p[1].active!.damage, 20);
  // Ruling (TPCi Rules Team 2026-03-26, 2311): "Yes. Sniper's Eye removes all colorless energy costs from any attack that Decidueye ex can use."
  // Sniper's Eye: "If your opponent has exactly 4 cards in their hand, ignore all {C} Energy in the costs of attacks used by this Pokémon."
  const four = scenario(dk, dk, [{ active: 'Rowlet', evolve: { active: ['Dartrix', 'Decidueye ex'] }, bench: ['Relicanth'] }, { active: 'Dreepy', hand: rep(GRS, 4) }]);
  assert.ok(has(four, 'Attack: Feather Shot'), "Dartrix's Feather Shot {C}{C}{C} costs nothing with exactly 4 cards in the opponent's hand");
  const five = scenario(dk, dk, [{ active: 'Rowlet', evolve: { active: ['Dartrix', 'Decidueye ex'] }, bench: ['Relicanth'] }, { active: 'Dreepy', hand: rep(GRS, 5) }]);
  assert.ok(!has(five, 'Attack: Feather Shot'));
});

test('Relicanth, Memory Dive: not a Basic Pokémon (it has no previous Evolutions), and not your opponent\'s Pokémon', () => {
  const dk = deck('Relicanth', 'Rowlet', 'Dartrix', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Rowlet', energy: { active: [GRS] }, bench: ['Relicanth'] }, { active: 'Dartrix', evolve: { active: [] }, energy: { active: [GRS] } }]);
  assert.deepEqual(labels(g).filter((l) => l.startsWith('Attack')).sort(), ['Attack: Find a Friend'].sort(), 'Rowlet only has its own attack');
  const h = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Relicanth'] }, { active: 'Rowlet', evolve: { active: ['Dartrix'] }, energy: { active: [GRS] } }], { current: 1, first: 0, turn: 4 });
  assert.deepEqual(labels(h).filter((l) => l.startsWith('Attack')), ['Attack: Leafage'], "Relicanth's Ability is for its own player's Pokémon: Dartrix has only its own");
});

// ------------------------------------------------------------------ Neutralization Zone, Poké Vital A

test('Neutralization Zone: prevent all damage done to Pokémon without a Rule Box (both players\') by attacks from the opponent\'s Pokémon ex', () => {
  const dk = deck('Rotom ex', "N's Darumaka", 'Dreepy', 'Neutralization Zone', 'Mega Kangaskhan ex');
  const zone = (g: Game, owner: 0 | 1 = 0): void => {
    const c = g.state.p[owner].deck.splice(g.state.p[owner].deck.findIndex((x) => nameOf(g, x) === 'Neutralization Zone'), 1)[0]!;
    g.state.stadium = { card: c, owner };
    refresh(g);
  };
  // A Pokémon ex attacks a Pokémon without a Rule Box: prevented; either player's Stadium.
  for (const owner of [0, 1] as const) {
    const g = scenario(dk, dk, [{ active: 'Rotom ex', energy: { active: [LGT, LGT] } }, { active: 'Dreepy' }]);
    zone(g, owner);
    choose(g, 'Attack: Thunderbolt');
    assert.equal(g.state.p[1].active!.damage, 0, `prevented (Stadium of player ${owner + 1})`);
  }
  // A Pokémon with a Rule Box defends: not protected.
  const rb = scenario(dk, dk, [{ active: 'Rotom ex', energy: { active: [LGT, LGT] } }, { active: 'Mega Kangaskhan ex' }]);
  zone(rb);
  choose(rb, 'Attack: Thunderbolt');
  assert.equal(rb.state.p[1].active!.damage, 130);
  // The attacker is not a Pokémon ex: not prevented.
  const non = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Dreepy' }]);
  zone(non);
  choose(non, 'Attack: Rolling Tackle');
  assert.equal(non.state.p[1].active!.damage, 20);
  // Attacks of the other player's ex on the first player's Pokémon: also (it is "both yours and your opponent's").
  const rev = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Rotom ex', energy: { active: [LGT, LGT] } }], { current: 1, first: 0, turn: 4 });
  zone(rev);
  choose(rev, 'Attack: Thunderbolt');
  assert.equal(rev.state.p[0].active!.damage, 0);
});

test('Neutralization Zone and Poké Vital A can\'t be put into your hand or deck from the discard pile', () => {
  const dk = deck('Dedenne', 'Dreepy', 'Neutralization Zone', 'Poké Vital A', 'Potion', 'Switch');
  const g = scenario(dk, dk, [{ active: 'Dedenne', energy: { active: [PSY, PSY] }, discard: ['Neutralization Zone', 'Poké Vital A', 'Potion', 'Switch'] }, { active: 'Dreepy' }]);
  // Dedenne: "Put a Trainer card from your discard pile into your hand."
  const atk = labels(g).find((l) => l.startsWith('Attack'))!;
  choose(g, atk);
  assert.equal(g.decision!.kind, 'cards');
  assert.deepEqual(labels(g).sort(), ['Potion', 'Switch'], 'only the Potion and the Switch can be put into the hand');
  pickCards(g, ['Potion']);
  assert.ok(g.state.p[0].hand.some((c) => nameOf(g, c) === 'Potion'));
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Poké Vital A'));
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Neutralization Zone'));
});

test('Poké Vital A: heal 150 damage from 1 of your Pokémon; playable only when one has damage', () => {
  const dk = deck('Dreepy', 'Poké Vital A', 'Mega Kangaskhan ex');
  const none = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Poké Vital A'] }, { active: 'Dreepy' }]);
  assert.ok(!has(none, 'Play Poké Vital A'), 'nothing to heal');
  const g = scenario(dk, dk, [{ active: 'Mega Kangaskhan ex', bench: ['Dreepy'], hand: ['Poké Vital A'], damage: { active: 200, 0: 60 } }, { active: 'Dreepy' }]);
  choose(g, 'Play Poké Vital A');
  assert.equal(g.decision!.kind, 'slots');
  pickSlot(g, g.state.p[0].active!.id);
  assert.equal(g.state.p[0].active!.damage, 50);
  assert.equal(g.state.p[0].bench[0]!.damage, 60);
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Poké Vital A'));
  // All the damage when there is less: the Dreepy's 60.
  const h = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Poké Vital A'], damage: { active: 60 } }, { active: 'Dreepy' }]);
  choose(h, 'Play Poké Vital A');
  assert.equal(h.state.p[0].active!.damage, 0);
});

// ------------------------------------------------------------------ Team Rocket's Energy

test("Team Rocket's Energy: only attaches to a Team Rocket's Pokémon; provides 2 in any combination of {P} and {D}", () => {
  const dk = deck("Team Rocket's Zubat", "Team Rocket's Mewtwo ex", 'Dreepy', "Team Rocket's Energy");
  const g = scenario(dk, dk, [{ active: "Team Rocket's Zubat", bench: ['Dreepy'], hand: ["Team Rocket's Energy"] }, { active: 'Dreepy' }]);
  const att = acts(g).filter((a) => a.t === 'attach').map((a) => (a as { slot: number }).slot);
  assert.deepEqual(att, [g.state.p[0].active!.id], "not the Dreepy on the Bench");
  choose(g, "Attach Team Rocket's Energy to Team Rocket's Zubat");
  const zubat = g.state.p[0].active!;
  assert.equal(energyUnits(g.env, zubat, g.state).length, 2);
  // Poison Spray {D}: paid by the one Energy card; Zubat could also pay {P}{D}.
  assert.ok(acts(g).some((a) => a.t === 'attack'));
  // A different attached card: discarded when it is on another Pokémon (put there by an effect or a rule the card doesn't see).
  const h = scenario(dk, dk, [{ active: "Team Rocket's Zubat", bench: ['Dreepy'], hand: [FIR], energy: { 0: ["Team Rocket's Energy"] } }, { active: 'Dreepy' }]);
  choose(h, 'Attach Fire Energy');
  assert.equal(h.state.p[0].bench[0]!.energy.length, 0, 'discarded: it is not on a Team Rocket\'s Pokémon');
  assert.ok(h.state.p[0].discard.some((c) => nameOf(h, c) === "Team Rocket's Energy"));
});

test("Team Rocket's Energy: an attack that discards cards counts it as 1 card, 2 with another card (ruling 2340)", () => {
  const dk = deck("Team Rocket's Zubat", "Team Rocket's Mewtwo ex", 'Mega Greninja ex', "Team Rocket's Energy");
  const mk = (benchEnergy: [string[], string[]]): Game =>
    scenario(dk, dk, [{ active: "Team Rocket's Mewtwo ex", bench: rep("Team Rocket's Zubat", 3), energy: { active: ["Team Rocket's Energy", WTR], 0: benchEnergy[0], 1: benchEnergy[1] } }, { active: 'Mega Greninja ex' }]);
  // Erasure Ball: "You may discard up to 2 Energy from your Benched Pokémon. This attack does 60 more damage for each card you discarded in this way."
  const one = mk([["Team Rocket's Energy"], []]);
  assert.ok(has(one, 'Attack: Erasure Ball'), '{P}{P} from the Team Rocket\'s Energy, {C} from the Water Energy');
  choose(one, 'Attack: Erasure Ball');
  pickCards(one, ["Team Rocket's Energy"]);
  assert.equal(one.state.p[1].active!.damage, 160 + 60, '+60: one card, however much Energy it provides');
  const two = mk([["Team Rocket's Energy"], [DRK]]);
  choose(two, 'Attack: Erasure Ball');
  pickCards(two, ["Team Rocket's Energy", 'Darkness Energy']);
  assert.equal(two.state.p[1].active!.damage, 160 + 120, 'two cards: +120');
});

// ------------------------------------------------------------------ Walrein

test('Walrein, Frigid Fangs: during your opponent\'s next turn their Pokémon with 2 or less Energy attached can\'t attack; moving Walrein does not end it (ruling 2055)', () => {
  const dk = deck('Spheal', 'Walrein', 'Dreepy', 'Chikorita', "Boss's Orders");
  const mk = (energy: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Spheal', evolve: { active: ['Walrein'] }, energy: { active: [WTR], 0: [] }, bench: ['Chikorita'] }, { active: 'Dreepy', energy: { active: energy }, hand: ["Boss's Orders"] }]);
    choose(g, 'Attack: Frigid Fangs');
    return g;
  };
  assert.equal(mk([]).state.p[1].active!.damage, 60);
  const two = mk([FIR, PSY]);
  assert.equal(two.state.current, 1);
  assert.ok(!acts(two, 1).some((a) => a.t === 'attack'), '2 Energy: it can\'t attack');
  const three = mk([FIR, PSY, PSY]);
  assert.ok(acts(three, 1).some((a) => a.t === 'attack'), '3 Energy: it can');
  // Ruling (TPCi Rules Team 2024-11-07, 2055): "Yes. The effect resides on all of the opponent's Pokemon, not on Walrein, so moving Walrein to the Bench does not get rid of the effect."
  const moved = mk([FIR, PSY]);
  choose(moved, "Play Boss's Orders");
  if (moved.decision!.kind === 'slots') pickSlot(moved, moved.state.p[0].bench[0]!.id);
  assert.equal(nameOf(moved, moved.state.p[0].bench[0]!.cards[0]!), 'Spheal', 'Walrein was moved to the Bench');
  assert.ok(!acts(moved, 1).some((a) => a.t === 'attack'), 'still can\'t attack');
});

test('Walrein, Megaton Fall: 170 damage, and 50 damage to itself', () => {
  const dk = deck('Spheal', 'Walrein', 'Mega Kangaskhan ex');
  const g = scenario(dk, dk, [{ active: 'Spheal', evolve: { active: ['Walrein'] }, energy: { active: [WTR, WTR] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Attack: Megaton Fall');
  assert.equal(g.state.p[1].active!.damage, 170);
  assert.equal(g.state.p[0].active!.damage, 50);
});

// ------------------------------------------------------------------ Klinklang

test('Klinklang, Emergency Rotation: if it is in your hand and your opponent has a Stage 2 Pokémon in play, you may put it onto your Bench', () => {
  const dk = deck('Dreepy', 'Klinklang', 'Chikorita', 'Bayleef', 'Meganium');
  const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Klinklang'] }, { active: 'Chikorita', evolve: { active: ['Meganium'] } }]);
  choose(g, 'Use Emergency Rotation');
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.cards), ['Klinklang']);
  assert.equal(g.state.p[0].hand.length, 0);
  const none = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Klinklang'] }, { active: 'Chikorita', evolve: { active: ['Bayleef'] } }]);
  assert.ok(!has(none, 'Emergency Rotation'), 'no Stage 2 Pokémon in play');
});

test('Klinklang, Hyper Ray: 130 damage, then all Energy discarded from this Pokémon', () => {
  const dk = deck('Klang', 'Klinklang', 'Mega Kangaskhan ex');
  const g = scenario(dk, dk, [{ active: 'Klang', evolve: { active: ['Klinklang'] }, energy: { active: [MTL, MTL, FIR] } }, { active: 'Mega Kangaskhan ex' }]);
  choose(g, 'Attack: Hyper Ray');
  assert.equal(g.state.p[1].active!.damage, 130);
  assert.equal(g.state.p[0].active!.energy.length, 0);
});
