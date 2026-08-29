import test from 'node:test';
import assert from 'node:assert/strict';
import { cardLegality } from '../cardLegality.js';
import { formatConfig, formatsCheckedAt } from '../data.js';
import type { CardFacts } from '../types.js';

/**
 * The card modal's TCG tab reports FORMAT ELIGIBILITY. It gets there by running
 * the deck validator on a one-card deck and keeping only the card-scoped
 * violations, so what these tests actually pin is the filter: a single card
 * necessarily breaks several deck-construction rules (it is not 60 cards; a
 * lone Trainer has no Basic Pokémon), and none of those may leak into a verdict
 * about the card.
 *
 * No database here — the reprint oracle is injected, the way `formats.test.ts`
 * injects it. `cardLegality` REQUIRES one: for GLC's `cel25cc` and Pokémon TCG
 * Classic cards it is the only pool route that fires, so a caller that omits it
 * would report a legal card illegal.
 */

/** An oracle that admits nothing — the common case, and the strict one. */
const noReprint = { isInFormatByReprint: () => false };

function facts(over: Partial<CardFacts> = {}): CardFacts {
  return {
    id: 1,
    tcgdexId: 'sv08-013',
    setTcgdexId: 'sv08',
    localId: '013',
    localIdNumeric: 13,
    name: 'Rellor',
    normalizedName: 'rellor',
    category: 'Pokemon',
    stage: 'Basic',
    suffix: null,
    trainerType: null,
    energyType: null,
    hp: 40,
    retreat: 1,
    regulationMark: 'H',
    evolveFrom: null,
    types: ['Grass'],
    ...over,
  };
}

function verdict(
  c: CardFacts,
  format: string,
  ctx = noReprint,
): { legal: boolean; reasons: string[] } {
  const row = cardLegality(c, ctx).formats.find((f) => f.format === format);
  assert.ok(row, `no verdict for ${format}`);
  return row;
}

test('a current-mark Pokemon is legal in Standard, and no deck rule leaks in', () => {
  const v = verdict(facts(), 'standard');
  assert.equal(v.legal, true);
  // The one-card deck breaks DECK_SIZE. If that ever reached the tab, this is
  // where it would show up: a legal card reported illegal because it is not 60.
  assert.deepEqual(v.reasons, []);
});

test('a lone Trainer is still Standard-legal despite having no Basic Pokemon', () => {
  // NO_BASIC_POKEMON is unavoidable for a single Trainer and says nothing about
  // whether the card may be played, which is the whole point of the filter.
  const v = verdict(facts({ category: 'Trainer', trainerType: 'Item', stage: null, types: [] }), 'standard');
  assert.equal(v.legal, true);
  assert.deepEqual(v.reasons, []);
});

test('a rotated-out mark is not Standard-legal, and says why', () => {
  const v = verdict(facts({ regulationMark: 'F' }), 'standard');
  assert.equal(v.legal, false);
  assert.equal(v.reasons.length, 1);
  assert.match(v.reasons[0]!, /regulation mark F/);
});

test('a pre-Black-&-White card is out of Expanded but fine in Unlimited', () => {
  const base = facts({
    tcgdexId: 'base1-60',
    setTcgdexId: 'base1',
    localId: '60',
    localIdNumeric: 60,
    name: 'Ponyta',
    normalizedName: 'ponyta',
    regulationMark: null,
    types: ['Fire'],
  });
  assert.equal(verdict(base, 'expanded').legal, false);
  // Unlimited's pool strategy is 'all' — every printed card is in it.
  assert.equal(verdict(base, 'unlimited').legal, true);
});

test('GLC excludes rule-box cards as a fact about the card, not the deck', () => {
  const ex = facts({ suffix: 'ex', name: 'Latias ex', normalizedName: 'latias ex' });
  // Only meaningful if the fixture is actually rule-boxed the way GLC tests for.
  const glc = cardLegality(ex, noReprint).formats.find((f) => f.format === 'glc')!;
  assert.equal(glc.legal, false);
  assert.ok(glc.reasons.length > 0);
});

test('every format the API knows about gets a verdict', () => {
  const rows = cardLegality(facts(), noReprint).formats;
  assert.deepEqual(
    rows.map((r) => r.format),
    ['standard', 'expanded', 'glc', 'unlimited'],
  );
});

test('the report carries the vendored rulebook date, not today', () => {
  const { checkedAt } = cardLegality(facts(), noReprint);
  // Must be the data's own `as_of`, so a stale rulebook is visible rather than
  // being silently restamped with the time of the request.
  // Asserted against the vendored file, NOT "is it today" — the latter goes red
  // on the one day a data refresh happens to land, which is precisely the day
  // someone is looking at this suite.
  assert.match(checkedAt, /^\d{4}-\d{2}-\d{2}/);
  assert.equal(checkedAt, formatsCheckedAt());
});

test('the Standard verdict uses the same legal_marks the deck panel does', () => {
  // Not a tautology: it is the assertion that the tab and the deck builder read
  // one rulebook. If a future change gives the card tab its own mark list, the
  // two screens can disagree in front of the same reader and this fails.
  const marks = formatConfig('standard').legal_marks;
  for (const mark of marks) {
    assert.equal(verdict(facts({ regulationMark: mark }), 'standard').legal, true, `mark ${mark}`);
  }
});

test('the reprint oracle can rescue a rotated-out card, and the tab honours it', () => {
  // The reason the oracle is a required argument rather than an optional one.
  // Same card, same rulebook; the only difference is whether a
  // fingerprint-identical legal printing is known to exist.
  const rotated = facts({ regulationMark: 'F' });
  assert.equal(verdict(rotated, 'standard', noReprint).legal, false);
  assert.equal(verdict(rotated, 'standard', { isInFormatByReprint: () => true }).legal, true);
});

test('a card with NO regulation mark says so, rather than printing a dash', () => {
  // Caught by looking at the rendered TCG tab: a pre-Sword-&-Shield card read
  // "has regulation mark — and has no legal reprint", where the dash IS the
  // absent mark. Survivable in a deck violation list, reads as a typo when the
  // modal states the sentence on its own.
  const v = verdict(facts({ regulationMark: null }), 'standard');
  assert.equal(v.legal, false);
  assert.match(v.reasons[0]!, /has no regulation mark/);
  assert.doesNotMatch(v.reasons[0]!, /regulation mark —/);
});
