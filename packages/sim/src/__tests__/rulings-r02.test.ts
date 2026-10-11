/**
 * Rulings audit, lane 02: one scenario test per Compendium ruling the lane pins (the one-line summaries are ours, not the Rules Team's
 * wording), plus a table of rulings that no simulator position can pin, with the reason.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { POISONED } from '../types.js';
import { fromIds } from './decks.js';

/**
 * Rulings in this lane that no simulator position can pin, with the reason (read one by one at review).
 */
const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #908',
    why: "outside the game: which of two opposing Active Pokémon a 'your' effect applies to in the 2-vs-2 Team Play format; the simulator plays two-player games only, so there is no second opponent to choose between.",
  },
  {
    ruling: 'Compendium #907',
    why: "outside the game: Team Play (2-vs-2) question of which opponent a 'during your opponent's next turn' effect names; the simulator has one opponent, so it cannot arise.",
  },
  {
    ruling: 'Compendium #754',
    why: "different text: it corrects a misprinted attack cost on a Plasma Storm-era Scorching Fire; the scripted Infernape, Reshiram ex and Team Rocket's Houndoom are other cards whose frames have their own correct costs, so no scripted card carries the misprint.",
  },
  {
    ruling: 'Compendium #209',
    why: "different text: it counts Team Magma / Team Aqua Pokémon on both sides of the field for Power Saver on the EX cards of that era; Team Rocket's Mewtwo ex says you need 4 or more Team Rocket's Pokémon in play that you have, so it counts only your own side with a different number.",
  },
];

const labels = (g: Game): string[] => describeOptions(g.ctx, g.state, g.decision as Decision);
const has = (g: Game, text: string): boolean => labels(g).some((l) => l.includes(text));
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
/** Pick options of a multi-select by label text (each option once, in order). */
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
const nameOf = (g: Game, iid: number): string => def(g.ctx, iid).name;
const handNames = (g: Game, p: 0 | 1): string[] => g.state.p[p].hand.map((c) => nameOf(g, c)).sort();
const activeName = (g: Game, p: 0 | 1): string => nameOf(g, topCard(g.state.p[p].active!));
const energyNames = (g: Game, p: 0 | 1): string[] => g.state.p[p].active!.energy.map((c) => nameOf(g, c)).sort();
const rep = (name: string, n: number): string[] => Array.from({ length: n }, () => name);

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: ten of each listed card (or the count given) plus plenty of every Basic Energy. */
function deck(ids: string[], counts: Record<string, number> = {}): DeckInput {
  return fromIds('r02', [...[...new Set(ids)].map((id): [string, number] => [id, counts[id] ?? 10]), ...ENERGY]);
}
/** Put a Stadium from this player's deck into play, as if that player had played it. */
function stadium(g: Game, nm: string, owner: 0 | 1 = 0): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === nm);
  assert.ok(i >= 0, `no ${nm} in the deck`);
  g.state.stadium = { card: dk.splice(i, 1)[0] as number, owner };
  g.state.pending = null;
  advance(g.env, g.state);
}

const ANNIHILAPE = 'sv08-100';
const MIST = 'sv05-161';
const GRENINJA = 'me04-022';
const MILOTIC = 'sv06-050';
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting, no Resistance
const DHELMISE = 'me05-039'; // Basic, 140 HP, Psychic

type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Annihilape / Mist Energy

// https://compendium.pokegym.net/ruling/2427/ : Destined Fight against a Pokémon wearing Mist Energy still Knocks Out Annihilape, and the
// opponent gets 1 Prize for it, while the Mist Energy Pokémon survives.
test('Ruling 2427: Destined Fight into Mist Energy Knocks Out only Annihilape (the opponent takes a Prize, the Mist Pokémon stays)', () => {
  const dk = deck([ANNIHILAPE, MIST, DHELMISE]);
  const mk = (mist: boolean): Game => {
    const sides: Sides = [
      { active: 'Annihilape', bench: ['Dhelmise'], energy: { active: ['Fighting Energy', 'Fire Energy'] } },
      { active: 'Dhelmise', bench: ['Dhelmise'], energy: { active: mist ? ['Mist Energy'] : ['Psychic Energy'] } },
    ];
    return scenario(dk, dk, sides);
  };
  const g = mk(true);
  choose(g, 'Attack: Destined Fight');
  // Annihilape is gone: the opponent took a Prize, I did not.
  assert.equal(g.state.p[1].prizes.length, 5, 'the opponent did not take a Prize for Annihilape');
  assert.equal(g.state.p[0].prizes.length, 6, 'I took a Prize for a Mist Energy Pokémon');
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Annihilape'), 'Annihilape was not Knocked Out');
  assert.equal(activeName(g, 1), 'Dhelmise');
  assert.deepEqual(energyNames(g, 1), ['Mist Energy'], 'the Mist Pokémon was Knocked Out');

  // Without Mist Energy both Actives are Knocked Out, and each player takes a Prize.
  const c = mk(false);
  choose(c, 'Attack: Destined Fight');
  assert.equal(c.state.p[0].prizes.length, 5);
  assert.equal(c.state.p[1].prizes.length, 5);
});

// ------------------------------------------------------------------ Mega Greninja ex / Milotic

// https://compendium.pokegym.net/ruling/2370/ : with Mentally Calm in play Ninja Spinner may still be chosen and gets its +80, but the {W}
// Energy stays attached instead of going to the hand.
test('Ruling 2370: Ninja Spinner under Milotic gets the bonus damage but the Water Energy stays attached', () => {
  const dk = deck([GRENINJA, MILOTIC, URSA]);
  const mk = (milotic: boolean): Game =>
    scenario(dk, dk, [
      { active: 'Mega Greninja ex', energy: { active: ['Water Energy', 'Water Energy', 'Fire Energy'] } },
      { active: 'Bloodmoon Ursaluna ex', bench: milotic ? ['Milotic'] : [] },
    ]);
  const g = mk(true);
  choose(g, 'Attack: Ninja Spinner');
  yes(g);
  assert.equal(g.state.p[1].active!.damage, 200, 'the 80 bonus was lost');
  assert.deepEqual(energyNames(g, 0), ['Fire Energy', 'Water Energy', 'Water Energy'], 'the Water Energy left the Pokémon');

  // Control: without Milotic the Energy goes to the hand.
  const c = mk(false);
  const hand = c.state.p[0].hand.length;
  choose(c, 'Attack: Ninja Spinner');
  yes(c);
  assert.equal(c.state.p[1].active!.damage, 200);
  assert.equal(energyNames(c, 0).length, 2, 'the Water Energy stayed without Milotic');
  assert.equal(c.state.p[0].hand.length, hand + 1);
});

// ------------------------------------------------------------------ Gravity Mountain / Area Zero Underdepths

// https://compendium.pokegym.net/ruling/2305/ : when a Stadium replaces Area Zero Underdepths, the Bench is cut down first, so a Stage 2 that
// the new Stadium's HP loss would Knock Out can be discarded from the Bench before Knock Outs are checked.
test('Ruling 2305: Gravity Mountain replacing Area Zero Underdepths: the Bench discard comes before the Knock Out check', () => {
  const dk = deck(['sv07-131', 'sv08-177', 'sv08.5-028', ANNIHILAPE, DHELMISE]);
  const mk = (): Game => {
    const g = scenario(dk, dk, [
      { active: 'Dhelmise', hand: ['Gravity Mountain'] },
      // Annihilape is a Stage 2 with 140 HP: 120 damage is fine now and lethal at 110 HP.
      { active: 'Dhelmise', bench: ['Pikachu ex', 'Annihilape', ...rep('Dhelmise', 6)], damage: { 1: 120 } },
    ]);
    stadium(g, 'Area Zero Underdepths', 1);
    return g;
  };
  assert.equal(mk().state.p[1].bench.length, 8, 'the setup should hold 8 Benched Pokémon under the Stadium');
  // Discarding the Stage 2 as one of the 3 extra Pokémon: no Knock Out, no Prize.
  const g = mk();
  choose(g, 'Play Gravity Mountain');
  assert.equal(g.decision?.player, 1);
  assert.equal(g.decision?.min, 3, 'the Bench is cut from 8 to 5 first');
  pick(g, ['Annihilape', 'Dhelmise', 'Dhelmise']);
  assert.equal(g.state.p[1].bench.length, 5);
  assert.equal(g.state.p[0].prizes.length, 6, 'a Prize was taken for the discarded Pokémon');
  assert.ok(g.state.p[1].discard.some((c) => nameOf(g, c) === 'Annihilape'));
  // Keeping it instead: the HP loss Knocks it Out and the opponent of its owner takes a Prize.
  const k = mk();
  choose(k, 'Play Gravity Mountain');
  pick(k, ['Dhelmise', 'Dhelmise', 'Dhelmise']);
  assert.equal(k.state.p[0].prizes.length, 5, 'the Stage 2 with 120 damage survived -30 HP');
});

// ------------------------------------------------------------------ Prism Energy / Suicune

// https://compendium.pokegym.net/ruling/2249/ : Crystal Fall's "at least 4 {W} Energy in play" does not say Basic, so Prism Energy on a Basic
// Pokémon (which provides every type) counts toward the four.
test('Ruling 2249: Prism Energy counts as a {W} Energy for Crystal Fall (3 Basic Water + Prism = 4)', () => {
  const dk = deck(['me02-026', 'me02.5-216', URSA]);
  const mk = (third: string): Game =>
    scenario(dk, dk, [
      { active: 'Suicune', energy: { active: ['Water Energy', 'Water Energy', 'Water Energy', third] } },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
  const g = mk('Prism Energy');
  choose(g, 'Attack: Crystal Fall');
  assert.equal(g.state.p[1].active!.damage, 120, 'Prism Energy was not counted as the fourth {W}');
  const c = mk('Fire Energy');
  choose(c, 'Attack: Crystal Fall');
  assert.equal(c.state.p[1].active!.damage, 30, 'three {W} is not enough');
});

// ------------------------------------------------------------------ Mystery Garden

const GARDEN_DECK = deck(['me01-122', 'me05-029', DHELMISE]);
function garden(side: SideLayout): Game {
  const g = scenario(GARDEN_DECK, GARDEN_DECK, [side, { active: 'Dhelmise' }]);
  stadium(g, 'Mystery Garden', 0);
  return g;
}
const USE_GARDEN = 'Use the Stadium (Mystery Garden)';

// https://compendium.pokegym.net/ruling/2232/ : Mystery Garden can't be used when it would not draw anything (here the hand is already as large as the
// number of {P} Pokémon after the discard), because the Energy can't be discarded for nothing.
test('Ruling 2232: Mystery Garden is not offered when no card would be drawn', () => {
  // One {P} Pokémon, hand [Energy, Dhelmise]: after the discard the hand already has 1 card, so nothing is drawn.
  const none = garden({ active: 'Dhelmise', hand: ['Fire Energy', 'Dhelmise'] });
  assert.ok(!has(none, USE_GARDEN), 'Mystery Garden was offered although it would draw nothing');
  // Hand [Energy] alone with one {P} Pokémon draws 1: usable.
  const one = garden({ active: 'Dhelmise', hand: ['Fire Energy'] });
  assert.ok(has(one, USE_GARDEN));
  choose(one, USE_GARDEN);
  assert.equal(one.state.p[0].hand.length, 1, 'drew up to the number of {P} Pokémon');
  assert.ok(one.state.p[0].discard.some((c) => nameOf(one, c) === 'Fire Energy'));
});

// https://compendium.pokegym.net/ruling/2231/ : Mystery Garden can't be used with an empty deck: at least 1 card must be drawn.
test('Ruling 2231: Mystery Garden is not offered with an empty deck', () => {
  const side: SideLayout = { active: 'Dhelmise', bench: ['Slowpoke', 'Slowpoke'], hand: ['Fire Energy'] };
  assert.ok(has(garden(side), USE_GARDEN), 'control: usable with a deck');
  const empty = garden(side);
  empty.state.p[0].discard.push(...empty.state.p[0].deck.splice(0));
  empty.state.pending = null;
  advance(empty.env, empty.state);
  assert.ok(!has(empty, USE_GARDEN), 'Mystery Garden was offered with no cards left to draw');
});

// ------------------------------------------------------------------ Hilda

// https://compendium.pokegym.net/ruling/2204/ : Hilda may fetch a Special Energy card; she does not say Basic.
test('Ruling 2204: Hilda can search for a Special Energy card', () => {
  // The only Energy in the deck is Special.
  const dk = fromIds('r02-hilda', [
    ['sv10.5w-084', 4],
    ['me05-039', 10],
    ['me04-060', 10], // Metang
    ['me04-061', 10], // Metagross
    ['sv06-167', 10], // Legacy Energy (Special)
  ]);
  const g = scenario(dk, dk, [{ active: 'Dhelmise', hand: ['Hilda'] }, { active: 'Dhelmise' }]);
  choose(g, 'Play Hilda');
  assert.equal(g.decision?.kind, 'cards');
  pick(g, ['Metagross']); // the Evolution Pokémon first, then the Energy
  assert.equal(g.decision?.kind, 'cards');
  assert.ok(labels(g).every((l) => l.includes('Legacy Energy')), 'only Special Energy is in this deck');
  pick(g, ['Legacy Energy']);
  assert.deepEqual(handNames(g, 0), ['Legacy Energy', 'Metagross']);
});

// ------------------------------------------------------------------ Slowking

// https://compendium.pokegym.net/ruling/2130/ : a Pokémon that copies an attack with Seek Inspiration used Seek Inspiration, not the copied attack, so
// the copied attack's "can't use it next turn" restriction does not stop it from copying that attack again the following turn.
test("Ruling 2130: Slowking can copy Scyther's Slashing Strike (can't use it next turn) on two turns in a row", () => {
  const dk = deck(['sv07-058', 'sv05-001', URSA, DHELMISE]);
  const g = scenario(dk, dk, [
    { active: 'Slowking', energy: { active: ['Psychic Energy', 'Psychic Energy'] }, deckTop: ['Scyther', 'Dhelmise', 'Scyther', 'Dhelmise'] },
    { active: 'Bloodmoon Ursaluna ex' },
  ]);
  choose(g, 'Attack: Seek Inspiration');
  choose(g, 'Slashing Strike');
  assert.equal(g.state.p[1].active!.damage, 60);
  choose(g, 'End turn'); // the opponent's turn
  // My next turn: the Scyther's restriction ("this Pokémon can't use Slashing Strike") is not on Slowking's attack list, so Seek Inspiration is still offered
  // and can copy the same attack again.
  assert.equal(g.state.current, 0);
  assert.ok(has(g, 'Attack: Seek Inspiration'), 'Seek Inspiration was blocked the turn after copying Slashing Strike');
  choose(g, 'Attack: Seek Inspiration');
  choose(g, 'Slashing Strike');
  assert.equal(g.state.p[1].active!.damage, 120, 'the second copy of Slashing Strike did not happen');
});

// ------------------------------------------------------------------ Palafin ex

// https://compendium.pokegym.net/ruling/1975/ : Hero's Spirit means Palafin ex enters play only through Palafin's Zero to Hero; it can't be played
// from the hand any other way (evolving included).
test("Ruling 1975: Palafin ex in the hand can't be played to evolve Finizen or Palafin; Zero to Hero still brings it in", () => {
  const dk = deck(['sv06-059', 'sv06-060', 'sv06-061', DHELMISE, 'sv06-128', 'me01-130']); // Finizen, Palafin, Palafin ex, Dhelmise, Dreepy, Switch
  const hand = scenario(dk, dk, [{ active: 'Finizen', hand: ['Palafin ex', 'Palafin'] }, { active: 'Dhelmise' }], { turn: 4 });
  hand.state.p[0].active!.enteredTurn = 0;
  hand.state.pending = null;
  advance(hand.env, hand.state);
  assert.ok(labels(hand).some((l) => l.includes('Palafin') && !l.includes('Palafin ex')), `control: Palafin should evolve Finizen: ${labels(hand).join(' | ')}`);
  assert.ok(!labels(hand).some((l) => l.includes('Palafin ex')), `Palafin ex was offered from the hand: ${labels(hand).join(' | ')}`);
  // Through Zero to Hero (Palafin moving to the Bench) it does come into play.
  const z = scenario(dk, dk, [{ active: 'Finizen', evolve: { active: ['Palafin'] }, bench: ['Dreepy'], hand: ['Switch'] }, { active: 'Dhelmise' }]);
  choose(z, 'Play Switch');
  yes(z);
  z.submit([0]);
  const moved = z.state.p[0].bench.map((b) => b.cards.map((c) => nameOf(z, c)));
  assert.ok(moved.some((cs) => cs.join() === 'Finizen,Palafin ex'), `Zero to Hero did not put Palafin ex into play: ${JSON.stringify(moved)}`);
});

// ------------------------------------------------------------------ Cinccino ex

const CINCCINO = 'me04-073';
const DIGGERSBY = 'me03-065';
const LUCKY_HELMET = 'sv06-158';

// https://compendium.pokegym.net/ruling/1160/ : whether a Pokémon was damaged has to be known before a Tool that reacts to damage can work, so
// Smooth Coat's coin is flipped first. (Lucky Helmet is today's damage-reacting Tool: it draws only if the Pokémon really was damaged.)
test("Ruling 1160: Smooth Coat's flip decides whether the damage-reacting Tool (Lucky Helmet) triggers", () => {
  const dk = deck([CINCCINO, DIGGERSBY, LUCKY_HELMET, DHELMISE]);
  const mk = (heads: boolean): Game => {
    const g = scenario(dk, dk, [
      { active: 'Diggersby', energy: { active: ['Fire Energy'] } },
      { active: 'Cinccino ex', tools: { active: ['Lucky Helmet'] }, bench: ['Dhelmise'] },
    ]);
    g.state.forcedCoins = [heads];
    return g;
  };
  const prevented = mk(true);
  const handBefore = prevented.state.p[1].hand.length;
  choose(prevented, 'Attack: Earthquake');
  assert.equal(prevented.state.p[1].active!.damage, 0, 'heads should prevent the damage');
  // (+1 is the opponent's draw for its turn.)
  assert.equal(prevented.state.p[1].hand.length, handBefore + 1, 'Lucky Helmet drew although Smooth Coat prevented the damage');
  const damaged = mk(false);
  const before = damaged.state.p[1].hand.length;
  choose(damaged, 'Attack: Earthquake');
  assert.equal(damaged.state.p[1].active!.damage, 140);
  assert.equal(damaged.state.p[1].hand.length, before + 3, 'Lucky Helmet did not draw after the damage went through');
});

// https://compendium.pokegym.net/ruling/248/ : Smooth Coat is checked for damage from your own Pokémon's attacks too.
test("Ruling 248: Smooth Coat flips for damage done to its own Pokémon by its player's attack (Diggersby's Earthquake on the Bench)", () => {
  const dk = deck([CINCCINO, DIGGERSBY, URSA]);
  const mk = (heads: boolean): Game => {
    const g = scenario(dk, dk, [
      { active: 'Diggersby', bench: ['Cinccino ex'], energy: { active: ['Fire Energy'] } },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
    g.state.forcedCoins = [heads];
    return g;
  };
  const heads = mk(true);
  choose(heads, 'Attack: Earthquake');
  assert.equal(heads.state.p[0].bench[0]!.damage, 0, 'Smooth Coat did not prevent damage from our own attack');
  assert.equal(heads.state.p[1].active!.damage, 140);
  const tails = mk(false);
  choose(tails, 'Attack: Earthquake');
  assert.equal(tails.state.p[0].bench[0]!.damage, 30, 'tails should let the 30 through');
});

// ------------------------------------------------------------------ Rock Hurl

// https://compendium.pokegym.net/ruling/575/ : ignoring Resistance belongs to how damage is worked out rather than to effects on the target, so a
// Defending Pokémon that is protected from attack effects still has its Resistance ignored.
test("Ruling 575: Rock Hurl ignores Resistance even when the Defending Pokémon is protected from effects of attacks (Mist Energy)", () => {
  const dk = deck(['me04-043', 'sv08-077', MIST]);
  // Latios resists {F} by 30; Rock Hurl does 30.
  const mk = (mist: boolean): Game =>
    scenario(dk, dk, [
      { active: 'Sudowoodo', energy: { active: ['Fighting Energy'] } },
      { active: 'Latios', energy: { active: mist ? ['Mist Energy'] : ['Psychic Energy'] } },
    ]);
  const g = mk(true);
  choose(g, 'Attack: Rock Hurl');
  assert.equal(g.state.p[1].active!.damage, 30, "Resistance was applied to Rock Hurl's damage");
  const c = mk(false);
  choose(c, 'Attack: Rock Hurl');
  assert.equal(c.state.p[1].active!.damage, 30);
});

// ------------------------------------------------------------------ Agility (Pikachu, Noivern)

const PIKACHU = '30th-044';
const AGILITY_IDS = [PIKACHU, 'sv10.5w-071', 'sv08-144', 'sv08-002', 'me01-043', DHELMISE, URSA]; // Pikachu, Druddigon, Snorlax, Exeggcute, Frosmoth
/** Player 1 attacks next, into a Pikachu whose Agility flipped heads. `p0` and `p1` add to the two sides. */
function afterAgility(p0: Partial<SideLayout>, p1: SideLayout): Game {
  const dk = deck(AGILITY_IDS);
  const g = scenario(dk, dk, [{ active: 'Pikachu', energy: { active: ['Lightning Energy'] }, ...p0 }, p1]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Agility');
  assert.equal(g.state.current, 1, "it should be the opponent's turn");
  return g;
}

// https://compendium.pokegym.net/ruling/334/ : Agility protects the Pokémon from the opponent's attacks; Poison at Pokémon Checkup is not an attack,
// so a Poisoned Pokémon still takes its damage.
test('Ruling 334: a Poisoned Pokémon still takes Poison damage after a successful Agility', () => {
  const dk = deck(AGILITY_IDS);
  const g = scenario(dk, dk, [{ active: 'Pikachu', energy: { active: ['Lightning Energy'] }, cond: POISONED }, { active: 'Dhelmise' }]);
  g.state.forcedCoins = [true];
  choose(g, 'Attack: Agility');
  assert.equal(g.state.p[0].active!.damage, 10, 'Poison did not put its counter on the Agility Pokémon');
});

// https://compendium.pokegym.net/ruling/333/ : Agility is an effect on the Defending Pokémon, so an attack whose damage "isn't affected by any effects
// on the Defending Pokémon" gets through it.
test("Ruling 333: Agility is an effect on the Defending Pokémon: Druddigon's Shred damages it anyway, an ordinary attack does not", () => {
  const shred = afterAgility({}, { active: 'Druddigon', energy: { active: ['Fire Energy'] } });
  choose(shred, 'Attack: Shred');
  assert.equal(shred.state.p[0].active!.damage, 40, 'Shred was stopped by Agility');
  const plain = afterAgility({}, { active: 'Snorlax', energy: { active: ['Fire Energy'] } });
  choose(plain, 'Attack: Spike Draw');
  assert.equal(plain.state.p[0].active!.damage, 0, 'control: Agility should stop an ordinary attack');
});

// https://compendium.pokegym.net/ruling/332/ : Agility's protection belongs to the Pokémon it names; the other player putting a Pokémon on their Bench
// does not end it.
test("Ruling 332: Agility's protection lasts through the opponent's Benching a Pokémon", () => {
  const g = afterAgility({}, { active: 'Snorlax', energy: { active: ['Fire Energy'] }, hand: ['Dhelmise'] });
  choose(g, 'Bench Dhelmise');
  choose(g, 'Attack: Spike Draw');
  assert.equal(g.state.p[0].active!.damage, 0, 'Agility ended when the opponent benched a Pokémon');
});

// https://compendium.pokegym.net/ruling/331/ : Agility only protects the Agility Pokémon; an attack's effect on its own attacker (healing it) still happens.
test('Ruling 331: an attack into an Agility Pokémon still heals its own attacker', () => {
  const g = afterAgility({}, { active: 'Exeggcute', energy: { active: ['Fire Energy'] }, damage: { active: 20 } });
  // Agility itself did 10 to Exeggcute (30 now); Absorb heals 10 of it.
  assert.equal(g.state.p[1].active!.damage, 30);
  choose(g, 'Attack: Absorb');
  assert.equal(g.state.p[0].active!.damage, 0, 'Agility did not stop the damage');
  assert.equal(g.state.p[1].active!.damage, 20, 'Exeggcute was not healed by Absorb');
});

// https://compendium.pokegym.net/ruling/330/ : Agility stops damage to the Agility Pokémon, not an attack's drawing of cards.
test('Ruling 330: an attack into an Agility Pokémon still draws its card', () => {
  const g = afterAgility({}, { active: 'Snorlax', energy: { active: ['Fire Energy'] } });
  const hand = g.state.p[1].hand.length;
  choose(g, 'Attack: Spike Draw');
  assert.equal(g.state.p[0].active!.damage, 0);
  assert.equal(g.state.p[1].hand.length, hand + 1, 'Snorlax did not draw');
});

// https://compendium.pokegym.net/ruling/329/ : Agility only stops what is done to the Agility Pokémon: the same attack's damage to Benched Pokémon
// still happens (while its damage and Sleep on the Agility Pokémon do not).
test('Ruling 329: an attack into an Agility Pokémon still damages the Benched Pokémon', () => {
  const g = afterAgility({ bench: ['Dhelmise'] }, { active: 'Frosmoth', energy: { active: ['Water Energy'] } });
  choose(g, 'Attack: Chilling Wings');
  assert.equal(g.state.p[0].active!.damage, 0, 'the Agility Pokémon took damage');
  assert.equal(g.state.p[0].active!.cond, 0, 'the Agility Pokémon was affected by the attack');
  assert.equal(g.state.p[0].bench[0]!.damage, 20, 'the Benched Pokémon was protected too');
});

// ------------------------------------------------------------------ the table above

test('every REVIEWED ruling is in the Compendium index', () => {
  const idx = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number }[] };
  const ids = new Set(idx.rulings.map((r) => r.id));
  for (const r of REVIEWED) {
    const n = Number(r.ruling.split('#')[1]);
    assert.ok(ids.has(n), `${r.ruling} is not in data/rulings-compendium.json`);
    assert.ok(r.why.length > 40, `${r.ruling}: give a reason`);
  }
});
