/**
 * Card tests, batch "std-c23": every card scripted in cards/scripts/std-c23.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import type { Decision } from '../types.js';
import { ASLEEP } from '../types.js';
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
function damageOf(g: Game, p: 0 | 1, where: 'active' | number = 'active'): number {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return sl.damage;
}
/** The names of the cards in a Pokémon's stack, bottom first. */
function stack(g: Game, p: 0 | 1, where: 'active' | number = 'active'): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return sl.cards.map((c) => name(g, c));
}
/** Put a Stadium card from the owner's deck into play. */
function setStadium(g: Game, owner: 0 | 1, nm: string): void {
  const ps = g.state.p[owner];
  for (const zone of ['deck', 'hand'] as const) {
    const i = ps[zone].findIndex((c) => name(g, c) === nm);
    if (i >= 0) {
      const [c] = ps[zone].splice(i, 1);
      g.state.stadium = { card: c as number, owner };
      return;
    }
  }
  assert.fail(`no ${nm} to put into play`);
}
/** Leave exactly `n` cards in the player's deck (the rest go to the discard pile). */
function deckOf(g: Game, p: 0 | 1, n: number): void {
  const ps = g.state.p[p];
  ps.discard.push(...ps.deck.splice(0, Math.max(0, ps.deck.length - n)));
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]): DeckInput {
  return fromIds('c23', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';

const TALON = 'sv07-123';
const WOOLOO = 'sv07-124';
const DUBWOOL = 'sv07-125';
const COVER = 'sv07-129';
const ROOT = 'sv07-130';
const BRIAR = 'sv07-132';
const BOMB = 'sv07-134';
const TREE = 'sv07-136';
const GEM = 'sv07-137';
const KOFU = 'sv07-138';
const LACEY = 'sv07-139';
const EGGCUTE = 'sv08-001';
const EGGUTOR = 'sv08-003';
const DURANT = 'sv08-004';
const SHIINOTIC = 'sv08-009';
const DHELMISE = 'sv08-010';
const ZARUDE = 'sv08-011';
const RABSCA = 'sv08-014';
const WOCHIEN = 'sv08-015';
const TAUROS = 'sv08-018';
const HOOH = 'sv08-019';
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting, Retreat Cost 3
const DRAGA = 'sv06-130'; // Dragapult ex: 320 HP, a Tera Pokémon (fix), Retreat Cost 1; Jet Headbutt {C}: 70
const POLT = 'me05-005'; // Poltchageist: 30 HP; Furtive Drop {C}: 1 damage counter on the Defending Pokémon
const TRAPINCH = 'sv08-104';
const VIBRAVA = 'sv08-105'; // Fighting; Cutting Wind {F}{C}: 50
const FLYGON = 'me02-053'; // "Sandy Flapping" on evolving from hand: discard the top 2 cards of the opponent's deck
const ZOROARK = 'sv09-098'; // N's Zoroark ex: Stage 1, 280 HP, Darkness
const LATIAS = 'sv08-076'; // Latias ex: Skyliner sets every Basic Pokémon's Retreat Cost to 0

type Sides = [SideLayout, SideLayout];
function game(dk: DeckInput, sides: Sides, opts?: Parameters<typeof scenario>[3]): Game {
  return scenario(dk, dk, sides, opts);
}

// ------------------------------------------------------------------ Talonflame

test("Talonflame, Aero Chase: 110, and 110 more if the Retreat Cost of the opponent's Active Pokémon is {C}{C} or more", () => {
  const dk = deck(TALON, URSA, DRAGA);
  const hit = (oppActive: string, extra?: Partial<SideLayout>): number => {
    const g = game(dk, [{ active: 'Talonflame', energy: { active: [F, F] } }, { active: oppActive, ...extra }]);
    choose(g, 'Attack: Aero Chase');
    return damageOf(g, 1);
  };
  // "If the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does 110 more damage."
  assert.equal(hit('Bloodmoon Ursaluna ex'), 220, 'Retreat Cost 3');
  assert.equal(hit('Dragapult ex'), 110, 'Retreat Cost 1');
});

test("Talonflame, Aero Chase: the Retreat Cost it has right now counts, and an Antique fossil has none (Compendium #2386)", () => {
  const dk = deck(TALON, DRAGA, ROOT, GEM);
  const hit = (extra: Partial<SideLayout>): number => {
    const g = game(dk, [{ active: 'Talonflame', energy: { active: [F, F] } }, { active: 'Dragapult ex', ...extra }]);
    choose(g, 'Attack: Aero Chase');
    return damageOf(g, 1);
  };
  assert.equal(hit({}), 110);
  // Gravity Gemstone on the Defending Pokémon makes its Retreat Cost {C} more: 1 + 1 = 2.
  assert.equal(hit({ tools: { active: ['Gravity Gemstone'] } }), 220);
  // An Antique fossil has no Retreat Cost, so there is no bonus (and it has 60 HP: Knocked Out, so look at the Prize cards).
  const g = game(dk, [{ active: 'Talonflame', energy: { active: [F, F] } }, { active: 'Antique Root Fossil', bench: ['Dragapult ex'] }]);
  choose(g, 'Attack: Aero Chase');
  assert.equal(g.state.p[0].prizes.length, 5, 'the fossil was Knocked Out (110 is plenty against 60 HP) for 1 Prize card');
});

// ------------------------------------------------------------------ Wooloo, Dubwool

test('Wooloo, Knock Over: 30 damage, and you may discard a Stadium in play', () => {
  const dk = deck(WOOLOO, URSA, TREE);
  const play = (stadium: boolean): Game => {
    const g = game(dk, [{ active: 'Wooloo', energy: { active: [F, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    if (stadium) setStadium(g, 1, 'Grand Tree');
    choose(g, 'Attack: Knock Over');
    return g;
  };
  // "You may discard a Stadium in play." (any player's Stadium)
  const taken = play(true);
  yes(taken);
  assert.equal(taken.state.stadium, null, 'the Stadium is gone');
  assert.deepEqual(names(taken, taken.state.p[1].discard), ['Grand Tree'], "it goes to its owner's discard pile");
  assert.equal(damageOf(taken, 1), 30);

  const kept = play(true);
  no(kept);
  assert.ok(kept.state.stadium, 'declining keeps the Stadium');
  assert.equal(damageOf(kept, 1), 30);

  // With no Stadium in play there is nothing to ask.
  const none = play(false);
  assert.notEqual(none.decision?.kind, 'yesno');
  assert.equal(damageOf(none, 1), 30);
});

test('Dubwool, Knock Over: 70 damage, and you may discard a Stadium in play', () => {
  const dk = deck(DUBWOOL, URSA, TREE);
  const g = game(dk, [{ active: 'Dubwool', energy: { active: [F, F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  setStadium(g, 0, 'Grand Tree');
  choose(g, 'Attack: Knock Over');
  yes(g);
  assert.equal(g.state.stadium, null);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Grand Tree']);
  assert.equal(damageOf(g, 1), 70);
});

test('Dubwool, Soft Wool: takes 30 less damage from attacks, after Weakness and Resistance', () => {
  const dk = deck(DUBWOOL, DRAGA, VIBRAVA, TRAPINCH, WOOLOO);
  const hit = (attacker: string, atkLabel: string, energy: string[]): Game => {
    const g = game(dk, [{ active: 'Dubwool' }, { active: attacker, energy: { active: energy } }], { current: 1, turn: 4 });
    choose(g, atkLabel);
    return g;
  };
  // "This Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
  assert.equal(damageOf(hit('Dragapult ex', 'Attack: Jet Headbutt', [F]), 0), 40, '70 - 30');
  // Vibrava ({F}) does 50, doubled by Dubwool's Fighting Weakness to 100, then 30 less: 70 (not (50 - 30) x 2 = 40).
  assert.equal(damageOf(hit('Vibrava', 'Attack: Cutting Wind', [FI, FI]), 0), 70);
  // Damage that is 30 or less is reduced to nothing.
  assert.equal(damageOf(hit('Wooloo', 'Attack: Knock Over', [F, F]), 0), 0);
});

// ------------------------------------------------------------------ Antique fossils

test('Antique Cover Fossil, Protective Cover: prevents all effects of the opponent\'s attacks done to it, but not damage', () => {
  const dk = deck(COVER, POLT, WOOLOO, URSA);
  const effect = (target: string): number => {
    const g = game(dk, [{ active: target }, { active: 'Poltchageist', energy: { active: [F] } }], { current: 1, turn: 4 });
    choose(g, 'Attack: Furtive Drop');
    return damageOf(g, 0);
  };
  // Poltchageist, Furtive Drop: "Put 1 damage counter on your opponent's Active Pokémon." That is an effect.
  assert.equal(effect('Bloodmoon Ursaluna ex'), 10, 'an ordinary Pokémon takes the counter');
  assert.equal(effect('Antique Cover Fossil'), 0, 'the fossil takes nothing');
  // "(Damage is not an effect.)"
  const g = game(dk, [{ active: 'Antique Cover Fossil' }, { active: 'Wooloo', energy: { active: [F, F] } }], { current: 1, turn: 4 });
  choose(g, 'Attack: Knock Over');
  assert.equal(damageOf(g, 0), 30, 'attack damage still lands');
});

test("Antique Root Fossil, Primal Root: while Active, attacks used by the opponent's Basic Pokémon cost {C} more", () => {
  const dk = deck(ROOT, WOOLOO, DUBWOOL);
  const offered = (mine: SideLayout, opp: SideLayout): boolean => has(game(dk, [mine, opp], { current: 1, turn: 4 }), 'Attack: Knock Over');
  // Wooloo's Knock Over costs {C}{C}.
  assert.ok(offered({ active: 'Wooloo' }, { active: 'Wooloo', energy: { active: [F, F] } }), 'no fossil: 2 Energy is enough');
  assert.ok(!offered({ active: 'Antique Root Fossil' }, { active: 'Wooloo', energy: { active: [F, F] } }), 'fossil Active: it costs 3');
  assert.ok(offered({ active: 'Antique Root Fossil' }, { active: 'Wooloo', energy: { active: [F, F, F] } }), 'fossil Active: 3 Energy pays');
  // Only Basic Pokémon are taxed: Dubwool (Stage 1) still pays {C}{C}.
  assert.ok(offered({ active: 'Antique Root Fossil' }, { active: 'Dubwool', energy: { active: [F, F] } }), 'a Stage 1 Pokémon is unaffected');
  // "As long as this Pokémon is in the Active Spot": on the Bench it does nothing.
  assert.ok(offered({ active: 'Wooloo', bench: ['Antique Root Fossil'] }, { active: 'Wooloo', energy: { active: [F, F] } }), 'fossil on the Bench');
});

// ------------------------------------------------------------------ Briar

test('Briar: only if the opponent has exactly 2 Prize cards remaining', () => {
  const dk = deck(BRIAR, DRAGA, WOOLOO);
  const can = (oppPrizes: number): boolean => has(game(dk, [{ active: 'Dragapult ex', hand: ['Briar'] }, { active: 'Wooloo', prizes: oppPrizes }]), 'Play Briar');
  assert.ok(can(2));
  assert.ok(!can(3), '3 Prize cards remaining');
  assert.ok(!can(1), '1 Prize card remaining');
});

test("Briar: this turn, a Knock Out of the opponent's Active Pokémon by damage from your Tera Pokémon takes 1 more Prize card", () => {
  const dk = deck(BRIAR, DRAGA, WOOLOO, TALON);
  const ko = (attacker: string, briar: boolean): number => {
    const g = game(dk, [
      { active: attacker, energy: { active: [F, F] }, hand: briar ? ['Briar'] : [] },
      { active: 'Wooloo', bench: ['Wooloo'], prizes: 2 },
    ]);
    if (briar) choose(g, 'Play Briar');
    choose(g, attacker === 'Dragapult ex' ? 'Attack: Jet Headbutt' : 'Attack: Aero Chase');
    return 6 - g.state.p[0].prizes.length;
  };
  // Dragapult ex (Tera) does 70 to Wooloo (70 HP): Knocked Out.
  assert.equal(ko('Dragapult ex', true), 2, 'Tera attacker with Briar: 1 + 1');
  assert.equal(ko('Dragapult ex', false), 1, 'no Briar');
  // Talonflame is not a Tera Pokémon: no extra Prize card.
  assert.equal(ko('Talonflame', true), 1, 'non-Tera attacker with Briar');
});

// ------------------------------------------------------------------ Deluxe Bomb

test('Deluxe Bomb: when the Active holder is damaged by an attack, 12 damage counters go on the Attacking Pokémon and the Tool is discarded', () => {
  const dk = deck(BOMB, DRAGA, URSA);
  const g = game(dk, [{ active: 'Dragapult ex', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex', tools: { active: ['Deluxe Bomb'] } }]);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(damageOf(g, 1), 70);
  assert.equal(damageOf(g, 0), 120, '12 damage counters on the Attacking Pokémon');
  assert.deepEqual(names(g, g.state.p[1].discard), ['Deluxe Bomb'], 'the Tool is discarded');
  assert.equal(g.state.p[1].active!.tools.length, 0);
});

test('Deluxe Bomb: no damage to the holder, no counters and the Tool stays; a holder on the Bench does nothing', () => {
  const dk = deck(BOMB, DRAGA, URSA, POLT);
  // Poltchageist's Furtive Drop does no damage.
  const g = game(dk, [{ active: 'Poltchageist', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex', tools: { active: ['Deluxe Bomb'] } }]);
  choose(g, 'Attack: Furtive Drop');
  assert.equal(damageOf(g, 0), 0);
  assert.equal(g.state.p[1].active!.tools.length, 1, 'still attached');
  // The Tool is on a Benched Pokémon while another is Active and hit: "is in the Active Spot".
  const b = game(dk, [{ active: 'Dragapult ex', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Bloodmoon Ursaluna ex'], tools: { 0: ['Deluxe Bomb'] } }]);
  choose(b, 'Attack: Jet Headbutt');
  assert.equal(damageOf(b, 0), 0);
});

test('Deluxe Bomb: Knocked Out holder still deals the counters, and everything resolves before the game ends (Compendium #2028)', () => {
  const dk = deck(BOMB, DRAGA, URSA);
  // Each side has 1 Prize card left and no Bench; Dragapult ex has 100 HP left; the Bomb holder has 70 HP left.
  const g = game(dk, [
    { active: 'Dragapult ex', energy: { active: [F] }, damage: { active: 220 }, prizes: 1 },
    { active: 'Bloodmoon Ursaluna ex', tools: { active: ['Deluxe Bomb'] }, damage: { active: 190 }, prizes: 1 },
  ]);
  choose(g, 'Attack: Jet Headbutt');
  // All effects resolve before checking if the game is over.
  assert.equal(g.state.p[0].prizes.length, 0, 'the attacker took its last Prize card for the Knock Out');
  assert.equal(g.state.p[1].prizes.length, 0, 'and the Bomb holder\'s side took its last Prize card for the Knock Out the 12 counters caused');
  assert.ok(g.over);
});

// ------------------------------------------------------------------ Grand Tree

const FLY_DECK = deck(TREE, TRAPINCH, VIBRAVA, FLYGON, WOOLOO);

test('Grand Tree: once during each player\'s turn, evolve a Basic into a Stage 1, then that Pokémon into a Stage 2, from the deck', () => {
  const g = game(FLY_DECK, [
    { active: 'Wooloo', bench: ['Trapinch'], hand: ['Grand Tree'] },
    { active: 'Wooloo', deckTop: ['Fire Energy', 'Fire Energy', 'Fire Energy'] },
  ]);
  const oppDeck = g.state.p[1].deck.length;
  choose(g, 'Play Grand Tree');
  choose(g, 'Use the Stadium');
  // "... search their deck for a Stage 1 Pokémon that evolves from 1 of their Basic Pokémon ..."
  assert.deepEqual([...new Set(labels(g))], ['Vibrava'], 'only Stage 1 Pokémon that evolve from a Basic Pokémon in play');
  choose(g, 'Vibrava');
  // "If that Pokémon was evolved in this way, ... a Stage 2 Pokémon that evolves from that Pokémon ..."
  assert.deepEqual([...new Set(labels(g))], ['Flygon']);
  choose(g, 'Flygon');
  assert.deepEqual(stack(g, 0, 0), ['Trapinch', 'Vibrava', 'Flygon']);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2037/): not played from the hand, so Flygon's "Sandy Flapping" doesn't run.
  assert.notEqual(g.decision?.kind, 'yesno', 'no "when you play this Pokémon from your hand to evolve" question');
  assert.equal(g.state.p[1].deck.length, oppDeck, "nothing was discarded from the opponent's deck");
  // Once during each player's turn.
  assert.ok(!has(g, 'Use the Stadium'), 'used once this turn');
});

test('Grand Tree: you may pick no card, and a Stage 1 with no Stage 2 evolution is fine (Compendium #2029)', () => {
  const dk = deck(TREE, TRAPINCH, VIBRAVA, WOOLOO);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2029/): a Stage 1 with no Stage 2 evolution is a valid target.
  const g = game(dk, [{ active: 'Trapinch', hand: ['Grand Tree'] }, { active: 'Wooloo' }]);
  choose(g, 'Play Grand Tree');
  choose(g, 'Use the Stadium');
  choose(g, 'Vibrava');
  assert.deepEqual(stack(g, 0), ['Trapinch', 'Vibrava']);
  assert.equal(g.decision?.kind, 'main', 'no Stage 2 in the deck: nothing more to ask');
  // A search can find nothing: pick none.
  const none = game(FLY_DECK, [{ active: 'Trapinch', hand: ['Grand Tree'] }, { active: 'Wooloo' }]);
  choose(none, 'Play Grand Tree');
  choose(none, 'Use the Stadium');
  none.submit([]);
  assert.deepEqual(stack(none, 0), ['Trapinch']);
  assert.ok(!has(none, 'Use the Stadium'), 'the use still counted');
});

test('Grand Tree: you choose which Basic Pokémon of that name evolves', () => {
  const g = game(deck(TREE, TRAPINCH, VIBRAVA, WOOLOO), [{ active: 'Trapinch', bench: ['Trapinch'], hand: ['Grand Tree'] }, { active: 'Wooloo' }]);
  choose(g, 'Play Grand Tree');
  choose(g, 'Use the Stadium');
  choose(g, 'Vibrava');
  assert.equal(g.decision?.kind, 'slots');
  const i = labels(g).findIndex((l) => l === 'Trapinch');
  g.submit([i]);
  assert.deepEqual(stack(g, 0), ['Trapinch'], 'the Active Pokémon did not evolve');
  assert.deepEqual(stack(g, 0, 0), ['Trapinch', 'Vibrava'], 'the Benched one did');
});

test('Grand Tree: needs a valid evolution path, not on your first turn, and not on a Basic Pokémon put into play this turn', () => {
  const check = (sides: Sides, opts?: Parameters<typeof scenario>[3], dk = FLY_DECK): boolean => {
    // Play the Stadium from hand through the real interface, then see whether its Ability is offered.
    const withHand: Sides = [{ ...sides[0], hand: ['Grand Tree', ...(sides[0].hand ?? [])] }, sides[1]];
    const g = game(dk, withHand, opts);
    choose(g, 'Play Grand Tree');
    return has(g, 'Use the Stadium');
  };
  assert.ok(check([{ active: 'Trapinch' }, { active: 'Wooloo' }]), 'Trapinch in play, Vibrava in the deck');
  // Grand Tree needs a known valid evolution path to be used. (TPCi Rules Team, https://compendium.pokegym.net/ruling/2030/)
  assert.ok(!check([{ active: 'Wooloo' }, { active: 'Wooloo' }]), 'no Basic Pokémon in play that a Stage 1 in the deck evolves from');
  assert.ok(!check([{ active: 'Trapinch' }, { active: 'Wooloo' }], undefined, deck(TREE, TRAPINCH, FLYGON, WOOLOO)), 'no Stage 1 in the deck');
  assert.ok(!check([{ active: 'Vibrava' }, { active: 'Wooloo' }]), 'a Stage 1 Pokémon is not a Basic Pokémon');
  // "(Players can't evolve a Basic Pokémon during their first turn ...)"
  assert.ok(!check([{ active: 'Trapinch' }, { active: 'Wooloo' }], { turn: 1, current: 0, first: 0 }), 'your first turn (going first)');
  assert.ok(!check([{ active: 'Trapinch' }, { active: 'Wooloo' }], { turn: 2, current: 0, first: 1 }), 'your first turn (going second)');
  assert.ok(check([{ active: 'Trapinch' }, { active: 'Wooloo' }], { turn: 2, current: 0, first: 0 }), 'turn 2 is not the first player\'s first turn');
  // "... or a Basic Pokémon that was put into play this turn."
  const g = game(FLY_DECK, [{ active: 'Wooloo', hand: ['Grand Tree', 'Trapinch'] }, { active: 'Wooloo' }]);
  choose(g, 'Play Grand Tree');
  assert.ok(!has(g, 'Use the Stadium'));
  choose(g, 'Bench Trapinch');
  assert.ok(!has(g, 'Use the Stadium'), 'Trapinch was just put into play');
});

test("Grand Tree: each player may use it on their own turn", () => {
  const g = game(FLY_DECK, [
    { active: 'Trapinch', hand: ['Grand Tree'] },
    { active: 'Trapinch', bench: ['Trapinch'] },
  ]);
  choose(g, 'Play Grand Tree');
  choose(g, 'Use the Stadium');
  choose(g, 'Vibrava');
  choose(g, 'Flygon');
  assert.deepEqual(stack(g, 0), ['Trapinch', 'Vibrava', 'Flygon']);
  endTurn(g);
  assert.equal(g.state.current, 1);
  choose(g, 'Use the Stadium');
  assert.equal(g.decision?.player, 1, 'the opponent searches their own deck');
  choose(g, 'Vibrava');
  const i = labels(g).findIndex((l) => l === 'Trapinch');
  g.submit([i]);
  assert.deepEqual(stack(g, 1, 0), ['Trapinch', 'Vibrava']);
});

// ------------------------------------------------------------------ Gravity Gemstone

test("Gravity Gemstone: while its holder is Active, the Retreat Cost of both Active Pokémon is {C} more", () => {
  const dk = deck(GEM, WOOLOO, LATIAS);
  const retreat = (mine: SideLayout, opp: SideLayout, current: 0 | 1): boolean =>
    has(game(dk, [mine, opp], { current, turn: current === 0 ? 3 : 4 }), 'Retreat');
  const gem = { tools: { active: ['Gravity Gemstone'] } };
  // Wooloo's Retreat Cost is {C}.
  assert.ok(retreat({ active: 'Wooloo', bench: ['Wooloo'], energy: { active: [F] } }, { active: 'Wooloo' }, 0), 'no Gemstone: 1 Energy pays');
  assert.ok(!retreat({ active: 'Wooloo', bench: ['Wooloo'], energy: { active: [F] }, ...gem }, { active: 'Wooloo' }, 0), 'holder retreating: {C}{C}');
  assert.ok(retreat({ active: 'Wooloo', bench: ['Wooloo'], energy: { active: [F, F] }, ...gem }, { active: 'Wooloo' }, 0), 'holder retreating with 2 Energy');
  // "both Active Pokémon": the opponent's Active Pokémon too.
  assert.ok(!retreat({ active: 'Wooloo', ...gem }, { active: 'Wooloo', bench: ['Wooloo'], energy: { active: [F] } }, 1), "the opponent's Active Pokémon needs 2 Energy");
  assert.ok(retreat({ active: 'Wooloo', ...gem }, { active: 'Wooloo', bench: ['Wooloo'], energy: { active: [F, F] } }, 1));
  // "As long as the Pokémon this card is attached to is in the Active Spot": on the Bench it does nothing.
  assert.ok(retreat({ active: 'Wooloo', bench: ['Wooloo'], energy: { active: [F] }, ...{ tools: { 0: ['Gravity Gemstone'] } } }, { active: 'Wooloo' }, 0), 'holder on the Bench');
});

test('Gravity Gemstone: it does not add to a Retreat Cost that an effect set to none (Compendium #2082)', () => {
  const dk = deck(GEM, WOOLOO, LATIAS);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2082/): a Retreat Cost set to none can't be increased by effects.
  const g = game(dk, [
    { active: 'Wooloo', bench: ['Wooloo', 'Latias ex'], tools: { active: ['Gravity Gemstone'] } },
    { active: 'Wooloo' },
  ]);
  assert.ok(has(g, 'Retreat'), 'Skyliner: no Energy needed, and the Gemstone adds nothing');
});

// ------------------------------------------------------------------ Kofu

test('Kofu: put 2 cards from your hand on the bottom of your deck, then draw 4', () => {
  const dk = deck(KOFU, WOOLOO);
  const g = game(dk, [{ active: 'Wooloo', hand: ['Kofu', F, W, P] }, { active: 'Wooloo' }]);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Kofu');
  pick(g, [F, W]);
  assert.equal(g.state.p[0].hand.length, 1 + 4, 'the third card stays, 4 are drawn');
  assert.ok(names(g, g.state.p[0].hand).includes(P));
  assert.equal(g.state.p[0].deck.length, deckBefore - 4 + 2);
  assert.deepEqual(names(g, g.state.p[0].deck.slice(0, 2)), [F, W], 'the 2 cards are the bottom of the deck');
});

test("Kofu: can't be used unless 2 other cards can go on the bottom of the deck", () => {
  const dk = deck(KOFU, WOOLOO);
  const can = (hand: string[]): boolean => has(game(dk, [{ active: 'Wooloo', hand }, { active: 'Wooloo' }]), 'Play Kofu');
  assert.ok(can(['Kofu', F, W]), 'Kofu and 2 other cards');
  assert.ok(!can(['Kofu', F]), 'only 1 other card');
  assert.ok(!can(['Kofu']), 'no other cards');
});

// ------------------------------------------------------------------ Lacey

test("Lacey: shuffle your hand into your deck, then draw 4; 8 if the opponent has 3 or fewer Prize cards remaining", () => {
  const dk = deck(LACEY, WOOLOO);
  const play = (oppPrizes: number): Game => {
    const g = game(dk, [{ active: 'Wooloo', hand: ['Lacey', F, W, P] }, { active: 'Wooloo', prizes: oppPrizes }]);
    choose(g, 'Play Lacey');
    return g;
  };
  const four = play(4);
  assert.equal(four.state.p[0].hand.length, 4);
  const eight = play(3);
  assert.equal(eight.state.p[0].hand.length, 8);
  assert.equal(play(1).state.p[0].hand.length, 8);
  // The old hand went into the deck first: deck + hand is unchanged apart from Lacey itself.
  const g = game(dk, [{ active: 'Wooloo', hand: ['Lacey', F, W, P] }, { active: 'Wooloo' }]);
  const total = g.state.p[0].deck.length + g.state.p[0].hand.length;
  choose(g, 'Play Lacey');
  assert.equal(g.state.p[0].deck.length + g.state.p[0].hand.length, total - 1);
});

test("Lacey: can't be played if it would do nothing", () => {
  const dk = deck(LACEY, WOOLOO);
  // No other card in hand and no deck.
  assert.ok(!has(game(dk, [{ active: 'Wooloo', hand: ['Lacey'], emptyDeck: true }, { active: 'Wooloo' }]), 'Play Lacey'));
  // Cards in hand to shuffle in, even with an empty deck.
  assert.ok(has(game(dk, [{ active: 'Wooloo', hand: ['Lacey', F], emptyDeck: true }, { active: 'Wooloo' }]), 'Play Lacey'));
  // A deck to draw from.
  assert.ok(has(game(dk, [{ active: 'Wooloo', hand: ['Lacey'] }, { active: 'Wooloo' }]), 'Play Lacey'));
});

// ------------------------------------------------------------------ Exeggcute, Exeggutor

test("Exeggcute, Precocious Evolution: if you go first, you can use it on your first turn: evolve it from your deck", () => {
  const dk = deck(EGGCUTE, EGGUTOR, URSA);
  // turn 1, the first player's first turn
  const g = game(dk, [{ active: 'Exeggcute', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }], { turn: 1, current: 0, first: 0 });
  assert.ok(has(g, 'Attack: Precocious Evolution'), 'usable on the first turn');
  choose(g, 'Attack: Precocious Evolution');
  assert.deepEqual(labels(g), ['Exeggutor', 'Exeggutor', 'Exeggutor', 'Exeggutor'], 'only a card that evolves from Exeggcute');
  choose(g, 'Exeggutor');
  assert.deepEqual(stack(g, 0), ['Exeggcute', 'Exeggutor']);
  assert.equal(g.state.p[0].deck.length > 0, true);
});

test('Exeggcute, Precocious Evolution: choose none, and it works on later turns too', () => {
  const dk = deck(EGGCUTE, EGGUTOR, URSA);
  const none = game(dk, [{ active: 'Exeggcute', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }], { turn: 1, current: 0, first: 0 });
  choose(none, 'Attack: Precocious Evolution');
  none.submit([]);
  assert.deepEqual(stack(none, 0), ['Exeggcute']);
  const later = game(dk, [{ active: 'Exeggcute', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(later, 'Attack: Precocious Evolution');
  choose(later, 'Exeggutor');
  assert.deepEqual(stack(later, 0), ['Exeggcute', 'Exeggutor']);
  // With nothing in the deck that evolves from it, the attack just shuffles.
  const empty = game(deck(EGGCUTE, URSA), [{ active: 'Exeggcute', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(empty, 'Attack: Precocious Evolution');
  assert.deepEqual(stack(empty, 0), ['Exeggcute']);
});

test("Exeggutor, Barrage O'Clock: flip a coin for each Energy attached to both Active Pokémon; 60 damage for each heads", () => {
  const dk = deck(EGGUTOR, URSA);
  const hit = (coins: boolean[]): number => {
    const g = game(dk, [{ active: 'Exeggutor', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex', energy: { active: [F, W] } }]);
    g.state.forcedCoins = coins;
    choose(g, "Attack: Barrage O'Clock");
    return damageOf(g, 1);
  };
  // 1 Energy on Exeggutor + 2 on the Defending Pokémon = 3 coins.
  assert.equal(hit([true, true, true]), 180);
  assert.equal(hit([true, false, true]), 120);
  assert.equal(hit([false, false, false]), 0);
});

// ------------------------------------------------------------------ Durant ex

test('Durant ex, Vengeful Crush: 120, and 30 more for each Prize card your opponent has taken', () => {
  const dk = deck(DURANT, URSA);
  const hit = (oppPrizes: number): number => {
    const g = game(dk, [{ active: 'Durant ex', energy: { active: [G, F, F] }, prizes: 6 }, { active: 'Bloodmoon Ursaluna ex', prizes: 6 }]);
    g.state.p[1].prizesTaken = 6 - oppPrizes;
    choose(g, 'Attack: Vengeful Crush');
    return damageOf(g, 1);
  };
  assert.equal(hit(6), 120, 'no Prize cards taken');
  assert.equal(hit(4), 180, '2 Prize cards taken');
  assert.equal(hit(3), 210, '3 Prize cards taken');
});

test("Durant ex, Sudden Shearing: when you play it onto your Bench, you may discard the top card of your opponent's deck", () => {
  const dk = deck(DURANT, URSA);
  const play = (answer: 'yes' | 'no'): Game => {
    const g = game(dk, [{ active: 'Bloodmoon Ursaluna ex', hand: ['Durant ex'] }, { active: 'Bloodmoon Ursaluna ex', deckTop: [F, W] }]);
    choose(g, 'Bench Durant ex');
    if (answer === 'yes') yes(g);
    else no(g);
    return g;
  };
  const taken = play('yes');
  assert.deepEqual(names(taken, taken.state.p[1].discard), [F], 'only the top card of their deck');
  const declined = play('no');
  assert.equal(declined.state.p[1].discard.length, 0);
});

// ------------------------------------------------------------------ Shiinotic

test('Shiinotic, Spiral Rush: flip a coin until you get tails; 30 more damage for each heads', () => {
  const dk = deck(SHIINOTIC, URSA);
  const hit = (coins: boolean[]): number => {
    const g = game(dk, [{ active: 'Shiinotic', energy: { active: [G, G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Spiral Rush');
    return damageOf(g, 1);
  };
  assert.equal(hit([false]), 60);
  assert.equal(hit([true, false]), 90);
  assert.equal(hit([true, true, true, false]), 150);
});

test("Shiinotic, Calming Light: once during your turn, if it is Active, make the opponent's Active Pokémon Asleep", () => {
  const dk = deck(SHIINOTIC, URSA);
  const g = game(dk, [{ active: 'Shiinotic' }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Use Calming Light');
  assert.equal(g.state.p[1].active!.cond & ASLEEP, ASLEEP);
  assert.ok(!has(g, 'Use Calming Light'), 'once during your turn');
  // "if this Pokémon is in the Active Spot"
  const bench = game(dk, [{ active: 'Bloodmoon Ursaluna ex', bench: ['Shiinotic'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  assert.ok(!has(bench, 'Use Calming Light'), 'on the Bench');
  // An Ability that can't change anything can't be used: the Defending Pokémon is already Asleep.
  const asleep = game(dk, [{ active: 'Shiinotic' }, { active: 'Bloodmoon Ursaluna ex', cond: ASLEEP }]);
  assert.ok(!has(asleep, 'Use Calming Light'));
});

// ------------------------------------------------------------------ Dhelmise

test('Dhelmise, Rescue Kedge: put up to 2 Pokémon from your discard pile into your hand', () => {
  const dk = deck(DHELMISE, URSA, WOOLOO, DUBWOOL);
  const use = (take: string[]): Game => {
    const g = game(dk, [
      { active: 'Dhelmise', energy: { active: [G] }, discard: ['Wooloo', 'Dubwool', 'Bloodmoon Ursaluna ex', F] },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
    choose(g, 'Attack: Rescue Kedge');
    pick(g, take);
    return g;
  };
  const two = use(['Wooloo', 'Dubwool']);
  assert.deepEqual(names(two, two.state.p[0].hand), ['Dubwool', 'Wooloo']);
  assert.deepEqual(names(two, two.state.p[0].discard), ['Bloodmoon Ursaluna ex', F]);
  assert.ok(!labels(two).includes(F), 'Energy cards are not offered');
  const one = use(['Dubwool']);
  assert.deepEqual(names(one, one.state.p[0].hand), ['Dubwool'], 'up to 2: fewer is fine');
  // "up to": none is also fine on an attack.
  const g = game(dk, [{ active: 'Dhelmise', energy: { active: [G] }, discard: ['Wooloo'] }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Rescue Kedge');
  g.submit([]);
  assert.equal(g.state.p[0].hand.length, 0);
});

test("Dhelmise, Annihilating Anchor: 80 damage, after discarding all Pokémon Tools from the opponent's Active Pokémon", () => {
  const dk = deck(DHELMISE, URSA, GEM, BOMB);
  const g = game(dk, [
    { active: 'Dhelmise', energy: { active: [G, F, F] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Bloodmoon Ursaluna ex'], tools: { active: ['Gravity Gemstone'], 0: ['Deluxe Bomb'] } },
  ]);
  choose(g, 'Attack: Annihilating Anchor');
  assert.equal(damageOf(g, 1), 80);
  assert.equal(g.state.p[1].active!.tools.length, 0);
  assert.deepEqual(names(g, g.state.p[1].discard), ['Gravity Gemstone']);
  assert.equal(g.state.p[1].bench[0]!.tools.length, 1, "a Benched Pokémon's Tool stays");
  assert.equal(damageOf(g, 0), 0, 'the Tool was discarded before damage, so a Deluxe Bomb on the Defending Pokémon would not have fired either');
});

test('Dhelmise, Annihilating Anchor: a Deluxe Bomb on the Defending Pokémon is discarded before damage and never fires', () => {
  const dk = deck(DHELMISE, URSA, BOMB);
  const g = game(dk, [
    { active: 'Dhelmise', energy: { active: [G, F, F] } },
    { active: 'Bloodmoon Ursaluna ex', tools: { active: ['Deluxe Bomb'] } },
  ]);
  choose(g, 'Attack: Annihilating Anchor');
  assert.equal(damageOf(g, 0), 0, 'no counters on Dhelmise');
  assert.equal(damageOf(g, 1), 80);
});

// ------------------------------------------------------------------ Zarude

test('Zarude, Leaf Drain: 20 damage, and heal 20 damage from this Pokémon', () => {
  const dk = deck(ZARUDE, URSA);
  const g = game(dk, [{ active: 'Zarude', energy: { active: [G] }, damage: { active: 50 } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Leaf Drain');
  assert.equal(damageOf(g, 1), 20);
  assert.equal(damageOf(g, 0), 30);
});

test('Zarude, Jungle Whip: you may put all Energy attached to it into your hand to do 80 more damage', () => {
  const dk = deck(ZARUDE, URSA, GEM);
  const use = (answer: 'yes' | 'no'): Game => {
    const g = game(dk, [
      { active: 'Zarude', energy: { active: [G, G, F] }, tools: { active: ['Gravity Gemstone'] } },
      { active: 'Bloodmoon Ursaluna ex' },
    ]);
    choose(g, 'Attack: Jungle Whip');
    if (answer === 'yes') yes(g);
    else no(g);
    return g;
  };
  const yesG = use('yes');
  assert.equal(damageOf(yesG, 1), 160);
  assert.equal(yesG.state.p[0].active!.energy.length, 0, 'every Energy card left');
  assert.deepEqual(names(yesG, yesG.state.p[0].hand), [F, G, G], 'into the hand, not the discard pile');
  assert.equal(yesG.state.p[0].discard.length, 0);
  assert.equal(yesG.state.p[0].active!.tools.length, 1, 'the Tool stays');
  const noG = use('no');
  assert.equal(damageOf(noG, 1), 80);
  assert.equal(noG.state.p[0].active!.energy.length, 3);
  assert.equal(noG.state.p[0].hand.length, 0);
});

// ------------------------------------------------------------------ Rabsca

test('Rabsca, Triple Draw: draw 3 cards', () => {
  const dk = deck(RABSCA, URSA);
  const g = game(dk, [{ active: 'Rabsca', energy: { active: [F] } }, { active: 'Bloodmoon Ursaluna ex' }]);
  choose(g, 'Attack: Triple Draw');
  assert.equal(g.state.p[0].hand.length, 3);
});

test('Rabsca, Counterturn: 40, and 200 more if there are 3 or fewer cards in your deck', () => {
  const dk = deck(RABSCA, URSA);
  const hit = (cards: number): number => {
    const g = game(dk, [{ active: 'Rabsca', energy: { active: [G] } }, { active: 'Bloodmoon Ursaluna ex' }]);
    deckOf(g, 0, cards);
    choose(g, 'Attack: Counterturn');
    return damageOf(g, 1);
  };
  assert.equal(hit(4), 40);
  assert.equal(hit(3), 240);
  assert.equal(hit(0), 240);
});

// ------------------------------------------------------------------ Wo-Chien

test("Wo-Chien, Hazardous Greed: 20 damage, and with 3 or fewer cards in your deck 120 damage to 2 of the opponent's Benched Pokémon", () => {
  const dk = deck(WOCHIEN, URSA, ZOROARK, WOOLOO);
  const sides = (): Sides => [
    { active: 'Wo-Chien', energy: { active: [G, F] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ["N's Zoroark ex", 'Wooloo', 'Bloodmoon Ursaluna ex'] },
  ];
  const g = game(dk, sides());
  deckOf(g, 0, 3);
  choose(g, 'Attack: Hazardous Greed');
  assert.equal(damageOf(g, 1), 20);
  assert.deepEqual(labels(g).sort(), ['Bloodmoon Ursaluna ex', "N's Zoroark ex", 'Wooloo']);
  pick(g, ["N's Zoroark ex", 'Bloodmoon Ursaluna ex']);
  // "(Don't apply Weakness and Resistance for Benched Pokémon.)" N's Zoroark ex is weak to {G}: still 120, not 240.
  assert.equal(damageOf(g, 1, 0), 120);
  assert.equal(damageOf(g, 1, 1), 0, 'the unchosen Benched Pokémon');
  assert.equal(damageOf(g, 1, 2), 120);
  // 4 cards: no bench damage.
  const four = game(dk, sides());
  deckOf(four, 0, 4);
  choose(four, 'Attack: Hazardous Greed');
  assert.equal(damageOf(four, 1), 20);
  assert.equal([0, 1, 2].reduce((n, i) => n + damageOf(four, 1, i), 0), 0);
  // With only 1 Benched Pokémon, that one takes it.
  const one = game(dk, [{ active: 'Wo-Chien', energy: { active: [G, F] } }, { active: 'Bloodmoon Ursaluna ex', bench: ['Bloodmoon Ursaluna ex'] }]);
  deckOf(one, 0, 2);
  choose(one, 'Attack: Hazardous Greed');
  assert.equal(damageOf(one, 1, 0), 120);
});

test('Wo-Chien, Entangling Whip: 130 damage, then discard the top 3 cards of your deck', () => {
  const dk = deck(WOCHIEN, URSA);
  const g = game(dk, [{ active: 'Wo-Chien', energy: { active: [G, G, F] }, deckTop: [F, W, P] }, { active: 'Bloodmoon Ursaluna ex' }]);
  const before = g.state.p[0].deck.length;
  choose(g, 'Attack: Entangling Whip');
  assert.equal(damageOf(g, 1), 130);
  assert.equal(g.state.p[0].deck.length, before - 3);
  assert.deepEqual(names(g, g.state.p[0].discard), [F, P, W]);
});

test('Wo-Chien, Entangling Whip: discarding the last cards of your deck while taking your last Prize card is a win (Compendium #2053)', () => {
  const dk = deck(WOCHIEN, WOOLOO);
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2053/): taking the last Prize card ends the game before a draw check occurs.
  const g = game(dk, [{ active: 'Wo-Chien', energy: { active: [G, G, F] }, prizes: 1 }, { active: 'Wooloo', bench: ['Wooloo'] }]);
  deckOf(g, 0, 3);
  choose(g, 'Attack: Entangling Whip');
  assert.equal(g.state.p[0].deck.length, 0);
  assert.ok(g.over);
  assert.equal(g.state.winner, 0);
});

// ------------------------------------------------------------------ Paldean Tauros

test("Paldean Tauros, Spirited Tackle: 90, and 90 more if the opponent's Active Pokémon is a Stage 1 Pokémon", () => {
  const dk = deck(TAUROS, ZOROARK, URSA);
  const hit = (oppActive: string): number => {
    const g = game(dk, [{ active: 'Paldean Tauros', energy: { active: [F, F, F] } }, { active: oppActive }]);
    choose(g, 'Attack: Spirited Tackle');
    return damageOf(g, 1);
  };
  // Ruling (TPCi Rules Team, https://compendium.pokegym.net/ruling/2046/): a Stage 1 Pokémon put directly into play (not evolved in play) still counts.
  assert.equal(hit("N's Zoroark ex"), 180, 'a Stage 1 Pokémon, placed without evolving');
  assert.equal(hit('Bloodmoon Ursaluna ex'), 90, 'a Basic Pokémon');
});

// ------------------------------------------------------------------ Ho-Oh

test('Ho-Oh, Shining Blaze: 100, and 100 more if you have any Tera Pokémon on your Bench', () => {
  const dk = deck(HOOH, DRAGA, URSA);
  const hit = (mine: Partial<SideLayout>): number => {
    const g = game(dk, [{ active: 'Ho-Oh', energy: { active: [F, F, F] }, ...mine }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Shining Blaze');
    return damageOf(g, 1);
  };
  assert.equal(hit({ bench: ['Dragapult ex'] }), 200, 'a Tera Pokémon on the Bench');
  assert.equal(hit({ bench: ['Bloodmoon Ursaluna ex'] }), 100, 'a non-Tera Pokémon on the Bench');
  assert.equal(hit({}), 100, 'no Bench');
});
