/**
 * Pure battle-synthesis tests — no DB, no network (CI purity, Ground Truth #9).
 * Covers: archetype normalization (exact/alias/reject+suggestions), narrative
 * bounds, merge semantics for idempotent re-synthesis, queue "needs"
 * computation, ollama response parsing, and the pgvector literal.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMBED_DIMS, parseEmbeddingsResponse, vectorLiteral } from '../ollama.js';
import {
  type ArchetypeRow,
  type SynthesisFields,
  NARRATIVE_HARD_MAX,
  NARRATIVE_HARD_MIN,
  checkNarrative,
  mergeSynthesis,
  needsOf,
  normalizeArchetype,
  wordCount,
} from '../synthesis.js';

// ── Archetype normalization ──────────────────────────────────────────────────

const registry: ArchetypeRow[] = [
  { slug: 'dragapult-dusknoir', name: 'Dragapult ex / Dusknoir', aliases: ['dragapult dusknoir', 'pult'] },
  { slug: 'dhelmise', name: 'Dhelmise', aliases: [] },
  { slug: 'raging-bolt', name: 'Raging Bolt ex', aliases: ['bolt'] },
  { slug: 'gardevoir', name: 'Gardevoir ex', aliases: ['gardy'] },
];

test('normalizeArchetype: canonical slug matches directly, case/whitespace-insensitive', () => {
  const r = normalizeArchetype('  dhelmise ', registry);
  assert.deepEqual(r, { ok: true, slug: 'dhelmise', name: 'Dhelmise', via: 'slug' });
  const r2 = normalizeArchetype('DRAGAPULT-DUSKNOIR', registry);
  assert.deepEqual(r2, { ok: true, slug: 'dragapult-dusknoir', name: 'Dragapult ex / Dusknoir', via: 'slug' });
});

test('normalizeArchetype: alias and display name resolve to the canonical slug', () => {
  const r = normalizeArchetype('Pult', registry);
  assert.deepEqual(r, { ok: true, slug: 'dragapult-dusknoir', name: 'Dragapult ex / Dusknoir', via: 'alias' });
  const r2 = normalizeArchetype('gardy', registry);
  assert.deepEqual(r2, { ok: true, slug: 'gardevoir', name: 'Gardevoir ex', via: 'alias' });
  const r3 = normalizeArchetype('Raging Bolt ex', registry);
  assert.deepEqual(r3, { ok: true, slug: 'raging-bolt', name: 'Raging Bolt ex', via: 'name' });
});

test('normalizeArchetype: unknown label is rejected with ranked suggestions, never invented', () => {
  const r = normalizeArchetype('Dragapult Charizard', registry);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.input, 'Dragapult Charizard');
    assert.ok(
      r.suggestions.some((s) => s.slug === 'dragapult-dusknoir'),
      `expected dragapult-dusknoir suggestion, got ${JSON.stringify(r.suggestions)}`,
    );
  }
});

test('normalizeArchetype: gibberish gets no (or weak) suggestions; empty input rejected', () => {
  const r = normalizeArchetype('zzzzqqqq', registry);
  assert.equal(r.ok, false);
  const empty = normalizeArchetype('   ', registry);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.deepEqual(empty.suggestions, []);
});

test('normalizeArchetype: empty registry rejects everything', () => {
  const r = normalizeArchetype('Dhelmise', []);
  assert.equal(r.ok, false);
});

// ── Narrative bounds ─────────────────────────────────────────────────────────

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

test('wordCount: whitespace-robust', () => {
  assert.equal(wordCount('  one   two\nthree  '), 3);
  assert.equal(wordCount(''), 0);
});

test('checkNarrative: hard bounds refuse, target bounds advise', () => {
  const tooShort = checkNarrative(words(NARRATIVE_HARD_MIN - 1));
  assert.equal(tooShort.ok, false);
  const tooLong = checkNarrative(words(NARRATIVE_HARD_MAX + 1));
  assert.equal(tooLong.ok, false);
  const under = checkNarrative(words(100));
  assert.ok(under.ok && under.advisory !== null && under.advisory.includes('100 words'));
  const inTarget = checkNarrative(words(200));
  assert.ok(inTarget.ok && inTarget.advisory === null && inTarget.words === 200);
  const over = checkNarrative(words(350));
  assert.ok(over.ok && over.advisory !== null);
});

// ── Merge semantics (idempotent re-synthesis) ────────────────────────────────

const stored: SynthesisFields = {
  narrative: 'old narrative',
  my_archetype: 'dhelmise',
  opp_archetype: 'gardevoir',
  tags: ['prize-race'],
  key_cards: ['Iono'],
};

test('mergeSynthesis: omitted fields keep stored values (re-embed path passes nothing)', () => {
  const { fields, changed, missing } = mergeSynthesis(stored, {});
  assert.deepEqual(fields, stored);
  assert.deepEqual(changed, []);
  assert.deepEqual(missing, []);
});

test('mergeSynthesis: provided fields replace and are reported as changed', () => {
  const { fields, changed } = mergeSynthesis(stored, { opp_archetype: 'raging-bolt', tags: ['comeback', 'n-drop'] });
  assert.equal(fields.opp_archetype, 'raging-bolt');
  assert.deepEqual(fields.tags, ['comeback', 'n-drop']);
  assert.equal(fields.narrative, 'old narrative');
  assert.deepEqual(changed.sort(), ['opp_archetype', 'tags']);
});

test('mergeSynthesis: identical re-save reports no changes (idempotent)', () => {
  const { changed } = mergeSynthesis(stored, { narrative: 'old narrative', tags: ['prize-race'] });
  assert.deepEqual(changed, []);
});

test('mergeSynthesis: empty stored + partial incoming reports what is missing', () => {
  const blank: SynthesisFields = { narrative: null, my_archetype: null, opp_archetype: null, tags: [], key_cards: [] };
  const { missing } = mergeSynthesis(blank, { narrative: 'a game happened' });
  assert.deepEqual(missing, ['my_archetype', 'opp_archetype']);
});

test('mergeSynthesis: tags are trimmed, lowercased (020 contract), blanks dropped; key_cards keep case', () => {
  const { fields } = mergeSynthesis(stored, { tags: ['  Late  Game ', '', '  '], key_cards: [' Iono ', ''] });
  assert.deepEqual(fields.tags, ['late game']);
  assert.deepEqual(fields.key_cards, ['Iono']);
});

// ── Queue needs ──────────────────────────────────────────────────────────────

test('needsOf: reports exactly what is missing', () => {
  assert.deepEqual(needsOf({ narrative: null, my_archetype: null, opp_archetype: null, embedded: false }), ['narrative', 'archetypes', 'embedding']);
  assert.deepEqual(needsOf({ narrative: 'n', my_archetype: 'A', opp_archetype: null, embedded: true }), ['archetypes']);
  assert.deepEqual(needsOf({ narrative: 'n', my_archetype: 'A', opp_archetype: 'B', embedded: false }), ['embedding']);
  assert.deepEqual(needsOf({ narrative: 'n', my_archetype: 'A', opp_archetype: 'B', embedded: true }), []);
});

// ── Ollama response parsing + vector literal ─────────────────────────────────

test('parseEmbeddingsResponse: accepts a well-formed OpenAI-compatible body', () => {
  const vec = Array.from({ length: EMBED_DIMS }, (_, i) => i / EMBED_DIMS);
  const out = parseEmbeddingsResponse({ object: 'list', data: [{ object: 'embedding', embedding: vec, index: 0 }] });
  assert.equal(out.length, EMBED_DIMS);
  assert.equal(out[1], 1 / EMBED_DIMS);
});

test('parseEmbeddingsResponse: rejects malformed bodies and wrong dims', () => {
  assert.throws(() => parseEmbeddingsResponse({}), /no data/);
  assert.throws(() => parseEmbeddingsResponse({ data: [] }), /no data/);
  assert.throws(() => parseEmbeddingsResponse({ data: [{ embedding: 'nope' }] }), /not a finite number array/);
  assert.throws(() => parseEmbeddingsResponse({ data: [{ embedding: [1, NaN] }] }), /not a finite number array/);
  assert.throws(() => parseEmbeddingsResponse({ data: [{ embedding: [1, 2, 3] }] }), /expected 768/);
});

test('vectorLiteral: pgvector text format', () => {
  assert.equal(vectorLiteral([0.5, -1, 2]), '[0.5,-1,2]');
});
