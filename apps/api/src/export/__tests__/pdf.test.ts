import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderDeckPdf, renderListPdf, renderSetChecklistPdf,
  type DeckPdfData, type ListPdfData, type SetChecklistData } from '../pdf.js';

async function renderToBuffer(render: (stream: Writable) => void): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const sink = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  render(sink);
  await once(sink, 'finish');
  return Buffer.concat(chunks);
}

async function inspect(bytes: Buffer): Promise<{ pages: string[]; sizes: [number, number][] }> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const pages: string[] = [], sizes: [number, number][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const text = await page.getTextContent();
    pages.push(text.items.filter((item): item is typeof item & { str: string } => 'str' in item).map((item) => item.str).join(''));
    const [, , w, h] = page.view;
    sizes.push([Math.round(w ?? 0), Math.round(h ?? 0)]);
  }
  await task.destroy();
  return { pages, sizes };
}

const generatedAt = '2026-01-01 00:00 UTC';
const deck: DeckPdfData = {
  name: 'Test Deck', description: null, formatName: 'Standard', glcType: null, legal: true, violations: [],
  counts: { total: 4, pokemon: 2, trainer: 1, energy: 1, distinctNames: 3 },
  pokemon: [{ quantity: 2, name: 'Nidoran ♀', setCode: 'sv3', number: '4', owned: 1 }],
  trainer: [{ quantity: 1, name: 'Boss’s Orders', setCode: 'rcl', number: '154', owned: 0 }],
  energy: [{ quantity: 1, name: 'Basic Fire Energy', setCode: 'sve', number: '10', owned: 1 }],
  generatedAt,
};
const list: ListPdfData = {
  name: 'Kanto Binder', kind: 'pokedex_binder', description: null, itemCount: 1, ownedCount: 1,
  hasProgress: true, items: [{ name: 'Bulbasaur', setId: 'Pokédex', number: '#1', variant: null,
    owned: true, quantity: null, note: null }], generatedAt,
};
const set: SetChecklistData = {
  setName: 'Obsidian Flames', setId: 'sv3', seriesName: 'Scarlet & Violet', releasedOn: null,
  printedCount: 2, total: 3, progress: { owned: 1, total: 3, pct: 33 },
  cards: [
    { number: '1', name: 'Nidoran ♀', rarity: 'Common', category: 'Pokemon', owned: true },
    { number: '2', name: 'Armaldo δ', rarity: 'Common', category: 'Pokemon', owned: false },
    { number: '3', name: 'Jirachi ☆ ◇', rarity: 'Secret Rare', category: 'Pokemon', owned: false },
  ], generatedAt,
};

for (const [name, render] of [
  ['deck', (s: Writable) => renderDeckPdf(s, deck)],
  ['list', (s: Writable) => renderListPdf(s, list)],
  ['set', (s: Writable) => renderSetChecklistPdf(s, set)],
] as const) {
  test(`${name} PDF carries DeckPal, page numbers, and Letter geometry`, async () => {
    const { pages, sizes } = await inspect(await renderToBuffer(render));
    assert.deepEqual(sizes[0], [612, 792]);
    assert.match(pages[0] ?? '', /DeckPal/);
    assert.match(pages[0] ?? '', /1 \/ 1/);
  });
}

test('binder labels remain Pokédex, while the product brand is DeckPal', async () => {
  const { pages } = await inspect(await renderToBuffer((s) => renderListPdf(s, list)));
  assert.match(pages.join(' '), /Pokédex binder/);
  assert.match(pages.join(' '), /Pokédex/);
  assert.doesNotMatch(pages.join(' '), /DeckScout/);
});

test('catalog symbols survive text extraction', async () => {
  const { pages } = await inspect(await renderToBuffer((s) => renderSetChecklistPdf(s, set)));
  const text = pages.join('');
  for (const glyph of ['♀', 'δ', '☆', '◇']) assert.ok(text.includes(glyph), `missing ${glyph}: ${text}`);
});

test('set grouping and pagination keep all cards in order on A4', async () => {
  const cards = Array.from({ length: 230 }, (_, i) => ({ number: String(i + 1),
    name: `Card ${String(i + 1).padStart(3, '0')}`, rarity: 'Common', category: 'Pokemon', owned: i < 45 }));
  const { pages, sizes } = await inspect(await renderToBuffer((s) => renderSetChecklistPdf(s, {
    ...set, paper: 'A4', printedCount: 197, total: cards.length,
    progress: { owned: 45, total: cards.length, pct: 20 }, cards,
  })));
  assert.ok(pages.length > 1);
  assert.deepEqual(sizes[0], [595, 842]);
  assert.ok(pages.every((page) => page.includes('CARD') && page.includes('DeckPal')));
  const all = pages.join('');
  assert.ok(all.indexOf('PRINTED CARDS') < all.indexOf('Card 001'));
  assert.ok(all.indexOf('SECRET CARDS') < all.indexOf('Card 198'));
  for (let i = 1; i <= cards.length; i++) assert.ok(all.includes(`Card ${String(i).padStart(3, '0')}`));
});

test('a long deck repeats its section name and table header after a page break', async () => {
  const trainer = Array.from({ length: 80 }, (_, i) => ({ quantity: 1, name: `Trainer ${i + 1}`,
    setCode: 'sv3', number: String(i + 1), owned: 0 }));
  const { pages } = await inspect(await renderToBuffer((s) => renderDeckPdf(s, {
    ...deck, trainer, counts: { ...deck.counts, total: 82, trainer: 80 },
  })));
  assert.ok(pages.length > 1);
  assert.ok(pages.slice(1).every((page) => page.includes('DeckPal') && page.includes('CARD')));
  assert.ok(pages.slice(1).some((page) => page.includes('Trainer (continued)')));
  for (let i = 1; i <= trainer.length; i++) assert.ok(pages.join('').includes(`Trainer ${i}`));
});

test('long descriptions stop on the metadata line before the checklist or deck table', async () => {
  const description = 'A very long description '.repeat(35) + 'TAILMARKER';
  for (const render of [
    (s: Writable) => renderListPdf(s, { ...list, description }),
    (s: Writable) => renderDeckPdf(s, { ...deck, description }),
  ]) {
    const { pages } = await inspect(await renderToBuffer(render));
    assert.equal(pages.length, 1);
    assert.ok(pages[0]!.includes('Bulbasaur') || pages[0]!.includes('Nidoran ♀'), pages[0]!.slice(-500));
    assert.ok(!pages[0]!.includes('TAILMARKER'));
  }
});

test('fallback symbols share the row baseline with card names', async () => {
  const bytes = await renderToBuffer((s) => renderSetChecklistPdf(s, set));
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  const items = (await (await pdf.getPage(1)).getTextContent()).items.filter((item): item is typeof item & { str: string; transform: number[] } =>
    'str' in item && 'transform' in item);
  const symbol = items.find((item) => item.str === '♀');
  const nidoran = items.find((item) => item.str === 'N' && symbol && Math.abs(item.transform[5]! - symbol.transform[5]!) < 5);
  assert.ok(nidoran && symbol);
  assert.ok(Math.abs(nidoran.transform[5]! - symbol.transform[5]!) < 0.1);
  await task.destroy();
});

test('long continuation labels fit beside the logo on later pages', async () => {
  const longName = 'The very long collection of every special printing and favorite card '.repeat(3);
  const cards = Array.from({ length: 230 }, (_, i) => ({ ...set.cards[0]!, number: String(i + 1), name: `Card ${i + 1}` }));
  const listItems = Array.from({ length: 80 }, (_, i) => ({ ...list.items[0]!, name: `Card ${i + 1}` }));
  const trainer = Array.from({ length: 80 }, (_, i) => ({ ...deck.trainer[0]!, name: `Trainer ${i + 1}` }));
  for (const render of [
    (s: Writable) => renderSetChecklistPdf(s, { ...set, setName: longName, cards, printedCount: cards.length }),
    (s: Writable) => renderListPdf(s, { ...list, name: longName, items: listItems, itemCount: listItems.length }),
    (s: Writable) => renderDeckPdf(s, { ...deck, name: longName, trainer, counts: { ...deck.counts, trainer: 80, total: 82 } }),
  ]) {
    const bytes = await renderToBuffer(render);
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    const pdf = await task.promise;
    assert.ok(pdf.numPages > 1);
    for (let pageNumber = 2; pageNumber <= pdf.numPages; pageNumber++) {
      const items = (await (await pdf.getPage(pageNumber)).getTextContent()).items.filter((item): item is typeof item & { str: string; transform: number[] } =>
        'str' in item && 'transform' in item);
      const header = items.filter((item) => item.str.includes('T H E V E R Y L O N G'));
      assert.ok(header.length > 0);
      assert.ok(header.every((item) => item.transform[4]! >= 204 && item.transform[5]! > 792 - 66),
        `wrapped continuation on page ${pageNumber}`);
    }
    await task.destroy();
  }
});

test('prefixed collector numbers retain every digit in set and list rows', async () => {
  for (const render of [
    (s: Writable) => renderSetChecklistPdf(s, { ...set, cards: [
      { ...set.cards[0]!, number: 'SWSH100' }, { ...set.cards[1]!, number: 'SWSH145' },
    ], printedCount: 2, total: 2, progress: { owned: 0, total: 2, pct: 0 } }),
    (s: Writable) => renderListPdf(s, { ...list, items: [
      { ...list.items[0]!, number: 'SWSH100' }, { ...list.items[0]!, number: 'SWSH145' },
    ], itemCount: 2 }),
  ]) {
    const { pages } = await inspect(await renderToBuffer(render));
    assert.ok(pages[0]!.includes('SWSH100'));
    assert.ok(pages[0]!.includes('SWSH145'));
  }
});

test('promo checklists without a printed denominator do not label every card secret', async () => {
  const { pages } = await inspect(await renderToBuffer((s) => renderSetChecklistPdf(s, {
    ...set, setName: 'McDonald’s Collection', printedCount: 0,
  })));
  assert.ok(pages[0]!.includes('Nidoran'));
  assert.ok(!pages[0]!.includes('SECRET CARDS'));
  assert.ok(!pages[0]!.includes('PRINTED CARDS'));
});
