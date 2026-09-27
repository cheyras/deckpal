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
