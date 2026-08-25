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

test('the confirmation card is HANDED the restatement, not just able to show one', () => {
  // `deepRequest.ts` has its own tests and they all pass whether or not anything
  // calls it. This is the half that goes missing: without the prop the card
  // renders a headline and two buttons for a call that costs the scarcest thing
  // the account has — the friction-with-no-information dialog the line exists to
  // prevent, and the argued reason deep calls did not ask at all until now.
  assert.match(PANEL, /request=\{deepRequestLine\(asking\[0\]\.name, asking\[0\]\.input\)\}/,
    'ApprovalCard is no longer given his restatement of the request')
  assert.match(PANEL, /import \{ deepRequestLine \}/)
})

test('a standalone arrival closes the chat; a hop inside a walk does NOT', () => {
  // "Take me to my decks" leaves the reader looking at a panel covering the
  // decks page — the owner: "he didn't ever leave the chat. He's supposed to
  // actually go on to the next page." He chose the chat closing with a line.
  //
  // The `!journeySteps` half is the load-bearing one and has no visible symptom
  // when wrong in the easy direction: without it, the FIRST hop of an escort
  // would dismiss the panel and abandon the walk, taking his own narration off
  // screen with it. Every unit test around the walk would still pass.
  assert.match(
    HOOK,
    /call\.name === 'goTo' && !journeySteps && \(result as UiToolResult\)\.ok/,
    'a journey hop or a failed goTo can now dismiss the panel',
  )
  // Fired at the TURN BOUNDARY, not at the moment of navigation: he usually says
  // something after arriving, and closing mid-turn would cut that off.
  assert.match(HOOK, /if \(arrived\) onArrivedRef\.current\?\.\(\)/)
  assert.match(HOST, /seeYouOut\(\)/, 'the host no longer sees him out on arrival')
})

test('running out of legs mid-journey pairs its notice with the error posture, not bare prose', () => {
  // Filed on the animation review: *"he doesn't really telegraph that
  // properly. he should probably do his error state or something and then
  // fucking leave. he parks here for way too long before displaying his
  // error message, and he's full size."* The sentence was always written to
  // the transcript via `appendText` — this is the same shape as the refusal
  // this file otherwise pins throughout: real information with no signal
  // reaching the CHARACTER, so he stood there giving no sign anything had
  // gone wrong until the words finished appearing.
  //
  // Anchored on the `console.warn` text rather than on a brace-matched block,
  // because that text is unique in the file and does not move if the branch
  // above it is reformatted or its long history comment is edited again.
  const marker = "console.warn('[decke] leg budget exhausted with work still outstanding')"
  const idx = HOOK.indexOf(marker)
  assert.ok(idx >= 0, 'the leg-budget-exhausted warning is gone from useDeckeChat.ts')
  const around = HOOK.slice(Math.max(0, idx - 900), idx + marker.length)
  assert.match(
    around,
    /if \(!saidSoFar\) \{/,
    'no longer guards against erasing everything he already said across earlier legs — ' +
      '`noticeInstead` replaces every text part on the reply, and a multi-leg journey has ' +
      'almost always said something real by its last leg',
  )
  assert.match(
    around,
    /title: 'I ran out of steps there\.'/,
    'the exhaustion notice no longer carries this wording',
  )
  assert.match(
    around,
    /decke\.setState\('alert_error', \{ mode: 'once' \}\)/,
    'running out of legs no longer sets his error posture — the exact complaint this pins',
  )
  assert.match(
    around,
    /movedRef\.current = true/,
    'running out of legs no longer tells the turn boundary he moved, so it would force him ' +
      'back to idle over the posture just set',
  )
})

test('both ways out share one farewell path', () => {
  // The ✕ and an arrival are the same event to a reader. Two copies is two
  // places for the no-repeat rule to be forgotten, and it is persisted rather
  // than held in a ref precisely because people close the panel far more often
  // than they reload.
  const calls = (HOST.match(/seeYouOut\(\)/g) ?? []).length
  assert.ok(calls >= 2, `seeYouOut is called ${calls} time(s) — one of the routes out has its own copy`)
  assert.equal((HOST.match(/pickFarewell\(/g) ?? []).length, 1, 'a line is picked in more than one place')
})
