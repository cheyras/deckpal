/**
 * Card tests, batch "std-s03": every card scripted in cards/scripts/std-s03.ts does what its printed text says in a constructed
 * position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, Program } from '../dsl.js';
import type { Game } from '../game.js';
import { scenario } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';

function labels(g: Game): string[] {
  return describeOptions(g.ctx, g.state, g.decision as Decision);
}
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
function yes(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno', `expected a yes/no question, got ${g.decision?.kind} [${g.decision?.prompt}]`);
  g.submit([1]);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const activeName = (g: Game, p: 0 | 1): string => nameOf(g, topCard(g.state.p[p].active!));
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** Take the named card out of a player's deck and put it into the stadium slot. */
function setStadium(g: Game, owner: 0 | 1, nm: string): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === nm);
  assert.ok(i >= 0, `no ${nm} in the deck`);
  g.state.stadium = { card: dk.splice(i, 1)[0]!, owner };
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  'Haban Berry': 'sv08.5-111',
  'Cetitan ex': 'sv10-065',
  Dreepy: 'sv06-128', // Dragon, 70 HP; Petty Grudge {P} 10, Bite {D}{P} 40
  'Dragapult ex': 'sv06-130', // 320 HP, no Weakness
  Lotad: 'sv09-035', // Water; Water Gun {W} 20
  'Gravity Mountain': 'sv08-177',
  Kieran: 'sv06-154', // Supporter
  Switch: 'me01-130', // Item
  "Team Rocket's Giovanni": 'me02.5-204',
  "Team Rocket's Tarountula": 'me02.5-018',
  "Team Rocket's Exeggcute": 'me02.5-077',
};
function deck(...cards: string[]) {
  return fromIds('s03', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const FIR = 'Fire Energy';
const WAT = 'Water Energy';
const PSY = 'Psychic Energy';
const GRA = 'Grass Energy';
const DAR = 'Darkness Energy';
const MET = 'Metal Energy';

// ------------------------------------------------------------------ Haban Berry

test("Haban Berry: 60 less damage from an opponent's {N} Pokémon (then it is discarded); a Pokémon of another type does full damage and the Berry stays", () => {
  // "If the Pokémon this card is attached to is damaged by an attack from your opponent's {N} Pokémon, it takes 60 less damage (after applying Weakness and Resistance), and discard this card."
  const dk = deck('Haban Berry', 'Dreepy', 'Lotad', 'Dragapult ex');
  const stand = (name: string, attack: string): CardScript => ({ id: IDS[name]!, name, attacks: { [attack]: { damage: 100 } } });
  const mk = (attacker: string, attack: string): Game =>
    scenario(dk, dk, [{ active: 'Dragapult ex', tools: { active: ['Haban Berry'] } }, { active: attacker, energy: { active: [FIR, WAT, PSY, DAR, MET, GRA] } }], {
      current: 1,
      turn: 4,
      scripts: [stand(attacker, attack)],
    });
  const dragon = mk('Dreepy', 'Petty Grudge');
  assert.ok(def(dragon.ctx, dragon.state.p[1].active!.cards[0]!).types.includes('Dragon'), 'Dreepy is a {N} Pokémon');
  choose(dragon, 'Attack: Petty Grudge');
  assert.equal(dmg(dragon, 0), 40, '100 - 60');
  assert.equal(dragon.state.p[0].active!.tools.length, 0, 'the Berry is discarded');
  assert.ok(dragon.state.p[0].discard.some((c) => nameOf(dragon, c) === 'Haban Berry'));

  const water = mk('Lotad', 'Water Gun');
  choose(water, 'Attack: Water Gun');
  assert.equal(dmg(water, 0), 100, 'a {W} Pokémon: no reduction');
  assert.equal(water.state.p[0].active!.tools.length, 1, 'and the Berry stays');
});

test('Haban Berry: damage of 60 or less is reduced to nothing and the Berry is still discarded; its owner\'s own Pokémon are not affected', () => {
  const dk = deck('Haban Berry', 'Dreepy', 'Cetitan ex');
  const weak: CardScript = { id: 'sv06-128', name: 'Dreepy', attacks: { 'Petty Grudge': { damage: 50 } } };
  const g = scenario(dk, dk, [{ active: 'Cetitan ex', tools: { active: ['Haban Berry'] } }, { active: 'Dreepy', energy: { active: [DAR, PSY] } }], { current: 1, turn: 4, scripts: [weak] });
  choose(g, 'Attack: Petty Grudge');
  assert.equal(dmg(g, 0), 0, '50 is below 60: nothing');
  assert.equal(g.state.p[0].active!.tools.length, 0);
});

// ------------------------------------------------------------------ Cetitan ex

/** A stand-in Item / Supporter that does these things to the opponent's Active Pokémon. */
const HARASS: Program = [
  { op: 'counters', n: 2, to: 'oppActive' },
  { op: 'condition', cond: 'poisoned', to: 'oppActive' },
  { op: 'damage', amount: 20, to: 'oppActive' },
];
const STAND_ITEM: CardScript = { id: 'me01-130', name: 'Switch', play: HARASS };
const STAND_SUPPORTER: CardScript = { id: 'sv06-154', name: 'Kieran', play: HARASS };

test('Cetitan ex, Snow Camouflage: the effects of an Item or Supporter the opponent plays are not done to it', () => {
  // "Whenever your opponent plays an Item or Supporter card from their hand, prevent all effects of that card done to this Pokémon."
  const dk = deck('Cetitan ex', 'Dreepy', 'Switch', 'Kieran');
  const mk = (target: string): Game => scenario(dk, dk, [{ active: 'Dreepy', hand: ['Switch', 'Kieran'] }, { active: target }], { scripts: [STAND_ITEM, STAND_SUPPORTER] });
  for (const card of ['Switch', 'Kieran']) {
    const g = mk('Cetitan ex');
    choose(g, `Play ${card}`);
    assert.equal(dmg(g, 1), 0, `${card}: no counters, no damage`);
    assert.equal(g.state.p[1].active!.cond, 0, `${card}: not Poisoned`);
    // A Pokémon without the Ability takes all of it.
    const other = mk('Dreepy');
    choose(other, `Play ${card}`);
    assert.equal(dmg(other, 1), 40, `${card} on a Pokémon without Snow Camouflage: 2 counters + 20`);
    assert.notEqual(other.state.p[1].active!.cond, 0);
  }
});

test('Cetitan ex, Snow Camouflage: only cards the opponent plays are prevented -- your own Item or Supporter and an attack still work', () => {
  const dk = deck('Cetitan ex', 'Dreepy', 'Switch', 'Kieran');
  const own: Program = [{ op: 'counters', n: 3, to: 'myActive' }];
  const ownItem: CardScript = { id: 'me01-130', name: 'Switch', play: own };
  const ownSupporter: CardScript = { id: 'sv06-154', name: 'Kieran', play: own };
  for (const [card, script] of [['Switch', ownItem], ['Kieran', ownSupporter]] as const) {
    const g = scenario(dk, dk, [{ active: 'Cetitan ex', hand: [card] }, { active: 'Dreepy' }], { scripts: [script] });
    choose(g, `Play ${card}`);
    assert.equal(dmg(g, 0), 30, `your own ${card} works on your own Cetitan ex`);
  }
  // An attack's effects are not Item / Supporter effects.
  const hit = scenario(dk, dk, [{ active: 'Dreepy', energy: { active: [DAR, PSY] } }, { active: 'Cetitan ex' }], {
    scripts: [{ id: 'sv06-128', name: 'Dreepy', attacks: { 'Petty Grudge': { damage: 10, post: [{ op: 'counters', n: 2, to: 'oppActive' }, { op: 'condition', cond: 'poisoned', to: 'oppActive' }] } } }],
  });
  choose(hit, 'Attack: Petty Grudge');
  assert.equal(dmg(hit, 1), 40, '10 + 2 counters from the attack, and 10 more from Poison at Pokémon Checkup');
  assert.notEqual(hit.state.p[1].active!.cond, 0, 'and the Special Condition');
});

test("Cetitan ex, Snow Camouflage: Team Rocket's Giovanni is blocked when Cetitan ex is the chosen Benched Pokémon, but your own switch still happens (ruling 2154)", () => {
  // Ruling (TPCi Rules Team 2025-05-29, https://compendium.pokegym.net/ruling/2154/): "If your opponent's chosen Benched Pokemon is Cetitan ex, then Team Rocket's Giovanni's effect will be blocked. But choosing a Benched Pokemon without "Snow Camouflage" will cause it to switch with the Active Cetitan ex because the Benched Pokemon is the target of Team Rocket's Giovanni. You will still switch your Team Rocket Pokemon either way."
  const TR = "Team Rocket's Tarountula";
  const EX = "Team Rocket's Exeggcute";
  const GIO = "Team Rocket's Giovanni";
  const dk = deck(TR, EX, GIO, 'Cetitan ex', 'Dreepy', 'Dragapult ex');
  const mine = { active: TR, bench: [EX], hand: [GIO] };
  // The chosen Benched Pokémon is Cetitan ex: blocked.
  const blocked = scenario(dk, dk, [mine, { active: 'Dreepy', bench: ['Cetitan ex'] }]);
  choose(blocked, `Play ${GIO}`);
  assert.equal(activeName(blocked, 0), EX, 'your own switch happens');
  assert.equal(activeName(blocked, 1), 'Dreepy', "the opponent's Active Pokémon stays: Cetitan ex was the target");
  // Cetitan ex is the ACTIVE Pokémon and the chosen Benched Pokémon has no Snow Camouflage: they switch (the Benched one is the target).
  const swapped = scenario(dk, dk, [mine, { active: 'Cetitan ex', bench: ['Dreepy'] }]);
  choose(swapped, `Play ${GIO}`);
  assert.equal(activeName(swapped, 0), EX);
  assert.equal(activeName(swapped, 1), 'Dreepy', 'Dreepy is switched in with the Active Cetitan ex');
});

test('Cetitan ex, Crushing Press: 140, and you may discard a Stadium in play for 140 more', () => {
  // "You may discard a Stadium in play. If you do, this attack does 140 more damage."
  const dk = deck('Cetitan ex', 'Dragapult ex', 'Gravity Mountain');
  const play = (stadium: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Cetitan ex', energy: { active: [WAT, WAT, WAT, FIR] } }, { active: 'Dragapult ex' }]);
    if (stadium) setStadium(g, 1, 'Gravity Mountain');
    choose(g, 'Attack: Crushing Press');
    return g;
  };
  const taken = play(true);
  yes(taken);
  assert.equal(taken.state.stadium, null, 'the Stadium is discarded');
  assert.ok(taken.state.p[1].discard.some((c) => nameOf(taken, c) === 'Gravity Mountain'), "to its owner's discard pile");
  assert.equal(dmg(taken, 1), 280);

  const kept = play(true);
  no(kept);
  assert.ok(kept.state.stadium, 'declining keeps the Stadium');
  assert.equal(dmg(kept, 1), 140);

  const none = play(false);
  assert.notEqual(none.decision?.kind, 'yesno', 'no Stadium, no question');
  assert.equal(dmg(none, 1), 140);
});
