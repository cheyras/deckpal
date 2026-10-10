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
  deckNotes, parseSimulateBody, pickOpponents, resolveDeckRef, runMatchups, type OwnedDeck,
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
  assert.deepEqual(p, { deckRef: 'Toolbox Slowking', adHoc: false, name: 'Your list', opponents: null, games: SIM_GAMES_DEFAULT, seed: 1 });
  assert.equal(parseSimulateBody({ cards: [{ name: 'Pikachu', quantity: 4 }], games: 200, seed: 0 }).adHoc, true);
  rejects(() => parseSimulateBody({}), /exactly one of deck_id, cards or ptcgl_text/);
  rejects(() => parseSimulateBody({ deck_id: 'x', cards: [] }), /exactly one/);
  rejects(() => parseSimulateBody({ deck_id: 'x', games: 201 }), /games must be an integer 2\.\.200/);
  rejects(() => parseSimulateBody({ deck_id: 'x', games: 1.5 }), /games/);
  rejects(() => parseSimulateBody({ deck_id: 'x', seed: -1 }), /seed/);
  rejects(() => parseSimulateBody({ deck_id: 'x', opponents: [] }), /opponents/);
  rejects(() => parseSimulateBody({ deck_id: 'x', opponents: Array(9).fill('a') }), /at most 8 opponents/);
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
