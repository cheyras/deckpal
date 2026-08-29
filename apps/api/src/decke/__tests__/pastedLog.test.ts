/**
 * `extractPastedLog` — the paste channel's read half.
 *
 * The log is already in the USER message the model is answering; this finds it
 * there. What is asserted here is the half that is wrong SILENTLY if it is
 * wrong at all: a real log extracts verbatim (so the substitution downstream
 * pastes the right thing), prose extracts to nothing (so a call that relied on
 * it degrades to the old behavior rather than logging garbage), and the
 * thresholds hold (>= 8 lines, >= 400 chars, an anchor, the 50,000-char cap).
 *
 * The fixture is the real one `deck/battlelog.test.ts` parses — a pasted log
 * that round-trips the production parser — read by path rather than retyped,
 * so a transcription drift in the test cannot diverge from the parser's truth.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractPastedLog } from '../pastedLog.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../../deck/__tests__/fixtures/battle-log-fixture.txt', import.meta.url),
);
// The fixture is CRLF on this checkout; `extractPastedLog` normalizes line
// endings internally (it splits on /\r?\n/ and joins on \n), so the expected
// text is the LF form with the single trailing newline stripped.
const FIXTURE = readFileSync(FIXTURE_PATH, 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\n$/, '');

/** A USER message in the AI SDK UI-message shape `api/chat.mjs` holds. */
function userMsg(text: string): { role: string; parts: [{ type: string; text: string }] } {
  return { role: 'user', parts: [{ type: 'text', text }] };
}

// ── A small, qualifying synthetic log (Setup + turns, > 8 lines, > 400 chars,
//    anchored) for the cases that need a second, distinguishable log.
const SMALL_LOG = [
  'Setup',
  'PlayerA chose heads for the opening coin flip.',
  'PlayerA won the coin toss.',
  'PlayerA decided to go first.',
  'PlayerA drew 7 cards for the opening hand.',
  'PlayerB drew 7 cards for the opening hand.',
  "PlayerB's Turn",
  'PlayerB drew a card.',
  'PlayerB played Dreepy to the Active Spot.',
  'PlayerB attached Basic Psychic Energy to Dreepy in the Active Spot.',
  'PlayerB ended their turn.',
  "PlayerA's Turn",
  'PlayerA drew a card.',
  'PlayerA played Shuppet to the Bench.',
  'PlayerA ended their turn.',
  'All Prize cards taken. PlayerA wins.',
].join('\n');

test('a real battle log embedded in a user message extracts verbatim', () => {
  // The log sits between prose on both sides — the pre-amble and the sign-off
  // are not log lines, so the run is exactly the log. Returned verbatim,
  // internal blank lines between turns and all (the fixture has them).
  const messages = [
    userMsg(`Hey Deck-E, can you log this game for me?\n\n${FIXTURE}\n\nThanks!`),
  ];
  const out = extractPastedLog(messages);
  assert.equal(out, FIXTURE, 'the extracted block was not the verbatim log');
  assert.ok(out !== null && out.length > 1000, 'the fixture is a real-sized log');
  // Internal blank lines (Live separates turns with them) are preserved — the
  // block is contiguous and includes them, not just the non-blank lines.
  assert.ok(out !== null && out.includes('\n\n'), 'internal blank lines were stripped');
});

test('prose-only user messages return null', () => {
  // A false null degrades to the old behavior (the model re-types the log); a
  // false MATCH would log garbage. Prose must not match.
  assert.equal(extractPastedLog([userMsg('How do I beat Dragapult ex?')]), null);
  assert.equal(
    extractPastedLog([
      userMsg('Setup\n\nWhat I want to do is set up on the Bench and prize race.'),
    ]),
    null,
    'the word "Setup" alone with no log grammar does not qualify',
  );
  assert.equal(extractPastedLog([]), null);
  assert.equal(extractPastedLog(null as never), null);
});

test('the NEWEST log wins — the first user message newest-first that carries one', () => {
  // Two user messages, each with a qualifying log. Walking newest-first, the
  // last message is returned — which is the one the reader JUST pasted, not a
  // log from earlier in the conversation they are no longer talking about.
  const messages = [
    userMsg(`Earlier I played this:\n\n${FIXTURE}`),
    userMsg(`Here is the one I mean:\n\n${SMALL_LOG}`),
  ];
  assert.equal(extractPastedLog(messages), SMALL_LOG);
  // And in the other order, the other one wins.
  assert.equal(
    extractPastedLog([userMsg(`Here:\n\n${SMALL_LOG}`), userMsg(`No, this:\n\n${FIXTURE}`)]),
    FIXTURE,
  );
});

test('a log in the model-message `content` shape extracts too', () => {
  // `api/chat.mjs` holds messages as `{ role, parts }`; the replayed history
  // may also carry `{ role, content }` (a string, or an array of parts). Both
  // are accepted so a shape change degrades silently rather than dropping the
  // log.
  const asString = { role: 'user', content: `Log this:\n\n${SMALL_LOG}` };
  assert.equal(extractPastedLog([asString]), SMALL_LOG);
  const asParts = { role: 'user', content: [{ type: 'text', text: `Log this:\n\n${SMALL_LOG}` }] };
  assert.equal(extractPastedLog([asParts]), SMALL_LOG);
});

test('a log the ASSISTANT narrated is not extracted — only the reader pastes', () => {
  // Deck-E might quote a log back; it is not the reader's paste, so a non-user
  // role carrying one is skipped. Walking newest-first over USER messages only.
  assert.equal(
    extractPastedLog([{ role: 'assistant', parts: [{ type: 'text', text: SMALL_LOG }] }]),
    null,
  );
  // And an assistant log does not win over a user one.
  assert.equal(
    extractPastedLog([
      { role: 'assistant', parts: [{ type: 'text', text: FIXTURE }] },
      userMsg(`Here:\n\n${SMALL_LOG}`),
    ]),
    SMALL_LOG,
  );
});

test('the 50,000-char cap holds — a log past the route ceiling is truncated, not rejected', () => {
  // A real log is ~15 KB; the cap is the route's own `RAW_LOG_MAX` (50,000).
  // A paste larger than it is truncated to the cap here rather than rejected by
  // `add_battle_log`'s schema or `POST /decks/:id/logs` later.
  const lines = ['Setup'];
  for (let i = 0; i < 900; i++) {
    lines.push("PlayerA's Turn", 'PlayerA drew a card.', 'PlayerA played Bulbasaur to the Bench.', 'PlayerA ended their turn.');
  }
  const big = lines.join('\n');
  assert.ok(big.length > 50_000, 'fixture: the synthetic log must exceed the cap');
  const out = extractPastedLog([userMsg(big)]);
  assert.equal(out === null ? 0 : out.length, 50_000, 'the cap did not hold at exactly 50,000');
  assert.ok(out !== null && out.startsWith('Setup'), 'the cap kept the head of the log');
  assert.equal(out, big.slice(0, 50_000));
});

test('a fragment below the thresholds does not qualify', () => {
  // >= 8 matching lines AND >= 400 chars AND an anchor. A short fragment
  // (Setup + one turn, six lines, ~200 chars) is below both and returns null —
  // the conservative direction: degrade to the old behavior rather than risk
  // garbage. The downstream parser still gates on quality, but the bar here is
  // "looks like a log end to end".
  const tooShort = ['Setup', 'PlayerA drew 7 cards for the opening hand.', "PlayerB's Turn", 'PlayerB drew a card.', 'PlayerB played Dreepy to the Active Spot.', 'PlayerB ended their turn.'].join('\n');
  assert.ok(tooShort.length < 400, 'fixture: this fragment must be under 400 chars');
  assert.equal(extractPastedLog([userMsg(tooShort)]), null);
});
