import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOverlay, resolveReleasePriceLink,
  type ReleaseSetOverlay,
} from '../releasePriceLinks.js';
import { planCardVariants, type RawCard, type Facet } from '../transform.js';

// ── fixtures ─────────────────────────────────────────────────────────────────
// A canonical zero-variant 30th-001 Exeggcute, the shape planCardVariants turns
// into the single synthesized singleton variant the overlay is allowed to fill.
function exeggcute(): RawCard {
  return {
    id: '30th-001', set: { id: '30th' }, localId: '001',
    name: 'Exeggcute', category: 'Pokemon',
  };
}
function resolve(
  card: RawCard,
  opts: {
    language?: string; setId?: string; groupId?: number | null;
    variant?: ReturnType<typeof planCardVariants>['variants'][number];
    variantCount?: number;
  } = {},
) {
  const plan = planCardVariants(card);
  return resolveReleasePriceLink({
    language: opts.language ?? 'en',
    setId: opts.setId ?? card.set.id,
    groupId: opts.groupId ?? null,
    card,
    variant: opts.variant ?? plan.variants[0]!,
    variantCount: opts.variantCount ?? plan.variants.length,
  });
}

// ── overlay registry ─────────────────────────────────────────────────────────

test('30th main overlay exists with correct group id and 158 links', () => {
  const ov = getOverlay('30th')!;
  assert.ok(ov);
  assert.equal(ov.setId, '30th');
  assert.equal(ov.groupId, 24722);
  assert.equal(ov.links.size, 158);
});

test('30th-c classic overlay exists with correct group id and 30 links', () => {
  const ov = getOverlay('30th-c')!;
  assert.ok(ov);
  assert.equal(ov.setId, '30th-c');
  assert.equal(ov.groupId, 24837);
  assert.equal(ov.links.size, 30);
});

test('absent set returns undefined — no cross-contamination', () => {
  assert.equal(getOverlay('sv01'), undefined);
  assert.equal(getOverlay('base1'), undefined);
  assert.equal(getOverlay('30th-x'), undefined);
  assert.equal(getOverlay(''), undefined);
});

// ── canonical match (resolver/plan boundary) ─────────────────────────────────

test('known canonical 30th-001 Exeggcute synthesized singleton -> 716435 Holofoil', () => {
  const r = resolve(exeggcute());
  assert.deepEqual(r, { groupId: 24722, productId: 716435, printing: 'Holofoil' });
});

test('every main card resolves to its pinned productId across the full 158', () => {
  const ov = getOverlay('30th')!;
  for (const link of ov.links.values()) {
    const card: RawCard = {
      id: link.cardId, set: { id: '30th' }, localId: link.localId,
      name: link.cardName, category: 'Pokemon',
    };
    const r = resolve(card);
    assert.equal(r?.groupId, 24722);
    assert.equal(r?.productId, link.productId);
    assert.equal(r?.printing, 'Holofoil');
  }
});

test('every classic card resolves to its pinned productId across the full 30', () => {
  const ov = getOverlay('30th-c')!;
  for (const link of ov.links.values()) {
    const card: RawCard = {
      id: link.cardId, set: { id: '30th-c' }, localId: link.localId,
      name: link.cardName, category: 'Pokemon',
    };
    const r = resolve(card, { setId: '30th-c' });
    assert.equal(r?.groupId, 24837);
    assert.equal(r?.productId, link.productId);
    assert.equal(r?.printing, 'Holofoil');
  }
});

// ── identity refusals ─────────────────────────────────────────────────────────

test('refuses wrong card name (Charizard on 30th-001 slot)', () => {
  const card = { ...exeggcute(), name: 'Charizard' };
  assert.equal(resolve(card), null);
});

test('refuses wrong local collector number (158 on 30th-001 slot)', () => {
  const card = { ...exeggcute(), localId: '158' };
  assert.equal(resolve(card), null);
});

test('refuses when card.set.id disagrees with setId (canonical vs provided set)', () => {
  const card = { ...exeggcute(), set: { id: 'base1' } };
  assert.equal(resolve(card), null);
});

test('refuses wrong language (fr)', () => {
  assert.equal(resolve(exeggcute(), { language: 'fr' }), null);
});

test('refuses when setId is not a covered set', () => {
  assert.equal(resolve(exeggcute(), { setId: 'base1' }), null);
});

// ── authority / precedence refusals ──────────────────────────────────────────

test('refuses when upstream groupId conflicts with overlay group', () => {
  assert.equal(resolve(exeggcute(), { groupId: 9999 }), null);
});

test('allows when upstream groupId matches the overlay group', () => {
  const r = resolve(exeggcute(), { groupId: 24722 });
  assert.equal(r?.productId, 716435);
});

test('refuses when the variant already carries an upstream product id', () => {
  const plan = planCardVariants(exeggcute());
  const variant = { ...plan.variants[0]!, tcgplayerProductId: 9999 };
  assert.equal(resolve(exeggcute(), { variant }), null);
});

// ── variant shape refusals ────────────────────────────────────────────────────

test('refuses multiple variants (ambiguous)', () => {
  assert.equal(resolve(exeggcute(), { variantCount: 2 }), null);
  assert.equal(resolve(exeggcute(), { variantCount: 3 }), null);
});

test('refuses a real holo (non-synthesized) variant facet', () => {
  const plan = planCardVariants(exeggcute());
  const holoFacet: Facet = { finish: 'holo', subtype: null, size: 'standard', foil: null, stamps: [] };
  const variant = { ...plan.variants[0]!, isSynthesized: false, facet: holoFacet };
  assert.equal(resolve(exeggcute(), { variant }), null);
});

test('refuses a non-synthesized variant even with the canonical facet', () => {
  const plan = planCardVariants(exeggcute());
  // canonical facet but flagged as a REAL (non-synthesized) upstream variant
  // with no explicit generated marker — must be refused.
  const variant = { ...plan.variants[0]!, isSynthesized: false };
  assert.equal(resolve(exeggcute(), { variant }), null);
});

test('accepts a real upstream variant with the explicit generated variantId + canonical facet', () => {
  const plan = planCardVariants(exeggcute());
  // The actual TCGdex upstream publishes a real (non-synthesized) variant with
  // variantId 'generated' and the canonical facet — explicitly supported.
  const variant = { ...plan.variants[0]!, isSynthesized: false, tcgdexVariantId: 'generated' };
  const r = resolve(exeggcute(), { variant });
  assert.equal(r?.productId, 716435);
});

test('refuses a real normal variant whose variantId is not the generated marker', () => {
  const plan = planCardVariants(exeggcute());
  // A future real normal variant without the 'generated' marker is refused —
  // the resolver does not accept arbitrary real normal variants.
  const variant = { ...plan.variants[0]!, isSynthesized: false, tcgdexVariantId: 'hgss' };
  assert.equal(resolve(exeggcute(), { variant }), null);
});

test('refuses reverse holo with a promo stamp (unsupported printing)', () => {
  const plan = planCardVariants(exeggcute());
  const stampedFacet: Facet = { finish: 'reverse', subtype: null, size: 'standard', foil: null, stamps: ['promo'] };
  const variant = { ...plan.variants[0]!, isSynthesized: false, facet: stampedFacet };
  assert.equal(resolve(exeggcute(), { variant }), null);
});

test('refuses an oversize (jumbo) variant', () => {
  const plan = planCardVariants(exeggcute());
  const jumboFacet: Facet = { finish: 'normal', subtype: null, size: 'jumbo', foil: null, stamps: [] };
  const variant = { ...plan.variants[0]!, facet: jumboFacet };
  assert.equal(resolve(exeggcute(), { variant }), null);
});

test('refuses a subtype-stamped canonical-shape variant', () => {
  const plan = planCardVariants(exeggcute());
  const faceted: Facet = { finish: 'normal', subtype: 'unlimited', size: 'standard', foil: null, stamps: [] };
  const variant = { ...plan.variants[0]!, facet: faceted };
  assert.equal(resolve(exeggcute(), { variant }), null);
});

// ── unrelated no-op ───────────────────────────────────────────────────────────

test('a card from an unrelated set is a clean no-op (null)', () => {
  const svCard: RawCard = {
    id: 'sv01-001', set: { id: 'sv01' }, localId: '001', name: 'Sprigatito', category: 'Pokemon',
  };
  assert.equal(resolve(svCard), null);
});

// ── idempotence ───────────────────────────────────────────────────────────────

test('resolving twice yields identical, stable results', () => {
  const r1 = resolve(exeggcute());
  const r2 = resolve(exeggcute());
  assert.deepEqual(r1, r2);
});

// ── exclusions ────────────────────────────────────────────────────────────────

test('Mew RGB products have no overlay entry (no catalog equivalent)', () => {
  const ov = getOverlay('30th')!;
  for (const cardId of ['30th-R', '30th-G', '30th-B']) {
    assert.equal(ov.links.get(cardId), undefined);
  }
});

test('sealed product ids are absent from the overlay', () => {
  const ov = getOverlay('30th')!;
  // 696613 = 30th Celebration Booster Pack, 704143 = ETB (sealed, Normal-priced)
  const sealed = [696613, 704143, 704144, 704148, 709016];
  const ids = new Set<number>();
  for (const l of ov.links.values()) ids.add(l.productId);
  for (const s of sealed) assert.ok(!ids.has(s), `sealed pid ${s} must not be present`);
});

test('30th-126 "Poké Pad" resolves via NFKD combining-mark removal (accent equivalence)', () => {
  const ov = getOverlay('30th')!;
  assert.equal(ov.links.has('30th-126'), true);
  // The actual accented canonical TCGdex name resolves to product 716515
  // ("Poke Pad" in TCGCSV) — the resolver's normalizeCardName drops the
  // combining mark via NFKD, so the accented and de-accented names fold equal.
  const card: RawCard = {
    id: '30th-126', set: { id: '30th' }, localId: '126', name: 'Poké Pad', category: 'Pokemon',
  };
  assert.deepEqual(resolve(card), { groupId: 24722, productId: 716515, printing: 'Holofoil' });
  // A wrong name at the same slot is still refused — the guard is not relaxed.
  assert.equal(resolve({ ...card, name: 'Switch' }), null);
});

// ── integrity of the registry ─────────────────────────────────────────────────

test('all product ids in each overlay are unique', () => {
  for (const setId of ['30th', '30th-c'] as const) {
    const ov = getOverlay(setId)!;
    const seen = new Set<number>();
    for (const l of ov.links.values()) {
      assert.ok(!seen.has(l.productId), `dup productId ${l.productId} in ${setId}`);
      seen.add(l.productId);
    }
  }
});

test('no product id overlap between the two overlays', () => {
  const main = new Set<number>();
  for (const l of getOverlay('30th')!.links.values()) main.add(l.productId);
  for (const l of getOverlay('30th-c')!.links.values()) {
    assert.ok(!main.has(l.productId), `productId ${l.productId} in both overlays`);
  }
});

test('30th overlay covers all 158 sequential card ids', () => {
  const ov = getOverlay('30th')!;
  for (let i = 1; i <= 158; i++) {
    assert.ok(ov.links.has(`30th-${String(i).padStart(3, '0')}`));
  }
  assert.equal(ov.links.size, 158);
});

test('30th-c overlay covers exactly the 30 sequential card ids', () => {
  const ov = getOverlay('30th-c')!;
  for (let i = 1; i <= 30; i++) {
    assert.ok(ov.links.has(`30th-c-${String(i).padStart(3, '0')}`));
  }
  assert.equal(ov.links.size, 30);
});

// ── explicit Nidoran♀ normalization ───────────────────────────────────────────

test('Nidoran♀ (TCGdex) resolves and is the allowed name mismatch', () => {
  const card: RawCard = {
    id: '30th-087', set: { id: '30th' }, localId: '087',
    name: 'Nidoran♀', category: 'Pokemon',
  };
  assert.equal(resolve(card)?.productId, 716483);
});

test('a wrong name that merely shares the collector number is still refused', () => {
  const card: RawCard = {
    id: '30th-087', set: { id: '30th' }, localId: '087',
    name: 'Nidoran♂', category: 'Pokemon', // wrong gender glyph
  };
  assert.equal(resolve(card), null);
});

// ── LEGEND halves distinguished by positive evidence ──────────────────────────

test('30th-c-019 (Top, no attacks) -> 716199; 30th-c-020 (Bottom, has attacks) -> 716200', () => {
  const top: RawCard = {
    id: '30th-c-019', set: { id: '30th-c' }, localId: '019',
    name: 'Darkrai & Cresselia LEGEND', category: 'Pokemon',
  };
  const bottom: RawCard = {
    id: '30th-c-020', set: { id: '30th-c' }, localId: '020',
    name: 'Darkrai & Cresselia LEGEND', category: 'Pokemon',
  };
  assert.equal(resolve(top, { setId: '30th-c' })?.productId, 716199);
  assert.equal(resolve(bottom, { setId: '30th-c' })?.productId, 716200);
});
