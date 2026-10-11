/**
 * Engine features added with the std-engine7 batch, each tested on its own with stand-in scripts (the cards that use them are in
 * cards-std-engine7.test.ts):
 *  1. more than one Tool on a Pokémon (`toolSlots`)
 *  2. coin flips when damaged (`damageCoinFlip`) and when retreating (`retreatCoinFlip`); flipping an attack's coins again (`coinReflip`)
 *  3. Confusion that stays through evolving (`keepConfusion`)
 *  4. Energy that provides something else (`energyProvides`), flexible Energy units (`providesFlex`), Energy for some Pokémon only (`attachOnly`)
 *  5. Abilities used from the hand and at setup (`fromHand`, `setupActive`), Pokémon put into play only by an effect (`putIntoPlayOnlyBy`)
 *  6. triggers on how much damage and who did it (`minDamage`, `attacker`); end-of-turn effects not tied to a Pokémon (`delay` `global`)
 *  7. a type that depends on an attached card (`types` with a `when`)
 *  8. Pokémon in play can't go to the hand (`noReturnToHand`); cards that can't leave the discard pile (`noRecoverFromDiscard`)
 *  9. Stadium on Stadium (`extraStadium`), Energy to the hand after the attack (`handAfterOwnAttack`), previous Evolutions' attacks (`previousAttacks`)
 * 10. an attack stopped by Energy (`cantAttack` with `ifEnergyAtMost`)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import { determinize } from '../determinize.js';
import { renderAbility, renderCardText, renderProgram } from '../cards/render.js';
import type { CardScript, Program, StaticEffect } from '../dsl.js';
import * as evalMod from '../eval.js';
import { evalExpr } from '../eval.js';
import { advance, legalActions } from '../flow.js';
import { Game } from '../game.js';
import { energyUnits, maxHp, canPay } from '../query.js';
import { Rng } from '../rng.js';
import { scenario } from '../scenario.js';
import { cloneState, findSlot } from '../state.js';
import { CONFUSED, PARALYZED, type Decision } from '../types.js';
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
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Dreepy: 'sv06-128', // Dragon, 70 HP, no Weakness, Retreat 1
  Drakloak: 'sv06-129',
  Chikorita: 'me01-008', // Grass, 70 HP, Fire-weak, Razor Leaf {G} 20
  Bayleef: 'me01-009', // Stage 1, Push Down {G}{C} 50
  Meganium: 'me01-010', // Stage 2, Solar Beam {G}{G}{C}{C} 140
  "N's Darumaka": 'me02.5-032', // Fire, 80 HP; Rolling Tackle {C}{C} 20
  "Hero's Cape": 'sv05-152',
  'Air Balloon': 'me01-166',
  Potion: 'me03-083',
  Switch: 'me01-130',
  'Rare Candy': 'me01-125',
  'Poké Vital A': 'sv06.5-062',
  "Team Rocket's Energy": 'me02.5-217',
  'Nitro Fire Energy': 'me04-086',
  'Legacy Energy': 'sv06-167',
  "Team Rocket's Zubat": 'sv10-120',
  Squawkabilly: 'sv09-141', // Colorless, 70 HP
  Spheal: 'sv08-043',
  Walrein: 'sv08-045',
  Goomy: 'me04-066',
  'Meowth ex': 'me03-062',
  'Mega Kangaskhan ex': 'me01-104', // Colorless, 300 HP
  'Mega Greninja ex': 'me04-022', // Stage 2, 350 HP
  Frogadier: 'me04-021',
  Froakie: 'me04-020',
  'Prism Tower': 'me04-080',
  'Mega Floette ex': 'me04-035',
  'Ange Floette': 'me04-075',
  Togekiss: 'sv08-072',
  Togetic: 'me02.5-081',
  Togepi: 'me02.5-080',
  Amarys: 'sv08.5-093',
  'Dizzying Valley': 'me02-088',
  Klang: 'sv07-100',
  Klinklang: 'sv07-101',
  'Palafin ex': 'sv06-061',
  Palafin: 'sv06-060',
  Finizen: 'sv06-059',
  'Iron Treads': 'sv05-118',
  'Tremendous Bomb': 'me05-082',
  Cinderace: 'me01-028',
  Scorbunny: 'me01-026',
  Raboot: 'me01-027',
  'Neutralization Zone': 'sv06.5-060',
};
function deck(...cards: string[]): DeckInput {
  return fromIds('engine7', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);
const FIR = 'Fire Energy';
const GRS = 'Grass Energy';
const PSY = 'Psychic Energy';
const WTR = 'Water Energy';
const DRK = 'Darkness Energy';
const MTL = 'Metal Energy';

/** A timed effect on a Pokémon (a stand-in for the Ability or attack that would have set it); it lasts through the next turn. */
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false, turns = 1): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + turns, fromAttack, src: 0 });
}
/** A player-level timed effect on a player (or on that player's Pokémon: `scope: 'myPokemon'`). */
function injectPlayer(g: Game, player: 0 | 1, st: StaticEffect, scope?: 'myPokemon' | 'allPokemon'): void {
  g.state.effects.push({ static: st, slot: -1, player, until: g.state.turn + 1, fromAttack: false, src: 0, ...(scope ? { scope } : {}) });
}

/** A stand-in for the attack of N's Darumaka (Rolling Tackle, {C}{C}) that runs this program. */
const darumaka = (program: Program, extra: Partial<CardScript> = {}): CardScript[] => [
  { id: 'me02.5-032', name: "N's Darumaka", attacks: { 'Rolling Tackle': { program } }, ...extra },
];
const deal = (n: number): Program => [{ op: 'damage', amount: n, to: 'defender' }];
const attack = (g: Game): void => choose(g, 'Attack: Rolling Tackle');
const acts = (g: Game, p: 0 | 1 = 0) => legalActions(g.env, g.state, p);

// ------------------------------------------------------------------ rendering: every new clause says what it does

test('the new clauses render in words', () => {
  const stat = (effect: StaticEffect, scope: 'opp' | 'me' | 'oppPokemon' | 'myPokemon' | 'self' | 'allPokemon' = 'self') => renderAbility({ name: 'X', statics: [{ effect, scope }] });
  assert.match(stat({ k: 'toolSlots', n: 2 }, 'myPokemon'), /may have up to 2 Pokémon Tool cards attached.*until only 1 remains/);
  assert.match(stat({ k: 'damageCoinFlip' }), /If any damage is done to this Pokémon by attacks, flip a coin. If heads, prevent that damage/);
  assert.match(stat({ k: 'retreatCoinFlip' }, 'opp'), /Retreat Cost is not discarded, and they don't switch Pokémon.*doesn't stack/);
  assert.match(stat({ k: 'keepConfusion' }, 'allPokemon'), /Confused Pokémon.*don't recover.*evolve or devolve/);
  assert.match(stat({ k: 'energyProvides', cards: { energyType: 'Grass' }, provides: ['Grass', 'Grass'] }, 'myPokemon'), /Each Basic \{G\} Energy attached to all of.*provides \{G\}\{G\} Energy/);
  assert.match(stat({ k: 'noReturnToHand' }, 'opp'), /can't be put into your opponent's hand/);
  assert.match(stat({ k: 'previousAttacks' }, 'myPokemon'), /can use any attack from its previous Evolutions/);
  assert.match(stat({ k: 'cantAttack', ifEnergyAtMost: 2 }, 'oppPokemon'), /that have 2 or less Energy attached can't attack/);
  assert.match(renderAbility({ name: 'X', setupActive: true }), /setting up to play, you may put it face down in the Active Spot/);
  assert.match(renderAbility({ name: 'X', putIntoPlayOnlyBy: "Y's Z Ability" }), /Put this Pokémon into play only with the effect of Y's Z Ability/);
  assert.match(renderAbility({ name: 'X', activated: { fromHand: true, program: [{ op: 'move', cards: '__this', to: 'bench', anyStage: true }] } }), /if this Pokémon is in your hand.*Put this Pokémon onto your Bench/);
  assert.match(renderProgram([{ op: 'delay', duration: 'thisTurn', global: true, program: [{ op: 'move', cards: { all: 'hand' }, to: 'discard' }] }]), /At the end of this turn, discard your hand/);
  const card = (s: Partial<CardScript>) => renderCardText({ id: 'x', name: 'x', ...s }, { cardId: 'x', name: 'x', category: 'Energy' });
  assert.match(card({ attachOnly: { nameIncludes: "Team Rocket's" } }), /can only be attached to a Team Rocket's Pokémon.*discard this card/);
  assert.match(card({ providesFlex: { n: 2, types: ['Psychic', 'Darkness'] } }), /provides 2 in any combination of \{P\} Energy and \{D\} Energy/);
  assert.match(card({ noRecoverFromDiscard: true }), /can't be put into your hand or deck from the discard pile/);
  assert.match(card({ handAfterOwnAttack: { holder: { type: 'Fire' } } }), /put this card into your hand after attack damage and effects/);
});

// ------------------------------------------------------------------ 1. More than one Tool

test('toolSlots: a Pokémon may have up to as many Tools as an effect on it allows; the largest counts; others keep the limit of 1', () => {
  const dk = deck('Dreepy', 'Chikorita', "Hero's Cape", 'Air Balloon');
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'], tools: { active: ["Hero's Cape"], 0: ["Hero's Cape"] }, hand: ['Air Balloon'] }, { active: 'Dreepy' }]);
  const tools = () => acts(g).filter((a) => a.t === 'tool');
  assert.equal(tools().length, 0, 'both already hold a Tool');
  inject(g, g.state.p[0].active!.id, { k: 'toolSlots', n: 2 });
  inject(g, g.state.p[0].active!.id, { k: 'toolSlots', n: 3 });
  refresh(g);
  assert.deepEqual(tools().map((a) => (a as { slot: number }).slot), [g.state.p[0].active!.id], 'only the Pokémon with the effect');
  choose(g, 'Attach Air Balloon');
  assert.equal(g.state.p[0].active!.tools.length, 2);
  assert.equal(maxHp(g.env, g.state, g.state.p[0].active!), 170, "both Tools' effects apply (Hero's Cape: +100 HP)");
});

test('toolSlots: when the effect stops, the Pokémon\'s owner discards Tools until the limit holds (their choice), before Knock Outs', () => {
  const dk = deck('Dreepy', "Hero's Cape", 'Air Balloon');
  const g = scenario(dk, dk, [{ active: 'Dreepy', tools: { active: ["Hero's Cape", 'Air Balloon'] }, hand: ['Fire Energy'], bench: ['Dreepy'] }, { active: 'Dreepy' }]);
  assert.equal(g.state.p[0].active!.tools.length, 2, 'the position was built with an effect that has gone');
  choose(g, 'Attach Fire Energy to Dreepy (Active)');
  assert.equal(g.decision!.player, 0);
  assert.match(g.decision!.prompt, /Discard 1 Pokémon Tool card from Dreepy/);
  assert.deepEqual(labels(g).sort(), ["Air Balloon", "Hero's Cape"]);
  choose(g, 'Air Balloon');
  assert.deepEqual(g.state.p[0].active!.tools.map((c) => nameOf(g, c)), ["Hero's Cape"]);
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Air Balloon'));
  assert.equal(g.decision!.kind, 'main', 'play goes on');
});

// ------------------------------------------------------------------ 2. Coin flips

test('damageCoinFlip: the Pokémon\'s owner flips when damage would be done; heads prevents it; Benched Pokémon too', () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Chikorita');
  const mk = (program: Program, coins: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: rep(FIR, 2) } }, { active: 'Dreepy', bench: ['Dreepy'] }], { scripts: darumaka(program), events: true });
    for (const sl of [g.state.p[1].active!, g.state.p[1].bench[0]!]) inject(g, sl.id, { k: 'damageCoinFlip' });
    g.state.forcedCoins = coins;
    attack(g);
    return g;
  };
  const tails = mk(deal(60), [false]);
  assert.equal(tails.state.p[1].active!.damage, 60, 'tails: the damage is done');
  const heads = mk(deal(60), [true]);
  assert.equal(heads.state.p[1].active!.damage, 0, 'heads: prevented');
  const flips = heads.events.filter((e) => e.type === 'coin_flip');
  assert.deepEqual(flips.map((e) => (e as { player: number }).player), [1], 'the Defending Pokémon\'s owner flipped, once');
  // A Benched Pokémon is damaged "by attacks" just the same.
  const bench = mk([{ op: 'damage', amount: 30, to: { each: 'oppBench' } }], [true]);
  assert.equal(bench.state.p[1].bench[0]!.damage, 0);
  const benchTails = mk([{ op: 'damage', amount: 30, to: { each: 'oppBench' } }], [false]);
  assert.equal(benchTails.state.p[1].bench[0]!.damage, 30);
  // One flip for each Pokémon damaged.
  const both = mk([{ op: 'damage', amount: 30, to: { each: 'oppPokemon' } }], [true, false]);
  assert.equal(both.state.p[1].active!.damage, 0);
  assert.equal(both.state.p[1].bench[0]!.damage, 30, '(Weakness and Resistance are not applied to the Bench)');
});

test('damageCoinFlip: no flip when no damage is done, when something else already prevented it, or for damage not from an attack', () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Chikorita');
  const mk = (program: Program, prep?: (g: Game) => void): Game => {
    const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: rep(FIR, 2) } }, { active: 'Dreepy' }], { scripts: darumaka(program) });
    inject(g, g.state.p[1].active!.id, { k: 'damageCoinFlip' });
    prep?.(g);
    g.state.forcedCoins = [true, true];
    attack(g);
    return g;
  };
  assert.equal(mk(deal(0)).state.forcedCoins.length, 2, 'damage 0');
  const prevented = mk(deal(60), (g) => inject(g, g.state.p[1].active!.id, { k: 'preventDamage' }));
  assert.equal(prevented.state.forcedCoins.length, 2, 'prevented already: no damage is done to flip for');
  assert.equal(prevented.state.p[1].active!.damage, 0);
  const counters = mk([{ op: 'counters', n: 3, to: 'defender' }]);
  assert.equal(counters.state.forcedCoins.length, 2, 'damage counters are not damage');
  assert.equal(counters.state.p[1].active!.damage, 30);
});

test('damageCoinFlip is an effect on the Defending Pokémon: an attack that is not affected by those effects does its damage and does not flip (ruling 2040)', () => {
  const dk = deck("N's Darumaka", 'Dreepy');
  const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: rep(FIR, 2) } }, { active: 'Dreepy' }], {
    scripts: darumaka([{ op: 'damage', amount: 60, to: 'defender', ignore: { defenderEffects: true } }]),
  });
  inject(g, g.state.p[1].active!.id, { k: 'damageCoinFlip' });
  g.state.forcedCoins = [true];
  attack(g);
  assert.equal(g.state.p[1].active!.damage, 60);
  assert.equal(g.state.forcedCoins.length, 1, 'no coin was flipped');
});

test('retreatCoinFlip: tails and the Energy stays, the Pokémon stays, and the retreat is used up; heads and it retreats; several effects flip once', () => {
  const dk = deck('Dreepy', 'Chikorita');
  const mk = (n = 1): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'], energy: { active: [PSY] } }, { active: 'Dreepy' }], {});
    for (let i = 0; i < n; i++) injectPlayer(g, 0, { k: 'retreatCoinFlip' });
    return g;
  };
  const tails = mk();
  tails.state.forcedCoins = [false];
  const dreepy = tails.state.p[0].active!;
  choose(tails, 'Retreat');
  assert.equal(tails.state.p[0].active, dreepy, 'did not switch');
  assert.equal(dreepy.energy.length, 1, 'Energy for the Retreat Cost was not discarded');
  assert.equal(tails.state.p[0].retreated, true);
  assert.ok(!has(tails, 'Retreat'), "can't try again this turn (ruling 2348)");
  const heads = mk();
  heads.state.forcedCoins = [true];
  choose(heads, 'Retreat');
  assert.equal(nameOf(heads, heads.state.p[0].active!.cards[0]!), 'Chikorita');
  assert.equal(heads.state.p[0].bench[0]!.energy.length, 0, 'the Energy was discarded');
  const two = mk(2);
  two.state.forcedCoins = [false, true];
  choose(two, 'Retreat');
  assert.equal(two.state.forcedCoins.length, 1, "the effect doesn't stack: one flip");
  assert.equal(two.state.p[0].active, dreepy === two.state.p[0].active ? dreepy : two.state.p[0].active);
  assert.equal(nameOf(two, two.state.p[0].active!.cards[0]!), 'Dreepy', 'tails: stays');
  // It is the retreating player's coin: the other player's retreat is not affected by an effect on the first.
  const other = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Dreepy', bench: ['Chikorita'], energy: { active: [PSY] } }], { current: 1, first: 0, turn: 4 });
  injectPlayer(other, 0, { k: 'retreatCoinFlip' });
  other.state.forcedCoins = [false];
  choose(other, 'Retreat');
  assert.equal(other.state.forcedCoins.length, 1);
});

/** A stand-in for Backtrack Badge on Hero's Cape: a {R} Pokémon's attack can have its coin flips flipped again, once during the turn. */
const BADGE: CardScript = { id: 'sv05-152', name: "Hero's Cape", statics: [{ effect: { k: 'coinReflip' }, scope: 'self', filter: { type: 'Fire' } }] };
const flip2: Program = [{ op: 'flip', n: 2, as: 'h' }, { op: 'damage', amount: { mul: [30, { v: 'h' }] }, to: 'defender' }];

test('coinReflip: after the attack\'s coin flips, the player may ignore all of them and flip them again; once during the turn', () => {
  const dk = deck("N's Darumaka", 'Dreepy', "Hero's Cape");
  const mk = (tools = true): Game =>
    scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: rep(FIR, 2) }, tools: tools ? { active: ["Hero's Cape"] } : {} }, { active: 'Dreepy' }], {
      scripts: [...darumaka(flip2), BADGE],
    });
  // No reflip: 2 coins, tails and heads = 30.
  const no = mk();
  no.state.forcedCoins = [false, true];
  attack(no);
  assert.equal(no.decision!.kind, 'yesno');
  assert.match(no.decision!.prompt, /flip them again/);
  no.submit([1]);
  assert.equal(no.state.p[1].active!.damage, 30);
  assert.equal(no.state.p[0].toolUsed, undefined, 'declining does not use it');
  // Reflip: both coins are flipped again, never only the tails.
  const yes = mk();
  yes.state.forcedCoins = [false, true, true, true, false];
  attack(yes);
  yes.submit([0]);
  assert.equal(yes.state.p[1].active!.damage, 60, 'the new results count');
  assert.equal(yes.state.forcedCoins.length, 1, 'both coins were flipped again');
  assert.equal(yes.state.p[0].toolUsed!.length, 1, 'used for this turn');
  // Without the Tool, nothing is asked.
  const bare = mk(false);
  bare.state.forcedCoins = [false, true];
  attack(bare);
  assert.equal(bare.state.p[1].active!.damage, 30);
});

test('coinReflip: only the Pokémon the Tool names; only the attack\'s own flips (not Confusion\'s); only when the program flips in one place', () => {
  const dk = deck("N's Darumaka", 'Dreepy', "Hero's Cape", 'Chikorita');
  const mk = (program: Program, o: { active?: string; cond?: number } = {}): Game =>
    scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: rep(FIR, 2) }, tools: { active: ["Hero's Cape"] }, ...(o.cond ? { cond: o.cond } : {}) }, { active: 'Dreepy' }], {
      scripts: [...darumaka(program), { ...BADGE, statics: [{ effect: { k: 'coinReflip' }, scope: 'self', filter: { type: o.active === 'Water' ? 'Water' : 'Fire' } }] }],
    });
  // Another type: not offered.
  const wrong = mk(flip2, { active: 'Water' });
  wrong.state.forcedCoins = [true, true];
  attack(wrong);
  assert.equal(wrong.decision!.kind, 'main', 'not asked');
  assert.equal(wrong.state.p[1].active!.damage, 60);
  // Confusion's flip is not the attack's: with a Confused attacker and an attack that flips nothing, nothing is offered.
  const conf = mk(deal(40), { cond: CONFUSED });
  conf.state.forcedCoins = [true];
  attack(conf);
  assert.equal(conf.state.p[1].active!.damage, 40);
  assert.equal(conf.decision!.kind, 'main', "Confusion's flip can't be flipped again (ruling 2417)");
  // With an attack that flips, the question comes after the attack's flips, not after Confusion's.
  const both = mk(flip2, { cond: CONFUSED });
  both.state.forcedCoins = [true, true, false];
  attack(both);
  assert.equal(both.decision!.kind, 'yesno');
  assert.equal(both.state.forcedCoins.length, 0, 'the Confusion flip first, then the attack\'s two');
  both.submit([1]);
  assert.equal(both.state.p[1].active!.damage, 30);
  // Flips in two places: not offered (the program would have to be run again from the first).
  const twice = mk([{ op: 'flip', n: 1, as: 'a' }, { op: 'flip', n: 1, as: 'b' }, { op: 'damage', amount: { mul: [30, { add: [{ v: 'a' }, { v: 'b' }] }] }, to: 'defender' }]);
  twice.state.forcedCoins = [true, true];
  attack(twice);
  assert.equal(twice.decision!.kind, 'main');
  assert.equal(twice.state.p[1].active!.damage, 60);
  // A loop of flips: not offered either.
  const loop = mk([{ op: 'repeat', n: 2, body: [{ op: 'flip', n: 1, as: 'h' }] }, deal(10)[0]!]);
  loop.state.forcedCoins = [true, true];
  attack(loop);
  assert.equal(loop.decision!.kind, 'main');
  // The use is spent for the turn and comes back the next.
  const used = mk(flip2);
  used.state.forcedCoins = [true, true, true, true];
  attack(used);
  used.submit([0]);
  assert.equal(used.state.p[0].toolUsed!.length, 1);
});

test('the coin-flip state is part of the clone and of a determinized copy', () => {
  const dk = deck("N's Darumaka", 'Dreepy', "Hero's Cape");
  const g = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: rep(FIR, 2) }, tools: { active: ["Hero's Cape"] } }, { active: 'Dreepy' }], { scripts: [...darumaka(flip2), BADGE] });
  g.state.forcedCoins = [true, true, false, false];
  attack(g);
  g.submit([0]);
  const copy = cloneState(g.state);
  assert.deepEqual(copy.p[0].toolUsed, g.state.p[0].toolUsed);
  const det = determinize(g.state, g.ctx, 1, new Rng(5));
  assert.deepEqual(det.p[0].toolUsed, g.state.p[0].toolUsed);
});

// ------------------------------------------------------------------ 3. Confusion that stays

test('keepConfusion: evolving (from the hand or with Rare Candy) keeps Confusion; every other Special Condition still goes; without it Confusion goes too', () => {
  const dk = deck('Chikorita', 'Bayleef', 'Meganium', 'Rare Candy');
  const mk = (keep: boolean, cond: number, hand: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Chikorita', hand, cond }, { active: 'Chikorita' }], { turn: 4 });
    g.state.p[0].active!.enteredTurn = 0;
    if (keep) injectPlayer(g, 1, { k: 'keepConfusion' }, 'allPokemon');
    if (keep) g.state.effects[g.state.effects.length - 1]!.player = 0;
    refresh(g);
    return g;
  };
  const evolved = (g: Game) => g.state.p[0].active!.cards.length;
  const a = mk(true, CONFUSED, ['Bayleef']);
  choose(a, 'Evolve Chikorita (Active) into Bayleef');
  assert.equal(evolved(a), 2);
  assert.equal(a.state.p[0].active!.cond, CONFUSED, 'still Confused');
  const b = mk(false, CONFUSED, ['Bayleef']);
  choose(b, 'Evolve Chikorita (Active) into Bayleef');
  assert.equal(b.state.p[0].active!.cond, 0);
  const c = mk(true, PARALYZED, ['Bayleef']);
  choose(c, 'Evolve Chikorita (Active) into Bayleef');
  assert.equal(c.state.p[0].active!.cond, 0, 'only Confusion stays');
  const d = mk(true, CONFUSED, ['Meganium', 'Rare Candy']);
  choose(d, 'Play Rare Candy');
  assert.equal(nameOf(d, d.state.p[0].active!.cards[1]!), 'Meganium');
  assert.equal(d.state.p[0].active!.cond, CONFUSED, 'Rare Candy too');
  const e = mk(false, CONFUSED, ['Meganium', 'Rare Candy']);
  choose(e, 'Play Rare Candy');
  assert.equal(e.state.p[0].active!.cond, 0);
});

// ------------------------------------------------------------------ 4. Energy

/** A stand-in for Meganium's Ability on the card text of Chikorita (never switched off). */
const WILD: Partial<CardScript> = { statics: [{ effect: { k: 'energyProvides', cards: { energyType: 'Grass' }, provides: ['Grass', 'Grass'] }, scope: 'myPokemon' }] };

test('energyProvides: Energy of that kind provides what the static says, in every count of attached Energy, for the player\'s own Pokémon only', () => {
  const dk = deck('Chikorita', 'Bayleef', "N's Darumaka", 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Bayleef', bench: ['Chikorita'], energy: { active: [GRS, GRS, FIR], 0: [] } }, { active: 'Dreepy', energy: { active: [GRS, GRS] } }], {
    scripts: [{ id: 'me01-008', name: 'Chikorita', ...WILD }],
  });
  const mine = g.state.p[0].active!;
  const theirs = g.state.p[1].active!;
  assert.equal(energyUnits(g.env, mine, g.state).length, 5, '2 Basic {G} count 4, and the {R}');
  assert.equal(energyUnits(g.env, mine).length, 3, 'without the game state nothing is replaced (callers that have it pass it)');
  assert.equal(evalExpr(g.env, g.state, { player: 0, slot: mine.id, vars: {} }, { energyOn: 'self' }), 5);
  assert.equal(evalExpr(g.env, g.state, { player: 0, slot: mine.id, vars: {} }, { energyOn: 'self', type: 'Grass' }), 4);
  assert.equal(evalExpr(g.env, g.state, { player: 0, slot: mine.id, vars: {} }, { energyOn: 'self', cards: true }), 3, 'Energy cards are still cards');
  assert.equal(energyUnits(g.env, theirs, g.state).length, 2, 'the opponent\'s Pokémon are not touched');
  // Special Energy and other types are not Basic {G}: unchanged.
  const h = scenario(dk, dk, [{ active: 'Bayleef', bench: ['Chikorita'], energy: { active: [FIR, FIR] } }, { active: 'Chikorita' }], { scripts: [{ id: 'me01-008', name: 'Chikorita', ...WILD }] });
  assert.equal(energyUnits(h.env, h.state.p[0].active!, h.state).length, 2);
});

test('energyProvides is a replacement: a second source does not add to the first (ruling 2236); it pays attack costs and Retreat Costs (rulings 2237, 2288)', () => {
  const dk = deck('Chikorita', 'Bayleef', 'Dreepy');
  const two = (): CardScript[] => [{ id: 'me01-008', name: 'Chikorita', ...WILD }, { id: 'me01-009', name: 'Bayleef', ...WILD }];
  const g = scenario(dk, dk, [{ active: 'Bayleef', bench: ['Chikorita'], energy: { active: [GRS, GRS] } }, { active: 'Dreepy' }], { scripts: two() });
  assert.equal(energyUnits(g.env, g.state.p[0].active!, g.state).length, 4, 'two sources: still {G}{G} for each card');
  // Push Down {G}{C} is paid by one Basic {G} Energy providing {G}{G}.
  const h = scenario(dk, dk, [{ active: 'Bayleef', bench: ['Chikorita'], energy: { active: [GRS] } }, { active: 'Dreepy' }], { scripts: two() });
  assert.ok(acts(h).some((a) => a.t === 'attack'), 'one Grass Energy pays {G}{C}');
  const bare = scenario(dk, dk, [{ active: 'Bayleef', bench: ['Chikorita'], energy: { active: [GRS] } }, { active: 'Dreepy' }]);
  assert.ok(!acts(bare).some((a) => a.t === 'attack'), 'without it, one Energy is not enough');
  // Retreat Cost 2 paid by one card that provides 2: no card to spare, one is discarded.
  choose(h, 'Retreat');
  assert.equal(h.state.p[0].bench.find((b) => nameOf(h, b.cards[0]!) === 'Bayleef')!.energy.length, 0);
});

test('providesFlex: each of the Energy is any one of the types; it pays typed costs in any mix, counts as that many units, and attachOnly limits where it goes', () => {
  const dk = deck("Team Rocket's Zubat", 'Dreepy', 'Chikorita', "Team Rocket's Energy");
  const TR: CardScript = { id: 'me02.5-217', name: "Team Rocket's Energy", fix: { specialEnergy: true }, provides: ['Psychic', 'Darkness'], providesFlex: { n: 2, types: ['Psychic', 'Darkness'] }, attachOnly: { nameIncludes: "Team Rocket's" } };
  const mk = (hand: string[] = []) => scenario(dk, dk, [{ active: "Team Rocket's Zubat", bench: ['Dreepy'], hand, energy: { active: ["Team Rocket's Energy"] } }, { active: 'Dreepy' }], { scripts: [TR] });
  const g = mk(["Team Rocket's Energy"]);
  const zubat = g.state.p[0].active!;
  const units = energyUnits(g.env, zubat, g.state);
  assert.equal(units.length, 2);
  assert.ok(canPay(['Psychic', 'Darkness'], units));
  assert.ok(canPay(['Darkness', 'Darkness'], units));
  assert.ok(canPay(['Psychic', 'Psychic'], units));
  assert.ok(canPay(['Colorless', 'Darkness'], units));
  assert.ok(!canPay(['Psychic', 'Darkness', 'Colorless'], units));
  assert.ok(!canPay(['Water', 'Darkness'], units), 'not {W}');
  assert.ok(canPay(['Psychic', 'Darkness', 'Water'], [...units, 'Water']));
  assert.equal(evalExpr(g.env, g.state, { player: 0, slot: zubat.id, vars: {} }, { energyOn: 'self', type: 'Darkness' }), 2, 'counts as {D} Energy');
  assert.equal(evalExpr(g.env, g.state, { player: 0, slot: zubat.id, vars: {} }, { energyOn: 'self', type: 'Fire' }), 0);
  // Only a Team Rocket's Pokémon may be attached it.
  const att = acts(g).filter((a) => a.t === 'attach');
  assert.deepEqual(att.map((a) => (a as { slot: number }).slot), [zubat.id], 'not the Dreepy on the Bench');
  // An effect that attaches it to another Pokémon does nothing.
  const e = scenario(dk, dk, [{ active: "Team Rocket's Zubat", bench: ['Dreepy'], hand: ["Team Rocket's Energy"] }, { active: 'Dreepy' }], {
    scripts: [TR, { id: 'sv06-128', name: 'Dreepy', statics: [] }, ...darumaka([])],
  });
  assert.equal(e.state.p[0].bench[0]!.energy.length, 0);
  // Put on another Pokémon in some other way: discarded as soon as the action is done.
  const f = scenario(dk, dk, [{ active: "Team Rocket's Zubat", bench: ['Dreepy'], energy: { 0: ["Team Rocket's Energy"] }, hand: ['Fire Energy'] }, { active: 'Dreepy' }], { scripts: [TR] });
  choose(f, 'Attach Fire Energy to Team Rocket');
  assert.equal(f.state.p[0].bench[0]!.energy.length, 0, 'discarded');
  assert.ok(f.state.p[0].discard.some((c) => nameOf(f, c) === "Team Rocket's Energy"));
});

// ------------------------------------------------------------------ 5. Abilities from the hand, at setup; Pokémon put into play only by an effect

test('an Ability used from the hand: offered while its condition holds and there is room, puts the card onto the Bench as a Stage 2, and is used once per card', () => {
  const dk = deck('Dreepy', 'Klinklang', 'Chikorita', 'Meganium', 'Bayleef');
  const mk = (opp: string, bench: string[] = [], hand = ['Klinklang']): Game =>
    scenario(dk, dk, [{ active: 'Dreepy', bench, hand }, { active: 'Chikorita', ...(opp === 'Meganium' ? { evolve: { active: ['Meganium'] } } : opp === 'Bayleef' ? { evolve: { active: ['Bayleef'] } } : {}) }]);
  const fromHand = (g: Game) => acts(g).filter((a) => a.t === 'ability' && a.card !== undefined);
  assert.equal(fromHand(mk('Meganium')).length, 1, 'the opponent has a Stage 2 Pokémon in play');
  assert.equal(fromHand(mk('Bayleef')).length, 0, 'a Stage 1 is not enough');
  assert.equal(fromHand(mk('Chikorita')).length, 0);
  assert.equal(fromHand(mk('Meganium', rep('Dreepy', 5))).length, 0, 'no room on the Bench');
  const g = mk('Meganium', [], ['Klinklang', 'Klinklang']);
  assert.ok(has(g, 'Use Emergency Rotation (Klinklang in hand)'));
  assert.equal(fromHand(g).length, 1, 'two identical cards: one option');
  choose(g, 'Use Emergency Rotation');
  assert.equal(g.state.p[0].bench.length, 1);
  assert.equal(nameOf(g, g.state.p[0].bench[0]!.cards[0]!), 'Klinklang');
  assert.equal(g.state.p[0].bench[0]!.cards.length, 1, 'no Basic underneath');
  assert.equal(g.state.p[0].hand.filter((c) => nameOf(g, c) === 'Klinklang').length, 1);
  assert.equal(fromHand(g).length, 1, 'the other copy has its own use');
  assert.equal(g.state.p[0].playedThisTurn?.length ?? 0, 0, 'not played from the hand');
  choose(g, 'Use Emergency Rotation');
  assert.equal(g.state.p[0].bench.length, 2);
  // A card in the hand has its Ability whatever switches Abilities off in play.
  const h = mk('Meganium');
  injectPlayer(h, 0, { k: 'noAbilities' }, 'myPokemon');
  refresh(h);
  assert.equal(fromHand(h).length, 1);
});

test('setupActive: a Pokémon with it in the hand may be put in the Active Spot at setup, whatever its Stage', () => {
  const list = fromIds('cinderace', [['me01-028', 30], ['me01-026', 10], ['mee-002', 20]]);
  let found = 0;
  for (let seed = 1; seed <= 25 && !found; seed++) {
    const s = new Game(list, list, seed, { first: 0 }).start();
    let guard = 0;
    while (s.decision && s.decision.kind !== 'setupActive' && guard++ < 10) s.submit([0]);
    const d = s.decision!;
    assert.equal(d.kind, 'setupActive');
    const hand = s.state.p[d.player].hand;
    const cinderace = hand.filter((c) => nameOf(s, c) === 'Cinderace');
    const offered = (d.values as number[]).filter((c) => nameOf(s, c) === 'Cinderace');
    assert.deepEqual(offered.sort(), cinderace.slice().sort(), 'every Cinderace in the hand may be put in the Active Spot');
    assert.ok((d.values as number[]).some((c) => nameOf(s, c) === 'Scorbunny'), 'and the Basic Pokémon, as ever');
    if (!cinderace.length) continue;
    found++;
    s.submit([(d.values as number[]).indexOf(cinderace[0]!)]);
    const active = s.state.p[d.player].active!;
    assert.equal(nameOf(s, active.cards[0]!), 'Cinderace');
    assert.equal(active.cards.length, 1);
    assert.equal(def(s.ctx, active.cards[0]!).stage, 2);
    assert.ok(evalMod.slotMatches(s.env, active, { stage: 'evolution' }), 'an Evolution Pokémon for the effects that ask');
    assert.ok(!evalMod.slotMatches(s.env, active, { stage: 'basic' }));
  }
  assert.ok(found > 0, 'a hand with Cinderace came up');
});

// ------------------------------------------------------------------ 6. Triggers on how much damage, and who did it; end-of-turn effects

test('minDamage and attacker on damagedByAttack(Active): the amount done in one hit (after every effect) and who did it', () => {
  const dk = deck('Mega Kangaskhan ex', 'Meganium', 'Bayleef', 'Chikorita', "N's Darumaka", "Hero's Cape");
  const TOOL: CardScript = {
    id: 'sv05-152',
    name: "Hero's Cape",
    triggers: [
      { on: 'damagedByAttackActive', minDamage: 100, attacker: { ex: true }, program: [{ op: 'draw', n: 1 }] },
      { on: 'damagedByAttack', minDamage: 100, attacker: { ex: true }, program: [{ op: 'draw', n: 3 }] },
    ],
  };
  const KANG = (program: Program): CardScript => ({ id: 'me01-104', name: 'Mega Kangaskhan ex', attacks: { 'Rapid-Fire Combo': { program } } });
  const run = (program: Program, o: { attacker?: string; benchTool?: boolean } = {}): number => {
    const g = scenario(
      dk,
      dk,
      [
        { active: o.attacker ?? 'Mega Kangaskhan ex', energy: { active: rep(FIR, 3) } },
        { active: 'Chikorita', evolve: { active: ['Bayleef', 'Meganium'] }, tools: o.benchTool ? { 0: ["Hero's Cape"] } : { active: ["Hero's Cape"] }, bench: ['Chikorita'] },
      ],
      { scripts: [TOOL, KANG(program), ...darumaka(program)] },
    );
    const before = g.state.p[1].hand.length;
    choose(g, o.attacker === "N's Darumaka" ? 'Attack: Rolling Tackle' : 'Attack: Rapid-Fire Combo');
    return g.state.p[1].hand.length - before - 1; // (the 1 is the card it draws for its turn)
  };
  // Meganium is Fire-weak (x2 only for the Active Pokémon).
  assert.equal(run(deal(99), { attacker: 'Mega Kangaskhan ex' }), 0, '99 is less than 100');
  assert.equal(run(deal(50), { attacker: "N's Darumaka" }), 0, 'not a Pokémon ex');
  const hit = run(deal(100));
  assert.equal(hit, 4, '100 from a Pokémon ex: both triggers (Active, and anywhere)');
  assert.equal(run([{ op: 'damage', amount: 100, to: { each: 'oppBench' } }]), 0, 'a Benched Pokémon with no Tool on it');
  assert.equal(run([{ op: 'damage', amount: 100, to: { each: 'oppBench' } }], { benchTool: true }), 3, 'Benched: only the one that works anywhere');
  assert.equal(run(deal(100), { attacker: "N's Darumaka" }), 0, 'a Pokémon that is not an ex does the 100');
});

test('minDamage counts the damage as done: Weakness and the effects on damage taken come first', () => {
  const dk = deck("N's Darumaka", 'Chikorita', 'Bayleef', 'Meganium', "Hero's Cape");
  const TOOL: CardScript = { id: 'sv05-152', name: "Hero's Cape", triggers: [{ on: 'damagedByAttackActive', minDamage: 100, program: [{ op: 'draw', n: 1 }] }] };
  const mk = (): Game =>
    scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: rep(FIR, 2) } }, { active: 'Chikorita', evolve: { active: ['Bayleef', 'Meganium'] }, tools: { active: ["Hero's Cape"] } }], { scripts: [TOOL, ...darumaka(deal(60))] });
  const g = mk();
  const n0 = g.state.p[1].hand.length;
  attack(g);
  assert.equal(g.state.p[1].hand.length - n0 - 1, 1, '60 x2 for the Fire Weakness = 120');
  const h = mk();
  inject(h, h.state.p[1].active!.id, { k: 'damageIn', amount: -30 });
  const n1 = h.state.p[1].hand.length;
  attack(h);
  assert.equal(h.state.p[1].hand.length - n1 - 1, 0, '120 - 30 = 90');
});

test('delay with `global`: an end-of-turn effect not tied to a Pokémon runs whatever happens to the board; with another waiting, the turn\'s player chooses the order', () => {
  const dk = deck('Dreepy', 'Potion', 'Chikorita');
  const POTION = (n: number, duration: 'thisTurn' | 'oppNextTurn' = 'thisTurn'): CardScript => ({
    id: 'me03-083',
    name: 'Potion',
    play: [{ op: 'delay', duration, global: true, program: [{ op: 'draw', n }] }],
  });
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'], hand: ['Potion'] }, { active: 'Dreepy' }], { scripts: [POTION(2)] });
  const hand = g.state.p[0].hand.length - 1;
  choose(g, 'Play Potion');
  choose(g, 'End turn');
  assert.equal(g.state.p[0].hand.length, hand + 2, 'drew 2 at the end of the turn');
  // At the end of the opponent's next turn, for its controller.
  const h = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Potion'] }, { active: 'Dreepy' }], { scripts: [POTION(1, 'oppNextTurn')] });
  const hh = h.state.p[0].hand.length - 1;
  choose(h, 'Play Potion');
  choose(h, 'End turn');
  assert.equal(h.state.p[0].hand.length, hh, 'not yet');
  choose(h, 'End turn');
  assert.equal(h.state.p[0].hand.length, hh + 2, "drew 1 at the end of the opponent's turn, and 1 for its own turn");
  // Not tied to the Pokémon: a Knock Out of the Active Pokémon (or any change on the board) does not drop it.
  const k = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Potion'] }, { active: 'Dreepy' }], { scripts: [POTION(1)] });
  const kk = k.state.p[0].hand.length - 1;
  choose(k, 'Play Potion');
  k.state.p[0].active = null;
  k.state.p[0].bench = [];
  assert.equal(k.state.delayed!.length, 1);
  assert.equal(k.state.delayed![0]!.slot, 0, 'tied to nothing');
  void kk;
});

test('two end-of-turn effects waiting, one not tied to a Pokémon: the turn\'s player chooses which goes first (ruling 2135)', () => {
  const dk = deck('Dreepy', 'Potion');
  const draw1: Program = [{ op: 'delay', duration: 'thisTurn', global: true, program: [{ op: 'draw', n: 1 }] }];
  const k = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Potion', 'Potion'] }, { active: 'Dreepy' }], { scripts: [{ id: 'me03-083', name: 'Potion', play: draw1 }] });
  choose(k, 'Play Potion');
  choose(k, 'Play Potion');
  choose(k, 'End turn');
  assert.equal(k.decision!.kind, 'option');
  assert.match(k.decision!.prompt, /which end-of-turn effect first/);
  assert.equal(k.decision!.player, 0);
  assert.deepEqual(labels(k), ['Potion', 'Potion']);
  const hand = k.state.p[0].hand.length;
  k.submit([1]);
  assert.equal(k.state.p[0].hand.length, hand + 2, 'both ran');
  assert.equal(k.state.current, 1, 'and the turn moved on');
  // One effect on its own: no question.
  const one = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Potion'] }, { active: 'Dreepy' }], { scripts: [{ id: 'me03-083', name: 'Potion', play: draw1 }] });
  choose(one, 'Play Potion');
  choose(one, 'End turn');
  assert.equal(one.state.current, 1);
});

// ------------------------------------------------------------------ 7. A type that depends on an attached card

test('types with a `when` about the Pokémon itself: the type applies while the condition holds, for Weakness and for type filters', () => {
  const CAPSULE = { cardId: 'test-capsule', name: 'Future Booster Energy Capsule', category: 'Trainer' as const, trainerType: 'Tool', effect: 'x' };
  const base = fromIds('treads', [['sv05-118', 4], ['me01-104', 4], ['sv06-128', 4], ...ENERGY]);
  const dk: DeckInput = { ...base, cards: [...base.cards, { frame: CAPSULE, count: 2 }] };
  const mk = (tool: boolean): Game =>
    scenario(dk, dk, [{ active: 'Iron Treads', energy: { active: [MTL, MTL] }, ...(tool ? { tools: { active: ['Future Booster Energy Capsule'] } } : {}) }, { active: 'Mega Kangaskhan ex' }], {
      scripts: [
        {
          id: 'sv05-118',
          name: 'Iron Treads',
          abilities: [{ name: 'Dual Core', statics: [{ effect: { k: 'types', types: ['Fighting', 'Metal'] }, scope: 'self', when: { slotIs: { ref: 'self', filter: { toolCard: { name: 'Future Booster Energy Capsule' } } } } }] }],
          attacks: { 'Wheel Pass': { program: deal(60) } },
        },
      ],
    });
  const types = (g: Game): string[] => [...evalMod.slotTypes(g.env, g.state.p[0].active!)];
  const bare = mk(false);
  assert.deepEqual(types(bare), ['Metal']);
  const g = mk(true);
  assert.deepEqual(types(g), ['Fighting', 'Metal']);
  // Mega Kangaskhan ex is weak to {F}: 60 becomes 120 only with the Tool attached.
  choose(g, 'Attack: Wheel Pass');
  assert.equal(g.state.p[1].active!.damage, 120);
  choose(bare, 'Attack: Wheel Pass');
  assert.equal(bare.state.p[1].active!.damage, 60);
  // A type filter sees them too, and sees the printed type again once the Tool is gone.
  const h = mk(true);
  assert.ok(evalMod.slotMatches(h.env, h.state.p[0].active!, { type: 'Fighting' }));
  h.state.p[0].active!.tools = [];
  assert.ok(!evalMod.slotMatches(h.env, h.state.p[0].active!, { type: 'Fighting' }));
  assert.ok(evalMod.slotMatches(h.env, h.state.p[0].active!, { type: 'Metal' }));
});

// ------------------------------------------------------------------ 8. Nothing of a player's goes to their hand; cards that can't leave the discard pile

test('noReturnToHand: a custom effect that puts a Pokémon (with everything attached) into the hand leaves it in play; only for the player it names', () => {
  const dk = deck('Meowth ex', 'Dreepy', 'Chikorita');
  // A stand-in for Milotic's Ability on the card text of Chikorita: the opponent's Pokémon can't go to the opponent's hand.
  const LOCK: CardScript[] = [{ id: 'me01-008', name: 'Chikorita', statics: [{ effect: { k: 'noReturnToHand' }, scope: 'opp' }] }];
  const mk = (lockedSide = 0): Game =>
    scenario(dk, dk, lockedSide === 0 ? [{ active: 'Meowth ex', energy: { active: [PSY, PSY, FIR] }, bench: ['Dreepy'] }, { active: 'Chikorita' }] : [{ active: 'Meowth ex', energy: { active: [PSY, PSY, FIR] }, bench: ['Chikorita'] }, { active: 'Dreepy' }], { scripts: LOCK });
  // Tuck Tail: "Put this Pokémon and all attached cards into your hand."
  const free = scenario(dk, dk, [{ active: 'Meowth ex', energy: { active: [PSY, PSY, FIR] }, bench: ['Dreepy'] }, { active: 'Dreepy' }]);
  choose(free, 'Attack: Tuck Tail');
  assert.ok(free.state.p[0].hand.some((c) => nameOf(free, c) === 'Meowth ex'), 'without the lock it goes to the hand');
  const locked = mk();
  const handBefore = locked.state.p[0].hand.slice().sort();
  const id = locked.state.p[0].active!.id;
  choose(locked, 'Attack: Tuck Tail');
  assert.equal(locked.state.p[0].active!.id, id, 'still in the Active Spot');
  assert.equal(locked.state.p[0].active!.energy.length, 3, 'with its Energy');
  assert.deepEqual(locked.state.p[0].hand.slice().sort(), handBefore);
  const other = mk(1);
  choose(other, 'Attack: Tuck Tail');
  assert.ok(other.state.p[0].hand.some((c) => nameOf(other, c) === 'Meowth ex'), 'the lock is on the other player');
});

test('noReturnToHand: a Knock Out that would put cards into the hand (koToHand) puts them in the discard pile instead', () => {
  const dk = deck('Dreepy', 'Chikorita', 'Squawkabilly');
  const mk = (lock: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', energy: { active: [PSY, PSY] }, bench: ['Chikorita'] }, { active: 'Squawkabilly', energy: { active: [WTR] }, bench: ['Dreepy'] }], {
      scripts: [
        { id: 'sv06-128', name: 'Dreepy', attacks: { 'Petty Grudge': { program: deal(100) } } },
        { id: 'sv09-141', name: 'Squawkabilly', statics: [{ effect: { k: 'koToHand', cards: 'energy', filter: { energyType: 'Water' } }, scope: 'self' }] },
        ...(lock ? [{ id: 'me01-008', name: 'Chikorita', statics: [{ effect: { k: 'noReturnToHand' as const }, scope: 'opp' as const }] }] : []),
      ],
    });
    water.set(g, g.state.p[1].active!.energy[0]!);
    choose(g, 'Attack: Petty Grudge');
    return g;
  };
  const water = new Map<Game, number>();
  const free = mk(false);
  assert.ok(free.state.p[1].hand.includes(water.get(free)!), 'the Water Energy went to the hand');
  const locked = mk(true);
  assert.ok(!locked.state.p[1].hand.includes(water.get(locked)!));
  assert.ok(locked.state.p[1].discard.includes(water.get(locked)!), 'it goes to the discard pile');
  assert.equal(locked.state.p[0].prizesTaken, 1, 'the Knock Out is a Knock Out all the same');
});

test('noRecoverFromDiscard: effects can\'t put the card into the hand or deck from the discard pile; it is not offered when the choice is going there, and stays put otherwise', () => {
  const dk = deck('Dreepy', 'Potion', 'Poké Vital A', 'Switch');
  const POT = (program: Program): CardScript[] => [
    { id: 'me03-083', name: 'Potion', play: program },
    { id: 'sv06.5-062', name: 'Poké Vital A', noRecoverFromDiscard: true, play: [] },
  ];
  const mk = (program: Program): Game => scenario(dk, dk, [{ active: 'Dreepy', hand: ['Potion'], discard: ['Poké Vital A', 'Switch', 'Poké Vital A'] }, { active: 'Dreepy' }], { scripts: POT(program) });
  const recover: Program = [
    { op: 'chooseCards', from: 'discard', filter: { cat: 'trainer' }, min: 0, max: 3, as: 'x' },
    { op: 'move', cards: 'x', to: 'hand' },
  ];
  const g = mk(recover);
  choose(g, 'Play Potion');
  assert.deepEqual(labels(g), ['Switch'], 'Poké Vital A is not offered');
  g.submit([0]);
  assert.deepEqual(g.state.p[0].hand.map((c) => nameOf(g, c)).filter((n) => n === 'Switch' || n === 'Poké Vital A'), ['Switch']);
  // A move that doesn't go through a choice: the card stays in the discard pile, the rest goes.
  const all = mk([{ op: 'move', cards: { all: 'discard' }, to: 'hand' }]);
  choose(all, 'Play Potion');
  assert.equal(all.state.p[0].discard.filter((c) => nameOf(all, c) === 'Poké Vital A').length, 2);
  assert.ok(all.state.p[0].hand.some((c) => nameOf(all, c) === 'Switch'));
  // To the deck as well (top, bottom, shuffled in).
  for (const to of ['deck', 'deckTop', 'deckBottom'] as const) {
    const d = mk([{ op: 'move', cards: { all: 'discard' }, to }]);
    choose(d, 'Play Potion');
    assert.equal(d.state.p[0].discard.filter((c) => nameOf(d, c) === 'Poké Vital A').length, 2, to);
  }
  // Anywhere else is fine: put in the discard pile again.
  const keep = mk([{ op: 'chooseCards', from: 'discard', filter: { cat: 'trainer' }, min: 3, max: 3, as: 'x' }, { op: 'move', cards: 'x', to: 'discard' }]);
  choose(keep, 'Play Potion');
  assert.equal(keep.state.p[0].discard.length, 4, 'all three still there (and the Potion)');
  // The opponent's discard pile: the card can't be put into a hand from there either.
  const theirs = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Potion'] }, { active: 'Dreepy', discard: ['Poké Vital A'] }], {
    scripts: POT([{ op: 'move', cards: { all: 'discard', who: 'opp' }, to: 'hand', who: 'opp' }]),
  });
  choose(theirs, 'Play Potion');
  assert.equal(theirs.state.p[1].discard.length, 1);
});

// ------------------------------------------------------------------ 9. Stadium on Stadium, Energy to the hand, previous Evolutions' attacks

test('extraStadium: playable only over the Stadium it names, in the same turn that one was played; any other Stadium is still one a turn', () => {
  const dk = deck('Dreepy', 'Prism Tower', 'Ange Floette', 'Mega Floette ex', 'Dizzying Valley');
  const mk = (stadium: boolean, played = false): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Prism Tower', 'Ange Floette', 'Dizzying Valley'] }, { active: 'Dreepy' }]);
    if (stadium) {
      const c = g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((x) => nameOf(g, x) === 'Prism Tower'), 1)[0]!;
      g.state.stadium = { card: c, owner: 0 };
    }
    g.state.p[0].stadiumPlayed = played;
    refresh(g);
    return g;
  };
  const stads = (g: Game) => acts(g).filter((a) => a.t === 'trainer').map((a) => nameOf(g, (a as { card: number }).card)).sort();
  assert.deepEqual(stads(mk(false)), ['Dizzying Valley', 'Prism Tower'], "no Prism Tower in play: Ange Floette isn't playable");
  assert.deepEqual(stads(mk(true)), ['Ange Floette', 'Dizzying Valley'], "Prism Tower in play (the same name can't be played again)");
  // After a Stadium was played this turn: Dizzying Valley is out, Ange Floette is not.
  assert.deepEqual(stads(mk(true, true)), ['Ange Floette']);
  const g = mk(true, true);
  choose(g, 'Play Ange Floette');
  assert.equal(nameOf(g, g.state.stadium!.card), 'Ange Floette');
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Prism Tower'), 'the Prism Tower was discarded');
  assert.deepEqual(stads(g), [], "that was the turn's Stadium");
});

test('handAfterOwnAttack: an Energy discarded by an effect of its own Pokémon\'s attack goes to the hand after the attack, if the Pokémon is of the kind; not otherwise', () => {
  const dk = deck("N's Darumaka", 'Dreepy', 'Nitro Fire Energy');
  const NITRO: CardScript = { id: 'me04-086', name: 'Nitro Fire Energy', fix: { specialEnergy: true }, provides: ['Fire'], handAfterOwnAttack: { holder: { type: 'Fire' } } };
  const prog: Program = [
    { op: 'discardEnergy', from: 'self', count: 'all' },
    // While the attack is on, the card is in the discard pile; only afterwards is it in the hand.
    { op: 'if', cond: { gte: [{ count: { zone: 'discard', filter: { name: 'Nitro Fire Energy' } } }, 1] }, then: [{ op: 'damage', amount: 30, to: 'defender' }] },
  ];
  const fire = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: ['Nitro Fire Energy', FIR, FIR] } }, { active: 'Dreepy' }], { scripts: [NITRO, ...darumaka(prog)] });
  attack(fire);
  assert.equal(fire.state.p[1].active!.damage, 30, 'it was still in the discard pile during the attack');
  assert.equal(fire.state.p[0].hand.filter((c) => nameOf(fire, c) === 'Nitro Fire Energy').length, 1, 'then it went to the hand');
  assert.ok(!fire.state.p[0].discard.some((c) => nameOf(fire, c) === 'Nitro Fire Energy'));
  assert.ok(fire.state.p[0].discard.some((c) => nameOf(fire, c) === 'Fire Energy'), 'the other Energy stays discarded');
  // Not the kind of Pokémon it names: Dreepy is a {N} Pokémon.
  const dragon = scenario(dk, dk, [{ active: 'Dreepy', energy: { active: ['Nitro Fire Energy', PSY] } }, { active: 'Dreepy' }], {
    scripts: [NITRO, { id: 'sv06-128', name: 'Dreepy', attacks: { Bite: { program: prog } } }],
  });
  choose(dragon, 'Attack: Bite');
  assert.equal(dragon.state.p[0].hand.filter((c) => nameOf(dragon, c) === 'Nitro Fire Energy').length, 0);
  assert.ok(dragon.state.p[0].discard.some((c) => nameOf(dragon, c) === 'Nitro Fire Energy'));
  // Discarded by the opponent's attack: it stays discarded.
  const theirs = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: ['Nitro Fire Energy', FIR] } }, { active: 'Dreepy', energy: { active: [PSY, PSY] } }], {
    scripts: [NITRO, { id: 'sv06-128', name: 'Dreepy', attacks: { 'Petty Grudge': { program: [{ op: 'discardEnergy', from: 'defender', count: 'all' }] } } }],
    current: 1,
    first: 0,
    turn: 4,
  });
  choose(theirs, 'Attack: Petty Grudge');
  assert.equal(theirs.state.p[0].hand.filter((c) => nameOf(theirs, c) === 'Nitro Fire Energy').length, 0);
  assert.ok(theirs.state.p[0].discard.some((c) => nameOf(theirs, c) === 'Nitro Fire Energy'));
});

test('previousAttacks: an evolved Pokémon can use the attacks of the cards under it, with their own Energy and the usual cost effects', () => {
  const dk = deck('Chikorita', 'Bayleef', 'Dreepy');
  const mk = (energy: string[], effect = true): Game => {
    const g = scenario(dk, dk, [{ active: 'Chikorita', evolve: { active: ['Bayleef'] }, energy: { active: energy }, bench: ['Chikorita'] }, { active: 'Dreepy' }]);
    if (effect) {
      inject(g, g.state.p[0].active!.id, { k: 'previousAttacks' });
      inject(g, g.state.p[0].bench[0]!.id, { k: 'previousAttacks' });
    }
    refresh(g);
    return g;
  };
  const g = mk([GRS]);
  assert.ok(has(g, 'Attack: Razor Leaf'), "Chikorita's Razor Leaf {G} is paid by the Grass Energy");
  assert.ok(!has(g, 'Attack: Push Down'), "Bayleef's own attack needs {G}{C}");
  const razor = acts(g).find((a) => a.t === 'attack') as { idx: number; card: number };
  assert.equal(nameOf(g, razor.card), 'Chikorita');
  choose(g, 'Attack: Razor Leaf');
  assert.equal(g.state.p[1].active!.damage, 20);
  // The printed one and the borrowed one are both there with enough Energy.
  const two = mk([GRS, GRS]);
  assert.deepEqual(labels(two).filter((l) => l.startsWith('Attack')).sort(), ['Attack: Push Down', 'Attack: Razor Leaf']);
  // Without the effect, only the printed attack; a Basic Pokémon gets nothing from it.
  const none = mk([GRS, GRS], false);
  assert.deepEqual(labels(none).filter((l) => l.startsWith('Attack')), ['Attack: Push Down']);
  const basic = scenario(dk, dk, [{ active: 'Chikorita', energy: { active: [GRS] } }, { active: 'Dreepy' }]);
  inject(basic, basic.state.p[0].active!.id, { k: 'previousAttacks' });
  refresh(basic);
  assert.equal(labels(basic).filter((l) => l.startsWith('Attack')).length, 1, 'its own Razor Leaf only');
  // A cost effect on the Pokémon applies to the borrowed attack by its name.
  const cheap = mk([], true);
  assert.ok(!has(cheap, 'Attack: Razor Leaf'), 'no Energy: no attack');
  inject(cheap, cheap.state.p[0].active!.id, { k: 'attackCostSet', attack: 'Razor Leaf', cost: [] });
  refresh(cheap);
  assert.ok(has(cheap, 'Attack: Razor Leaf'));
});

// ------------------------------------------------------------------ 10. An attack stopped by Energy

test('cantAttack with `ifEnergyAtMost`: Pokémon with that much Energy or less can\'t attack, counted in the Energy they provide', () => {
  const dk = deck("Team Rocket's Zubat", 'Dreepy', "Team Rocket's Energy");
  const TR: CardScript = { id: 'me02.5-217', name: "Team Rocket's Energy", fix: { specialEnergy: true }, provides: ['Psychic', 'Darkness'], providesFlex: { n: 2, types: ['Psychic', 'Darkness'] }, attachOnly: { nameIncludes: "Team Rocket's" } };
  const mk = (energy: string[], effect = true): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy' }, { active: "Team Rocket's Zubat", bench: ['Dreepy'], energy: { active: energy } }], { current: 1, first: 0, turn: 4, scripts: [TR] });
    if (effect) injectPlayer(g, 1, { k: 'cantAttack', ifEnergyAtMost: 2 }, 'myPokemon');
    refresh(g);
    return g;
  };
  const canAttack = (g: Game): boolean => acts(g, 1).some((a) => a.t === 'attack');
  assert.ok(!canAttack(mk(["Team Rocket's Energy"])), 'one card, 2 Energy provided: stopped');
  assert.ok(!canAttack(mk([DRK, DRK])), '2 Energy: stopped');
  assert.ok(canAttack(mk(["Team Rocket's Energy", DRK])), '3 Energy provided: free to attack');
  assert.ok(canAttack(mk([DRK, DRK, FIR])));
  assert.ok(canAttack(mk([DRK, DRK], false)), 'without the effect the same 2 Energy attack');
  // A Pokémon that comes into play later is covered: the effect is on the player's Pokémon, matched live.
  const h = mk([DRK, DRK]);
  assert.ok(!canAttack(h));
  const newcomer = h.state.p[1].bench.pop()!;
  h.state.p[1].active = newcomer;
  assert.ok(!canAttack(h), 'a Pokémon with no Energy at all');
});

test('energyProvides: a static whose own condition counts Energy does not loop; the count under it is the printed one while it is being worked out', () => {
  const dk = deck('Chikorita', 'Dreepy');
  // A stand-in for "as long as this Pokémon has 3 or more Energy attached, it gets +10 HP" on the Dreepy.
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Chikorita'], energy: { active: [GRS, GRS] } }, { active: 'Dreepy' }], {
    scripts: [
      { id: 'me01-008', name: 'Chikorita', ...WILD },
      { id: 'sv06-128', name: 'Dreepy', statics: [{ effect: { k: 'hp', delta: 10 }, scope: 'self', when: { gte: [{ energyOn: 'self' }, 3] } }] },
    ],
  });
  const dreepy = g.state.p[0].active!;
  assert.doesNotThrow(() => maxHp(g.env, g.state, dreepy));
  assert.doesNotThrow(() => acts(g));
  assert.equal(energyUnits(g.env, dreepy, g.state).length, 4, 'Wild Growth applies outside of that');
});
