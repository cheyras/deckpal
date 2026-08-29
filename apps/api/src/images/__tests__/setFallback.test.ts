import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseImagePath, type ParsedImage } from '@deckpal/storage';
import { resolveSourceFromManifest } from '../handler.js';

/**
 * Pure tests for the set-imagery fallback resolution order — no DB, no network.
 *
 * `resolveSourceFromManifest` is the pure core of `resolveSourceUrl`: given an
 * asset and its manifest row (or null), it decides which upstream URL to fetch
 * from, or null when none exists. The order it enforces is the contract this
 * suite pins:
 *
 *   1. a recorded `source_url` always wins (over the crosswalk, over the card
 *      derivation, over everything);
 *   2. a set asset with NO recorded source falls back to the approved crosswalk
 *      (`setImageFallbackUrl`, 43 curated (setId, kind) → sourceUrl pairs);
 *   3. a set asset the crosswalk does not know resolves to null — the honest dead
 *      end, which the handler answers with a SHORT-ttl 404 so it self-heals;
 *   4. card behaviour is unchanged: no recorded source → the canonical TCGdex
 *      derivation (DATA-LAYER §5.3), never the crosswalk.
 *
 * Run: node --import tsx --test src/images/__tests__/setFallback.test.ts
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a set image path and narrow to the `set` variant, or throw — the test
 * data below is hand-picked, so a parse failure is a bug in the test, not the SUT.
 */
function setAsset(setId: string, kind: 'logo' | 'symbol'): ParsedImage {
  const r = parseImagePath(`sets/${setId}/${kind}.webp`);
  assert.ok(r.ok && r.asset.kind === 'set', `expected a set asset for sets/${setId}/${kind}.webp`);
  return r.asset;
}

/**
 * The `card` variant of `ParsedImage`. `parseCard` asserts `kind === 'card'`
 * before returning, so the cast is safe. Exposed so tests can reach
 * `canonicalSourceUrl` without a runtime narrowing assertion each time.
 */
type CardAsset = Extract<ParsedImage, { kind: 'card' }>;

/** Parse a card path, assert it is a card, and return it as the narrowed type. */
function parseCard(path: string): CardAsset {
  const r = parseImagePath(path);
  assert.ok(r.ok && r.asset.kind === 'card', `expected a card asset for ${path}`);
  return r.asset as CardAsset;
}

// ── Resolution order ──────────────────────────────────────────────────────────

describe('resolveSourceFromManifest — set imagery fallback', () => {
  // A (setId, kind) that IS in the crosswalk (setImageFallbackUrl returns a URL).
  const me02Symbol = setAsset('me02', 'symbol');
  const sv05Logo = setAsset('sv05', 'logo');
  // A (setId, kind) that is NOT in the crosswalk (setImageFallbackUrl returns null).
  const unknownLogo = setAsset('xy1', 'logo');

  test('a recorded source_url wins over the crosswalk', () => {
    const recorded = 'https://example.test/recorded-source.png';
    const result = resolveSourceFromManifest(me02Symbol, { source_url: recorded });
    assert.ok(result !== null, 'a recorded source_url must resolve, not null');
    assert.equal(result.url, recorded);
    assert.equal(result.provenanceWasUnknown, false);
  });

  test('a set asset with no recorded source falls back to the crosswalk URL', () => {
    // No row at all — the crosswalk is the only source.
    const r1 = resolveSourceFromManifest(me02Symbol, null);
    assert.ok(r1 !== null, 'a crosswalk-known set with no row must resolve, not null');
    assert.equal(r1.url, 'https://images.pokemontcg.io/me2/symbol.png');
    assert.equal(r1.provenanceWasUnknown, true);

    // Row exists but source_url is NULL — same situation, crosswalk wins.
    const r2 = resolveSourceFromManifest(sv05Logo, { source_url: null });
    assert.ok(r2 !== null, 'a crosswalk-known set with a null source_url must resolve');
    assert.equal(r2.url, 'https://images.pokemontcg.io/sv5/logo.png');
    assert.equal(r2.provenanceWasUnknown, true);
  });

  test('a set asset the crosswalk does not know still resolves to null', () => {
    const result = resolveSourceFromManifest(unknownLogo, null);
    assert.equal(result, null, 'an unknown set with no row is a genuine dead end');
  });

  test('a set the crosswalk does not know with a recorded source still uses it', () => {
    // Even a set not in the crosswalk resolves when the manifest has a source_url.
    // This proves the crosswalk is a FALLBACK, never a replacement for provenance.
    const recorded = 'https://example.test/xy1-logo.png';
    const result = resolveSourceFromManifest(unknownLogo, { source_url: recorded });
    assert.ok(result !== null);
    assert.equal(result.url, recorded);
    assert.equal(result.provenanceWasUnknown, false);
  });
});

// ── Card behaviour is unchanged ───────────────────────────────────────────────

describe('resolveSourceFromManifest — card behaviour is unchanged', () => {
  const card = parseCard('en/sv/sv03.5/102/low.webp');

  test('a card with no recorded source falls back to the canonical derivation', () => {
    const result = resolveSourceFromManifest(card, null);
    assert.ok(result !== null, 'a card with no row must resolve via the derivation');
    assert.equal(result.url, card.canonicalSourceUrl);
    assert.equal(result.provenanceWasUnknown, true);
  });

  test('a card with a recorded source uses it (never the crosswalk)', () => {
    const recorded = 'https://example.test/card-art.webp';
    const result = resolveSourceFromManifest(card, { source_url: recorded });
    assert.ok(result !== null);
    assert.equal(result.url, recorded);
    assert.equal(result.provenanceWasUnknown, false);
  });

  test('a card with a null source_url falls back to the derivation', () => {
    const result = resolveSourceFromManifest(card, { source_url: null });
    assert.ok(result !== null);
    assert.equal(result.url, card.canonicalSourceUrl);
    assert.equal(result.provenanceWasUnknown, true);
  });
});
