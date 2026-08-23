/**
 * Which build answered this turn — and the parsing is the part that can be
 * quietly wrong.
 *
 * A history that cannot be tied to a build is an anecdote. "He used to name the
 * cards and now he doesn't" is a feeling until it is "he named them on #78 and
 * stopped on #81". These tests exist because the failure mode of the parser is
 * not an error, it is a PLAUSIBLE NUMBER — a turn confidently attributed to a
 * pull request that has nothing to do with the running code.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStamp, prFromCommitMessage } from '../build.js';

test('a squash-merge subject yields its PR', () => {
  // The real shape, from this repository's own history.
  assert.equal(
    prFromCommitMessage('Deck-E: the experience pass, and he ships behind a gate (#78)'),
    78,
  );
  assert.equal(prFromCommitMessage('Fix: /api/chat — Vercel calls it with (req, res) (#72)'), 72);
});

test('a reference in the BODY is not the PR this build is after', () => {
  // The failure that produces a wrong answer rather than no answer. A `(#41)`
  // in a commit body is somebody quoting an issue — "reverts the change from
  // (#41)" — and matching it would attribute the turn to an unrelated PR.
  // GitHub only ever puts the reference at the end of the SUBJECT.
  assert.equal(
    prFromCommitMessage('Revert the escort change\n\nThis undoes the work from (#41).'),
    null,
  );
  assert.equal(prFromCommitMessage('Real subject (#90)\n\nBody mentions (#41).'), 90);
});

test('a subject that merely CONTAINS a reference does not count', () => {
  // Anchored at the end. "Fix (#12) handling in the parser" is a description of
  // work about a PR, not a merge of one.
  assert.equal(prFromCommitMessage('Fix (#12) handling in the parser'), null);
});

test('no reference means NULL, which is a real answer', () => {
  // A preview deploy, a local run, a direct push to main. Not a failure, and it
  // must not be recorded as one — the column sorts NULLS LAST so these do not
  // pretend to be the oldest build in a regression hunt.
  for (const m of ['just a message', '', '   ', 'chore: tidy up']) {
    assert.equal(prFromCommitMessage(m), null, JSON.stringify(m));
  }
});

test('a missing or non-string message does not throw', () => {
  // It reads an environment variable that is simply absent everywhere except a
  // Vercel build, and a throw here would take down the turn it is describing.
  for (const v of [undefined, null, 42, {}, []]) {
    assert.equal(prFromCommitMessage(v as unknown), null, String(v));
  }
});

test('PR zero is refused, because GitHub does not issue one', () => {
  // The lazy sentinel. Seeing `#0` means the subject was not what we think it
  // was, and inventing a build number is worse than admitting we have none.
  assert.equal(prFromCommitMessage('Something (#0)'), null);
  assert.equal(prFromCommitMessage('Something (#00)'), null);
  // Leading zeros on a real number are still that number.
  assert.equal(prFromCommitMessage('Something (#0078)'), 78);
});

test('an absurd number is not treated as a PR', () => {
  // Seven digits is already far past any real repository. Beyond that the
  // subject is carrying something else that happens to look like one.
  assert.equal(prFromCommitMessage('Something (#12345678901)'), null);
});

test('the stamp reads the environment, and shortens the sha', () => {
  const prev = { m: process.env.VERCEL_GIT_COMMIT_MESSAGE, s: process.env.VERCEL_GIT_COMMIT_SHA };
  try {
    process.env.VERCEL_GIT_COMMIT_MESSAGE = 'Deck-E: something (#78)';
    process.env.VERCEL_GIT_COMMIT_SHA = '2a8bef7c0ffee1234567890abcdef1234567890a';
    assert.deepEqual(buildStamp(), { buildPr: 78, buildSha: '2a8bef7' });

    // Outside a Vercel build there is nothing to read, and that is not an error.
    delete process.env.VERCEL_GIT_COMMIT_MESSAGE;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    assert.deepEqual(buildStamp(), { buildPr: null, buildSha: null });

    // An empty sha is absent, not an empty string on a record.
    process.env.VERCEL_GIT_COMMIT_SHA = '';
    assert.equal(buildStamp().buildSha, null);
  } finally {
    if (prev.m === undefined) delete process.env.VERCEL_GIT_COMMIT_MESSAGE;
    else process.env.VERCEL_GIT_COMMIT_MESSAGE = prev.m;
    if (prev.s === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = prev.s;
  }
});
