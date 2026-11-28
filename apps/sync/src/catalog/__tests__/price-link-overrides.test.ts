import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERRIDES, PRICE_LINK_OVERRIDES, checkOverride, indexOverrides, overrideCardIds, overrideVariantLink,
  type PriceLinkOverride, type VariantLink,
} from '../priceLinkOverrides.js';
import { planCardVariants, type RawCard } from '../transform.js';
import { applyLinkOverrides, linkTcgcsvProducts } from '../../prices/linkTcgcsv.js';
import { ingestTcgcsvPrices } from '../../prices/tcgcsv.js';

// ── the table itself ─────────────────────────────────────────────────────────

test('the shipped table indexes cleanly: one entry per printing, no two on one (product, printing)', () => {
  assert.equal(OVERRIDES.size, PRICE_LINK_OVERRIDES.length);
  const targets = new Set(PRICE_LINK_OVERRIDES.map((o) => `${o.productId}|${o.printing}`));
  assert.equal(targets.size, PRICE_LINK_OVERRIDES.length);
});

test('every entry is complete: a TCGplayer printing name, real ids, a pinned identity and evidence', () => {
  for (const o of PRICE_LINK_OVERRIDES) {
    const at = `${o.cardId} ${o.kind}`;
    assert.ok(['Normal', 'Holofoil', 'Reverse Holofoil'].includes(o.printing), `${at}: printing ${o.printing}`);
    assert.ok(Number.isSafeInteger(o.productId) && o.productId > 0, at);
    assert.ok(Number.isSafeInteger(o.groupId) && o.groupId > 0, at);
    assert.ok(o.cardId.startsWith(`${o.setId}-`), `${at}: card id belongs to ${o.setId}`);
    assert.equal(o.cardId, `${o.setId}-${o.localId}`, `${at}: pinned number is the card's`);
    assert.ok(o.cardName.trim().length > 0 && o.evidence.trim().length > 0, at);
  }
});

test('the corrections the table exists for are in it', () => {
  const get = (card: string, kind: string) => OVERRIDES.get(`${card}|${kind}`);
  // a wrong upstream id replaced
  assert.equal(get('ecard2-50b', 'normal')?.productId, 85814);
  assert.equal(get('ecard2-50b', 'normal')?.was, 85813);
  assert.equal(get('cel25cc-CC020', 'holo-stamp-25th-celebration')?.productId, 250337);
  assert.equal(get('mfb-34', 'normal-stamp-pikachu')?.productId, 524035);
  assert.equal(get('tk-sm-r-2', 'normal')?.productId, 152851);
  // a missing one filled
  assert.equal(get('tk-xy-n-29', 'normal')?.productId, 98024);
  assert.equal(get('tk-hs-g-20', 'normal')?.was, null);
  // a printing corrected on the right product
  assert.deepEqual([get('sm10-195a', 'normal')?.productId, get('sm10-195a', 'normal')?.printing], [216699, 'Holofoil']);
  // printings TCGplayer does not list stay out
  for (const card of ['mep-064', 'mep-067', 'mep-074', 'mep-075', 'mep-076', 'mep-077', 'mep-120', 'svp-190', 'det1-25']) {
    assert.ok(!overrideCardIds(OVERRIDES).includes(card), `${card} must not be linked`);
  }
});

const entry = (over: Partial<PriceLinkOverride> = {}): PriceLinkOverride => ({
  cardId: 'fx-1', setId: 'fx', localId: '1', cardName: 'Foo', kind: 'normal',
  groupId: 1, productId: 100, printing: 'Normal', was: null, evidence: '"Foo" 1/10', ...over,
});

test('indexing refuses a printing listed twice, and two printings on one (product, printing)', () => {
  assert.throws(() => indexOverrides([entry(), entry({ productId: 101 })]), /listed twice/);
  assert.throws(() => indexOverrides([entry(), entry({ cardId: 'fx-2', localId: '2' })]), /both target 100\|Normal/);
  // The same product under another printing is a different price row: allowed.
  assert.doesNotThrow(() => indexOverrides([entry(), entry({ kind: 'reverse', printing: 'Reverse Holofoil' })]));
});

// ── the importer's boundary ──────────────────────────────────────────────────

// ecard2-50b as TCGdex ships it: both printings carry its twin 50a's product.
function golduck50b(): RawCard {
  return {
    id: 'ecard2-50b', set: { id: 'ecard2' }, localId: '50b', name: 'Golduck', category: 'Pokemon',
    variants_detailed: [
      { type: 'normal', size: 'standard', variantId: 'a', thirdParty: { tcgplayer: 85813 } },
      { type: 'reverse', size: 'standard', variantId: 'b', thirdParty: { tcgplayer: 85813 } },
    ],
  };
}
const link = (v: ReturnType<typeof planCardVariants>['variants'][number]): VariantLink => ({
  productId: v.tcgplayerProductId, printing: v.tcgplayerPrinting, idSource: v.idSource, idConfidence: v.idConfidence,
});
const importLink = (card: RawCard, kind: string, setId = card.set.id, language = 'en') => {
  const v = planCardVariants(card).variants.find((x) => x.code === kind)!;
  return overrideVariantLink(OVERRIDES, { language, setId, card, kind }, link(v));
};

test('import: an override wins over a wrong upstream id, printing by printing', () => {
  const n = importLink(golduck50b(), 'normal');
  assert.equal(n.check?.applies, true);
  assert.deepEqual(n.link, { productId: 85814, printing: 'Normal', idSource: 'variant', idConfidence: 100 });
  const r = importLink(golduck50b(), 'reverse');
  assert.deepEqual(n.link.productId, r.link.productId);
  assert.equal(r.link.printing, 'Reverse Holofoil');
});

test('import: an override fills a printing upstream has no id for', () => {
  // tk-xy-n-29 Switch: no variants and no ids upstream, so the plan synthesizes a bare normal.
  const card: RawCard = { id: 'tk-xy-n-29', set: { id: 'tk-xy-n' }, localId: '29', name: 'Switch', category: 'Trainer' };
  assert.equal(planCardVariants(card).variants[0]!.tcgplayerProductId, null);
  const r = importLink(card, 'normal');
  assert.deepEqual(r.link, { productId: 98024, printing: 'Normal', idSource: 'variant', idConfidence: 100 });
});

test('import: accented and curly-quoted catalog names still match their pinned name', () => {
  const card: RawCard = { id: 'tk-xy-n-24', set: { id: 'tk-xy-n' }, localId: '24', name: 'Professor’s Letter', category: 'Trainer' };
  assert.equal(importLink(card, 'normal').link.productId, 98021);
  const ball: RawCard = { id: 'tk-xy-sy-26', set: { id: 'tk-xy-sy' }, localId: '26', name: 'Poké Ball', category: 'Trainer' };
  assert.equal(importLink(ball, 'normal').link.productId, 97991);
});

test('import: an override never applies to another card or printing, and upstream is kept untouched', () => {
  const upstreamOf = (card: RawCard, kind: string) => link(planCardVariants(card).variants.find((x) => x.code === kind)!);
  // The twin: same set, same name, a different card. It has no entry, so TCGdex's id stands.
  const golduck50a: RawCard = { ...golduck50b(), id: 'ecard2-50a', localId: '50a' };
  const twin = importLink(golduck50a, 'normal');
  assert.equal(twin.check, null);
  assert.deepEqual(twin.link, upstreamOf(golduck50a, 'normal'));
  assert.equal(twin.link.productId, 85813);

  // Upstream renamed the card, re-numbered it, or moved it to another set: refused, upstream kept.
  const cases: [RawCard, string, RegExp][] = [
    [{ ...golduck50b(), name: 'Psyduck' }, 'ecard2', /name is "Psyduck"/],
    [{ ...golduck50b(), localId: '51b' }, 'ecard2', /number is 51b/],
    [golduck50b(), 'ecard3', /set is ecard3/],
  ];
  for (const [card, setId, why] of cases) {
    const r = importLink(card, 'normal', setId);
    assert.equal(r.check?.applies, false);
    assert.match((r.check as { refused: string }).refused, why);
    assert.deepEqual(r.link, upstreamOf(card, 'normal'), 'the upstream link is returned as it was');
  }
  // A printing the card has that the table does not name.
  const holo: RawCard = { ...golduck50b(), variants_detailed: [{ type: 'holo', size: 'standard', variantId: 'h', thirdParty: { tcgplayer: 5 } }] };
  assert.equal(importLink(holo, 'holo').check, null);
  assert.equal(importLink(holo, 'holo').link.productId, 5);
  // Another language's catalog.
  assert.equal(importLink(golduck50b(), 'normal', 'ecard2', 'fr').check?.applies, false);
});

test('checkOverride is null for a card the table does not name at all', () => {
  assert.equal(checkOverride(OVERRIDES, { language: 'en', setId: 'sv01', cardId: 'sv01-001', localId: '001', name: 'Sprigatito', kind: 'normal' }), null);
});

// ── the link pass ────────────────────────────────────────────────────────────

interface FakeVariant { vid: number; card: string; local_id: string; name: string; set_id: string; kind: string; pid: number | null; printing: string | null; url: string | null }

/** Answers only the queries the link pass makes; records every UPDATE. */
function linkClient(variants: FakeVariant[], opts: { sets?: { id: string; tcgdex_id: string; g: number | null }[] } = {}) {
  const updates: unknown[][] = [];
  const statements: string[] = [];
  return {
    updates, statements,
    async query(text: string, params: unknown[] = []) {
      statements.push(text.trim().split(/\s+/)[0]!);
      if (text.includes('c.tcgdex_id = ANY($1::text[])')) {
        const ids = params[0] as string[];
        const filter = params[1] as string[] | null;
        return { rows: variants.filter((v) => ids.includes(v.card) && (!filter || filter.includes(v.set_id))).map((v) => ({ ...v, vid: String(v.vid) })) };
      }
      if (text.includes('UPDATE card_variant cv') && text.includes("id_source            = 'variant'")) {
        updates.push(params);
        const ids = params[0] as number[];
        for (const [i, id] of ids.entries()) {
          const v = variants.find((x) => x.vid === id)!;
          v.pid = (params[1] as number[])[i]!; v.printing = (params[2] as string[])[i]!; v.url = null;
        }
        return { rows: ids.map((id) => ({ id: String(id) })) };
      }
      if (text.includes('FROM card_set s') && text.includes('ORDER BY s.id')) return { rows: opts.sets ?? [] };
      if (text.includes('FROM card c JOIN card_variant cv')) {
        return {
          rows: variants.map((v) => ({
            card_id: String(v.vid), local_id: v.local_id, name: v.name, vid: String(v.vid), kind: v.kind, pid: v.pid, printing: v.printing,
          })),
        };
      }
      return { rows: [] };
    },
  };
}

const fx = (over: Partial<FakeVariant> = {}): FakeVariant => ({
  vid: 1, card: 'fx-1', local_id: '1', name: 'Foo', set_id: 'fx', kind: 'normal', pid: null, printing: null, url: null, ...over,
});

test('link pass: overrides are written over a wrong id and into a NULL, with the stored URL cleared', async () => {
  const index = indexOverrides([
    entry({ cardId: 'fx-1', localId: '1', cardName: 'Foo', productId: 100, was: 99 }),
    entry({ cardId: 'fx-2', localId: '2', cardName: 'Bar', productId: 200 }),
  ]);
  const c = linkClient([
    fx({ vid: 1, pid: 99, printing: 'Normal', url: 'https://www.tcgplayer.com/product/99/old' }),
    fx({ vid: 2, card: 'fx-2', local_id: '2', name: 'Bar' }),
  ]);
  const r = await applyLinkOverrides(c as never, index, null, false);
  assert.equal(r.applied, 2);
  assert.deepEqual(r.refused, []);
  assert.deepEqual(c.updates[0], [[1, 2], [100, 200], ['Normal', 'Normal']]);

  // B8: a second run finds every row already right and writes nothing.
  const again = await applyLinkOverrides(c as never, index, null, false);
  assert.equal(again.applied, 0);
  assert.equal(c.updates.length, 1);
});

test('link pass: an override is refused for a renamed or re-numbered card, and never touches another card', async () => {
  const index = indexOverrides([entry({ cardId: 'fx-1', localId: '1', cardName: 'Foo', productId: 100 })]);
  const c = linkClient([
    fx({ vid: 1, name: 'Not Foo', pid: 5, printing: 'Normal' }),
    fx({ vid: 2, card: 'fx-9', local_id: '1', name: 'Foo', pid: 6, printing: 'Normal' }), // same number+name, other card
  ]);
  const r = await applyLinkOverrides(c as never, index, null, false);
  assert.equal(r.applied, 0);
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0]!.reason, /name is "Not Foo"/);
  assert.deepEqual(c.updates, [], 'nothing written');
  assert.equal(r.values.size, 0);
});

test('link pass: a dry run reports the override and writes nothing', async () => {
  const index = indexOverrides([entry({ productId: 100 })]);
  const c = linkClient([fx({ pid: 99, printing: 'Normal' })]);
  const r = await applyLinkOverrides(c as never, index, null, true);
  assert.equal(r.applied, 1);
  assert.deepEqual(c.updates, []);
  assert.deepEqual(r.values.get(1), { productId: 100, printing: 'Normal' });
});

test('link pass: a --sets run only overrides inside those sets', async () => {
  const index = indexOverrides([entry({ productId: 100 })]);
  const c = linkClient([fx({ pid: 99, printing: 'Normal' })]);
  const r = await applyLinkOverrides(c as never, index, ['other'], false);
  assert.equal(r.applied, 0);
  assert.deepEqual(c.updates, []);
});

test('link pass: the planner sees an override as the row\'s link, so it neither re-plans the row nor reuses its product', async () => {
  // fx-1 is NULL upstream and its number+name would plainly match product 7; the override says 100.
  // fx-3's number+name match product 100 itself, which the override now owns. fx-2 is ordinary.
  const index = indexOverrides([entry({ productId: 100 })]);
  const c = linkClient(
    [
      fx({ vid: 1 }),
      fx({ vid: 2, card: 'fx-2', local_id: '2', name: 'Bar' }),
      fx({ vid: 3, card: 'fx-3', local_id: '3', name: 'Baz' }),
    ],
    { sets: [{ id: '1', tcgdex_id: 'fx', g: 1 }] },
  );
  const product = (productId: number, name: string, number: string) =>
    ({ productId, name, extendedData: [{ name: 'Number', value: number }] });
  const r = await linkTcgcsvProducts(c as never, {
    dryRun: true, overrides: index,
    loadGroupData: async () => ({
      products: [product(7, 'Foo - 1/10', '1/10'), product(8, 'Bar - 2/10', '2/10'), product(100, 'Baz - 3/10', '3/10')] as never,
      prices: [7, 8, 100].map((productId) => ({ productId, subTypeName: 'Normal' })) as never,
    }),
  });
  assert.equal(r.overridesApplied, 1);
  assert.equal(r.variantsLinked, 1, 'only fx-2 is linked: fx-1 holds its override, and its product is not handed to fx-3');
  assert.deepEqual(r.perSet[0]!.skipped, { 'duplicate-target': 1 });
});

// ── the price ingest ─────────────────────────────────────────────────────────

test('price ingest: an override product outside its set\'s group is priced from that group, and only that product', async () => {
  const fetched: number[] = [];
  let pricedPids: number[] | null = null;
  const client = {
    async query(text: string, params: unknown[] = []) {
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (text.includes('INSERT INTO sync_run')) return { rows: [{ id: '1' }] };
      if (text.includes('SELECT DISTINCT o.g, o.pid')) return { rows: [{ g: 1938, pid: 216699 }] };
      if (text.includes('FROM card_variant WHERE tcgplayer_product_id = ANY')) {
        pricedPids = params[0] as number[];
        return { rows: [{ id: '42', pid: 216699, printing: 'Holofoil' }] };
      }
      return { rows: [] };
    },
  };
  const r = await ingestTcgcsvPrices(client as never, { link: false }, {
    fetchLastUpdated: async () => '2026-11-27T20:05:00Z',
    fetchGroupPrices: async (g) => {
      fetched.push(g);
      const row = (productId: number, marketPrice: number) =>
        ({ productId, subTypeName: 'Holofoil', marketPrice, lowPrice: null, midPrice: null, highPrice: null, directLowPrice: null });
      return g === 1938 ? [row(216699, 19.34), row(133816, 2.24) /* same group, not an override's */] : [];
    },
  });
  assert.deepEqual(fetched, [22880, 1938], 'the Prize Pack group, then the override\'s own group');
  assert.deepEqual(pricedPids, [216699], 'only the override\'s product is priced from that group');
  assert.ok(r.pricedVariants >= 1);
});
