import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBattleLog, scoreDeckMatch, normalizeCardCode } from '../battlelog.js';

/**
 * Pure scoring tests for scoreDeckMatch (the function the POST /decks/log-preview
 * route ranks candidate decks with). No DB, no route — the route handler is thin
 * and just loads + shapes; the ranking logic is all here, so the pure tests carry
 * the weight (live-DB route tests are excluded from CI).
 *
 * Fixtures:
 *   • battle-log-fixture.txt — old format, no card codes (name-only matching).
 *   • battle-log-cardcodes.txt — current format, every card carries a Live code
 *     (name + code matching). PlayerA owns the Slowking deck.
 */

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/battle-log-fixture.txt', import.meta.url)),
  'utf8',
);
const CODED = readFileSync(
  fileURLToPath(new URL('./fixtures/battle-log-cardcodes.txt', import.meta.url)),
  'utf8',
);

// The Slowking deck the coded game was played with, with the catalogue card ids
// the codes normalize to (derived from the codes printed in the fixture, so the
// code-strengthened match has something real to hit).
const CODED_DECK_CARDS = [
  { name: 'Slowpoke', cardId: 'me05-029' }, // (me5_29_ph)
  { name: 'Slowking', cardId: 'sv07-058' }, // (sv7_58)
  { name: 'Latias ex', cardId: 'sv08-076' }, // (sv8_76)
  { name: 'Mega Kangaskhan ex', cardId: 'me01-104' }, // (me1_104)
  { name: 'Metagross', cardId: 'me04-061' }, // (me4_61)
  { name: 'Spectrier', cardId: 'me02.5-098' }, // (me2-5_98)
  { name: 'Annihilape', cardId: 'sv08-100' }, // (sv8_100)
  { name: 'Kyurem', cardId: 'sv06.5-047' }, // (sv6-5_47)
  { name: 'Zeraora', cardId: 'sv10-078' }, // (sv10_78)
  { name: 'Zoroark', cardId: 'rsv10.5-062' }, // (rsv10-5_62)
  { name: "Lillie's Clefairy ex", cardId: 'me02.5-280' }, // (me2-5_280)
  { name: 'Academy at Night', cardId: 'sv06.5-054' }, // (sv6-5_54)
  { name: "Ciphermaniac's Codebreaking", cardId: 'sv05-145' }, // (sv5_145)
  { name: "Lillie's Determination", cardId: 'me01-119' }, // (me1_119)
  { name: 'Poké Pad', cardId: 'me03-081' }, // (me3_81)
  { name: 'Ultra Ball', cardId: 'sv01-196' }, // (sv1_196)
  { name: 'Night Stretcher', cardId: 'sv06.5-061' }, // (sv6-5_61)
  { name: 'Switch', cardId: 'sv01-194' }, // (sv1_194)
  { name: 'Telepathic Psychic Energy', cardId: 'me03-088' }, // (me3_88)
  { name: 'Basic Psychic Energy', cardId: 'ec-005' }, // (ec_5)
];

const DECK_NAMES = [
  'Poltchageist', 'Sinistcha', 'Shuppet', 'Banette', 'Dhelmise', 'Fezandipiti ex',
  'Buddy-Buddy Poffin', 'Ultra Ball', 'Poké Pad', 'Prism Tower', "Lillie's Determination",
  "Boss's Orders", 'Night Stretcher', 'Special Red Card', 'Switch', 'Air Balloon', 'Gwynn',
  'Telepathic Psychic Energy', 'Basic Psychic Energy',
];
const DECK_CARDS = DECK_NAMES.map((name) => ({ name, cardId: null })); // old format: no ids

test('scoreDeckMatch: the matching deck scores above zero; a non-matching deck scores zero', () => {
  const parsed = parseBattleLog(FIXTURE, []); // deck-agnostic, like the route
  const hit = scoreDeckMatch(parsed, DECK_CARDS);
  assert.ok(hit.score > 0, `matching deck should score > 0, got ${hit.score}`);
  assert.ok(hit.matchedNames > 0);
  assert.equal(hit.total, DECK_CARDS.length);

  const miss = scoreDeckMatch(parsed, [{ name: 'Charizard ex', cardId: 'sv05-001' }]);
  assert.equal(miss.score, 0);
  assert.equal(miss.matchedNames, 0);
});

test('scoreDeckMatch: code-strengthened matching — a deck with matching card ids out-scores a name-only twin', () => {
  const parsed = parseBattleLog(CODED, []); // carries Live codes for both players

  // Twin A: right names but card ids that the codes never normalize to → names only.
  const twinNames = CODED_DECK_CARDS.map((c) => ({ name: c.name, cardId: 'zz-999' }));
  // Twin B: the real deck — right names AND right card ids.
  const real = CODED_DECK_CARDS;

  const a = scoreDeckMatch(parsed, twinNames);
  const b = scoreDeckMatch(parsed, real);

  // Same name overlap (both share the deck's names)…
  assert.equal(a.matchedNames, b.matchedNames);
  assert.ok(a.matchedNames > 0);
  // …but the real deck also matches codes, so it ranks strictly higher.
  assert.ok(b.matchedCodes > 0, 'code matches should register for the real deck');
  assert.equal(a.matchedCodes, 0, 'name-only twin must not register code matches');
  assert.ok(b.score > a.score, `real (${b.score}) must out-rank name-only twin (${a.score})`);
});

test('scoreDeckMatch picks the better-matching player (the deck is one player\'s)', () => {
  const parsed = parseBattleLog(CODED, []);
  // The Slowking deck is PlayerA's. PlayerB played Cynthia's line, which shares
  // nothing with this deck — so the score reflects PlayerA, not PlayerB.
  const m = scoreDeckMatch(parsed, CODED_DECK_CARDS);
  assert.ok(m.matchedNames >= 8, `PlayerA's overlap should be large, got ${m.matchedNames}`);
  assert.ok(m.matchedCodes >= 5, `PlayerA's code overlap should be substantial, got ${m.matchedCodes}`);
});

test('scoreDeckMatch: ranking across multiple deck lists (mirrors the route)', () => {
  const parsed = parseBattleLog(CODED, []);
  const decks = [
    { id: 'a', cards: CODED_DECK_CARDS }, // the real Slowking deck
    { id: 'b', cards: [{ name: 'Charizard ex', cardId: 'sv05-001' }] }, // no overlap
    { id: 'c', cards: twinWithoutIds(CODED_DECK_CARDS) }, // names overlap, no ids
    { id: 'd', cards: [{ name: 'Slowking', cardId: 'sv07-058' }] }, // partial overlap
  ];

  const scored = decks
    .map((d) => ({ id: d.id, ...scoreDeckMatch(parsed, d.cards) }))
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 5);

  // The real deck (names + codes) ranks first, above the name-only twin, above
  // the partial overlap; the no-overlap deck is excluded entirely.
  assert.equal(scored[0]!.id, 'a');
  assert.ok(scored.find((s) => s.id === 'c')!.score < scored[0]!.score, 'name-only twin ranks below real');
  assert.ok(scored.find((s) => s.id === 'd')!.score < scored.find((s) => s.id === 'c')!.score, 'partial ranks below twin');
  assert.equal(scored.find((s) => s.id === 'b'), undefined, 'no-overlap deck excluded');
  assert.ok(scored.length <= 5);
});

test('scoreDeckMatch: empty array when nothing scores above zero', () => {
  const parsed = parseBattleLog(CODED, []);
  const decks = [
    { name: 'Charizard', cards: [{ name: 'Charizard ex', cardId: 'sv05-001' }] },
    { name: 'Miraidon', cards: [{ name: 'Miraidon ex', cardId: 'sv05-002' }] },
  ];
  const scored = decks
    .map((d) => scoreDeckMatch(parsed, d.cards))
    .filter((s) => s.score > 0)
    .slice(0, 5);
  assert.deepEqual(scored, []);
});

test('scoreDeckMatch + normalizeCardCode agree on a foil printing', () => {
  // Slowpoke is a foil (me5_29_ph → me05-029, foil) in the coded fixture; the
  // deck carries that exact id, so the foil printing counts as a code match.
  assert.deepEqual(normalizeCardCode('me5_29_ph'), { cardId: 'me05-029', foil: true });
  const parsed = parseBattleLog(CODED, []);
  const m = scoreDeckMatch(parsed, CODED_DECK_CARDS);
  assert.ok(m.matchedCodes > 0);
});

function twinWithoutIds(cards: { name: string; cardId: string }[]) {
  return cards.map((c) => ({ name: c.name, cardId: null }));
}

// ── POST /decks/log-preview fan-out bounds (security finding B) ──────────────
//
// The route handler used to iterate EVERY non-deleted deck (2 queries each)
// with no rate limit — an unbounded fan-out. The fix ships two bounds: a cap
// on the scoring set and a per-user rate limit. The route itself needs a live
// DB (excluded from CI), but the cap constant and the pure rate-limit decision
// are exported and pinned here. bugs.ts's rate limiter is module-local (not
// exported), so decks.ts replicates the minimal pattern locally — same shape,
// and the pure core is lifted out so it can be tested without a timer.
import {
  LOG_PREVIEW_DECK_CAP,
  LOG_PREVIEW_RATE_MAX,
  LOG_PREVIEW_RATE_WINDOW_MS,
  rateLimitCheck,
} from '../../routes/decks.js';

test('LOG_PREVIEW_DECK_CAP bounds the log-preview fan-out', () => {
  // 40 is far above any real collection and caps the 2-queries-per-deck loop.
  // Pinned as a constant so a future loosening is a deliberate edit, not drift.
  assert.equal(LOG_PREVIEW_DECK_CAP, 40);
  assert.ok(LOG_PREVIEW_DECK_CAP > 0 && LOG_PREVIEW_DECK_CAP <= 100, 'cap must bound, not disable, the fan-out');
});

test('rateLimitCheck: under the cap passes; the (max+1)th in the window is refused', () => {
  const now = 1_000_000;
  // First request starts a fresh bucket.
  let res = rateLimitCheck(undefined, now);
  assert.equal(res.ok, true);
  assert.equal(res.bucket.count, 1);
  assert.equal(res.bucket.resetAt, now + LOG_PREVIEW_RATE_WINDOW_MS);

  // Fill the window up to the cap — each one still ok, count climbing.
  let bucket = res.bucket;
  for (let i = 2; i <= LOG_PREVIEW_RATE_MAX; i++) {
    res = rateLimitCheck(bucket, now + i);
    assert.equal(res.ok, true, `request ${i} should pass (cap ${LOG_PREVIEW_RATE_MAX})`);
    bucket = res.bucket;
  }
  assert.equal(bucket.count, LOG_PREVIEW_RATE_MAX);

  // The very next in-window request is refused — but the bucket still records
  // it, so a burst just over the limit is counted rather than silently dropped.
  res = rateLimitCheck(bucket, now + LOG_PREVIEW_RATE_MAX + 1);
  assert.equal(res.ok, false, 'the request over the cap must be refused (429)');
  assert.equal(res.bucket.count, LOG_PREVIEW_RATE_MAX + 1);
});

test('rateLimitCheck: an expired window resets — the limit is per-window, not per-process', () => {
  const now = 5_000_000;
  // A bucket whose window has closed resets to a fresh count of 1, even if the
  // previous window was hammered over the cap. This is what stops a one-off
  // burst from locking a user out for ever.
  const expired = { count: 999, resetAt: now - 1 };
  const res = rateLimitCheck(expired, now);
  assert.equal(res.ok, true);
  assert.equal(res.bucket.count, 1);
  assert.equal(res.bucket.resetAt, now + LOG_PREVIEW_RATE_WINDOW_MS);
});

test('rateLimitCheck: a missing bucket is treated as a first request, never as "refused"', () => {
  // undefined must not throw and must not be read as over-the-limit.
  const res = rateLimitCheck(undefined, 0);
  assert.equal(res.ok, true);
  assert.equal(res.bucket.count, 1);
});

