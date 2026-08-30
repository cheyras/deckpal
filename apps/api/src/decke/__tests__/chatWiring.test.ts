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
  assert.match(CODE, /\n\s*failing,\r?\n\s*retryRequested,\r?\n\s*conversationId,/);
  // The reader's OWN words are the only bypass — never the model's.
  assert.doesNotMatch(CODE, /readerAsksRetry\((?!latestUserText)/);
});

test('the conversation id is read from the body and used for nothing but the log', () => {
  assert.match(CODE, /const \{ messages, route = '\/', landmarks = \[\], conversationId \} = body \?\? \{\}/);
  // It must never gate a decision: a browser that does not send one still gets
  // the breaker, and `failing.ts` logs `conversation=unknown`.
  assert.doesNotMatch(CODE, /if \(conversationId\)/);
});
