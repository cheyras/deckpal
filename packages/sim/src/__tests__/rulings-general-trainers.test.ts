/**
 * Rulings filed under the Compendium's general Trainer and Energy categories ("*Trainers in General", "Trainers in General",
 * "*Energy Cards In General") that still hold in Standard (regulation marks H, I, J). One scenario test per ruling, named
 * `Compendium #<id>` with a one-line summary in our own words (the ruling text stays on compendium.pokegym.net):
 *
 *  - how a Trainer is played: it sits on the table while it resolves (costs go to the discard pile at once, the card itself last),
 *    every part is done in order before anything is Knocked Out, and a later part still happens when an earlier one finds nothing;
 *  - when a Trainer may be played: more than one a turn, a search that may find nothing, but never one that would do nothing
 *    (nothing to draw, nothing to heal);
 *  - Pokémon Tools: their own Trainer category, not Items; they stay through Evolution;
 *  - "switch in" gust effects are done to the Benched Pokémon;
 *  - Energy: one attachment a turn, to the Active or a Benched Pokémon, never compulsory; a card that provides every type is
 *    still one Energy.
 *
 * Rulings in those categories about mechanics Standard no longer has (Technical Machines stacked as non-Tool Trainers, Trainers
 * attached beside a Tool, Energy-type conversion) or about tournament procedure have no test here. The cards #668 and #1823 need (Grit Energy, Grit Recall, Shove) are defined below.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import type { CardScript } from '../dsl.js';
import { describeOptions } from '../describe.js';
import { advance } from '../flow.js';
import type { Game } from '../game.js';
import { FRAMES } from '../cards/frames-all.js';
import { discardOthers, searchToHand } from '../cards/scripts/helpers.js';
import { scenario, type ScenarioOptions, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { CardFrame, Decision } from '../types.js';
import { POISONED } from '../types.js';
import { DOG, FIGHTING, PSYCHIC, PUP, deck, pokemon } from './fixtures.js';

// ------------------------------------------------------------------ synthetic cards

function trainer(id: string, name: string, ttype: 'Item' | 'Supporter' | 'Stadium' | 'Tool', effect: string): CardFrame {
  return { ...pokemon(id, name, { hp: 10 }), category: 'Trainer', hp: null, stage: null, retreat: null, types: [], trainerType: ttype, effect, attacks: [] };
}
function special(id: string, name: string, effect: string): CardFrame {
  return { ...pokemon(id, name, { hp: 10 }), category: 'Energy', hp: null, stage: null, retreat: null, types: [], energyType: 'Special', effect, attacks: [], weaknesses: [] };
}

const LOCKER: CardFrame = {
  ...pokemon('t-g01', 'Pollen Pup', { hp: 90 }),
  abilities: [{ kind: 'Ability', name: 'Pollen Wall', effect: "Your opponent can't play any Item cards from their hand." }],
} as CardFrame;
const BAND = trainer('t-g10', 'Band', 'Tool', 'Nothing happens.');
const QUICK = trainer('t-g11', 'Quick Draw', 'Item', 'Draw 2 cards.');
const TIDY = trainer('t-g12', 'Tidy Up', 'Supporter', 'Shuffle your hand into your deck. Then, draw 4 cards.');
const SCOUT = trainer('t-g13', 'Energy Scout', 'Item', 'Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck.');
const FINDER = trainer('t-g14', 'Finder', 'Item', 'You can use this card only if you discard 2 other cards from your hand. Put an Item card from your discard pile into your hand.');
const TWOSTEP = trainer('t-g15', 'Two-Step', 'Supporter', 'Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck. Heal 30 damage from your Active Pokémon.');
const SHOCK = trainer('t-g16', 'Shock Swap', 'Item', "Put 3 damage counters on your opponent's Active Pokémon. Then, switch in 1 of your opponent's Benched Pokémon to the Active Spot.");
const ARENA_A = trainer('t-g20', 'Arena A', 'Stadium', "Once during each player's turn, that player may draw a card.");
const ARENA_B = trainer('t-g21', 'Arena B', 'Stadium', "Once during each player's turn, that player may draw a card.");
const RAINBOW = special('t-g30', 'Rainbow Energy', 'As long as this card is attached to a Pokémon, it provides every type of Energy but provides only 1 Energy at a time.');
// For the rulings the engine does not follow yet (see the header): #668 and #1823's "switch out".
const GRIT = special('t-g31', 'Grit Energy', 'As long as this card is attached to a Pokémon, it provides {F} Energy.');
const RECALL = trainer('t-g17', 'Grit Recall', 'Item', 'Put a {F} Energy card from your discard pile into your hand.');
const SHOVE = trainer('t-g18', 'Shove', 'Item', "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)");

const SCRIPTS: CardScript[] = [
  { id: 't-g01', name: 'Pollen Pup', abilities: [{ name: 'Pollen Wall', statics: [{ effect: { k: 'itemLock' }, scope: 'opp' }] }] },
  { id: 't-g10', name: 'Band' },
  { id: 't-g11', name: 'Quick Draw', play: [{ op: 'draw', n: 2 }] },
  { id: 't-g12', name: 'Tidy Up', play: [{ op: 'move', cards: { all: 'hand' }, to: 'deck' }, { op: 'shuffle' }, { op: 'draw', n: 4 }] },
  { id: 't-g13', name: 'Energy Scout', play: searchToHand({ basicEnergy: true }, 1) },
  {
    id: 't-g14',
    name: 'Finder',
    playable: { gte: [{ handSize: 'self' }, 3] },
    play: [...discardOthers(2), { op: 'chooseCards', from: 'discard', filter: { ttype: 'item' }, min: 1, max: 1, as: 'got' }, { op: 'move', cards: 'got', to: 'hand' }],
  },
  { id: 't-g15', name: 'Two-Step', play: [...searchToHand({ cat: 'pokemon' }), { op: 'heal', amount: 30, to: 'myActive' }] },
  {
    id: 't-g16',
    name: 'Shock Swap',
    playable: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] },
    play: [{ op: 'counters', n: 3, to: 'oppActive' }, { op: 'switch', who: 'opp', chooser: 'self' }],
  },
  { id: 't-g20', name: 'Arena A', stadiumAbility: { program: [{ op: 'draw', n: 1 }] } },
  { id: 't-g21', name: 'Arena B', stadiumAbility: { program: [{ op: 'draw', n: 1 }] } },
  { id: 't-g30', name: 'Rainbow Energy', providesAny: { n: 1 } },
  { id: 't-g31', name: 'Grit Energy', provides: ['Fighting'] },
  { id: 't-g17', name: 'Grit Recall', play: [{ op: 'chooseCards', from: 'discard', filter: { providesType: 'Fighting' }, min: 1, max: 1, as: 'got' }, { op: 'move', cards: 'got', to: 'hand' }] },
  { id: 't-g18', name: 'Shove', playable: { gte: [{ pokemon: { zone: 'oppBench' } }, 1] }, play: [{ op: 'switch', who: 'opp', chooser: 'opp' }] },
];

const A = deck('General A', [
  [PUP, 10],
  [DOG, 6],
  [LOCKER, 2],
  [BAND, 2],
  [QUICK, 4],
  [TIDY, 2],
  [SCOUT, 2],
  [FINDER, 2],
  [TWOSTEP, 2],
  [SHOCK, 2],
  [ARENA_A, 2],
  [ARENA_B, 2],
  [RAINBOW, 6],
  [FIGHTING, 12],
  [PSYCHIC, 4],
]);
/** No Basic Energy at all: a search for one finds nothing. */
const NO_BASIC = deck('No Basic Energy', [
  [PUP, 20],
  [DOG, 10],
  [SCOUT, 4],
  [QUICK, 10],
  [RAINBOW, 16],
]);
const frame = (id: string): CardFrame => {
  const f = FRAMES[id];
  assert.ok(f, `no frame for ${id}`);
  return f;
};
/** Real Standard cards, for rulings best shown with one. */
const REAL = deck('Real', [
  [frame('sv07-139'), 4], // Lacey
  [frame('me03-078'), 4], // Lumiose Galette
  [frame('me01-131'), 4], // Ultra Ball
  [frame('me01-114'), 4], // Boss's Orders
  [frame('sv06.5-044'), 4], // Axew
  [frame('sv06.5-045'), 4], // Fraxure (Unnerve)
  [PUP, 12],
  [DOG, 4],
  [FIGHTING, 10],
  [PSYCHIC, 10],
]);
/** For #668: Grit Energy (a Special Energy that provides {F} only while attached) and an Item that wants a {F} Energy card. */
const GRIT_DECK = deck('Grit', [
  [PUP, 20],
  [GRIT, 8],
  [RECALL, 4],
  [FIGHTING, 14],
  [PSYCHIC, 14],
]);
/** For #1823's "switch out": the real cards and Shove. */
const REAL_SHOVE = { name: 'Real + Shove', cards: [...REAL.cards, { frame: SHOVE, count: 4 }] };

// ------------------------------------------------------------------ helpers

function at(sides: [SideLayout, SideLayout], o: ScenarioOptions = {}): Game {
  return scenario(A, A, sides, { scripts: SCRIPTS, ...o });
}
function real(sides: [SideLayout, SideLayout], o: ScenarioOptions = {}): Game {
  return scenario(REAL, REAL, sides, o);
}
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
function chooseExact(g: Game, text: string): void {
  const i = labels(g).indexOf(text);
  assert.ok(i >= 0, `no option "${text}" in: ${labels(g).join(' | ')}`);
  g.submit([i]);
}
const nameOf = (g: Game, c: number): string => def(g.ctx, c).name;
const names = (g: Game, cards: readonly number[]): string[] => cards.map((c) => nameOf(g, c)).sort();
const inHand = (g: Game, p: 0 | 1, name: string): number => {
  const c = g.state.p[p].hand.find((x) => nameOf(g, x) === name);
  assert.ok(c !== undefined, `no ${name} in P${p + 1}'s hand`);
  return c;
};
function setStadium(g: Game, owner: 0 | 1, name: string): void {
  const dk = g.state.p[owner].deck;
  const i = dk.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in the deck`);
  g.state.stadium = { card: dk.splice(i, 1)[0] as number, owner };
  g.state.pending = null;
  advance(g.envForInternals, g.state);
}

// ------------------------------------------------------------------ playing a Trainer

test('Compendium #916: a played Trainer sits on the table while it resolves; its cost goes to the discard pile at once, the card itself only at the end', () => {
  // https://compendium.pokegym.net/ruling/916/ -- Ultra Ball: the two discarded cards are in the discard pile before the search, Ultra Ball goes there last.
  const g = real([{ active: 'Pup', hand: ['Ultra Ball', 'Fighting Energy', 'Psychic Energy'] }, { active: 'Pup' }]);
  const ball = inHand(g, 0, 'Ultra Ball');
  choose(g, 'Play Ultra Ball');
  if (g.decision?.kind === 'cards' && g.decision.player === 0 && /Discard/i.test(g.decision.prompt)) g.submit([0, 1]);
  // Now the deck search: the cost is paid, the Item is in play, not yet discarded.
  assert.equal(g.decision?.kind, 'cards', `the search is asked: ${g.decision?.prompt}`);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Fighting Energy', 'Psychic Energy'], 'the cost is already in the discard pile');
  assert.ok(g.state.limbo.includes(ball), 'Ultra Ball is on the table while it resolves');
  assert.ok(!g.state.p[0].discard.includes(ball));
  g.submit([0]);
  const ps = g.state.p[0];
  assert.equal(ps.hand.length, 1, 'the Pokémon found');
  assert.equal(def(g.ctx, ps.hand[0]!).kind, 'pokemon');
  assert.equal(ps.discard[ps.discard.length - 1], ball, 'Ultra Ball goes to the discard pile after everything else');
  assert.ok(!g.state.limbo.includes(ball));
});

test('Compendium #919: a Trainer that takes an Item from the discard pile cannot take itself, though a card it discarded as its cost can be taken', () => {
  // https://compendium.pokegym.net/ruling/919/ -- cost, then effect, then the card is discarded: it is not in the discard pile while its effect looks there.
  const g = at([{ active: 'Pup', hand: ['Finder', 'Quick Draw', 'Fighting Energy'] }, { active: 'Pup' }]);
  const finder = inHand(g, 0, 'Finder');
  assert.equal(g.state.p[0].discard.length, 0);
  choose(g, 'Play Finder');
  if (g.decision?.kind === 'cards' && /Discard/i.test(g.decision.prompt)) g.submit([0, 1]);
  if (g.decision?.kind === 'cards') {
    assert.deepEqual(labels(g), ['Quick Draw'], 'only the Item discarded as the cost: Finder itself is not in the discard pile yet');
    g.submit([0]);
  }
  const ps = g.state.p[0];
  assert.deepEqual(names(g, ps.hand), ['Quick Draw']);
  assert.deepEqual(names(g, ps.discard), ['Fighting Energy', 'Finder']);
  assert.equal(ps.discard[ps.discard.length - 1], finder);
});

test('Compendium #931: a Trainer that shuffles your hand into your deck is not shuffled in with it; it goes to the discard pile', () => {
  // https://compendium.pokegym.net/ruling/931/ -- once played the card is on the table, not in the hand.
  const g = at([{ active: 'Pup', hand: ['Tidy Up', 'Fighting Energy', 'Psychic Energy'] }, { active: 'Pup' }]);
  const tidy = inHand(g, 0, 'Tidy Up');
  const deckBefore = g.state.p[0].deck.length;
  choose(g, 'Play Tidy Up');
  const ps = g.state.p[0];
  assert.equal(ps.hand.length, 4);
  assert.equal(ps.deck.length, deckBefore + 2 - 4, 'the 2 other cards went into the deck, 4 came out');
  assert.ok(ps.discard.includes(tidy), 'Tidy Up is in the discard pile');
  assert.ok(!ps.deck.includes(tidy) && !ps.hand.includes(tidy));
});

test('Compendium #930: a hand of no cards can still be shuffled into the deck, so the deck is shuffled before the draw', () => {
  // https://compendium.pokegym.net/ruling/930/ -- Lacey as the only card in hand: playable, the deck is shuffled, then 4 cards are drawn.
  const g = real([{ active: 'Pup', hand: ['Lacey'] }, { active: 'Pup' }], { events: true });
  assert.ok(has(g, 'Play Lacey'), 'playable with nothing else in hand');
  const from = g.events.length;
  choose(g, 'Play Lacey');
  const ev = g.events.slice(from);
  const shuffle = ev.findIndex((e) => e.type === 'shuffle' && e.player === 0);
  const draw = ev.findIndex((e) => e.type === 'draw' && e.player === 0);
  assert.ok(shuffle >= 0, 'the deck was shuffled');
  assert.ok(draw > shuffle, 'before the draw');
  assert.equal(g.state.p[0].hand.length, 4);
});

test('Compendium #918: every part of a Trainer is done before any Knock Out is checked', () => {
  // https://compendium.pokegym.net/ruling/918/ -- 3 counters would Knock Out the Active, but the switch in the same card happens first; the
  // Pokémon is Knocked Out on the Bench afterwards, so its player never chooses a new Active Pokémon.
  const g = at([{ active: 'Pup', hand: ['Shock Swap'] }, { active: 'Pup', damage: { active: 40 }, bench: ['Dog', 'Pup'] }]);
  const hit = g.state.p[1].active!;
  choose(g, 'Play Shock Swap');
  assert.equal(g.decision?.kind, 'slots', `the switch is asked before any Knock Out: ${g.decision?.prompt}`);
  assert.equal(g.decision?.player, 0, 'and it is the player of the Item who chooses');
  choose(g, 'Dog');
  const opp = g.state.p[1];
  assert.equal(nameOf(g, topCard(opp.active!)), 'Dog', 'Dog came in');
  assert.ok(!opp.bench.includes(hit), 'the Pup with 70 damage was Knocked Out from the Bench');
  assert.ok(opp.discard.includes(topCard(hit)));
  assert.equal(opp.bench.length, 1);
  assert.equal(g.state.p[0].prizes.length, 5, 'a Prize card for the Knock Out');
  assert.equal(g.decision?.player, 0);
  assert.equal(g.decision?.kind, 'main', 'no new Active Pokémon to promote');
});

test('Compendium #922: a Trainer with several parts does them in order, and a part that can do nothing does not stop the next one', () => {
  // https://compendium.pokegym.net/ruling/922/ -- (asked about a Tag Team Supporter; the order rule is every Trainer's) an empty deck: the
  // search finds nothing, the heal still happens.
  const g = at([{ active: 'Pup', damage: { active: 40 }, hand: ['Two-Step'], emptyDeck: true }, { active: 'Pup' }]);
  assert.equal(g.state.p[0].deck.length, 0);
  assert.ok(has(g, 'Play Two-Step'), 'playable: the heal is still something it does');
  choose(g, 'Play Two-Step');
  assert.equal(g.state.p[0].active!.damage, 10, 'healed 30');
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Two-Step'));
});

// ------------------------------------------------------------------ when a Trainer may be played

test('Compendium #920: a player may play more than one Trainer card in a turn', () => {
  // https://compendium.pokegym.net/ruling/920/ -- two Items and a Supporter in the same turn.
  const g = at([{ active: 'Pup', hand: ['Quick Draw', 'Quick Draw', 'Tidy Up'], deckTop: ['Fighting Energy', 'Fighting Energy', 'Fighting Energy', 'Fighting Energy'] }, { active: 'Pup' }]);
  choose(g, 'Play Quick Draw');
  assert.ok(has(g, 'Play Quick Draw'), 'a second Item');
  choose(g, 'Play Quick Draw');
  assert.ok(has(g, 'Play Tidy Up'), 'and a Supporter');
  choose(g, 'Play Tidy Up');
  assert.deepEqual(names(g, g.state.p[0].discard), ['Quick Draw', 'Quick Draw', 'Tidy Up']);
});

test('Compendium #929: a deck search may be played when the deck holds nothing it can find; the card still goes to the discard pile', () => {
  // https://compendium.pokegym.net/ruling/929/ -- a search for a Basic Energy in a deck with none: it finds nothing, and the Item is discarded, not returned.
  const g = scenario(NO_BASIC, A, [{ active: 'Pup', hand: ['Energy Scout'] }, { active: 'Pup' }], { scripts: SCRIPTS });
  const scout = inHand(g, 0, 'Energy Scout');
  assert.ok(has(g, 'Play Energy Scout'), 'offered: the deck is not empty, and a search can come up empty');
  choose(g, 'Play Energy Scout');
  if (g.decision?.kind === 'cards') {
    assert.deepEqual(labels(g), [], 'nothing to find');
    g.submit([]);
  }
  assert.equal(g.state.p[0].hand.length, 0, 'not put back into the hand');
  assert.ok(g.state.p[0].discard.includes(scout));
  assert.equal(g.decision?.kind, 'main');
});

test('Compendium #924: a Trainer that only draws or searches cannot be played with an empty deck', () => {
  // https://compendium.pokegym.net/ruling/924/ -- it is known to have no effect.
  const g = at([{ active: 'Pup', hand: ['Quick Draw'], emptyDeck: true }, { active: 'Pup' }]);
  assert.equal(g.state.p[0].deck.length, 0);
  assert.ok(!has(g, 'Play Quick Draw'), 'nothing to draw');
  const control = at([{ active: 'Pup', hand: ['Quick Draw'] }, { active: 'Pup' }]);
  assert.ok(has(control, 'Play Quick Draw'), 'control: with a deck it is offered');
});

test('Compendium #925: a Trainer that plainly would do nothing cannot be played (healing an Active Pokémon with no damage and no Special Condition)', () => {
  // https://compendium.pokegym.net/ruling/925/ -- Lumiose Galette (heal 20 and remove a Special Condition from the Active Pokémon) as the modern example.
  const fresh = real([{ active: 'Pup', bench: ['Pup'], damage: { 0: 30 }, hand: ['Lumiose Galette'] }, { active: 'Pup' }]);
  assert.ok(!has(fresh, 'Play Lumiose Galette'), 'nothing to heal or remove on the Active Pokémon (damage on the Bench does not count)');
  const hurt = real([{ active: 'Pup', damage: { active: 10 }, hand: ['Lumiose Galette'] }, { active: 'Pup' }]);
  assert.ok(has(hurt, 'Play Lumiose Galette'), 'damaged');
  const sick = real([{ active: 'Pup', cond: POISONED, hand: ['Lumiose Galette'] }, { active: 'Pup' }]);
  assert.ok(has(sick, 'Play Lumiose Galette'), 'a Special Condition to remove');
});

// ------------------------------------------------------------------ Tools, Stadiums, gusting

test('Compendium #1814: a Pokémon Tool is its own Trainer category, not an Item: an Item lock does not stop it and an Item search does not find it', () => {
  // https://compendium.pokegym.net/ruling/1814/ -- since Scarlet & Violet, Tools (old ones by errata) are not Item cards.
  const g = at([{ active: 'Pup', hand: ['Band', 'Quick Draw'] }, { active: 'Pollen Pup' }]);
  assert.ok(!has(g, 'Play Quick Draw'), 'the Item is locked');
  assert.ok(has(g, 'Attach Band to Pup (Active)'), 'the Tool is not');
  choose(g, 'Attach Band');
  assert.deepEqual(names(g, g.state.p[0].active!.tools), ['Band']);
  const free = at([{ active: 'Pup', hand: ['Quick Draw'] }, { active: 'Pup' }]);
  assert.ok(has(free, 'Play Quick Draw'), 'control: no lock, the Item is offered');
  // An "Item card" from the discard pile: a Tool there is not one.
  const s = at([{ active: 'Pup', hand: ['Finder', 'Fighting Energy', 'Psychic Energy'], discard: ['Band'] }, { active: 'Pup' }]);
  choose(s, 'Play Finder');
  if (s.decision?.kind === 'cards' && /Discard/i.test(s.decision.prompt)) s.submit([0, 1]);
  if (s.decision?.kind === 'cards') assert.ok(!labels(s).includes('Band'), `the Tool is not offered as an Item: ${labels(s).join(' | ')}`);
  assert.equal(s.state.p[0].hand.length, 0);
  assert.ok(s.state.p[0].discard.some((c) => nameOf(s, c) === 'Band'), 'the Tool stays in the discard pile');
});

test('Compendium #927: a Pokémon Tool stays attached when the Pokémon evolves', () => {
  // https://compendium.pokegym.net/ruling/927/
  const g = at([{ active: 'Pup', tools: { active: ['Band'] }, hand: ['Dog'] }, { active: 'Pup' }]);
  choose(g, 'Evolve Pup (Active) into Dog');
  const a = g.state.p[0].active!;
  assert.equal(nameOf(g, topCard(a)), 'Dog');
  assert.deepEqual(names(g, a.tools), ['Band']);
});

test('Compendium #1823: a "switch in" gust is an effect on the Benched Pokémon: a protected Active Pokémon does not stop it, a protected Benched one cannot be brought up', () => {
  // https://compendium.pokegym.net/ruling/1823/ -- Boss's Orders against Fraxure (Unnerve: no effects of the opponent's Items or Supporters on it).
  const g = real([{ active: 'Pup', hand: ["Boss's Orders"] }, { active: 'Axew', evolve: { active: ['Fraxure'] }, bench: ['Pup', 'Axew'] }]);
  choose(g, "Play Boss's Orders");
  choose(g, 'Pup');
  assert.equal(nameOf(g, topCard(g.state.p[1].active!)), 'Pup', 'the Benched Pup came in past the protected Active Fraxure');
  assert.ok(g.state.p[1].bench.some((b) => nameOf(g, topCard(b)) === 'Fraxure'), 'Fraxure went to the Bench');
  const b = real([{ active: 'Pup', hand: ["Boss's Orders"] }, { active: 'Pup', bench: ['Axew', 'Pup'], evolve: { 0: ['Fraxure'] } }]);
  choose(b, "Play Boss's Orders");
  choose(b, 'Fraxure');
  assert.equal(nameOf(b, topCard(b.state.p[1].active!)), 'Pup', 'the protected Benched Fraxure is not switched in');
});

// ------------------------------------------------------------------ Energy

test('Compendium #661: Energy may be attached to a Benched Pokémon', () => {
  // https://compendium.pokegym.net/ruling/661/
  const g = at([{ active: 'Pup', bench: ['Dog'], hand: ['Fighting Energy'] }, { active: 'Pup' }]);
  assert.ok(has(g, 'Attach Fighting Energy to Pup (Active)'));
  chooseExact(g, 'Attach Fighting Energy to Dog');
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), ['Fighting Energy']);
  assert.equal(g.state.p[0].active!.energy.length, 0);
});

test('Compendium #662: only one Energy card may be attached from the hand each turn, Special Energy included', () => {
  // https://compendium.pokegym.net/ruling/662/ -- a Special Energy and then a Basic one in the same turn: no.
  const g = at([{ active: 'Pup', bench: ['Pup'], hand: ['Rainbow Energy', 'Fighting Energy'] }, { active: 'Pup' }]);
  choose(g, 'Attach Rainbow Energy to Pup (Active)');
  assert.ok(!labels(g).some((l) => l.startsWith('Attach')), `no second attachment: ${labels(g).join(' | ')}`);
  const b = at([{ active: 'Pup', hand: ['Fighting Energy', 'Rainbow Energy'] }, { active: 'Pup' }]);
  choose(b, 'Attach Fighting Energy');
  assert.ok(!has(b, 'Attach Rainbow Energy'), 'nor the other way round');
});

test('Compendium #664: a player never has to attach Energy or attack; the turn can end without either', () => {
  // https://compendium.pokegym.net/ruling/664/
  const g = at([{ active: 'Pup', energy: { active: ['Fighting Energy'] }, hand: ['Fighting Energy'] }, { active: 'Pup' }]);
  assert.ok(has(g, 'Attach Fighting Energy') && has(g, 'Attack: Bite'), 'both are possible');
  chooseExact(g, 'End turn');
  assert.equal(g.state.current, 1, "the opponent's turn");
  assert.ok(g.state.p[0].hand.some((c) => nameOf(g, c) === 'Fighting Energy'), 'the Energy stayed in hand');
  assert.equal(g.state.p[1].active!.damage, 0, 'no attack');
});

test('Compendium #669: an Energy card provides as many Energy as it shows, however many types: an every-type card is still 1 Energy', () => {
  // https://compendium.pokegym.net/ruling/669/ -- Rainbow Energy alone pays a one-Energy attack, not Pup's two-Energy Headbutt.
  const g = at([{ active: 'Pup', energy: { active: ['Rainbow Energy'] } }, { active: 'Pup' }]);
  assert.ok(has(g, 'Attack: Bite'), '{C}: paid');
  assert.ok(!has(g, 'Attack: Headbutt'), '{F}{C}: one card providing every type is one Energy');
  const two = at([{ active: 'Pup', energy: { active: ['Rainbow Energy', 'Fighting Energy'] } }, { active: 'Pup' }]);
  assert.ok(has(two, 'Attack: Headbutt'), 'control: with a second Energy it is paid');
});

test("Compendium #926: after using the Stadium in play, a player may play a Stadium with another name and use the new one's effect too", () => {
  // "Once during each player's turn" belongs to the Stadium card: the new one has not been used.
  const g = at([{ active: "Pup", hand: ["Arena B"] }, { active: "Pup" }]);
  setStadium(g, 1, "Arena A");
  const hand = g.state.p[0].hand.length;
  choose(g, "Use the Stadium (Arena A)");
  if (g.decision?.kind === "yesno") g.submit([0]);
  assert.equal(g.state.p[0].hand.length, hand + 1, "drew with Arena A");
  choose(g, "Play Arena B");
  assert.equal(nameOf(g, g.state.stadium!.card), "Arena B");
  assert.ok(has(g, "Use the Stadium (Arena B)"), `the new Stadium's effect is offered: ${labels(g).join(" | ")}`);
  choose(g, "Use the Stadium (Arena B)");
  if (g.decision?.kind === "yesno") g.submit([0]);
  assert.equal(g.state.p[0].hand.length, hand + 1, "played Arena B (-1), drew with it (+1)");
  assert.ok(!has(g, "Use the Stadium"), "and that one is used for the turn");
});



test('Compendium #1823: a "switch out" of the opponent\'s Active Pokémon is an effect on that Pokémon: one protected from the opponent\'s Item effects stays Active', () => {
  // The wording "switch out" marks an effect on the Active Pokémon (Fraxure, Unnerve); Boss's Orders' "switch in" acts on the Benched one.
  const mk = (protectedActive: boolean): Game =>
    scenario(REAL_SHOVE, REAL_SHOVE, [{ active: 'Pup', hand: ['Shove'] }, { active: 'Axew', ...(protectedActive ? { evolve: { active: ['Fraxure'] } } : {}), bench: ['Pup'] }], { scripts: SCRIPTS });
  const g = mk(true);
  choose(g, 'Play Shove');
  assert.equal(nameOf(g, g.state.p[1].active!.cards.at(-1)!), 'Fraxure', 'the protected Active Pokémon is not switched out');
  const c = mk(false);
  choose(c, 'Play Shove');
  assert.equal(nameOf(c, c.state.p[1].active!.cards.at(-1)!), 'Pup', 'control: an unprotected Active Pokémon is switched out');
});

test('Compendium #668: a Special Energy that provides a type only while attached is not an Energy card of that type in the discard pile', () => {
  // "a {F} Energy card from your discard pile" finds the Basic one, not Grit Energy; attached, Grit Energy does provide {F}.
  const g = scenario(GRIT_DECK, GRIT_DECK, [{ active: 'Pup', hand: ['Grit Recall'], discard: ['Grit Energy', 'Fighting Energy'] }, { active: 'Pup' }], { scripts: SCRIPTS });
  choose(g, 'Play Grit Recall');
  if (g.decision?.kind === 'cards') {
    assert.deepEqual(labels(g), ['Fighting Energy'], 'only the Basic {F} Energy');
    g.submit([0]);
  }
  assert.deepEqual(names(g, g.state.p[0].hand), ['Fighting Energy']);
  assert.ok(g.state.p[0].discard.some((c) => nameOf(g, c) === 'Grit Energy'), 'Grit Energy stays in the discard pile');
  const on = scenario(GRIT_DECK, GRIT_DECK, [{ active: 'Pup', energy: { active: ['Grit Energy', 'Psychic Energy'] } }, { active: 'Pup' }], { scripts: SCRIPTS });
  assert.ok(has(on, 'Attack: Headbutt'), 'attached, it does provide {F}');
});
