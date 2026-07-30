import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBattleLog } from '../battlelog.js';

/**
 * Battle-log parser tests against a REAL PTCG Live log: cheyras's Hide 'n'
 * Sneak Dhelmise win vs Robni16's Dragapult ex / Dusknoir
 * (fixtures/battle-log-fixture.txt). Every expected value below was derived by
 * reading the fixture, not guessed:
 *   • 14 turn headers ("<name>'s Turn")
 *   • prizes: cheyras 1+2+1+2 = 6, Robni16 1×5 = 5
 *   • KOs of Robni16's mons: Dusknoir, Dragapult ex, Dreepy, Dragapult ex
 *   • KOs of cheyras's mons: Poltchageist, Banette, Dhelmise, Dhelmise, Banette
 *   • "Robni16 decided to go first." → wentFirst 'opponent'
 *   • "All Prize cards taken. PlayerA wins." → result 'win'
 * The fixture also exercises the curly-apostrophe forms ("cheyras’s") that Live
 * emits inside attack lines.
 */

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/battle-log-fixture.txt', import.meta.url)),
  'utf8',
);

/** The owning deck's card names, as the API would pass them from deck_card⋈card. */
const DECK_NAMES = [
  'Poltchageist', 'Sinistcha', 'Shuppet', 'Banette', 'Dhelmise', 'Fezandipiti ex',
  'Buddy-Buddy Poffin', 'Ultra Ball', 'Poké Pad', 'Prism Tower', "Lillie's Determination",
  "Boss's Orders", 'Night Stretcher', 'Special Red Card', 'Switch', 'Air Balloon', 'Gwynn',
  'Telepathic Psychic Energy', 'Basic Psychic Energy',
];

test('fixture: identifies cheyras as me with high confidence', () => {
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.equal(p.players.me, 'cheyras');
  assert.equal(p.players.opponent, 'Robni16');
  assert.equal(p.confidence, 'high');
});

test('fixture: result, turn order and turn count', () => {
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.equal(p.result, 'win'); // "All Prize cards taken. PlayerA wins."
  assert.equal(p.wentFirst, 'opponent'); // "Robni16 decided to go first."
  assert.equal(p.totalTurns, 14);
});

test('fixture: prize counts (me 6, opponent 5)', () => {
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.deepEqual(p.prizesTaken, { me: 6, opponent: 5 });
});

test('fixture: knockouts on both sides, in order', () => {
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.deepEqual(p.knockouts.byMe, ['Dusknoir', 'Dragapult ex', 'Dreepy', 'Dragapult ex']);
  assert.deepEqual(p.knockouts.byOpponent, ['Poltchageist', 'Banette', 'Dhelmise', 'Dhelmise', 'Banette']);
});

test('fixture: boards — my/opponent Pokémon, distinct and in first-appearance order', () => {
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.deepEqual(p.opponentPokemon, ['Dreepy', 'Duskull', 'Drakloak', 'Dusclops', 'Dragapult ex', 'Dusknoir']);
  assert.deepEqual(p.myPokemon, ['Poltchageist', 'Shuppet', 'Dhelmise', 'Banette', 'Fezandipiti ex', 'Sinistcha']);
});

test('fixture: opponent deck guess leads with the rule-box terminal evolutions', () => {
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.equal(p.opponentDeckGuess, 'Dragapult ex / Dusknoir');
  assert.match(p.opponentDeckGuess!, /Dragapult/);
});

test('explicit playerName overrides overlap scoring (case-insensitive)', () => {
  // Pretend the deck names match nothing — playerName alone must resolve "me".
  const p = parseBattleLog(FIXTURE, ['Charizard ex'], 'CHEYRAS');
  assert.equal(p.players.me, 'cheyras');
  assert.equal(p.confidence, 'high');
  assert.equal(p.result, 'win');
  // …and naming the opponent flips every perspective-dependent field.
  const q = parseBattleLog(FIXTURE, DECK_NAMES, 'Robni16');
  assert.equal(q.players.me, 'Robni16');
  assert.equal(q.result, 'loss');
  assert.equal(q.wentFirst, 'me');
  assert.deepEqual(q.prizesTaken, { me: 5, opponent: 6 });
});

test('ambiguous deck overlap → confidence low, me null, result null', () => {
  // Neither player's cards overlap the (nonsense) deck list by a clear margin.
  const p = parseBattleLog(FIXTURE, ['Snorlax', 'Miraidon ex']);
  assert.equal(p.confidence, 'low');
  assert.equal(p.players.me, null);
  assert.equal(p.result, null);
  assert.equal(p.totalTurns, 14); // turn count is perspective-free and still reported
});

test('a "conceded" ending resolves the result without a wins line', () => {
  const log = [
    'Setup',
    'Ash drew 7 cards for the opening hand.',
    'Misty drew 7 cards for the opening hand.',
    "Ash's Turn",
    'Ash played Pikachu to the Bench.',
    'Misty conceded.',
  ].join('\n');
  const win = parseBattleLog(log, ['Pikachu'], 'Ash');
  assert.equal(win.result, 'win');
  const loss = parseBattleLog(log, [], 'Misty');
  assert.equal(loss.result, 'loss');
});

test('no win/concede line → result null (tie or truncated log)', () => {
  const truncated = FIXTURE.split('\n').slice(0, 100).join('\n');
  const p = parseBattleLog(truncated, DECK_NAMES);
  assert.equal(p.players.me, 'cheyras');
  assert.equal(p.result, null);
});

test('never throws on arbitrary text — degrades to the empty low-confidence shape', () => {
  for (const junk of ['', '   \n\n', 'complete nonsense\nnothing here', '🎴'.repeat(50), 'null']) {
    const p = parseBattleLog(junk, DECK_NAMES);
    assert.equal(p.confidence, 'low');
    assert.equal(p.players.me, null);
    assert.equal(p.result, null);
    assert.deepEqual(p.knockouts, { byMe: [], byOpponent: [] });
  }
});
