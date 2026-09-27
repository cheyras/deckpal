import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Writable } from 'node:stream';

/** White, ink-light exports. All coordinates are points, so Letter and A4 share one layout. */
const BRAND = 'DeckPal';
const C = { ink: '#292524', muted: '#57534e', light: '#a8a29e', rule: '#d6d3d1', cyan: '#007595' };
const MARGIN = 44;
const FONT_FILES = {
  regular: 'Figtree-Regular.ttf', semibold: 'Figtree-SemiBold.ttf', display: 'Fraunces-SemiBold.ttf',
  signs: 'NotoSans-Symbols.ttf', delta: 'NotoSans-Delta.ttf', shapes: 'NotoSans-Symbols2.ttf',
} as const;
type Face = keyof typeof FONT_FILES;
type Doc = PDFKit.PDFDocument;
export type PdfPaper = 'LETTER' | 'A4';

const asset = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));
const logoPath = asset('./assets/deckpal-logo-dark.svg');

function beginDoc(stream: Writable, title: string, paper: PdfPaper = 'LETTER'): Doc {
  const doc = new PDFDocument({ size: paper, margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 0 }, bufferPages: true,
    info: { Title: title, Author: BRAND, Creator: 'deckpal-api' } });
  for (const [face, file] of Object.entries(FONT_FILES)) {
    const path = asset(`./fonts/${file}`);
    if (existsSync(path)) {
      try { doc.registerFont(face, path); } catch { /* Helvetica remains readable if an asset is unavailable. */ }
    }
  }
  doc.pipe(stream);
  return doc;
}

function font(doc: Doc, face: Face): Doc {
  try { return doc.font(face); } catch { return doc.font(face === 'semibold' || face === 'display' ? 'Helvetica-Bold' : 'Helvetica'); }
}
const width = (doc: Doc): number => doc.page.width - MARGIN * 2;
const bottom = (doc: Doc): number => doc.page.height - 64;
const specialFace = (char: string, normal: Face): Face =>
  /[♀♂]/.test(char) ? 'signs' : char === 'δ' ? 'delta' : /[☆◇]/.test(char) ? 'shapes' : normal;

/** PDFKit does not fall back per glyph. Split only the five catalog symbols its brand fonts lack. */
function fitted(doc: Doc, value: string, x: number, y: number, max: number, size: number, face: Face = 'regular', color = C.ink): void {
  const parts = [...value].map((char) => ({ char, face: specialFace(char, face) }));
  const glyphWidth = (char: string, f: Face): number => font(doc, f).fontSize(size).widthOfString(char);
  let used = 0;
  const shown: typeof parts = [];
  for (const part of parts) {
    const w = glyphWidth(part.char, part.face);
    if (used + w > max) break;
    shown.push(part); used += w;
  }
  if (shown.length < parts.length) {
    const ellipsis = glyphWidth('…', face);
    while (shown.length && used + ellipsis > max) {
      const last = shown.pop()!; used -= glyphWidth(last.char, last.face);
    }
    shown.push({ char: '…', face });
  }
  let cursor = x;
  for (const part of shown) {
    font(doc, part.face).fontSize(size).fillColor(color).text(part.char, cursor, y, { lineBreak: false });
    cursor += glyphWidth(part.char, part.face);
  }
}

function rule(doc: Doc, x: number, y: number, w: number, color = C.rule, thick = 0.6): void {
  doc.save().moveTo(x, y).lineTo(x + w, y).lineWidth(thick).strokeColor(color).stroke().restore();
}

function wordmark(doc: Doc, x: number, y: number, w: number): void {
  try {
    if (!existsSync(logoPath)) throw new Error('logo unavailable');
    doc.save();
    SVGtoPDF(doc, readFileSync(logoPath, 'utf8'), x, y, { width: w, height: w * 94.11 / 450.12, preserveAspectRatio: 'xMinYMin meet' });
    doc.restore();
  } catch {
    font(doc, 'semibold').fontSize(12).fillColor(C.ink).text(BRAND, x, y, { lineBreak: false });
  }
}

function chrome(doc: Doc, label: string, title: string, meta: string, summary?: { owned: number; total: number; pct: number }): number {
  const x = MARGIN, w = width(doc);
  wordmark(doc, x, 37, 112);
  font(doc, 'semibold').fontSize(8).fillColor(C.muted).text(label.toUpperCase(), x + 190, 46, { width: w - 190, align: 'right', characterSpacing: 1.3, lineBreak: false });
  rule(doc, x, 72, w);
  fitted(doc, title, x, 87, w, 25, 'display');
  fitted(doc, meta, x, 122, w, 9, 'regular', C.muted);
  if (!summary) { rule(doc, x, 147, w); return 166; }
  const count = `${summary.owned} / ${summary.total}`;
  font(doc, 'semibold').fontSize(17).fillColor(C.ink).text(count, x, 146, { lineBreak: false });
  font(doc, 'semibold').fontSize(8).fillColor(C.muted).text('OWNED', x, 167, { lineBreak: false, characterSpacing: 1 });
  font(doc, 'semibold').fontSize(18).fillColor(C.ink).text(`${summary.pct}%`, x + w - 74, 145, { width: 74, align: 'right', lineBreak: false });
  rule(doc, x, 187, w, C.rule, 2);
  if (summary.total > 0) rule(doc, x, 187, w * Math.max(0, Math.min(100, summary.pct)) / 100, C.cyan, 2);
  return 204;
}

function continuation(doc: Doc, label: string): number {
  wordmark(doc, MARGIN, 35, 83);
  font(doc, 'semibold').fontSize(8).fillColor(C.muted).text(label.toUpperCase(), MARGIN + 160, 43,
    { width: width(doc) - 160, align: 'right', lineBreak: false, characterSpacing: 1 });
  rule(doc, MARGIN, 66, width(doc));
  return 83;
}

function paginate(doc: Doc, stamp: string): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - 40, x = MARGIN, w = width(doc);
    rule(doc, x, y - 10, w);
    const old = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    font(doc, 'semibold').fontSize(8).fillColor(C.ink).text(BRAND, x, y, { lineBreak: false });
    font(doc, 'regular').fontSize(8).fillColor(C.muted).text(stamp, x + 65, y, { width: w - 170, lineBreak: false, ellipsis: true });
    font(doc, 'regular').fontSize(8).fillColor(C.muted).text(`${i + 1} / ${range.count}`, x + w - 70, y, { width: 70, align: 'right', lineBreak: false });
    doc.page.margins.bottom = old;
  }
  doc.flushPages();
}

function checkbox(doc: Doc, x: number, y: number, owned: boolean): void {
  doc.save().lineWidth(0.85).strokeColor(C.muted).rect(x, y, 12, 12).stroke();
  if (owned) doc.lineWidth(1.3).strokeColor(C.ink).moveTo(x + 2.2, y + 6.2).lineTo(x + 5, y + 9.4).lineTo(x + 10, y + 2.3).stroke();
  doc.restore();
}

class Columns {
  private col = 0;
  private y: number;
  private readonly cellWidth: number;
  private remaining: number;
  private inColumn = 0;
  private balanceLimit = Infinity;
  constructor(private doc: Doc, private count: number, private start: number, private label: string,
    private onColumn: (x: number, y: number, w: number) => void, totalRows: number, private rowHeight: number, private gutter = 18) {
    this.cellWidth = (width(doc) - gutter * (count - 1)) / count;
    this.remaining = totalRows;
    this.y = start;
    this.setBalance();
    this.heading();
  }
  private x(): number { return MARGIN + this.col * (this.cellWidth + this.gutter); }
  private heading(): void { this.onColumn(this.x(), this.y, this.cellWidth); this.y += 22; }
  private setBalance(): void {
    const capacity = Math.floor((bottom(this.doc) - this.start - 22) / this.rowHeight) * this.count;
    this.balanceLimit = this.remaining <= capacity ? Math.ceil(this.remaining / this.count) : Infinity;
  }
  private advance(): void {
    this.col++;
    if (this.col === this.count) {
      this.doc.addPage(); this.col = 0; this.start = continuation(this.doc, this.label);
      this.setBalance();
    }
    this.y = this.start;
    this.inColumn = 0;
    this.heading();
  }
  row(height: number): { x: number; y: number; w: number } {
    if (this.inColumn >= this.balanceLimit || this.y + height > bottom(this.doc)) this.advance();
    const cell = { x: this.x(), y: this.y, w: this.cellWidth };
    this.y += height;
    this.inColumn++;
    this.remaining--;
    return cell;
  }
  section(text: string): void {
    if (this.inColumn >= this.balanceLimit || this.y + 34 > bottom(this.doc)) this.advance();
    font(this.doc, 'semibold').fontSize(8).fillColor(C.cyan).text(text.toUpperCase(), this.x(), this.y + 2,
      { width: this.cellWidth, lineBreak: false, characterSpacing: 0.6 });
    this.y += 18;
  }
}

function columnHead(doc: Doc, x: number, y: number, w: number, first: string): void {
  font(doc, 'semibold').fontSize(7).fillColor(C.muted).text(first, x, y, { lineBreak: false, characterSpacing: 0.6 });
  font(doc, 'semibold').fontSize(7).fillColor(C.muted).text('CARD', x + 57, y, { lineBreak: false, characterSpacing: 0.6 });
  rule(doc, x, y + 14, w);
}

function cardRow(doc: Doc, cell: { x: number; y: number; w: number }, name: string, number: string | null, owned: boolean,
  secondary?: string | null): void {
  checkbox(doc, cell.x, cell.y + 2, owned);
  fitted(doc, number ?? '—', cell.x + 18, cell.y + 2, 31, 8.5, 'semibold', C.muted);
  fitted(doc, name, cell.x + 57, cell.y + 1, cell.w - 57, 9, 'regular');
  if (secondary) fitted(doc, secondary, cell.x + 57, cell.y + 13, cell.w - 57, 7.5, 'regular', C.muted);
}

export interface DeckLine { quantity: number; name: string; setCode: string | null; number: string | null; owned: number; }
export interface DeckPdfData {
  name: string; description: string | null; formatName: string; glcType: string | null; legal: boolean; violations: string[];
  counts: { total: number; pokemon: number; trainer: number; energy: number; distinctNames: number };
  pokemon: DeckLine[]; trainer: DeckLine[]; energy: DeckLine[]; generatedAt: string; paper?: PdfPaper;
}
export interface ListPdfItem {
  name: string | null; setId: string | null; number: string | null; variant: string | null;
  owned: boolean; quantity: number | null; note: string | null;
}
export interface ListPdfData {
  name: string; kind: string; description: string | null; itemCount: number; ownedCount: number | null;
  hasProgress: boolean; items: ListPdfItem[]; generatedAt: string; paper?: PdfPaper;
}
export interface SetChecklistCard { number: string | null; name: string | null; rarity: string | null; category: string | null; owned: boolean; }
export interface SetChecklistData {
  setName: string; setId: string; seriesName: string; releasedOn: string | null; printedCount: number; total: number;
  progress: { owned: number; total: number; pct: number }; cards: SetChecklistCard[]; generatedAt: string; paper?: PdfPaper;
}

export function renderSetChecklistPdf(stream: Writable, d: SetChecklistData): void {
  const doc = beginDoc(stream, `${d.setName} — set checklist`, d.paper);
  const top = chrome(doc, 'Set checklist', d.setName,
    `${d.seriesName}  ·  ${d.setId}${d.releasedOn ? `  ·  Released ${d.releasedOn}` : ''}`,
    d.progress);
  if (!d.cards.length) font(doc, 'regular').fontSize(10).fillColor(C.muted).text('No cards found for this set.', MARGIN, top);
  else {
    const flow = new Columns(doc, 3, top, `${d.setName} · set checklist`,
      (x, y, w) => columnHead(doc, x, y, w, 'NO.'), d.cards.length, 17);
    let band = '';
    for (let i = 0; i < d.cards.length; i++) {
      const card = d.cards[i]!;
      const next = i < d.printedCount ? 'Printed cards' : 'Secret cards';
      if (next !== band) { flow.section(next); band = next; }
      cardRow(doc, flow.row(17), card.name ?? '—', card.number, card.owned);
    }
  }
  paginate(doc, `${d.progress.owned} of ${d.progress.total} owned  ·  ${d.generatedAt}`);
  doc.end();
}

export function renderListPdf(stream: Writable, d: ListPdfData): void {
  const doc = beginDoc(stream, `${d.name} — list`, d.paper);
  const kind = d.kind === 'pokedex_binder' ? 'Pokédex binder' : d.kind.charAt(0).toUpperCase() + d.kind.slice(1).replaceAll('_', ' ');
  const top = chrome(doc, `${kind} checklist`, d.name,
    `${kind} list  ·  ${d.itemCount} ${d.itemCount === 1 ? 'entry' : 'entries'}${d.description ? `  ·  ${d.description}` : ''}`,
    d.hasProgress && d.ownedCount != null ? { owned: d.ownedCount, total: d.itemCount,
      pct: d.itemCount ? Math.round(d.ownedCount * 100 / d.itemCount) : 0 } : undefined);
  if (!d.items.length) font(doc, 'regular').fontSize(10).fillColor(C.muted).text('This list has no items yet.', MARGIN, top);
  else {
    const flow = new Columns(doc, 2, top, `${d.name} · ${kind} checklist`,
      (x, y, w) => columnHead(doc, x, y, w, 'NO.'), d.items.length, 27);
    for (const item of d.items) {
      const suffix = item.variant && item.variant.toLowerCase() !== 'normal' ? ` · ${item.variant}` : '';
      const qty = d.kind === 'static' && item.quantity && item.quantity > 1 ? ` ×${item.quantity}` : '';
      cardRow(doc, flow.row(27), `${item.name ?? '—'}${suffix}${qty}`, item.number, item.owned, item.setId);
    }
  }
  paginate(doc, d.hasProgress && d.ownedCount != null ? `${d.ownedCount} of ${d.itemCount} owned  ·  ${d.generatedAt}` : d.generatedAt);
  doc.end();
}

export function renderDeckPdf(stream: Writable, d: DeckPdfData): void {
  const doc = beginDoc(stream, `${d.name} — deck`, d.paper);
  let y = chrome(doc, 'Deck list', d.name,
    `${d.formatName}${d.glcType ? ` · ${d.glcType}` : ''}  ·  ${d.counts.total} cards${d.description ? `  ·  ${d.description}` : ''}`);
  const x = MARGIN, w = width(doc);
  const counts = [ ['Pokémon', d.counts.pokemon], ['Trainer', d.counts.trainer], ['Energy', d.counts.energy] ] as const;
  for (let i = 0; i < counts.length; i++) {
    const sx = x + i * w / 3;
    font(doc, 'semibold').fontSize(17).fillColor(C.ink).text(String(counts[i]![1]), sx, y, { lineBreak: false });
    font(doc, 'semibold').fontSize(8).fillColor(C.muted).text(counts[i]![0].toUpperCase(), sx, y + 23, { lineBreak: false, characterSpacing: 0.8 });
  }
  y += 42;
  const verdict = d.legal ? 'Legal' : 'Check legality';
  font(doc, 'semibold').fontSize(8.5).fillColor(C.ink).text(`${verdict} in ${d.formatName}`, x, y, { lineBreak: false });
  y += 15;
  if (!d.legal) for (const violation of d.violations.slice(0, 5)) {
    fitted(doc, `• ${violation}`, x, y, w, 8, 'regular', C.muted); y += 12;
  }
  const head = (): void => {
    font(doc, 'semibold').fontSize(7).fillColor(C.muted).text('QTY', x, y, { lineBreak: false });
    font(doc, 'semibold').fontSize(7).fillColor(C.muted).text('CARD', x + 33, y, { lineBreak: false });
    font(doc, 'semibold').fontSize(7).fillColor(C.muted).text('SET / NO.', x + w - 142, y, { lineBreak: false });
    font(doc, 'semibold').fontSize(7).fillColor(C.muted).text('HAVE', x + w - 45, y, { lineBreak: false });
    rule(doc, x, y + 13, w); y += 16;
  };
  const ensure = (height: number, continuing?: string): void => {
    if (y + height <= bottom(doc)) return;
    doc.addPage(); y = continuation(doc, `${d.name} · deck list`);
    if (continuing) {
      font(doc, 'display').fontSize(13).fillColor(C.ink).text(`${continuing} (continued)`, x, y, { lineBreak: false });
      y += 24;
      head();
    }
  };
  const section = (label: string, lines: DeckLine[], count: number): void => {
    if (!lines.length) return;
    ensure(62);
    rule(doc, x, y, w, C.ink, 0.9);
    font(doc, 'display').fontSize(13).fillColor(C.ink).text(label, x, y + 7, { lineBreak: false });
    font(doc, 'semibold').fontSize(9).fillColor(C.muted).text(String(count), x + w - 30, y + 9, { width: 30, align: 'right', lineBreak: false });
    y += 27; head();
    for (const line of lines) {
      ensure(16, label);
      font(doc, 'semibold').fontSize(10).fillColor(C.ink).text(String(line.quantity), x, y + 1, { lineBreak: false });
      fitted(doc, line.name, x + 33, y + 1, w - 185, 9.5);
      fitted(doc, [line.setCode, line.number].filter(Boolean).join(' '), x + w - 142, y + 2, 88, 8, 'regular', C.muted);
      const have = Math.min(line.owned, line.quantity);
      font(doc, 'semibold').fontSize(9).fillColor(C.ink).text(`${have}/${line.quantity}`, x + w - 45, y + 1,
        { width: 45, align: 'right', lineBreak: false });
      rule(doc, x, y + 13, w, '#e7e5e4', 0.35);
      y += 16;
    }
    y += 3;
  };
  section('Pokémon', d.pokemon, d.counts.pokemon);
  section('Trainer', d.trainer, d.counts.trainer);
  section('Energy', d.energy, d.counts.energy);
  paginate(doc, `${d.counts.total} cards  ·  ${d.generatedAt}`);
  doc.end();
}
