import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EMBED_DIM, cosineSimilarity, l2Normalize } from '@deckpal/matching';
import {
  CURRENT_STAMP,
  buildResponse,
  parseEmbedding,
  type NeighbourRow,
  type NeighbourSource,
} from '../embedMatch.js';

/**
 * Injected vectors, no database.
 *
 * Everything this route decides is arithmetic over a ranking plus a ruling
 * about what the system may claim, and neither needs Postgres to be got wrong.
 * So the tests build a small catalogue of real unit vectors, rank a real query
 * against them with the same cosine the SQL computes, and assert on the answer
 * — which also means the fixtures below are internally consistent rather than
 * hand-typed similarities that could quietly stop being possible.
 */

/** A deterministic unit vector, seeded. */
function vec(seed: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  let s = seed >>> 0;
  for (let i = 0; i < EMBED_DIM; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    v[i] = s / 0x100000000 - 0.5;
  }
  return l2Normalize(v);
}

/** Move `from` a fraction of the way toward `toward`, then re-normalise —
 *  which is how a query that is "mostly this card" is constructed without
 *  inventing a similarity that no pair of vectors could actually have. */
function blend(from: Float32Array, toward: Float32Array, t: number): Float32Array {
  const out = new Float32Array(from.length);
  for (let i = 0; i < from.length; i++) out[i] = from[i]! * (1 - t) + toward[i]! * t;
  return l2Normalize(out);
}

interface CatalogEntry {
  cardId: string;
  variantCount: number;
  vector: Float32Array;
}

/** The seam `pgNeighbours` occupies in production: same contract, in memory. */
function injectedSource(catalog: CatalogEntry[]): NeighbourSource {
  return async (embedding, _stamp, k) => ({
    indexSize: catalog.length,
    rows: catalog
      .map(
        (c): NeighbourRow => ({
          cardId: c.cardId,
          name: c.cardId,
          number: c.cardId.split('-')[1] ?? '',
          setId: c.cardId.split('-')[0] ?? '',
          setName: 'Test Set',
          seriesId: 'me',
          rarity: null,
          similarity: cosineSimilarity(embedding, c.vector),
          variantCount: c.variantCount,
        }),
      )
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k),
  });
}

test('parseEmbedding accepts a well-formed unit vector', () => {
  const v = parseEmbedding(Array.from(vec(1)));
  assert.equal(v.length, EMBED_DIM);
});

test('parseEmbedding rejects the wrong width before Postgres has to', () => {
  // A wrong-width array reaches pgvector as a cast error naming neither the
  // field nor the expected size, three layers from the client that sent it.
  assert.throws(() => parseEmbedding(new Array(128).fill(0)), /must have 768 components, got 128/);
  assert.throws(() => parseEmbedding('nope'), /must be an array/);
});

test('parseEmbedding rejects a non-finite component', () => {
  const bad = Array.from(vec(2));
  bad[7] = Number.NaN;
  assert.throws(() => parseEmbedding(bad), /embedding\[7\] is not a finite number/);
});

test('parseEmbedding refuses an un-normalised vector instead of fixing it', () => {
  // Silently re-normalising would let a client that is not following the input
  // spec ship and keep working, and the next thing it gets wrong would not be
  // this catchable.
  const scaled = Array.from(vec(3)).map((x) => x * 2);
  assert.throws(() => parseEmbedding(scaled), /must be L2-normalised/);
});

test('a clear nearest neighbour is a confident identity', async () => {
  const target = vec(10);
  const catalog: CatalogEntry[] = [
    { cardId: 'me04-024', variantCount: 1, vector: target },
    { cardId: 'me04-025', variantCount: 1, vector: vec(11) },
    { cardId: 'me04-026', variantCount: 1, vector: vec(12) },
  ];
  const query = blend(vec(99), target, 0.97);
  const { indexSize, rows } = await injectedSource(catalog)(query, CURRENT_STAMP, 5);
  const res = buildResponse(CURRENT_STAMP, indexSize, rows);

  assert.equal(res.identity.level, 'confident');
  assert.equal(res.identity.cardId, 'me04-024');
  assert.ok(res.identity.margin !== null && res.identity.margin > 0);
  assert.equal(res.matches[0]?.cardId, 'me04-024');
  // The image path is composed from the series/set/number triple, not guessed.
  assert.equal(res.matches[0]?.images.low, '/deckpal/images/en/me/me04/024/low.webp');
});

test('two near-identical arts produce uncertain, not a coin flip', async () => {
  // The reprint case the ruling cares about: the picture is settled and the
  // PRINTING is the open question, so the gate must decline rather than pick.
  const art = vec(20);
  const catalog: CatalogEntry[] = [
    { cardId: 'base1-102', variantCount: 2, vector: art },
    { cardId: 'base4-130', variantCount: 2, vector: blend(art, vec(21), 0.02) },
    { cardId: 'gym1-132', variantCount: 1, vector: vec(22) },
  ];
  const query = blend(vec(98), art, 0.97);
  const { indexSize, rows } = await injectedSource(catalog)(query, CURRENT_STAMP, 5);
  const res = buildResponse(CURRENT_STAMP, indexSize, rows);

  assert.equal(res.identity.level, 'uncertain');
  assert.ok((res.identity.margin ?? 1) < 0.05);
});

test('a query unlike everything indexed is `none`, and names no card', async () => {
  // The nine ground-truth frames whose card has no catalogue art are exactly
  // this case, and dHash answered all nine with a card. This is the property
  // that must not regress.
  const catalog: CatalogEntry[] = [
    { cardId: 'me04-024', variantCount: 1, vector: vec(30) },
    { cardId: 'me04-025', variantCount: 1, vector: vec(31) },
  ];
  const { indexSize, rows } = await injectedSource(catalog)(vec(4242), CURRENT_STAMP, 5);
  const res = buildResponse(CURRENT_STAMP, indexSize, rows);

  assert.equal(res.identity.level, 'none');
  assert.equal(res.identity.cardId, null);
  // The score is still reported: "0.11, rejected" is debuggable, "no match" is not.
  assert.ok(Number.isFinite(res.identity.similarity));
  // And the candidates are still returned, because a `none` verdict is the
  // system declining to claim, not the system refusing to show its work.
  assert.equal(res.matches.length, 2);
});

test('identity and variant are separate, and a multi-printing card must ask', async () => {
  // The ruling, executed: the system may be certain about the card and still
  // have nothing to say about the printing, and in that state the reader
  // decides. There is deliberately no field on this response that blends them.
  const target = vec(40);
  const catalog: CatalogEntry[] = [
    { cardId: 'me05-025', variantCount: 3, vector: target },
    { cardId: 'me05-026', variantCount: 1, vector: vec(41) },
  ];
  const query = blend(vec(97), target, 0.98);
  const { indexSize, rows } = await injectedSource(catalog)(query, CURRENT_STAMP, 5);
  const res = buildResponse(CURRENT_STAMP, indexSize, rows);

  assert.equal(res.identity.level, 'confident');
  assert.equal(res.variant.level, 'unknown');
  assert.equal(res.variant.requiresUserChoice, true);
  assert.equal('confidence' in res, false, 'the response must not carry a blended confidence');
  assert.equal('matched' in res, false, 'the response must not carry a matched boolean');
});

test('a single-printing card does not ask, and says so as a field', async () => {
  const target = vec(50);
  const catalog: CatalogEntry[] = [{ cardId: 'me04-019', variantCount: 1, vector: target }];
  const query = blend(vec(96), target, 0.99);
  const { indexSize, rows } = await injectedSource(catalog)(query, CURRENT_STAMP, 5);
  const res = buildResponse(CURRENT_STAMP, indexSize, rows);

  assert.equal(res.variant.requiresUserChoice, false);
  // One candidate can never be confident — there is no runner-up to be better
  // than, and `null` margin says so rather than standing in for a large one.
  assert.equal(res.identity.margin, null);
  assert.equal(res.identity.level, 'uncertain');
});

test('the variant question is asked about the card identity named, not the top row', async () => {
  // When identity declines, `cardId` is null and the variant block must not
  // quietly answer about whatever happened to rank first.
  const catalog: CatalogEntry[] = [{ cardId: 'sv01-001', variantCount: 4, vector: vec(60) }];
  const { indexSize, rows } = await injectedSource(catalog)(vec(7777), CURRENT_STAMP, 5);
  const res = buildResponse(CURRENT_STAMP, indexSize, rows);

  assert.equal(res.identity.cardId, null);
  assert.equal(res.variant.requiresUserChoice, false);
});

test('the response names the vector space that answered', async () => {
  const catalog: CatalogEntry[] = [{ cardId: 'x-1', variantCount: 1, vector: vec(70) }];
  const { indexSize, rows } = await injectedSource(catalog)(vec(70), CURRENT_STAMP, 5);
  const res = buildResponse(CURRENT_STAMP, indexSize, rows);
  assert.equal(res.stamp, CURRENT_STAMP);
  assert.match(res.stamp, /^e\d+:/);
});
