/**
 * Rulings audit, lane 08: official rulings (Pokémon Rulings Compendium) pinned against the simulator, one scenario test each.
 * Every test cites the ruling as https://compendium.pokegym.net/ruling/<id>/ with a one-line summary in our own words (the
 * ruling text itself stays on the Compendium). Rulings that no scenario can express are listed in REVIEWED with the reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { CardScript, Program } from '../dsl.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { effectsPrevented } from '../query.js';
import { scenario } from '../scenario.js';
import { topCard } from '../state.js';
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
/** Pick options of a multi-select by card name (each name once, in order). */
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
/** Answer a slot decision with the Pokémon whose slot id this is. */
function pickSlot(g: Game, id: number): void {
  const i = (g.decision!.values as number[]).indexOf(id);
  assert.ok(i >= 0, `slot ${id} is not offered: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const benchNames = (g: Game, p: 0 | 1): string[] => g.state.p[p].bench.map((b) => nameOf(g, topCard(b)));
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);
/** Put the Stadium card (by name) from this player's deck into play, as if that player had played it. */
function stadium(g: Game, name: string, owner: 0 | 1 = 0): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in P${owner + 1}'s deck`);
  g.state.stadium = { card: dk.splice(i, 1)[0] as number, owner };
  refresh(g);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  "Cynthia's Gible": 'sv10-102',
  "Cynthia's Roselia": 'sv10-007',
  "Cynthia's Roserade": 'sv10-008',
  Piplup: 'me02-027',
  'Empoleon ex': 'me02-070',
  'Risky Ruins': 'me01-127',
  Dreepy: 'sv06-128', // Dragon, 70 HP, no Weakness
  Chikorita: 'me01-008', // Grass, 70 HP, Fire-weak
  'Buddy-Buddy Poffin': 'sv05-144',
  Pawmot: 'me02-034',
  Slowpoke: 'me05-029',
  'Dragapult ex': 'sv06-130', // 320 HP, no Weakness
  "Acerola's Mischief": 'me01-113',
  'Pikachu ex': 'sv08.5-028', // Tera, 190 HP
  "N's Darumaka": 'me02.5-032', // Fire; Rolling Tackle {C}{C} 20
  "N's Darmanitan": 'me02.5-033',
  "Team Rocket's Wobbuffet": 'sv10-082',
  "Team Rocket's Articuno": 'sv10-051',
  "Team Rocket's Larvitar": 'sv10-094',
  'Area Zero Underdepths': 'sv07-131',
  'Gravity Mountain': 'sv08-177',
  "Hero's Cape": 'sv05-152',
  Koraidon: 'sv08-116',
  'Great Tusk': 'sv05-096',
  'Hydreigon ex': 'sv10.5w-067',
  Switch: 'me01-130',
  'Festival Grounds': 'sv06-149',
  Dipplin: 'sv06-018',
  Goldeen: 'sv06-044',
  'Technical Machine: Fluorite': 'sv08-188',
  'Energy Recycler': 'me03-108',
  'Legacy Energy': 'sv06-167',
};
/** A test deck of the named cards (10 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('r08', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 10]), ...ENERGY]);
}
const GRA = 'Grass Energy';
const FIR = 'Fire Energy';
const WAT = 'Water Energy';
const LIG = 'Lightning Energy';
const PSY = 'Psychic Energy';
const FIG = 'Fighting Energy';
const MET = 'Metal Energy';

/** Stand-ins for the attacks of the opposing Pokémon in the Area Zero and Mischief tests: Fire (N's Darumaka) and Lightning (Pikachu ex). */
const pikachu = (program: Program): CardScript[] => [{ id: 'sv08.5-028', name: 'Pikachu ex', attacks: { 'Tail Whap': { program } } }];
const dealBench = (n: number): Program => [{ op: 'damage', amount: n, to: { each: 'oppBench' } }];

// ------------------------------------------------------------------ Cynthia's Roserade / Empoleon ex

// https://compendium.pokegym.net/ruling/2333/ -- Cheer On to Glory's extra damage is damage, not an effect, so Empoleon ex's Emperor's Stance doesn't block it.
test("Ruling 2333: Cynthia's Roserade's +30 still lands on Empoleon ex, whose Emperor's Stance blocks only effects of attacks", () => {
  const dk = deck("Cynthia's Gible", "Cynthia's Roselia", "Cynthia's Roserade", 'Piplup', 'Empoleon ex');
  const mk = (withRoserade: boolean): Game =>
    scenario(dk, dk, [
      {
        active: "Cynthia's Gible",
        energy: { active: [FIG] },
        ...(withRoserade ? { bench: ["Cynthia's Roselia"], evolve: { 0: ["Cynthia's Roserade"] } } : {}),
      },
      { active: 'Piplup', evolve: { active: ['Empoleon ex'] } },
    ]);
  const base = mk(false);
  choose(base, 'Attack: Rock Hurl');
  const plain = dmg(base, 1);
  assert.ok(plain > 0, 'Rock Hurl does damage to Empoleon ex');
  const g = mk(true);
  const target = g.state.p[1].active!;
  assert.ok(effectsPrevented(g.envForInternals, g.state, target, 0, 'attack'), "Emperor's Stance is in force");
  choose(g, 'Attack: Rock Hurl');
  assert.equal(dmg(g, 1), plain + 30, "the Roserade's 30 more damage is dealt despite Emperor's Stance");
});

// ------------------------------------------------------------------ Risky Ruins

// https://compendium.pokegym.net/ruling/2329/ -- retreating a Basic Pokémon to the Bench moves it, it isn't "put onto the Bench", so Risky Ruins adds no counters.
test('Ruling 2329: a Basic Pokémon that retreats to the Bench takes no counters from Risky Ruins', () => {
  const dk = deck('Risky Ruins', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Dreepy'], energy: { active: [PSY, PSY] } }, { active: 'Dreepy' }]);
  stadium(g, 'Risky Ruins', 1);
  const retreater = g.state.p[0].active!;
  choose(g, 'Retreat');
  g.submit([0]); // the Energy to discard
  if (g.decision?.kind === 'slots') pickSlot(g, g.state.p[0].bench[0]!.id);
  assert.notEqual(g.state.p[0].active, retreater, 'the Dreepy retreated');
  assert.equal(retreater.damage, 0, 'moving to the Bench is not putting it there: no counters');
  assert.equal(g.state.p[0].bench.find((b) => b === retreater) !== undefined, true);
  assert.equal(g.state.p[0].active!.damage, 0);
});

// https://compendium.pokegym.net/ruling/2233/ -- Risky Ruins counts a Basic put onto the Bench by any means, so Buddy-Buddy Poffin's Pokémon get 2 counters each.
test('Ruling 2233: Basic Pokémon fetched to the Bench by Buddy-Buddy Poffin each get 2 damage counters under Risky Ruins', () => {
  const dk = deck('Risky Ruins', 'Dreepy', 'Chikorita', 'Buddy-Buddy Poffin');
  const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Buddy-Buddy Poffin'] }, { active: 'Dreepy' }]);
  stadium(g, 'Risky Ruins', 1);
  choose(g, 'Play Buddy-Buddy Poffin');
  pick(g, ['Chikorita', 'Dreepy']);
  assert.deepEqual(benchNames(g, 0).sort(), ['Chikorita', 'Dreepy']);
  assert.deepEqual(g.state.p[0].bench.map((b) => b.damage), [20, 20]);
});

// ------------------------------------------------------------------ Pawmot

// https://compendium.pokegym.net/ruling/2256/ -- Pawmot may choose the 60 self-damage even if that Knocks it Out; the Defending Pokémon is still damaged and Paralyzed first.
test('Ruling 2256: Pawmot with 100 damage may take the 60 from Voltaic Fist, still damaging and Paralyzing the Defending Pokémon, and is then Knocked Out', () => {
  const dk = deck('Pawmot', 'Dragapult ex', 'Slowpoke');
  const g = scenario(dk, dk, [{ active: 'Pawmot', bench: ['Slowpoke'], energy: { active: [LIG, LIG] }, damage: { active: 100 } }, { active: 'Dragapult ex' }]);
  choose(g, 'Attack: Voltaic Fist');
  yes(g);
  assert.equal(dmg(g, 1), 130, 'the Defending Pokémon was still damaged');
  assert.ok(g.state.p[1].active!.cond & PARALYZED, 'and Paralyzed');
  assert.ok(names(g, g.state.p[0].discard).includes('Pawmot'), '100 + 60 on 140 HP: Pawmot is Knocked Out afterwards');
  assert.equal(g.state.p[1].prizesTaken, 1, 'the opponent took a Prize card for it');
});

// ------------------------------------------------------------------ Acerola's Mischief

// https://compendium.pokegym.net/ruling/2228/ -- Acerola's Mischief isn't an attack effect, so moving the protected Pokémon to the Bench doesn't end its protection.
test("Ruling 2228: Acerola's Mischief keeps protecting a Pokémon that retreats to the Bench", () => {
  const dk = deck("Acerola's Mischief", 'Pikachu ex', 'Dreepy', 'Chikorita');
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Dreepy', bench: ['Chikorita', 'Chikorita'], energy: { active: [PSY, PSY] }, hand: ["Acerola's Mischief"] },
      { active: 'Pikachu ex', energy: { active: [LIG] }, prizes: 2 },
    ],
    { scripts: pikachu(dealBench(30)) },
  );
  const dreepy = g.state.p[0].active!;
  choose(g, "Play Acerola's Mischief");
  pickSlot(g, dreepy.id);
  choose(g, 'Retreat');
  g.submit([0]); // the Energy to discard
  pickSlot(g, g.state.p[0].bench[0]!.id);
  assert.notEqual(g.state.p[0].active, dreepy);
  choose(g, 'End turn');
  choose(g, 'Attack: Tail Whap');
  assert.equal(dreepy.damage, 0, 'the Benched Dreepy is still protected from the Pokémon ex');
  assert.equal(g.state.p[0].bench.filter((b) => b !== dreepy).map((b) => b.damage).join(), '30', 'the other Benched Pokémon took the 30');
});

// ------------------------------------------------------------------ Area Zero Underdepths

// https://compendium.pokegym.net/ruling/2132/ -- when the only Tera Pokémon is picked up from the Active Spot, the Bench is cut to 5 before a new Active Pokémon is chosen.
// (Professor Turo's Scenario is not in the card snapshot: a Tool that returns its holder to the hand stands in for it.)
test('Ruling 2132: a Tera Pokémon returned to the hand from the Active Spot: discard down to 5 first, then choose the new Active Pokémon', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Area Zero Underdepths', "Hero's Cape");
  const pickUp: CardScript = { id: 'sv05-152', name: "Hero's Cape", triggers: [{ on: 'endOfTurn', program: [{ op: 'custom', fn: 'returnSelfToHand' }] }] };
  const g = scenario(dk, dk, [{ active: 'Pikachu ex', bench: rep('Dreepy', 8), tools: { active: ["Hero's Cape"] } }, { active: 'Dreepy' }], { scripts: [pickUp] });
  stadium(g, 'Area Zero Underdepths', 1);
  choose(g, 'End turn');
  assert.equal(g.state.p[0].active, null, 'the Tera Pokémon is in the hand');
  assert.equal(g.decision!.kind, 'slots', 'the discard comes before the new Active Pokémon is chosen');
  assert.equal(g.decision!.min, 3, '8 on the Bench, 5 allowed');
  g.submit([0, 1, 2]);
  assert.equal(g.decision!.kind, 'promote');
  assert.equal(g.state.p[0].bench.length, 5);
});

// https://compendium.pokegym.net/ruling/2131/ -- when the only Tera Pokémon is Knocked Out in the Active Spot, the Bench is cut to 5 before a new Active Pokémon is chosen.
test('Ruling 2131: a Knocked Out Active Tera Pokémon: discard down to 5 first, then choose the new Active Pokémon', () => {
  const dk = deck('Pikachu ex', 'Dreepy', "N's Darumaka", 'Area Zero Underdepths');
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Pikachu ex', bench: rep('Dreepy', 8), damage: { active: 180 } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4 },
  );
  stadium(g, 'Area Zero Underdepths', 0);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[1].prizes.length, 4, 'the Tera Pokémon ex was Knocked Out: 2 Prize cards');
  assert.equal(g.state.p[0].active, null);
  assert.equal(g.decision!.kind, 'slots', 'the Bench is cut down first...');
  assert.equal(g.decision!.min, 3);
  g.submit([0, 1, 2]);
  assert.equal(g.decision!.kind, 'promote', '...then the new Active Pokémon is chosen');
  assert.equal(g.state.p[0].bench.length, 5);
});

// https://compendium.pokegym.net/ruling/2039/ -- one Stadium replacing another at once: if the new one still allows the Bench, nobody discards.
// (Sky Field is not in the card snapshot: Gravity Mountain, re-scripted with the same 8-Pokémon Bench effect, stands in for it.)
test('Ruling 2039: a Stadium that replaces Area Zero Underdepths with the same Bench size makes nobody discard', () => {
  const dk = deck('Pikachu ex', 'Dreepy', 'Area Zero Underdepths', 'Gravity Mountain');
  const skyField: CardScript = { id: 'sv08-177', name: 'Gravity Mountain', statics: [{ effect: { k: 'benchSize', size: 8 }, scope: 'both' }] };
  const g = scenario(dk, dk, [{ active: 'Pikachu ex', bench: rep('Dreepy', 8), hand: ['Gravity Mountain'] }, { active: 'Dreepy' }], { scripts: [skyField] });
  stadium(g, 'Area Zero Underdepths', 1);
  choose(g, 'Play Gravity Mountain');
  assert.equal(g.decision!.kind, 'main', 'no discard: one Stadium replaced the other');
  assert.equal(g.state.p[0].bench.length, 8);
});

// https://compendium.pokegym.net/ruling/2026/ -- the Active Tera Pokémon and Benched Pokémon Knocked Out together: Knock Outs and Prizes first, then discard to 5, then the new Active.
test('Ruling 2026: Knock Outs and Prize cards come first, then one more Benched Pokémon is discarded, then the new Active Pokémon is chosen', () => {
  const dk = deck('Pikachu ex', 'Dreepy', "N's Darumaka", 'Area Zero Underdepths');
  // 20 to the Defending Pokémon and 20 to each Benched Pokémon.
  const sweep: CardScript = {
    id: 'me02.5-032',
    name: "N's Darumaka",
    attacks: { 'Rolling Tackle': { program: [{ op: 'damage', amount: 20, to: 'defender' }, { op: 'damage', amount: 20, to: { each: 'oppBench' } }] } },
  };
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Pikachu ex', bench: rep('Dreepy', 8), damage: { active: 180, 0: 60, 1: 60 } },
      { active: "N's Darumaka", energy: { active: [FIR, FIR] } },
    ],
    { current: 1, turn: 4, scripts: [sweep] },
  );
  stadium(g, 'Area Zero Underdepths', 0);
  choose(g, 'Attack: Rolling Tackle');
  assert.equal(g.state.p[1].prizes.length, 6 - 2 - 1 - 1, 'the Tera Pokémon (2) and the two Benched Pokémon (1 each) were Knocked Out and their Prize cards taken');
  assert.equal(g.state.p[0].bench.length, 6);
  assert.equal(g.decision!.kind, 'slots', 'then one more is discarded...');
  assert.equal(g.decision!.min, 1);
  assert.equal(g.state.p[0].active, null);
  g.submit([0]);
  assert.equal(g.decision!.kind, 'promote', '...and then a new Active Pokémon is chosen');
  assert.equal(g.state.p[0].bench.length, 5);
});

// ------------------------------------------------------------------ N's Darmanitan

// https://compendium.pokegym.net/ruling/2117/ -- Flamebody Cannon discards all Energy even when the opponent has no Benched Pokémon to hit.
test("Ruling 2117: N's Darmanitan's Flamebody Cannon still discards all its Energy when the opponent has no Benched Pokémon", () => {
  const dk = deck("N's Darumaka", "N's Darmanitan", 'Dragapult ex');
  const g = scenario(dk, dk, [{ active: "N's Darumaka", evolve: { active: ["N's Darmanitan"] }, energy: { active: [FIR, FIR, FIR, WAT] } }, { active: 'Dragapult ex' }]);
  assert.equal(g.state.p[1].bench.length, 0);
  choose(g, 'Attack: Flamebody Cannon');
  assert.equal(dmg(g, 1), 90, 'the Defending Pokémon took the 90');
  assert.equal(g.state.p[0].active!.energy.length, 0, 'all the Energy was discarded');
});

// ------------------------------------------------------------------ Koraidon

/** Turn 3: P0's Active Pokémon attacks. Turn 5: a Koraidon is the one to attack (switched in if it was on the Bench). */
function koraidonTurn5(activeName: string, o: { cond?: number; coin?: boolean } = {}): Game {
  const dk = deck('Koraidon', 'Great Tusk', 'Dreepy', 'Switch', 'Hydreigon ex');
  const g = scenario(
    dk,
    dk,
    [
      { active: activeName, bench: ['Koraidon', 'Dreepy'], energy: { active: activeName === 'Dreepy' ? [FIR, PSY] : [FIG, FIG, FIG], 0: [FIG, FIG] }, hand: ['Switch'], cond: o.cond },
      { active: 'Hydreigon ex' },
    ],
    { turn: 3, current: 0, first: 0 },
  );
  g.state.forcedCoins = o.coin === undefined ? [] : [o.coin];
  choose(g, activeName === 'Great Tusk' ? 'Attack: Lunge Out' : activeName === 'Dreepy' ? 'Attack: Bite' : 'Attack: Hammer In');
  choose(g, 'End turn');
  assert.equal(g.state.turn, 5);
  g.state.p[1].active!.damage = 0;
  return g;
}
/** The damage Unrelenting Onslaught does from the Koraidon on the Bench (or the Active one). */
function onslaught(g: Game): number {
  const k = g.state.p[0].bench.find((b) => nameOf(g, topCard(b)) === 'Koraidon') ?? g.state.p[0].active!;
  if (g.state.p[0].active !== k) {
    choose(g, 'Play Switch');
    pickSlot(g, k.id);
  }
  choose(g, 'Attack: Unrelenting Onslaught');
  return dmg(g, 1);
}

// https://compendium.pokegym.net/ruling/2060/ -- a different Koraidon that attacked last turn counts as "another Ancient Pokémon" for Unrelenting Onslaught.
test("Ruling 2060: Koraidon's Unrelenting Onslaught gets its 150 bonus when a different Koraidon attacked during the last turn", () => {
  // The Active Koraidon attacked (Hammer In 110); the Koraidon on the Bench is switched in.
  assert.equal(onslaught(koraidonTurn5('Koraidon')), 30 + 150);
  // Control: with no Ancient Pokémon having attacked (Dreepy is not Ancient), no bonus.
  assert.equal(onslaught(koraidonTurn5('Dreepy')), 30);
});

// https://compendium.pokegym.net/ruling/2087/ -- a Confused Pokémon that flips tails didn't attack, so it doesn't turn on Unrelenting Onslaught's bonus.
test("Ruling 2087: an Ancient Pokémon's failed (tails) Confused attack doesn't count for Koraidon's Unrelenting Onslaught", () => {
  assert.equal(onslaught(koraidonTurn5('Great Tusk', { cond: CONFUSED, coin: false })), 30, 'tails: no attack was used');
  assert.equal(onslaught(koraidonTurn5('Great Tusk', { cond: CONFUSED, coin: true })), 30 + 150, 'heads: it attacked');
});

// https://compendium.pokegym.net/ruling/2092/ -- a Koraidon swapped into the place of the Ancient Pokémon that attacked (Thorton) is the same Pokémon, so it gets no bonus.
// (Thorton is not in the card snapshot: the cards under the two slots are exchanged by hand, which is what the Supporter does.)
test('Ruling 2092: a Koraidon put in the place of the Pokémon that attacked last turn is that same Pokémon: no Unrelenting Onslaught bonus', () => {
  const g = koraidonTurn5('Great Tusk');
  const place = g.state.p[0].active!;
  const koraidon = g.state.p[0].bench.find((b) => nameOf(g, topCard(b)) === 'Koraidon')!;
  const cards = place.cards;
  place.cards = koraidon.cards;
  koraidon.cards = cards;
  refresh(g);
  choose(g, 'Attack: Unrelenting Onslaught');
  assert.equal(dmg(g, 1), 30, 'it is the Pokémon that attacked: no bonus');
});

// ------------------------------------------------------------------ Festival Lead and Technical Machines

function festival(active: string, tm: boolean): Game {
  const dk = deck(active, 'Dreepy', 'Festival Grounds', 'Technical Machine: Fluorite');
  const g = scenario(dk, dk, [
    { active, energy: { active: [GRA, WAT, PSY] }, ...(tm ? { tools: { active: ['Technical Machine: Fluorite'] } } : {}) },
    { active: 'Dreepy', energy: { active: [FIR, FIR] } },
  ]);
  stadium(g, 'Festival Grounds', 1);
  g.state.forcedCoins = [true, false];
  refresh(g);
  return g;
}

// https://compendium.pokegym.net/ruling/1974/ -- Festival Lead can't be used with a Technical Machine's attack: after a printed attack, the TM attack isn't a second attack.
test("Ruling 1974: after Goldeen's printed attack, Festival Lead does not offer the Technical Machine's attack as the second one", () => {
  const t = festival('Goldeen', true);
  assert.ok(has(t, 'Attack: Fluorite'), "the Technical Machine's attack is there for the first attack");
  choose(t, 'Attack: Whirlpool');
  t.submit([0]); // heads: which Energy to discard
  assert.deepEqual(labels(t), ['Attack: Whirlpool', 'End turn'], 'but not for the second attack');
});

// https://compendium.pokegym.net/ruling/1973/ -- a Pokémon with a Technical Machine can't attack twice with Festival Lead: the TM's attack as the first attack ends the turn.
test('Ruling 1973: attacking with the Technical Machine first leaves no second attack from Festival Lead', () => {
  const u = festival('Dipplin', true);
  choose(u, 'Attack: Fluorite');
  assert.equal(u.state.current, 1, 'the Technical Machine attack was the only attack: the turn is over');
  // Control: with a printed attack first, Dipplin does get its second attack.
  const c = festival('Dipplin', false);
  choose(c, 'Attack: Do the Wave');
  assert.equal(c.state.current, 0);
  assert.ok(has(c, 'Attack: Do the Wave'));
});

// ------------------------------------------------------------------ Energy Recycler

// https://compendium.pokegym.net/ruling/1504/ -- Energy Recycler's wording: shuffle up to 5 Basic Energy cards from the discard pile into the deck (Basic only, at most 5).
test('Ruling 1504: Energy Recycler shuffles up to 5 Basic Energy cards (never a Special Energy) from the discard pile into the deck', () => {
  const dk = deck('Energy Recycler', 'Legacy Energy', 'Dreepy');
  const g = scenario(dk, dk, [{ active: 'Dreepy', hand: ['Energy Recycler'], discard: [MET, MET, MET, MET, MET, MET, 'Legacy Energy'] }, { active: 'Dreepy' }]);
  const deckSize = g.state.p[0].deck.length;
  choose(g, 'Play Energy Recycler');
  assert.equal(g.decision!.max, 5, 'at most 5');
  assert.ok(!labels(g).some((l) => l.includes('Legacy')), 'a Special Energy is not offered');
  assert.equal((g.decision!.values as number[]).length, 6, 'the six Basic Energy cards are the options');
  g.submit([0, 1, 2, 3, 4]);
  assert.equal(g.state.p[0].deck.length, deckSize + 5);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Energy Recycler', 'Legacy Energy', MET].sort());
});

// ------------------------------------------------------------------ Reviewed, not testable

const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #2011',
    why: 'unscripted card: the case is Technical Machine: Crisis Punch, whose attack cost is what Food Prep lowers; that Tool has no frame or script in the simulator. The one scripted Technical Machine (Fluorite) costs {G}{W}{P}, with no {C} for Food Prep to remove, so no scenario could fail.',
  },
  {
    ruling: 'Compendium #1964',
    why: 'outside the game: card legality across printings. The ruling separates the Black & White Plasma Blast printing of Master Ball (the ACE SPEC version, which is playable) from earlier non-ACE SPEC versions (which are not, as only an ACE SPEC Master Ball is Standard-legal); the simulator has no format legality and nothing in the rules engine decides which printings may be played, and only the scripted Standard Master Ball exists.',
  },
  {
    ruling: 'Compendium #717',
    why: "different text: it is the 2007 errata to Electivire's Discharge (count Energy cards, not Energy). Galvantula's printed Discharge already says \"for each card you discarded\" and is scripted as a count of cards; no scripted Energy card provides two {L}, so cards and Energy units can't differ.",
  },
  {
    ruling: 'Compendium #448',
    why: "different text: it is about the 2012 Manectric, whose Flash Impact hit any of your Pokémon. The scripted Manectric (sv10-076) says \"1 of your Benched Pokémon\", so hitting itself is not allowed by the printed text.",
  },
  {
    ruling: 'Compendium #232',
    why: "different text: Sigilyph's Safeguard stops all effects of attacks by Pokémon-EX (the energies are discarded instead of attached). The scripted Sylveon's Safeguard only prevents damage from Pokémon ex, so it has no effect on attaching Energy; Sigilyph and Victini-EX have no frames in the simulator.",
  },
  {
    ruling: 'Compendium #231',
    why: "different text: the ruling is about an attacking Pokémon-EX that switches itself with a benched Sigilyph; the attacker is the target of the switch effect, so Sigilyph's Safeguard (which blocks effects of Pokémon-EX attacks on the Pokémon it protects) does not stop it. The scripted Sylveon's Safeguard only prevents damage, so no scripted Ability could block a switch effect either way and no scenario could differ; Sigilyph and the -EX attackers have no frames in the simulator.",
  },
];

test('Reviewed rulings: every id listed in REVIEWED is in the Compendium index', () => {
  const file = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number }[] } | { id: number }[];
  const ids = new Set((Array.isArray(file) ? file : file.rulings).map((r) => r.id));
  for (const r of REVIEWED) {
    const id = Number(r.ruling.replace('Compendium #', ''));
    assert.ok(ids.has(id), `${r.ruling} is not in data/rulings-compendium.json`);
    assert.ok(r.why.length > 40, `${r.ruling} needs a reason`);
  }
});

