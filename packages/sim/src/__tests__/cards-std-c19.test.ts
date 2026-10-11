/**
 * Card tests, batch "std-c19": every card scripted in cards/scripts/std-c19.ts does what its printed text says in a
 * constructed position, and every TPCi ruling cited in the script is pinned here. Quotes are the printed text from frames.ts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def } from '../context.js';
import { describeOptions } from '../describe.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import type { Decision } from '../types.js';
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
function name(g: Game, iid: number): string {
  return def(g.ctx, iid).name;
}
function names(g: Game, iids: number[]): string[] {
  return iids.map((c) => name(g, c)).sort();
}
function count(g: Game, iids: number[], n: string): number {
  return iids.filter((c) => name(g, c) === n).length;
}
function benchNames(g: Game, p: 0 | 1): string[] {
  return g.state.p[p].bench.map((b) => name(g, topCard(b)));
}
function energyNames(g: Game, p: 0 | 1, where: 'active' | number): string[] {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return names(g, sl.energy);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card plus plenty of every basic Energy (so searches and Prize cards never run it dry). */
function deck(...ids: string[]) {
  return fromIds('c19', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const URSA = 'sv06-141'; // Bloodmoon Ursaluna ex: 260 HP, Colorless, weak Fighting, Blood Moon {C}x5 for 240
const TYR = 'sv08.5-064'; // Tyranitar ex: 340 HP, Darkness, weak Grass, no Resistance
const SNORLAX = 'sv06-136'; // 160 HP, Colorless, weak Fighting
const EEVEE = 'sv06-135';
const CHANSEY = 'sv06-133';
const BLISSEY = 'sv06-134';
const BOOMERANG = 'sv06-166'; // Special Energy
const FAN = 'sv06-150';
const ULTRA = 'me01-131';
const CENTER = 'sv06-146';
const CAKE = 'sv06-147'; // Cook

const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const M = 'Metal Energy';
const G = 'Grass Energy';
const D = 'Darkness Energy';

type Sides = [SideLayout, SideLayout];

// ------------------------------------------------------------------ Revavroom

test('Revavroom, Rally Back: 30, +90 only if one of your Pokémon was Knocked Out by an attack during your opponent\'s last turn', () => {
  const dk = deck('sv06-125', TYR);
  const hit = (ko: number | null): number => {
    const g = scenario(dk, dk, [{ active: 'Revavroom', energy: { active: [M] } }, { active: 'Tyranitar ex' }]);
    if (ko !== null) g.state.p[0].attackKoTurn = g.state.turn - ko;
    choose(g, 'Attack: Rally Back');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit(null), 30);
  assert.equal(hit(1), 120, 'a Knock Out by an attack during the opponent\'s last turn: 30 + 90');
  assert.equal(hit(2), 30, 'two turns ago is not the opponent\'s last turn');
});

test('Revavroom, Running Charge: flip until tails, 100 damage for each heads', () => {
  const dk = deck('sv06-125', TYR);
  const hit = (coins: boolean[]): number => {
    const g = scenario(dk, dk, [{ active: 'Revavroom', energy: { active: [M, M, M] } }, { active: 'Tyranitar ex' }]);
    g.state.forcedCoins = coins;
    choose(g, 'Attack: Running Charge');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([false]), 0);
  assert.equal(hit([true, false]), 100);
  assert.equal(hit([true, true, true, false]), 300);
});

// ------------------------------------------------------------------ Farfetch'd

test("Farfetch'd, Mach Cut: 30 damage and a Special Energy is discarded from the Defending Pokémon (a Basic Energy is not)", () => {
  const dk = deck('sv06-132', TYR, BOOMERANG);
  const run = (energy: string[]): Game => {
    const g = scenario(dk, dk, [{ active: "Farfetch'd", energy: { active: [F] } }, { active: 'Tyranitar ex', energy: { active: energy } }]);
    choose(g, 'Attack: Mach Cut');
    return g;
  };
  const a = run(['Boomerang Energy', W]);
  assert.equal(a.state.p[1].active!.damage, 30);
  assert.deepEqual(energyNames(a, 1, 'active'), [W]);
  assert.ok(names(a, a.state.p[1].discard).includes('Boomerang Energy'));
  const b = run([W, L]);
  assert.deepEqual(energyNames(b, 1, 'active'), [L, W], 'only Basic Energy: nothing is discarded');
});

test("Farfetch'd, Impromptu Carrier: from the hand to the Bench, you may fetch a Pokémon Tool from the deck onto it, then shuffle", () => {
  const dk = deck('sv06-132', TYR, FAN, ULTRA);
  const play = (): Game => {
    const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ["Farfetch'd"] }, { active: 'Tyranitar ex' }]);
    choose(g, "Bench Farfetch'd");
    return g;
  };
  const g = play();
  yes(g);
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.min, 0, 'a search can come up empty, so the Tool is optional');
  assert.ok(labels(g).every((l) => l.includes('Handheld Fan')), 'only Pokémon Tool cards are offered');
  const fansBefore = count(g, g.state.p[0].deck, 'Handheld Fan');
  const deckBefore = g.state.p[0].deck.slice();
  pick(g, ['Handheld Fan']);
  assert.deepEqual(names(g, g.state.p[0].bench[0]!.tools), ['Handheld Fan']);
  assert.equal(count(g, g.state.p[0].deck, 'Handheld Fan'), fansBefore - 1);
  assert.notDeepEqual(g.state.p[0].deck.slice(0, 20), deckBefore.filter((c) => name(g, c) !== 'Handheld Fan').slice(0, 20), 'the deck was shuffled');
  // Declining the "you may" leaves the deck alone.
  const h = play();
  no(h);
  assert.equal(h.state.p[0].bench[0]!.tools.length, 0);
  assert.equal(count(h, h.state.p[0].deck, 'Handheld Fan'), fansBefore);
  // Choosing no Tool at all.
  const k = play();
  yes(k);
  k.submit([]);
  assert.equal(k.state.p[0].bench[0]!.tools.length, 0);
});

// ------------------------------------------------------------------ Chansey

test('Chansey, Lucky Attachment: attach a Basic Energy card from your hand to 1 of your Pokémon', () => {
  const dk = deck(CHANSEY, EEVEE, TYR, BOOMERANG);
  const g = scenario(dk, dk, [{ active: 'Chansey', bench: ['Eevee'], energy: { active: [F] }, hand: [W, L, 'Boomerang Energy'] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Lucky Attachment');
  assert.ok(!labels(g).some((l) => l.includes('Boomerang')), 'a Special Energy card is not a Basic Energy card');
  pick(g, [W]);
  choose(g, 'Eevee');
  assert.deepEqual(energyNames(g, 0, 0), [W]);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Boomerang Energy', L]);
});

test('Chansey, Lucky Attachment: with no Basic Energy card in hand nothing happens', () => {
  const dk = deck(CHANSEY, EEVEE, TYR, BOOMERANG);
  const g = scenario(dk, dk, [{ active: 'Chansey', bench: ['Eevee'], energy: { active: [F] }, hand: ['Boomerang Energy'] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Lucky Attachment');
  assert.equal(g.state.p[0].bench[0]!.energy.length, 0);
  assert.equal(g.state.p[0].active!.energy.length, 1);
  assert.equal(g.state.p[0].hand.length, 1);
});

test("Chansey, Boundless Power: 80 damage, and during your next turn this Pokémon can't attack (it can the turn after)", () => {
  const dk = deck(CHANSEY, TYR);
  const g = scenario(dk, dk, [{ active: 'Chansey', energy: { active: [F, F, F] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Attack: Boundless Power');
  assert.equal(g.state.p[1].active!.damage, 80);
  choose(g, 'End turn'); // the opponent's turn
  assert.ok(!has(g, 'Attack:'), "my next turn: Chansey can't attack");
  choose(g, 'End turn');
  choose(g, 'End turn');
  assert.ok(has(g, 'Attack: Boundless Power'), 'the turn after, it can');
});

// ------------------------------------------------------------------ Blissey ex

test('Blissey ex, Return: 180 damage, then you may draw cards until you have 6 cards in your hand', () => {
  const dk = deck(BLISSEY, TYR, ULTRA);
  const run = (hand: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Blissey ex', energy: { active: [F, F, F] }, hand }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Return');
    return g;
  };
  const a = run([W, W]);
  assert.equal(a.state.p[1].active!.damage, 180);
  yes(a);
  assert.equal(a.state.p[0].hand.length, 6);
  const b = run([W, W]);
  no(b);
  assert.equal(b.state.p[0].hand.length, 2);
  const c = run([W, W, W, W]);
  yes(c);
  assert.equal(c.state.p[0].hand.length, 6);
  const d = run([W, W, W, W, W, W]);
  assert.notEqual(d.decision?.kind, 'yesno', 'with 6 cards already there is nothing to draw');
  assert.equal(d.state.p[0].hand.length, 6);
});

test('Blissey ex, Happy Switch: move a Basic Energy (not a Special Energy) from 1 of your Pokémon to another, once per turn', () => {
  const dk = deck(BLISSEY, EEVEE, TYR, BOOMERANG);
  const g = scenario(dk, dk, [{ active: 'Blissey ex', bench: ['Eevee'], energy: { active: [F, W, 'Boomerang Energy'] } }, { active: 'Tyranitar ex' }]);
  choose(g, 'Use Happy Switch');
  assert.deepEqual(labels(g).sort(), [F, W].sort().map((e) => labels(g).find((l) => l.includes(e))!).sort(), 'only the Basic Energy cards are offered');
  pick(g, [W]);
  assert.deepEqual(energyNames(g, 0, 0), [W]);
  assert.deepEqual(energyNames(g, 0, 'active'), ['Boomerang Energy', F]);
  assert.ok(!has(g, 'Use Happy Switch'), 'only once during your turn');
  // Nothing to move: only a Special Energy, or no other Pokémon to move it to.
  const s = scenario(dk, dk, [{ active: 'Blissey ex', bench: ['Eevee'], energy: { active: ['Boomerang Energy'] } }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(s, 'Use Happy Switch'));
  const alone = scenario(dk, dk, [{ active: 'Blissey ex', energy: { active: [F] } }, { active: 'Tyranitar ex' }]);
  assert.ok(!has(alone, 'Use Happy Switch'));
});

// ------------------------------------------------------------------ Eevee

test('Eevee, Ascension: search your deck for a card that evolves from this Pokémon and put it onto it', () => {
  const dk = deck(EEVEE, 'sv08.5-014', 'sv08.5-023', TYR);
  const run = (): Game => {
    const g = scenario(dk, dk, [{ active: 'Eevee', energy: { active: [F] } }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Ascension');
    return g;
  };
  const g = run();
  const flareonsBefore = count(g, g.state.p[0].deck, 'Flareon ex');
  assert.ok(labels(g).every((l) => l.includes('Flareon ex') || l.includes('Vaporeon ex')), 'only cards that evolve from Eevee');
  pick(g, ['Flareon ex']);
  assert.deepEqual(g.state.p[0].active!.cards.map((c) => name(g, c)), ['Eevee', 'Flareon ex']);
  assert.equal(count(g, g.state.p[0].deck, 'Flareon ex'), flareonsBefore - 1);
  // A search may come up empty by choice.
  const n = run();
  n.submit([]);
  assert.deepEqual(n.state.p[0].active!.cards.map((c) => name(n, c)), ['Eevee']);
});

test('Eevee, Quick Attack: 20, flip a coin, heads 20 more', () => {
  const dk = deck(EEVEE, TYR);
  const hit = (heads: boolean): number => {
    const g = scenario(dk, dk, [{ active: 'Eevee', energy: { active: [F, F, F] } }, { active: 'Tyranitar ex' }]);
    g.state.forcedCoins = [heads];
    choose(g, 'Attack: Quick Attack');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit(false), 20);
  assert.equal(hit(true), 40);
});

// ------------------------------------------------------------------ Snorlax

test('Snorlax, But First, Food: attach an Energy card (any, Special too) from your hand to it, and if you do heal 60 damage', () => {
  const dk = deck(SNORLAX, TYR, BOOMERANG, ULTRA);
  const run = (hand: string[], damage: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Snorlax', energy: { active: [F] }, damage: { active: damage }, hand }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: But First, Food');
    return g;
  };
  const a = run([W, 'Boomerang Energy', 'Ultra Ball'], 100);
  pick(a, ['Boomerang Energy']);
  assert.deepEqual(energyNames(a, 0, 'active'), ['Boomerang Energy', F]);
  assert.equal(a.state.p[0].active!.damage, 40);
  const b = run([W], 30);
  assert.equal(b.state.p[0].active!.damage, 0, 'heals 60 even when it had less');
  assert.deepEqual(energyNames(b, 0, 'active'), [F, W]);
  // No Energy card in hand: nothing is attached, so nothing is healed ("If you do").
  const c = run(['Ultra Ball'], 100);
  assert.equal(c.state.p[0].active!.damage, 100);
  assert.deepEqual(energyNames(c, 0, 'active'), [F]);
});

// ------------------------------------------------------------------ Ambipom

test("Ambipom, Wicked Tail: evolving from the hand, you may flip 2 coins; each heads shuffles a random card of your opponent's hand into their deck", () => {
  const dk = deck('sv06-138', 'me02-078', TYR, ULTRA, 'me01-130');
  const run = (coins: boolean[], answer: 'yes' | 'no'): Game => {
    const g = scenario(dk, dk, [
      { active: 'Tyranitar ex', bench: ['Aipom'], hand: ['Ambipom'] },
      { active: 'Tyranitar ex', hand: ['Ultra Ball', 'Switch', 'Ultra Ball'] },
    ]);
    g.state.forcedCoins = coins.slice();
    choose(g, 'Evolve Aipom into Ambipom');
    if (answer === 'yes') yes(g);
    else no(g);
    return g;
  };
  const deckBefore = (g: Game) => g.state.p[1].deck.length;
  const two = run([true, true], 'yes');
  assert.equal(two.state.p[1].hand.length, 1);
  assert.equal(deckBefore(two), run([false, false], 'yes').state.p[1].deck.length + 2);
  const one = run([true, false], 'yes');
  assert.equal(one.state.p[1].hand.length, 2);
  const zero = run([false, false], 'yes');
  assert.equal(zero.state.p[1].hand.length, 3);
  // Declining flips nothing.
  const declined = run([true, true], 'no');
  assert.equal(declined.state.p[1].hand.length, 3);
  assert.equal(declined.state.forcedCoins.length, 2);
  assert.equal(benchNames(two, 0)[0], 'Ambipom');
});

// ------------------------------------------------------------------ Swanna

test("Swanna, Fighting Wings: 20, +90 if the opponent's Active Pokémon is a Pokémon ex", () => {
  const dk = deck('sv06-140', TYR, SNORLAX);
  const hit = (target: string): number => {
    const g = scenario(dk, dk, [{ active: 'Swanna', energy: { active: [F] } }, { active: target }]);
    choose(g, 'Attack: Fighting Wings');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit('Tyranitar ex'), 110);
  assert.equal(hit('Snorlax'), 20);
});

// ------------------------------------------------------------------ Dartrix, Decidueye

test('Dartrix, United Wings: 20 damage for each Pokémon in your discard pile that has the United Wings attack', () => {
  const dk = deck('sv06.5-004', URSA, SNORLAX);
  const hit = (discard: string[]): number => {
    const g = scenario(dk, dk, [{ active: 'Dartrix', energy: { active: [F] }, discard }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: United Wings');
    return g.state.p[1].active!.damage;
  };
  assert.equal(hit([]), 0);
  assert.equal(hit(['Snorlax', 'Snorlax']), 0, 'other Pokémon do not count');
  assert.equal(hit(['Dartrix']), 20);
  assert.equal(hit(['Dartrix', 'Dartrix', 'Snorlax']), 40);
});

test('Decidueye, Stock Up on Feathers: draw cards until you have 7 cards in your hand', () => {
  const dk = deck('sv06.5-005', TYR, ULTRA);
  const hand = (n: number): number => {
    const g = scenario(dk, dk, [{ active: 'Decidueye', energy: { active: [F] }, hand: Array(n).fill('Water Energy') }, { active: 'Tyranitar ex' }]);
    choose(g, 'Attack: Stock Up on Feathers');
    return g.state.p[0].hand.length;
  };
  assert.equal(hand(2), 7);
  assert.equal(hand(7), 7);
  assert.equal(hand(9), 9, 'it draws nothing, and discards nothing');
});

test("Decidueye, Power Shot: discard a Basic {G} Energy card from your hand for 170; if you can't, the attack does nothing", () => {
  const dk = deck('sv06.5-005', URSA, ULTRA, BOOMERANG);
  const run = (hand: string[]): Game => {
    const g = scenario(dk, dk, [{ active: 'Decidueye', energy: { active: [G] }, hand }, { active: 'Bloodmoon Ursaluna ex' }]);
    choose(g, 'Attack: Power Shot');
    return g;
  };
  const a = run([G, F, 'Ultra Ball']);
  assert.equal(a.state.p[1].active!.damage, 170);
  assert.deepEqual(names(a, a.state.p[0].hand), [F, 'Ultra Ball']);
  assert.deepEqual(names(a, a.state.p[0].discard), [G]);
  for (const hand of [[F, 'Ultra Ball'], ['Boomerang Energy'], []]) {
    const b = run(hand);
    assert.equal(b.state.p[1].active!.damage, 0, 'no Basic {G} Energy card: nothing');
    assert.equal(b.state.p[0].hand.length, hand.length);
    assert.equal(b.state.p[0].discard.length, 0);
  }
});

// ------------------------------------------------------------------ Accompanying Flute

test("Accompanying Flute: reveal the top 5 of the opponent's deck; any number of Basic Pokémon found go onto their Bench", () => {
  const dk = deck('sv06-142', TYR, SNORLAX, EEVEE, CHANSEY, ULTRA);
  const play = (top: string[], bench: string[] = []): Game => {
    const g = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Accompanying Flute'] }, { active: 'Tyranitar ex', bench, deckTop: top }]);
    choose(g, 'Play Accompanying Flute');
    return g;
  };
  const top = ['Ultra Ball', 'Fire Energy', 'Snorlax', 'Chansey', 'Fire Energy', 'Eevee'];
  const g = play(top);
  // The 6th card is not among the top 5; only the Basic Pokémon of the top 5 are offered.
  assert.deepEqual(labels(g).map((l) => (l.includes('Snorlax') ? 'S' : l.includes('Chansey') ? 'C' : l)).sort(), ['C', 'S']);
  const deckBefore = g.state.p[1].deck.length;
  pick(g, ['Snorlax', 'Chansey']);
  assert.deepEqual(benchNames(g, 1).sort(), ['Chansey', 'Snorlax']);
  assert.equal(g.state.p[1].deck.length, deckBefore - 2);
  assert.equal(g.state.p[1].bench[0]!.cards.length, 1);
  // Ruling (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1986/): Choosing is optional with no minimum.
  const none = play(top);
  none.submit([]);
  assert.deepEqual(benchNames(none, 1), []);
  assert.equal(none.state.p[1].deck.length, deckBefore);
  // Only as many as fit on the Bench.
  const tight = play(top, ['Eevee', 'Eevee', 'Chansey']);
  assert.equal(tight.decision?.max, 2);
  // Ruling (TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1985/): Cannot play when opponent's Bench is full.
  const full = scenario(dk, dk, [{ active: 'Tyranitar ex', hand: ['Accompanying Flute'] }, { active: 'Tyranitar ex', bench: ['Eevee', 'Eevee', 'Chansey', 'Chansey', 'Snorlax'] }]);
  assert.ok(!has(full, 'Play Accompanying Flute'));
});

// ------------------------------------------------------------------ Bug Catching Set

test('Bug Catching Set: look at the top 7; up to 2 in any combination of {G} Pokémon and Basic {G} Energy go to your hand, the rest are shuffled back', () => {
  const dk = deck('sv06-143', 'me03-010', 'sv06.5-004', SNORLAX);
  const g = scenario(dk, dk, [
    {
      active: 'Snorlax',
      hand: ['Bug Catching Set'],
      deckTop: ['Rowlet', 'Fire Energy', 'Grass Energy', 'Snorlax', 'Dartrix', 'Water Energy', 'Snorlax', 'Grass Energy', 'Rowlet'],
    },
    { active: 'Snorlax' },
  ]);
  choose(g, 'Play Bug Catching Set');
  // Top 7: Rowlet, Fire, Grass, Snorlax, Dartrix, Water, Snorlax. The 8th card (Grass Energy) and the 9th (Rowlet) are out of reach.
  assert.equal(g.decision?.max, 2);
  assert.equal(g.decision?.min, 0);
  assert.deepEqual(labels(g).map((l) => ['Rowlet', 'Grass Energy', 'Dartrix'].find((n) => l.includes(n)) ?? l).sort(), ['Dartrix', 'Grass Energy', 'Rowlet']);
  pick(g, ['Grass Energy', 'Dartrix']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Dartrix', 'Grass Energy']);
  // Nothing in the top 7 qualifies (a deck of Snorlax and Fire Energy only): it is still played, and nothing is taken.
  const poor = fromIds('c19-poor', [['sv06-143', 4], [SNORLAX, 4], ['mee-002', 40]]);
  const none = scenario(poor, poor, [{ active: 'Snorlax', hand: ['Bug Catching Set'] }, { active: 'Snorlax' }]);
  choose(none, 'Play Bug Catching Set');
  assert.equal(none.state.p[0].hand.length, 0, 'nothing to take: it is still played and the hand stays empty');
  assert.equal(names(none, none.state.p[0].discard).join(), 'Bug Catching Set');
});

// ------------------------------------------------------------------ Caretaker and Community Center

test('Caretaker: draw 2 cards; with Community Center in play and cards drawn, it is shuffled into the deck instead of discarded', () => {
  const dk = deck('sv06-144', CENTER, SNORLAX);
  const setup = (withCenter: boolean, shrink = false): Game => {
    const g = scenario(dk, dk, [{ active: 'Snorlax', hand: withCenter ? ['Community Center', 'Caretaker'] : ['Caretaker'] }, { active: 'Snorlax' }]);
    if (shrink) g.state.p[0].discard.push(...g.state.p[0].deck.splice(0, g.state.p[0].deck.length - 1));
    if (withCenter) choose(g, 'Play Community Center');
    return g;
  };
  const cardIn = (g: Game): number => g.state.p[0].hand.find((c) => name(g, c) === 'Caretaker')!;
  const without = setup(false);
  const played0 = cardIn(without);
  choose(without, 'Play Caretaker');
  assert.equal(without.state.p[0].hand.length, 2);
  assert.equal(names(without, without.state.p[0].discard).join(), 'Caretaker');
  assert.ok(without.state.p[0].discard.includes(played0) && !without.state.p[0].deck.includes(played0));
  const withC = setup(true);
  const played1 = cardIn(withC);
  choose(withC, 'Play Caretaker');
  assert.equal(withC.state.p[0].hand.length, 2);
  assert.ok(!withC.state.p[0].discard.includes(played1), 'not discarded');
  assert.ok(withC.state.p[0].deck.includes(played1), 'back in the deck');
  assert.equal(withC.state.p[0].supporterPlayed, true, 'it was still played as a Supporter');
  // Only 1 card left in the deck: it still "drew any cards", so it goes back into the deck.
  const one = setup(true, true);
  choose(one, 'Play Caretaker');
  assert.equal(one.state.p[0].hand.length, 1);
  assert.equal(one.state.p[0].deck.length, 1);
  assert.equal(name(one, one.state.p[0].deck[0]!), 'Caretaker');
  // No cards to draw: it can't be played at all.
  const empty = scenario(dk, dk, [{ active: 'Snorlax', hand: ['Caretaker'], emptyDeck: true }, { active: 'Snorlax' }]);
  assert.ok(!has(empty, 'Play Caretaker'));
});

test('Community Center: once during each player\'s turn, after they played a Supporter card, they may heal 10 damage from each of their Pokémon', () => {
  const dk = deck(CENTER, CAKE, SNORLAX, 'sv06-144');
  const g = scenario(dk, dk, [
    { active: 'Snorlax', bench: ['Snorlax', 'Snorlax'], damage: { active: 100, 0: 30, 1: 0 }, hand: ['Community Center', 'Cook', 'Caretaker'] },
    { active: 'Snorlax', damage: { active: 50 } },
  ]);
  choose(g, 'Play Community Center');
  assert.ok(!has(g, 'Use the Stadium'), 'no Supporter played yet');
  choose(g, 'Play Cook');
  assert.equal(g.state.p[0].active!.damage, 30);
  choose(g, 'Use the Stadium');
  assert.deepEqual([g.state.p[0].active!.damage, g.state.p[0].bench[0]!.damage, g.state.p[0].bench[1]!.damage], [20, 20, 0]);
  assert.equal(g.state.p[1].active!.damage, 50, "only the player's own Pokémon");
  assert.ok(!has(g, 'Use the Stadium'), 'once during each player\'s turn');
  // The opponent gets their own use on their own turn once they play a Supporter.
  choose(g, 'End turn');
  assert.ok(!has(g, 'Use the Stadium'));
});

test("Community Center: the opponent's turn works the same, healing the opponent's Pokémon; nothing damaged, nothing to use", () => {
  const dk = deck(CENTER, CAKE, SNORLAX, 'sv06-144');
  const g = scenario(
    dk,
    dk,
    [
      { active: 'Snorlax', damage: { active: 40 } },
      { active: 'Snorlax', bench: ['Snorlax'], damage: { active: 60, 0: 10 }, hand: ['Community Center', 'Caretaker'] },
    ],
    { current: 1, first: 0 },
  );
  choose(g, 'Play Community Center');
  choose(g, 'Play Caretaker');
  choose(g, 'Use the Stadium');
  assert.deepEqual([g.state.p[1].active!.damage, g.state.p[1].bench[0]!.damage], [50, 0]);
  assert.equal(g.state.p[0].active!.damage, 40);
  // Nothing damaged: the ability is not offered even after a Supporter.
  const clean = scenario(dk, dk, [{ active: 'Snorlax', hand: ['Community Center', 'Caretaker'] }, { active: 'Snorlax' }]);
  choose(clean, 'Play Community Center');
  choose(clean, 'Play Caretaker');
  assert.ok(!has(clean, 'Use the Stadium'));
});

// ------------------------------------------------------------------ Cook

test('Cook: heal 70 damage from your Active Pokémon (and only if it is damaged)', () => {
  const dk = deck(CAKE, SNORLAX);
  const run = (damage: number, bench = 0): Game =>
    scenario(dk, dk, [{ active: 'Snorlax', bench: ['Snorlax'], damage: { active: damage, 0: bench }, hand: ['Cook'] }, { active: 'Snorlax' }]);
  const a = run(100);
  choose(a, 'Play Cook');
  assert.equal(a.state.p[0].active!.damage, 30);
  const b = run(50);
  choose(b, 'Play Cook');
  assert.equal(b.state.p[0].active!.damage, 0);
  // Damage only on the Bench: Cook would do nothing, so it can't be played.
  assert.ok(!has(run(0, 80), 'Play Cook'));
});

// ------------------------------------------------------------------ Handheld Fan

test("Handheld Fan: if the Active Pokémon it's on is damaged by an attack, move an Energy from the Attacking Pokémon to 1 of the attacker's Benched Pokémon", () => {
  const dk = deck(URSA, SNORLAX, FAN, TYR, CHANSEY);
  const run = (target: string, attackerBench: string[]): Game => {
    const g = scenario(dk, dk, [
      { active: 'Bloodmoon Ursaluna ex', bench: attackerBench, energy: { active: [F, W, L, P, M] } },
      { active: target, bench: ['Chansey'], tools: { active: ['Handheld Fan'] } },
    ]);
    choose(g, 'Attack: Blood Moon');
    return g;
  };
  const g = run('Tyranitar ex', ['Chansey']);
  assert.equal(g.state.p[1].active!.damage, 240);
  pick(g, [W]);
  assert.deepEqual(energyNames(g, 0, 0), [W], "the Fan's controller chose Water, and it went to the attacker's Bench");
  assert.deepEqual(energyNames(g, 0, 'active'), [F, L, M, P]);
  // "(even if this Pokémon is Knocked Out)": Snorlax, 160 HP, is Knocked Out by 240 and the Fan still works.
  const ko = run('Snorlax', ['Chansey']);
  pick(ko, [L]);
  assert.deepEqual(energyNames(ko, 0, 0), [L]);
  assert.ok(names(ko, ko.state.p[1].discard).includes('Snorlax'), 'it was Knocked Out');
  // The attacker has no Benched Pokémon: nothing can be moved.
  const alone = run('Tyranitar ex', []);
  assert.equal(energyNames(alone, 0, 'active').length, 5);
  // A Fan on a Benched Pokémon does nothing.
  const benched = scenario(dk, dk, [
    { active: 'Bloodmoon Ursaluna ex', bench: ['Chansey'], energy: { active: [F, F, F, F, F] } },
    { active: 'Tyranitar ex', bench: ['Chansey'], tools: { 0: ['Handheld Fan'] } },
  ]);
  choose(benched, 'Attack: Blood Moon');
  assert.equal(benched.state.p[0].bench[0]!.energy.length, 0);
});

test('Handheld Fan, ruling 2091: an attack that puts the attacker into the deck first (Aqua Return) leaves no Energy to move', () => {
  // Ruling (TPCi Rules Team 2024-12-19, https://compendium.pokegym.net/ruling/2091/): Attack effects resolve before triggered effects on the Defending Pokémon.
  const dk = deck('me05-020', URSA, FAN, CHANSEY);
  const g = scenario(dk, dk, [
    { active: 'Primarina', bench: ['Chansey', 'Chansey'], energy: { active: [W, F] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Chansey'], tools: { active: ['Handheld Fan'] } },
  ]);
  const primarina = topCard(g.state.p[0].active!);
  const attached = g.state.p[0].active!.energy[0]!;
  choose(g, 'Attack: Aqua Return');
  assert.equal(g.state.p[1].active!.damage, 120);
  assert.ok(g.state.p[0].deck.includes(primarina), 'Primarina is back in the deck');
  assert.ok(g.state.p[0].deck.includes(attached), 'and so is her Energy');
  assert.equal(g.state.p[0].bench.reduce((n, b) => n + b.energy.length, 0), 0, 'no Energy moved to the Bench');
});

test('Handheld Fan, ruling 2125: a Boomerang Energy discarded by the attack is attached again before the Fan moves an Energy', () => {
  // Ruling (TPCi Rules Team 2025-03-27, https://compendium.pokegym.net/ruling/2125/): The Handheld Fan step runs after attack effects, so Boomerang Energy is already reattached to Darmanitan when it checks.
  const dk = deck('me02.5-033', URSA, FAN, CHANSEY, BOOMERANG);
  const g = scenario(dk, dk, [
    { active: "N's Darmanitan", bench: ['Chansey'], energy: { active: [F, F, 'Boomerang Energy'] } },
    { active: 'Bloodmoon Ursaluna ex', bench: ['Chansey'], tools: { active: ['Handheld Fan'] } },
  ]);
  choose(g, 'Attack: Flamebody Cannon');
  assert.equal(g.state.p[1].active!.damage, 90);
  assert.deepEqual(energyNames(g, 0, 'active'), [], 'the Fire Energy cards were discarded');
  assert.deepEqual(energyNames(g, 0, 0), ['Boomerang Energy'], 'the reattached Boomerang Energy is the one the Fan moved to the Bench');
});

// ------------------------------------------------------------------ Hyper Aroma, Lana's Aid, Love Ball, Perrin

test('Hyper Aroma: search your deck for up to 3 Stage 1 Pokémon, reveal them, put them into your hand', () => {
  const dk = deck('sv06-152', 'sv06-140', 'sv06-138', 'sv06.5-004', EEVEE, SNORLAX, 'sv06-125');
  const g = scenario(dk, dk, [{ active: 'Snorlax', hand: ['Hyper Aroma'] }, { active: 'Snorlax' }]);
  choose(g, 'Play Hyper Aroma');
  assert.equal(g.decision?.max, 3);
  assert.equal(g.decision?.min, 1, 'a Trainer\'s "up to" is 1 to 3');
  assert.ok(labels(g).every((l) => ['Swanna', 'Ambipom', 'Dartrix', 'Revavroom'].some((n) => l.includes(n))), 'only Stage 1 Pokémon');
  pick(g, ['Swanna', 'Ambipom', 'Dartrix']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Ambipom', 'Dartrix', 'Swanna']);
  assert.equal(g.state.p[0].revealed.length, 3);
});

test("Lana's Aid: put up to 3 in any combination of Pokémon without a Rule Box and Basic Energy cards from the discard pile into your hand", () => {
  const dk = deck('sv06-155', SNORLAX, EEVEE, BLISSEY, ULTRA, BOOMERANG);
  const g = scenario(dk, dk, [
    { active: 'Snorlax', hand: ["Lana's Aid"], discard: ['Snorlax', 'Eevee', 'Blissey ex', 'Fire Energy', 'Boomerang Energy', 'Ultra Ball', 'Water Energy'] },
    { active: 'Snorlax' },
  ]);
  choose(g, "Play Lana's Aid");
  assert.equal(g.decision?.max, 3);
  assert.equal(g.decision?.min, 1);
  assert.equal(labels(g).length, 4, 'Snorlax, Eevee, Fire Energy, Water Energy: no Blissey ex, Special Energy or Item');
  assert.ok(!labels(g).some((l) => l.includes('Blissey') || l.includes('Boomerang') || l.includes('Ultra')));
  pick(g, ['Snorlax', 'Fire Energy', 'Water Energy']);
  assert.deepEqual(names(g, g.state.p[0].hand), [F, 'Snorlax', W]);
  // Nothing it could take: it can't be played.
  const none = scenario(dk, dk, [{ active: 'Snorlax', hand: ["Lana's Aid"], discard: ['Blissey ex', 'Boomerang Energy', 'Ultra Ball'] }, { active: 'Snorlax' }]);
  assert.ok(!has(none, "Play Lana's Aid"));
});

test("Love Ball: search your deck for a Pokémon with the same name as 1 of your opponent's Pokémon in play, reveal it, put it into your hand", () => {
  const dk = deck('sv06-156', SNORLAX, EEVEE, CHANSEY, TYR);
  const g = scenario(dk, dk, [{ active: 'Chansey', hand: ['Love Ball'] }, { active: 'Snorlax', bench: ['Eevee'] }]);
  choose(g, 'Play Love Ball');
  const offered = new Set(labels(g).map((l) => (l.includes('Snorlax') ? 'Snorlax' : l.includes('Eevee') ? 'Eevee' : l)));
  assert.deepEqual([...offered].sort(), ['Eevee', 'Snorlax'], 'a Pokémon in play on either side of the board of the OPPONENT; not Chansey, not Tyranitar');
  assert.equal(g.decision?.max, 1);
  pick(g, ['Eevee']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Eevee']);
  assert.equal(g.state.p[0].revealed.length, 1, 'it is revealed');
  assert.ok(!g.state.p[0].deck.includes(g.state.p[0].hand[0]!));
  // No Pokémon with that name in the deck: the search comes up empty, but the card is still played.
  const dk2 = deck('sv06-156', CHANSEY);
  const empty = scenario(dk2, dk2, [{ active: 'Chansey', hand: ['Love Ball'] }, { active: 'Chansey' }]);
  const before = empty.state.p[0].deck.length;
  choose(empty, 'Play Love Ball');
  assert.equal(empty.state.p[0].hand.length, 0);
  assert.equal(empty.state.p[0].deck.length, before);
});

test('Perrin: reveal up to 2 Pokémon in your hand and put them into your deck; then search for up to that many Pokémon into your hand', () => {
  const dk = deck('sv06-160', SNORLAX, EEVEE, CHANSEY, ULTRA);
  const run = (): Game => scenario(dk, dk, [{ active: 'Snorlax', hand: ['Perrin', 'Snorlax', 'Eevee', 'Ultra Ball'] }, { active: 'Snorlax' }]);
  const g = run();
  const snorlaxBefore = count(g, g.state.p[0].deck, 'Snorlax');
  const eeveeBefore = count(g, g.state.p[0].deck, 'Eevee');
  choose(g, 'Play Perrin');
  assert.equal(g.decision?.max, 2);
  assert.equal(g.decision?.min, 1);
  assert.ok(labels(g).every((l) => l.includes('Snorlax') || l.includes('Eevee')), 'only Pokémon');
  pick(g, ['Snorlax', 'Eevee']);
  assert.equal(g.decision?.max, 2, 'up to that many');
  pick(g, ['Chansey', 'Chansey']);
  assert.deepEqual(names(g, g.state.p[0].hand), ['Chansey', 'Chansey', 'Ultra Ball']);
  assert.equal(count(g, g.state.p[0].deck, 'Snorlax'), snorlaxBefore + 1);
  assert.equal(count(g, g.state.p[0].deck, 'Eevee'), eeveeBefore + 1);
  assert.equal(g.state.p[0].revealed.length, 2, 'the Pokémon found are revealed');
  // Putting just 1 back means finding at most 1.
  const h = run();
  choose(h, 'Play Perrin');
  pick(h, ['Eevee']);
  assert.equal(h.decision?.max, 1);
  // No Pokémon in hand: it can't be played.
  const none = scenario(dk, dk, [{ active: 'Snorlax', hand: ['Perrin', 'Ultra Ball'] }, { active: 'Snorlax' }]);
  assert.ok(!has(none, 'Play Perrin'));
});

// ------------------------------------------------------------------ Lucian

test('Lucian: each player shuffles their hand to the bottom of their deck, then each flips a coin: heads draws 6, tails draws 3', () => {
  const dk = deck('sv06-157', SNORLAX, EEVEE, ULTRA, CHANSEY);
  const run = (coins: boolean[], mine: string[], theirs: string[]): Game => {
    const g = scenario(dk, dk, [
      { active: 'Snorlax', hand: ['Lucian', ...mine] },
      { active: 'Snorlax', hand: theirs },
    ]);
    g.state.forcedCoins = coins.slice();
    choose(g, 'Play Lucian');
    return g;
  };
  const g = run([true, false], ['Eevee', 'Chansey'], ['Ultra Ball', 'Snorlax', 'Eevee', 'Eevee']);
  assert.equal(g.state.p[0].hand.length, 6, 'heads: 6');
  assert.equal(g.state.p[1].hand.length, 3, 'tails: 3');
  // The old hands are the bottom of the decks: Lucian's own deck holds the old cards at the bottom.
  assert.deepEqual(names(g, g.state.p[0].deck.slice(0, 2)), ['Chansey', 'Eevee']);
  assert.deepEqual(names(g, g.state.p[1].deck.slice(0, 4)), ['Eevee', 'Eevee', 'Snorlax', 'Ultra Ball']);
  assert.equal(g.state.forcedCoins.length, 0);
  const h = run([false, true], ['Eevee'], ['Eevee']);
  assert.equal(h.state.p[0].hand.length, 3);
  assert.equal(h.state.p[1].hand.length, 6);
  // Only one player put cards on the bottom: both still flip.
  const one = run([true, true], [], ['Eevee']);
  assert.equal(one.state.p[0].hand.length, 6);
  assert.equal(one.state.p[1].hand.length, 6);
  const mineOnly = run([false, false], ['Eevee'], []);
  assert.equal(mineOnly.state.p[0].hand.length, 3);
  assert.equal(mineOnly.state.p[1].hand.length, 3);
  // Neither player had a card: nobody flips or draws.
  const nobody = run([true], [], []);
  assert.equal(nobody.state.p[0].hand.length, 0);
  assert.equal(nobody.state.p[1].hand.length, 0);
  assert.equal(nobody.state.forcedCoins.length, 1);
});

// ------------------------------------------------------------------ Ogre's Mask

test("Ogre's Mask: switch an Ogerpon ex in your discard pile with an Ogerpon ex in play; everything attached stays", () => {
  const dk = deck('sv06-159', 'sv06-025', 'sv06-040', 'sv06-112', 'sv06-024', FAN);
  const g = scenario(dk, dk, [
    { active: 'Teal Mask Ogerpon ex', hand: ["Ogre's Mask"], energy: { active: [G, F] }, tools: { active: ['Handheld Fan'] }, damage: { active: 50 }, cond: 4, discard: ['Hearthflame Mask Ogerpon ex', 'Teal Mask Ogerpon'] },
    { active: 'Teal Mask Ogerpon ex' },
  ]);
  const slotId = g.state.p[0].active!.id;
  const oldCard = topCard(g.state.p[0].active!);
  choose(g, "Play Ogre's Mask");
  // The only Ogerpon ex in the discard pile is Hearthflame (the non-ex Ogerpon is not a Pokémon ex).
  const a = g.state.p[0].active!;
  assert.equal(a.id, slotId);
  assert.equal(name(g, topCard(a)), 'Hearthflame Mask Ogerpon ex');
  assert.deepEqual(energyNames(g, 0, 'active'), [F, G]);
  assert.deepEqual(names(g, a.tools), ['Handheld Fan']);
  assert.equal(a.damage, 50);
  assert.equal(a.cond, 4, 'Special Conditions stay');
  assert.ok(g.state.p[0].discard.includes(oldCard), 'the Pokémon that was in play is in the discard pile now');
  assert.equal(a.cards.length, 1);
  // Ruling (Twilight Masquerade FAQ, TPCi Rules Team 2024-05-23, https://compendium.pokegym.net/ruling/1988/): Can switch to another copy of the same Pokémon in the discard pile.
  const same = scenario(dk, dk, [{ active: 'Teal Mask Ogerpon ex', hand: ["Ogre's Mask"], discard: ['Teal Mask Ogerpon ex'] }, { active: 'Teal Mask Ogerpon ex' }]);
  const inPlay = topCard(same.state.p[0].active!);
  const inDiscard = same.state.p[0].discard[0]!;
  choose(same, "Play Ogre's Mask");
  assert.equal(topCard(same.state.p[0].active!), inDiscard);
  assert.ok(same.state.p[0].discard.includes(inPlay) && !same.state.p[0].discard.includes(inDiscard));
  // Choosing which of two Ogerpon ex in play gets switched.
  const two = scenario(dk, dk, [{ active: 'Teal Mask Ogerpon ex', bench: ['Cornerstone Mask Ogerpon ex'], hand: ["Ogre's Mask"], discard: ['Hearthflame Mask Ogerpon ex'] }, { active: 'Teal Mask Ogerpon ex' }]);
  choose(two, "Play Ogre's Mask");
  pick(two, ['Cornerstone']);
  assert.deepEqual(benchNames(two, 0), ['Hearthflame Mask Ogerpon ex']);
  assert.equal(name(two, topCard(two.state.p[0].active!)), 'Teal Mask Ogerpon ex');
  // No Ogerpon ex in the discard pile, or none in play: it can't be played.
  const noDiscard = scenario(dk, dk, [{ active: 'Teal Mask Ogerpon ex', hand: ["Ogre's Mask"], discard: ['Teal Mask Ogerpon'] }, { active: 'Teal Mask Ogerpon ex' }]);
  assert.ok(!has(noDiscard, "Play Ogre's Mask"));
  const noneInPlay = scenario(dk, dk, [{ active: 'Teal Mask Ogerpon', hand: ["Ogre's Mask"], discard: ['Hearthflame Mask Ogerpon ex'] }, { active: 'Teal Mask Ogerpon ex' }]);
  assert.ok(!has(noneInPlay, "Play Ogre's Mask"));
});

// ------------------------------------------------------------------ Scoop Up Cyclone

test('Scoop Up Cyclone: put 1 of your Pokémon and all attached cards into your hand', () => {
  const dk = deck('sv06-162', SNORLAX, EEVEE, 'sv08.5-023', FAN, TYR);
  const setup = (): Game =>
    scenario(dk, dk, [
      {
        active: 'Snorlax',
        bench: ['Eevee', 'Eevee'],
        hand: ['Scoop Up Cyclone'],
        energy: { active: [F], 0: [W, L] },
        evolve: { 0: ['Vaporeon ex'] },
        tools: { 0: ['Handheld Fan'] },
        damage: { 0: 20 },
      },
      { active: 'Tyranitar ex' },
    ]);
  const g = setup();
  choose(g, 'Play Scoop Up Cyclone');
  assert.equal(g.decision?.kind, 'slots');
  choose(g, 'Vaporeon ex');
  assert.deepEqual(names(g, g.state.p[0].hand), ['Eevee', 'Handheld Fan', L, 'Vaporeon ex', W].sort());
  assert.deepEqual(benchNames(g, 0), ['Eevee']);
  assert.equal(name(g, topCard(g.state.p[0].active!)), 'Snorlax');
  // The Active Pokémon: the Bench is where the next Active Pokémon comes from.
  const h = setup();
  choose(h, 'Play Scoop Up Cyclone');
  choose(h, 'Snorlax');
  assert.deepEqual(names(h, h.state.p[0].hand), ['Snorlax', F].sort());
  choose(h, 'Vaporeon ex'); // promote one of the two Benched Pokémon
  assert.equal(name(h, topCard(h.state.p[0].active!)), 'Vaporeon ex');
  assert.equal(h.state.p[0].bench.length, 1);
});
