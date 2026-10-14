/**
 * Card tests, batch "std-engine6": every card scripted in cards/scripts/std-engine6.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from the frames.
 * The engine features themselves are tested in engine-features-6.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import { evalCond } from '../eval.js';
import { advance, legalActions } from '../flow.js';
import type { Game } from '../game.js';
import { maxHp } from '../query.js';
import { scenario } from '../scenario.js';
import { findSlot } from '../state.js';
import { BURNED, CONFUSED, POISONED, type Decision } from '../types.js';
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
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c));
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);

/** Put the Stadium card from this player's deck into play, as if that player had played it. */
function stadium(g: Game, name: string, owner: 0 | 1 = 0): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in P${owner + 1}'s deck`);
  g.state.stadium = { card: dk.splice(i, 1)[0] as number, owner };
  refresh(g);
}
/** Play on until it is this player's turn to act (the turn changes by itself after an attack). */
function endTurn(g: Game): void {
  choose(g, 'End turn');
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  Frillish: 'sv10.5w-044',
  'Jellicent ex': 'sv10.5w-045',
  "Team Rocket's Ekans": 'sv10-112',
  "Team Rocket's Arbok": 'sv10-113',
  Deino: 'sv10.5w-146',
  Zweilous: 'sv10.5w-066',
  'Hydreigon ex': 'sv10.5w-067',
  Cutiefly: 'sv05-075',
  Ribombee: 'sv05-076',
  Magmar: 'sv09-020',
  Magmortar: 'sv09-021',
  Lotad: 'sv09-035',
  Lombre: 'sv09-036',
  Ludicolo: 'sv09-037',
  Magearna: 'sv09-107',
  "Team Rocket's Mareep": 'sv10-072',
  "Team Rocket's Flaaffy": 'sv10-073',
  "Team Rocket's Ampharos": 'sv10-074',
  "Team Rocket's Zubat": 'sv10-120',
  "Team Rocket's Golbat": 'sv10-121',
  "Arven's Skwovet": 'sv10-158',
  "Arven's Greedent": 'sv10-159',
  'Perilous Jungle': 'sv05-156',
  Ferrothorn: 'me04-063',
  Spiritomb: 'me01-087',
  Cresselia: 'sv06.5-021',
  "Team Rocket's Bother-Bot": 'sv10-172',
  Koraidon: 'sv08-116',
  'Great Tusk': 'sv05-096',
  'Roaring Moon': 'sv05-109',
  Dreepy: 'sv06-128', // Dragon, 70 HP, no Weakness
  Drakloak: 'sv06-129',
  Chikorita: 'me01-008', // Grass, 70 HP, Fire-weak
  "N's Darumaka": 'me02.5-032', // Fire, 80 HP; Rolling Tackle {C}{C} 20
  Switch: 'me01-130',
  Potion: 'me03-083',
  "Hero's Cape": 'sv05-152',
  "Team Rocket's Watchtower": 'sv10-180',
  'Enriching Energy': 'sv08-191',
};
/** A test deck of the named cards (10 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('engine6', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const GRA = 'Grass Energy';
const FIR = 'Fire Energy';
const WAT = 'Water Energy';
const LIG = 'Lightning Energy';
const PSY = 'Psychic Energy';
const FIG = 'Fighting Energy';
const DAR = 'Darkness Energy';
const MET = 'Metal Energy';

// ------------------------------------------------------------------ Jellicent ex

test('Jellicent ex, Oceanic Curse: while it is in the Active Spot your opponent can\'t play Item cards or Pokémon Tool cards from their hand', () => {
  const dk = deck('Frillish', 'Jellicent ex', 'Dreepy', 'Switch', "Hero's Cape", 'Potion');
  const mk = (jellicentActive: boolean): Game =>
    scenario(
      dk,
      dk,
      [
        { active: 'Dreepy', bench: ['Dreepy'], hand: ['Switch', "Hero's Cape", 'Potion'], damage: { active: 30 } },
        jellicentActive ? { active: 'Frillish', evolve: { active: ['Jellicent ex'] }, bench: ['Dreepy'] } : { active: 'Dreepy', bench: ['Frillish'], evolve: { 0: ['Jellicent ex'] } },
      ],
      { turn: 3, current: 0, first: 0 },
    );
  const g = mk(true);
  const acts = (x: Game) => legalActions(x.env, x.state, 0).map((a) => a.t);
  assert.ok(!acts(g).includes('trainer'), 'no Item cards');
  assert.ok(!acts(g).includes('tool'), 'no Pokémon Tool cards');
  // On the Bench it does nothing.
  const h = mk(false);
  assert.ok(acts(h).includes('trainer'));
  assert.ok(acts(h).includes('tool'));
  // It is the opponent's cards that are locked, not its owner's.
  const own = scenario(dk, dk, [{ active: 'Frillish', evolve: { active: ['Jellicent ex'] }, hand: ['Switch', "Hero's Cape"], bench: ['Dreepy'] }, { active: 'Dreepy' }]);
  assert.ok(legalActions(own.env, own.state, 0).some((a) => a.t === 'tool'));
  assert.ok(legalActions(own.env, own.state, 0).some((a) => a.t === 'trainer'));
});

test('Jellicent ex, Power Press: 80 damage, 80 more with at least 2 extra Energy attached beyond its cost', () => {
  const dk = deck('Frillish', 'Jellicent ex', 'Hydreigon ex');
  const hit = (energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Frillish', evolve: { active: ['Jellicent ex'] }, energy: { active: energy } }, { active: 'Hydreigon ex' }], { turn: 3, current: 0, first: 0 });
    choose(g, 'Attack: Power Press');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([PSY, PSY]), 80, 'no extra Energy');
  assert.equal(hit([PSY, PSY, FIR]), 80, 'only 1 extra');
  assert.equal(hit([PSY, PSY, FIR, FIR]), 160, '2 extra');
  assert.equal(hit([PSY, PSY, FIR, FIR, FIR]), 160);
});

// ------------------------------------------------------------------ Team Rocket's Arbok

test("Team Rocket's Arbok, Potent Glare: while Arbok is Active, its opponent cannot play Pokémon that have an Ability from hand, except for Team Rocket's Pokémon (ruling 2147)", () => {
  const dk = deck('Dreepy', 'Magearna', "Arven's Skwovet", "Arven's Greedent", "Team Rocket's Zubat", "Team Rocket's Golbat", "Team Rocket's Ekans", "Team Rocket's Arbok", "Team Rocket's Watchtower");
  const mk = (arbokActive: boolean): Game =>
    scenario(
      dk,
      dk,
      [
        { active: 'Dreepy', bench: ["Arven's Skwovet", "Team Rocket's Zubat"], hand: ['Magearna', 'Dreepy', "Arven's Greedent", "Team Rocket's Golbat"] },
        arbokActive
          ? { active: "Team Rocket's Ekans", evolve: { active: ["Team Rocket's Arbok"] }, bench: ['Dreepy'] }
          : { active: 'Dreepy', bench: ["Team Rocket's Ekans"], evolve: { 0: ["Team Rocket's Arbok"] } },
      ],
      { turn: 3, current: 0, first: 0 },
    );
  const plays = (g: Game) =>
    legalActions(g.env, g.state, 0)
      .filter((a) => a.t === 'bench' || a.t === 'evolve')
      .map((a) => `${a.t}:${nameOf(g, (a as { card: number }).card)}`)
      .sort();
  const g = mk(true);
  assert.deepEqual(plays(g), ['bench:Dreepy', "evolve:Team Rocket's Golbat"], "Magearna and Arven's Greedent have Abilities and aren't Team Rocket's");
  // Not while it is on the Bench.
  assert.deepEqual(plays(mk(false)), ['bench:Dreepy', 'bench:Magearna', "evolve:Arven's Greedent", "evolve:Team Rocket's Golbat"]);
  // Ruling 2147: under Team Rocket's Watchtower {C} Pokémon in play have no Abilities, but Arven's Greedent in the hand still has one.
  stadium(g, "Team Rocket's Watchtower", 1);
  assert.deepEqual(plays(g), ['bench:Dreepy', "evolve:Team Rocket's Golbat"], 'Arven\'s Greedent still cannot be played');
  // It is the real play, not only the list.
  choose(g, 'Evolve Team Rocket\'s Zubat into Team Rocket\'s Golbat');
  assert.equal(names(g, g.state.p[0].bench[1]!.cards).at(-1), "Team Rocket's Golbat");
});

test("Team Rocket's Arbok, Spinning Tail: 30 damage to each of your opponent's Pokémon, Weakness only for the Active one", () => {
  const dk = deck("Team Rocket's Ekans", "Team Rocket's Arbok", 'Frillish', 'Dreepy');
  const g = scenario(
    dk,
    dk,
    [
      { active: "Team Rocket's Ekans", evolve: { active: ["Team Rocket's Arbok"] }, energy: { active: [DAR, DAR, DAR] } },
      { active: 'Frillish', bench: ['Frillish', 'Dreepy'] },
    ],
    { turn: 3, current: 0, first: 0 },
  );
  choose(g, 'Attack: Spinning Tail');
  const o = g.state.p[1];
  assert.equal(o.active!.damage, 60, 'Frillish is weak to {D}');
  assert.deepEqual(o.bench.map((b) => b.damage), [30, 30], 'no Weakness on the Bench');
});

// ------------------------------------------------------------------ Hydreigon ex

test('Hydreigon ex, Greedy Eater: 1 more Prize card when your opponent\'s Basic Pokémon is Knocked Out by damage from its attack', () => {
  const dk = deck('Deino', 'Zweilous', 'Hydreigon ex', 'Dreepy', 'Drakloak', 'Chikorita');
  const mk = (target: string, bench: string[] = []): Game =>
    scenario(
      dk,
      dk,
      [
        { active: 'Deino', evolve: { active: ['Zweilous', 'Hydreigon ex'] }, energy: { active: [DAR, DAR, DAR, FIR, FIR] } },
        { active: target, bench },
      ],
      { turn: 3, current: 0, first: 0 },
    );
  const basic = mk('Dreepy', ['Chikorita']);
  choose(basic, 'Attack: Dark Bite');
  assert.equal(basic.state.p[0].prizesTaken, 2, 'a Basic Pokémon: 1 + 1');
  const stage1 = mk('Drakloak', ['Chikorita']);
  stage1.state.p[1].active!.damage = 0;
  choose(stage1, 'Attack: Dark Bite');
  assert.equal(stage1.state.p[0].prizesTaken, 1, 'a Stage 1 Pokémon: the usual 1');
  // A Hydreigon ex is not the only Pokémon that may be the attacker: another Pokémon's attack doesn't get the extra Prize card.
  const other = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Deino'], energy: { active: [PSY, FIR] } }, { active: 'Chikorita', bench: ['Chikorita'], damage: { active: 60 } }], { turn: 3, current: 0, first: 0 });
  other.state.p[0].bench[0]!.cards.push(...other.state.p[0].deck.splice(other.state.p[0].deck.findIndex((c) => nameOf(other, c) === 'Zweilous'), 1));
  other.state.p[0].bench[0]!.cards.push(...other.state.p[0].deck.splice(other.state.p[0].deck.findIndex((c) => nameOf(other, c) === 'Hydreigon ex'), 1));
  refresh(other);
  choose(other, 'Attack: Bite');
  assert.equal(other.state.p[0].prizesTaken, 1, "a Basic Pokémon Knocked Out by a different Pokémon's attack (Hydreigon ex is on the Bench): the usual 1");
});

test('Hydreigon ex, Dark Bite: 200 damage; the Defending Pokémon can\'t retreat during your opponent\'s next turn', () => {
  const dk = deck('Deino', 'Zweilous', 'Hydreigon ex', 'Dreepy');
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Deino', evolve: { active: ['Zweilous', 'Hydreigon ex'] }, energy: { active: [DAR, DAR, DAR, FIR, FIR] } },
      { active: 'Hydreigon ex', bench: ['Dreepy'], energy: { active: [DAR, DAR, DAR] } },
    ],
    { turn: 3, current: 0, first: 0 },
  );
  choose(g, 'Attack: Dark Bite');
  assert.equal(g.state.p[1].active!.damage, 200);
  assert.ok(!legalActions(g.env, g.state, 1).some((a) => a.t === 'retreat'), "can't retreat in the opponent's next turn");
});

// ------------------------------------------------------------------ Ribombee

test('Ribombee, Plentiful Pollen: 30 damage; during your next turn, 2 more Prize cards if the Defending Pokémon is Knocked Out', () => {
  const dk = deck('Cutiefly', 'Ribombee', 'Koraidon', 'Dreepy', 'Drakloak');
  const mk = (target = 'Koraidon'): Game =>
    scenario(
      dk,
      dk,
      [
        { active: 'Cutiefly', evolve: { active: ['Ribombee'] }, energy: { active: [PSY] } },
        { active: target, bench: ['Dreepy'], energy: { active: [FIG, FIG] }, hand: ['Drakloak'] },
      ],
      { turn: 3, current: 0, first: 0 },
    );
  const g = mk();
  choose(g, 'Attack: Plentiful Pollen');
  assert.equal(g.state.p[1].active!.damage, 60, '30, doubled by Weakness');
  assert.equal(g.state.effects.length, 1);
  // The opponent's turn passes; during mine the Defending Pokémon is Knocked Out: 1 + 2 Prize cards. (Using the attack again makes a
  // new effect, for the turn after: it doesn't count in this one.)
  g.state.p[1].active!.damage = 80;
  endTurn(g);
  assert.equal(g.state.turn, 5);
  choose(g, 'Attack: Plentiful Pollen');
  assert.equal(g.state.p[0].prizesTaken, 3);

  // Not in the opponent's turn: a Knock Out then (here: of the Defending Pokémon by Poison at its owner's Checkup) is the usual.
  const opp = mk();
  choose(opp, 'Attack: Plentiful Pollen');
  assert.equal(opp.state.turn, 4);
  opp.state.p[1].active!.damage = 120;
  opp.state.p[1].active!.cond = POISONED;
  endTurn(opp);
  assert.equal(opp.state.p[0].prizesTaken, 1, 'Knocked Out during the opponent\'s turn: the usual Prize card');

  // Ruling 1957: the Defending Pokémon is switched with a new Pokémon, then that one is Knocked Out: the usual Prize cards.
  const sw = mk();
  choose(sw, 'Attack: Plentiful Pollen');
  const bench = sw.state.p[1].bench[0]!;
  sw.state.p[1].active!.energy.push(...sw.state.p[1].active!.energy); // (a Retreat Cost of {C}{C} can be paid)
  refresh(sw);
  choose(sw, 'Retreat');
  while (sw.decision!.kind !== 'main') {
    const d = sw.decision!;
    if (d.kind === 'slots' || d.kind === 'promote') pickSlot(sw, bench.id);
    else sw.submit(Array.from({ length: d.min }, (_, i) => i)); // the Energy to discard for the Retreat Cost
  }
  assert.equal(sw.state.p[1].active, bench);
  assert.equal(sw.state.effects.length, 0, 'the effect went away with the Defending Pokémon leaving the Active Spot');
  bench.damage = 60;
  endTurn(sw);
  assert.equal(sw.state.turn, 5);
  choose(sw, 'Attack: Plentiful Pollen');
  assert.equal(sw.state.p[0].prizesTaken, 1);

  // ...or it evolves.
  const ev = mk('Dreepy');
  choose(ev, 'Attack: Plentiful Pollen');
  assert.equal(ev.state.effects.length, 1);
  ev.state.p[1].active!.enteredTurn = 0;
  refresh(ev);
  choose(ev, 'Evolve Dreepy');
  assert.equal(ev.state.effects.length, 0, 'it evolved');
  ev.state.p[1].active!.damage = 80;
  endTurn(ev);
  choose(ev, 'Attack: Plentiful Pollen');
  assert.equal(ev.state.p[0].prizesTaken, 1);
});

// ------------------------------------------------------------------ Magmortar

test('Magmortar, Searing Flame: 90 damage, and on heads your opponent\'s Active Pokémon is now Burned', () => {
  const dk = deck('Magmar', 'Magmortar', 'Hydreigon ex');
  const hit = (coin: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Magmar', evolve: { active: ['Magmortar'] }, energy: { active: [FIR, FIR, FIR] } }, { active: 'Hydreigon ex' }], { turn: 3, current: 0, first: 0 });
    g.state.forcedCoins = [coin, false]; // the attack's flip, then the Burn flip at Checkup (tails: stays Burned)
    choose(g, 'Attack: Searing Flame');
    return g;
  };
  assert.equal(hit(true).state.p[1].active!.cond & BURNED, BURNED);
  assert.equal(hit(false).state.p[1].active!.cond & BURNED, 0);
  assert.equal(hit(false).state.p[1].active!.damage, 90);
});

test('Magmortar, Magma Surge: 3 more damage counters on your opponent\'s Burned Pokémon at Checkup, before the Burn flip; each Magmortar adds its own (ruling 2112)', () => {
  const dk = deck('Magmar', 'Magmortar', 'Hydreigon ex', 'Dreepy');
  const mk = (benchMagmortar: boolean, coin: boolean): Game => {
    const g = scenario(
      dk,
      dk,
      [
        { active: 'Magmar', evolve: { active: ['Magmortar'] }, bench: benchMagmortar ? ['Magmar'] : ['Dreepy'], evolve2: undefined } as never,
        { active: 'Hydreigon ex', cond: BURNED },
      ],
      { turn: 3, current: 0, first: 0 },
    );
    if (benchMagmortar) g.state.p[0].bench[0]!.cards.push(g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((c) => nameOf(g, c) === 'Magmortar'), 1)[0]!);
    g.state.forcedCoins = [coin];
    refresh(g);
    endTurn(g);
    return g;
  };
  assert.equal(mk(false, false).state.p[1].active!.damage, 50, 'Burn 2 + Magma Surge 3');
  assert.equal(mk(true, false).state.p[1].active!.damage, 80, 'with a second Magmortar: 2 + 3 + 3 (ruling 2112)');
  // The flip comes after: a Pokémon cured by it still took all of the counters.
  const cured = mk(false, true);
  assert.equal(cured.state.p[1].active!.cond & BURNED, 0);
  assert.equal(cured.state.p[1].active!.damage, 50);
  // Only the opponent's Burned Pokémon: mine takes the 2 of Burn.
  const own = scenario(dk, dk, [{ active: 'Magmar', evolve: { active: ['Magmortar'] }, cond: BURNED }, { active: 'Hydreigon ex' }], { turn: 3, current: 0, first: 0 });
  own.state.forcedCoins = [false];
  endTurn(own);
  assert.equal(own.state.p[0].active!.damage, 20);
  // ...and not a Pokémon that is not Burned.
  const plain = scenario(dk, dk, [{ active: 'Magmar', evolve: { active: ['Magmortar'] } }, { active: 'Hydreigon ex' }], { turn: 3, current: 0, first: 0 });
  endTurn(plain);
  assert.equal(plain.state.p[1].active!.damage, 0);
});

// ------------------------------------------------------------------ Perilous Jungle

test('Perilous Jungle: 2 more damage counters at Checkup on each Poisoned non-{D} Pokémon, both yours and your opponent\'s', () => {
  const dk = deck('Perilous Jungle', 'Dreepy', 'Roaring Moon', 'Koraidon');
  const mk = (a: string, b: string, jungle: boolean): Game => {
    const g = scenario(dk, dk, [{ active: a, cond: POISONED }, { active: b, cond: POISONED }], { turn: 3, current: 0, first: 0 });
    void jungle;
    if (jungle) stadium(g, 'Perilous Jungle', 1);
    endTurn(g);
    return g;
  };
  const without = mk('Dreepy', 'Koraidon', false);
  assert.deepEqual([without.state.p[0].active!.damage, without.state.p[1].active!.damage], [10, 10], 'Poison alone: 1 counter');
  const g = mk('Dreepy', 'Koraidon', true);
  assert.deepEqual([g.state.p[0].active!.damage, g.state.p[1].active!.damage], [30, 30], '1 + 2 for each, whoever played the Stadium');
  // {D} Pokémon are left out.
  const dark = mk('Roaring Moon', 'Koraidon', true);
  assert.deepEqual([dark.state.p[0].active!.damage, dark.state.p[1].active!.damage], [10, 30]);
  // A Pokémon that is not Poisoned takes none, and the Poison amount of its own (Poisoned with more counters) adds up.
  const h = scenario(dk, dk, [{ active: 'Dreepy' }, { active: 'Koraidon', cond: POISONED }], { turn: 3, current: 0, first: 0 });
  h.state.p[1].active!.poisonCounters = 4;
  stadium(h, 'Perilous Jungle', 0);
  endTurn(h);
  assert.equal(h.state.p[0].active!.damage, 0);
  assert.equal(h.state.p[1].active!.damage, 60, '4 + 2');
});

// ------------------------------------------------------------------ Ludicolo

test('Ludicolo, Vibrant Dance: all of your Pokémon in play get +40 HP, and the effect doesn\'t stack', () => {
  const dk = deck('Lotad', 'Lombre', 'Ludicolo', 'Dreepy');
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Lotad', evolve: { active: ['Lombre', 'Ludicolo'] }, bench: ['Dreepy', 'Lotad'], evolve2: undefined } as never,
      { active: 'Dreepy' },
    ],
    { turn: 3, current: 0, first: 0 },
  );
  const [act, dr, lotad] = [g.state.p[0].active!, g.state.p[0].bench[0]!, g.state.p[0].bench[1]!];
  const hp = (s: typeof act): number => maxHp(g.env, g.state, s);
  assert.equal(hp(act), 180, '140 + 40');
  assert.equal(hp(dr), 110, '70 + 40');
  assert.equal(hp(lotad), 100);
  assert.equal(hp(g.state.p[1].active!), 70, "not your opponent's Pokémon");
  // A second Ludicolo: the same +40.
  lotad.cards.push(...g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((c) => nameOf(g, c) === 'Lombre'), 1), ...g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((c) => nameOf(g, c) === 'Ludicolo'), 1));
  assert.equal(hp(dr), 110, "doesn't stack");
  assert.equal(hp(act), 180);
  // Damage that is more than the printed HP but less than the raised HP doesn't Knock Out.
  dr.damage = 100;
  refresh(g);
  assert.ok(g.state.p[0].bench.includes(dr), 'still in play');
  // It is gone when the Pokémon is: both Ludicolo leave play and HP is back.
  g.state.p[0].active = null;
  g.state.p[0].bench = g.state.p[0].bench.filter((b) => b !== lotad);
  assert.equal(hp(dr), 70);
});

// ------------------------------------------------------------------ Magearna

test('Magearna, Auto Heal: while it is Active, whenever you attach an Energy card from your hand to 1 of your Pokémon, heal 90 damage from that Pokémon', () => {
  const dk = deck('Magearna', 'Dreepy');
  const mk = (magearnaActive: boolean): Game =>
    scenario(
      dk,
      dk,
      [
        magearnaActive
          ? { active: 'Magearna', bench: ['Dreepy'], hand: [FIR, FIR], damage: { active: 50, 0: 60 } }
          : { active: 'Dreepy', bench: ['Magearna', 'Dreepy'], hand: [FIR, FIR], damage: { active: 60, 1: 60 } },
        { active: 'Dreepy' },
      ],
      { turn: 3, current: 0, first: 0 },
    );
  // Attached to a Benched Pokémon (60 damage): healed (all of it, 90 is more than there is).
  const g = mk(true);
  choose(g, `Attach ${FIR} to Dreepy`);
  assert.equal(g.state.p[0].bench[0]!.damage, 0);
  assert.equal(g.state.p[0].active!.damage, 50, 'only the Pokémon that got the Energy');
  // To Magearna itself.
  const h = mk(true);
  choose(h, `Attach ${FIR} to Magearna`);
  assert.equal(h.state.p[0].active!.damage, 0);
  // Not while it is on the Bench.
  const b = mk(false);
  choose(b, `Attach ${FIR} to Dreepy (Active)`);
  assert.equal(b.state.p[0].active!.damage, 60);
  // Not for the opponent's Energy.
  const o = scenario(dk, dk, [{ active: 'Magearna', damage: { active: 50 } }, { active: 'Dreepy', hand: [FIR] }], { turn: 4, current: 1, first: 0 });
  choose(o, `Attach ${FIR}`);
  assert.equal(o.state.p[0].active!.damage, 50);
});

test('Magearna, Spike Draw: 20 damage and draw 2 cards', () => {
  const dk = deck('Magearna', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Magearna', energy: { active: [MET] } }, { active: 'Dreepy' }], { turn: 3, current: 0, first: 0 });
  const hand = g.state.p[0].hand.length;
  choose(g, 'Attack: Spike Draw');
  assert.equal(g.state.p[0].hand.length, hand + 2);
  assert.equal(g.state.p[1].active!.damage, 20);
});

// ------------------------------------------------------------------ Team Rocket's Ampharos

test("Team Rocket's Ampharos, Darkest Impulse: 4 damage counters on each Pokémon your opponent plays from their hand to evolve; the effect doesn't stack (rulings 2145)", () => {
  const dk = deck("Team Rocket's Mareep", "Team Rocket's Flaaffy", "Team Rocket's Ampharos", 'Dreepy', 'Drakloak');
  const mk = (ampharos: number): Game => {
    const g = scenario(
      dk,
      dk,
      [
        { active: "Team Rocket's Mareep", evolve: { active: ["Team Rocket's Flaaffy", "Team Rocket's Ampharos"] }, bench: ["Team Rocket's Mareep"] },
        { active: 'Dreepy', bench: ['Dreepy'], hand: ['Drakloak', 'Drakloak'] },
      ],
      { turn: 4, current: 1, first: 0 },
    );
    if (ampharos === 2) g.state.p[0].bench[0]!.cards.push(...['Team Rocket\'s Flaaffy', 'Team Rocket\'s Ampharos'].map((n) => g.state.p[0].deck.splice(g.state.p[0].deck.findIndex((c) => nameOf(g, c) === n), 1)[0]!));
    for (const sl of [g.state.p[1].active!, g.state.p[1].bench[0]!]) sl.enteredTurn = 0;
    refresh(g);
    return g;
  };
  const g = mk(1);
  choose(g, 'Evolve Dreepy (Active)');
  assert.equal(g.state.p[1].active!.damage, 40);
  // Both Pokémon evolving in the same turn each get theirs (ruling 2145: "Yes, you can.").
  choose(g, 'Evolve Dreepy');
  assert.equal(g.state.p[1].bench[0]!.damage, 40);
  // Two Ampharos: not 8 on each.
  const two = mk(2);
  choose(two, 'Evolve Dreepy (Active)');
  assert.equal(two.state.p[1].active!.damage, 40, "the effect of Darkest Impulse doesn't stack");
  // The player's own Pokémon are not affected by their own Ampharos.
  const own = scenario(dk, dk, [{ active: "Team Rocket's Mareep", evolve: { active: ["Team Rocket's Flaaffy", "Team Rocket's Ampharos"] }, bench: ['Dreepy'], hand: ['Drakloak'] }, { active: 'Dreepy' }], { turn: 3, current: 0, first: 0 });
  own.state.p[0].bench[0]!.enteredTurn = 0;
  choose(own, 'Evolve Dreepy');
  assert.equal(own.state.p[0].bench[0]!.damage, 0);
});

test("Team Rocket's Ampharos, Darkest Impulse: when a damaged Pokémon evolves into Golbat, its owner chooses the order of the simultaneous Abilities, Sneaky Bite and Darkest Impulse, before the Knock Out is checked (ruling 2146)", () => {
  const dk = deck("Team Rocket's Mareep", "Team Rocket's Flaaffy", "Team Rocket's Ampharos", "Team Rocket's Zubat", "Team Rocket's Golbat", 'Dreepy');
  const g = scenario(
    dk,
    dk,
    [
      { active: "Team Rocket's Mareep", evolve: { active: ["Team Rocket's Flaaffy", "Team Rocket's Ampharos"] }, bench: ['Dreepy'] },
      { active: "Team Rocket's Zubat", damage: { active: 40 }, hand: ["Team Rocket's Golbat"], bench: ['Dreepy'] },
    ],
    { turn: 4, current: 1, first: 0 },
  );
  g.state.p[1].active!.enteredTurn = 0;
  refresh(g);
  choose(g, 'Evolve Team Rocket\'s Zubat');
  // Both Abilities happen at once and the owner orders them (the engine's default order, Golbat's first, here; trigger-order.test.ts and
  // rulings-r10.test.ts cover both).
  assert.equal(g.decision!.prompt, 'Which effect happens first?');
  g.submit([0]);
  // Golbat's Sneaky Bite ("you may put 2 damage counters on 1 of your opponent's Pokémon") is still to be used.
  choose(g, 'Yes');
  const benched = g.state.p[0].bench[0]!;
  pickSlot(g, benched.id);
  assert.equal(benched.damage, 20, 'Sneaky Bite got to resolve');
  // 40 + 40 = Golbat's 80 HP: it is Knocked Out once both Abilities are done.
  assert.equal(g.state.p[0].prizesTaken, 1, 'Knocked Out afterwards: the other player takes a Prize card');
  assert.ok(g.state.p[1].discard.some((c) => nameOf(g, c) === "Team Rocket's Golbat"));
});

// ------------------------------------------------------------------ Ferrothorn

test("Ferrothorn, Startling Drop: during your opponent's turn, if it is discarded from your deck by an effect of their Pokémon's attack, discard the top 8 cards of their deck", () => {
  const dk = deck('Ferrothorn', 'Spiritomb', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Spiritomb', energy: { active: [DAR] } }, { active: 'Dreepy', deckTop: ['Ferrothorn'] }], { turn: 3, current: 0, first: 0 });
  const mine = g.state.p[0].deck.length;
  choose(g, 'Attack: Mountain Breaker'); // "Discard the top card of your opponent's deck."
  assert.ok(g.state.p[1].discard.some((c) => nameOf(g, c) === 'Ferrothorn'), 'Ferrothorn was discarded');
  assert.equal(g.state.p[0].deck.length, mine - 8, "...and the attacker's top 8 cards went with it");
  assert.equal(g.state.p[0].discard.length, 8);
  // Another card on top: nothing happens.
  const h = scenario(dk, dk, [{ active: 'Spiritomb', energy: { active: [DAR] } }, { active: 'Dreepy', deckTop: ['Dreepy'] }], { turn: 3, current: 0, first: 0 });
  const before = h.state.p[0].deck.length;
  choose(h, 'Attack: Mountain Breaker');
  assert.equal(h.state.p[0].deck.length, before);
});

test('Ferrothorn, Special Whip: 70 damage, 70 more with any Special Energy attached', () => {
  const dk = deck('Ferrothorn', 'Hydreigon ex', 'Enriching Energy');
  const hit = (energy: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Ferrothorn', energy: { active: energy } }, { active: 'Hydreigon ex' }], { turn: 3, current: 0, first: 0 });
    choose(g, 'Attack: Special Whip');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([MET, MET]), 70);
  assert.equal(hit([MET, MET, 'Enriching Energy']), 140);
  assert.equal(hit([MET, MET, MET]), 70, 'Basic Energy is not Special');
});

// ------------------------------------------------------------------ Spiritomb

test("Spiritomb, Spiteful Swirl: if your Active {D} Pokémon is damaged by an attack, 1 damage counter on the Attacking Pokémon, from the Bench too, and it stacks (rulings 2217, 2218)", () => {
  const dk = deck('Spiritomb', "N's Darumaka", 'Roaring Moon', 'Dreepy');
  const mk = (active: string, bench: string[], dmg = 0): Game =>
    scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: active, bench, damage: { active: dmg } }], { turn: 3, current: 0, first: 0 });
  // From the Bench (2217).
  const g = mk('Roaring Moon', ['Spiritomb']);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[0].active!.damage, 10);
  // Stacks (2218): two of them.
  const two = mk('Roaring Moon', ['Spiritomb', 'Spiritomb']);
  choose(two, 'Attack: Rolling Tackle');
  assert.equal(two.state.p[0].active!.damage, 20);
  // The Active Spiritomb itself ({D}) counts as the Active {D} Pokémon.
  const self = mk('Spiritomb', []);
  choose(self, 'Attack: Rolling Tackle');
  assert.equal(self.state.p[0].active!.damage, 10);
  // Not a {D} Pokémon.
  const other = mk('Dreepy', ['Spiritomb']);
  choose(other, 'Attack: Rolling Tackle');
  assert.equal(other.state.p[0].active!.damage, 0);
  // Even if the Active Pokémon is Knocked Out by it.
  const ko = mk('Roaring Moon', ['Spiritomb'], 130);
  choose(ko, 'Attack: Rolling Tackle');
  assert.equal(ko.state.p[0].active!.damage, 10);
  // The Bench being damaged is not the Active Pokémon being damaged.
  const bench = scenario(dk, dk, [{ active: "N's Darumaka", energy: { active: [FIR, FIR] } }, { active: 'Roaring Moon', bench: ['Spiritomb'] }], { turn: 3, current: 0, first: 0 });
  bench.state.p[1].bench[0]!.damage = 0;
  assert.equal(bench.state.p[0].active!.damage, 0);
});

test('Spiritomb, Mountain Breaker: 10 damage and discard the top card of your opponent\'s deck', () => {
  const dk = deck('Spiritomb', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Spiritomb', energy: { active: [DAR] } }, { active: 'Dreepy' }], { turn: 3, current: 0, first: 0 });
  const before = g.state.p[1].deck.length;
  choose(g, 'Attack: Mountain Breaker');
  assert.equal(g.state.p[1].deck.length, before - 1 - 1, 'one discarded (and one drawn for its turn)');
  assert.equal(g.state.p[1].discard.length, 1);
  assert.equal(g.state.p[1].active!.damage, 10);
});

// ------------------------------------------------------------------ Cresselia

test('Cresselia, Healing Pirouette: heal 20 damage from each of your Pokémon', () => {
  const dk = deck('Cresselia', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Cresselia', bench: ['Dreepy', 'Dreepy'], energy: { active: [PSY] }, damage: { active: 30, 0: 10, 1: 50 } }, { active: 'Dreepy', damage: { active: 20 } }], { turn: 3, current: 0, first: 0 });
  choose(g, 'Attack: Healing Pirouette');
  assert.equal(g.state.p[0].active!.damage, 10);
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [0, 30]);
  assert.equal(g.state.p[1].active!.damage, 20, "not your opponent's Pokémon");
});

test('Cresselia, Crescent Purge: 80 damage; you may turn 1 of your face-down Prize cards face up for 80 more; it stays face up', () => {
  const dk = deck('Cresselia', 'Hydreigon ex');
  const mk = (prizes = 6): Game =>
    scenario(dk, dk, [{ active: 'Cresselia', energy: { active: [PSY, PSY, PSY] }, prizes }, { active: 'Hydreigon ex' }], { turn: 3, current: 0, first: 0 });
  const yes = mk();
  choose(yes, 'Attack: Crescent Purge');
  choose(yes, 'Yes');
  assert.equal(yes.state.p[1].active!.damage, 160);
  assert.equal(yes.state.p[0].prizesUp!.length, 1);
  assert.ok(yes.state.p[0].prizes.includes(yes.state.p[0].prizesUp![0]!), 'it stays one of the Prize cards');
  const no = mk();
  choose(no, 'Attack: Crescent Purge');
  choose(no, 'No');
  assert.equal(no.state.p[1].active!.damage, 80);
  assert.equal(no.state.p[0].prizesUp, undefined);
  // Each use turns another card; with none face down the extra damage is not done.
  const last = mk(1);
  last.state.p[0].prizesUp = [last.state.p[0].prizes[0]!];
  choose(last, 'Attack: Crescent Purge');
  choose(last, 'Yes');
  assert.equal(last.state.p[1].active!.damage, 80, 'no face-down Prize card to turn: not done');
  const second = mk();
  second.state.p[0].prizesUp = [second.state.p[0].prizes[0]!];
  choose(second, 'Attack: Crescent Purge');
  choose(second, 'Yes');
  assert.equal(second.state.p[0].prizesUp!.length, 2);
  assert.equal(second.state.p[1].active!.damage, 160);
});

// ------------------------------------------------------------------ Team Rocket's Bother-Bot

test("Team Rocket's Bother-Bot: turn 1 of your opponent's face-down Prize cards face up, a random card from their hand is revealed, and you may have them switch those cards (ruling 2167)", () => {
  const dk = deck("Team Rocket's Bother-Bot", 'Dreepy', 'Chikorita');
  const mk = (oppHand: string[], oppPrizes = 6): Game =>
    scenario(dk, dk, [{ active: 'Dreepy', hand: ["Team Rocket's Bother-Bot"] }, { active: 'Dreepy', hand: oppHand, prizes: oppPrizes }], { turn: 3, current: 0, first: 0 });
  const o = (g: Game) => g.state.p[1];
  // No: the Prize card is face up and the hand card revealed; nothing moves.
  const no = mk(['Chikorita', 'Chikorita']);
  const prizesBefore = o(no).prizes.slice();
  const handBefore = o(no).hand.slice();
  choose(no, "Play Team Rocket's Bother-Bot");
  assert.equal(o(no).prizesUp!.length, 1);
  assert.deepEqual(o(no).prizes, prizesBefore);
  assert.equal(o(no).revealed.length, 1, 'the card chosen from the hand was revealed');
  assert.ok(handBefore.includes(o(no).revealed[0]!));
  assert.ok(has(no, 'Yes'), 'asked whether to switch');
  choose(no, 'No');
  assert.deepEqual(o(no).hand, handBefore);
  assert.deepEqual(o(no).prizes, prizesBefore);
  // Yes: the two change places; the Prize position stays face up.
  const yes = mk(['Chikorita', 'Chikorita']);
  const handCard = yes.state.p[1].hand.slice();
  const prize = yes.state.p[1].prizes.slice();
  choose(yes, "Play Team Rocket's Bother-Bot");
  const up = o(yes).prizesUp![0]!;
  const revealed = o(yes).revealed[0]!;
  choose(yes, 'Yes');
  assert.ok(prize.includes(up) && handCard.includes(revealed));
  assert.ok(o(yes).hand.includes(up), 'the former Prize card is in their hand');
  assert.ok(o(yes).prizes.includes(revealed), 'the hand card is a Prize card now');
  assert.deepEqual(o(yes).prizesUp, [revealed], 'the Prize position stays face up');
  assert.equal(o(yes).prizes.length, 6);
  assert.equal(o(yes).hand.length, 2);
  // Ruling 2167: no cards in the hand -- you still turn the Prize card up, no switch.
  const empty = mk([]);
  choose(empty, "Play Team Rocket's Bother-Bot");
  assert.equal(o(empty).prizesUp!.length, 1);
  assert.equal(empty.decision!.kind, 'main', 'no question to answer');
  // ...no face-down Prize cards: you look at a card, no switch.
  const noPrizes = mk(['Chikorita'], 0);
  choose(noPrizes, "Play Team Rocket's Bother-Bot");
  assert.equal(o(noPrizes).revealed.length, 1);
  assert.equal(noPrizes.decision!.kind, 'main');
  // ...and with neither, the card can't be played.
  const neither = mk([], 0);
  assert.ok(!legalActions(neither.env, neither.state, 0).some((a) => a.t === 'trainer'));
  // All Prize cards already face up counts as having no face-down ones.
  const allUp = mk([], 2);
  allUp.state.p[1].prizesUp = allUp.state.p[1].prizes.slice();
  refresh(allUp);
  assert.ok(!legalActions(allUp.env, allUp.state, 0).some((a) => a.t === 'trainer'));
});

// ------------------------------------------------------------------ Koraidon

test('Koraidon, Unrelenting Onslaught: 30 damage, 150 more if 1 of your other Ancient Pokémon used an attack during your last turn (rulings 2060, 2087, 2092)', () => {
  const dk = deck('Koraidon', 'Great Tusk', 'Roaring Moon', 'Dreepy', 'Switch', 'Hydreigon ex');
  // Turn 3: `first` attacks with the Active Pokémon. Turn 5: the Koraidon on the Bench is switched in and attacks.
  const mk = (activeName: string, o: { cond?: number; coin?: boolean } = {}): Game => {
    const g = scenario(
      dk,
      dk,
      [
        { active: activeName, bench: ['Koraidon', 'Dreepy'], energy: { active: activeName === 'Roaring Moon' ? [DAR, DAR, DAR] : activeName === 'Dreepy' ? [FIR, PSY] : [FIG, FIG, FIG], 0: [FIG, FIG] }, hand: ['Switch'], cond: o.cond },
        { active: 'Hydreigon ex' },
      ],
      { turn: 3, current: 0, first: 0 },
    );
    g.state.forcedCoins = o.coin === undefined ? [] : [o.coin];
    const atk = activeName === 'Great Tusk' ? 'Lunge Out' : activeName === 'Roaring Moon' ? 'Vengeance Fletching' : activeName === 'Koraidon' ? 'Hammer In' : 'Bite';
    choose(g, `Attack: ${atk}`);
    endTurn(g);
    assert.equal(g.state.turn, 5);
    g.state.p[1].active!.damage = 0;
    return g;
  };
  const onslaught = (g: Game): number => {
    const k = g.state.p[0].bench.find((b) => nameOf(g, b.cards.at(-1)!) === 'Koraidon') ?? g.state.p[0].active!;
    if (g.state.p[0].active !== k) {
      choose(g, 'Play Switch');
      pickSlot(g, k.id);
    }
    choose(g, 'Attack: Unrelenting Onslaught');
    return g.state.p[1].active!.damage;
  };
  assert.equal(onslaught(mk('Great Tusk')), 180, 'an Ancient Pokémon attacked in my last turn');
  assert.equal(onslaught(mk('Roaring Moon')), 180);
  assert.equal(onslaught(mk('Dreepy')), 30, 'Dreepy is not an Ancient Pokémon');
  // Ruling 2060: a different Koraidon counts.
  const other = mk('Koraidon');
  other.state.p[0].bench.find((b) => nameOf(other, b.cards.at(-1)!) === 'Koraidon')!;
  assert.equal(onslaught(other), 180, 'a different Koraidon attacked: "Yes."');
  // It is "other": a Koraidon that attacked itself does not count for itself (it used the attack last turn, and is the same Pokémon).
  const self = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [FIG, FIG, FIG] } }, { active: 'Hydreigon ex' }], { turn: 3, current: 0, first: 0 });
  choose(self, 'Attack: Hammer In');
  endTurn(self);
  self.state.p[1].active!.damage = 0;
  choose(self, 'Attack: Unrelenting Onslaught');
  assert.equal(self.state.p[1].active!.damage, 30, 'only itself');
  // Ruling 2087: a failed attack while Confused doesn't count.
  const confused = mk('Great Tusk', { cond: CONFUSED, coin: false });
  assert.equal(onslaught(confused), 30, 'tails: no attack was used');
  const lucky = mk('Great Tusk', { cond: CONFUSED, coin: true });
  assert.equal(onslaught(lucky), 180, 'heads: it attacked');
  // Ruling 2092: Thorton puts a Koraidon in the place of the Ancient Pokémon that attacked; the game sees the same Pokémon.
  const swap = mk('Great Tusk');
  const place = swap.state.p[0].active!;
  const koraidon = swap.state.p[0].bench.find((b) => nameOf(swap, b.cards.at(-1)!) === 'Koraidon')!;
  // (what Thorton does: the cards change places, the Pokémon stays the same)
  const cards = place.cards;
  place.cards = koraidon.cards;
  koraidon.cards = cards;
  refresh(swap);
  choose(swap, 'Attack: Unrelenting Onslaught');
  assert.equal(swap.state.p[1].active!.damage, 30, 'it is the Pokémon that attacked: no bonus');
});

test('Koraidon, Hammer In: 110 damage', () => {
  const dk = deck('Koraidon', 'Hydreigon ex');
  const g = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [FIG, FIG, FIG] } }, { active: 'Hydreigon ex' }], { turn: 3, current: 0, first: 0 });
  choose(g, 'Attack: Hammer In');
  assert.equal(g.state.p[1].active!.damage, 110);
});

// Unused helpers kept for the position builders above.
void [GRA, WAT, LIG, rep, findSlot, evalCond];
