/**
 * Where a research question may be answered from, and why it depends on the
 * question.
 *
 * The owner's distinction: *"Collection is mostly evergreen, a cool card years
 * ago is still a cool card now… but for battle strategy we definitely want to
 * make sure we're not pulling from outdated sources."*
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMPETITIVE_SOURCES,
  researchProviderOptions,
  topicInstructions,
} from '../researchSources.js';

test('a competitive question is pinned to the live competitive sources', () => {
  const o = researchProviderOptions('competitive');
  const list = o.providerOptions?.perplexity?.search_domain_filter;
  assert.ok(Array.isArray(list), 'the allowlist must reach the provider');
  // A SET, not `.includes`. `list` is an array so `.includes` is already exact
  // membership — but CodeQL reads it as `String.prototype.includes` and flags
  // `js/incomplete-url-substring-sanitization`, and it is right about the
  // PATTERN: that is the shape that lets `pokemon.com.attacker.net` through
  // when the same line appears in real sanitising code. `deck.test.ts` reached
  // the same conclusion about the same rule and wrote it down; a habit left in
  // a file people copy from is a habit that gets copied.
  const domains = new Set(list);
  assert.ok(domains.has('limitlesstcg.com'), 'the format’s results database');
  assert.ok(domains.has('pokemon.com'), 'the publisher');
});

test('a general question is NOT pinned — open web is the point', () => {
  // Restricting artwork and collecting questions to tournament sites would
  // destroy the answer to keep a rule. Measured: the open web returns the
  // illustrators and the community discussion; the allowlist returns neither.
  assert.deepEqual(researchProviderOptions('general'), {});
});

test('SNAKE_CASE, because that is what actually reaches the provider', () => {
  // `searchDomainFilter` type-checks, is accepted by the SDK, and is dropped on
  // the wire — the same silent no-op that killed the xAI live-search idea and
  // the `providerOptions.gateway.cacheControl` attempt before it.
  const o = researchProviderOptions('competitive');
  const p = o.providerOptions?.perplexity as Record<string, unknown>;
  assert.ok('search_domain_filter' in p, 'snake_case is the wire spelling');
  assert.ok(!('searchDomainFilter' in p), 'camelCase is silently ignored by the Gateway');
});

test('NO recency filter is sent, at any window — measured, it made things worse', () => {
  // week:  0 authoritative sources, 2 wrong-game (mtgo.com, mtga.untapped.gg)
  // month: 1 authoritative, 2 wrong-game
  // year:  0 authoritative, vague answer
  // A narrow window starves the query and the engine takes whatever it can get,
  // and "Standard format" is a format name in Magic too.
  const p = researchProviderOptions('competitive').providerOptions?.perplexity as Record<
    string,
    unknown
  >;
  assert.ok(!('search_recency_filter' in p), 'recency filtering starved every query tried');
});

test('the allowlist stays short enough to mean something', () => {
  // An allowlist that grows to include content farms has stopped being one.
  assert.ok(COMPETITIVE_SOURCES.length <= 12, `${COMPETITIVE_SOURCES.length} is too many`);
  // And it is hosts, not URLs — a path here would silently match nothing.
  for (const d of COMPETITIVE_SOURCES) {
    assert.ok(!d.includes('/'), `${d} is a URL, not a host`);
    assert.ok(!d.startsWith('www.'), `${d} should not carry www.`);
  }
});

test('a competitive question is told that rotation makes old answers WRONG', () => {
  // Whitespace-normalised: these instructions are hand-wrapped, so a phrase can
  // straddle a newline and a literal regex would fail for formatting reasons
  // rather than for meaning ones.
  const t = topicInstructions('competitive').replace(/\s+/g, ' ');
  assert.match(t, /ROTATES/);
  // The distinction that matters: not merely old.
  assert.match(t, /no longer exists/);
  assert.match(t, /date every claim/i);
  // And that saying so is a finding rather than a failure.
  assert.match(t, /useful finding/i);
});

test('a general question is told the opposite — old sources are fine', () => {
  const t = topicInstructions('general');
  assert.match(t, /Older sources are/i);
  assert.doesNotMatch(t, /ROTATES/);
});

test('the two topics give genuinely different instructions', () => {
  assert.notEqual(topicInstructions('competitive'), topicInstructions('general'));
});
