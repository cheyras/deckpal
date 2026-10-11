/**
 * Engine features added with the std-engine2 batch, each tested on its own (the cards that use them are in
 * cards-std-engine2.test.ts):
 *  1. the Knocked-Out-by-an-attack trigger           2. Active-to-Bench triggers (own, and the opponent's seen by another)
 *  3. cards played from hand this turn               4. attacks usable on the first player's first turn
 *  5. Prize modifiers (koPrizes, extraPrize)         6. records of the last turn (Prizes, damage taken, Knock Outs)
 *  7. damageIn noStack                               8. the anyAbility filter
 *  9. coin-flip Knock Out survival                  10. a Pokémon's types (and extra types)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, StaticEffect } from '../dsl.js';
import { cardMatches, evalCond, evalExpr, slotMatches, slotTypes } from '../eval.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { cloneState, findSlot } from '../state.js';
import { POISONED, type Decision } from '../types.js';
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

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const DUG = "Team Rocket's Dugtrio"; // Ability Holes; Mud Shot {F}{C} 50
const LIL = "Lillie's Determination"; // a Supporter
const HAW = 'Mega Hawlucha ex'; // 250 HP, Weakness {P} x2
const IDS: Record<string, string> = {
  'Dragapult ex': 'sv06-130',
  Slowpoke: 'me05-029',
  Rellor: 'sv08-013',
  Pecharunt: 'me02.5-143',
  Flygon: 'me02-053',
  [DUG]: 'me02.5-101',
  Clawitzer: 'me01-038',
  "Boss's Orders": 'me01-114',
  Switch: 'me01-130',
  'Battle Cage': 'me02-085',
  [LIL]: 'me01-119',
  'Tapu Koko': 'me02.5-067',
  Carbink: 'me02.5-117',
  [HAW]: 'me02.5-116',
  Trapinch: 'sv08-104',
};
function deck(...names: string[]) {
  return fromIds('engine2', [...[...new Set(names)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance; Jet Headbutt {C} 70
const SLO = 'Slowpoke'; // Basic 70 HP; Headbutt {C}{C} 20; retreat 2
const REL = 'Rellor'; // Basic 40 HP; retreat 1

const W = 'Water Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const L = 'Lightning Energy';

/** Put a timed effect on a Pokémon directly (a stand-in for the attack or Ability that would have set it). */
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
/** A player-level effect (scope relative to `player`). */
function injectPlayer(g: Game, player: 0 | 1, st: StaticEffect, scope: 'me' | 'oppPokemon' | 'myPokemon' = 'me'): void {
  g.state.effects.push({ static: st, slot: -1, player, scope, until: g.state.turn + 1, fromAttack: false, src: 0 });
}
const damageOf = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const ecFor = (g: Game, p: 0 | 1, slot = 0) => ({ player: p, slot, vars: {} });
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
/** Take the named card out of a player's deck and put it into the stadium slot. */
function setStadium(g: Game, owner: 0 | 1, name: string): void {
  const deckCards = g.state.p[owner].deck;
  const i = deckCards.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in the deck`);
  g.state.stadium = { card: deckCards.splice(i, 1)[0]!, owner };
}
/** An attack by the Dragapult ex that also does 90 damage to each of the opponent's Benched Pokémon. */
const BENCH_HIT: CardScript = { id: 'sv06-130', name: 'Dragapult ex', attacks: { 'Jet Headbutt': { post: [{ op: 'damage', amount: 90, to: { each: 'oppBench' } }] } } };

// ------------------------------------------------------------------ 1. Knocked Out by damage from an attack

test('knockedOutByAttack: fires for the Knocked Out Pokémon\'s owner while it is still in play (before the discard pile), then the Knock Out goes through', () => {
  const dk = deck(DRA, 'Pecharunt', SLO);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: 'Pecharunt', bench: [SLO], damage: { active: 10 } }], { events: true });
  const pec = g.state.p[1].active!.cards[0]!;
  choose(g, 'Attack: Jet Headbutt'); // 70 damage on top of 10: 80 HP, Knocked Out
  assert.equal(g.decision?.player, 1, 'the owner of the Knocked Out Pokémon decides (it searches its own deck)');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.state.p[1].active?.cards[0], pec, 'the Pokémon is still in play while its Ability resolves');
  assert.ok(!g.state.p[1].discard.includes(pec), 'and not yet in the discard pile');
  const found = (g.decision?.values as number[])[0]!;
  g.submit([0]);
  assert.ok(g.state.p[1].hand.includes(found), 'Final Chain put the card into the hand');
  assert.ok(g.state.p[1].discard.includes(pec), 'then the Knock Out is carried out');
  assert.equal(g.state.p[0].prizesTaken, 1, 'and the attacker took its Prize card');
  const search = g.events.findIndex((e) => e.type === 'search');
  const ko = g.events.findIndex((e) => e.type === 'knockout');
  assert.ok(search >= 0 && search < ko, 'the search came before the Knock Out');
  assert.notEqual(g.state.p[1].active!.cards[0], pec, 'the Benched Pokémon was promoted afterwards');
});

test('knockedOutByAttack: not for a Knock Out by Poison at Checkup; a Benched Pokémon hit by an attack does fire', () => {
  const dk = deck(DRA, 'Pecharunt', SLO);
  const poison = scenario(dk, dk, [{ active: DRA }, { active: 'Pecharunt', bench: [SLO], damage: { active: 70 }, cond: POISONED }], { events: true });
  choose(poison, 'End turn');
  assert.ok(poison.state.p[1].discard.length > 0, 'Poison Knocked Out Pecharunt at Checkup');
  assert.equal(poison.events.filter((e) => e.type === 'search').length, 0, 'no trigger: not damage from an attack');
  assert.equal(poison.decision?.kind, 'main');

  // A Benched Pokémon Knocked Out by damage the attack did to the Bench.
  const bench = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: SLO, bench: ['Pecharunt'] }], { scripts: [BENCH_HIT], events: true });
  const pec = bench.state.p[1].bench[0]!.cards[0]!;
  choose(bench, 'Attack: Jet Headbutt');
  assert.equal(bench.decision?.player, 1);
  assert.equal(bench.decision?.kind, 'cards', 'a Benched Pokémon fires its trigger too (when the card does not say Active Spot)');
  assert.ok(bench.state.p[1].bench.some((b) => b.cards[0] === pec), 'still on the Bench while it resolves');
  bench.submit([0]);
  assert.ok(bench.state.p[1].discard.includes(pec));
});

test('knockedOutByAttack: a `when` such as inActive is checked while the Pokémon is still in play; an optional trigger asks its owner', () => {
  const dk = deck(DRA, 'Flygon', SLO);
  // Benched Flygon: "if this Pokémon is in the Active Spot" is not met, so there is nothing to ask.
  const benched = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: SLO, bench: ['Flygon'], damage: { 0: 100 } }], { scripts: [BENCH_HIT] });
  choose(benched, 'Attack: Jet Headbutt');
  assert.ok(benched.state.p[1].discard.length > 0, 'the Benched Flygon was Knocked Out');
  assert.notEqual(benched.decision?.kind, 'yesno');
  // Active Flygon: asked; yes discards the top 2 cards of the opponent's deck, no does nothing.
  const mk = (): Game => scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: 'Flygon', bench: [SLO], damage: { active: 100 } }]);
  const yes = mk();
  const deck0 = yes.state.p[0].deck.length;
  choose(yes, 'Attack: Jet Headbutt');
  assert.equal(yes.decision?.kind, 'yesno');
  assert.equal(yes.decision?.player, 1);
  yes.submit([0]);
  assert.equal(yes.state.p[0].deck.length, deck0 - 2);
  assert.equal(yes.state.p[0].discard.length, 2);
  const no = mk();
  choose(no, 'Attack: Jet Headbutt');
  no.submit([1]);
  assert.equal(no.state.p[0].deck.length, deck0);
});

// ------------------------------------------------------------------ 2. Active Pokémon moves to the Bench

test('oppActiveMovedToBench: a retreat in the mover\'s own turn fires the other side\'s trigger on that Pokémon; two sources stack', () => {
  const dk = deck(DRA, DUG, SLO, REL);
  const retreat = (benchOfWatcher: string[]): Game => {
    const g = scenario(dk, dk, [{ active: DRA, bench: benchOfWatcher }, { active: SLO, bench: [REL], energy: { active: [P, P] } }], { current: 1 });
    choose(g, 'Retreat');
    return g;
  };
  const one = retreat([DUG]);
  assert.equal(nameOf(one, one.state.p[1].active!.cards[0]!), 'Rellor', 'the replacement is the new Active Pokémon');
  assert.equal(one.state.p[1].bench[0]!.damage, 20, '2 damage counters on the Pokémon that moved (the Dugtrio is Benched: it works anywhere)');
  assert.equal(one.state.p[1].active!.damage, 0, 'and none on its replacement');
  // Ruling (Ascending Heroes FAQ, TPCi Rules Team 2026-01-22, https://compendium.pokegym.net/ruling/2285/): "They place 4 damage counters. The Ability can stack."
  const two = retreat([DUG, DUG]);
  assert.equal(two.state.p[1].bench[0]!.damage, 40);
});

test('oppActiveMovedToBench: only during the mover\'s own turn, and a Knock Out and the promotion after it is not a move to the Bench', () => {
  const dk = deck(DRA, DUG, SLO, REL, "Boss's Orders");
  // The watcher's own gust: the opponent's Active moves to the Bench during the WATCHER's turn.
  const gust = scenario(dk, dk, [{ active: DRA, bench: [DUG], hand: ["Boss's Orders"] }, { active: SLO, bench: [REL] }]);
  choose(gust, "Play Boss's Orders");
  assert.equal(nameOf(gust, gust.state.p[1].active!.cards[0]!), 'Rellor');
  assert.equal(gust.state.p[1].bench[0]!.damage, 0, 'not "during their turn": no counters');
  // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2247/): "No, because that replacement happens during your turn, not theirs."
  const ko = scenario(dk, dk, [{ active: DRA, bench: [DUG], energy: { active: [P] } }, { active: SLO, bench: [REL], damage: { active: 20 } }]);
  choose(ko, 'Attack: Jet Headbutt');
  assert.equal(ko.state.p[1].active!.damage, 0, 'the promoted Pokémon is untouched');
  assert.equal(ko.state.p[1].discard.length, 1);
});

test('oppActiveMovedToBench: Battle Cage stops the counters, because the Pokémon is on the Bench when the Ability applies (TPCi 2026-01-22, ruling 2286)', () => {
  const dk = deck(DRA, DUG, SLO, REL, 'Battle Cage');
  const g = scenario(dk, dk, [{ active: DRA, bench: [DUG] }, { active: SLO, bench: [REL], energy: { active: [P, P] } }], { current: 1 });
  setStadium(g, 0, 'Battle Cage');
  choose(g, 'Retreat');
  assert.equal(g.state.p[1].bench[0]!.damage, 0);
});

test('movedToBench + oncePerTurn: fires for the Pokémon itself on a switch or retreat in its controller\'s turn, once a turn, counted only when accepted', () => {
  const dk = deck(DRA, 'Clawitzer', SLO, REL, 'Switch', "Boss's Orders");
  const g = scenario(dk, dk, [{ active: 'Clawitzer', bench: [SLO, REL], energy: { active: [W, W] }, hand: [W, W, W, 'Switch', 'Switch', 'Switch', 'Switch'] }, { active: DRA }]);
  const clawitzer = g.state.p[0].active!;
  choose(g, 'Retreat');
  choose(g, 'Slowpoke'); // the new Active Pokémon
  assert.equal(g.decision?.kind, 'yesno', 'Clawitzer moved to the Bench: it may use Fall Back to Reload');
  g.submit([1]); // decline
  assert.equal(clawitzer.energy.length, 0);
  assert.ok(!clawitzer.usedAbilities.some((k) => k < 0), 'declining does not use it up');
  choose(g, 'Play Switch'); // Slowpoke <-> Clawitzer
  choose(g, 'Clawitzer');
  assert.equal(g.state.p[0].active, clawitzer);
  choose(g, 'Play Switch'); // Clawitzer goes back to the Bench: offered again
  choose(g, 'Slowpoke');
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
  assert.equal(g.decision?.kind, 'cards', 'attach up to 2 Basic {W} Energy cards from the hand');
  assert.equal(g.decision?.min, 1);
  assert.equal(g.decision?.max, 2);
  g.submit([0, 1]);
  assert.equal(clawitzer.energy.length, 2, 'two attached from the hand');
  assert.ok(clawitzer.usedAbilities.some((k) => k < 0), 'used once this turn');
  // Another move this turn: not offered again.
  choose(g, 'Play Switch');
  choose(g, 'Clawitzer');
  choose(g, 'Play Switch');
  choose(g, 'Slowpoke');
  assert.equal(g.decision?.kind, 'main', 'no question: the Ability was used this turn');
  assert.equal(clawitzer.energy.length, 2);
  // Not in the opponent's turn: a gust then moves it to the Bench, but it is not "your turn".
  const opp = scenario(dk, dk, [{ active: 'Clawitzer', bench: [SLO], hand: [W, W] }, { active: DRA, bench: [REL], hand: ["Boss's Orders"] }], { current: 1 });
  choose(opp, "Play Boss's Orders");
  assert.equal(nameOf(opp, opp.state.p[0].active!.cards[0]!), 'Slowpoke');
  assert.equal(opp.decision?.player, 1, 'no question for the Clawitzer\'s owner');
  assert.equal(opp.decision?.kind, 'main');
  // With no Basic {W} Energy card in hand there is nothing to attach: not offered.
  const none = scenario(dk, dk, [{ active: 'Clawitzer', bench: [SLO], energy: { active: [W, W] }, hand: [P] }, { active: DRA }]);
  choose(none, 'Retreat');
  assert.equal(none.decision?.kind, 'main');
});

// ------------------------------------------------------------------ 3. cards played from hand this turn

test('playedThisTurn: cards put into play by the player\'s own actions are recorded by id, per player', () => {
  const dk = deck(DRA, SLO, REL, LIL, 'Switch');
  const g = scenario(dk, dk, [{ active: DRA, bench: [REL], hand: [LIL, 'Switch', P, SLO] }, { active: SLO }]);
  const played = (filter: object, who?: 'self' | 'opp'): boolean => evalCond(g.env, g.state, ecFor(g, 0), { playedThisTurn: { filter, who } });
  assert.equal(played({ name: LIL }), false);
  choose(g, `Play ${LIL}`); // a Supporter
  assert.equal(played({ name: LIL }), true);
  assert.equal(played({ name: [LIL, 'Canari'] }), true, 'any of the names');
  assert.equal(played({ nameIncludes: 'Lillie' }), true);
  assert.equal(played({ ttype: 'supporter' }), true);
  assert.equal(played({ ttype: 'item' }), false);
  assert.equal(played({ ttype: 'supporter', nameIncludes: 'Rocket' }), false);
  assert.equal(played({ name: LIL }, 'opp'), false, 'a separate record for each player');
  assert.equal(evalCond(g.env, g.state, ecFor(g, 1), { playedThisTurn: { filter: { name: LIL }, who: 'opp' } }), true, 'the other player asks about the opponent');
  assert.equal(evalCond(g.env, g.state, ecFor(g, 1), { playedThisTurn: { filter: { name: LIL } } }), false, 'and about themselves');
  // The record is a plain list of card ids: it is cloned with the state.
  const copy = cloneState(g.state);
  copy.p[0].playedThisTurn!.push(999);
  assert.equal(g.state.p[0].playedThisTurn!.length, 1);
});

test('playedThisTurn: Pokémon benched, Energy attached and Tools count; the next turn starts fresh', () => {
  const dk = deck(DRA, SLO, REL);
  const g = scenario(dk, dk, [{ active: SLO, hand: [REL, P] }, { active: DRA }]);
  const played = (filter: object): boolean => evalCond(g.env, g.state, ecFor(g, 0), { playedThisTurn: { filter } });
  assert.equal(played({ cat: 'pokemon' }), false);
  choose(g, 'Bench Rellor');
  assert.equal(played({ cat: 'pokemon', name: 'Rellor' }), true);
  assert.equal(played({ cat: 'energy' }), false);
  choose(g, 'Attach Psychic Energy to Slowpoke');
  assert.equal(played({ cat: 'energy' }), true);
  choose(g, 'End turn');
  choose(g, 'End turn'); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.equal(played({ cat: 'pokemon' }), false, 'a new turn of this player: the record is empty again');
  assert.equal(g.state.p[0].playedThisTurn!.length, 0);
});

// ------------------------------------------------------------------ 4. attacks usable on the first player's first turn

test('AttackScript.firstTurn: that attack (and only that) is offered on the first player\'s first turn; later turns are normal', () => {
  const dk = deck('Tapu Koko', DRA);
  const koko = { active: 'Tapu Koko', energy: { active: [L, L, L] }, hand: [P, P, P] };
  const first = scenario(dk, dk, [koko, { active: DRA }], { turn: 1, current: 0 });
  assert.ok(has(first, 'Attack: Fast Flight'), 'the attack that says "If you go first, you can use this attack during your first turn"');
  assert.ok(!has(first, 'Attack: Thunder Blast'), 'any other attack still waits for turn 2');
  const later = scenario(dk, dk, [koko, { active: DRA }], { turn: 3, current: 0 });
  assert.ok(has(later, 'Attack: Fast Flight') && has(later, 'Attack: Thunder Blast'));
  const second = scenario(dk, dk, [{ active: DRA }, koko], { turn: 2, current: 1, first: 0 }); // the second player's first turn is turn 2
  assert.ok(has(second, 'Attack: Thunder Blast'), 'attacks are allowed there anyway');
  choose(first, 'Attack: Fast Flight');
  assert.equal(first.state.p[0].hand.length, 5, 'discarded the hand and drew 5');
});

// ------------------------------------------------------------------ 5. Prize modifiers

/** P0's `attacker` KOs P1's `defender` (pre-damaged to the brink); returns P0's Prize cards taken. */
function ko(defender: string, attacker: string, effects: StaticEffect[], opts: { defenderDamage?: number; attackerEnergy?: string[] } = {}): number {
  const dk = deck(DRA, SLO, REL);
  const g = scenario(dk, dk, [{ active: attacker, energy: { active: opts.attackerEnergy ?? [P, P] } }, { active: defender, bench: [REL], damage: { active: opts.defenderDamage ?? 60 } }]);
  for (const st of effects) inject(g, g.state.p[1].active!.id, st);
  choose(g, `Attack: ${attacker === DRA ? 'Jet Headbutt' : 'Headbutt'}`);
  return g.state.p[0].prizesTaken;
}

test('koPrizes: fewer/more Prize cards for a Pokémon Knocked Out by damage from an attack of a matching attacker, never below 0', () => {
  const fewerFromEx: StaticEffect = { k: 'koPrizes', delta: -1, attacker: { ex: true } };
  assert.equal(ko(SLO, DRA, []), 1, 'control: a non-ex Pokémon is worth 1 Prize card');
  assert.equal(ko(SLO, DRA, [fewerFromEx]), 0, '1 fewer when the attacker is a Pokémon ex');
  assert.equal(ko(SLO, SLO, [fewerFromEx]), 1, 'but not when the attacker is not');
  assert.equal(ko(SLO, DRA, [{ k: 'koPrizes', delta: 2 }]), 3, 'more, with no attacker filter');
  assert.equal(ko(SLO, DRA, [{ k: 'koPrizes', delta: -3 }]), 0, 'never negative');
  assert.equal(ko(DRA, DRA, [], { defenderDamage: 260 }), 2, 'control: a Pokémon ex is worth 2');
});

test('koPrizes: `none` means no Prize cards; noStack keys count once; Poison at Checkup is not damage from an attack', () => {
  const noPrizesToEx: StaticEffect = { k: 'koPrizes', none: true, attacker: { ex: true } };
  assert.equal(ko(DRA, DRA, [noPrizesToEx], { defenderDamage: 260 }), 0, 'your opponent can\'t take any Prize cards for it');
  assert.equal(ko(DRA, SLO, [noPrizesToEx], { defenderDamage: 305 }), 2, 'the attacker is not a Pokémon ex: the Prize cards are taken');
  const stack = (key: string | undefined): number =>
    ko(DRA, DRA, [{ k: 'koPrizes', delta: -1, noStack: key }, { k: 'koPrizes', delta: -1, noStack: key }], { defenderDamage: 260 });
  assert.equal(stack(undefined), 0, 'two effects with no key add up: 2 - 2');
  assert.equal(stack('Shadowy Concealment'), 1, 'sharing a key they count once: 2 - 1');
  // Checkup: Poison Knocks Out a Pokémon that no attack damaged.
  const dk = deck(DRA, SLO, REL);
  const g = scenario(dk, dk, [{ active: DRA }, { active: SLO, bench: [REL], damage: { active: 60 }, cond: POISONED }]);
  inject(g, g.state.p[1].active!.id, { k: 'koPrizes', delta: -1 });
  choose(g, 'End turn');
  assert.equal(g.state.p[0].prizesTaken, 1, 'the modifier applies only to Knock Outs by damage from an attack');
});

test('extraPrize: an amount and an attacker filter; effects sharing a noStack key count once; the Knock Out must be by damage from a matching attacker', () => {
  const run = (effects: StaticEffect[], attacker = DRA, poison = false, coins: boolean[] = []): Game => {
    const dk = deck(DRA, SLO, REL);
    const g = scenario(dk, dk, [{ active: attacker, energy: { active: [P, P] } }, { active: SLO, bench: [REL], damage: { active: 60 }, cond: poison ? POISONED : 0 }]);
    for (const st of effects) injectPlayer(g, 0, st);
    g.state.forcedCoins = coins;
    choose(g, poison ? 'End turn' : `Attack: ${attacker === DRA ? 'Jet Headbutt' : 'Headbutt'}`);
    return g;
  };
  const taken = (...a: Parameters<typeof run>): number => run(...a).state.p[0].prizesTaken;
  const more2: StaticEffect = { k: 'extraPrize', amount: 2, attacker: { name: 'Dragapult ex' } };
  assert.equal(taken([]), 1);
  assert.equal(taken([more2]), 3, '1 + 2 more Prize cards');
  assert.equal(taken([more2], SLO), 1, 'not for an attack used by another Pokémon');
  assert.equal(taken([more2], DRA, true), 1, 'not for a Knock Out by Poison');
  assert.equal(taken([{ k: 'extraPrize', amount: 2 }]), 3, 'no filter: any Knock Out of the Active Pokémon');
  assert.equal(taken([{ k: 'extraPrize', amount: 2 }], DRA, true), 3, '... even by Poison (Wonder Kiss reads that way)');
  assert.equal(taken([more2, more2]), 5, 'two such effects add up');
  assert.equal(taken([{ ...more2, noStack: 'X' }, { ...more2, noStack: 'X' }]), 3, 'with a shared noStack key they count once');
  // A legacy effect (Wonder Kiss: no amount, no key) still never stacks, and flips once.
  const wonder = run([{ k: 'extraPrize', flip: true }, { k: 'extraPrize', flip: true }], DRA, false, [true, true]);
  assert.equal(wonder.state.p[0].prizesTaken, 2);
  assert.deepEqual(wonder.state.forcedCoins, [true], 'one flip however many');
});

// ------------------------------------------------------------------ 6. records of the last turn

test('prizesTakenLastTurn: the Prize cards a player took during their own most recent turn', () => {
  const dk = deck(DRA, SLO, REL);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: SLO, bench: [REL], damage: { active: 60 } }], { drawForTurn: true });
  const lastTurn = (p: 0 | 1, who: 'self' | 'opp'): number => evalExpr(g.env, g.state, ecFor(g, p), { prizesTakenLastTurn: who });
  assert.equal(lastTurn(1, 'opp'), 0, 'nothing yet');
  choose(g, 'Attack: Jet Headbutt'); // Knocks Out Slowpoke: P0 takes 1 Prize card in turn 3
  assert.equal(g.state.turn, 4);
  assert.equal(lastTurn(1, 'opp'), 1, 'on P1\'s turn: P0 took 1 during their last turn');
  assert.equal(lastTurn(1, 'self'), 0);
  choose(g, 'End turn'); // P1 takes none; then P0's turn 5
  assert.equal(g.state.turn, 5);
  assert.equal(lastTurn(0, 'opp'), 0, 'P1 took none in turn 4');
  assert.equal(lastTurn(0, 'self'), 1, 'and P0\'s own last turn is still the turn with the Prize card');
});

test('prizesTakenLastTurn: a Prize card taken at Checkup counts for the turn it ends, and one taken in the other player\'s turn does not', () => {
  const dk = deck(DRA, SLO, REL);
  // P0's turn 3 ends: Poison Knocks Out P1's Slowpoke at Checkup, and P0 takes the Prize card, still in P0's own turn.
  const h = scenario(dk, dk, [{ active: DRA }, { active: SLO, bench: [REL], damage: { active: 60 }, cond: POISONED }], { drawForTurn: true });
  choose(h, 'End turn');
  assert.equal(h.state.p[0].prizesTaken, 1);
  assert.equal(evalExpr(h.env, h.state, ecFor(h, 1), { prizesTakenLastTurn: 'opp' }), 1);
  // P1's turn: P1 takes none, so P0's record is untouched; P1's own Pokémon lost to Poison in P1's own turn give P0 the Prize card, not P1.
  const g = scenario(dk, dk, [{ active: SLO, bench: [REL], damage: { active: 60 }, cond: POISONED }, { active: DRA }], { current: 1, turn: 4, drawForTurn: true });
  choose(g, 'End turn');
  assert.equal(g.state.p[1].prizesTaken, 1);
  assert.equal(evalExpr(g.env, g.state, ecFor(g, 0), { prizesTakenLastTurn: 'opp' }), 1, 'P1 took it at the end of its own turn');
  assert.equal(evalExpr(g.env, g.state, ecFor(g, 0), { prizesTakenLastTurn: 'self' }), 0, 'and P0 took none in its own last turn');
});

test('damageTakenLastTurn: damage from the opponent\'s attacks in their last turn, per Pokémon; counters are not damage; older turns do not count', () => {
  const dk = deck(DRA, SLO, REL);
  const counters: CardScript = { id: 'sv06-130', name: 'Dragapult ex', attacks: { 'Jet Headbutt': { program: [{ op: 'counters', n: 4, to: 'defender' }] } } };
  const damage = (g: Game): number => evalExpr(g.env, g.state, ecFor(g, 0, g.state.p[0].active!.id), { damageTakenLastTurn: 'self' });
  const h = scenario(dk, dk, [{ active: REL, bench: [SLO] }, { active: SLO, energy: { active: [P, P] } }], { current: 1, turn: 4 });
  assert.equal(damage(h), 0);
  choose(h, 'Attack: Headbutt'); // 20 damage to Rellor (40 HP)
  assert.equal(h.state.turn, 5);
  assert.equal(damage(h), 20, 'Rellor took 20 from an attack in the opponent\'s last turn');
  h.state.turn = 7;
  assert.equal(damage(h), 0, 'only the opponent\'s last turn counts');
  h.state.turn = 5;
  const c = scenario(dk, dk, [{ active: SLO, bench: [REL] }, { active: DRA, energy: { active: [P] } }], { current: 1, turn: 4, scripts: [counters] });
  choose(c, 'Attack: Jet Headbutt');
  assert.equal(c.state.p[0].active!.damage, 40, 'four damage counters were placed');
  assert.equal(damage(c), 0, 'but placing damage counters is not damage (TPCi 2025-11-13, ruling 2253)');
  // Several attacks in one turn add up (a copied attack), and the total is of the damage actually dealt.
  const two = scenario(dk, dk, [{ active: DRA, bench: [REL] }, { active: DRA, energy: { active: [P] } }], { current: 1, turn: 4 });
  choose(two, 'Attack: Jet Headbutt');
  assert.equal(damage(two), 70);
});

test('koLastTurn with a filter: any of this side\'s Pokémon matching it were Knocked Out in the opponent\'s last turn; the record keeps two turns', () => {
  const dk = deck(DRA, SLO, REL);
  const g = scenario(dk, dk, [{ active: SLO, bench: [REL, REL], damage: { active: 60 } }, { active: DRA, energy: { active: [P] } }], { current: 1, turn: 4 });
  const ask = (filter?: object): boolean => evalCond(g.env, g.state, ecFor(g, 0), { koLastTurn: 'self', filter });
  assert.equal(ask(), false);
  choose(g, 'Attack: Jet Headbutt'); // Slowpoke Knocked Out in turn 4
  choose(g, 'Rellor'); // promote one of the two Benched Rellor
  assert.equal(g.state.turn, 5);
  assert.equal(ask(), true);
  assert.equal(ask({ name: 'Slowpoke' }), true);
  assert.equal(ask({ name: 'Rellor' }), false, 'no Rellor was Knocked Out');
  assert.equal(ask({ nameIncludes: 'Slow' }), true);
  assert.equal(ask({ cat: 'trainer' }), false);
  // A Knock Out in the player's OWN turn does not hide the one from the opponent's turn before it.
  const r = g.state.p[0];
  r.active!.damage = 30;
  r.active!.cond = POISONED;
  choose(g, 'End turn'); // Checkup in turn 5: Rellor dies of Poison
  assert.equal(g.state.turn, 6);
  assert.deepEqual(r.koCards!.map((c) => nameOf(g, c)), ['Rellor']);
  assert.equal(r.prevKoCardsTurn, 4, 'turn 4\'s Knock Out is kept');
  assert.deepEqual(r.prevKoCards!.map((c) => nameOf(g, c)), ['Slowpoke']);
});

// ------------------------------------------------------------------ 7. damageIn noStack

test('damageIn noStack: effects sharing a key reduce damage once per attack; without a key they add up', () => {
  const dk = deck(DRA, SLO);
  const dealt = (effects: StaticEffect[]): number => {
    const g = scenario(dk, dk, [{ active: DRA }, { active: DRA, energy: { active: [P] } }], { current: 1 });
    for (const st of effects) inject(g, g.state.p[0].active!.id, st);
    choose(g, 'Attack: Jet Headbutt');
    return damageOf(g, 0);
  };
  const less = (noStack?: string, amount = -30): StaticEffect => ({ k: 'damageIn', amount, noStack });
  assert.equal(dealt([]), 70);
  assert.equal(dealt([less(), less()]), 10, 'no key: 70 - 30 - 30');
  assert.equal(dealt([less('Tundra Wall'), less('Tundra Wall')]), 40, 'the same key: counted once');
  assert.equal(dealt([less('Tundra Wall'), less('Other')]), 10, 'different keys both apply');
  assert.equal(dealt([less('Tundra Wall'), less(undefined, -10)]), 30, 'a keyed and an unkeyed one both apply');
});

// ------------------------------------------------------------------ 8. Filter.anyAbility

test('Filter.anyAbility: matches Pokémon (and cards) that have an Ability printed, and as an attacker filter respects "no Abilities"', () => {
  const dk = deck(DRA, SLO, DUG);
  const g = scenario(dk, dk, [{ active: DUG, bench: [SLO], hand: [DUG, SLO] }, { active: DRA }]);
  const dug = g.state.p[0].active!;
  const slo = g.state.p[0].bench[0]!;
  assert.equal(slotMatches(g.env, dug, { anyAbility: true }), true);
  assert.equal(slotMatches(g.env, slo, { anyAbility: true }), false);
  assert.equal(slotMatches(g.env, slo, { anyAbility: false }), true);
  assert.equal(slotMatches(g.env, dug, { anyAbility: true, stage: 'stage1' }), true, 'combines with other keys');
  assert.equal(evalExpr(g.env, g.state, ecFor(g, 0), { count: { zone: 'hand', filter: { anyAbility: true } } }), 1, 'cards in a zone too');
  const handDug = g.state.p[0].hand.find((c) => nameOf(g, c) === DUG)!;
  assert.equal(cardMatches(g.env, handDug, { anyAbility: true }), true);
  // As the `attacker` of damageIn: -30 from Pokémon that have an Ability.
  const hit = (attacker: string, atk: string, energy: string[], lockAbilities = false): number => {
    const h = scenario(dk, dk, [{ active: DRA }, { active: attacker, energy: { active: energy } }], { current: 1 });
    inject(h, h.state.p[0].active!.id, { k: 'damageIn', amount: -30, attacker: { anyAbility: true } });
    if (lockAbilities) injectPlayer(h, 0, { k: 'noAbilities' }, 'oppPokemon');
    choose(h, `Attack: ${atk}`);
    return damageOf(h, 0);
  };
  assert.equal(hit(DUG, 'Mud Shot', [FI, FI]), 20, '50 - 30 from an attacker with an Ability');
  assert.equal(hit(SLO, 'Headbutt', [P, P]), 20, 'a Pokémon with no Ability is not reduced');
  // Ruling (Phantasmal Flames FAQ, TPCi Rules Team 2025-11-13, https://compendium.pokegym.net/ruling/2260/): Pokémon that "have no Abilities" are not Pokémon that have an Ability.
  assert.equal(hit(DUG, 'Mud Shot', [FI, FI], true), 50, 'with its Abilities switched off the reduction does not apply');
});

// ------------------------------------------------------------------ 9. coin-flip Knock Out survival

test('surviveKoCoinFlip: after the attack\'s full damage, heads leaves the Pokémon with 10 HP remaining; tails Knocks it Out; Checkup damage is not an attack', () => {
  const dk = deck(DRA, SLO, REL);
  const run = (coins: boolean[], defenderDamage = 60): Game => {
    const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: SLO, bench: [REL], damage: { active: defenderDamage } }], { events: true });
    inject(g, g.state.p[1].active!.id, { k: 'surviveKoCoinFlip' });
    g.state.forcedCoins = coins;
    return g;
  };
  const heads = run([true]);
  const slo = heads.state.p[1].active!;
  choose(heads, 'Attack: Jet Headbutt'); // 70 damage on a Pokémon with 10 HP left
  assert.equal(heads.state.p[1].active, slo, 'not Knocked Out');
  assert.equal(slo.damage, 60, 'its remaining HP is 10 (70 HP - 60), not what the overkill left');
  assert.equal(heads.state.p[0].prizesTaken, 0);
  const tails = run([false]);
  choose(tails, 'Attack: Jet Headbutt');
  assert.equal(tails.state.p[1].discard.length, 1, 'tails: Knocked Out');
  assert.equal(tails.state.p[0].prizesTaken, 1);
  assert.equal(tails.events.filter((e) => e.type === 'coin_flip').length, 1, 'one flip');
  const fresh = run([true], 0);
  choose(fresh, 'Attack: Jet Headbutt'); // 70 damage on a fresh 70 HP Pokémon: exactly lethal
  assert.equal(fresh.state.p[1].active!.damage, 60, 'lethal at full HP also asks: heads leaves 10 HP');
  // A hit that does not Knock it Out flips nothing.
  const small = scenario(dk, dk, [{ active: SLO, energy: { active: [P, P] } }, { active: SLO }], { events: true });
  inject(small, small.state.p[1].active!.id, { k: 'surviveKoCoinFlip' });
  choose(small, 'Attack: Headbutt'); // 20 damage to a fresh 70 HP Pokémon
  assert.equal(small.events.filter((e) => e.type === 'coin_flip').length, 0);
  assert.equal(damageOf(small, 1), 20);
  // Poison is not damage from an attack: no flip.
  const poison = scenario(dk, dk, [{ active: DRA }, { active: SLO, bench: [REL], damage: { active: 60 }, cond: POISONED }], { events: true });
  inject(poison, poison.state.p[1].active!.id, { k: 'surviveKoCoinFlip' });
  poison.state.forcedCoins = [true];
  choose(poison, 'End turn');
  assert.equal(poison.state.p[1].discard.length, 1, 'Knocked Out by Poison');
  assert.equal(poison.events.filter((e) => e.type === 'coin_flip').length, 0);
});

test('surviveKoCoinFlip: a survivor can be Knocked Out later (a new flip); its Knocked-Out-by-attack trigger fires only when it really is Knocked Out', () => {
  const dk = deck(DRA, 'Pecharunt', SLO);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] } }, { active: 'Pecharunt', bench: [SLO], damage: { active: 10 } }], { events: true });
  inject(g, g.state.p[1].active!.id, { k: 'surviveKoCoinFlip' });
  g.state.effects[0]!.until = 99; // the effect lasts long enough for the second hit
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.events.filter((e) => e.type === 'search').length, 0, 'it survived: Final Chain did not trigger');
  assert.equal(g.state.p[1].active!.damage, 70);
  assert.equal(g.state.p[1].active!.koTriggered, undefined);
  // Next time around: tails.
  g.state.forcedCoins = [false];
  choose(g, 'End turn');
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(g.decision?.kind, 'cards', 'now Knocked Out: the trigger asks');
});

// ------------------------------------------------------------------ 10. a Pokémon's types

test('types: a Pokémon whose own Ability makes it {F} and {P} matches both in filters, and both count against Weakness as the attacker', () => {
  const dk = deck('Carbink', HAW, 'Trapinch', SLO);
  const g = scenario(dk, dk, [{ active: 'Carbink', bench: ['Trapinch'], hand: ['Carbink'] }, { active: HAW }]);
  const carbink = g.state.p[0].active!;
  assert.deepEqual([...slotTypes(g.env, carbink)].sort(), ['Fighting', 'Psychic']);
  assert.equal(slotMatches(g.env, carbink, { type: 'Psychic' }), true);
  assert.equal(slotMatches(g.env, carbink, { type: 'Fighting' }), true);
  assert.equal(slotMatches(g.env, carbink, { type: 'Water' }), false);
  assert.equal(slotMatches(g.env, carbink, { type: ['Water', 'Psychic'] }), true);
  assert.equal(slotMatches(g.env, g.state.p[0].bench[0]!, { type: 'Psychic' }), false, 'a plain {F} Pokémon');
  assert.equal(cardMatches(g.env, g.state.p[0].hand[0]!, { type: 'Psychic' }), false, 'in the hand it is still only {F}');
  assert.equal(evalExpr(g.env, g.state, ecFor(g, 0), { pokemon: { zone: 'myPokemon', filter: { type: 'Psychic' } } }), 1, 'counts in expressions');
  // Weakness: Mega Hawlucha ex is weak to {P} x2. Carbink's Counter Jewel does 70, Trapinch's Bite 20.
  const hit = (attacker: string, atk: string, energy: string[]): number => {
    const h = scenario(dk, dk, [{ active: attacker, energy: { active: energy } }, { active: HAW }]);
    choose(h, `Attack: ${atk}`);
    return damageOf(h, 1);
  };
  assert.equal(hit('Carbink', 'Counter Jewel', [FI, FI, FI]), 140, '70 x 2: the {P} half of Carbink hits the Weakness');
  assert.equal(hit('Trapinch', 'Bite', [FI, FI]), 20, 'a plain {F} attacker is not doubled');
});

test('types: `add` keeps the printed types and adds more; a Pokémon with no such effect keeps its printed type', () => {
  const addWater: CardScript = {
    id: 'me02.5-117',
    name: 'Carbink',
    abilities: [{ name: 'Double Type', statics: [{ effect: { k: 'types', types: ['Water'], add: true }, scope: 'self' }] }],
  };
  const dk = deck('Carbink', SLO);
  const g = scenario(dk, dk, [{ active: 'Carbink', bench: [SLO] }, { active: SLO }], { scripts: [addWater] });
  assert.deepEqual([...slotTypes(g.env, g.state.p[0].active!)].sort(), ['Fighting', 'Water']);
  assert.deepEqual([...slotTypes(g.env, g.state.p[0].bench[0]!)], ['Psychic']);
  assert.equal(slotMatches(g.env, g.state.p[0].active!, { type: 'Psychic' }), false);
});

// ------------------------------------------------------------------ the new state is cloned

test('cloneState copies the new records: a clone is independent of the game it came from', () => {
  const dk = deck(DRA, SLO, LIL);
  const g = scenario(dk, dk, [{ active: DRA, energy: { active: [P] }, hand: [LIL] }, { active: DRA }]);
  choose(g, `Play ${LIL}`);
  choose(g, 'Attack: Jet Headbutt');
  const target = g.state.p[1].active!;
  assert.equal(target.attackDmg, 70, 'the damage taken is recorded on the Pokémon');
  assert.equal(g.state.attackBy !== undefined, true);
  const copy = cloneState(g.state);
  assert.deepEqual(JSON.parse(JSON.stringify(copy)), JSON.parse(JSON.stringify(g.state)), 'an exact copy');
  copy.p[1].active!.attackDmg = 999;
  copy.p[1].active!.koTriggered = true;
  copy.p[0].playedThisTurn!.push(1);
  assert.equal(target.attackDmg, 70);
  assert.equal(target.koTriggered, undefined);
  assert.equal(g.state.p[0].playedThisTurn!.includes(1), false);
});
