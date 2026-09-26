/**
 * The serverless function is where mechanisms go to be quietly unplugged.
 *
 * `api/chat.mjs` cannot be imported here — it is a Vercel handler that reaches
 * for the environment at module scope — so these are SOURCE PINS. They exist
 * because a mutation proved they had to: replacing the computed
 * `readerNamedPrinting` with a hardcoded `true` at the call site broke NOTHING.
 * Every unit test around the mechanism kept passing while the mechanism itself
 * was bypassed, and the symptom would have been at the far end — the printing
 * picker silently never appearing again, which is the exact defect it closes.
 *
 * That is this repository's most repeated bug shape. `CardRows`, `onRemoveCard`
 * and `resetDeckeEntitlement` were all built and never wired; the last of them
 * meant Deck-E never appeared for a signed-in user.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../../../../../api/chat.mjs', import.meta.url)), 'utf8');

test('the printing witness is COMPUTED from the reader, not asserted', () => {
  assert.match(
    SRC,
    /readerNamedPrinting:\s*readerNamedPrinting\(latestUserText\(messages\)\)/,
    'readerNamedPrinting is no longer computed from the reader\'s own message',
  );
  // A literal here is the bypass, and it reads as harmless in a diff.
  assert.doesNotMatch(SRC, /readerNamedPrinting:\s*(true|false)\b/);
});

test('it reads the READER\'s message and skips his own', () => {
  // Deck-E says "Normal" constantly. If assistant turns counted, his own guess
  // would be the witness to his own guess, and the mechanism inverts itself.
  const fn = SRC.slice(SRC.indexOf('function latestUserText'));
  assert.match(fn.slice(0, 600), /role !== 'user'/, 'latestUserText no longer filters to the reader');
});

test('the helper is imported from the built module rather than reimplemented', () => {
  // A local copy would drift from the vocabulary and its tests the first time
  // somebody added a printing word.
  assert.match(SRC, /import \{ readerNamedPrinting \} from '\.\.\/apps\/api\/dist\/decke\/printingSaid\.js'/);
});

/**
 * Source with comment lines stripped, so a pin cannot be satisfied by prose.
 * Local rather than shared, matching `legWiring.test.ts`: a pin file that
 * imports its own reader from somewhere else can be satisfied by changing the
 * reader.
 */
function code(src: string): string {
  return src
    .split('\n')
    .filter((l: string) => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

const CODE = code(SRC);

test('the empty-answer guard is called with ALL FIVE arguments', () => {
  // THE DEFECT THIS FILE EXISTS FOR, twice over. `needsAnswerNudge` shipped in
  // #138 called with three of five parameters. `completedToolNames` then
  // defaulted to `[]`, so the "any called tool that did not complete is
  // PENDING" carve-out matched every call and the guard returned false on every
  // reachable path. Its own unit tests pass all five and stayed green.
  assert.match(
    CODE,
    /needsAnswerNudge\(\s*answerText,\s*calledToolNames,\s*CLIENT_SET,\s*completedToolNames,\s*SERVER_SET\s*\)/,
    'the empty-answer guard lost an argument again — it cannot fire without all five',
  );
  // And `completedToolNames` must be DERIVED from the turn's real events, not
  // handed a literal. That is the mutation this repo has been bitten by.
  assert.match(CODE, /const completedToolNames = guardEvents\s*\n?\s*\.filter\(/);
  assert.doesNotMatch(CODE, /needsAnswerNudge\([^)]*\[\]\s*\)/);
});

test('the flailing NOTE uses shouldFireFlailing; the BREAKER keeps the raw budget', () => {
  // `shouldFireFlailing` was imported and never called, so a turn that flailed
  // and then recovered into a substantive answer was still told it flailed —
  // a correction for something the model fixed.
  assert.match(CODE, /\}\s*else if \(shouldFireFlailing\(phases, answerText\)\)/);
  // The mid-flight breaker must stay on the bare predicate: it trips BEFORE any
  // answer exists, so it cannot consult one.
  assert.match(CODE, /stepCountIs|errorBudgetExceeded\(guardEvents\.map\(\(e\) => e\.phase\)\)/);
});

test('the promise detector is wired into the one-guard chain', () => {
  // "First, I'll grab your deck's battle logs … One sec." — and the turn ended.
  // The detector reads STEPS, not the joined answer text, because it has to
  // know whether anything ran after the last thing said.
  assert.match(CODE, /promisedWithoutActing\(turnSteps, CLIENT_SET, completedToolNames\)/);
  assert.match(CODE, /const turnSteps = steps\.map\(/);
  // One guard per turn: the note goes through the same single `guardFired`
  // budget and the same `text-delta`, never a second write.
  assert.match(CODE, /else if \(promised\)/);
});

test('the failing-tool ledger is rebuilt per request and handed to the data tools', () => {
  // The server keeps nothing between requests, so this can only come from the
  // replayed history — the same source, lifetime and argument as `declined`.
  assert.match(CODE, /const failing = failingTools\(messages\)/);
  assert.match(CODE, /const retryRequested = readerAsksRetry\(latestUserText\(messages\)\)/);
  // Threaded in. A ledger that is built and not passed is this repository's
  // most repeated defect, and is exactly what happened to the two guards above.
  assert.match(CODE, /\n\s*failing,\r?\n\s*retryRequested,/);
  // The reader's OWN words are the only bypass — never the model's.
  assert.doesNotMatch(CODE, /readerAsksRetry\((?!latestUserText)/);
});

test('the already-told ledger is rebuilt per request and handed to the data tools', () => {
  // Same source, lifetime and argument as `failing` above — and the same
  // defect class if unthreaded: `toldAlready.ts` with no caller is a green
  // suite annotating nothing.
  assert.match(CODE, /const told = priorSummaries\(messages\)/);
  assert.match(CODE, /priorSummaries: told,/);
});

test('chat sends correlation into the server acceptance boundary before metering and model work', () => {
  assert.match(CODE, /conversationId, exchangeId, seq/);
  const begin = CODE.indexOf('usage = await beginAiRequest(');
  assert.ok(begin > 0);
  assert.ok(begin < CODE.indexOf('meter = await meterTurn('));
  assert.ok(begin < CODE.indexOf('model: observeUsageModel('));
  assert.match(CODE, /userId: user.id, conversationId, exchangeId, seq/);
});

// ── THE METER-REFUSAL LEDGER ────────────────────────────────────────────────
//
// `meteredRefusals.ts` can be perfect and change nothing: the retry loop it
// closes lives in the serverless function, across HTTP legs, and both ends of
// the wiring are one line each. Unplugging either leaves the whole api suite
// green — which is precisely the mutation this file exists to catch.

test('the deep tier is given the turn\'s meter refusals, seeded from the replayed history', () => {
  assert.match(
    SRC,
    /import \{ seedMeteredRefusals \} from '\.\.\/apps\/api\/dist\/decke\/meteredRefusals\.js'/,
    'the ledger is no longer imported from the built module',
  );
  // SEEDED FROM `messages`. A bare `seedMeteredRefusals(null)` would be an
  // in-memory closure with a longer name: correct across the SDK's own steps,
  // blind to the browser's approval legs, which is where the bug was measured.
  assert.match(SRC, /const deepRefusals = seedMeteredRefusals\(messages\)/);
  assert.match(SRC, /refusals: deepRefusals/, 'buildDeepTools no longer receives the ledger');
});

test('the same ledger narrows activeTools, so a spent tier leaves the model\'s view', () => {
  assert.match(
    SRC,
    /activeTools: focusedTools\(allDeckeTools, stepNumber, \(n\) => deepRefusals\.unavailable\(n\)\)/,
    'prepareStep no longer removes a spent deep tier from activeTools',
  );
});

// ── SEC-04: THE CONVERSATION IS BOUNDED BEFORE ANYTHING PAYS FOR IT ─────────
//
// `wireBounds.ts` can be perfect and bound nothing: the body is read, parsed,
// metered and converted here, and each of those is one line.

test('the body is read through the capped reader, and the uncapped one is gone', () => {
  assert.match(CODE, /await readBodyCapped\(req\)/, 'the handler no longer caps the body');
  assert.match(CODE, /if \(body === null\) \{\s*res\.statusCode = 413/, 'an oversized body no longer answers 413');
  assert.doesNotMatch(CODE, /for await \(const chunk of req\) chunks\.push\(chunk\)/, 'the uncapped reader came back');
});

test('the conversation is validated before any ledger, the meter or the model reads it', () => {
  const at = (s: string) => CODE.indexOf(s);
  const validate = at('const wire = validateWire(body?.messages)');
  assert.ok(validate > 0, 'validateWire is no longer called on the body');
  assert.match(CODE, /if \(!wire\.ok\) return json\(\{ error: wire\.error, code: wire\.code \}, wire\.status\)/);
  assert.match(CODE, /const messages = wire\.messages/, 'later code no longer reads the VALIDATED messages');
  for (const later of ['declinedCalls(messages', 'quote = await readPolicy(', 'usage = await beginAiRequest(', 'meter = await meterTurn(']) {
    assert.ok(validate < at(later), `${later} runs before the conversation is validated`);
  }
});

test('the model is shown the window, and the prompt the bounded page context', () => {
  assert.match(CODE, /convertToModelMessages\(stripPriorCommands\(windowForModel\(messages\)\.messages\)\)/);
  assert.match(CODE, /const route = boundedRoute\(body\?\.route\)/);
  assert.match(CODE, /const landmarks = boundedLandmarks\(body\?\.landmarks\)/);
  assert.doesNotMatch(CODE, /landmarks\.slice\(0, 40\)/, 'the old count-only slice is back');
});
