/**
 * Card tests, batch "std-c20": every card scripted in cards/scripts/std-c20.ts does what its printed text says in a
 * constructed position. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import { FRAMES } from '../cards/frames-all.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
import { BURNED, CONFUSED, POISONED } from '../types.js';
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
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([0]);
}
function no(g: Game): void {
  assert.equal(g.decision?.kind, 'yesno');
  g.submit([1]);
}
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function activeName(g: Game, p: 0 | 1): string {
  return name(g, topCard(g.state.p[p].active!));
}

const ENERGY_IDS = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'];
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(ids: string[], energyIds: string[] = ENERGY_IDS): DeckInput {
  return fromIds('c20', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...energyIds.map((id): [string, number] => [id, 10])]);
}
/** The card id of the first card with this name. */
function idOf(n: string): string {
  const f = Object.values(FRAMES).find((x) => x.name === n && !x.cardId.startsWith('svp'));
  assert.ok(f, `no card named ${n}`);
  return f.cardId;
}

const HOUNDOOM = 'sv06.5-008';
const KINGDRA = 'sv06.5-012';
const HORSEA = 'sv06.5-010';
const SEADRA = 'sv06.5-011';
const REVAVROOM = 'sv06.5-015';
const DROWZEE = 'sv06.5-016';
const TOXICROAK = 'sv06.5-024';
const URSALUNA = 'sv06.5-025';
const ZUBAT = 'sv06.5-027';
const ZOROARK = 'sv06.5-032';
const INKAY = 'sv06.5-033';
const YVELTAL = 'sv06.5-035';
const OKIDOGI = 'sv06.5-036';
const EEVEE = 'sv06.5-050';
const BEWEAR = 'sv06.5-053';
const LASER = 'sv06.5-058';
// Neutral defenders: no Weakness, no Resistance.
const LATIAS = 'me01-100'; // Mega Latias ex: 280 HP, Dragon
const ETERNATUS = 'sv08-141'; // Eternatus: 150 HP Basic, Dragon
const SNORLAX = 'sv06-136'; // Snorlax: 160 HP, Colorless, weak Fighting; Heavy Impact {C}x5 160
const SLOWPOKE = 'me05-029'; // Slowpoke: 70 HP, Psychic, weak Darkness
const WAILORD = 'sv09-041'; // Wailord: 240 HP Stage 1, Water, weak Lightning

const F = 'Fire Energy';
const W = 'Water Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const L = 'Lightning Energy';

type Sides = [SideLayout, SideLayout];
function G(ids: string[], sides: Sides, o: Parameters<typeof scenario>[3] = {}): Game {
  const dk = deck(ids);
  return scenario(dk, dk, sides, o);
}

// ------------------------------------------------------------------ Houndoom

test('Houndoom, Snarl: 100 damage, and during the opponent\'s next turn the Defending Pokémon\'s attacks do 100 less', () => {
  const g = G([HOUNDOOM, SNORLAX], [
    { active: 'Houndoom', energy: { active: [F, F, F] } },
    { active: 'Snorlax', energy: { active: [F, F, F, F, F] } },
  ]);
  choose(g, 'Attack: Snarl');
  assert.equal(g.state.p[1].active!.damage, 100);
  choose(g, 'Attack: Heavy Impact'); // opponent's turn: 160 - 100
  assert.equal(g.state.p[0].active!.damage, 60);
});

// ------------------------------------------------------------------ Kingdra ex

test('Kingdra ex, King\'s Order: up to 3 {W} Pokémon of any Stage from the discard pile onto the Bench', () => {
  const g = G([KINGDRA, HORSEA, SEADRA, HOUNDOOM, LATIAS], [
    { active: 'Kingdra ex', energy: { active: [W] }, discard: ['Horsea', 'Seadra', 'Kingdra ex', 'Houndoom', 'Water Energy'] },
    { active: 'Mega Latias ex' },
  ]);
  choose(g, "Attack: King's Order");
  const offered = labels(g);
  assert.equal(offered.length, 3, `only the three {W} Pokémon are offered: ${offered.join(' | ')}`);
  assert.ok(!offered.some((l) => l.includes('Houndoom')), 'a {R} Pokémon is not offered');
  pick(g, ['Horsea', 'Seadra']); // up to 3: 2 is allowed
  assert.deepEqual(g.state.p[0].bench.map((b) => name(g, topCard(b))).sort(), ['Horsea', 'Seadra']);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Houndoom', 'Kingdra ex', 'Water Energy']);
});

test('Kingdra ex, King\'s Order: only as many as the Bench has room for', () => {
  const g = G([KINGDRA, HORSEA, SEADRA, SLOWPOKE, LATIAS], [
    { active: 'Kingdra ex', bench: ['Slowpoke', 'Slowpoke', 'Slowpoke', 'Slowpoke'], energy: { active: [W] }, discard: ['Horsea', 'Seadra'] },
    { active: 'Mega Latias ex' },
  ]);
  choose(g, "Attack: King's Order");
  pick(g, ['Horsea']);
  assert.equal(g.state.p[0].bench.length, 5);
});

test('Kingdra ex, Hydro Pump: 50 damage, 50 more for each {W} Energy attached to this Pokémon', () => {
  const g = G([KINGDRA, LATIAS], [{ active: 'Kingdra ex', energy: { active: [W, W, F] } }, { active: 'Mega Latias ex' }]);
  choose(g, 'Attack: Hydro Pump');
  assert.equal(g.state.p[1].active!.damage, 150, '50 + 2 x 50: the {R} Energy does not count');
  const none = G([KINGDRA, LATIAS], [{ active: 'Kingdra ex', energy: { active: [F, F] } }, { active: 'Mega Latias ex' }]);
  choose(none, 'Attack: Hydro Pump');
  assert.equal(none.state.p[1].active!.damage, 50);
});

// ------------------------------------------------------------------ Revavroom ex

test('Revavroom ex, Accelerator Flash: 120 more damage if it moved from the Bench to the Active Spot this turn', () => {
  const stay = G([REVAVROOM, LATIAS], [{ active: 'Revavroom ex', energy: { active: [M] } }, { active: 'Mega Latias ex' }]);
  choose(stay, 'Attack: Accelerator Flash');
  assert.equal(stay.state.p[1].active!.damage, 20, 'it started the turn in the Active Spot');
  const moved = G([REVAVROOM, SLOWPOKE, LATIAS], [
    { active: 'Slowpoke', bench: ['Revavroom ex'], energy: { active: [P, P], 0: [M] } },
    { active: 'Mega Latias ex' },
  ]);
  choose(moved, 'Retreat');
  assert.equal(activeName(moved, 0), 'Revavroom ex', 'the only Benched Pokémon was promoted');
  choose(moved, 'Attack: Accelerator Flash');
  assert.equal(moved.state.p[1].active!.damage, 140, '20 + 120 after retreating into the Active Spot');
});

test('Revavroom ex, Shattering Speed: 250 damage, then it and all its attached cards are discarded (no Prize card for that)', () => {
  const g = G([REVAVROOM, SLOWPOKE, LATIAS], [
    { active: 'Revavroom ex', bench: ['Slowpoke'], energy: { active: [M, M, M] } },
    { active: 'Mega Latias ex' },
  ]);
  choose(g, 'Attack: Shattering Speed');
  assert.equal(g.state.p[1].active!.damage, 250);
  assert.deepEqual(names(g, g.state.p[0].discard), ['Metal Energy', 'Metal Energy', 'Metal Energy', 'Revavroom ex']);
  assert.equal(g.state.p[1].prizes.length, 6, 'the opponent took no Prize card');
  assert.equal(g.state.p[0].prizes.length, 6, 'and neither did I: the discard is not a Knock Out');
  assert.equal(activeName(g, 0), 'Slowpoke', 'the Benched Pokémon was promoted');
});

// ------------------------------------------------------------------ Drowzee

test('Drowzee, Eerie Gaze: 10 damage, and your opponent reveals their hand', () => {
  const g = G([DROWZEE, LATIAS, SLOWPOKE], [
    { active: 'Drowzee', energy: { active: [P] } },
    { active: 'Mega Latias ex', hand: ['Slowpoke', 'Fire Energy'] },
  ]);
  assert.equal(g.state.p[1].revealed.length, 0);
  choose(g, 'Attack: Eerie Gaze');
  assert.equal(g.state.p[1].active!.damage, 10);
  assert.deepEqual(names(g, g.state.p[1].revealed), ['Fire Energy', 'Slowpoke'], 'every card in their hand is now known');
});

// ------------------------------------------------------------------ Toxicroak

test('Toxicroak, Clean Hit: 90 damage, 90 more if the opponent\'s Active Pokémon is an Evolution Pokémon', () => {
  const basic = G([TOXICROAK, LATIAS], [{ active: 'Toxicroak', energy: { active: [FI, FI, FI] } }, { active: 'Mega Latias ex' }]);
  choose(basic, 'Attack: Clean Hit');
  assert.equal(basic.state.p[1].active!.damage, 90);
  const evo = G([TOXICROAK, WAILORD], [{ active: 'Toxicroak', energy: { active: [FI, FI, FI] } }, { active: 'Wailord' }]);
  assert.equal(activeName(evo, 1), 'Wailord');
  choose(evo, 'Attack: Clean Hit');
  assert.equal(evo.state.p[1].active!.damage, 180);
});

// ------------------------------------------------------------------ Bloodmoon Ursaluna

test('Bloodmoon Ursaluna, Mad Bite: 100 damage, 30 more for each damage counter on the opponent\'s Active Pokémon', () => {
  const g = G([URSALUNA, LATIAS], [{ active: 'Bloodmoon Ursaluna', energy: { active: [FI, FI, FI] } }, { active: 'Mega Latias ex', damage: { active: 20 } }]);
  choose(g, 'Attack: Mad Bite');
  assert.equal(g.state.p[1].active!.damage, 20 + 100 + 60, '2 counters: 100 + 2 x 30');
  const clean = G([URSALUNA, LATIAS], [{ active: 'Bloodmoon Ursaluna', energy: { active: [FI, FI, FI] } }, { active: 'Mega Latias ex' }]);
  choose(clean, 'Attack: Mad Bite');
  assert.equal(clean.state.p[1].active!.damage, 100);
});

test('Bloodmoon Ursaluna, Battle-Hardened: played onto the Bench, you may attach up to 2 Basic {F} Energy cards from your hand', () => {
  const mk = (): Game =>
    G([URSALUNA, SLOWPOKE, LATIAS], [{ active: 'Slowpoke', hand: ['Bloodmoon Ursaluna', FI, FI, FI, F] }, { active: 'Mega Latias ex' }]);
  const g = mk();
  choose(g, 'Bench Bloodmoon Ursaluna');
  yes(g);
  pick(g, [FI, FI]);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.energy), [FI, FI]);
  assert.deepEqual(names(g, g.state.p[0].hand), [FI, F], 'one Fighting and the Fire Energy stay in hand');
  const declined = mk();
  choose(declined, 'Bench Bloodmoon Ursaluna');
  no(declined);
  assert.equal(declined.state.p[0].bench[0]!.energy.length, 0);
  const one = mk();
  choose(one, 'Bench Bloodmoon Ursaluna');
  yes(one);
  pick(one, [FI]);
  assert.equal(one.state.p[0].bench[0]!.energy.length, 1, 'up to 2: 1 is fine');
});

test('Bloodmoon Ursaluna, Battle-Hardened: not offered with no Basic {F} Energy in hand', () => {
  const g = G([URSALUNA, SLOWPOKE, LATIAS], [{ active: 'Slowpoke', hand: ['Bloodmoon Ursaluna', F, W] }, { active: 'Mega Latias ex' }]);
  choose(g, 'Bench Bloodmoon Ursaluna');
  assert.equal(g.decision?.kind, 'main', 'no question');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0);
});

// ------------------------------------------------------------------ Zubat

test('Zubat, Lead: search your deck for a Supporter card, reveal it, and put it into your hand', () => {
  const sup = Object.values(FRAMES).find((f) => f.trainerType === 'Supporter' && f.cardId.startsWith('sv06.5'));
  assert.ok(sup, 'a Supporter in the set');
  const g = G([ZUBAT, LATIAS, sup.cardId], [{ active: 'Zubat', energy: { active: [D] } }, { active: 'Mega Latias ex' }]);
  const before = g.state.p[0].hand.length;
  choose(g, 'Attack: Lead');
  g.decision?.kind === 'cards' && g.submit([0]);
  assert.equal(g.state.p[0].hand.length, before + 1);
  const got = g.state.p[0].hand[g.state.p[0].hand.length - 1] as number;
  assert.equal(name(g, got), sup.name);
  assert.ok(g.state.p[0].revealed.includes(got), 'revealed to the opponent');
});

// ------------------------------------------------------------------ Zoroark

test('Zoroark, Illusory Hijacking: 60 damage for each of your opponent\'s Pokémon ex in play', () => {
  const g = G([ZOROARK, LATIAS, OKIDOGI, SLOWPOKE], [
    { active: 'Zoroark', energy: { active: [D, D] } },
    { active: 'Mega Latias ex', bench: ['Okidogi ex', 'Slowpoke'] },
  ]);
  choose(g, 'Attack: Illusory Hijacking');
  assert.equal(g.state.p[1].active!.damage, 120, 'Active and Benched ex: 2 x 60; the Slowpoke does not count');
  const none = G([ZOROARK, ETERNATUS, SLOWPOKE], [
    { active: 'Zoroark', energy: { active: [D, D] } },
    { active: 'Eternatus', bench: ['Slowpoke'] },
  ]);
  choose(none, 'Attack: Illusory Hijacking');
  assert.equal(none.state.p[1].active!.damage, 0, 'no Pokémon ex: 0');
});

// ------------------------------------------------------------------ Inkay

/** A deck with exactly one Slowpoke, so that Slowpoke on top of the deck is a card nothing else could put there. */
function inkayDeck(): DeckInput {
  return fromIds('c20', [[INKAY, 4], [LATIAS, 4], [SLOWPOKE, 1], ...ENERGY_IDS.map((id): [string, number] => [id, 10])]);
}

test('Inkay, Mischievous Tentacles: shows the top card of the opponent\'s deck; yes shuffles their deck', () => {
  const dk = inkayDeck();
  const g = scenario(dk, dk, [{ active: 'Inkay', energy: { active: [D] } }, { active: 'Mega Latias ex', deckTop: ['Slowpoke'] }]);
  assert.equal(name(g, g.state.p[1].deck[g.state.p[1].deck.length - 1] as number), 'Slowpoke');
  const size = g.state.p[1].deck.length;
  choose(g, 'Attack: Mischievous Tentacles');
  assert.equal(g.decision?.kind, 'yesno');
  assert.ok(String(g.decision?.prompt).includes('Slowpoke'), `the top card is shown: ${g.decision?.prompt}`);
  yes(g);
  // The opponent's turn began and they drew the new top card: the Slowpoke is not it (it was shuffled away) and is still in the deck.
  assert.equal(g.state.p[1].deck.length, size - 1);
  assert.ok(!names(g, g.state.p[1].hand).includes('Slowpoke'), 'the Slowpoke was no longer on top');
  assert.ok(names(g, g.state.p[1].deck).includes('Slowpoke'));
});

test('Inkay, Mischievous Tentacles: declining leaves the deck as it was; an empty deck asks nothing', () => {
  const dk = inkayDeck();
  const g = scenario(dk, dk, [{ active: 'Inkay', energy: { active: [D] } }, { active: 'Mega Latias ex', deckTop: ['Slowpoke'] }]);
  choose(g, 'Attack: Mischievous Tentacles');
  no(g);
  assert.ok(names(g, g.state.p[1].hand).includes('Slowpoke'), 'the unshuffled top card is what the opponent draws at the start of their turn');
  const empty = G([INKAY, LATIAS], [{ active: 'Inkay', energy: { active: [D] } }, { active: 'Mega Latias ex', emptyDeck: true }]);
  choose(empty, 'Attack: Mischievous Tentacles');
  assert.notEqual(empty.decision?.kind, 'yesno');
});

// ------------------------------------------------------------------ Yveltal

test('Yveltal, Corrosive Winds: 2 damage counters on each of the opponent\'s Pokémon that has any damage counters', () => {
  const g = G([YVELTAL, LATIAS, SLOWPOKE], [
    { active: 'Yveltal', energy: { active: [D] } },
    { active: 'Mega Latias ex', bench: ['Slowpoke', 'Slowpoke'], damage: { active: 10, 0: 30 } },
  ]);
  choose(g, 'Attack: Corrosive Winds');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[1].bench[0]!.damage, 50);
  assert.equal(g.state.p[1].bench[1]!.damage, 0, 'an undamaged Pokémon gets none');
});

test('Yveltal, Destructive Beam: 100 damage; heads discards an Energy from the opponent\'s Active Pokémon, tails does not', () => {
  const mk = (): Game =>
    G([YVELTAL, LATIAS], [{ active: 'Yveltal', energy: { active: [D, D, D] } }, { active: 'Mega Latias ex', energy: { active: [P, F] } }]);
  const heads = mk();
  heads.state.forcedCoins = [true];
  choose(heads, 'Attack: Destructive Beam');
  assert.equal(heads.state.p[1].active!.damage, 100);
  choose(heads, 'Fire'); // I choose which Energy
  assert.deepEqual(names(heads, heads.state.p[1].active!.energy), [P]);
  assert.deepEqual(names(heads, heads.state.p[1].discard).filter((n) => n.endsWith('Energy')), [F]);
  const tails = mk();
  tails.state.forcedCoins = [false];
  choose(tails, 'Attack: Destructive Beam');
  assert.equal(tails.state.p[1].active!.damage, 100);
  assert.equal(tails.state.p[1].active!.energy.length, 2);
});

// ------------------------------------------------------------------ Okidogi ex

test('Okidogi ex, Poisonous Musculature: attach up to 2 Basic {D} Energy from the deck, and if you did, it is Poisoned', () => {
  const g = G([OKIDOGI, LATIAS], [{ active: 'Okidogi ex', energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
  choose(g, 'Attack: Poisonous Musculature');
  g.submit([0, 1]); // both {D} Energy offered are the same card kind: any two
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [D, D, F]);
  assert.equal(g.state.p[0].active!.cond & POISONED, POISONED);
  const one = G([OKIDOGI, LATIAS], [{ active: 'Okidogi ex', energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
  choose(one, 'Attack: Poisonous Musculature');
  one.submit([0]);
  assert.equal(one.state.p[0].active!.energy.length, 2, 'up to 2: 1 is fine');
  assert.equal(one.state.p[0].active!.cond & POISONED, POISONED);
});

test('Okidogi ex, Poisonous Musculature: attaching none (or finding none) leaves it unpoisoned', () => {
  const none = G([OKIDOGI, LATIAS], [{ active: 'Okidogi ex', energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
  choose(none, 'Attack: Poisonous Musculature');
  none.submit([]);
  assert.equal(none.state.p[0].active!.energy.length, 1);
  assert.equal(none.state.p[0].active!.cond & POISONED, 0);
  const dk = deck([OKIDOGI, LATIAS], ENERGY_IDS.filter((e) => e !== 'mee-007'));
  const empty = scenario(dk, dk, [{ active: 'Okidogi ex', energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
  choose(empty, 'Attack: Poisonous Musculature');
  assert.equal(empty.state.p[0].active!.energy.length, 1, 'no {D} Energy in the deck');
  assert.equal(empty.state.p[0].active!.cond & POISONED, 0, 'nothing attached, so not Poisoned');
});

test('Okidogi ex, Chain-Crazed: 130 damage, 130 more if this Pokémon is Poisoned', () => {
  const plain = G([OKIDOGI, LATIAS], [{ active: 'Okidogi ex', energy: { active: [D, D, D] } }, { active: 'Mega Latias ex' }]);
  choose(plain, 'Attack: Chain-Crazed');
  assert.equal(plain.state.p[1].active!.damage, 130);
  const poisoned = G([OKIDOGI, LATIAS], [{ active: 'Okidogi ex', energy: { active: [D, D, D] }, cond: POISONED }, { active: 'Mega Latias ex' }]);
  choose(poisoned, 'Attack: Chain-Crazed');
  assert.equal(poisoned.state.p[1].active!.damage, 260);
});

// ------------------------------------------------------------------ Eevee

test('Eevee, Colorful Catch: up to 3 Basic Energy cards of different types, revealed, into your hand', () => {
  const g = G([EEVEE, LATIAS], [{ active: 'Eevee', energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
  const before = g.state.p[0].hand.length;
  choose(g, 'Attack: Colorful Catch');
  choose(g, 'Fire Energy');
  assert.ok(!labels(g).some((l) => l.includes('Fire Energy')), 'a second {R} Energy is not offered after the first');
  choose(g, 'Water Energy');
  choose(g, 'Psychic Energy');
  assert.equal(g.decision?.kind, 'main', 'three picked: the search is over');
  const hand = g.state.p[0].hand;
  assert.equal(hand.length, before + 3);
  const got = hand.slice(before);
  assert.deepEqual(names(g, got), [F, P, W]);
  for (const c of got) assert.ok(g.state.p[0].revealed.includes(c), 'revealed');
});

test('Eevee, Colorful Catch: you may stop early (up to 3)', () => {
  const g = G([EEVEE, LATIAS], [{ active: 'Eevee', energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
  const before = g.state.p[0].hand.length;
  choose(g, 'Attack: Colorful Catch');
  choose(g, 'Lightning Energy');
  g.submit([]);
  assert.equal(g.state.p[0].hand.length, before + 1);
  assert.equal(name(g, g.state.p[0].hand[before] as number), L);
});

// ------------------------------------------------------------------ Bewear

test('Bewear, Power Charger: 30 damage, then search your deck for a Basic Energy card and attach it to this Pokémon', () => {
  const g = G([BEWEAR, LATIAS], [{ active: 'Bewear', energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
  choose(g, 'Attack: Power Charger');
  choose(g, 'Water Energy');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.deepEqual(names(g, g.state.p[0].active!.energy), [F, W]);
  const decks = g.state.p[0].deck.length;
  assert.ok(decks > 0);
});

test('Bewear, Power Charger: with no Basic Energy in the deck it still does 30', () => {
  const dk = fromIds('c20', [[BEWEAR, 4], [LATIAS, 4], ['mee-002', 1]]);
  const g = scenario(dk, dk, [{ active: 'Bewear', energy: { active: [F] } }, { active: 'Mega Latias ex' }]);
  g.state.p[0].deck.length = 0;
  choose(g, 'Attack: Power Charger');
  assert.equal(g.state.p[1].active!.damage, 30);
  assert.equal(g.state.p[0].active!.energy.length, 1);
});

// ------------------------------------------------------------------ Dangerous Laser

test('Dangerous Laser: your opponent\'s Active Pokémon is now Burned and Confused', () => {
  const g = G([LASER, LATIAS, SLOWPOKE], [{ active: 'Slowpoke', hand: ['Dangerous Laser'] }, { active: 'Mega Latias ex' }]);
  choose(g, 'Play Dangerous Laser');
  const c = g.state.p[1].active!.cond;
  assert.equal(c & BURNED, BURNED);
  assert.equal(c & CONFUSED, CONFUSED);
});

test('Dangerous Laser: can\'t be played when the Defending Pokémon is already Burned and Confused (it would do nothing); one of the two is enough to play it', () => {
  const both = G([LASER, LATIAS, SLOWPOKE], [{ active: 'Slowpoke', hand: ['Dangerous Laser'] }, { active: 'Mega Latias ex', cond: BURNED | CONFUSED }]);
  assert.ok(!has(both, 'Play Dangerous Laser'));
  const burnedOnly = G([LASER, LATIAS, SLOWPOKE], [{ active: 'Slowpoke', hand: ['Dangerous Laser'] }, { active: 'Mega Latias ex', cond: BURNED }]);
  assert.ok(has(burnedOnly, 'Play Dangerous Laser'));
  choose(burnedOnly, 'Play Dangerous Laser');
  assert.equal(burnedOnly.state.p[1].active!.cond & CONFUSED, CONFUSED);
  const confusedOnly = G([LASER, LATIAS, SLOWPOKE], [{ active: 'Slowpoke', hand: ['Dangerous Laser'] }, { active: 'Mega Latias ex', cond: CONFUSED }]);
  assert.ok(has(confusedOnly, 'Play Dangerous Laser'));
});
