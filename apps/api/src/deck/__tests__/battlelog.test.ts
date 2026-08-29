import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBattleLog, normalizeCardCode, mergeLogFields } from '../battlelog.js';

/**
 * Battle-log parser tests against a REAL PTCG Live log: PlayerA's Hide 'n'
 * Sneak Dhelmise win vs PlayerB's Dragapult ex / Dusknoir
 * (fixtures/battle-log-fixture.txt). Every expected value below was derived by
 * reading the fixture, not guessed:
 *   • 14 turn headers ("<name>'s Turn")
 *   • prizes: PlayerA 1+2+1+2 = 6, PlayerB 1×5 = 5
 *   • KOs of PlayerB's mons: Dusknoir, Dragapult ex, Dreepy, Dragapult ex
 *   • KOs of PlayerA's mons: Poltchageist, Banette, Dhelmise, Dhelmise, Banette
 *   • "PlayerB decided to go first." → wentFirst 'opponent'
 *   • "All Prize cards taken. PlayerA wins." → result 'win'
 * The fixture also exercises the curly-apostrophe forms ("PlayerA’s") that Live
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

test('fixture: identifies PlayerA as me with high confidence', () => {
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.equal(p.players.me, 'PlayerA');
  assert.equal(p.players.opponent, 'PlayerB');
  assert.equal(p.confidence, 'high');
});

test('fixture: result, turn order and turn count', () => {
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.equal(p.result, 'win'); // "All Prize cards taken. PlayerA wins."
  assert.equal(p.wentFirst, 'opponent'); // "PlayerB decided to go first."
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
  const p = parseBattleLog(FIXTURE, ['Charizard ex'], 'PLAYERA');
  assert.equal(p.players.me, 'PlayerA');
  assert.equal(p.confidence, 'high');
  assert.equal(p.result, 'win');
  // …and naming the opponent flips every perspective-dependent field.
  const q = parseBattleLog(FIXTURE, DECK_NAMES, 'PlayerB');
  assert.equal(q.players.me, 'PlayerB');
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

test('a timeout ending ("Opponent was inactive for too long. X wins.") resolves the result', () => {
  // Real ending from battle #8 — the wins sentence carries a non-prize prefix.
  const log = [
    'Setup',
    'Ash drew 7 cards for the opening hand.',
    'Misty drew 7 cards for the opening hand.',
    "Ash's Turn",
    'Ash played Pikachu to the Bench.',
    "Misty didn't take an action in time.",
    'Opponent was inactive for too long. Ash wins.',
  ].join('\n');
  const win = parseBattleLog(log, ['Pikachu'], 'Ash');
  assert.equal(win.result, 'win');
  const loss = parseBattleLog(log, [], 'Misty');
  assert.equal(loss.result, 'loss');
});

test('a wins line never matches a non-player name from the sentence prefix', () => {
  const log = [
    'Setup',
    'Ash drew 7 cards for the opening hand.',
    'Misty drew 7 cards for the opening hand.',
    'Somebody says Brock wins.',
  ].join('\n');
  const p = parseBattleLog(log, ['Pikachu'], 'Ash');
  assert.equal(p.result, null);
});

test('no win/concede line → result null (tie or truncated log)', () => {
  const truncated = FIXTURE.split('\n').slice(0, 100).join('\n');
  const p = parseBattleLog(truncated, DECK_NAMES);
  assert.equal(p.players.me, 'PlayerA');
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

// ─────────────────────────────────────────────────────────────────────────────
// THE FORMAT CHANGED: PTCG LIVE NOW PREFIXES EVERY CARD WITH ITS SET CODE
// ─────────────────────────────────────────────────────────────────────────────
//
// `fixtures/battle-log-cardcodes.txt` is a real game in the current format,
// player names anonymised. Every card is written "(sv10_102) Cynthia's Gible".
//
// The parser did not throw on these and did not look broken. It kept counting
// turns and kept returning a populated shape — while the card NAMES it
// extracted carried the code, so deck-overlap scoring hit zero for BOTH
// players. Re-parsed across the owner's real history, five logs came back
// with no owner and 0-0 prizes, three produced deck guesses like
// "(me1_1) Bulbasaur", and TWO were confidently attributed to the wrong
// player — their prizes, knockouts and win/loss all inverted, and stored.

const CODED = readFileSync(
  fileURLToPath(new URL('./fixtures/battle-log-cardcodes.txt', import.meta.url)),
  'utf8',
);

/** The Slowking deck this game was played with, as deck_card⋈card would give it. */
const CODED_DECK_NAMES = [
  'Slowpoke', 'Slowking', 'Latias ex', 'Mega Kangaskhan ex', 'Metagross', 'Spectrier',
  'Annihilape', 'Kyurem', 'Zeraora', 'Zoroark', "Lillie's Clefairy ex",
  'Academy at Night', "Ciphermaniac's Codebreaking", "Lillie's Determination",
  'Poké Pad', 'Ultra Ball', 'Night Stretcher', 'Switch', 'Telepathic Psychic Energy',
  'Basic Psychic Energy',
];

test('card codes: the deck owner is still identified, and is not the opponent', () => {
  // The regression that mattered. Two stored logs had these two swapped, which
  // is how "he thought my deck was my opponent's deck" reaches a user.
  const p = parseBattleLog(CODED, CODED_DECK_NAMES);
  assert.equal(p.players.me, 'PlayerA');
  assert.equal(p.players.opponent, 'PlayerB');
  assert.equal(p.confidence, 'high');
});

test('card codes: the game is read correctly end to end', () => {
  const p = parseBattleLog(CODED, CODED_DECK_NAMES);
  assert.equal(p.result, 'loss');
  assert.equal(p.wentFirst, 'opponent');
  // PlayerA took 1 then 2; PlayerB took 1 + 3 + 1 + 1. Counted from the log.
  assert.deepEqual(p.prizesTaken, { me: 3, opponent: 6 });
  assert.equal(p.knockouts.byMe.length, 2);
  assert.equal(p.knockouts.byOpponent.length, 4);
});

test('card codes: no extracted name carries a code', () => {
  // The half-broken case: high confidence with "(me1_1) Bulbasaur" as the deck
  // guess. A name that parses but reads wrong is worse than one that fails.
  const p = parseBattleLog(CODED, CODED_DECK_NAMES);
  const names = [...p.myPokemon, ...p.opponentPokemon, ...p.knockouts.byMe, ...p.knockouts.byOpponent];
  assert.ok(names.length > 0, 'nothing was extracted at all');
  for (const n of names) {
    assert.doesNotMatch(n, /\(/, `card code survived into a name: ${n}`);
  }
  assert.ok(p.opponentDeckGuess, 'no deck guess');
  assert.doesNotMatch(p.opponentDeckGuess!, /\(/);
  assert.match(p.opponentDeckGuess!, /Cynthia's Garchomp ex/);
});

test('card codes: the damage-breakdown labels are NOT stripped', () => {
  // "(Ability)" and "(Item)" are parenthesised too. The discriminator is
  // underscore-then-digits, and this is the test that says so.
  const p = parseBattleLog(CODED, CODED_DECK_NAMES);
  assert.equal(p.confidence, 'high');
  // A line the stripper must leave alone, checked directly rather than via a
  // field, because nothing else in the shape would notice if it vanished.
  assert.ok(CODED.includes('(Ability) Cheer On to Glory'));
  assert.ok(CODED.includes('(Item) (me1_124) Premium Power Pro'));
});

test('the OLD format still parses identically — this is additive', () => {
  // The fixture above this block has no card codes. Nothing about it may change.
  const p = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.equal(p.players.me, 'PlayerA');
  assert.equal(p.confidence, 'high');
  assert.equal(p.result, 'win');
  assert.deepEqual(p.prizesTaken, { me: 6, opponent: 5 });
});

// ─────────────────────────────────────────────────────────────────────────────
// CODE NORMALIZATION — PTCG Live card code → DeckPal catalogue card id
// ─────────────────────────────────────────────────────────────────────────────
//
// Pairs observed in real logs (see battlelog.ts docstring) and the rules
// derived from normaliseSetId + real card ids in the repo's own fixtures.

test('normalizeCardCode: observed real-log pairs', () => {
  assert.deepEqual(normalizeCardCode('me1_104'), { cardId: 'me01-104', foil: false });
  assert.deepEqual(normalizeCardCode('sv7_58'), { cardId: 'sv07-058', foil: false });
  assert.deepEqual(normalizeCardCode('sv6-5_38'), { cardId: 'sv06.5-038', foil: false });
  // _ph marks a foil printing: stripped, and returned as the foil flag.
  assert.deepEqual(normalizeCardCode('me5_29_ph'), { cardId: 'me05-029', foil: true });
});

test('normalizeCardCode: rules across the shapes seen in the fixture', () => {
  // set token already two digits stays; subset `-N` → `.N`; collector pads to 3.
  assert.deepEqual(normalizeCardCode('sv10_102'), { cardId: 'sv10-102', foil: false });
  assert.deepEqual(normalizeCardCode('rsv10-5_171'), { cardId: 'rsv10.5-171', foil: false });
  assert.deepEqual(normalizeCardCode('me2-5_280'), { cardId: 'me02.5-280', foil: false });
  assert.deepEqual(normalizeCardCode('sv10_7_ph'), { cardId: 'sv10-007', foil: true });
  // letters-only set token (energy promo sets) has no digit run to pad.
  assert.deepEqual(normalizeCardCode('mee_6'), { cardId: 'mee-006', foil: false });
  assert.deepEqual(normalizeCardCode('ec_5'), { cardId: 'ec-005', foil: false });
  // surrounding parens are tolerated.
  assert.deepEqual(normalizeCardCode('(sv7_58)'), { cardId: 'sv07-058', foil: false });
});

test('normalizeCardCode: extrapolated single-trailing-letter subset (sv10-5b → sv10.5b, no observed real-log pair)', () => {
  // Extrapolated from the numeric subset rule: a `-N` carrying one trailing
  // letter becomes `.N<letter>`. No observed real-log pair carries this shape,
  // so the dotted catalogue form is a guess — an under-match is possible, but a
  // false hit is not (a token that matches no real catalogue id simply scores
  // no code match and falls back to name-only matching).
  assert.deepEqual(normalizeCardCode('sv10-5b_38'), { cardId: 'sv10.5b-038', foil: false });
  // The existing numeric subset pairs are unchanged by the extension.
  assert.deepEqual(normalizeCardCode('sv6-5_38'), { cardId: 'sv06.5-038', foil: false });
  assert.deepEqual(normalizeCardCode('me2-5_280'), { cardId: 'me02.5-280', foil: false });
  assert.deepEqual(normalizeCardCode('rsv10-5_171'), { cardId: 'rsv10.5-171', foil: false });
  assert.deepEqual(normalizeCardCode('sv10_102'), { cardId: 'sv10-102', foil: false });
});

test('normalizeCardCode: non-codes return null, never a wrong id', () => {
  for (const junk of ['', '()', '(Ability) Cheer On', '(Item) Premium Power Pro', 'sv7', 'Cynthia', 'null', 'sv7_']) {
    assert.equal(normalizeCardCode(junk), null, `should be null: ${JSON.stringify(junk)}`);
  }
  // The damage-breakdown labels '(Ability)' / '(Item)' MUST NOT parse as codes
  // — the discriminator is underscore-then-digits, which these lack.
  assert.equal(normalizeCardCode('(Ability) Cheer On to Glory'), null);
  assert.equal(normalizeCardCode('(Item) (me1_124) Premium Power Pro'), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPLICIT ARGS WIN — mergeLogFields (the pure merge the POST route calls)
// ─────────────────────────────────────────────────────────────────────────────
//
// Real incident: an add came back "LOSS vs cheyras" with the user listed as
// their own opponent. The route already wired explicit fields to win via `??`;
// the merge is now centralised here so the contract is unit-pinned and a future
// edit cannot silently flip it. (The deeper gap — the agent's add_battle_log
// tool exposes no `opponent` parameter at all, so an explicit opponent could
// never be SENT through it — is out of this task's owned files.)

test('mergeLogFields: explicit result/opponent/opponentDeck override parsed', () => {
  const parsed = parseBattleLog(FIXTURE, DECK_NAMES); // me=PlayerA, win, opp=PlayerB
  const m = mergeLogFields(parsed, { result: 'loss', opponent: 'VladEvans', opponentDeck: 'Charizard ex' });
  assert.equal(m.result, 'loss');
  assert.equal(m.opponent, 'VladEvans');
  assert.equal(m.opponentDeck, 'Charizard ex');
});

test('mergeLogFields: parser fills whatever the caller omitted', () => {
  const parsed = parseBattleLog(FIXTURE, DECK_NAMES);
  assert.equal(parsed.result, 'win');
  assert.equal(parsed.players.opponent, 'PlayerB');
  assert.ok(parsed.opponentDeckGuess);
  const m = mergeLogFields(parsed, {});
  assert.equal(m.result, 'win');
  assert.equal(m.opponent, 'PlayerB');
  assert.equal(m.opponentDeck, parsed.opponentDeckGuess);
});

test('mergeLogFields: one explicit field overrides only that field', () => {
  // The incident shape: explicit opponent supplied, result left to the parser.
  const parsed = parseBattleLog(FIXTURE, DECK_NAMES);
  const m = mergeLogFields(parsed, { opponent: 'VladEvans' });
  assert.equal(m.opponent, 'VladEvans');
  assert.equal(m.result, 'win'); // parser's, untouched
  assert.equal(m.opponentDeck, parsed.opponentDeckGuess);
});

test('mergeLogFields: create semantics — null explicit means omit (parser fills)', () => {
  // The route turns an explicit null result into undefined before calling, since
  // clearing on create is meaningless. mergeLogFields treats null/undefined the
  // same way: the parser fills it.
  const parsed = parseBattleLog(FIXTURE, DECK_NAMES);
  const m = mergeLogFields(parsed, { result: null, opponent: null, opponentDeck: null });
  assert.equal(m.result, 'win');
  assert.equal(m.opponent, 'PlayerB');
  assert.equal(m.opponentDeck, parsed.opponentDeckGuess);
});

// ─────────────────────────────────────────────────────────────────────────────
// DRIFT TRIPWIRE — the 9237a77 format-drift signature, pinned with a FUTURE drift
// ─────────────────────────────────────────────────────────────────────────────
//
// fixtures/battle-log-future-drift.txt uses a plausible future code prefix style
// (`[sv10|102] Name` — brackets + pipe) the current stripper does not know. The
// parser still extracts real played cards, but their names carry the prefix, so
// neither player overlaps the deck — the exact "populated-looking but silently
// wrong" signature. It must come back confidence 'low' with an explicit warning.

const FUTURE_DRIFT = readFileSync(
  fileURLToPath(new URL('./fixtures/battle-log-future-drift.txt', import.meta.url)),
  'utf8',
);

const FUTURE_DECK_NAMES = [
  "Cynthia's Gible", 'Slowking', 'Basic Psychic Energy', "Cynthia's Garchomp ex",
];

test('drift tripwire: played cards but zero overlap for both players → low + warning', () => {
  const p = parseBattleLog(FUTURE_DRIFT, FUTURE_DECK_NAMES);
  assert.equal(p.confidence, 'low');
  assert.equal(p.players.me, null);
  assert.equal(p.result, null);
  assert.ok(p.warning, 'no drift warning emitted for a populated-looking zero-overlap parse');
  assert.match(p.warning!, /drift/i);
  // The parse did extract real cards (both players), so this is the populated-
  // looking-but-wrong case, not an empty log.
  assert.ok(p.playerCards.length === 2, 'both players were extracted');
  assert.ok(p.playerCards.every((pl) => pl.cardNameKeys.length > 0), 'cards were played');
  // The future prefix style uses brackets, which codePrecedingName (paren-based)
  // does not capture — so no codes are recorded, which is exactly why the
  // names carry the prefix and overlap hits zero.
  assert.ok(p.playerCards.every((pl) => pl.cardCodes.length === 0), 'unknown prefix yields no codes');
});

test('drift tripwire does NOT fire when a deck was not supplied (log-preview parse)', () => {
  // The log-preview route parses deck-agnostic ([]). An empty deck overlaps
  // nothing trivially; the tripwire must be suppressed so previews don't warn.
  const p = parseBattleLog(FUTURE_DRIFT, []);
  assert.equal(p.confidence, 'low');
  assert.equal(p.warning, null);
  assert.ok(p.playerCards.length === 2);
});

test('drift tripwire does NOT fire when the deck actually matches', () => {
  // The real fixture (codes stripped cleanly) overlaps the deck → high, no warning.
  const p = parseBattleLog(CODED, CODED_DECK_NAMES);
  assert.equal(p.confidence, 'high');
  assert.equal(p.warning, null);
});

