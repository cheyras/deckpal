/**
 * POST /decks/simulate's pure half (deck/simulate.ts): request parsing, deck
 * references resolved against the caller's own decks, default opponents, and
 * the shared time budget. No database: the route's reads are the only DB work.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CardFrame, DeckInput } from '@deckpal/sim';
import { ApiError } from '../../http.js';
import {
  SIM_GAMES_DEFAULT, SIM_OPPONENTS_DEFAULT, SIM_TEXT_LIMIT,
  deckNotes, parseSimulateBody, pickOpponents, pilotFactory, resolveDeckRef, runComparison, runMatchups, type OwnedDeck,
} from '../simulate.js';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DECKS: OwnedDeck[] = [
  { id: ID(1), name: "Hide 'n' Sneak (Dhelmise)" },
  { id: ID(2), name: 'Toolbox Slowking' },
  { id: ID(3), name: 'Dragapult ex' },
  { id: ID(4), name: 'Dragapult ex / Dusknoir' },
  { id: ID(5), name: 'Gengar ex' },
  { id: ID(6), name: 'Mega Lucario ex' },
  { id: ID(7), name: 'Genesect ex' },
  { id: ID(8), name: 'Phantom Puppeteer' },
];

function rejects(fn: () => unknown, re: RegExp): void {
  assert.throws(fn, (err: unknown) => err instanceof ApiError && err.status === 400 && re.test(err.message));
}

test('parseSimulateBody: defaults, one subject, bounds', () => {
  const p = parseSimulateBody({ deck_id: 'Toolbox Slowking' });
  assert.deepEqual(p, { deckRef: 'Toolbox Slowking', adHoc: false, name: 'Your list', opponents: null, games: SIM_GAMES_DEFAULT, seed: 1, speed: 'strong', compare: null });
  assert.equal(parseSimulateBody({ deck_id: 'x', speed: 'fast' }).speed, 'fast');
  assert.throws(() => parseSimulateBody({ deck_id: 'x', speed: 'turbo' }), /speed/);
  assert.equal(parseSimulateBody({ cards: [{ name: 'Pikachu', quantity: 4 }], games: 200, seed: 0 }).adHoc, true);
  rejects(() => parseSimulateBody({}), /exactly one of deck_id, cards or ptcgl_text/);
  rejects(() => parseSimulateBody({ deck_id: 'x', cards: [] }), /exactly one/);
  rejects(() => parseSimulateBody({ deck_id: 'x', games: 201 }), /games must be an integer 2\.\.200/);
  rejects(() => parseSimulateBody({ deck_id: 'x', games: 1.5 }), /games/);
  rejects(() => parseSimulateBody({ deck_id: 'x', seed: -1 }), /seed/);
  rejects(() => parseSimulateBody({ deck_id: 'x', opponents: [] }), /opponents/);
  rejects(() => parseSimulateBody({ deck_id: 'x', opponents: Array(9).fill('a') }), /at most 8 opponents/);
});

test('parseSimulateBody: compare_with / compare_cards / compare_ptcgl_text make a paired comparison', () => {
  assert.deepEqual(parseSimulateBody({ deck_id: 'v4', compare_with: ' v5 ' }).compare, { deckRef: 'v5', adHoc: null, name: 'Version B' });
  const cards = [{ name: 'Gwynn', quantity: 2 }];
  assert.deepEqual(parseSimulateBody({ deck_id: 'v4', compare_cards: cards, compare_name: 'v4 with 2 Gwynn' }).compare, {
    deckRef: null, adHoc: { cards }, name: 'v4 with 2 Gwynn',
  });
  assert.deepEqual(parseSimulateBody({ cards, compare_ptcgl_text: 'Pokémon: 1' }).compare, { deckRef: null, adHoc: { ptcgl_text: 'Pokémon: 1' }, name: 'Version B' });
  rejects(() => parseSimulateBody({ deck_id: 'v4', compare_with: 'v5', compare_cards: cards }), /at most one of compare_with, compare_cards or compare_ptcgl_text/);
  rejects(() => parseSimulateBody({ deck_id: 'v4', compare_with: '' }), /compare_with must be a deck id or name/);
  rejects(() => parseSimulateBody({ deck_id: 'v4', compare_with: 7 }), /compare_with must be a deck id or name/);
  rejects(() => parseSimulateBody({ deck_id: 'v4', compare_name: 'x' }), /compare_name needs/);
  // The compare inputs never count as the subject.
  rejects(() => parseSimulateBody({ compare_cards: cards }), /exactly one of deck_id, cards or ptcgl_text/);
});

test('resolveDeckRef: id, exact name, unique fragment; ambiguity is returned, not guessed', () => {
  assert.equal(resolveDeckRef(ID(2), DECKS).name, 'Toolbox Slowking');
  assert.equal(resolveDeckRef('toolbox slowking', DECKS).id, ID(2));
  assert.equal(resolveDeckRef('hide ’n’ sneak', DECKS).id, ID(1), 'curly apostrophes fold');
  assert.equal(resolveDeckRef('Dragapult ex', DECKS).id, ID(3), 'an exact name wins over a longer one containing it');
  rejects(() => resolveDeckRef('ex', DECKS), new RegExp(`matches \\d+ decks — pass one id: .*${ID(3)}`));
  rejects(() => resolveDeckRef('Charizard', DECKS), /No deck matches 'Charizard'/);
  rejects(() => resolveDeckRef(ID(99), DECKS), /No deck with id/);
});

test('pickOpponents: named ones in order (deduplicated), else the other decks, capped', () => {
  assert.deepEqual(pickOpponents(['Gengar ex', ID(2), 'gengar ex'], DECKS, ID(1)).map((d) => d.id), [ID(5), ID(2)]);
  const def = pickOpponents(null, DECKS, ID(1));
  assert.equal(def.length, SIM_OPPONENTS_DEFAULT);
  assert.ok(!def.some((d) => d.id === ID(1)), 'never plays the subject against itself by default');
  assert.equal(def[0]!.id, ID(2), 'keeps the caller order (favourites, most recent)');
  const cmp = pickOpponents(null, DECKS, [ID(1), ID(2)]);
  assert.ok(!cmp.some((d) => d.id === ID(1) || d.id === ID(2)), 'a comparison plays neither version as a default opponent');
  assert.equal(cmp[0]!.id, ID(3));
});

function mon(id: string, name: string, hp: number, damage: string): CardFrame {
  return {
    cardId: id, name, category: 'Pokemon', hp, stage: 'Basic', suffix: null, evolvesFrom: null, trainerType: null,
    energyType: null, retreat: 1, types: ['Colorless'], effect: null, regulationMark: 'I',
    attacks: [{ name: 'Tackle', cost: 'Colorless', damage, effect: null }], abilities: [], weaknesses: [], resistances: [],
  };
}
const ENERGY: CardFrame = {
  cardId: 'e-1', name: 'Psychic Energy', category: 'Energy', hp: null, stage: null, suffix: null, evolvesFrom: null,
  trainerType: null, energyType: 'Normal', retreat: null, types: [], effect: null, regulationMark: null,
  attacks: [], abilities: [], weaknesses: [], resistances: [],
};
const deck = (name: string, m: CardFrame, n = 60): DeckInput => ({ name, cards: [{ frame: m, count: 20 }, { frame: ENERGY, count: n - 20 }] });

test('runMatchups: one report across opponents, inside the text limit, notes on top', async () => {
  const subject = deck('Pups', mon('t-1', 'Pup', 70, '30'));
  const opponents = [deck('Cats', mon('t-2', 'Cat', 60, '20')), deck('Birds', mon('t-3', 'Bird', 90, '20'), 58)];
  const notes = opponents.flatMap((o) => deckNotes(o, []));
  assert.deepEqual(notes, ['Birds has 58 cards, not 60 — simulated as listed.']);
  const out = await runMatchups(subject, opponents, { games: 4, seed: 3, notes, budgetMs: 60_000 });
  assert.equal(out.report.matchups.length, 2);
  assert.equal(out.report.gamesPlayed, 8);
  assert.deepEqual(out.report.notes, notes);
  assert.ok(out.text.length <= SIM_TEXT_LIMIT, `${out.text.length} chars`);
  const lines = out.text.split('\n');
  assert.match(lines[0]!, /^SIMULATED BATTLES \(not real games\) — Pups vs 2 opponents/);
  assert.ok(lines.includes('Note: Birds has 58 cards, not 60 — simulated as listed.'));
  assert.match(out.text, /Caveat: These are SIMULATED games/);
  // Same seed, same games.
  const again = await runMatchups(subject, opponents, { games: 4, seed: 3, notes, budgetMs: 60_000 });
  assert.deepEqual(again.report.matchups.map((m) => m.record), out.report.matchups.map((m) => m.record));
});

test('runMatchups: a spent budget plays one pair for the first opponent, skips the rest, and says so', async () => {
  let t = 0;
  const subject = deck('Pups', mon('t-1', 'Pup', 70, '30'));
  const out = await runMatchups(subject, [deck('Cats', mon('t-2', 'Cat', 60, '20')), deck('Birds', mon('t-3', 'Bird', 90, '20'))], {
    games: 40, seed: 1, budgetMs: 10, now: () => (t += 50),
  });
  assert.equal(out.report.gamesPlayed, 2, 'one pair for the first opponent, none after the budget is gone');
  assert.equal(out.report.matchups[1]!.played, 0);
  assert.equal(out.report.stoppedEarly, true);
  assert.match(out.text, /2 of 80 games played \(time budget reached/);
  assert.match(out.text, /2\. vs Birds — 0 of 40 played/);
});

test('runComparison: both versions on the same seeds, the verdict first, inside the text limit, notes kept', async () => {
  const weak = deck('Weak pups', mon('t-1', 'Pup', 70, '10'));
  const strong = deck('Strong pups', mon('t-4', 'Big Pup', 70, '70'));
  const opponents = [deck('Cats', mon('t-2', 'Cat', 70, '30'))];
  const notes = ['Strong pups: a note.'];
  const out = await runComparison(weak, strong, opponents, { games: 16, seed: 3, notes, budgetMs: 60_000, pilot: pilotFactory('fast') });
  assert.equal(out.report.kind, 'deckpal.simulation.comparison');
  assert.equal(out.report.gamesPlayed, 16, 'per version');
  assert.equal(out.report.reportB.gamesPlayed, 16);
  assert.ok(out.text.length <= SIM_TEXT_LIMIT, `${out.text.length} chars`);
  const lines = out.text.split('\n');
  assert.match(lines[0]!, /^SIMULATED BATTLES \(not real games\) — COMPARISON/);
  assert.match(lines[1]!, /^VERDICT: B is better/);
  assert.ok(lines.includes('Note: Strong pups: a note.'));
  assert.match(out.text, /Caveat: These are SIMULATED games/);
  const same = await runComparison(weak, weak, opponents, { games: 8, seed: 3, budgetMs: 60_000, pilot: pilotFactory('fast') });
  assert.equal(same.report.overall.diff, 0);
  assert.match(same.text.split('\n')[1]!, /^VERDICT: No clear difference at this n/);
});

test('runComparison: a spent budget gives both versions the same games and says so', async () => {
  let t = 0;
  const pups = deck('Pups', mon('t-1', 'Pup', 70, '30'));
  const out = await runComparison(pups, pups, [deck('Cats', mon('t-2', 'Cat', 60, '20')), deck('Birds', mon('t-3', 'Bird', 90, '20'))], {
    games: 40, seed: 1, budgetMs: 10, now: () => (t += 50), pilot: pilotFactory('fast'),
  });
  assert.equal(out.report.reportA.gamesPlayed, 2);
  assert.equal(out.report.reportB.gamesPlayed, 2);
  assert.equal(out.report.stoppedEarly, true);
  assert.match(out.text, /2 of 80 games per version played \(time budget reached/);
  assert.match(out.text, /No clear difference at this n: only 1 seed played/);
});
