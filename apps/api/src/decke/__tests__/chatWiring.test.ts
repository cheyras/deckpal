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
