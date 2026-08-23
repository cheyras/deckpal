/**
 * A REFUSAL MUST NOT RENDER AS AN ANSWER.
 *
 * Photographed in the real app with the QA meter spent: the turn came back
 * refused and the transcript drew *"I've done as much as I can for you today —
 * try me again tomorrow"* exactly like a reply to a question. Same shape as a
 * fluent refusal reaching the MODEL as a bare string (`deepOutcome.ts` on the
 * server) — an outcome nobody encodes is an outcome somebody infers from tone.
 *
 * `DeckeNotice` was built, tested and put in the gallery, and NOTHING RENDERED
 * IT in the product. That is this repository's most repeated defect — `CardRows`,
 * `onRemoveCard` and `resetDeckeEntitlement` were all built and never wired, and
 * the last of them meant Deck-E never appeared for a signed-in reader.
 *
 * These are SOURCE PINS: `useDeckeChat.ts` and `DeckeChat.tsx` both reach
 * `import.meta.env` and cannot be imported here. They are deliberately about the
 * WIRING rather than the components, because the components already have their
 * own tests and the wiring is the half that goes missing.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = readFileSync(fileURLToPath(new URL('../useDeckeChat.ts', import.meta.url)), 'utf8');
const PANEL = readFileSync(fileURLToPath(new URL('../DeckeChat.tsx', import.meta.url)), 'utf8');
const HOST = readFileSync(fileURLToPath(new URL('../DeckeHost.tsx', import.meta.url)), 'utf8');

test('a refused turn emits a NOTICE, not prose', () => {
  assert.match(HOOK, /noticeInstead\(n\)/, 'the http refusal no longer emits a notice');
  assert.match(HOOK, /kind: 'notice' as const/, 'noticeInstead no longer builds a notice part');
});

test('`sayInstead` is gone, so no failure path can quietly go back to prose', () => {
  // It was the only way to put a failure into the transcript as text. Deleting
  // it is what makes "a failure is never prose" a property rather than a habit.
  const code = HOOK.split('\n').filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'));
  assert.ok(
    !code.some((l) => /sayInstead\s*\(/.test(l)),
    'a failure path is writing prose into the transcript again',
  );
});

test('every failure route carries a tone, and a limit is not an error', () => {
  // A limit sends someone to a top-up; a fault sends them to support. Telling
  // them the wrong one wastes their time in a way that feels like being lied to.
  assert.match(HOOK, /tone: 'limit' as const/, '429 no longer reads as a limit');
  assert.match(HOOK, /tone: 'error' as const/, 'a real fault no longer reads as an error');
});

test('the panel actually RENDERS a notice part', () => {
  // The half that goes missing. A part kind nothing draws is a silent hole in
  // the transcript: the reply would render with its text stripped and nothing
  // in its place, which is worse than the prose it replaced.
  assert.match(PANEL, /part\.kind === 'notice'/, 'DeckeChat no longer renders notice parts');
  assert.match(PANEL, /<DeckeNotice\s+tone=\{part\.tone\}/, 'the notice is not drawn from the part');
  assert.match(PANEL, /\|\s*\{ kind: 'notice'/, 'ChatPart no longer has a notice kind');
});

test('a notice is not counted as something HE said', () => {
  // `messageText` feeds the speech bubble, the announcement and the live region.
  // A refusal read out as his words would put it back in his voice by a
  // different route than the one just closed.
  assert.match(PANEL, /if \(p\.kind === 'text'\) out \+= p\.text/);
});

test('the farewell is MOUNTED, not merely built', () => {
  // Flagged by its own author as the CardRows shape: a component with no call
  // site is a defect wearing a feature's clothes. It lives in the host because
  // `DeckeChat` returns null on the same tick the line would appear.
  assert.match(HOST, /<DeckeFarewell/, 'DeckeFarewell is built and nothing mounts it');
  assert.match(HOST, /pickFarewell\(/, 'no line is ever picked');
  assert.match(HOST, /writeLastSaid\(store, \{ \.\.\.said, farewellId: bye\.id \}\)/, 'the no-repeat rule is not persisted');
});

test('the declined row is a real phase now, not an id suffix', () => {
  assert.match(HOOK, /phase: 'declined'/, 'deny went back to emitting `ok` and the tick returns');
});
