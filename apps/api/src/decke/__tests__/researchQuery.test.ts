/**
 * What may leave this process in a research query.
 *
 * The research call is the ONLY one that goes to a vendor outside the owner's
 * chosen list, and the relaxation was granted on one claim: that it carries
 * nothing about this reader. These are that claim, as tests.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkResearchQuery, MAX_QUERY } from '../researchQuery.js';

const ok = (q: string, name?: string) => {
  const v = checkResearchQuery(q, name);
  assert.equal(v.ok, true, `expected ALLOWED: ${q}${v.ok ? '' : ` — ${v.reason}`}`);
};
const no = (q: string, name?: string) => {
  const v = checkResearchQuery(q, name);
  assert.equal(v.ok, false, `expected REFUSED: ${q}`);
  return v.ok ? '' : v.reason;
};

test('a real research question goes through', () => {
  ok('Which Pokemon TCG cards do collectors call underrated for their artwork?');
  ok('What is winning Standard tournaments right now?');
  ok('Is Base Set Charizard a good card to own long term?');
  ok('What did the Mega Evolution set change about the format?');
  ok('Who illustrated the Umbreon VMAX alt art and what else have they drawn?');
});

test('an app id never leaves', () => {
  const why = no('Tell me about deck 47333f45-1edf-4af0-bf14-bdc671b2d40e');
  assert.match(why, /id from this app/);
});

test('an email never leaves', () => {
  assert.match(no('what does cheyras@gmail.com collect'), /email/);
});

test('anything credential-shaped never leaves', () => {
  no('use eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghij to look this up');
  no('Bearer sk-abcdefghijklmnop check this');
});

test("the reader's own collection never leaves", () => {
  assert.match(no('What is my collection worth?'), /collection/);
  no('How good is my binder compared to other people');
  no('Which cards do I own that are going up');
  no('what does he own that is worth money');
});

test("the reader's own name never leaves", () => {
  assert.match(no('What decks does Cheyenne play?', 'Cheyenne'), /name/);
  // Case-insensitive, and on a word boundary.
  no('tell me about cheyenne', 'Cheyenne');
});

test('a SHORT display name is not matched, because it would break research', () => {
  // Plenty of people are called Mew, Ash or Red. Refusing every question that
  // contains those protects nothing and breaks the feature.
  ok('What is the best Mew ex deck right now?', 'Mew');
  ok('Is Ash Greninja a good card?', 'Ash');
});

test('a display name is matched on a WORD BOUNDARY, not as a substring', () => {
  // "Ash" ⊂ "Marshadow". A bare `includes` would refuse a legitimate card
  // question to protect a name that is not actually present.
  ok('What is Marshadow worth?', 'Ashe');
  no('what is Ashe collecting', 'Ashe');
});

test('an over-long query is refused rather than truncated', () => {
  const why = no('x'.repeat(MAX_QUERY + 1));
  assert.match(why, new RegExp(String(MAX_QUERY)));
});

test('a non-string, or nothing at all, is refused', () => {
  assert.equal(checkResearchQuery(undefined).ok, false);
  assert.equal(checkResearchQuery(null).ok, false);
  assert.equal(checkResearchQuery(42).ok, false);
  assert.equal(checkResearchQuery('   ').ok, false);
});

test('the refusal says WHY, because the model has to explain it', () => {
  const why = no('What is my collection worth?');
  assert.ok(why.length > 10, 'a reason nobody can read is not a reason');
  assert.match(why, /never leaves DeckPal/);
});
