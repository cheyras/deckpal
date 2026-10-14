/**
 * Rulings audit 09: one scenario test per Pokémon Rulings Compendium ruling listed here, plus the REVIEWED table of the
 * rulings that no position in the simulator can decide. Each test cites the ruling by its Compendium URL and gives a
 * one-line summary of what it decides in our own words (the ruling text itself stays on compendium.pokegym.net).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { def, type DeckInput } from '../context.js';
import { describeOptions } from '../describe.js';
import { advance, legalActions } from '../flow.js';
import type { Game } from '../game.js';
import { scenario, type SideLayout } from '../scenario.js';
import { topCard } from '../state.js';
import { BURNED, CONFUSED, type Decision } from '../types.js';
import { fromIds } from './decks.js';

const labels = (g: Game): string[] => describeOptions(g.ctx, g.state, g.decision as Decision);
const has = (g: Game, text: string): boolean => labels(g).some((l) => l.includes(text));
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
const nameOf = (g: Game, iid: number): string => def(g.ctx, iid).name;
const namesOf = (g: Game, iids: number[]): string[] => iids.map((c) => nameOf(g, c)).sort();
const dmg = (g: Game, p: 0 | 1): number => g.state.p[p].active!.damage;
function canEvolve(g: Game, into: string, slotId: number, p: 0 | 1 = 0): boolean {
  return legalActions(g.env, g.state, p).some((a) => a.t === 'evolve' && a.slot === slotId && nameOf(g, a.card) === into);
}
/** Put the Stadium card from this player's deck into play, as if that player had played it. */
function putStadium(g: Game, owner: 0 | 1, stadium: string): void {
  const deck = g.state.p[owner].deck;
  const i = deck.findIndex((c) => nameOf(g, c) === stadium);
  assert.ok(i >= 0, `no ${stadium} in P${owner + 1}'s deck`);
  g.state.stadium = { card: deck.splice(i, 1)[0] as number, owner };
  g.state.pending = null;
  advance(g.env, g.state);
}

const ENERGY: [string, number][] = ['mee-001', 'mee-002', 'mee-003', 'mee-004', 'mee-005', 'mee-006', 'mee-007', 'mee-008'].map((id) => [id, 10]);
/** A test deck: 4 copies of each listed card (10 for Pokémon the test needs more of) plus plenty of every basic Energy. */
function deck(ids: string[], counts: Record<string, number> = {}): DeckInput {
  return fromIds('r09', [...[...new Set(ids)].map((id): [string, number] => [id, counts[id] ?? 4]), ...ENERGY]);
}
const G = 'Grass Energy';
const F = 'Fire Energy';
const W = 'Water Energy';
const L = 'Lightning Energy';
const P = 'Psychic Energy';
const FI = 'Fighting Energy';
const D = 'Darkness Energy';
const M = 'Metal Energy';
const DRA = 'Dragapult ex'; // 320 HP, no Weakness or Resistance: a neutral target; Jet Headbutt {C} 70
type Sides = [SideLayout, SideLayout];

// The supporting cast, by id.
const DRAGAPULT = 'sv06-130';
const DHELMISE = 'me05-039'; // Basic, 140 HP, no Rule Box
const PURRLOIN = 'sv10.5w-055'; // Basic {D}, 60 HP
const TYRANITAR_EX = 'sv08.5-064'; // Stage 2 {D}, 340 HP
const LEGACY = 'sv06-167'; // Legacy Energy

// ------------------------------------------------------------------ Antique Armor Fossil, Risky Ruins

test('Compendium #2429: Risky Ruins puts its 2 damage counters on an Antique Armor Fossil played to the Bench (a fossil counts as a Pokémon once in play)', () => {
  // https://compendium.pokegym.net/ruling/2429/ -- yes, the counters are placed.
  const dk = deck(['me01-127', 'me05-072', DHELMISE]);
  const g = scenario(dk, dk, [{ active: 'Dhelmise', hand: ['Antique Armor Fossil', 'Risky Ruins'] }, { active: 'Dhelmise' }]);
  choose(g, 'Play Risky Ruins');
  choose(g, 'Antique Armor Fossil');
  assert.equal(namesOf(g, g.state.p[0].bench.map(topCard)).join(), 'Antique Armor Fossil');
  assert.equal(g.state.p[0].bench[0]!.damage, 20, 'two damage counters on the fossil');
  // Control: with no Stadium the fossil arrives undamaged.
  const bare = scenario(dk, dk, [{ active: 'Dhelmise', hand: ['Antique Armor Fossil'] }, { active: 'Dhelmise' }]);
  choose(bare, 'Antique Armor Fossil');
  assert.equal(bare.state.p[0].bench[0]!.damage, 0);
});

// ------------------------------------------------------------------ Dark Bell

test("Compendium #2418: Dark Bell can't be played when both Active Pokémon are {D} and/or Confused (no valid target)", () => {
  // https://compendium.pokegym.net/ruling/2418/ -- with no valid target the card can't be played.
  const dk = deck(['me05-075', DHELMISE, PURRLOIN]);
  const mk = (a: SideLayout, b: SideLayout): Game => scenario(dk, dk, [{ hand: ['Dark Bell'], ...a }, b]);
  assert.ok(has(mk({ active: 'Dhelmise' }, { active: 'Dhelmise' }), 'Play Dark Bell'), 'both targets valid');
  assert.ok(has(mk({ active: 'Dhelmise', cond: CONFUSED }, { active: 'Dhelmise' }), 'Play Dark Bell'), 'one valid target is enough');
  assert.ok(has(mk({ active: 'Purrloin' }, { active: 'Dhelmise' }), 'Play Dark Bell'), 'one valid target is enough');
  assert.ok(!has(mk({ active: 'Dhelmise', cond: CONFUSED }, { active: 'Dhelmise', cond: CONFUSED }), 'Play Dark Bell'), 'both Confused');
  assert.ok(!has(mk({ active: 'Purrloin' }, { active: 'Purrloin' }), 'Play Dark Bell'), 'both {D}');
  assert.ok(!has(mk({ active: 'Purrloin' }, { active: 'Dhelmise', cond: CONFUSED }), 'Play Dark Bell'), 'one {D}, the other Confused');
  assert.ok(!has(mk({ active: 'Dhelmise', cond: CONFUSED }, { active: 'Purrloin' }), 'Play Dark Bell'), 'one Confused, the other {D}');
});

// ------------------------------------------------------------------ Strange Timepiece, Eevee

test('Compendium #2327: an Active Eevee devolved by Strange Timepiece can evolve again at once (Boosted Evolution overrides the reminder text)', () => {
  // https://compendium.pokegym.net/ruling/2327/ -- "that Pokémon can't evolve this turn" is only the rules' reminder; Boosted Evolution overrides it.
  const dk = deck(['sv08-143', 'sv08.5-023', 'sv08.5-034', 'sv06-128', 'me01-128']);
  const g = scenario(dk, dk, [{ active: 'Eevee', evolve: { active: ['Espeon ex'] }, hand: ['Strange Timepiece', 'Vaporeon ex'] }, { active: 'Dreepy' }]);
  assert.ok(!canEvolve(g, 'Vaporeon ex', g.state.p[0].active!.id), 'an Espeon ex: Vaporeon ex does not evolve from it');
  choose(g, 'Play Strange Timepiece');
  if (g.decision!.kind === 'slots') g.submit([(g.decision!.values as number[]).indexOf(g.state.p[0].active!.id)]);
  assert.deepEqual(namesOf(g, g.state.p[0].active!.cards), ['Eevee'], 'devolved');
  assert.ok(canEvolve(g, 'Vaporeon ex', g.state.p[0].active!.id), 'the Active Eevee can evolve into Vaporeon ex right away');
  choose(g, 'into Vaporeon ex');
  assert.equal(nameOf(g, topCard(g.state.p[0].active!)), 'Vaporeon ex');
  // Control: a Benched Eevee has no Boosted Evolution, so the devolved Pokémon cannot evolve again this turn.
  const h = scenario(dk, dk, [{ active: 'Dreepy', bench: ['Eevee'], evolve: { 0: ['Espeon ex'] }, hand: ['Strange Timepiece', 'Vaporeon ex'] }, { active: 'Dreepy' }]);
  choose(h, 'Play Strange Timepiece');
  if (h.decision!.kind === 'slots') h.submit([(h.decision!.values as number[]).indexOf(h.state.p[0].bench[0]!.id)]);
  assert.deepEqual(namesOf(h, h.state.p[0].bench[0]!.cards), ['Eevee']);
  assert.ok(!canEvolve(h, 'Vaporeon ex', h.state.p[0].bench[0]!.id), 'Benched: the normal rule stands');
});

// ------------------------------------------------------------------ Turtonator, Mist Energy

test("Compendium #2310: Shell Spikes still makes the attacker discard an Energy when the attacker carries Mist Energy (an Ability's effect, not an attack's)", () => {
  // https://compendium.pokegym.net/ruling/2310/ -- Mist Energy only stops effects of attacks; Shell Spikes is an Ability.
  const dk = deck(['me03-017', 'sv05-161', DRAGAPULT]);
  const g = scenario(dk, dk, [
    { active: 'Turtonator' },
    { active: DRA, energy: { active: ['Mist Energy', P] } },
  ], { current: 1, turn: 4 });
  choose(g, 'Attack: Jet Headbutt');
  assert.equal(dmg(g, 0), 70, 'the attack damaged Turtonator');
  // Turtonator's owner is asked which Energy to discard from the Attacking Pokémon; Mist Energy is among the choices.
  assert.equal(g.decision?.kind, 'cards');
  assert.equal(g.decision?.player, 0);
  assert.deepEqual(labels(g).sort(), ['Mist Energy', 'Psychic Energy']);
  g.submit([labels(g).findIndex((l) => l === 'Mist Energy')]);
  const left = namesOf(g, g.state.p[1].active!.energy);
  assert.equal(left.length, 1, 'one Energy was discarded from the attacker');
  assert.deepEqual(left, [P], 'the discarded one was the Mist Energy: nothing stopped the Ability');
});

// ------------------------------------------------------------------ Paldean Tauros

test('Compendium #2255: Raging Charge counts every damaged Pokémon with "Tauros" in its name, Paldean Tauros and plain Tauros alike, and only the damaged ones', () => {
  // https://compendium.pokegym.net/ruling/2255/ -- a damaged Tauros counts alongside damaged Paldean Tauros: 40 each.
  const dk = deck(['me02-048', 'me04-096', DRAGAPULT, DHELMISE]);
  const hit = (me: SideLayout): number => {
    const g = scenario(dk, dk, [{ energy: { active: [FI] }, ...me }, { active: DRA }]);
    choose(g, 'Attack: Raging Charge');
    return dmg(g, 1);
  };
  assert.equal(hit({ active: 'Paldean Tauros', bench: ['Tauros', 'Tauros', 'Dhelmise'] }), 0, 'none damaged');
  assert.equal(hit({ active: 'Paldean Tauros', damage: { active: 10 }, bench: ['Tauros', 'Tauros', 'Dhelmise'] }), 40, 'the Paldean Tauros itself');
  assert.equal(hit({ active: 'Paldean Tauros', bench: ['Tauros', 'Tauros', 'Dhelmise'], damage: { 0: 10 } }), 40, 'a damaged Tauros');
  assert.equal(hit({ active: 'Paldean Tauros', damage: { active: 10, 0: 10, 1: 30, 2: 50 }, bench: ['Tauros', 'Tauros', 'Dhelmise'] }), 120, 'Paldean Tauros + 2 Tauros damaged; the damaged Dhelmise has no "Tauros" in its name');
  assert.equal(hit({ active: 'Paldean Tauros', bench: ['Paldean Tauros', 'Paldean Tauros', 'Tauros', 'Dhelmise'], damage: { 0: 10, 1: 10, 2: 10 } }), 120, 'two more Paldean Tauros and a Tauros damaged: 3 x 40');
});

// ------------------------------------------------------------------ Mega Manectric ex, Riotous Blasting (copied)

test('Compendium #2224: a Pokémon copying Riotous Blasting with a single Energy card attached may still choose the extra 130 (it discards what it has)', () => {
  // https://compendium.pokegym.net/ruling/2224/ -- the choice to do the extra damage does not depend on how much Energy there is to discard.
  // (The ruling copies the attack with Hypno's Pendulum Influence, which the simulator does not script; Thievul's Skill Thief copies the same way.)
  const dk = deck(['me01-050', 'me05-054', 'me05-053', 'me02-124', TYRANITAR_EX]);
  const mk = (): Game =>
    scenario(dk, dk, [
      { active: 'Nickit', evolve: { active: ['Thievul'] }, energy: { active: ['Ignition Energy'] }, hand: [] }, // {C}{C}{C} from one card on an Evolution Pokémon
      { active: 'Tyranitar ex', bench: ['Mega Manectric ex'] },
    ]);
  const g = mk();
  assert.equal(g.state.p[0].active!.energy.length, 1);
  choose(g, 'Attack: Skill Thief');
  choose(g, 'Mega Manectric ex');
  choose(g, 'Riotous Blasting');
  yes(g);
  assert.equal(dmg(g, 1), 330, '200 + 130');
  assert.equal(g.state.p[0].active!.energy.length, 0, 'the one Energy was discarded');
  // Declining keeps the base 200.
  const h = mk();
  choose(h, 'Attack: Skill Thief');
  choose(h, 'Mega Manectric ex');
  choose(h, 'Riotous Blasting');
  h.submit([1]);
  assert.equal(dmg(h, 1), 200);
});

// ------------------------------------------------------------------ Arven's Greedent, Team Rocket's Arbok, Team Rocket's Watchtower

test("Compendium #2147: Team Rocket's Watchtower does not lift Potent Glare from Arven's Greedent in the hand (it still has an Ability there)", () => {
  // https://compendium.pokegym.net/ruling/2147/ -- Watchtower only switches off Abilities of {C} Pokémon in play; the card in hand keeps its Ability.
  const dk = deck(['sv10-180', 'sv10-112', 'sv10-113', 'sv10-158', 'sv10-159', 'sv06-128']);
  const mk = (arbokActive: boolean): Game =>
    scenario(dk, dk, [
      { active: 'Dreepy', bench: ["Arven's Skwovet"], hand: ["Arven's Greedent"] },
      arbokActive
        ? { active: "Team Rocket's Ekans", evolve: { active: ["Team Rocket's Arbok"] } }
        : { active: 'Dreepy', bench: ["Team Rocket's Ekans"], evolve: { 0: ["Team Rocket's Arbok"] } },
    ]);
  const skwovet = (g: Game): number => g.state.p[0].bench[0]!.id;
  const bench = mk(false);
  assert.ok(canEvolve(bench, "Arven's Greedent", skwovet(bench)), 'Arbok on the Bench locks nothing');
  const g = mk(true);
  assert.ok(!canEvolve(g, "Arven's Greedent", skwovet(g)), 'Potent Glare stops it');
  putStadium(g, 1, "Team Rocket's Watchtower");
  assert.equal(nameOf(g, g.state.stadium!.card), "Team Rocket's Watchtower");
  assert.ok(!canEvolve(g, "Arven's Greedent", skwovet(g)), 'still stopped with Watchtower in play');
});

// ------------------------------------------------------------------ N's Zoroark ex, Trade

test("Compendium #2115: N's Zoroark ex can't use Trade with no cards in the deck (the discard is a cost, the drawing the effect)", () => {
  // https://compendium.pokegym.net/ruling/2115/ -- with an empty deck, Trade can't be used just to get rid of a card.
  // https://compendium.pokegym.net/ruling/1654/ -- the same answer for Liepard's Trade, which has the same wording.
  // https://compendium.pokegym.net/ruling/2114/ -- this wording is not Zoroark-GX's Trade, and it works differently (there the discard is free).
  const dk = deck(['sv09-098', DHELMISE]);
  const mk = (emptyDeck: boolean, hand: string[]): Game =>
    scenario(dk, dk, [{ active: "N's Zoroark ex", hand, emptyDeck }, { active: 'Dhelmise' }]);
  assert.ok(has(mk(false, ['Dhelmise']), 'Use Trade'), 'a card to discard and a deck to draw from');
  assert.ok(!has(mk(true, ['Dhelmise']), 'Use Trade'), 'empty deck: not usable');
  assert.ok(!has(mk(false, []), 'Use Trade'), 'empty hand: nothing to discard');
  // One card left in the deck is enough to start (draw as many as there are).
  const one = mk(false, ['Dhelmise']);
  one.state.p[0].deck.splice(0, one.state.p[0].deck.length - 1);
  one.state.pending = null; // the deck changed after the scenario was built: re-derive the legal actions
  advance(one.env, one.state);
  assert.ok(has(one, 'Use Trade'), 'one card in the deck: still usable');
  choose(one, 'Use Trade');
  assert.equal(one.state.p[0].discard.filter((c) => nameOf(one, c) === 'Dhelmise').length, 1, 'the hand card was discarded');
  assert.equal(one.state.p[0].hand.length, 1, 'and the one card left in the deck was drawn');
  assert.equal(one.state.p[0].deck.length, 0, 'the deck is now empty');
});

// ------------------------------------------------------------------ Magmortar, Magma Surge

test('Compendium #2112: Magma Surge adds to Burn, and a second Magmortar adds its own 3 again (2 + 3 + 3 = 8 damage counters)', () => {
  // https://compendium.pokegym.net/ruling/2112/ -- the Checkup counters are additive, one set per Magmortar.
  const dk = deck(['sv09-020', 'sv09-021', 'sv10.5w-067', 'sv06-128']);
  const mk = (benchMagmortar: boolean): Game => {
    const g = scenario(
      dk,
      dk,
      [
        {
          active: 'Magmar',
          bench: benchMagmortar ? ['Magmar'] : ['Dreepy'],
          evolve: benchMagmortar ? { active: ['Magmortar'], 0: ['Magmortar'] } : { active: ['Magmortar'] },
        },
        { active: 'Hydreigon ex', cond: BURNED },
      ],
      { turn: 3, current: 0, first: 0 },
    );
    g.state.forcedCoins = [false]; // the Burn flip: tails, still Burned
    choose(g, 'End turn');
    return g;
  };
  assert.equal(dmg(mk(false), 1), 50, 'one Magmortar: 2 (Burn) + 3');
  assert.equal(dmg(mk(true), 1), 80, 'two Magmortar: 2 + 3 + 3');
});

// ------------------------------------------------------------------ Jamming Tower, Technical Machine

test('Compendium #2006: under Jamming Tower a Technical Machine is not discarded at the end of the turn (its discard text is an effect, and Tool effects are off)', () => {
  // https://compendium.pokegym.net/ruling/2006/
  const dk = deck(['sv06-153', 'sv08-188', 'sv06-128']);
  const mk = (tower: boolean): Game => {
    const g = scenario(dk, dk, [{ active: 'Dreepy', tools: { active: ['Technical Machine: Fluorite'] } }, { active: 'Dreepy' }]);
    if (tower) putStadium(g, 1, 'Jamming Tower');
    choose(g, 'End turn');
    return g;
  };
  const plain = mk(false);
  assert.equal(plain.state.p[0].active!.tools.length, 0, 'no Stadium: discarded at the end of the turn');
  const g = mk(true);
  assert.equal(g.state.p[0].active!.tools.length, 1, 'Jamming Tower: the Technical Machine stays attached');
  assert.deepEqual(namesOf(g, g.state.p[0].active!.tools), ['Technical Machine: Fluorite']);
  assert.ok(!g.state.p[0].discard.some((c) => nameOf(g, c) === 'Technical Machine: Fluorite'));
});

// ------------------------------------------------------------------ Reuniclus, Summoning Gate

test('Compendium #1959: Summoning Gate may put non-Basic Pokémon from the top 8 directly onto the Bench', () => {
  // https://compendium.pokegym.net/ruling/1959/ -- a Stage 1 or Stage 2 found there goes onto the Bench as it is.
  const dk = deck(['sv05-072', TYRANITAR_EX, 'sv06-092', DHELMISE]);
  const g = scenario(dk, dk, [
    { active: 'Reuniclus', energy: { active: [P] }, deckTop: ['Tyranitar ex', 'Fire Energy', 'Palossand', 'Dhelmise', 'Fire Energy', 'Fire Energy', 'Fire Energy', 'Fire Energy'] },
    { active: 'Dhelmise' },
  ]);
  choose(g, 'Attack: Summoning Gate');
  assert.deepEqual(labels(g).sort(), ['Dhelmise', 'Palossand', 'Tyranitar ex'], 'the Energy is not offered; Stage 1 and Stage 2 are');
  pick(g, ['Tyranitar ex', 'Palossand']);
  assert.deepEqual(namesOf(g, g.state.p[0].bench.map(topCard)), ['Palossand', 'Tyranitar ex']);
  assert.ok(g.state.p[0].bench.every((b) => b.cards.length === 1), 'put onto the Bench alone, not evolved from anything');
});

// ------------------------------------------------------------------ Retaliate after a Knock Out that gives no Prize card

test('Compendium #1153: a Knock Out that takes no Prize card (Legacy Energy; Robo Substitute is not scripted) still powers up Retaliate', () => {
  // https://compendium.pokegym.net/ruling/1153/ -- a KO'd Pokémon that gives up no Prize card still counts as Knocked Out for Retaliate and its kin.
  const dk = deck(['30th-091', 'sv10.5w-054', 'sv09-057', PURRLOIN, LEGACY, DRAGAPULT]);
  const cases: [string, string[], number, number][] = [
    ['Umbreon', [D], 30, 130],
    ['Terrakion', [FI, FI], 50, 130],
    ['Alolan Marowak', [P], 30, 120],
  ];
  for (const [name, energy, base, boosted] of cases) {
    const mk = (legacy: boolean): Game =>
      scenario(
        dk,
        dk,
        [
          { active: 'Purrloin', damage: { active: 50 }, energy: legacy ? { active: ['Legacy Energy'], 0: energy } : { 0: energy }, bench: [name] },
          { active: DRA, energy: { active: [P] } },
        ],
        { current: 1, turn: 4 },
      );
    const g = mk(true);
    choose(g, 'Attack: Jet Headbutt');
    assert.equal(g.state.p[1].prizesTaken, 0, `${name}: Legacy Energy, so no Prize card for this Knock Out`);
    assert.equal(nameOf(g, topCard(g.state.p[0].active!)), name);
    choose(g, 'Attack: Retaliate');
    assert.equal(dmg(g, 1), boosted, `${name}: the Knock Out counts although no Prize card was taken`);
    // Control: without any Knock Out the attack is only its base damage.
    const c = scenario(dk, dk, [{ active: name, energy: { active: energy } }, { active: DRA }]);
    choose(c, 'Attack: Retaliate');
    assert.equal(dmg(c, 1), base, `${name}: no Knock Out, base damage`);
  }
});

// ------------------------------------------------------------------ Sand Attack, then an attack with a cost

test('Compendium #497: the Sand Attack coin is flipped before the attack does anything, so on tails a "discard a card or nothing" cost is never paid', () => {
  // https://compendium.pokegym.net/ruling/497/ -- flip for Sand Attack first: tails ends the attack at once, heads goes on as normal.
  // (The ruling's attacker is Passimian's Intentional Grounding, which the simulator does not script; Decidueye's Power Shot has the same shape:
  //  discard a card from the hand or the attack does nothing.)
  const sources: [string, string[], string[], string[]][] = [
    ['Hippopotas', ['me03-039'], [], ['Fighting Energy']],
    ['Sandygast', ['sv06-091'], [], [P]],
    ['Palossand', ['sv06-091', 'sv06-092'], ['Palossand'], [P, P, P]],
    ['Sandslash', ['me01-068', 'me01-069'], ['Sandslash'], [FI, FI]],
  ];
  const ids = ['sv06.5-003', 'sv06.5-004', 'sv06.5-005', ...sources.flatMap(([, i]) => i)];
  const dk = deck(ids);
  for (const [name, , evolve, energy] of sources) {
    const base = name === 'Palossand' ? 'Sandygast' : name === 'Sandslash' ? 'Sandshrew' : name;
    const mk = (coin: boolean): Game => {
      const g = scenario(
        dk,
        dk,
        [
          { active: 'Rowlet', evolve: { active: ['Dartrix', 'Decidueye'] }, energy: { active: [G] }, hand: ['Grass Energy'] },
          { active: base, ...(evolve.length ? { evolve: { active: evolve } } : {}), energy: { active: energy } },
        ],
        { current: 1, turn: 4 },
      );
      choose(g, 'Attack: Sand Attack');
      assert.equal(g.decision?.player, 0, `${name}: P1's attack is over`);
      g.state.forcedCoins = [coin];
      return g;
    };
    const grassInHand = (g: Game): number => g.state.p[0].hand.filter((c) => nameOf(g, c) === 'Grass Energy').length;
    // Tails: the attack doesn't happen; the Energy card stays in the hand and nothing is damaged.
    const tails = mk(false);
    const kept = grassInHand(tails);
    assert.ok(kept >= 1);
    choose(tails, 'Attack: Power Shot');
    assert.equal(grassInHand(tails), kept, `${name}: tails: no Energy card discarded`);
    assert.equal(tails.state.p[1].active!.damage, 0, `${name}: tails: no damage`);
    // Heads: the attack goes on, the Energy is discarded and the damage is done.
    const heads = mk(true);
    const before = grassInHand(heads);
    const dmgBefore = dmg(heads, 1);
    choose(heads, 'Attack: Power Shot');
    if (heads.decision?.kind === 'cards') pick(heads, ['Grass Energy']);
    assert.equal(grassInHand(heads), before - 1, `${name}: heads: one Energy card discarded`);
    assert.ok(heads.state.p[0].prizes.length < 6 || dmg(heads, 1) > dmgBefore, `${name}: heads: 170 damage was done`);
  }
});

// ------------------------------------------------------------------ Bronzong, Evolution Jammer

test('Compendium #434: Evolution Jammer is not overridden by an effect that allows evolving early (Eevee, Boosted Evolution, stands in for a Delta Evolution trait)', () => {
  // https://compendium.pokegym.net/ruling/434/ -- an ability to evolve out of turn does not get past "can't play any Pokémon from your hand to evolve".
  // (The Ancient Trait Delta Evolution is not scripted; Boosted Evolution is the same kind of exception, a timing allowance.)
  const dk = deck(['sv05-069', 'sv08-126', 'sv08-143', 'sv08.5-023']);
  const mk = (jam: boolean): Game => {
    const g = scenario(
      dk,
      dk,
      [
        { active: 'Eevee', hand: ['Vaporeon ex'] },
        { active: 'Bronzor', evolve: { active: ['Bronzong'] }, energy: { active: [P] } },
      ],
      { current: 1, turn: 4 },
    );
    if (jam) choose(g, 'Attack: Evolution Jammer');
    else choose(g, 'End turn');
    assert.equal(g.decision?.player, 0);
    g.state.p[0].active!.enteredTurn = g.state.turn; // Eevee "was played this turn": Boosted Evolution lets it evolve
    return g;
  };
  const free = mk(false);
  assert.ok(canEvolve(free, 'Vaporeon ex', free.state.p[0].active!.id), 'control: without the attack, Boosted Evolution lets the Active Eevee evolve');
  const jammed = mk(true);
  assert.ok(!canEvolve(jammed, 'Vaporeon ex', jammed.state.p[0].active!.id), 'Evolution Jammer stops it all the same');
  assert.ok(!has(jammed, 'into Vaporeon ex'));
});

// ------------------------------------------------------------------ Not testable in the simulator

const REVIEWED: { ruling: string; why: string }[] = [
  {
    ruling: 'Compendium #2033',
    why: "unscripted card: Temple of Sinnoh (it turns off Mist Energy's text) has no frame or script in the registry, and without it Mist Energy correctly stops Bring Down the Axe's Knock Out, so no position can show the Special Energy card still counting",
  },
  {
    ruling: 'Compendium #1774',
    why: 'unscripted card: Marowak with Bodyguard (a protection for the player, not for a Pokémon) is not in the registry, and no scripted card protects a player from attack effects, so nothing can be set against Sand Attack',
  },
  {
    ruling: 'Compendium #1867',
    why: "unscripted card: Toxtricity's Loud Mix (counting the types among the Benched Pokémon) is not in the registry, and no scripted card counts Pokémon types",
  },
  {
    ruling: 'Compendium #22',
    why: "unscripted card: Flareon's Flare Effect, Vaporeon's Aqua Effect, Jolteon's Electric Effect and Dangerous Energy are not in the registry; no scripted Energy is restricted by the Pokémon's type, and no scripted effect adds a type",
  },
  {
    ruling: 'Compendium #21',
    why: "unscripted card: the Eeveelution type-adding Abilities (Flare, Aqua and Electric Effect) are not in the registry, and the scripted Golurk is another card without Double Type; the type-setting Abilities that are scripted (Scovillain ex's and Carbink's Double Type, Iron Treads' Dual Core with a Future Booster Energy Capsule) all set a fixed list of types and no scripted effect adds a type to a Pokémon, so the add-versus-set combination the ruling decides cannot be built",
  },
  {
    ruling: 'Compendium #716',
    why: 'different text: an errata to the card template (Colorless or Metal frame) of the Platinum printing Dialga 23/127; the scripted Dialga printings (30th-103, me01-095, sv08-135) are other cards with their own printed types',
  },
  {
    ruling: 'Compendium #280',
    why: "different text: it concerns Zoroark-GX's Trade, which discards a card and then draws as much as possible; N's Zoroark ex's Trade is worded differently (ruling #2114 says they work differently) and is pinned by #2115",
  },
];

test('every REVIEWED ruling id exists in the Compendium index', () => {
  const index = JSON.parse(readFileSync(new URL('../../data/rulings-compendium.json', import.meta.url), 'utf8')) as { rulings: { id: number }[] };
  const ids = new Set(index.rulings.map((r) => r.id));
  for (const r of REVIEWED) {
    const id = Number(/Compendium #(\d+)/.exec(r.ruling)?.[1]);
    assert.ok(ids.has(id), `${r.ruling} is not in data/rulings-compendium.json`);
    assert.ok(r.why.length > 40, `${r.ruling} needs a specific reason`);
  }
  assert.equal(new Set(REVIEWED.map((r) => r.ruling)).size, REVIEWED.length, 'no ruling listed twice');
});
