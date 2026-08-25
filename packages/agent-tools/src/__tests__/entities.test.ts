/**
 * The resolvers, and the asymmetry that keeps a write from acting on a guess.
 *
 * Every reference tried here is one the model actually sent in the owner's
 * transcript history — see `entities.ts` for the counts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  explainMiss,
  foldName,
  matchNamed,
  MISS_ADVICE,
  normaliseSetId,
  presentRef,
  resolvedNote,
  type EntityCandidate,
} from '../entities.js';

// ── presentRef: the seven `set_id: 'none'` calls ─────────────────────────────

test("presentRef reads the words a model writes for 'I have no value'", () => {
  // `set_progress` told the model to "call with NO set_id" and got back
  // `set_id: 'none'` seven times in one turn — the turn that then produced no
  // answer at all.
  for (const v of ['none', 'None', 'NONE', 'null', 'undefined', 'n/a', 'NA', '', '   ', '-', 'any', 'unknown']) {
    assert.equal(presentRef(v), undefined, `${JSON.stringify(v)} should read as absent`);
  }
});

test('presentRef keeps a real reference, trimmed', () => {
  assert.equal(presentRef('  me05 '), 'me05');
  assert.equal(presentRef('Pitch Black'), 'Pitch Black');
  // A card called "Nothing" would be unlucky, but a SET id is never one of the
  // sentinel words, and this field is an id-or-name.
  assert.equal(presentRef('Nosepass'), 'Nosepass');
});

test('presentRef refuses anything that is not a string', () => {
  assert.equal(presentRef(undefined), undefined);
  assert.equal(presentRef(null), undefined);
  assert.equal(presentRef(42), undefined);
  assert.equal(presentRef({}), undefined);
});

// ── normaliseSetId: the nine `sv3pt5` calls ──────────────────────────────────

test("normaliseSetId maps TCGdex's public spelling onto this catalog's", () => {
  // 'sv3pt5' was offered as an example of a valid id in search_cards' own input
  // schema and in set_progress's failure message. It is TCGdex's spelling of
  // sv03.5 and does not exist here. The model called it nine times in one turn.
  assert.ok(normaliseSetId('sv3pt5').includes('sv03.5'));
});

test('normaliseSetId zero-pads a one-digit run — the `sv3.5` near miss', () => {
  // One character from correct, and a hard failure.
  assert.ok(normaliseSetId('sv3.5').includes('sv03.5'));
  assert.ok(normaliseSetId('me2').includes('me02'));
});

test('normaliseSetId always keeps the original spelling', () => {
  assert.ok(normaliseSetId('me05').includes('me05'));
  assert.ok(normaliseSetId('base1').includes('base1'));
});

test('normaliseSetId does not pad a two-digit id into a wrong one', () => {
  // `base1` must not become `base01`, and `me05` must not become `me005`.
  assert.ok(!normaliseSetId('me05').includes('me005'));
  assert.deepEqual(normaliseSetId('me05'), ['me05']);
});

test('normaliseSetId lowercases, because a model will shout an id', () => {
  assert.ok(normaliseSetId('ME05').includes('me05'));
});

// ── matchNamed: decks and lists ──────────────────────────────────────────────

const DECKS = [
  { id: '47333f45-1edf-4af0-bf14-bdc671b2d40e', name: "Hide 'n' Sneak (Dhelmise)" },
  { id: 'eaae34ba-9607-49d6-a133-1a06b777d472', name: 'Toolbox Slowking' },
  { id: '11111111-1111-4111-8111-111111111111', name: 'Toolbox Slowking (old)' },
];
const describe = (d: { id: string; name: string }): EntityCandidate => ({ id: d.id, label: d.name });

test('an exact id wins', () => {
  const r = matchNamed(DECKS, 'eaae34ba-9607-49d6-a133-1a06b777d472', describe);
  assert.equal(r.kind, 'found');
  if (r.kind === 'found') {
    assert.equal(r.value.name, 'Toolbox Slowking');
    assert.equal(r.matchedBy, 'id');
  }
});

test('an exact name wins, accent- and case-insensitively', () => {
  const r = matchNamed(DECKS, 'toolbox slowking', describe);
  assert.equal(r.kind, 'found');
  if (r.kind === 'found') assert.equal(r.matchedBy, 'name');
});

test("READ: 'dhelmise' resolves — the request that failed twice in the record", () => {
  // "navigate to my dhelmise deck" → `decks failed: No deck 'dhelmise'`.
  const r = matchNamed(DECKS, 'dhelmise', describe);
  assert.equal(r.kind, 'found');
  if (r.kind === 'found') {
    assert.equal(r.value.name, "Hide 'n' Sneak (Dhelmise)");
    assert.equal(r.matchedBy, 'fuzzy');
  }
});

test("READ: 'slowking-toolbox' resolves despite the word order and the hyphen", () => {
  const r = matchNamed(DECKS, 'slowking-toolbox', describe);
  // Two decks contain both words, so this is honestly a choice rather than a
  // hit — and a choice carrying ids is one step from done.
  assert.equal(r.kind, 'ambiguous');
  if (r.kind === 'ambiguous') {
    assert.equal(r.candidates.length, 2);
    for (const c of r.candidates) assert.match(c.id, /^[0-9a-f-]{36}$/);
  }
});

test('WRITE: a fuzzy match is a CHOICE, never an action', () => {
  // The whole asymmetry. `deck_strategy` replaces a deck's entire guide and has
  // no dry_run; over MCP there is no approval dialog either. A trigram hit must
  // not reach it.
  const loose = matchNamed(DECKS, 'dhelmise', describe);
  assert.equal(loose.kind, 'found', 'a read takes the single best fuzzy hit');

  const strict = matchNamed(DECKS, 'dhelmise', describe, { strict: true });
  assert.equal(strict.kind, 'ambiguous', 'a write must not act on a fuzzy hit');
  if (strict.kind === 'ambiguous') {
    assert.equal(strict.candidates.length, 1);
    assert.equal(strict.candidates[0]!.label, "Hide 'n' Sneak (Dhelmise)");
  }
});

test('WRITE: an exact name still resolves — strict is not "ids only"', () => {
  // A reader says "delete my Toolbox Slowking deck", not a uuid. Exactness is
  // the bar, not machine-readability.
  const r = matchNamed(DECKS, 'Toolbox Slowking', describe, { strict: true });
  assert.equal(r.kind, 'found');
  if (r.kind === 'found') assert.equal(r.matchedBy, 'name');
});

test('a uuid that matches nothing is NOT fuzzed against names', () => {
  // The record has a list's uuid passed as deck_id and a deck's uuid passed as
  // list_id. Fuzzy-matching a uuid against deck names would be worse than the
  // failure it replaces.
  const r = matchNamed(DECKS, '55d8fabb-7d60-4fd5-b7f2-2bcc41e10c16', describe);
  assert.equal(r.kind, 'not-found');
  if (r.kind === 'not-found') assert.equal(r.nearest.length, 0);
});

test('nothing matching gives not-found rather than a wrong answer', () => {
  const r = matchNamed(DECKS, 'zzzz', describe);
  assert.equal(r.kind, 'not-found');
});

test('foldName strips accents and punctuation', () => {
  assert.equal(foldName("Hide 'n' Sneak"), 'hide n sneak');
  assert.equal(foldName('Pokémon 151'), 'pokemon 151');
});

// ── The messages ─────────────────────────────────────────────────────────────

test('a miss NEVER quotes an invented example id', () => {
  // The rule this whole pass exists to enforce. Every id in a failure message
  // must come from the caller's own data.
  const msg = explainMiss(
    'set',
    'sv3pt5',
    { kind: 'not-found', nearest: [{ id: 'sv03', label: 'Obsidian Flames' }] },
    'fallback advice',
  );
  assert.match(msg, /sv03/);
  assert.match(msg, /Obsidian Flames/);
  // The thing the old message did: name a format example that does not resolve.
  assert.ok(!/TCGdex ids like/.test(msg));
});

test('a miss with nothing to suggest gives the fallback, not a lecture', () => {
  const msg = explainMiss('set', 'zzz', { kind: 'not-found', nearest: [] }, 'Try fewer words.');
  assert.match(msg, /Try fewer words\./);
});

test('no shipped advice phrases an instruction as something that could be a VALUE', () => {
  // "call set_progress with NO set_id" came back as `set_id: 'none'`, seven
  // times, in the turn that answered nothing at all.
  //
  // Asserted against the REAL strings, not copies. The first version of this
  // test quoted its own copy of the advice and passed while production still
  // said the forbidden thing — which is exactly what a duplicated string does.
  for (const [what, advice] of Object.entries(MISS_ADVICE)) {
    assert.ok(!/\bno \w+_id\b/i.test(advice), `${what} advice reads as a value: ${advice}`);
    const msg = explainMiss(what, 'x', { kind: 'not-found', nearest: [] }, advice);
    assert.ok(!/\bno \w+_id\b/i.test(msg), `${what} message reads as a value: ${msg}`);
  }
});

test('an ambiguity hands back ids, so the next call is exact', () => {
  const msg = explainMiss(
    'deck',
    'toolbox',
    {
      kind: 'ambiguous',
      candidates: [
        { id: 'aaa', label: 'Toolbox Slowking', hint: 'standard · v2' },
        { id: 'bbb', label: 'Toolbox Slowking (old)' },
      ],
    },
    'unused',
  );
  assert.match(msg, /aaa/);
  assert.match(msg, /bbb/);
  assert.match(msg, /standard · v2/);
});

test('a cross-type id is named as such', () => {
  const msg = explainMiss(
    'deck',
    '55d8fabb-7d60-4fd5-b7f2-2bcc41e10c16',
    { kind: 'not-found', nearest: [], crossType: 'that id is a LIST — "Base Set Buys". Use the list tools for it.' },
    'unused',
  );
  assert.match(msg, /is a LIST/);
  assert.match(msg, /Base Set Buys/);
});

test('an id match says nothing; a name match teaches the id', () => {
  // The model re-guessed the same wrong id over and over because nothing ever
  // told it the right one.
  assert.equal(resolvedNote('set', 'me05', 'me05', 'Pitch Black', 'id'), null);
  const note = resolvedNote('set', 'Pitch Black', 'me05', 'Pitch Black', 'name');
  assert.ok(note);
  assert.match(note, /me05/);
  assert.match(note, /Use me05 from now on/);
});
