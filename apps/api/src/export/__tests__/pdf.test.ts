/**
 * PDF export brand mark — regression guard for issue #92.
 *
 * Pure: no DB, no network, no model. Renders each export to an in-memory
 * buffer with fixture data and reads the text back out of the real PDF.
 *
 * Why read the PDF instead of asserting on the module's constants: the defect
 * in #92 was a literal string in a draw call, and a test that imports the same
 * literal it is checking proves nothing. These assertions parse the bytes a
 * user's PDF reader would parse.
 *
 * The two halves matter equally:
 *   1. The brand mark must say DeckPal — it said `pokédex`, a name from two
 *      renames ago, on every export.
 *   2. The `pokedex_binder` list kind's "Pokédex binder" label, and the
 *      "Pokédex" pseudo-set-id on species rows, must SURVIVE. Those name the
 *      dex feature, which kept its name. A rename sweep that eats them is the
 *      same class of bug pointed the other way — that exact sweep once 404'd
 *      every species page (see the note in apps/web/src/lib/api.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { inflateSync } from 'node:zlib';

import {
  renderDeckPdf,
  renderListPdf,
  renderSetChecklistPdf,
  type DeckPdfData,
  type ListPdfData,
  type SetChecklistData,
} from '../pdf.js';

/** Collect a render into a single Buffer. */
async function renderToBuffer(render: (s: Writable) => void): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  render(sink);
  await once(sink, 'finish');
  return Buffer.concat(chunks);
}

/**
 * Every string drawn on the page, in draw order.
 *
 * pdfkit Flate-compresses each page's content stream and writes text as kerned
 * `[<hex> 20 <hex> …] TJ` arrays, so the glyphs are neither greppable in the
 * raw file nor contiguous once inflated. Inflate each stream, then join the
 * hex runs inside each TJ array back into one string. The standard-14 fonts
 * used here are WinAnsi-encoded, which agrees with latin1 over this text
 * (notably `é` = 0xE9).
 */
function drawnText(pdf: Buffer): string[] {
  let content = '';
  for (let i = 0; ; ) {
    const s = pdf.indexOf('stream', i);
    if (s < 0) break;
    let b = s + 'stream'.length;
    if (pdf[b] === 0x0d) b++;
    if (pdf[b] === 0x0a) b++;
    const e = pdf.indexOf('endstream', b);
    if (e < 0) break;
    try {
      content += inflateSync(pdf.subarray(b, e)).toString('latin1') + '\n';
    } catch {
      // Not a Flate stream (or not a stream at all) — fonts, metadata. Skip.
    }
    i = e + 'endstream'.length;
  }

  return [...content.matchAll(/\[([^\]]*)\]\s*TJ/g)].map((tj) =>
    [...(tj[1] ?? '').matchAll(/<([0-9a-fA-F]*)>/g)]
      .map((run) => Buffer.from(run[1] ?? '', 'hex').toString('latin1'))
      .join(''),
  );
}

const generatedAt = '2026-01-01 00:00 UTC';

const deck: DeckPdfData = {
  name: 'Test Deck',
  description: null,
  formatName: 'Standard',
  glcType: null,
  legal: true,
  violations: [],
  counts: { total: 4, pokemon: 2, trainer: 1, energy: 1, distinctNames: 3 },
  pokemon: [{ quantity: 2, name: 'Charmander', setCode: 'sv3pt5', number: '4', owned: 2 }],
  trainer: [{ quantity: 1, name: 'Boss’s Orders', setCode: 'rcl', number: '154', owned: 0 }],
  energy: [{ quantity: 1, name: 'Basic Fire Energy', setCode: 'sve', number: '10', owned: 1 }],
  generatedAt,
};

const dexList: ListPdfData = {
  name: 'Kanto Binder',
  kind: 'pokedex_binder',
  description: null,
  itemCount: 1,
  ownedCount: 1,
  hasProgress: true,
  items: [
    { name: 'Bulbasaur', setId: 'Pokédex', number: '#1', variant: null, owned: true, quantity: null, note: null },
  ],
  generatedAt,
};

const setChecklist: SetChecklistData = {
  setName: 'Obsidian Flames',
  setId: 'sv3',
  seriesName: 'Scarlet & Violet',
  releasedOn: null,
  printedCount: 1,
  total: 1,
  progress: { owned: 0, total: 1, pct: 0 },
  cards: [{ number: '1', name: 'Sprigatito', rarity: 'Common', category: 'Pokemon', owned: false }],
  generatedAt,
};

/** The brand mark is the first thing drawn after the deck/list/set title. */
const BRAND_MARK = 'DeckPal';

/** Brand names this product has shipped under and must never render again. */
const RETIRED_BRANDS = ['pokédex', 'pokedex', 'deckscout'];

for (const [label, render] of [
  ['deck export', (s: Writable) => renderDeckPdf(s, deck)],
  ['list export', (s: Writable) => renderListPdf(s, dexList)],
  ['set checklist export', (s: Writable) => renderSetChecklistPdf(s, setChecklist)],
] as const) {
  test(`${label}: header renders the DeckPal brand mark`, async () => {
    const drawn = drawnText(await renderToBuffer(render));
    assert.ok(drawn.length > 0, 'expected the PDF to draw some text');
    assert.ok(
      drawn.includes(BRAND_MARK),
      `expected a "${BRAND_MARK}" brand mark among the drawn strings, got: ${JSON.stringify(drawn)}`,
    );
  });

  test(`${label}: footer stamp carries the current brand`, async () => {
    const drawn = drawnText(await renderToBuffer(render));
    assert.ok(
      drawn.some((t) => t.startsWith(`${BRAND_MARK} · `)),
      `expected a "${BRAND_MARK} · …" footer stamp, got: ${JSON.stringify(drawn)}`,
    );
  });
}

test('deck export renders no retired brand name anywhere', async () => {
  // The deck export has no legitimate use of the word "pokedex" in any casing,
  // so this one can assert the absence outright.
  const drawn = drawnText(await renderToBuffer((s) => renderDeckPdf(s, deck)));
  for (const retired of RETIRED_BRANDS) {
    const offenders = drawn.filter((t) => t.toLowerCase().includes(retired));
    assert.deepEqual(offenders, [], `retired brand "${retired}" is still rendered in ${JSON.stringify(offenders)}`);
  }
});

test('set checklist export renders no retired brand name anywhere', async () => {
  const drawn = drawnText(await renderToBuffer((s) => renderSetChecklistPdf(s, setChecklist)));
  for (const retired of RETIRED_BRANDS) {
    const offenders = drawn.filter((t) => t.toLowerCase().includes(retired));
    assert.deepEqual(offenders, [], `retired brand "${retired}" is still rendered in ${JSON.stringify(offenders)}`);
  }
});

test('list export keeps the Pokédex FEATURE labels while branding DeckPal', async () => {
  const drawn = drawnText(await renderToBuffer((s) => renderListPdf(s, dexList)));

  // The dex feature kept its name: the kind label and the species pseudo-set-id.
  assert.ok(
    drawn.some((t) => t.startsWith('Pokédex binder list')),
    `expected the "Pokédex binder" kind label to survive, got: ${JSON.stringify(drawn)}`,
  );
  assert.ok(
    drawn.includes('Pokédex'),
    `expected the "Pokédex" species set-id to survive, got: ${JSON.stringify(drawn)}`,
  );

  // …and the brand mark is still the product name, not the feature name.
  assert.ok(drawn.includes(BRAND_MARK), `expected the "${BRAND_MARK}" brand mark, got: ${JSON.stringify(drawn)}`);
});
