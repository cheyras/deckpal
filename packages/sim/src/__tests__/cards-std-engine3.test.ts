/**
 * Card tests, batch "std-engine3": every card scripted in cards/scripts/std-engine3.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.
 * The engine features themselves are tested in engine-features-3.test.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { StaticEffect } from '../dsl.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { hasNoAbilities } from '../query.js';
import { scenario, type SideLayout } from '../scenario.js';
import { findSlot } from '../state.js';
import { CONFUSED, POISONED, type Decision } from '../types.js';
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
/** Answer pending questions with their first options until the player is back at the main decision. */
function settle(g: Game): void {
  for (let i = 0; i < 20 && g.decision && g.decision.kind !== 'main'; i++) g.submit(g.decision.min > 0 ? Array.from({ length: g.decision.min }, (_, k) => k) : []);
}
const nameOf = (g: Game, card: number): string => def(g.ctx, card).name;
const names = (g: Game, cards: number[]): string[] => cards.map((c) => nameOf(g, c));
/** The legal actions were listed when the position was built: list them again after changing it by hand. */
function refresh(g: Game): void {
  g.state.pending = null;
  advance(g.env, g.state);
}
function inject(g: Game, slotId: number, st: StaticEffect, fromAttack = false): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack, src: 0 });
}
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
/** Put cards (instance ids; the first ends on top) on top of a player's deck, taking them from wherever they are in it. */
function putOnTop(g: Game, p: 0 | 1, ...cards: number[]): void {
  const deck = g.state.p[p].deck;
  for (const c of cards) deck.splice(deck.indexOf(c), 1);
  for (const c of [...cards].reverse()) deck.push(c);
}
/** The first card of this printing in a player's deck (not yet placed anywhere). */
function iid(g: Game, printing: string, p: 0 | 1 = 0): number {
  const c = g.state.p[p].deck.find((x) => def(g.ctx, x).id === printing);
  assert.ok(c !== undefined, `no ${printing} left in P${p + 1}'s deck`);
  return c;
}

/** The first n cards of this printing in P0's deck (distinct instances). */
function some(g: Game, printing: string, n: number): number[] {
  return g.state.p[0].deck.filter((x) => def(g.ctx, x).id === printing).slice(0, n);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
const IDS: Record<string, string> = {
  'Dragapult ex': 'sv06-130',
  Rellor: 'sv08-013',
  'Iron Thorns': 'sv05-062',
  'Scream Tail': 'sv05-077',
  'Iron Crown ex': 'sv05-081',
  'Iron Valiant': 'sv05-080',
  'Great Tusk': 'sv05-097',
  'Roaring Moon': 'sv05-109',
  Koraidon: 'sv05-119',
  'Awakening Drum': 'sv05-141',
  Miraidon: 'sv05-121',
  'Iron Moth': 'sv06.5-009',
  'Slither Wing': 'sv06.5-026',
  'Iron Thorns ex': 'sv06-077',
  'Bubbly Water Energy': 'me04-084',
  Slowpoke: 'mep-086',
  Squirtle: 'mep-039',
  'Mega Dragalge ex': 'me04-065',
  Crobat: 'sv06.5-029',
  Lanturn: 'sv07-049',
  'Mega Slowbro ex': 'me05-031',
  'Iron Boulder ex': 'sv05-099',
  Hypno: 'sv06.5-017',
  Pachirisu: 'me01-051',
  Octillery: 'me04-017',
  'Mist Energy': 'sv05-161',
  'Legacy Energy': 'sv06-167',
  "Hero's Cape": 'sv05-152',
  "Janine's Secret Art": 'sv06.5-059',
  "Ciphermaniac's Codebreaking": 'sv05-145',
  "Explorer's Guidance": 'sv05-147',
  "Boss's Orders": 'me01-114',
  'Mega Clefable ex': 'me03-031',
  'Mega Kangaskhan ex': 'me01-104',
  Switch: 'me01-130',
};
/** A test deck of the named cards (4 of each) plus plenty of every basic Energy. */
function deck(...cards: string[]) {
  return fromIds('engine3', [...[...new Set(cards)].map((n): [string, number] => [IDS[n] ?? n, 4]), ...ENERGY]);
}
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
const REL = 'Rellor'; // Basic 40 HP
const P = 'Psychic Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Iron Thorns

test('Iron Thorns, Destructo-Press: 70 damage for each Future card among the top 5, those are discarded, the rest shuffled back (tags are per printing)', () => {
  const dk = fromIds('thorns', [['sv05-062', 4], ['sv05-121', 4], ['me05-028', 4], ['sv05-080', 4], ['sv08-013', 8], ['sv06-130', 4], ...ENERGY]);
  const mk = (top: (g: Game) => number[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Iron Thorns', energy: { active: [L, F] } }, { active: DRA }]);
    putOnTop(g, 0, ...top(g));
    return g;
  };
  // Future: Miraidon (sv05-121), Iron Valiant, Iron Thorns. Not Future: the other printing of Miraidon (me05-028), Rellor.
  const g = mk((x) => [iid(x, 'sv05-121'), iid(x, 'me05-028'), iid(x, 'sv05-080'), iid(x, 'sv08-013'), iid(x, 'sv05-062')]);
  const top5 = g.state.p[0].deck.slice(-5);
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Attack: Destructo-Press');
  assert.equal(dmg(g, 1), 210, '3 Future cards x 70 (the untagged Miraidon printing does not count)');
  assert.deepEqual(names(g, g.state.p[0].discard).sort(), ['Iron Thorns', 'Iron Valiant', 'Miraidon'], 'the Future cards are discarded');
  assert.ok(g.state.p[0].discard.every((c) => top5.includes(c)));
  assert.equal(g.state.p[0].deck.length, deckBefore - 3, 'the other two went back into the deck');
  assert.ok(top5.filter((c) => !g.state.p[0].discard.includes(c)).every((c) => g.state.p[0].deck.includes(c)));
  // None: no damage, nothing discarded.
  const none = mk((x) => [...some(x, 'me05-028', 2), ...some(x, 'sv08-013', 2), ...some(x, 'sv06-130', 1)]);
  const top = none.state.p[0].deck.slice(-5);
  assert.ok(top.every((c) => def(none.ctx, c).tag === null), 'the top 5 has no Future card');
  choose(none, 'Attack: Destructo-Press');
  assert.equal(dmg(none, 1), 0);
  assert.equal(none.state.p[0].discard.length, 0);
  // The attack is not usable without {L}{C}.
  const weak = scenario(dk, dk, [{ active: 'Iron Thorns', energy: { active: [F] } }, { active: DRA }]);
  assert.ok(!has(weak, 'Destructo-Press'));
});

// ------------------------------------------------------------------ Scream Tail

test('Scream Tail, Supportive Singing: heals 100 from 1 of your Benched Ancient Pokémon, not an untagged one', () => {
  const dk = deck('Scream Tail', 'Great Tusk', 'Roaring Moon', REL, DRA);
  const g = scenario(dk, dk, [
    { active: 'Scream Tail', energy: { active: [P] }, bench: ['Great Tusk', 'Roaring Moon', REL], damage: { active: 30, 0: 130, 1: 60, 2: 20 } },
    { active: DRA },
  ]);
  choose(g, 'Attack: Supportive Singing');
  assert.equal(g.decision?.kind, 'slots', 'a choice between the two Ancient Benched Pokémon');
  assert.equal(g.decision?.values?.length, 2, 'Rellor is not Ancient');
  choose(g, 'Roaring Moon');
  const bench = g.state.p[0].bench;
  assert.equal(bench[1]!.damage, 0, 'Roaring Moon healed (60 -> 0, only what it had)');
  assert.equal(bench[0]!.damage, 130, 'the other Ancient Pokémon is untouched');
  assert.equal(bench[2]!.damage, 20, 'and so is the Rellor');
  assert.equal(g.state.p[0].active!.damage, 30, 'the Active Pokémon, though Ancient, is not Benched');
  // A single Ancient Benched Pokémon: healed with no question. 130 - 100 = 30.
  const one = scenario(dk, dk, [{ active: 'Scream Tail', energy: { active: [P] }, bench: ['Great Tusk', REL], damage: { 0: 130, 1: 20 } }, { active: DRA }]);
  choose(one, 'Attack: Supportive Singing');
  assert.equal(one.state.p[0].bench[0]!.damage, 30);
  // None Ancient: nothing happens (Koraidon me05-047 is not tagged).
  const dk2 = deck('Scream Tail', 'me05-047', DRA);
  const untagged = scenario(dk2, dk2, [{ active: 'Scream Tail', energy: { active: [P] }, bench: ['Koraidon'], damage: { 0: 100 } }, { active: DRA }]);
  choose(untagged, 'Attack: Supportive Singing');
  assert.equal(untagged.state.p[0].bench[0]!.damage, 100, 'the untagged printing is not an Ancient Pokémon');
});

// ------------------------------------------------------------------ Iron Crown ex

test('Iron Crown ex, Cobalt Command: +20 damage to the Active Pokémon for your Future Pokémon, except any Iron Crown ex; works from the Bench', () => {
  const dk = deck('Iron Crown ex', 'Iron Moth', 'Great Tusk', 'Roaring Moon', DRA);
  const hit = (sides: Sides): number => {
    const g = scenario(dk, dk, sides);
    choose(g, 'Attack: ');
    return dmg(g, 1);
  };
  const FUTURE_ATTACKER: SideLayout = { active: 'Iron Moth', energy: { active: [F, F] } }; // Suction {C}{C} 30
  assert.equal(hit([{ ...FUTURE_ATTACKER }, { active: DRA }]), 30, 'no Iron Crown ex in play');
  assert.equal(hit([{ ...FUTURE_ATTACKER, bench: ['Iron Crown ex'] }, { active: DRA }]), 50, '+20 from a Benched Iron Crown ex');
  assert.equal(hit([{ ...FUTURE_ATTACKER, bench: ['Iron Crown ex', 'Iron Crown ex'] }, { active: DRA }]), 70, 'two Abilities, two bonuses');
  // The attack of an Iron Crown ex itself is excluded (Twin Shotels is 50 damage as printed).
  const crown = scenario(dk, dk, [{ active: 'Iron Crown ex', energy: { active: [P, F, F] }, bench: ['Iron Crown ex'] }, { active: DRA }]);
  choose(crown, 'Attack: Twin Shotels');
  assert.equal(dmg(crown, 1), 50, 'except any Iron Crown ex');
  // Only Future Pokémon: Great Tusk (Ancient) and Roaring Moon (Ancient) get no bonus.
  assert.equal(hit([{ active: 'Roaring Moon', energy: { active: [D, D] }, bench: ['Iron Crown ex'] }, { active: DRA }]), 70, 'an Ancient attacker gets nothing');
  // "to your opponent's Active Pokémon": the Bench is not.
  const spread = scenario(dk, dk, [{ active: 'Iron Moth', energy: { active: [F, F] }, bench: ['Iron Crown ex'] }, { active: DRA, bench: ['Great Tusk'] }]);
  choose(spread, 'Attack: Suction');
  assert.equal(spread.state.p[1].bench[0]!.damage, 0);
  // Cobalt Command is an Ability: switched off with the Pokémon's Abilities.
  const off = scenario(dk, dk, [{ active: 'Iron Moth', energy: { active: [F, F] }, bench: ['Iron Crown ex'] }, { active: DRA }]);
  off.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 1, scope: 'oppPokemon', until: 4, fromAttack: false, src: 0 });
  choose(off, 'Attack: Suction');
  assert.equal(dmg(off, 1), 30);
});

test('Iron Crown ex, Twin Shotels: 50 damage to 2 of the opponent\'s Pokémon, ignoring Weakness, Resistance and effects on them', () => {
  const dk = deck('Iron Crown ex', 'Great Tusk', 'Roaring Moon', 'Iron Moth', DRA, REL);
  const g = scenario(dk, dk, [
    { active: 'Iron Crown ex', energy: { active: [P, F, F] } },
    { active: 'Great Tusk', bench: ['Roaring Moon', 'Iron Moth', REL] }, // Great Tusk is weak to {P}
  ]);
  const [tusk, moon, moth] = [g.state.p[1].active!, g.state.p[1].bench[0]!, g.state.p[1].bench[1]!];
  inject(g, tusk.id, { k: 'damageIn', amount: -30 }); // an effect on the Active Pokémon
  inject(g, moon.id, { k: 'preventDamage' }); // and one that would prevent the damage
  inject(g, moth.id, { k: 'damageIn', amount: -30 });
  choose(g, 'Attack: Twin Shotels');
  assert.equal(g.decision?.kind, 'slots', '2 of the 4 Pokémon');
  assert.equal(g.decision?.min, 2);
  assert.equal(g.decision?.max, 2);
  g.submit([0, 1]); // Great Tusk (Active) and Roaring Moon (Benched)
  assert.equal(tusk.damage, 50, 'no Weakness (x2) and no -30');
  assert.equal(moon.damage, 50, 'not prevented');
  assert.equal(moth.damage, 0, 'the other Benched Pokémon was not chosen');
  // Fewer than 2 Pokémon: just the one.
  const solo = scenario(dk, dk, [{ active: 'Iron Crown ex', energy: { active: [P, F, F] } }, { active: DRA }]);
  choose(solo, 'Attack: Twin Shotels');
  assert.equal(dmg(solo, 1), 50);
});

// ------------------------------------------------------------------ Iron Valiant

test('Iron Valiant, Calculation: look at the top 4 cards and put them back in any order', () => {
  const dk = deck('Iron Valiant', 'Great Tusk', 'Roaring Moon', 'Miraidon', REL, DRA);
  const g = scenario(dk, dk, [{ active: 'Iron Valiant', energy: { active: [P] }, deckTop: ['Great Tusk', 'Roaring Moon', 'Miraidon', REL, DRA] }, { active: DRA }]);
  const before = g.state.p[0].deck.slice();
  choose(g, 'Attack: Calculation');
  assert.equal(g.decision?.kind, 'order');
  assert.deepEqual(names(g, g.decision!.values!), ['Great Tusk', 'Roaring Moon', 'Miraidon', 'Rellor'], 'the top 4, top first');
  g.submit([3, 2, 1, 0]);
  const after = g.state.p[0].deck;
  assert.deepEqual(names(g, after.slice(-4).reverse()), ['Rellor', 'Miraidon', 'Roaring Moon', 'Great Tusk'], 'in the order chosen');
  assert.equal(nameOf(g, after[after.length - 5]!), DRA, 'the 5th card is where it was');
  assert.deepEqual(after.slice().sort(), before.slice().sort(), 'nothing left the deck');
});

test('Iron Valiant, Majestic Sword: 100 more damage if you played a Future Supporter card from your hand during this turn', () => {
  const dk = deck('Iron Valiant', "Ciphermaniac's Codebreaking", "Explorer's Guidance", "Boss's Orders", DRA);
  const hit = (played?: string): number => {
    const g = scenario(dk, dk, [{ active: 'Iron Valiant', energy: { active: [P, P, F] }, hand: played ? [played] : [] }, { active: DRA }]);
    if (played) g.state.p[0].playedThisTurn = [g.state.p[0].hand[0]!]; // played from the hand by its owner (these Supporters have no script to play)
    choose(g, 'Attack: Majestic Sword');
    return dmg(g, 1);
  };
  assert.equal(hit(), 100);
  assert.equal(hit("Ciphermaniac's Codebreaking"), 200, 'a Future Supporter');
  assert.equal(hit("Explorer's Guidance"), 100, 'an Ancient Supporter is not a Future one');
  assert.equal(hit("Boss's Orders"), 100, 'a Supporter without a tag');
});

// ------------------------------------------------------------------ Great Tusk

test('Great Tusk, Land Collapse: discard the top card of the opponent\'s deck; 3 more if you played an Ancient Supporter card from your hand this turn', () => {
  const dk = deck('Great Tusk', "Explorer's Guidance", "Ciphermaniac's Codebreaking", DRA);
  const run = (played?: string): Game => {
    const g = scenario(dk, dk, [{ active: 'Great Tusk', energy: { active: [F, F] }, hand: played ? [played] : [] }, { active: DRA }]);
    if (played) g.state.p[0].playedThisTurn = [g.state.p[0].hand[0]!];
    choose(g, 'Attack: Land Collapse');
    return g;
  };
  const plain = scenario(dk, dk, [{ active: 'Great Tusk', energy: { active: [F, F] } }, { active: DRA }]);
  const deck1 = plain.state.p[1].deck.length;
  const top = plain.state.p[1].deck[deck1 - 1]!;
  choose(plain, 'Attack: Land Collapse');
  assert.deepEqual(plain.state.p[1].discard, [top], 'just the top card');
  assert.equal(plain.state.p[1].deck.length, deck1 - 1 - 1, 'one card gone, and the one the opponent drew for its turn');
  const ancient = run("Explorer's Guidance");
  assert.equal(ancient.state.p[1].discard.length, 4, '1 + 3 more');
  assert.equal(ancient.state.p[0].discard.length, 0, 'the opponent\'s cards only');
  assert.equal(run("Ciphermaniac's Codebreaking").state.p[1].discard.length, 1, 'a Future Supporter does not count');
  // Giant Tusk has no effect text: 160 damage.
  const big = scenario(dk, dk, [{ active: 'Great Tusk', energy: { active: [FI, FI, F, F] } }, { active: DRA }]);
  choose(big, 'Attack: Giant Tusk');
  assert.equal(dmg(big, 1), 160);
});

// ------------------------------------------------------------------ Roaring Moon

test('Roaring Moon, Vengeance Fletching: 10 more damage for each Ancient card in your discard pile (cards of any kind; an untagged printing does not count)', () => {
  const dk = deck('Roaring Moon', 'Great Tusk', 'Awakening Drum', 'me05-047', REL, DRA);
  const hit = (discard: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Roaring Moon', energy: { active: [D, D] }, discard }, { active: DRA }]);
    choose(g, 'Attack: Vengeance Fletching');
    return dmg(g, 1);
  };
  assert.equal(hit([]), 70);
  assert.equal(hit(['Great Tusk']), 80);
  assert.equal(hit(['Great Tusk', 'Awakening Drum', 'Koraidon', REL]), 90, 'an Ancient Pokémon and an Ancient Item count; the other Koraidon printing and Rellor do not');
  assert.equal(hit(['Great Tusk', 'Great Tusk', 'Awakening Drum', 'Roaring Moon']), 110);
  // Only YOUR discard pile.
  const opp = scenario(dk, dk, [{ active: 'Roaring Moon', energy: { active: [D, D] } }, { active: DRA, discard: ['Great Tusk', 'Great Tusk'] }]);
  choose(opp, 'Attack: Vengeance Fletching');
  assert.equal(dmg(opp, 1), 70);
});

// ------------------------------------------------------------------ Koraidon

test('Koraidon, Primordial Beatdown: 30 damage for each of your Ancient Pokémon in play', () => {
  const dk = deck('Koraidon', 'Great Tusk', 'Roaring Moon', 'Miraidon', REL, DRA);
  const hit = (bench: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [FI, F] }, bench }, { active: DRA }]);
    choose(g, 'Attack: Primordial Beatdown');
    return dmg(g, 1);
  };
  assert.equal(hit([]), 30, 'Koraidon itself');
  assert.equal(hit(['Great Tusk', 'Roaring Moon']), 90);
  assert.equal(hit(['Great Tusk', 'Miraidon', REL]), 60, 'Future and untagged Pokémon do not count');
  // Only your Pokémon.
  const opp = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [FI, F] } }, { active: 'Great Tusk', bench: ['Roaring Moon'] }]);
  choose(opp, 'Attack: Primordial Beatdown');
  assert.equal(dmg(opp, 1), 30);
});

test('Koraidon, Shred: the damage isn\'t affected by any effects on your opponent\'s Active Pokémon', () => {
  const dk = deck('Koraidon', DRA);
  const g = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [F, FI, F] } }, { active: DRA }]);
  inject(g, g.state.p[1].active!.id, { k: 'damageIn', amount: -50 });
  choose(g, 'Attack: Shred');
  assert.equal(dmg(g, 1), 130, 'the -50 did not apply');
  const p = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [F, FI, F] } }, { active: DRA }]);
  inject(p, p.state.p[1].active!.id, { k: 'preventDamage' });
  choose(p, 'Attack: Shred');
  assert.equal(dmg(p, 1), 130, 'nor did the prevention');
  // The other attack IS affected by them.
  const b = scenario(dk, dk, [{ active: 'Koraidon', energy: { active: [FI, F] } }, { active: DRA }]);
  inject(b, b.state.p[1].active!.id, { k: 'damageIn', amount: -50 });
  choose(b, 'Attack: Primordial Beatdown');
  assert.equal(dmg(b, 1), 0);
});

// ------------------------------------------------------------------ Awakening Drum

test('Awakening Drum: draw a card for each of your Ancient Pokémon in play; not playable with none', () => {
  const dk = deck('Awakening Drum', 'Great Tusk', 'Roaring Moon', 'me05-047', REL, DRA);
  const play = (active: string, bench: string[]): Game => scenario(dk, dk, [{ active, bench, hand: ['Awakening Drum'] }, { active: DRA }]);
  const two = play('Great Tusk', ['Roaring Moon', 'Koraidon', REL]);
  const hand0 = two.state.p[0].hand.length;
  choose(two, 'Play Awakening Drum');
  assert.equal(two.state.p[0].hand.length, hand0 - 1 + 2, 'two Ancient Pokémon: the Koraidon printing without a tag and Rellor do not count');
  const one = play(REL, ['Roaring Moon']);
  choose(one, 'Play Awakening Drum');
  assert.equal(one.state.p[0].hand.length, 1, 'the Drum went, one card drawn');
  // No Ancient Pokémon: it would do nothing, so it can't be played (TPCi 2014-11-13).
  const none = play(REL, ['Koraidon']);
  assert.ok(!has(none, 'Play Awakening Drum'));
});

// ------------------------------------------------------------------ Miraidon

test('Miraidon, Peak Acceleration: search for up to 2 Basic Energy and attach them to your Future Pokémon in any way you like', () => {
  const dk = deck('Miraidon', 'Iron Moth', 'Great Tusk', REL, DRA);
  const g = scenario(dk, dk, [{ active: 'Miraidon', energy: { active: [L] }, bench: ['Iron Moth', 'Great Tusk', REL] }, { active: DRA }]);
  const [mirai, moth, tusk, rel] = [g.state.p[0].active!, ...g.state.p[0].bench];
  choose(g, 'Attack: Peak Acceleration');
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.max, 2);
  assert.equal(g.decision?.min, 0, 'up to 2');
  const options = labels(g);
  const pick = (n: string): number => options.indexOf(n);
  g.submit([pick('Fire Energy'), pick('Water Energy')]);
  // Each card goes to a Future Pokémon of the player's choosing: Miraidon and Iron Moth are the only choices.
  assert.equal(g.decision?.kind, 'slots');
  assert.deepEqual(g.decision!.values!.slice().sort(), [mirai.id, moth!.id].sort());
  choose(g, 'Iron Moth');
  choose(g, 'Iron Moth'); // the second card too: both on one Pokémon is "any way you like"
  assert.deepEqual(names(g, moth!.energy), ['Fire Energy', 'Water Energy']);
  assert.equal(tusk!.energy.length + rel!.energy.length, 0, 'neither Ancient nor untagged Pokémon');
  assert.equal(mirai.energy.length, 1, 'Miraidon kept its one');
  assert.equal(dmg(g, 1), 40, 'and the attack did its 40');
  // up to 2: taking none is allowed.
  const none = scenario(dk, dk, [{ active: 'Miraidon', energy: { active: [L] }, bench: ['Iron Moth'] }, { active: DRA }]);
  choose(none, 'Attack: Peak Acceleration');
  none.submit([]);
  assert.equal(none.state.p[0].bench[0]!.energy.length, 0);
});

// ------------------------------------------------------------------ Iron Moth

test('Iron Moth, Suction: heal from this Pokémon the same amount of damage you did to your opponent\'s Active Pokémon', () => {
  const dk = deck('Iron Moth', DRA, REL);
  const g = scenario(dk, dk, [{ active: 'Iron Moth', energy: { active: [F, F] }, damage: { active: 50 } }, { active: DRA }]);
  choose(g, 'Attack: Suction');
  assert.equal(dmg(g, 1), 30);
  assert.equal(dmg(g, 0), 20, 'healed 30');
  // Only the damage that exists can be healed.
  const less = scenario(dk, dk, [{ active: 'Iron Moth', energy: { active: [F, F] }, damage: { active: 10 } }, { active: DRA }]);
  choose(less, 'Attack: Suction');
  assert.equal(dmg(less, 0), 0);
  // Damage the Defending Pokémon already had is not damage done now; prevented damage heals nothing.
  const pre = scenario(dk, dk, [{ active: 'Iron Moth', energy: { active: [F, F] }, damage: { active: 100 } }, { active: DRA, damage: { active: 200 } }]);
  choose(pre, 'Attack: Suction');
  assert.equal(dmg(pre, 0), 70);
  const prevented = scenario(dk, dk, [{ active: 'Iron Moth', energy: { active: [F, F] }, damage: { active: 100 } }, { active: DRA }]);
  inject(prevented, prevented.state.p[1].active!.id, { k: 'preventDamage' });
  choose(prevented, 'Attack: Suction');
  assert.equal(dmg(prevented, 0), 100, 'no damage done, nothing healed');
});

test('Iron Moth, Anachronism Repulsor: during your opponent\'s next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon', () => {
  const dk = deck('Iron Moth', 'Roaring Moon', 'Great Tusk', 'Koraidon', DRA);
  const run = (attacker: string, energy: string[], attackName: string): Game => {
    const g = scenario(dk, dk, [{ active: 'Iron Moth', energy: { active: [F, F, P] } }, { active: attacker, energy: { active: energy } }]);
    choose(g, 'Attack: Anachronism Repulsor');
    assert.equal(dmg(g, 1), 120);
    if (attackName) choose(g, `Attack: ${attackName}`);
    return g;
  };
  const ancient = run('Roaring Moon', [D, D], 'Vengeance Fletching');
  assert.equal(dmg(ancient, 0), 0, 'an Ancient Pokémon\'s damage is prevented');
  const plain = run(DRA, [P], 'Jet Headbutt');
  assert.equal(dmg(plain, 0), 70, 'any other attacker is not');
  // It ends after the opponent's next turn.
  const later = run('Roaring Moon', [D, D], 'Vengeance Fletching');
  assert.equal(later.state.effects.filter((e) => e.static.k === 'preventDamage').length, 0, 'gone at the end of that turn');
});

// ------------------------------------------------------------------ Slither Wing

test('Slither Wing, Iron Smasher: 120 more damage if your opponent has any Future Pokémon in play', () => {
  const dk = deck('Slither Wing', 'Miraidon', 'Iron Crown ex', 'Great Tusk', REL, DRA);
  const hit = (oppActive: string, oppBench: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Slither Wing', energy: { active: [FI, F] } }, { active: oppActive, bench: oppBench }]);
    choose(g, 'Attack: Iron Smasher');
    return dmg(g, 1);
  };
  assert.equal(hit(DRA, [REL]), 20, 'no Future Pokémon');
  assert.equal(hit(DRA, ['Miraidon']), 140, 'a Benched Future Pokémon');
  assert.equal(hit('Iron Crown ex', []), 140 - 30, 'an Active Future Pokémon (Iron Crown ex resists {F} by 30)');
  assert.equal(hit('Great Tusk', [REL]), 20, 'an Ancient Pokémon is not a Future one');
});

test('Slither Wing, Smashing Wing: discard 2 Energy from this Pokémon', () => {
  const dk = deck('Slither Wing', DRA);
  const g = scenario(dk, dk, [{ active: 'Slither Wing', energy: { active: [FI, FI, F, W] } }, { active: DRA }]);
  choose(g, 'Attack: Smashing Wing');
  assert.equal(dmg(g, 1), 130);
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 2);
  const opts = labels(g);
  g.submit([opts.indexOf('Fire Energy'), opts.indexOf('Water Energy')]);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), ['Fighting Energy', 'Fighting Energy'], 'the two chosen went to the discard pile');
  assert.deepEqual(names(g, g.state.p[0].discard).sort(), ['Fire Energy', 'Water Energy']);
});

// ------------------------------------------------------------------ Iron Thorns ex

test('Iron Thorns ex, Initialization: while Active, Pokémon with a Rule Box (both sides) have no Abilities, except Future Pokémon', () => {
  const dk = deck('Iron Thorns ex', 'Mega Kangaskhan ex', 'Iron Crown ex', REL, DRA);
  const mk = (p0Active: string, p0Bench: string[] = []): Game =>
    scenario(dk, dk, [{ active: p0Active, bench: p0Bench }, { active: 'Mega Kangaskhan ex', bench: ['Iron Crown ex', REL] }], { current: 1, turn: 4 });
  const g = mk('Iron Thorns ex');
  const kanga = g.state.p[1].active!;
  const [crown, rel] = g.state.p[1].bench;
  assert.ok(hasNoAbilities(g.env, g.state, kanga), 'a Rule Box Pokémon has none');
  assert.ok(!hasNoAbilities(g.env, g.state, crown!), 'a Future Pokémon (Iron Crown ex) keeps its Abilities');
  assert.ok(!hasNoAbilities(g.env, g.state, rel!), 'a Pokémon without a Rule Box is not affected');
  assert.ok(!hasNoAbilities(g.env, g.state, g.state.p[0].active!), 'Iron Thorns ex itself (Future) keeps its Abilities');
  assert.ok(!has(g, 'Use Run Errand'), 'so Mega Kangaskhan ex cannot use Run Errand');
  // Not in the Active Spot: no effect.
  const bench = mk(REL, ['Iron Thorns ex']);
  assert.ok(!hasNoAbilities(bench.env, bench.state, bench.state.p[1].active!));
  assert.ok(has(bench, 'Use Run Errand'));
  // Both players' Pokémon: the controller's own Rule Box Pokémon too.
  const own = scenario(dk, dk, [{ active: 'Iron Thorns ex', bench: ['Mega Kangaskhan ex'] }, { active: DRA }]);
  assert.ok(hasNoAbilities(own.env, own.state, own.state.p[0].bench[0]!));
});

test('Iron Thorns ex, Initialization: Luminous Wing takes precedence over Initialization, whichever came into play first (TPCi 2026-03-26, ruling 2309)', () => {
  const dk = deck('Iron Thorns ex', 'Mega Clefable ex', 'Mega Kangaskhan ex');
  for (const clefableSide of [0, 1] as const) {
    const sides: Sides = clefableSide === 0 ? [{ active: 'Mega Clefable ex' }, { active: 'Iron Thorns ex' }] : [{ active: 'Iron Thorns ex' }, { active: 'Mega Clefable ex' }];
    const g = scenario(dk, dk, sides);
    assert.ok(!hasNoAbilities(g.env, g.state, g.state.p[clefableSide].active!), 'Mega Clefable ex keeps Luminous Wing');
  }
  // A Rule Box Pokémon without such an Ability is switched off all the same.
  const g = scenario(dk, dk, [{ active: 'Mega Kangaskhan ex' }, { active: 'Iron Thorns ex' }]);
  assert.ok(hasNoAbilities(g.env, g.state, g.state.p[0].active!));
});

test('Iron Thorns ex, Volt Cyclone: 140 damage, then move an Energy from this Pokémon to 1 of your Benched Pokémon', () => {
  const dk = deck('Iron Thorns ex', REL, 'Great Tusk', DRA);
  const g = scenario(dk, dk, [{ active: 'Iron Thorns ex', energy: { active: [L, L, P, F] }, bench: [REL, 'Great Tusk'] }, { active: DRA }]);
  choose(g, 'Attack: Volt Cyclone');
  assert.equal(dmg(g, 1), 140);
  assert.equal(g.decision?.kind, 'cards', 'which Energy (they differ)');
  choose(g, 'Psychic Energy');
  assert.equal(g.decision?.kind, 'slots', 'to which Benched Pokémon');
  choose(g, 'Great Tusk');
  assert.deepEqual(names(g, g.state.p[0].active!.energy).sort(), ['Fire Energy', 'Lightning Energy', 'Lightning Energy']);
  assert.deepEqual(names(g, g.state.p[0].bench[1]!.energy), ['Psychic Energy']);
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0);
  // With no Benched Pokémon nothing moves.
  const none = scenario(dk, dk, [{ active: 'Iron Thorns ex', energy: { active: [L, L, P] } }, { active: DRA }]);
  choose(none, 'Attack: Volt Cyclone');
  assert.equal(none.state.p[0].active!.energy.length, 3);
});

// ------------------------------------------------------------------ Bubbly Water Energy and Slowpoke

test('Bubbly Water Energy: provides {W}; the {W} Pokémon recovers from all Special Conditions and can\'t be affected by any (ruling 290)', () => {
  const dk = deck('Bubbly Water Energy', 'Squirtle', 'Lanturn', REL, DRA);
  // It provides {W}: Squirtle's Bubble {W} is payable with nothing else.
  const pay = scenario(dk, dk, [{ active: 'Squirtle', energy: { active: ['Bubbly Water Energy'] } }, { active: DRA }]);
  assert.ok(has(pay, 'Attack: Bubble'));
  // Attached from the hand to a Poisoned and Confused {W} Pokémon: it recovers.
  const cure = scenario(dk, dk, [{ active: 'Squirtle', cond: POISONED | CONFUSED, hand: ['Bubbly Water Energy'] }, { active: DRA }]);
  choose(cure, 'Attach Bubbly Water Energy to Squirtle');
  assert.equal(cure.state.p[0].active!.cond, 0, 'recovered from all Special Conditions');
  // Can't be affected: Lanturn's Disorienting Flash does not Confuse it (Compendium #290: the effect is blocked)...
  const flash = (squirtleEnergy: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Squirtle', energy: { active: squirtleEnergy } }, { active: 'Lanturn', energy: { active: [L, L] } }], { current: 1, turn: 4 });
    choose(g, 'Attack: Disorienting Flash');
    return g;
  };
  assert.equal(flash(['Bubbly Water Energy']).state.p[0].active!.cond, 0, 'not Confused');
  assert.ok(flash([W]).state.p[0].active!.cond & CONFUSED, 'without it, Confused');
  // ...but only the {W} Pokémon: on a Rellor it provides {W} and protects nothing.
  const grass = scenario(dk, dk, [{ active: REL, energy: { active: ['Bubbly Water Energy'] } }, { active: 'Lanturn', energy: { active: [L, L] } }], { current: 1, turn: 4 });
  choose(grass, 'Attack: Disorienting Flash');
  assert.ok(grass.state.p[0].active!.cond & CONFUSED, 'Rellor is not a {W} Pokémon');
  // Poison too.
  const poison = scenario(dk, dk, [{ active: 'Squirtle', cond: POISONED, hand: ['Bubbly Water Energy'] }, { active: DRA }]);
  choose(poison, 'Attach Bubbly Water Energy to Squirtle');
  assert.equal(poison.state.p[0].active!.cond & POISONED, 0);
});

test('Slowpoke, Dopey Face: this Pokémon can\'t be Confused (other Special Conditions still apply); lost with its Abilities', () => {
  const dk = deck('Slowpoke', 'Lanturn', 'Mega Dragalge ex', REL, DRA);
  const confuse = (): Game => scenario(dk, dk, [{ active: 'Slowpoke', bench: [REL] }, { active: 'Lanturn', energy: { active: [L, L] } }], { current: 1, turn: 4 });
  const g = confuse();
  choose(g, 'Attack: Disorienting Flash');
  assert.equal(g.state.p[0].active!.cond, 0, 'not Confused');
  // The other conditions do land (Mega Dragalge ex poisons it; the 16 counters Knock out the 80 HP Slowpoke at Checkup).
  const poison = scenario(dk, dk, [{ active: 'Slowpoke', bench: [REL] }, { active: 'Mega Dragalge ex', energy: { active: [W, D] } }], { current: 1, turn: 4 });
  choose(poison, 'Attack: Pernicious Poison');
  assert.ok(poison.state.p[0].discard.some((c) => nameOf(poison, c) === 'Slowpoke'), 'Poisoned (and Knocked Out by its 16 counters at Checkup)');
  // A Confused Slowpoke recovers at once (e.g. it was Confused before its Ability was on).
  const cured = scenario(dk, dk, [{ active: 'Slowpoke', cond: CONFUSED, hand: [P] }, { active: DRA }]);
  choose(cured, 'Attach Psychic Energy');
  assert.equal(cured.state.p[0].active!.cond & CONFUSED, 0);
  // An Ability: with no Abilities it can be Confused.
  const off = confuse();
  off.state.effects.push({ static: { k: 'noAbilities' }, slot: -1, player: 1, scope: 'oppPokemon', until: 5, fromAttack: false, src: 0 });
  choose(off, 'Attack: Disorienting Flash');
  assert.ok(off.state.p[0].active!.cond & CONFUSED);
});

// ------------------------------------------------------------------ Mega Dragalge ex

test('Mega Dragalge ex, Corrosive Liquid: discard all Pokémon Tools and Special Energy from all of your opponent\'s Pokémon', () => {
  const dk = deck('Mega Dragalge ex', "Hero's Cape", 'Legacy Energy', 'Mist Energy', REL, 'Great Tusk', DRA);
  const g = scenario(dk, dk, [
    { active: 'Mega Dragalge ex', energy: { active: ['Legacy Energy', W] }, tools: { active: ["Hero's Cape"] } },
    {
      active: DRA,
      bench: [REL, 'Great Tusk'],
      energy: { active: ['Legacy Energy', P], 0: ['Legacy Energy', F], 1: ['Mist Energy'] },
      tools: { active: ["Hero's Cape"], 0: ["Hero's Cape"], 1: ["Hero's Cape"] },
    },
  ]);
  choose(g, 'Attack: Corrosive Liquid');
  const dra = g.state.p[1].active!;
  const [rel, tusk] = g.state.p[1].bench;
  assert.deepEqual(names(g, dra.energy), ['Psychic Energy'], 'Basic Energy stays on the Active Pokémon');
  assert.equal(dra.tools.length, 0);
  assert.deepEqual(names(g, rel!.energy), ['Fire Energy']);
  assert.equal(rel!.tools.length, 0, 'and on the Bench');
  assert.deepEqual(names(g, tusk!.energy), ['Mist Energy'], 'protected from the effects of attacks: left alone');
  assert.equal(tusk!.tools.length, 1);
  assert.deepEqual(names(g, g.state.p[1].discard).sort(), ["Hero's Cape", "Hero's Cape", 'Legacy Energy', 'Legacy Energy']);
  const own = g.state.p[0].active!;
  assert.equal(own.tools.length, 1, 'its own Tool stays');
  assert.deepEqual(names(g, own.energy), ['Legacy Energy', 'Water Energy'], 'and its own Special Energy');
});

test('Mega Dragalge ex, Pernicious Poison: Poisoned, and 16 damage counters at EVERY Pokémon Checkup (TPCi 2026-06-04, ruling 2373)', () => {
  const dk = deck('Mega Dragalge ex', 'Mist Energy', REL, DRA);
  const g = scenario(dk, dk, [{ active: 'Mega Dragalge ex', energy: { active: [W, D] } }, { active: DRA, bench: [REL] }], { events: true });
  choose(g, 'Attack: Pernicious Poison');
  assert.ok(g.state.p[1].active!.cond & POISONED);
  assert.equal(dmg(g, 1), 160, '16 counters at the first Checkup');
  assert.ok(g.events.some((e) => e.type === 'counters' && e.checkup && e.n === 16));
  choose(g, 'End turn'); // the opponent's turn ends: the second Checkup
  assert.ok(g.state.p[1].discard.some((c) => nameOf(g, c) === DRA), '160 + 160 = 320: Knocked Out at the next Checkup');
  assert.equal(g.state.p[0].prizesTaken, 2, 'and the Prize cards are taken');
  // Protected from the effects of attacks (Mist Energy): not Poisoned.
  const mist = scenario(dk, dk, [{ active: 'Mega Dragalge ex', energy: { active: [W, D] } }, { active: DRA, energy: { active: ['Mist Energy'] } }]);
  choose(mist, 'Attack: Pernicious Poison');
  assert.equal(mist.state.p[1].active!.cond, 0);
  assert.equal(dmg(mist, 1), 0);
});

// ------------------------------------------------------------------ Crobat

test('Crobat, Poison Fang: 120 damage, Poisoned, and 2 damage counters at each Checkup instead of 1', () => {
  const dk = deck('Crobat', DRA);
  const g = scenario(dk, dk, [{ active: 'Crobat', energy: { active: [D, F] } }, { active: DRA }]);
  choose(g, 'Attack: Poison Fang');
  assert.equal(dmg(g, 1), 120 + 20);
  choose(g, 'End turn');
  assert.equal(dmg(g, 1), 120 + 40);
});

test('Crobat, Shadowy Envoy: once during your turn, if you played Janine\'s Secret Art from your hand this turn, draw cards until you have 8 cards in your hand', () => {
  const dk = deck('Crobat', "Janine's Secret Art", REL, DRA);
  const g = scenario(dk, dk, [{ active: 'Crobat', hand: ["Janine's Secret Art", REL, REL, REL] }, { active: DRA }]);
  assert.ok(!has(g, 'Use Shadowy Envoy'), "not before Janine's Secret Art is played");
  choose(g, "Play Janine's Secret Art");
  settle(g);
  assert.equal(g.state.p[0].hand.length, 3);
  assert.ok(has(g, 'Use Shadowy Envoy'), 'now it can be used');
  choose(g, 'Use Shadowy Envoy');
  assert.equal(g.state.p[0].hand.length, 8, 'drew until 8');
  assert.ok(!has(g, 'Use Shadowy Envoy'), 'once during your turn');
  // Another card does not count as Janine's Secret Art.
  const other = scenario(dk, dk, [{ active: 'Crobat', hand: [REL, REL] }, { active: DRA }]);
  other.state.p[0].playedThisTurn = [other.state.p[0].hand[0]!];
  refresh(other);
  assert.ok(!has(other, 'Use Shadowy Envoy'));
  // With 8 or more cards already: nothing to draw (and nothing lost).
  const full = scenario(dk, dk, [{ active: 'Crobat', hand: [F, F, F, F, W, W, W, W, "Janine's Secret Art"] }, { active: DRA }]);
  full.state.p[0].playedThisTurn = [full.state.p[0].hand[full.state.p[0].hand.length - 1]!];
  refresh(full);
  choose(full, 'Use Shadowy Envoy');
  assert.equal(full.state.p[0].hand.length, 9);
});

// ------------------------------------------------------------------ Lanturn

test('Lanturn, Disorienting Flash: Confused, and a failed flip places 8 damage counters instead of 3', () => {
  const dk = deck('Lanturn', DRA);
  const g = scenario(dk, dk, [{ active: 'Lanturn', energy: { active: [L, L] } }, { active: DRA, energy: { active: [P] } }]);
  choose(g, 'Attack: Disorienting Flash');
  assert.ok(g.state.p[1].active!.cond & CONFUSED);
  g.state.forcedCoins = [false];
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 1), 80, '8 damage counters on the Confused Pokémon');
  assert.equal(dmg(g, 0), 0, 'its attack did not happen');
  // Heads: the attack goes ahead and no counters are placed.
  const heads = scenario(dk, dk, [{ active: 'Lanturn', energy: { active: [L, L] } }, { active: DRA, energy: { active: [P] } }]);
  choose(heads, 'Attack: Disorienting Flash');
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Jet Headbutt');
  assert.equal(dmg(heads, 1), 0);
  assert.equal(dmg(heads, 0), 70);
});

test('Lanturn, Thunderous Bolt: 140 damage; during your next turn this Pokémon can\'t attack', () => {
  const dk = deck('Lanturn', DRA);
  const g = scenario(dk, dk, [{ active: 'Lanturn', energy: { active: [L, L, L] } }, { active: DRA }]);
  choose(g, 'Attack: Thunderous Bolt');
  assert.equal(dmg(g, 1), 140);
  choose(g, 'End turn'); // the opponent's turn
  assert.equal(g.state.current, 0);
  assert.ok(!has(g, 'Attack:'), "it can't attack during your next turn");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Thunderous Bolt'), 'and can the turn after');
});

// ------------------------------------------------------------------ Mega Slowbro ex

test("Mega Slowbro ex, Shellnado Spin: 180 damage; if it is damaged by an attack during the opponent's next turn (even if Knocked Out), 12 damage counters on the Attacking Pokémon (ruling 2408)", () => {
  const dk = deck('Mega Slowbro ex', DRA, REL, 'Mist Energy');
  const mk = (oppEnergy: string[], slowbroDamage = 0): Game => {
    const g = scenario(dk, dk, [{ active: 'Mega Slowbro ex', energy: { active: [P, P, P] }, bench: [REL], damage: { active: slowbroDamage } }, { active: DRA, energy: { active: oppEnergy } }]);
    choose(g, 'Attack: Shellnado Spin');
    assert.equal(dmg(g, 1), 180);
    return g;
  };
  const g = mk([P]);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 70, 'the attack damaged Slowbro');
  assert.equal(dmg(g, 1), 180 + 120, '12 damage counters on the Attacking Pokémon');
  // Even if that Knocks it Out.
  const ko = mk([P], 280);
  choose(ko, 'Attack: Jet Headbutt');
  assert.ok(ko.state.p[0].discard.some((c) => nameOf(ko, c) === 'Mega Slowbro ex'), 'Knocked Out');
  assert.equal(dmg(ko, 1), 180 + 120);
  // Ruling (Pitch Black FAQ, TPCi Rules Team 2026-07-16, https://compendium.pokegym.net/ruling/2408/): Mist Energy prevents the counters (an effect of an attack).
  const mist = mk(['Mist Energy']);
  choose(mist, 'Attack: Jet Headbutt');
  assert.equal(dmg(mist, 0), 70, 'the damage was done');
  assert.equal(dmg(mist, 1), 180, 'but the 12 damage counters were blocked');
  // It lasts for that turn only.
  const later = mk([P]);
  choose(later, 'End turn');
  assert.equal(later.state.effects.filter((e) => e.static.k === 'react').length, 0);
});

// ------------------------------------------------------------------ Iron Boulder ex

test("Iron Boulder ex, Repulsor Axe: 60 damage; if it is damaged by an attack during the opponent's next turn, 8 damage counters on the Attacking Pokémon (ruling 1958)", () => {
  const dk = deck('Iron Boulder ex', DRA, REL, 'Mist Energy');
  const mk = (oppEnergy: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Iron Boulder ex', energy: { active: [FI, F] } }, { active: DRA, energy: { active: oppEnergy } }]);
    choose(g, 'Attack: Repulsor Axe');
    assert.equal(dmg(g, 1), 60);
    return g;
  };
  const g = mk([P]);
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 70);
  assert.equal(dmg(g, 1), 60 + 80, '8 damage counters on the Attacking Pokémon');
  // Ruling (Temporal Forces FAQ, TPCi Rules Team 2024-03-21, https://compendium.pokegym.net/ruling/1958/): a Mist Energy on the Attacking Pokémon stops them.
  const mist = mk(['Mist Energy']);
  choose(mist, 'Attack: Jet Headbutt');
  assert.equal(dmg(mist, 0), 70);
  assert.equal(dmg(mist, 1), 60, 'no 8 damage counters');
  // Knocked Out by the attack: still reacts.
  const ko = scenario(dk, dk, [{ active: 'Iron Boulder ex', energy: { active: [FI, F] }, bench: [REL], damage: { active: 200 } }, { active: DRA, energy: { active: [P] } }]);
  choose(ko, 'Attack: Repulsor Axe');
  choose(ko, 'Attack: Jet Headbutt');
  assert.equal(dmg(ko, 1), 60 + 80);
  assert.ok(ko.state.p[0].discard.some((c) => nameOf(ko, c) === 'Iron Boulder ex'));
});

test('Iron Boulder ex, Power Stomp: 200 damage, discard 2 Energy from this Pokémon', () => {
  const dk = deck('Iron Boulder ex', DRA);
  const g = scenario(dk, dk, [{ active: 'Iron Boulder ex', energy: { active: [FI, FI, F, W] } }, { active: DRA }]);
  choose(g, 'Attack: Power Stomp');
  assert.equal(dmg(g, 1), 200);
  const opts = labels(g);
  g.submit([opts.indexOf('Fire Energy'), opts.indexOf('Water Energy')]);
  assert.equal(g.state.p[0].active!.energy.length, 2);
  assert.equal(g.state.p[0].discard.length, 2);
});

// ------------------------------------------------------------------ Hypno

test('Hypno, Daydream: 80 damage; if the opponent attaches an Energy card from their hand to the Defending Pokémon during their next turn, their turn ends', () => {
  const dk = deck('Hypno', DRA, REL);
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: 'Hypno', energy: { active: [P, F] } }, { active: DRA, bench: [REL], energy: { active: [P] }, hand: [F, F] }]);
    choose(g, 'Attack: Daydream');
    assert.equal(dmg(g, 1), 80);
    return g;
  };
  const g = mk();
  assert.equal(g.state.turn, 4);
  choose(g, 'Attach Fire Energy to Dragapult ex (Active)');
  assert.equal(g.state.turn, 5, 'their turn ended');
  assert.equal(g.decision?.player, 0);
  assert.equal(dmg(g, 0), 0, 'with no attack');
  // Another Pokémon, or the new Active Pokémon after a retreat (ruling 2223): their turn goes on.
  const bench = mk();
  choose(bench, 'Attach Fire Energy to Rellor');
  assert.equal(bench.state.turn, 4);
  const retreat = mk();
  choose(retreat, 'Retreat');
  choose(retreat, 'Attach Fire Energy to Rellor (Active)');
  assert.equal(retreat.state.turn, 4);
  assert.equal(retreat.decision?.player, 1);
  // The effect is for that turn only.
  const later = mk();
  choose(later, 'End turn');
  assert.equal(later.state.effects.filter((e) => e.static.k === 'react').length, 0);
});

// ------------------------------------------------------------------ Pachirisu

test('Pachirisu, Electrified Incisors: 10 damage; whenever they attach an Energy card from their hand to the Defending Pokémon during their next turn, 8 damage counters on it (ruling 2223)', () => {
  const dk = deck('Pachirisu', DRA, REL);
  const mk = (): Game => {
    const g = scenario(dk, dk, [{ active: 'Pachirisu', energy: { active: [L] } }, { active: DRA, bench: [REL], energy: { active: [P] }, hand: [F, F] }]);
    choose(g, 'Attack: Electrified Incisors');
    assert.equal(dmg(g, 1), 10);
    return g;
  };
  const g = mk();
  choose(g, 'Attach Fire Energy to Dragapult ex (Active)');
  assert.equal(dmg(g, 1), 10 + 80, '8 damage counters');
  assert.equal(g.decision?.kind, 'main', 'their turn goes on');
  // Benched Pokémon: not the Defending Pokémon.
  const bench = mk();
  choose(bench, 'Attach Fire Energy to Rellor');
  assert.equal(bench.state.p[1].bench[0]!.damage, 0);
  // Ruling (Mega Evolution FAQ, TPCi Rules Team 2025-09-25, https://compendium.pokegym.net/ruling/2223/): "Retreating clears the effect."
  const retreat = mk();
  choose(retreat, 'Retreat');
  choose(retreat, 'Attach Fire Energy to Rellor (Active)');
  assert.equal(retreat.state.p[1].active!.damage, 0, 'the new Active Pokémon is not affected');
  assert.equal(retreat.state.p[1].bench[0]!.damage, 10, 'and nothing was added to the old one');
});

// ------------------------------------------------------------------ Octillery

test("Octillery, Jet of Ink: 30 damage; during the opponent's next turn, if the Defending Pokémon tries to use an attack, the opponent flips 2 coins and if either is tails the attack doesn't happen", () => {
  const dk = deck('Octillery', DRA);
  const mk = (flips: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Octillery', energy: { active: [W] } }, { active: DRA, energy: { active: [P] } }]);
    choose(g, 'Attack: Jet of Ink');
    assert.equal(dmg(g, 1), 30);
    g.state.forcedCoins = flips;
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  assert.equal(dmg(mk([true, true]), 0), 70, 'two heads: it attacks');
  for (const flips of [[true, false], [false, true], [false, false]]) {
    const g = mk(flips);
    assert.equal(dmg(g, 0), 0, `${flips}: the attack doesn't happen`);
    assert.equal(g.state.forcedCoins.length, 0, 'both coins were flipped');
  }
});

test('Octillery, Jet of Ink: flip for the effect first, then for Confusion (TPCi 2026-04-02, ruling 2326)', () => {
  const dk = deck('Octillery', DRA);
  const mk = (flips: boolean[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Octillery', energy: { active: [W] } }, { active: DRA, energy: { active: [P] }, cond: CONFUSED }]);
    choose(g, 'Attack: Jet of Ink');
    g.state.forcedCoins = flips;
    choose(g, 'Attack: Jet Headbutt');
    return g;
  };
  const tailsConfusion = mk([true, true, false]); // heads, heads, then Confusion's tails
  assert.equal(dmg(tailsConfusion, 1), 30 + 30, '3 damage counters on the Confused attacker');
  assert.equal(dmg(tailsConfusion, 0), 0);
  const headsAll = mk([true, true, true]);
  assert.equal(dmg(headsAll, 0), 70);
  const stopped = mk([false, true]); // the effect's coin is tails: the attack never gets to Confusion's flip
  assert.equal(dmg(stopped, 1), 30);
  assert.equal(dmg(stopped, 0), 0);
  assert.equal(stopped.state.forcedCoins.length, 0);
});

test('Octillery, Tantrum: 120 damage; this Pokémon is now Confused', () => {
  const dk = deck('Octillery', DRA);
  const g = scenario(dk, dk, [{ active: 'Octillery', energy: { active: [W, F] } }, { active: DRA }]);
  choose(g, 'Attack: Tantrum');
  assert.equal(dmg(g, 1), 120);
  assert.ok(g.state.p[0].active!.cond & CONFUSED);
});
