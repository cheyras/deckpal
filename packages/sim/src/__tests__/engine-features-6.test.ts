/**
 * Engine features added with the std-engine6 batch, each tested on its own (the cards that use them are in
 * cards-std-engine6.test.ts):
 *  1. play locks on Pokémon Tool cards and on Pokémon that have an Ability (`playLock` 'tool' / 'abilityPokemon', `except`)
 *  2. Prize cards tied to the Knocked Out Pokémon (`extraPrize` `ko` / `byThis`, `koPrizes` `anyKo` / `duringTakersTurn`)
 *  3. Burn counter amounts (`condition` `counters` on Burn), Checkup counters (`checkupCounters`), `hp` that doesn't stack
 *  4. more triggers (`allyAttachFromHand`, `oppEvolveFromHand`, `discardedFromDeck`, `allyActiveDamagedByAttack`)
 *  5. face-up Prize cards (`turnPrizeUp`, `prizeCards`)
 *  6. which Pokémon attacked last turn (`attackedLastTurn`)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { determinize } from '../determinize.js';
import { renderAbility, renderProgram } from '../cards/render.js';
import type { CardScript, Cond, Expr, Program, StaticEffect } from '../dsl.js';
import { evalCond, evalExpr } from '../eval.js';
import { advance, applyCondition, legalActions } from '../flow.js';
import type { Game } from '../game.js';
import { maxHp } from '../query.js';
import { Rng } from '../rng.js';
import { scenario } from '../scenario.js';
import { cloneState, findSlot } from '../state.js';
import { CONFUSED, POISONED, BURNED, type Decision } from '../types.js';
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
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Dreepy: 'sv06-128', // Dragon, 70 HP, no Weakness
  Drakloak: 'sv06-129', // Stage 1, Dragon, 90 HP
  Chikorita: 'me01-008', // Grass, 70 HP, Fire-weak
  "N's Darumaka": 'me02.5-032', // Fire, 80 HP; Rolling Tackle {C}{C} 20
  Magearna: 'sv09-107', // Basic, Metal, has an Ability
  "Arven's Skwovet": 'sv10-158',
  "Arven's Greedent": 'sv10-159', // Stage 1 with an Ability
  "Team Rocket's Zubat": 'sv10-120',
  "Team Rocket's Golbat": 'sv10-121', // Stage 1 with an Ability
  "Hero's Cape": 'sv05-152', // a Pokémon Tool
  Potion: 'me03-083',
  Switch: 'me01-130',
  'Enriching Energy': 'sv08-191',
  'Great Tusk': 'sv05-096', // Ancient
  'Roaring Moon': 'sv05-109', // Ancient
  Koraidon: 'sv08-116', // Ancient
};
function deck(...cards: string[]) {
  return fromIds('engine6', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);
const FIR = 'Fire Energy';
const PSY = 'Psychic Energy';
/** A timed effect on a Pokémon (a stand-in for the Ability or attack that would have set it); it lasts through the next turn. */
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false, turns = 1): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + turns, fromAttack, src: 0 });
}
function injectPlayer(g: Game, player: 0 | 1, st: StaticEffect, scope?: 'myPokemon'): void {
  g.state.effects.push({ static: st, slot: -1, player, until: g.state.turn + 1, fromAttack: false, src: 0, ...(scope ? { scope } : {}) });
}

/** A stand-in for the attack of N's Darumaka (Rolling Tackle, {C}{C}) that runs this program. */
const darumaka = (program: Program, extra: Partial<CardScript> = {}): CardScript[] => [
  { id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { program } }, ...extra },
];
const deal = (n: number): Program => [{ op: 'damage', amount: n, to: 'defender' }];
const attack = (g: Game): void => choose(g, 'Attack: Rolling Tackle');

// ------------------------------------------------------------------ rendering: every new clause says what it does

test('the new clauses render in words', () => {
  const stat = (effect: StaticEffect, scope: 'opp' | 'me' | 'oppPokemon' = 'opp') => renderAbility({ name: 'X', statics: [{ effect, scope }] });
  assert.match(stat({ k: 'playLock', what: 'tool' }), /can't play any Pokémon Tool cards from their hand/);
  assert.match(stat({ k: 'playLock', what: 'abilityPokemon', except: { nameIncludes: "Team Rocket's" } }), /Pokémon that has an Ability.*except for Team Rocket's Pokémon/);
  assert.match(stat({ k: 'extraPrize', amount: 1, ko: { stage: 'basic' }, byThis: true }, 'me'), /Basic Pokémon is Knocked Out by damage from an attack used by this Pokémon, take 1 more Prize card/);
  assert.match(stat({ k: 'hp', delta: 40, noStack: 'Vibrant Dance' }, 'me'), /doesn't stack/);
  assert.match(stat({ k: 'checkupCounters', cond: 'burned', n: 3 }, 'oppPokemon'), /During Pokémon Checkup, put 3 more damage counters/);
  assert.match(renderProgram([{ op: 'condition', cond: 'burned', to: 'oppActive', counters: 4 }]), /4 damage counters.*instead of 2/);
  assert.match(renderProgram([{ op: 'effect', static: { k: 'koPrizes', delta: 2, anyKo: true, duringTakersTurn: true }, on: 'defender', duration: 'myNextTurn' }]), /Knocked Out.*2 more Prize cards/);
  assert.match(renderProgram([{ op: 'turnPrizeUp', who: 'opp' }]), /Turn 1 of your opponent's face-down Prize cards face up/);
  assert.match(renderProgram([{ op: 'if', cond: { attackedLastTurn: { other: true, filter: { tag: 'Ancient' } } }, then: [{ op: 'draw', n: 1 }] }]), /1 of your other Ancient Pokémon used an attack during your last turn/);
});

// ------------------------------------------------------------------ 1. Play locks on Tool cards and on Pokémon that have an Ability

test("playLock 'tool': the player can't attach a Pokémon Tool from their hand; Items and other cards are not affected", () => {
  const dk = deck('Dreepy', "Hero's Cape", 'Potion');
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], hand: ["Hero's Cape", 'Potion'], damage: { active: 30 } }, { active: 'Dreepy' }]);
  const tools = (p: 0 | 1 = 0) => legalActions(g.env, g.state, p).filter((a) => a.t === 'tool');
  assert.equal(tools().length, 2, 'a Tool can go on either Pokémon');
  injectPlayer(g, 0, { k: 'playLock', what: 'tool' });
  assert.equal(tools().length, 0, "can't play a Pokémon Tool");
  assert.ok(legalActions(g.env, g.state, 0).some((a) => a.t === 'trainer'), 'an Item is another matter');
  // The lock is on the player it names: the other player's Tools are fine.
  const h = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Dreepy', hand: ["Hero's Cape"] }], { current: 1, first: 0 });
  injectPlayer(h, 0, { k: 'playLock', what: 'tool' });
  assert.equal(legalActions(h.env, h.state, 1).filter((a) => a.t === 'tool').length, 1);
});

test("playLock 'abilityPokemon': no Pokémon with an Ability from the hand, to the Bench or to evolve; `except` spares some", () => {
  const dk = deck('Dreepy', 'Magearna', "Arven's Skwovet", "Arven's Greedent", "Team Rocket's Zubat", "Team Rocket's Golbat");
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Dreepy', bench: ["Arven's Skwovet", "Team Rocket's Zubat"], hand: ['Magearna', 'Dreepy', "Arven's Greedent", "Team Rocket's Golbat"] },
      { active: 'Dreepy' },
    ]);
  const acts = (g: Game) =>
    legalActions(g.env, g.state, 0)
      .filter((a) => a.t === 'bench' || a.t === 'evolve')
      .map((a) => `${a.t}:${nameOf(g, (a as { card: number }).card)}`)
      .sort();
  const g = mk();
  assert.deepEqual(acts(g), ['bench:Dreepy', 'bench:Magearna', "evolve:Arven's Greedent", "evolve:Team Rocket's Golbat"]);
  // Without an exception: Magearna, Greedent and Golbat all have an Ability printed on them.
  injectPlayer(g, 0, { k: 'playLock', what: 'abilityPokemon' });
  assert.deepEqual(acts(g), ['bench:Dreepy']);
  // "...except for Team Rocket's Pokémon": Golbat is spared.
  const h = mk();
  injectPlayer(h, 0, { k: 'playLock', what: 'abilityPokemon', except: { nameIncludes: "Team Rocket's" } });
  assert.deepEqual(acts(h), ['bench:Dreepy', "evolve:Team Rocket's Golbat"]);
  // Only the player it names, and only what is played from the hand: a Pokémon already in play is not touched.
  assert.ok(legalActions(h.env, h.state, 0).some((a) => a.t === 'end'));
});

test("A lock on playing Pokémon that have an Ability looks at the Ability printed on the card in the hand, whatever switches Abilities off in play (ruling 2147)", () => {
  const dk = deck('Dreepy', "Arven's Skwovet", "Arven's Greedent");
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ["Arven's Skwovet"], hand: ["Arven's Greedent"] }, { active: 'Dreepy' }]);
  // A stand-in for Team Rocket's Watchtower: {C} Pokémon in play have no Abilities.
  injectPlayer(g, 1, { k: 'noAbilities' }, 'myPokemon');
  g.state.effects[g.state.effects.length - 1]!.scope = 'allPokemon';
  g.state.effects[g.state.effects.length - 1]!.filter = { type: 'Colorless' };
  injectPlayer(g, 0, { k: 'playLock', what: 'abilityPokemon' });
  assert.ok(!legalActions(g.env, g.state, 0).some((a) => a.t === 'evolve'), 'still locked');
});

// ------------------------------------------------------------------ 2. Prize cards tied to the Knocked Out Pokémon

const GREEDY: Partial<CardScript> = { statics: [{ effect: { k: 'extraPrize', amount: 1, ko: { stage: 'basic' }, byThis: true }, scope: 'me' }] };

test('extraPrize with `ko` and `byThis`: 1 more Prize card for each Basic Pokémon Knocked Out by damage from an attack used by this Pokémon, wherever it is', () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Drakloak', 'Chikorita');
  const run = (oppActive: string, oppBench: string[], program: Program, mine: Partial<CardScript> = GREEDY, damage: Record<string, number> = {}): Game => {
    const g = scenario(
      dk,
      dk,
      [
        { active: "N's Darumaka", energy: { active: rep(FIR, 2) } },
        { active: oppActive, bench: oppBench, damage },
      ],
      { scripts: darumaka(program, mine), turn: 3, current: 0, first: 0 },
    );
    attack(g);
    return g;
  };
  // A Basic Pokémon Knocked Out: 1 + 1.
  assert.equal(run('Dreepy', ['Chikorita'], deal(100)).state.p[0].prizesTaken, 2);
  // Not a Basic Pokémon: the usual 1.
  assert.equal(run('Drakloak', ['Chikorita'], deal(200)).state.p[0].prizesTaken, 1);
  // The effect is the Pokémon's own: another Pokémon of mine doing it gets nothing from this one. Here the source is on the Bench.
  const other = scenario(
    dk,
    dk,
    [{ active: 'Dreepy', bench: ["N's Darumaka"], energy: { active: [FIR, PSY] } }, { active: 'Chikorita' }],
    { scripts: [{ id: 'me02.5-032', name: "N's Darumaka", ...GREEDY }, { id: 'sv06-128', name: 'Dreepy', attacks: { Bite: { program: deal(100) } } }] },
  );
  choose(other, 'Attack: Bite');
  assert.equal(other.state.p[0].prizesTaken, 1, 'the Benched source did not use the attack');
  // Wherever it is: a Benched Basic Pokémon Knocked Out by the attack's damage counts too (the Active one survives).
  const bench = run('Dreepy', ['Chikorita'], [{ op: 'damage', amount: 100, to: { each: 'oppBench' } }]);
  assert.equal(bench.state.p[0].prizesTaken, 2);
  // Each Basic Knocked Out gives 1 more: two at once.
  const two = run('Dreepy', ['Chikorita'], [{ op: 'damage', amount: 100, to: { each: 'oppPokemon' } }]);
  assert.equal(two.state.p[0].prizesTaken, 4, '2 Pokémon and 1 more for each');
  // Counters are not damage from an attack: nothing extra.
  const counters = run('Dreepy', [], [{ op: 'counters', n: 10, to: 'defender' }]);
  assert.equal(counters.state.p[0].prizesTaken, 1);
});

test('koPrizes with `anyKo` and `duringTakersTurn`: more Prize cards for any Knock Out of the Pokémon, only during the turn of the player who takes them', () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Chikorita');
  const mk = (current: 0 | 1, turn: number): Game => {
    const g = scenario(
      dk,
      dk,
      [
        { active: "N's Darumaka", energy: { active: rep(FIR, 2) }, damage: { active: 60 }, cond: POISONED },
        { active: 'Dreepy', energy: { active: rep(PSY, 2) }, damage: { active: 60 }, cond: POISONED },
      ],
      { scripts: darumaka(deal(100)), turn, current, first: 0 },
    );
    // The effect an attack of Player 1's Pokémon... a stand-in for "During your next turn, if the Defending Pokémon is Knocked Out, take 2 more Prize cards":
    // P0 used the attack, so P1's Active Pokémon has it.
    inject(g, g.state.p[1].active!.id, { k: 'koPrizes', delta: 2, anyKo: true, duringTakersTurn: true }, true, 2);
    return g;
  };
  // During the taker's turn: knocked out by an attack (3 Prize cards)...
  const a = mk(0, 3);
  attack(a);
  assert.equal(a.state.p[0].prizesTaken, 3);
  // ...and by something that is not an attack (Poison at Checkup after the taker's turn ends): also 3.
  const b = mk(0, 3);
  b.state.p[0].active!.damage = 0; // my Pokémon is not the one in danger
  b.state.p[1].active!.damage = 60;
  choose(b, 'End turn');
  assert.equal(b.state.p[0].prizesTaken, 3, 'a Knock Out at Checkup during my turn counts');
  // During the opponent's turn (the Pokémon's own owner's): nothing extra.
  const c = mk(1, 4);
  c.state.p[0].active!.damage = 0;
  c.state.p[1].active!.damage = 60;
  choose(c, 'End turn');
  assert.equal(c.state.p[0].prizesTaken, 1, "a Knock Out in the opponent's turn gives the usual Prize cards");
});

test('An attack\'s effect on the Prize cards for a Knock Out ends when the Pokémon leaves the Active Spot or evolves (ruling 1957)', () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Drakloak', 'Chikorita');
  const g = scenario(dk, dk, [{ active: "N's Darumaka" }, { active: 'Dreepy', bench: ['Chikorita'], hand: ['Drakloak'] }], { turn: 4, current: 1, first: 0 });
  g.state.p[1].active!.enteredTurn = 0;
  inject(g, g.state.p[1].active!.id, { k: 'koPrizes', delta: 2, anyKo: true }, true, 2);
  assert.equal(g.state.effects.length, 1);
  choose(g, 'Evolve Dreepy');
  assert.equal(g.state.effects.length, 0, 'evolving ended the effect');
});

// ------------------------------------------------------------------ 3. Burn counters, Checkup counters, HP that does not stack

test('condition with `counters` on Burn: that many damage counters at each Checkup instead of 2; a later plain Burn restores the usual 2', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const burn = (counters: number | undefined, coin = false): Game => {
    const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: rep(FIR, 2) } }, { active: 'Dreepy' }], {
      scripts: darumaka([{ op: 'condition', cond: 'burned', to: 'defender', ...(counters ? { counters } : {}) }]),
    });
    g.state.forcedCoins = [coin];
    attack(g);
    return g;
  };
  const four = burn(4, true);
  assert.equal(four.state.p[1].active!.damage, 40, '4 counters instead of 2, before the flip that cures it');
  assert.equal(four.state.p[1].active!.cond & BURNED, 0);
  const plain = burn(undefined, true);
  assert.equal(plain.state.p[1].active!.damage, 20);
  // The amount is remembered while Burned, and it is part of the state that is cloned.
  const h = burn(4, false);
  assert.equal(h.state.p[1].active!.cond & BURNED, BURNED, 'tails: still Burned');
  assert.equal(h.state.p[1].active!.burnCounters, 4);
  assert.equal(cloneState(h.state).p[1].active!.burnCounters, 4);
  // A later plain application of Burn restores the usual amount.
  applyCondition(h.state.p[1].active!, 'burned');
  assert.equal(h.state.p[1].active!.burnCounters, undefined);
  assert.equal(four.state.p[0].active!.damage, 0);
});

test('checkupCounters: added to the Special Condition\'s own counters before the Burn flip; sources add up unless they share a noStack key', () => {
  const dk = deck("N's Darumaka", 'Koraidon');
  const mk = (cond: number, effects: StaticEffect[], coin: boolean): Game => {
    const g = scenario(dk, dk, [{ active: "N's Darumaka" }, { active: 'Koraidon', cond }]);
    for (const e of effects) inject(g, g.state.p[1].active!.id, e);
    g.state.forcedCoins = [coin];
    choose(g, 'End turn');
    return g;
  };
  const B3: StaticEffect = { k: 'checkupCounters', cond: 'burned', n: 3 };
  assert.equal(mk(BURNED, [], false).state.p[1].active!.damage, 20, 'Burn alone: 2 counters');
  assert.equal(mk(BURNED, [B3], false).state.p[1].active!.damage, 50, '2 + 3');
  assert.equal(mk(BURNED, [B3, B3], false).state.p[1].active!.damage, 80, '2 + 3 + 3 (ruling 2112)');
  // The Burn flip comes after: a Pokémon that recovers from Burn at the flip still took all of them.
  assert.equal(mk(BURNED, [B3], true).state.p[1].active!.cond & BURNED, 0, 'heads: recovered');
  assert.equal(mk(BURNED, [B3], true).state.p[1].active!.damage, 50, '...and still took the 3');
  // noStack: one of a kind.
  const same: StaticEffect = { k: 'checkupCounters', cond: 'burned', n: 3, noStack: 'X' };
  assert.equal(mk(BURNED, [same, same], false).state.p[1].active!.damage, 50);
  // Poison, and only the condition named.
  const P2: StaticEffect = { k: 'checkupCounters', cond: 'poisoned', n: 2 };
  assert.equal(mk(POISONED, [P2], false).state.p[1].active!.damage, 30, '1 + 2');
  assert.equal(mk(POISONED, [B3], false).state.p[1].active!.damage, 10, 'a Burn effect does nothing to Poison');
  assert.equal(mk(BURNED, [P2], false).state.p[1].active!.damage, 20, 'a Poison effect does nothing to Burn');
  // A Poison amount of its own adds to it too.
  const g = scenario(dk, dk, [{ active: "N's Darumaka" }, { active: 'Koraidon', cond: POISONED }]);
  g.state.p[1].active!.poisonCounters = 3;
  inject(g, g.state.p[1].active!.id, P2);
  choose(g, 'End turn');
  assert.equal(g.state.p[1].active!.damage, 50);
});

test('hp with a noStack key counts once; effects with different keys (or none) add up', () => {
  const dk = deck('Dreepy');
  const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Dreepy' }]);
  const sl = g.state.p[0].active!;
  const hp = () => maxHp(g.env, g.state, sl);
  assert.equal(hp(), 70);
  inject(g, sl.id, { k: 'hp', delta: 40 });
  inject(g, sl.id, { k: 'hp', delta: 40 });
  assert.equal(hp(), 150, 'no key: both count');
  g.state.effects = [];
  inject(g, sl.id, { k: 'hp', delta: 40, noStack: 'Vibrant Dance' });
  inject(g, sl.id, { k: 'hp', delta: 40, noStack: 'Vibrant Dance' });
  assert.equal(hp(), 110, 'one key: once');
  inject(g, sl.id, { k: 'hp', delta: 10, noStack: 'Other' });
  assert.equal(hp(), 120, 'another key counts too');
});

// ------------------------------------------------------------------ 4. Triggers

/** A Tool script with these triggers (a stand-in for an Ability of the Pokémon it is attached to). */
const capeWith = (...triggers: NonNullable<CardScript['triggers']>): CardScript[] => [{ id: 'sv05-152', name: "Hero's Cape", triggers }];

test('allyAttachFromHand: fires for each of your Pokémon with it when you attach an Energy card from your hand, by an action or an effect; not from other places', () => {
  const dk = deck('Dreepy', "Hero's Cape", 'Switch');
  const mk = (): Game =>
    scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], hand: [...rep(FIR, 2)], tools: { 0: ["Hero's Cape"] } }, { active: 'Dreepy', tools: { active: ["Hero's Cape"] } }], {
      scripts: capeWith({ on: 'allyAttachFromHand', program: [{ op: 'counters', n: 1, to: { v: '__target' } }] }),
    });
  const g = mk();
  const [act, ben] = [g.state.p[0].active!, g.state.p[0].bench[0]!];
  choose(g, `Attach ${FIR} to Dreepy (Active)`); // the Cape is on the Benched one: it still fires, for the Pokémon the Energy went to
  assert.equal(act.damage, 10, 'the Pokémon that got the Energy');
  assert.equal(ben.damage, 0);
  assert.equal(g.state.p[1].active!.damage, 0, "the opponent's Tool does not fire for my attach");
  // By an effect from the hand: the same. A stand-in Item that attaches an Energy card from the hand.
  const prog: Program = [
    { op: 'chooseCards', from: 'hand', filter: { cat: 'energy' }, min: 1, max: 1, as: 'e' },
    { op: 'attach', cards: 'e', to: 'myActive' },
  ];
  const t = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], hand: [FIR, 'Switch'], tools: { 0: ["Hero's Cape"] } }, { active: 'Dreepy' }], {
    scripts: [...capeWith({ on: 'allyAttachFromHand', program: [{ op: 'counters', n: 1, to: { v: '__target' } }] }), { id: 'me01-130', name: 'Switch', play: prog }],
  });
  choose(t, 'Play Switch');
  assert.equal(t.state.p[0].active!.damage, 10);
  // From the discard pile it is not "from your hand".
  const d = scenario(dk, dk, [{ active: 'Dreepy', discard: [FIR], hand: ['Switch'], tools: { active: ["Hero's Cape"] } }, { active: 'Dreepy' }], {
    scripts: [
      ...capeWith({ on: 'allyAttachFromHand', program: [{ op: 'counters', n: 1, to: { v: '__target' } }] }),
      { id: 'me01-130', name: 'Switch', play: [{ op: 'chooseCards', from: 'discard', filter: { cat: 'energy' }, min: 1, max: 1, as: 'e' }, { op: 'attach', cards: 'e', to: 'myActive' }] },
    ],
  });
  choose(d, 'Play Switch');
  assert.equal(d.state.p[0].active!.energy.length, 1);
  assert.equal(d.state.p[0].active!.damage, 0);
});

test('oppEvolveFromHand: fires when the opponent plays a Pokémon from their hand to evolve one of theirs; noStack makes only one copy fire', () => {
  const dk = deck('Dreepy', 'Drakloak', "Hero's Cape");
  const mk = (noStack: boolean, capes: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], hand: ['Drakloak', 'Drakloak'] }, { active: 'Dreepy', bench: ['Dreepy'], tools: { active: capes > 0 ? ["Hero's Cape"] : [], 0: capes > 1 ? ["Hero's Cape"] : [] } }], {
      scripts: capeWith({ on: 'oppEvolveFromHand', noStack, program: [{ op: 'counters', n: 4, to: { v: '__target' } }] }),
    });
    for (const sl of [g.state.p[0].active!, g.state.p[0].bench[0]!]) sl.enteredTurn = 0;
    return g;
  };
  const one = mk(true, 1);
  choose(one, 'Evolve Dreepy (Active)');
  assert.equal(one.state.p[0].active!.damage, 40, '4 damage counters on the Pokémon that evolved');
  assert.equal(one.state.p[0].bench[0]!.damage, 0);
  // A second evolution the same turn gets its own 4 (ruling 2145).
  choose(one, 'Evolve Dreepy');
  assert.equal(one.state.p[0].bench[0]!.damage, 40);
  // Two sources: doesn't stack with noStack, stacks without.
  const stacked = mk(false, 2);
  choose(stacked, 'Evolve Dreepy (Active)');
  assert.equal(stacked.state.p[0].active!.damage, 80);
  const single = mk(true, 2);
  choose(single, 'Evolve Dreepy (Active)');
  assert.equal(single.state.p[0].active!.damage, 40, "the effect doesn't stack (ruling 2145)");
  // The controller's own evolution does not fire their own watcher.
  const own = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Drakloak'], tools: { active: ["Hero's Cape"] } }, { active: 'Dreepy' }], {
    scripts: capeWith({ on: 'oppEvolveFromHand', program: [{ op: 'counters', n: 4, to: { v: '__target' } }] }),
  });
  own.state.p[0].active!.enteredTurn = 0;
  choose(own, 'Evolve Dreepy');
  assert.equal(own.state.p[0].active!.damage, 0);
});

test("discardedFromDeck: a card's own trigger when the opponent's attack, Ability, Item or Supporter discards it from its owner's deck during the opponent's turn", () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Switch');
  const trig: CardScript = {
    id: 'me02.5-032',
    name: "N's Darumaka",
    triggers: [{ on: 'discardedFromDeck', program: [{ op: 'move', cards: { top: 2, who: 'opp' }, to: 'discard', who: 'opp' }] }],
  };
  const mill = (n: number, who: 'self' | 'opp' = 'opp'): Program => [{ op: 'move', cards: { top: n, who }, to: 'discard', who }];
  // P1's deck has the card on top. P0 attacks with a Dreepy (stand-in 'Bite') that mills 3 cards of P1's deck.
  const mk = (program: Program, hand: string[] = []): Game =>
    scenario(dk, dk, [{ active: 'Dreepy', energy: { active: [FIR, PSY] }, hand }, { active: 'Dreepy', deckTop: ["N's Darumaka"] }], {
      scripts: [{ id: 'sv06-128', name: 'Dreepy', attacks: { Bite: { program } } }, { id: 'me01-130', name: 'Switch', play: program }, trig],
    });
  const g = mk(mill(3));
  const deckBefore = g.state.p[0].deck.length;
  const oppBefore = g.state.p[1].deck.length;
  choose(g, 'Attack: Bite');
  assert.equal(g.state.p[1].deck.length, oppBefore - 3 - 1, "P1's deck lost the 3 cards (and drew 1 for its turn)");
  assert.equal(g.state.p[0].deck.length, deckBefore - 2, '...and the trigger milled 2 cards of P0\'s deck');
  assert.ok(g.state.p[1].discard.some((c) => nameOf(g, c) === "N's Darumaka"));
  // A Supporter/Item effect counts too (Switch stands in for an Item here).
  const item = mk(mill(3), ['Switch']);
  const before = item.state.p[0].deck.length;
  choose(item, 'Play Switch');
  assert.equal(item.state.p[0].deck.length, before - 2);
  // Your own effect milling your own deck is not "an effect of your opponent's".
  const ownSide = scenario(dk, dk, [{ active: 'Dreepy', energy: { active: [FIR, PSY] } }, { active: 'Dreepy' }], {
    scripts: [{ id: 'sv06-128', name: 'Dreepy', attacks: { Bite: { program: mill(3, 'self') } } }, trig],
  });
  ownSide.state.p[0].deck.push(ownSide.state.p[0].deck.splice(ownSide.state.p[0].deck.findIndex((c) => nameOf(ownSide, c) === "N's Darumaka"), 1)[0]!);
  const ob = ownSide.state.p[1].deck.length;
  choose(ownSide, 'Attack: Bite');
  assert.equal(ownSide.state.p[1].deck.length, ob - 1, "no trigger for a discard from your own deck by your own effect (P1 only drew for its turn)");
});

test('allyActiveDamagedByAttack: fires for each of your Pokémon with it, Active or Benched, when your Active Pokémon is damaged by an attack (even if Knocked Out); not for the Bench being hit', () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Chikorita', "Hero's Cape");
  const watch: CardScript[] = capeWith({
    on: 'allyActiveDamagedByAttack',
    when: { slotIs: { ref: { v: '__target' }, filter: { type: 'Grass' } } },
    program: [{ op: 'counters', n: 1, to: { v: '__attacker' } }],
  });
  const mk = (activeName: string, program: Program, damage = 0): Game =>
    scenario(
      dk,
      dk,
      [
        { active: "N's Darumaka", energy: { active: rep(FIR, 2) } },
        { active: activeName, bench: ['Dreepy', 'Dreepy'], tools: { 0: ["Hero's Cape"], 1: ["Hero's Cape"] }, damage: { active: damage } },
      ],
      { scripts: [...darumaka(program), ...watch] },
    );
  // The Active {G} Pokémon is damaged: each Benched Pokémon with the Cape puts 1 counter on the Attacker (it stacks).
  const g = mk('Chikorita', deal(20));
  attack(g);
  assert.equal(g.state.p[0].active!.damage, 20, 'two sources, 10 each');
  // Not a {G} Pokémon: the filter holds it back.
  const h = mk('Dreepy', deal(20));
  attack(h);
  assert.equal(h.state.p[0].active!.damage, 0);
  // Knocked Out by it: still fires.
  const ko = mk('Chikorita', deal(100));
  attack(ko);
  assert.equal(ko.state.p[0].active!.damage, 20);
  // The Bench being damaged is not the Active Pokémon being damaged.
  const bench = mk('Chikorita', [{ op: 'damage', amount: 20, to: { each: 'oppBench' } }]);
  attack(bench);
  assert.equal(bench.state.p[0].active!.damage, 0);
  // Damage that is prevented is not damage; counters are not damage.
  const counters = mk('Chikorita', [{ op: 'counters', n: 2, to: 'defender' }]);
  attack(counters);
  assert.equal(counters.state.p[0].active!.damage, 0);
});

// ------------------------------------------------------------------ 5. Face-up Prize cards

test('turnPrizeUp: turns one face-down Prize card face up for good; prizeCards counts them; nothing left to turn does nothing', () => {
  const dk = deck('Dreepy', 'Switch');
  const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Switch'], prizes: 2 }, { active: 'Dreepy', prizes: 2 }], {
    scripts: [{ id: 'me01-130', name: 'Switch', play: [{ op: 'turnPrizeUp', who: 'opp', as: 'up' }, { op: 'turnPrizeUp', who: 'self' }] }],
  });
  const ec = { player: 0 as const, slot: 0, vars: {} };
  const n = (e: Expr): number => evalExpr(g.env, g.state, ec, e);
  assert.equal(n({ prizeCards: { who: 'opp', face: 'down' } }), 2);
  assert.equal(n({ prizeCards: { who: 'opp', face: 'up' } }), 0);
  choose(g, 'Play Switch');
  assert.equal(n({ prizeCards: { who: 'opp', face: 'down' } }), 1);
  assert.equal(n({ prizeCards: { who: 'opp', face: 'up' } }), 1);
  assert.equal(n({ prizeCards: { face: 'up' } }), 1, 'my own, turned by the second step');
  const turned = g.state.p[1].prizesUp![0]!;
  assert.ok(g.state.p[1].prizes.includes(turned), 'it stays a Prize card');
  assert.equal(n({ prizeCards: { who: 'opp', face: 'up', filter: { name: nameOf(g, turned) } } }), 1);
  assert.equal(n({ prizeCards: { who: 'opp', face: 'up', filter: { name: 'Nonexistent' } } }), 0);
  // A copy of the state keeps the record, and a hidden-information copy leaves the face-up card where it is.
  assert.deepEqual(cloneState(g.state).p[1].prizesUp, [turned]);
  for (let k = 0; k < 20; k++) {
    const w = determinize(g.state, g.ctx, 0, new Rng(k));
    assert.equal(w.p[1].prizes.indexOf(turned), g.state.p[1].prizes.indexOf(turned), 'a face-up Prize card is not re-sampled');
  }
  // Taking a Prize card that was face up drops it from the count.
  g.state.p[1].prizes = g.state.p[1].prizes.filter((c) => c !== turned);
  assert.equal(n({ prizeCards: { who: 'opp', face: 'up' } }), 0);
});

// ------------------------------------------------------------------ 6. Who attacked last turn

const OTHER_ANCIENT: Cond = { attackedLastTurn: { other: true, filter: { tag: 'Ancient' } } };

test('attackedLastTurn: true for a Pokémon (matching the filter, other than the asking one) that used an attack in that player\'s last turn', () => {
  const dk = deck('Great Tusk', 'Roaring Moon', 'Koraidon', 'Dreepy');
  // Great Tusk (Active) attacks on turn 3; its owner's next turn is 5.
  const g = scenario(dk, dk, [{ active: 'Great Tusk', bench: ['Roaring Moon', 'Dreepy'], energy: { active: ['Fighting Energy', 'Fighting Energy'] } }, { active: 'Dreepy' }], {
    turn: 3,
    current: 0,
    first: 0,
    scripts: [{ id: 'sv05-096', name: 'Great Tusk', attacks: { 'Lunge Out': { program: deal(10) } } }],
  });
  const [tusk, moon, dreepy] = [g.state.p[0].active!, g.state.p[0].bench[0]!, g.state.p[0].bench[1]!];
  const ask = (slot: number, c: Cond = OTHER_ANCIENT, p: 0 | 1 = 0): boolean => evalCond(g.env, g.state, { player: p, slot, vars: {} }, c);
  assert.ok(!ask(moon.id), 'nobody has attacked yet');
  choose(g, 'Attack: Lunge Out');
  assert.equal(g.state.turn, 4);
  assert.ok(ask(moon.id, OTHER_ANCIENT, 0), "in the opponent's turn the player's last turn is the one just ended");
  choose(g, 'End turn');
  assert.equal(g.state.turn, 5);
  assert.ok(ask(moon.id), 'Great Tusk is an Ancient Pokémon other than Roaring Moon');
  assert.ok(!ask(tusk.id), "it is the Pokémon itself: not an 'other' one");
  assert.ok(ask(tusk.id, { attackedLastTurn: { filter: { tag: 'Ancient' } } }), 'without `other` it counts itself');
  assert.ok(!ask(moon.id, { attackedLastTurn: { other: true, filter: { name: 'Dreepy' } } }), 'the filter');
  assert.ok(!ask(dreepy.id, { attackedLastTurn: { other: true, filter: { tag: 'Future' } } }), 'the filter: tag');
  assert.ok(ask(moon.id, { attackedLastTurn: { who: 'self' } }));
  assert.ok(!ask(moon.id, { attackedLastTurn: { who: 'opp' } }), "the opponent did not attack");
  // The record is of the last turn only: another turn goes by without an attack.
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.equal(g.state.turn, 7);
  assert.ok(!ask(moon.id), 'two turns ago is not last turn');
});

test('A failed attack does not count as having attacked last turn (Confusion, ruling 2087); the record belongs to the Pokémon in play (ruling 2092), or the card it was once it has left', () => {
  const dk = deck('Great Tusk', 'Roaring Moon', 'Koraidon', 'Dreepy');
  const mk = (cond: number, coin: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Great Tusk', bench: ['Roaring Moon'], energy: { active: ['Fighting Energy', 'Fighting Energy'] }, cond }, { active: 'Dreepy' }], {
      scripts: [{ id: 'sv05-096', name: 'Great Tusk', attacks: { 'Lunge Out': { program: deal(10) } } }],
    });
    g.state.forcedCoins = [coin];
    choose(g, 'Attack: Lunge Out');
    if (g.state.turn === 3) choose(g, 'End turn'); // a failed attack leaves the turn to end by hand? (it ends by itself)
    return g;
  };
  const ask = (g: Game, slot: number): boolean => evalCond(g.env, g.state, { player: 0, slot, vars: {} }, OTHER_ANCIENT);
  const tails = mk(CONFUSED, false);
  while (tails.state.turn < 5) choose(tails, 'End turn');
  assert.ok(!ask(tails, tails.state.p[0].bench[0]!.id), 'tails while Confused: no attack was used');
  const heads = mk(CONFUSED, true);
  while (heads.state.turn < 5) choose(heads, 'End turn');
  assert.ok(ask(heads, heads.state.p[0].bench[0]!.id), 'heads: it attacked');
  // A different card in the place of the one that attacked (what Thorton does) is the same Pokémon: it is not an "other" one.
  const swap = mk(0, true);
  while (swap.state.turn < 5) choose(swap, 'End turn');
  const place = swap.state.p[0].active!;
  place.cards = [swap.state.p[0].deck.splice(swap.state.p[0].deck.findIndex((c) => nameOf(swap, c) === 'Koraidon'), 1)[0]!];
  assert.ok(!ask(swap, place.id), 'the same Pokémon');
  assert.ok(ask(swap, swap.state.p[0].bench[0]!.id), 'for the others it is an Ancient Pokémon that attacked');
  // Once it has left play, the card it was decides.
  const gone = mk(0, true);
  while (gone.state.turn < 5) choose(gone, 'End turn');
  const tusk = gone.state.p[0].active!;
  gone.state.p[0].active = null;
  gone.state.p[0].discard.push(...tusk.cards);
  assert.ok(ask(gone, gone.state.p[0].bench[0]!.id), 'a Pokémon that left play still attacked');
  assert.ok(!evalCond(gone.env, gone.state, { player: 0, slot: 0, vars: {} }, { attackedLastTurn: { filter: { name: 'Dreepy' } } }));
});
