/**
 * Rulings audit, engine lane: one scenario test per Pokémon Rulings Compendium ruling the engine learned to follow. Each test cites
 * the ruling by its Compendium URL and gives a one-line summary in our own words (the ruling text stays on compendium.pokegym.net).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance, legalActions } from '../flow.js';
import { findSlot } from '../state.js';
import { Game } from '../game.js';
import { scenario } from '../scenario.js';
import { topCard } from '../state.js';
import type { StaticEffect } from '../dsl.js';
import type { Decision } from '../types.js';
import { fromIds } from './decks.js';

const labels = (g: Game): string[] => describeOptions(g.ctx, g.state, g.decision as Decision);
const has = (g: Game, text: string): boolean => labels(g).some((l) => l.includes(text));
function choose(g: Game, text: string): void {
  const i = labels(g).findIndex((l) => l.includes(text));
  assert.ok(i >= 0, `no option containing "${text}" in: ${labels(g).join(' | ')} [${g.decision?.prompt}]`);
  g.submit([i]);
}
const nameOf = (g: Game, iid: number): string => def(g.ctx, iid).name;
const stack = (g: Game, p: 0 | 1, where: 'active' | number): string[] => {
  const sl = where === 'active' ? g.state.p[p].active! : g.state.p[p].bench[where]!;
  return sl.cards.map((c) => nameOf(g, c));
};
function inject(g: Game, slotId: number, st: StaticEffect): void {
  const loc = findSlot(g.state, slotId)!;
  g.state.effects.push({ static: st, slot: slotId, player: loc.owner, until: g.state.turn + 1, fromAttack: false, src: 0 });
}
function setStadium(g: Game, owner: 0 | 1, name: string): void {
  const deck = g.state.p[owner].deck;
  const i = deck.findIndex((c) => nameOf(g, c) === name);
  assert.ok(i >= 0, `no ${name} in the deck`);
  g.state.stadium = { card: deck.splice(i, 1)[0] as number, owner };
  g.state.pending = null;
  advance(g.envForInternals, g.state);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
function deck(ids: string[]): DeckInput {
  return fromIds('rule', [...[...new Set(ids)].map((id): [string, number] => [id, 4]), ...ENERGY]);
}
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const C = 'Colorless Energy';
void C;

const DRAGAPULT = 'sv06-130'; // 320 HP, no Weakness: a neutral target

test('Compendium #1138: Rare Candy cannot be used on a Pokémon that was devolved this turn', () => {
  // https://compendium.pokegym.net/ruling/1138/ -- a devolved Pokémon counts as just come into play, so Rare Candy is off for it this turn.
  const dk = deck(['me01-128', 'sv01-191', 'me01-054', 'me01-055', 'me01-056', 'sv08.5-064']);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex', bench: ['Abra'], evolve: { 0: ['Kadabra'] }, hand: ['Strange Timepiece', 'Rare Candy', 'Alakazam'] }, { active: 'Tyranitar ex' }]);
  choose(g, 'Play Strange Timepiece');
  assert.deepEqual(stack(g, 0, 0), ['Abra']);
  assert.ok(!has(g, 'Play Rare Candy'), 'devolved this turn');
  const c = scenario(dk, dk, [{ active: 'Tyranitar ex', bench: ['Abra'], hand: ['Rare Candy', 'Alakazam'] }, { active: 'Tyranitar ex' }]);
  assert.ok(has(c, 'Play Rare Candy'), 'control: an Abra in play since an earlier turn');
});

test('Compendium #2041: a Pokémon that survives a full-HP Knock Out is left on 10 HP, worked out at the max HP it has once the attack has finished (for example after the attack discards a Lively Stadium)', () => {
  // https://compendium.pokegym.net/ruling/2041/ -- full-HP survival is settled after the attack: 190 damage on a 200 HP Pikachu ex once the Stadium is gone.
  const dk = deck(['me02.5-057', 'sv08-180', 'me03-046', 'me02.5-116']);
  const run = (reduce: number): Game => {
    const g = scenario(dk, dk, [
      { active: 'Hawlucha', evolve: { active: ['Mega Hawlucha ex'] }, energy: { active: [FI, FI, FI, FI] } },
      { active: 'Pikachu ex' },
    ]);
    setStadium(g, 0, 'Lively Stadium');
    inject(g, g.state.p[1].active!.id, { k: 'damageIn', amount: reduce });
    choose(g, 'Attack: Somersault Dive');
    return g;
  };
  // Enough damage for the 230 HP it has under the Stadium: it survives, and the HP left is 10 at the 200 HP it has afterwards.
  const g = run(-1);
  assert.equal(g.state.stadium, null, 'the attack discarded the Stadium');
  assert.ok(g.state.p[1].active, 'Pikachu ex survived');
  assert.equal(nameOf(g, topCard(g.state.p[1].active!)), 'Pikachu ex');
  assert.equal(g.state.p[1].active!.damage, 190);
  // The same hit one point short of 230 does not trigger it (it is not "would be Knocked Out" while the Stadium is in play), and with the
  // Stadium gone the 200 HP maximum is exceeded: Knocked Out.
  const k = run(-290 - 1 + 1 - 1);
  assert.ok(!k.state.p[1].active || nameOf(k, topCard(k.state.p[1].active)) !== 'Pikachu ex', 'Knocked Out');
  const e = run(-290);
  assert.equal(e.state.p[1].active!.damage, 190, 'exactly the 230 HP: it survives');
});

test('Compendium #1822: "attacks used by the Defending Pokémon do 30 less damage" also reduces damage to Benched Pokémon and to its own side', () => {
  // https://compendium.pokegym.net/ruling/1822/ -- the reduction covers all the attack damage, Benched targets and self-damage included.
  const dk = deck(['sv08-096', 'sv08-077', 'sv08-045', 'me03-046']);
  const bench = (moonblast: boolean): number => {
    const g = scenario(dk, dk, [
      { active: 'Flutter Mane', energy: { active: [P, P, P] }, bench: ['Hawlucha'] },
      { active: 'Latios', energy: { active: [P, L, W, FI] } },
    ]);
    if (moonblast) choose(g, 'Attack: Moonblast');
    else g.state.current = 1;
    if (!moonblast) advance(g.envForInternals, g.state);
    assert.equal(g.state.current, 1);
    choose(g, 'Attack: Skill Dive');
    choose(g, 'Hawlucha');
    return g.state.p[0].bench[0]!.damage;
  };
  assert.equal(bench(false), 50, 'control: Skill Dive does 50 to a Benched Pokémon');
  assert.equal(bench(true), 20, 'after Moonblast: 50 - 30');
  // Self-damage: Walrein's Megaton Fall puts 50 on itself; under Moonblast that is 20.
  const self = (moonblast: boolean): number => {
    const g = scenario(dk, dk, [
      { active: 'Flutter Mane', energy: { active: [P, P, P] } },
      { active: 'Walrein', energy: { active: [W, W, W, W, W] } },
    ]);
    if (moonblast) choose(g, 'Attack: Moonblast');
    else {
      g.state.current = 1;
      advance(g.envForInternals, g.state);
    }
    const before = g.state.p[1].active!.damage;
    choose(g, 'Attack: Megaton Fall');
    return g.state.p[1].active!.damage - before;
  };
  assert.equal(self(false), 50, 'control');
  assert.equal(self(true), 20, 'the reduction applies to the damage it does to itself');
});

test('Compendium #342: an attack that evolves a Pokémon works on the second player\'s own first turn', () => {
  // https://compendium.pokegym.net/ruling/342/ -- evolving by an attack's effect is not stopped by the first-turn rule (Rare Candy and Evosoda stop themselves).
  const dk = deck(['sv06-135', 'sv08.5-014', 'sv08.5-023', 'sv08.5-064']);
  const g = scenario(dk, dk, [{ active: 'Tyranitar ex' }, { active: 'Eevee', energy: { active: ['Fire Energy', 'Fire Energy'] } }], { turn: 2, current: 1, first: 0 });
  choose(g, 'Attack: Ascension');
  g.submit([0]);
  const s = stack(g, 1, 'active');
  assert.equal(s.length, 2, `Eevee evolved: ${s.join(',')}`);
  assert.equal(s[0], 'Eevee');
});

test('Compendium #362: a search for Pokémon to Bench does nothing at all when the Bench is full (no search, no shuffle)', () => {
  // https://compendium.pokegym.net/ruling/362/ -- with no room, the whole effect fails; the deck is not even shuffled.
  const dk = deck(['me02-067', 'me03-046', 'sv08.5-064']);
  const run = (bench: string[]): { before: number[]; g: Game } => {
    const g = scenario(dk, dk, [{ active: 'Toxel', bench, energy: { active: ['Darkness Energy', P, 'Fighting Energy'] } }, { active: 'Tyranitar ex' }]);
    const before = g.state.p[0].deck.slice();
    choose(g, 'Attack: Call for Family');
    if (g.decision?.kind === 'cards') g.submit([0]);
    return { before, g };
  };
  const full = run(['Hawlucha', 'Hawlucha', 'Hawlucha', 'Hawlucha', 'Toxel']);
  assert.equal(full.g.state.p[0].bench.length, 5);
  assert.deepEqual(full.g.state.p[0].deck, full.before, 'the deck was neither searched nor shuffled (same cards, same order)');
  assert.equal(full.g.state.p[0].prizesKnown, false, 'no search happened, so the Prize cards stay unknown to their owner');
  const open = run(['Hawlucha', 'Hawlucha', 'Hawlucha', 'Toxel']);
  assert.equal(open.g.state.p[0].bench.length, 5, 'control: with room it benches one');
  assert.notDeepEqual(open.g.state.p[0].deck, open.before);
  assert.equal(open.g.state.p[0].prizesKnown, true, 'control: a real search looks through the deck, which reveals the Prize cards');
});

test('Compendium #2122: a Pokémon whose damage meets its new HP when it evolves is Knocked Out before its evolve trigger', () => {
  // https://compendium.pokegym.net/ruling/2122/ -- the Knock Out comes first (the engine queues no evolve trigger for a Pokémon already over its HP).
  const dk = deck(['sv08.5-077', 'sv07-115', 'sv07-128', 'sv08-180', 'me05-039']);
  const mk = (damage: number): Game => {
    const g = scenario(dk, dk, [{ active: 'Hoothoot', damage: { active: damage }, bench: ['Terapagos ex', 'Dhelmise'], hand: ['Lively Stadium', 'Noctowl'] }, { active: 'Dhelmise' }]);
    choose(g, 'Play Lively Stadium');
    return g;
  };
  const ok = mk(90);
  choose(ok, 'Evolve Hoothoot');
  assert.equal(ok.decision!.kind, 'yesno', 'control: the ability is offered');
  const ko = mk(100);
  choose(ko, 'Evolve Hoothoot');
  assert.notEqual(ko.decision?.kind, 'yesno');
  assert.ok(ko.state.p[0].discard.some((c) => nameOf(ko, c) === 'Noctowl'), 'Noctowl was Knocked Out');
});

test('Compendium #2212: an opening hand with no Basic but a Cinderace lets the player put it Active or mulligan', () => {
  // https://compendium.pokegym.net/ruling/2212/ -- Explosiveness gives a choice: Cinderace in the Active Spot, or show the hand and mulligan.
  const dk = fromIds('rule', [['me01-028', 4], ['sv06-128', 4], ...ENERGY]);
  for (let seed = 1; seed < 400; seed++) {
    const g = new Game(dk, dk, seed, { first: 0 }).start();
    const d = g.decision;
    if (!d || d.kind !== 'yesno' || !d.prompt.includes('Cinderace')) continue;
    const hand = g.state.p[d.player].hand;
    assert.ok(!hand.some((c) => def(g.ctx, c).stage === 0 && def(g.ctx, c).kind === 'pokemon'), 'no Basic in hand');
    const mulls = g.state.p[d.player].mulligans;
    const keep = new Game(dk, dk, seed, { first: 0 }).start();
    keep.submit([0]);
    assert.equal(keep.state.p[d.player].mulligans, mulls, 'no mulligan taken');
    assert.equal(keep.decision?.kind, 'setupActive');
    assert.ok((keep.decision!.values as number[]).some((c) => nameOf(keep, c) === 'Cinderace'), 'Cinderace can go Active');
    g.submit([1]);
    assert.ok(g.state.p[d.player].mulligans > mulls, 'mulligan taken');
    return;
  }
  assert.fail('no seed gave an opening hand with Cinderace and no Basic');
});

test('Compendium #620: Weakness and Resistance apply to the damage an attack does to its own Active Pokémon', () => {
  // https://compendium.pokegym.net/ruling/620/ -- an attack's self-damage to its own Active goes through Weakness (and Resistance).
  const dk = deck(['sv06-104', DRAGAPULT]);
  const run = (weak: boolean): number => {
    const g = scenario(dk, dk, [{ active: 'Gurdurr', energy: { active: [FI, FI, FI] } }, { active: 'Dragapult ex' }]);
    if (weak) inject(g, g.state.p[0].active!.id, { k: 'weaknessType', type: 'Fighting' });
    choose(g, 'Attack: Superpower');
    if (g.decision?.kind === 'yesno') g.submit([0]);
    return g.state.p[0].active!.damage;
  };
  assert.equal(run(false), 30, 'control: no Weakness');
  assert.equal(run(true), 60, 'Weak to Fighting: the 30 doubles');
});

test('Compendium #2032: a fixed attack cost is final; a cost increase does not add to it', () => {
  // https://compendium.pokegym.net/ruling/2032/ -- Kyurem's one-{C} Trifrost stays one {C} against an opposing Antique Root Fossil.
  const dk = deck(['sv06.5-047', 'sv06.5-057', 'sv07-130']);
  const mk = (fossil: boolean): Game =>
    scenario(dk, dk, [{ active: 'Kyurem', energy: { active: [W] } }, { active: fossil ? 'Antique Root Fossil' : 'Tyranitar ex', discard: ["Colress's Tenacity"] }]);
  void mk;
  const g = scenario(dk, dk, [{ active: 'Kyurem', energy: { active: [W] } }, { active: 'Antique Root Fossil', bench: ['Kyurem'], discard: ["Colress's Tenacity"] }]);
  assert.ok(has(g, 'Attack: Trifrost'), 'one Energy is enough');
});
