import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type pg from 'pg';
import type { Request, Response } from 'express';
import { rlsStore } from '../../db.js';
import { decksRouter } from '../../routes/decks.js';
import { exportRouter } from '../../export/router.js';

const deckId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const group = 'same-gameplay-text';

// Both selected prints can use the sole owned equivalent. Their page query
// sorts the tie by variant sort order; the PDF query has no final tie breaker.
const card = (id: number, set: string) => ({
  card_id: String(id), card_variant_id: String(id), quantity: 1, pin_exact: false,
  format_code: 'unlimited', variant_kind_code: 'normal', variant_display: 'Normal',
  variant_kind_display: 'Normal', variant_tier: null, variant_is_primary: true,
  tcgdex_id: `${set}-1`, local_id: '1', local_id_numeric: 1, number_sort: '0001',
  name: 'Shared Attacker', name_normalized: 'shared attacker', category: 'Pokemon',
  stage: 'Basic', suffix: null, trainer_type: null, energy_type: null,
  hp: 100, retreat: 1, regulation_mark: null, evolve_from: null,
  released_on: null, rarity: 'Common', illustrator: null,
  identical_print_group: group, set_tcgdex_id: set, set_name: set,
  set_group_id: null, set_card_count: null, is_promo: false, is_stamped: false,
  series_tcgdex_id: 'fixture', series_slug: 'fixture', market_minor: null,
  currency_code: null, tcgplayer_url: null, tcgplayer_product_id: null,
  tcgplayer_printing: null, tcgplayer_mass_entry: null,
  basic_energy_type: null, owned_qty: '0', owned_as: [],
});
const first = card(101, 'fixturea');
const second = card(102, 'fixtureb');
const meta = {
  id: deckId, name: 'Equivalent copy', description: null, format_code: 'unlimited',
  glc_type: null, is_favorite: false, cover_card_id: null, cover_render: 'card',
  version: 1, strategy_md: null, created_at: '2026-01-01', updated_at: '2026-01-01',
};

function fakeDb(): pg.PoolClient {
  return {
    async query(sql: string) {
      if (sql.includes('FROM deck WHERE')) return { rows: [meta] };
      if (sql.includes('FROM deck_card dc')) {
        // Model the two SQL ORDER BY clauses on this tied fixture. Returning
        // fresh objects matters: each route writes its own ownership fields.
        const page = sql.includes('cvd.sort_order');
        return { rows: (page ? [first, second] : [second, first]).map((r) => ({ ...r })) };
      }
      if (sql.includes('FROM collection_item ci')) return { rows: [{
        card_id: '103', variant_id: '103', variant_kind_code: 'normal', quantity: '1',
        identical_print_group: group, is_promo: false, is_stamped: false,
        energy_type: null, basic_energy_name: null, set_id: 'fixtureowned', local_id: '1',
      }] };
      if (sql.includes('FROM card c JOIN card_set s')) return { rows: [{
        id: '103', tcgdex_id: 'fixtureowned-1', set_tcgdex_id: 'fixtureowned',
        local_id: '1', local_id_numeric: 1, name: 'Shared Attacker', category: 'Pokemon',
        stage: 'Basic', suffix: null, trainer_type: null, energy_type: null,
        hp: 100, retreat: 1, regulation_mark: null, evolve_from: null, released_on: null,
      }] };
      if (sql.includes('FROM card_type WHERE')) return { rows: [] };
      throw new Error(`Unexpected deck query: ${sql.slice(0, 120)}`);
    },
  } as unknown as pg.PoolClient;
}

function handler(router: typeof decksRouter, path: string) {
  const route = router.stack.find((layer) => layer.route?.path === path);
  const fn = route?.route?.stack[0]?.handle;
  assert.ok(fn, `GET ${path} is registered`);
  return fn;
}

async function pageCards(client: pg.PoolClient): Promise<Array<{ setId: string; owned: number }>> {
  return rlsStore.run(client, () => new Promise((resolve, reject) => {
    const req = { params: { id: deckId }, user: { id: userId } } as unknown as Request;
    const res = {
      setHeader() { return this; },
      json(body: { cards: Array<{ setId: string; owned: number }> }) { resolve(body.cards); return this; },
    } as unknown as Response;
    handler(decksRouter, '/:id')(req, res, reject);
  }));
}

async function pdfBytes(client: pg.PoolClient): Promise<Buffer> {
  return rlsStore.run(client, () => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const res = new PassThrough() as PassThrough & Response;
    res.setHeader = () => res;
    res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    res.once('finish', () => resolve(Buffer.concat(chunks)));
    res.once('error', reject);
    const req = { params: { id: deckId }, query: {}, user: { id: userId } } as unknown as Request;
    handler(exportRouter, '/decks/:id/pdf')(req, res, reject);
  }));
}

// Read the rendered PDF, including its embedded font encodings, then compare
// the set and have count printed on the same row.
async function drawnRows(bytes: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const rows: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    const items = content.items.filter((item): item is typeof item & { str: string; transform: number[] } =>
      'str' in item && 'transform' in item);
    for (const item of items) {
      const y = item.transform[5]!;
      rows.push(items.filter((other) => Math.abs(other.transform[5]! - y) < 3)
        .sort((a, b) => a.transform[4]! - b.transform[4]!).map((part) => part.str).join(''));
    }
  }
  await task.destroy();
  return [...new Set(rows)];
}

test('deck page and PDF assign the scarce equivalent copy to the same card', async () => {
  const client = fakeDb();
  const page = await pageCards(client);
  const text = await drawnRows(await pdfBytes(client));
  const pdfOwned = (set: string) => {
    const label = text.find((line) => line.toLowerCase().replaceAll(' ', '').includes(`${set}1`));
    assert.ok(label, `PDF row for ${set} was rendered`);
    const count = label.match(/([01])\/1/);
    assert.ok(count, `PDF row needs a have count: ${label}`);
    return Number(count[1]);
  };
  assert.equal(page.length, 2);
  assert.equal(page.reduce((sum, row) => sum + row.owned, 0), 1);
  assert.equal(pdfOwned('fixturea') + pdfOwned('fixtureb'), 1);
  for (const row of page) {
    assert.equal(pdfOwned(row.setId), row.owned, `${row.setId} ownership differs between page and PDF`);
  }
});
