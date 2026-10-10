import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digestBattleLog, parseBattleLog } from '../battlelog.js';

/**
 * The battle digest (2026-10-10), against the same REAL logs the parser is
 * pinned on. Every expected value below was read off the fixture, line by line,
 * not produced by running the code and copying its output:
 *
 * fixtures/battle-log-fixture.txt — PlayerA's Banette / Dhelmise WIN over
 * PlayerB's Dragapult ex / Dusknoir. 14 turn headers, PlayerB first (turns
 * 1,3,…,13), PlayerB one mulligan ("PlayerB took a mulligan." + "Cards
 * revealed from Mulligan 1"). First damage: Drakloak's Dragon Headbutt on
 * turn 3; PlayerA's Banette's Puppet Pull on turn 4. Prize lines, in order:
 *   T3  B+1 Poltchageist   T5  B+1 Banette     T7  A+1 Dusknoir
 *   T7  B+1 Dhelmise       T9  B+1 Dhelmise    T10 A+2 Dragapult ex
 *   T12 A+1 Dreepy         T13 B+1 Banette     T14 A+2 Dragapult ex
 * PlayerB led 4-1 after turn 9 and PlayerA won 6-5: the lead changed hands.
 *
 * fixtures/battle-log-cardcodes.txt — the current card-code format, PlayerA's
 * Slowking LOSS to Cynthia's Garchomp ex. 9 turns, PlayerB first. Turn 8 is a
 * double Knock Out: Garchomp ex and Slowking both go down, then "PlayerB took
 * a Prize card." and "PlayerA took 2 Prize cards." — each prize line must pay
 * for the OTHER side's Knock Out.
 */

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const FIXTURE = read('battle-log-fixture.txt');
const CODED = read('battle-log-cardcodes.txt');
const FUTURE_DRIFT = read('battle-log-future-drift.txt');

/** The owning deck's card names — the same list battlelog.test.ts uses. */
const DECK_NAMES = [
  'Poltchageist', 'Sinistcha', 'Shuppet', 'Banette', 'Dhelmise', 'Fezandipiti ex',
  'Buddy-Buddy Poffin', 'Ultra Ball', 'Poké Pad', 'Prism Tower', "Lillie's Determination",
  "Boss's Orders", 'Night Stretcher', 'Special Red Card', 'Switch', 'Air Balloon', 'Gwynn',
  'Telepathic Psychic Energy', 'Basic Psychic Energy',
];

const CODED_DECK_NAMES = [
  'Slowpoke', 'Slowking', 'Latias ex', 'Mega Kangaskhan ex', 'Metagross', 'Spectrier',
  'Annihilape', 'Kyurem', 'Zeraora', 'Zoroark', "Lillie's Clefairy ex",
  'Academy at Night', "Ciphermaniac's Codebreaking", "Lillie's Determination",
  'Poké Pad', 'Ultra Ball', 'Night Stretcher', 'Switch', 'Telepathic Psychic Energy',
  'Basic Psychic Energy',
];

const cardNames = (d: ReturnType<typeof digestBattleLog>) => d.opponentCards.map((c) => c.name);

// ── The Dragapult game, from the deck owner's side ───────────────────────────

test('fixture: the owner, the result and the shape of the game', () => {
  const d = digestBattleLog(FIXTURE, DECK_NAMES);
  assert.deepEqual(d.players, { me: 'PlayerA', opponent: 'PlayerB' });
  assert.deepEqual(d.playerNames, ['PlayerB', 'PlayerA']);
  assert.equal(d.confidence, 'high');
  assert.equal(d.result, 'win');
  assert.equal(d.wentFirst, 'opponent');
  assert.equal(d.totalTurns, 14);
  assert.deepEqual(d.turns, { me: 7, opponent: 7 });
  assert.deepEqual(d.mulligans, { me: 0, opponent: 1 });
  assert.deepEqual(d.firstAttackTurn, { me: 4, opponent: 3 });
  assert.equal(d.endReason, 'prizes'); // "All Prize cards taken. PlayerA wins."
  assert.equal(d.opponentArchetypeGuess, 'Dragapult ex / Dusknoir');
});

test('fixture: the prize timeline, turn by turn, with what each prize paid for', () => {
  const d = digestBattleLog(FIXTURE, DECK_NAMES);
  assert.deepEqual(
    d.prizeTimeline.map((e) => [e.turn, e.side, e.prizes, e.knockedOut, `${e.score.me}-${e.score.opponent}`]),
    [
      [3, 'opponent', 1, 'Poltchageist', '0-1'],
      [5, 'opponent', 1, 'Banette', '0-2'],
      [7, 'me', 1, 'Dusknoir', '1-2'],
      [7, 'opponent', 1, 'Dhelmise', '1-3'],
      [9, 'opponent', 1, 'Dhelmise', '1-4'],
      [10, 'me', 2, 'Dragapult ex', '3-4'],
      [12, 'me', 1, 'Dreepy', '4-4'],
      [13, 'opponent', 1, 'Banette', '4-5'],
      [14, 'me', 2, 'Dragapult ex', '6-5'],
    ],
  );
  assert.deepEqual(d.finalPrizes, { me: 6, opponent: 5 });
});

test('fixture: the digest agrees with the stored parse wherever both speak', () => {
  // The digest REUSES the parser for identity and result, and re-reads the log
  // only for the timeline. If the two ever counted prizes differently, the
  // review would contradict the battle it is attached to.
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  const d = digestBattleLog(FIXTURE, DECK_NAMES);
  assert.deepEqual(d.finalPrizes, p.prizesTaken);
  assert.equal(d.totalTurns, p.totalTurns);
  assert.equal(d.result, p.result);
  assert.deepEqual(d.myPokemonUsed, p.myPokemon);
});

test('fixture: a 6-5 game whose lead changed hands is close', () => {
  const d = digestBattleLog(FIXTURE, DECK_NAMES);
  assert.equal(d.leadChanged, true);
  assert.equal(d.closeGame, true);
});

test('fixture: the opponent cards are THEIRS — revealed lists included, my hand and the damage maths excluded', () => {
  const d = digestBattleLog(FIXTURE, DECK_NAMES);
  const names = cardNames(d);
  // Most-seen first: the main attacker leads.
  assert.equal(names[0], 'Dragapult ex');
  // Judge is never PLAYED. It is seen twice, both times in a list of PlayerB's
  // cards: the mulligan reveal and the Lillie's Determination shuffle.
  assert.deepEqual(d.opponentCards.find((c) => c.name === 'Judge'), { name: 'Judge', count: 2 });
  // Hilda is played once; Dusclops is drawn face-up by Poké Pad before it is evolved.
  assert.ok(names.includes('Hilda'));
  assert.ok(names.includes('Dusclops'));
  // PlayerA's opening hand is a revealed list too — of PlayerA's cards.
  for (const mine of ['Air Balloon', 'Telepathic Psychic Energy', 'Fezandipiti ex', 'Banette']) {
    assert.ok(!names.includes(mine), `${mine} is the owner's card, not the opponent's`);
  }
  // PlayerB USED PlayerA's Prism Tower ("PlayerB played Prism Tower.") — that is
  // not a card in PlayerB's deck.
  assert.ok(!names.includes('Prism Tower'), 'using the Stadium in play is not playing one');
  // The damage breakdown is arithmetic, never cards.
  for (const n of names) assert.doesNotMatch(n, /damage|discarded Pokémon/i);
  // Deduped: one row per card.
  assert.equal(new Set(names).size, names.length);
});

test('fixture: naming the opponent reads the same game from the other chair', () => {
  const d = digestBattleLog(FIXTURE, DECK_NAMES, { playerName: 'PlayerB' });
  assert.deepEqual(d.players, { me: 'PlayerB', opponent: 'PlayerA' });
  assert.equal(d.result, 'loss');
  assert.equal(d.wentFirst, 'me');
  assert.deepEqual(d.mulligans, { me: 1, opponent: 0 });
  assert.deepEqual(d.firstAttackTurn, { me: 3, opponent: 4 });
  assert.deepEqual(d.finalPrizes, { me: 5, opponent: 6 });
  assert.equal(d.prizeTimeline[0]!.side, 'me');
  // …and now PlayerA's revealed opening hand IS the opponent's cards.
  assert.ok(cardNames(d).includes('Air Balloon'));
  // Perspective-free facts do not move.
  assert.equal(d.leadChanged, true);
  assert.equal(d.closeGame, true);
  assert.equal(d.endReason, 'prizes');
});

// ── The card-code game ───────────────────────────────────────────────────────

test('card codes: a 3-6 loss, read from the Slowking side', () => {
  const d = digestBattleLog(CODED, CODED_DECK_NAMES);
  assert.deepEqual(d.players, { me: 'PlayerA', opponent: 'PlayerB' });
  assert.equal(d.result, 'loss');
  assert.equal(d.wentFirst, 'opponent');
  assert.equal(d.totalTurns, 9);
  assert.deepEqual(d.turns, { me: 4, opponent: 5 });
  assert.deepEqual(d.mulligans, { me: 0, opponent: 0 });
  assert.deepEqual(d.firstAttackTurn, { me: 4, opponent: 3 });
  assert.deepEqual(d.finalPrizes, { me: 3, opponent: 6 });
  // "Opponent took all of their Prize cards. PlayerB wins."
  assert.equal(d.endReason, 'prizes');
});

test('card codes: the double Knock Out pays each side for the OTHER side\'s Pokémon', () => {
  const d = digestBattleLog(CODED, CODED_DECK_NAMES);
  assert.deepEqual(
    d.prizeTimeline.map((e) => [e.turn, e.side, e.prizes, e.knockedOut]),
    [
      [4, 'me', 1, "Cynthia's Gabite"],
      [5, 'opponent', 1, 'Slowking'],
      [7, 'opponent', 3, 'Mega Kangaskhan ex'],
      [8, 'opponent', 1, 'Slowking'],
      [8, 'me', 2, "Cynthia's Garchomp ex"],
      [9, 'opponent', 1, 'Latias ex'],
    ],
  );
});

test('card codes: a three-prize gap is still close when the lead changed hands', () => {
  // PlayerA led 1-0 after turn 4; the three-prize Mega Kangaskhan ex Knock Out
  // on turn 7 put PlayerB ahead 4-1 for good. Gap 3 at the end — close only
  // through the lead change, which is the owner's second half of the rule.
  const d = digestBattleLog(CODED, CODED_DECK_NAMES);
  assert.equal(d.leadChanged, true);
  assert.equal(d.closeGame, true);
});

test('card codes: no name in the digest carries a code', () => {
  const d = digestBattleLog(CODED, CODED_DECK_NAMES);
  const names = [
    ...cardNames(d), ...d.myPokemonUsed,
    ...d.prizeTimeline.map((e) => e.knockedOut ?? ''), d.opponentArchetypeGuess ?? '',
  ];
  for (const n of names) assert.doesNotMatch(n, /\(/, `card code survived into a name: ${n}`);
  assert.equal(cardNames(d)[0], "Cynthia's Gabite");
  // "(Item) (me1_124) Premium Power Pro: 30 damage" is a damage-breakdown row;
  // the card is still seen, once, from the line where PlayerB played it.
  assert.deepEqual(d.opponentCards.find((c) => c.name === 'Premium Power Pro'), { name: 'Premium Power Pro', count: 1 });
  // PlayerB used PlayerA's Academy at Night; it is not PlayerB's card.
  assert.ok(!cardNames(d).includes('Academy at Night'));
});

test('card codes: a Pokémon only ever benched from a revealed list still counts as used', () => {
  // "- PlayerA drew 2 cards and played them to the Bench." then
  // "• (sv8_76) Latias ex, (me2-5_280) Lillie's Clefairy ex" — the Clefairy
  // never appears on a line of its own.
  const d = digestBattleLog(CODED, CODED_DECK_NAMES);
  assert.ok(d.myPokemonUsed.includes("Lillie's Clefairy ex"));
  assert.equal(new Set(d.myPokemonUsed).size, d.myPokemonUsed.length);
});

// ── How a game ends ──────────────────────────────────────────────────────────

const LAST_LINE = 'All Prize cards taken. PlayerA wins.';

test('end reasons on the real game: both concession wordings, and a paste cut short', () => {
  assert.ok(FIXTURE.includes(LAST_LINE), 'the fixture ending these tests rewrite has moved');
  const ending = (last: string) => digestBattleLog(FIXTURE.replace(LAST_LINE, last), DECK_NAMES);

  assert.equal(ending('Opponent conceded. PlayerA wins.').endReason, 'concede');
  assert.equal(ending('PlayerB conceded the game.').endReason, 'concede');

  // The result line is gone but PlayerA took all six: that is how it ended,
  // and the digest must not then claim it cannot tell.
  const cut = ending('');
  assert.equal(cut.endReason, 'prizes');
  assert.ok(!cut.unknowns.some((u) => /how the game ended/.test(u)));
});

/** A small hand-written game, so end reasons that are not prize-outs can be pinned. */
function shortGame(ending: string, prizes: Array<[string, number]> = []): string {
  const lines = [
    'Setup',
    'Ash decided to go first.',
    'Ash drew 7 cards for the opening hand.',
    'Misty drew 7 cards for the opening hand.',
    'Ash played Pikachu to the Active Spot.',
    'Misty played Staryu to the Active Spot.',
    '',
    "Ash's Turn",
    'Ash drew a card.',
    'Ash attached Basic Lightning Energy to Pikachu in the Active Spot.',
    '',
    "Misty's Turn",
    'Misty drew a card.',
    'Misty attached Basic Water Energy to Staryu in the Active Spot.',
    "Misty's Staryu used Water Gun on Ash’s Pikachu for 20 damage.",
  ];
  for (const [who, n] of prizes) {
    const victim = who === 'Ash' ? 'Misty' : 'Ash';
    lines.push(`${victim}'s ${victim === 'Ash' ? 'Pikachu' : 'Staryu'} was Knocked Out!`);
    lines.push(n === 1 ? `${who} took a Prize card.` : `${who} took ${n} Prize cards.`);
  }
  if (ending) lines.push(ending);
  return lines.join('\n');
}

test('end reasons on a short game: timeout is other, deck-out is deck-out', () => {
  const opts = { playerName: 'Ash' };
  assert.equal(digestBattleLog(shortGame('Opponent was inactive for too long. Ash wins.'), [], opts).endReason, 'other');
  assert.equal(digestBattleLog(shortGame('Misty has no cards left in their deck. Ash wins.'), [], opts).endReason, 'deck-out');
  assert.equal(digestBattleLog(shortGame('Opponent conceded. Ash wins.'), [], opts).endReason, 'concede');
  const open = digestBattleLog(shortGame(''), [], opts);
  assert.equal(open.endReason, 'other');
  assert.ok(open.unknowns.some((u) => /how the game ended/.test(u)), 'a missing result line must be SAID');
});

test('a two-turn concession is not a close game, whatever its gap', () => {
  // 0-0 is a gap of zero. The depth rule this feeds calls an early concession
  // Light; "close" would send it to a Standard review.
  const d = digestBattleLog(shortGame('Opponent conceded. Ash wins.'), [], { playerName: 'Ash' });
  assert.deepEqual(d.finalPrizes, { me: 0, opponent: 0 });
  assert.equal(d.closeGame, false);
  assert.equal(d.firstAttackTurn?.opponent, 2);
  assert.equal(d.firstAttackTurn?.me, null);
});

test('closeness: a lopsided game is not close; a 6-4 finish is', () => {
  const lopsided = digestBattleLog(
    shortGame('All Prize cards taken. Ash wins.', [['Ash', 2], ['Ash', 2], ['Misty', 1], ['Ash', 2]]),
    [], { playerName: 'Ash' },
  );
  assert.deepEqual(lopsided.finalPrizes, { me: 6, opponent: 1 });
  assert.equal(lopsided.leadChanged, false);
  assert.equal(lopsided.closeGame, false);

  const tight = digestBattleLog(
    shortGame('All Prize cards taken. Ash wins.', [['Ash', 2], ['Misty', 2], ['Ash', 2], ['Misty', 2], ['Ash', 2]]),
    [], { playerName: 'Ash' },
  );
  assert.deepEqual(tight.finalPrizes, { me: 6, opponent: 4 });
  assert.equal(tight.leadChanged, false, 'tied twice, never behind');
  assert.equal(tight.closeGame, true);
});

test('mulligans: several are counted, not just the first', () => {
  const log = shortGame('Opponent conceded. Ash wins.').replace(
    'Misty drew 7 cards for the opening hand.',
    [
      'Misty took a mulligan.',
      '- Cards revealed from Mulligan 1',
      '   • Potion, Switch, Basic Water Energy',
      'Misty took a mulligan.',
      '- Cards revealed from Mulligan 2',
      '   • Nest Ball, Basic Water Energy',
      'Misty drew 7 cards for the opening hand.',
    ].join('\n'),
  );
  const d = digestBattleLog(log, [], { playerName: 'Ash' });
  assert.deepEqual(d.mulligans, { me: 0, opponent: 2 });
  assert.deepEqual(d.opponentCards.find((c) => c.name === 'Basic Water Energy'), { name: 'Basic Water Energy', count: 3 });
  assert.ok(cardNames(d).includes('Nest Ball'));
});

// ── What it cannot tell ──────────────────────────────────────────────────────

test('hidden information is always named as unknown', () => {
  const d = digestBattleLog(FIXTURE, DECK_NAMES);
  assert.ok(d.unknowns.some((u) => /opponent's hand/.test(u)));
  assert.ok(d.unknowns.some((u) => /prized/.test(u)));
});

test('no owner: the perspective-free half only, and the names to choose from', () => {
  // The drift fixture's names carry an unknown prefix, so neither player
  // overlaps the deck — the parser refuses to guess, and so must the digest.
  const d = digestBattleLog(FUTURE_DRIFT, ["Cynthia's Gible", 'Slowking']);
  assert.deepEqual(d.players, { me: null, opponent: null });
  assert.equal(d.confidence, 'low');
  for (const field of ['turns', 'mulligans', 'firstAttackTurn', 'finalPrizes'] as const) {
    assert.equal(d[field], null, `${field} must not be a guessed split`);
  }
  assert.deepEqual(d.prizeTimeline, []);
  assert.deepEqual(d.opponentCards, []);
  // What does not depend on who is who still stands.
  assert.equal(d.totalTurns, 3);
  assert.equal(d.endReason, 'prizes');
  assert.ok(d.unknowns.some((u) => /deck owner.*Alice and Bob/.test(u)));
  // …and naming the player recovers the whole digest.
  const named = digestBattleLog(FUTURE_DRIFT, [], { playerName: 'Alice' });
  assert.equal(named.players.me, 'Alice');
  assert.equal(named.result, 'win');
  assert.deepEqual(named.finalPrizes, { me: 2, opponent: 1 });
});

// ── The route ────────────────────────────────────────────────────────────────
//
// Source pins, like logDryRun.test.ts: the live-DB route suites cover HTTP;
// these hold the four choices a refactor could quietly undo.

test('route: GET /decks/:id/logs/:logId/digest keeps the detail route\'s ownership gate', () => {
  const source = readFileSync(fileURLToPath(new URL('../../routes/decks.ts', import.meta.url)), 'utf8');
  const start = source.indexOf("'/:id/logs/:logId/digest'");
  assert.ok(start > 0, 'the digest route is not registered');
  const route = source.slice(source.lastIndexOf('decksRouter.get(', start), source.indexOf('// PATCH /decks/:id/logs/:logId', start));
  // The deck must be the caller's, and the log must hang off that deck.
  assert.match(route, /const meta = await loadMeta\(deckId, userId\);\s*if \(!meta\) throw notFound/);
  assert.match(route, /FROM battle_log WHERE id = \$1 AND deck_id = \$2/);
  // Read-only: no write statement anywhere in the handler.
  assert.doesNotMatch(route, /\b(?:INSERT|UPDATE|DELETE)\b/);
  // An in-person game is a 404 with words a model can act on.
  assert.match(route, /throw notFound\(\s*row\.origin === 'in_person'\s*\? 'no game log to digest — this game was reported in person'/);
  // Whose side: an explicit name, then the owner the row was STORED with.
  assert.match(route, /playerName: playerName \?\? \(typeof storedMe === 'string' && storedMe \? storedMe : undefined\)/);
  assert.match(route, /digestBattleLog\(row\.raw_log,/);
});

test('never throws on arbitrary text — worst case is the empty digest', () => {
  for (const junk of ['', 'hello', '\n\n•\n- \n', "Bob's Turn\nBob wins.", 'x'.repeat(10_000)]) {
    const d = digestBattleLog(junk, DECK_NAMES);
    assert.equal(d.players.me, null);
    assert.equal(typeof d.closeGame, 'boolean');
    assert.ok(Array.isArray(d.unknowns) && d.unknowns.length >= 2);
  }
  // Wrong types from an untyped caller are text too.
  assert.doesNotThrow(() => digestBattleLog(undefined as unknown as string, []));
});
