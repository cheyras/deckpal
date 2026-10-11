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
import { extractPastedLog, pastedLogCount } from '../pastedLog.js';

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

test('unknown client lines inside an anchored log are retained, while surrounding prose is not', () => {
  // Live adds display-only templates more often than this small recognizer is
  // released. Anchors and closeout delimit the log, and the 70% density gate
  // lets a few such lines survive instead of silently saving a fragment.
  const lines = SMALL_LOG.split('\n');
  lines.splice(6, 0, 'This is an unfamiliar Live client status template.');
  lines.splice(12, 0, 'Another unfamiliar client sentence.');
  const log = lines.join('\n');
  const out = extractPastedLog([userMsg(`Please log this game:\n${log}\nThat was a close one.`)]);
  assert.equal(out, log);
  assert.ok(out !== null && out.includes('unfamiliar Live client status template.'));
  assert.ok(out !== null && !out.includes('Please log this game'));
  assert.ok(out !== null && !out.includes('That was a close one'));
});

test('recognizes checkup, condition, coin-flip, and damage-breakdown templates', () => {
  const log = [
    'Setup',
    'PlayerA chose heads for the opening coin flip.',
    'PlayerA won the coin toss.',
    'PlayerA decided to go first.',
    'PlayerA drew 7 cards for the opening hand.',
    'PlayerB drew 7 cards for the opening hand.',
    "PlayerA's Turn",
    'PlayerA drew a card.',
    'PlayerA played Munkidori to the Active Spot.',
    "PlayerA's Munkidori used Mind Racket on PlayerB’s Dreepy for 250 damage.",
    '- Damage breakdown:',
    '• Base damage: 250 damage',
    ' • (Pokémon Tool) Binding Mochi: 40 damage',
    '• Total damage: 300 damage',
    'Pokémon Checkup',
    "PlayerB's Dreepy is now Poisoned.",
    "PlayerB's Dreepy took 10 damage from Poison.",
    'PlayerA flipped a coin…',
    'PlayerA ended their turn.',
    'Opponent took all of their Prize cards. PlayerA wins.',
  ].join('\n');
  assert.equal(extractPastedLog([userMsg(log)]), log);
});

test('a Reverse Display Order paste runs from the result back through Setup', () => {
  // The physical line order is exactly what Live displays: no reversal is
  // performed here because raw_log must preserve the reader's source text.
  const reversed = SMALL_LOG.split('\n').reverse().join('\n');
  const out = extractPastedLog([userMsg(`reverse display order follows\n${reversed}\nend note`)]);
  assert.equal(out, reversed);
});

test('closeout-shaped prose before a normal log does not force reverse display order', () => {
  assert.equal(
    extractPastedLog([
      userMsg(`My opponent conceded last time, here is the rematch:\n${FIXTURE}`),
    ]),
    FIXTURE,
  );
  assert.equal(
    extractPastedLog([userMsg(`Alice wins.\nAnyway, log this one:\n\n${SMALL_LOG}`)]),
    SMALL_LOG,
  );
});

test('reverse display order starts at the nearest closeout before its anchor', () => {
  const reversed = SMALL_LOG.split('\n').reverse().join('\n');
  assert.equal(
    extractPastedLog([userMsg(`Alice conceded yesterday.\nOlder-game note.\n${reversed}`)]),
    reversed,
  );
});

test('an anchored latest user message cannot fall back to a stale pasted game', () => {
  const incomplete = [
    'Setup',
    'PlayerA drew 7 cards for the opening hand.',
    "PlayerB's Turn",
    'PlayerB drew a card.',
  ].join('\n');
  assert.equal(
    extractPastedLog([
      userMsg(`The old game:\n${SMALL_LOG}`),
      userMsg(`This is the new paste, but it is incomplete:\n${incomplete}`),
    ]),
    null,
  );
});

test('two complete games in one message return only the last game', () => {
  const first = SMALL_LOG.replaceAll('PlayerA', 'OldA').replaceAll('PlayerB', 'OldB');
  const last = SMALL_LOG.replaceAll('PlayerA', 'NewA').replaceAll('PlayerB', 'NewB');
  assert.equal(
    extractPastedLog([userMsg(`Game 1:\n${first}\n\nGame 2:\n${last}`)]),
    last,
  );
  assert.equal(
    pastedLogCount([userMsg(`Game 1:\n${first}\n\nGame 2:\n${last}`)]),
    2,
    'the companion count discloses that the first complete game was not carried',
  );
  assert.equal(pastedLogCount([userMsg(last)]), 1);
});

// 2026-10-10 (#291 review): the channel carries one game by design, and the
// count is how the reader learns the rest were left behind. It must describe
// the SAME message the extractor read, and count only real games.
test('pastedLogCount counts the games in the message the extractor carried', () => {
  const g = (name: string): string => SMALL_LOG.replaceAll('PlayerA', name);
  const three = `${g('OneA')}\n\n${g('TwoA')}\n\n${g('ThreeA')}`;
  assert.equal(extractPastedLog([userMsg(three)]), g('ThreeA'));
  assert.equal(pastedLogCount([userMsg(three)]), 3);
  // A closeout-shaped chat line between games is not a fourth game, and does
  // not split one.
  const chatty = `${g('OneA')}\n\nHonestly I should have conceded.\n\n${g('TwoA')}`;
  assert.equal(extractPastedLog([userMsg(chatty)]), g('TwoA'));
  assert.equal(pastedLogCount([userMsg(chatty)]), 2);
  // No paste is zero; an unfinished game and a reverse-order game are one each.
  assert.equal(pastedLogCount([userMsg('How do I beat Dragapult ex?')]), 0);
  assert.equal(pastedLogCount(null), 0);
  assert.equal(pastedLogCount([userMsg(SMALL_LOG.split('\n').slice(0, -1).join('\n'))]), 1);
  assert.equal(pastedLogCount([userMsg(SMALL_LOG.split('\n').reverse().join('\n'))]), 1);
  // The NEWEST paste is the one counted, as it is the one carried.
  assert.equal(pastedLogCount([userMsg(three), userMsg(`Just this one:\n${SMALL_LOG}`)]), 1);
});

// Reviewer reproduction (a), on the real fixture: a normal-order paste with no
// result yet and no Setup, under a preamble whose first line is closeout-shaped.
// HEAD read it as Reverse Display Order — the span began at the preamble and
// the parser was handed "Kingofslowbros conceded" as this game's result.
test('closeout-shaped preamble does not turn a partial forward paste into reverse order', () => {
  const partial = FIXTURE.split('\n')
    .filter((line) => line !== 'Setup' && !/wins\.$/.test(line))
    .join('\n');
  const expected = partial.slice(partial.indexOf("PlayerB's Turn"));
  const out = extractPastedLog([
    userMsg(`Kingofslowbros conceded last time.\nHere's tonight's game so far:\n${partial}`),
  ]);
  assert.equal(out, expected);
  assert.ok(out !== null && !out.startsWith('Kingofslowbros conceded'));
  // The one-line form puts no prose line between the sentence and the log, so
  // what refuses it is the opening: coin flip and opening hands sit ABOVE the
  // first turn only in normal order.
  assert.equal(
    extractPastedLog([
      userMsg(`Kingofslowbros conceded last time. Here's tonight's game so far:\n${partial}`),
    ]),
    expected,
  );
});

test('an unfinished paste stops before closeout-shaped chat below it', () => {
  // Without a result of its own the span used to run to the last log-shaped
  // line anywhere — and "I should have conceded." is log-shaped, so the parser
  // was handed the reader's sentence as the result of a game still in progress.
  const partial = SMALL_LOG.split('\n').slice(0, -1).join('\n');
  assert.equal(
    extractPastedLog([userMsg(`${partial}\n\nHonestly I should have conceded.`)]),
    partial,
  );
});

test('post-closeout chat and a later closeout-shaped sentence stay out of raw_log', () => {
  assert.equal(
    extractPastedLog([
      userMsg(
        `${SMALL_LOG}\n\n- what did I misplay on turn 3?\nIt feels like whoever goes first wins.`,
      ),
    ]),
    SMALL_LOG,
  );
});

test('only narrow, directly attached client lines are kept after a closeout', () => {
  const cleanup = [
    'Telepathic Psychic Energy was activated.',
    "A card was added to PlayerA's hand.",
    '- PlayerA drew 1 card.',
    '- PlayerA shuffled their deck.',
    '- PlayerA attached Boomerang Energy to Slowking in the Active Spot.',
  ].join('\n');
  assert.equal(
    extractPastedLog([userMsg(`${SMALL_LOG}\n${cleanup}\n- what did I misplay?`)]),
    `${SMALL_LOG}\n${cleanup}`,
  );
});

test('a Reverse Display Order paste without Setup still extracts the whole game', () => {
  const reversed = SMALL_LOG.split('\n')
    .filter((line) => line !== 'Setup')
    .reverse()
    .join('\n');
  assert.equal(extractPastedLog([userMsg(reversed)]), reversed);
});

// Reviewer reproduction (b): reader chat a blank line below a Reverse Display
// Order paste. HEAD read the chat as a normal-order result: the span ran from
// the first turn header to the chat, dropping the real result on line one, and
// "Kingofslowbros conceded? no, I lost." flipped who won.
test('reverse order without Setup ends before blank-separated closeout-shaped chat', () => {
  const reversed = SMALL_LOG.split('\n')
    .filter((line) => line !== 'Setup')
    .reverse()
    .join('\n');
  // The real fixture, reversed: Live's blank lines between turns and its
  // damage-breakdown bullets, so the run has to cross real paragraph breaks
  // and still stop at the chat.
  const realReversed = FIXTURE.split('\n')
    .filter((line) => line !== 'Setup')
    .reverse()
    .join('\n');
  // And with Setup, where HEAD returned nothing at all.
  const withSetup = SMALL_LOG.split('\n').reverse().join('\n');
  for (const chat of [
    'Honestly I should have conceded.',
    'Kingofslowbros conceded? no, I lost.',
  ]) {
    for (const log of [reversed, realReversed, withSetup]) {
      const out = extractPastedLog([userMsg(`${log}\n\n${chat}`)]);
      assert.equal(out, log, `reader chat was mistaken for the result: ${chat}`);
    }
  }
});

test('reverse order keeps the attached cleanup lines that sit above its result', () => {
  // `slowking-vs-beedrill.log` ends with a Boomerang Energy activation AFTER
  // the result; reversed, those lines sit directly above it and were dropped.
  const cleanup = [
    'Boomerang Energy was activated.',
    '- PlayerA attached Boomerang Energy to Shuppet on the Bench.',
  ];
  const reversed = [...SMALL_LOG.split('\n'), ...cleanup].reverse().join('\n');
  assert.equal(extractPastedLog([userMsg(`Log this one:\n\n${reversed}`)]), reversed);
});
