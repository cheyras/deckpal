import PDFDocument from 'pdfkit';
import type { Writable } from 'node:stream';

/**
 * pokedex — PDF export rendering (BRIEF §2 nice-to-have, §7).
 *
 * Pure-JS PDF generation via pdfkit (0.19.x). pdfkit has NO native modules — its
 * entire dependency tree (fontkit, linebreak, png-js, @noble/*) is pure
 * JavaScript, so it builds and runs on aarch64 with no toolchain and never spawns
 * a headless browser. This box must not spawn Chrome for PDFs; pdfkit honours that.
 *
 * Only the 14 built-in AFM "standard" fonts (Helvetica family) are used, so the
 * module is fully self-contained — no font files to ship, no fontkit font loading.
 *
 * Card art in the cache is stored as .webp, which no pure-JS PDF lib can embed
 * without a decoder (sharp/libvips). Per the brief ("thumbnails … if cheap, else
 * text is fine") these are deliberately text-only, print-friendly checklists — the
 * classic collector/binder printout — which is also the most robust on this box.
 *
 * Each generator pipes into the supplied Writable (the Express response), renders,
 * and calls doc.end(). Callers set headers before invoking.
 */

// ── Layout tokens (print-friendly light theme; dark ink on white) ─────────────

const PAGE = { size: 'LETTER' as const, margin: 54 }; // 612×792pt, 54pt = 0.75in
const INK = '#18181b'; // near-black body text
const MUTED = '#6b7280'; // secondary meta
const RULE = '#d4d4d8'; // hairline rules
const ACCENT = '#b91c1c'; // pokedex red (UI-SPEC brand) for the title accent bar
const OWNED = '#166534'; // dark green check — legible in B&W too
const F = { reg: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' };

type Doc = PDFKit.PDFDocument;

function beginDoc(stream: Writable, title: string): Doc {
  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    bufferPages: true,
    info: { Title: title, Author: 'pokedex', Creator: 'pokedex-api' },
  });
  doc.pipe(stream);
  return doc;
}

const contentWidth = (doc: Doc): number => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc: Doc): number => doc.page.height - doc.page.margins.bottom;

/** Title band: red accent bar + title + right-aligned "pokedex", then meta lines. */
function header(doc: Doc, title: string, meta: string[]): void {
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  doc.save();
  doc.rect(x, doc.y, 4, 22).fill(ACCENT);
  doc.restore();
  doc.fillColor(INK).font(F.bold).fontSize(19).text(title, x + 14, doc.y + 1, { width: w - 90, lineBreak: false, ellipsis: true });
  // brand mark, right-aligned on the title baseline
  const brandY = doc.y - 22;
  doc.font(F.bold).fontSize(11).fillColor(ACCENT).text('pokédex', x, brandY + 6, { width: w, align: 'right' });
  doc.moveDown(0.5);
  doc.font(F.reg).fontSize(9).fillColor(MUTED);
  for (const line of meta) doc.text(line, x, doc.y, { width: w });
  doc.moveDown(0.4);
  doc.save().moveTo(x, doc.y).lineTo(x + w, doc.y).lineWidth(0.75).strokeColor(RULE).stroke().restore();
  doc.moveDown(0.7);
  doc.fillColor(INK);
}

/** Footer with page N of M + a generated-at stamp. Drawn over buffered pages. */
function paginate(doc: Doc, stamp: string): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // The footer sits in the bottom margin. pdfkit's text() auto-adds a page when
    // the cursor is below the bottom margin, so temporarily drop the margin to 0
    // for the write — otherwise every footer spawns a spurious blank page.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - savedBottom + 18;
    const x = doc.page.margins.left;
    const w = contentWidth(doc);
    doc.font(F.reg).fontSize(8).fillColor(MUTED);
    doc.text(stamp, x, y, { width: w / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, x + w / 2, y, { width: w / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
  doc.flushPages();
}

/** Draw a checkbox at (x,y). Filled check when owned; hollow square otherwise. */
function checkbox(doc: Doc, x: number, y: number, owned: boolean, size = 9): void {
  doc.save();
  doc.lineWidth(0.9).strokeColor(owned ? OWNED : MUTED).rect(x, y, size, size).stroke();
  if (owned) {
    doc
      .strokeColor(OWNED)
      .lineWidth(1.3)
      .moveTo(x + 1.8, y + size * 0.55)
      .lineTo(x + size * 0.4, y + size - 1.6)
      .lineTo(x + size - 1.2, y + 1.6)
      .stroke();
  }
  doc.restore();
}

// ── A generic top-to-bottom, left-to-right multi-column checklist flow ────────
// Long checklists (sets, want-lists) read best as newspaper columns: fill column
// 1 top→bottom, then column 2, then a new page. This helper owns pagination and
// re-draws nothing but rows; callers pass a per-row painter.

interface FlowOpts {
  columns: number;
  gutter: number;
  rowHeight: number;
  onNewPage?: (doc: Doc) => void; // e.g. repeat a column caption; must not move doc.y
}

class ColumnFlow {
  private col = 0;
  private y: number;
  private readonly colWidth: number;
  private readonly top: number;

  constructor(
    private readonly doc: Doc,
    private readonly opts: FlowOpts,
  ) {
    this.top = doc.y;
    this.y = doc.y;
    const w = contentWidth(doc);
    this.colWidth = (w - opts.gutter * (opts.columns - 1)) / opts.columns;
  }

  private colX(): number {
    return this.doc.page.margins.left + this.col * (this.colWidth + this.opts.gutter);
  }

  /** Reserve a row; returns its (x,y,width). Advances the cursor, breaking columns/pages. */
  row(): { x: number; y: number; w: number } {
    if (this.y + this.opts.rowHeight > bottomLimit(this.doc)) {
      this.col += 1;
      if (this.col >= this.opts.columns) {
        this.doc.addPage();
        this.col = 0;
        this.opts.onNewPage?.(this.doc);
        this.y = this.doc.page.margins.top;
      } else {
        this.y = this.top;
      }
    }
    const cell = { x: this.colX(), y: this.y, w: this.colWidth };
    this.y += this.opts.rowHeight;
    return cell;
  }
}

// ── Shared row painter for card checklists (checkbox • number • name • rarity) ─

function cardRow(
  doc: Doc,
  cell: { x: number; y: number; w: number },
  r: { number: string | null; name: string | null; rarity?: string | null; owned: boolean; qty?: number | null },
): void {
  const cbY = cell.y + 1.5;
  checkbox(doc, cell.x, cbY, r.owned);
  const textX = cell.x + 15;
  const numW = 34;
  doc.font(F.reg).fontSize(8.5).fillColor(MUTED);
  doc.text(r.number ?? '—', textX, cell.y, { width: numW, lineBreak: false, ellipsis: true });
  const nameX = textX + numW;
  const qtyTag = r.qty && r.qty > 1 ? `  ×${r.qty}` : '';
  doc.fillColor(r.owned ? INK : '#3f3f46').font(r.owned ? F.bold : F.reg).fontSize(9);
  const nameW = cell.w - (nameX - cell.x) - 4;
  doc.text((r.name ?? '—') + qtyTag, nameX, cell.y, { width: nameW, lineBreak: false, ellipsis: true });
}

// ── Public data shapes ────────────────────────────────────────────────────────

export interface DeckLine {
  quantity: number;
  name: string;
  setCode: string | null;
  number: string | null;
  owned: number;
}
export interface DeckPdfData {
  name: string;
  description: string | null;
  formatName: string;
  glcType: string | null;
  legal: boolean;
  violations: string[];
  counts: { total: number; pokemon: number; trainer: number; energy: number; distinctNames: number };
  pokemon: DeckLine[];
  trainer: DeckLine[];
  energy: DeckLine[];
  generatedAt: string;
}

export interface ListPdfItem {
  name: string | null;
  setId: string | null;
  number: string | null;
  variant: string | null;
  owned: boolean;
  quantity: number | null;
  note: string | null;
}
export interface ListPdfData {
  name: string;
  kind: string;
  description: string | null;
  itemCount: number;
  ownedCount: number | null;
  hasProgress: boolean;
  items: ListPdfItem[];
  generatedAt: string;
}

export interface SetChecklistCard {
  number: string | null;
  name: string | null;
  rarity: string | null;
  category: string | null;
  owned: boolean;
}
export interface SetChecklistData {
  setName: string;
  setId: string;
  seriesName: string;
  releasedOn: string | null;
  printedCount: number;
  total: number;
  progress: { owned: number; total: number; pct: number };
  cards: SetChecklistCard[];
  generatedAt: string;
}

// ── Deck PDF: grouped decklist + counts + format & legality summary ───────────

export function renderDeckPdf(stream: Writable, d: DeckPdfData): void {
  const doc = beginDoc(stream, `${d.name} — deck`);
  const stamp = `pokedex · deck export · ${d.generatedAt}`;
  header(doc, d.name, [
    `Format: ${d.formatName}${d.glcType ? ` (${d.glcType})` : ''}`,
    `${d.counts.total} cards · ${d.counts.pokemon} Pokémon · ${d.counts.trainer} Trainer · ${d.counts.energy} Energy · ${d.counts.distinctNames} unique`,
    ...(d.description ? [d.description] : []),
  ]);

  // Legality box
  const x = doc.page.margins.left;
  const w = contentWidth(doc);
  const boxTop = doc.y;
  const verdict = d.legal ? 'LEGAL' : 'NOT LEGAL';
  const vColor = d.legal ? OWNED : ACCENT;
  doc.save();
  doc.roundedRect(x, boxTop, w, d.legal ? 22 : Math.min(22 + d.violations.length * 12, 120), 4).lineWidth(0.75).strokeColor(RULE).stroke();
  doc.restore();
  doc.font(F.bold).fontSize(10).fillColor(vColor).text(`${verdict}`, x + 8, boxTop + 6, { width: 90, lineBreak: false });
  doc.font(F.reg).fontSize(9).fillColor(MUTED).text(`in ${d.formatName}`, x + 96, boxTop + 6.5, { width: w - 104, lineBreak: false });
  if (!d.legal && d.violations.length) {
    let vy = boxTop + 20;
    doc.font(F.reg).fontSize(8.5).fillColor(INK);
    for (const v of d.violations.slice(0, 8)) {
      doc.text(`• ${v}`, x + 12, vy, { width: w - 20, lineBreak: false, ellipsis: true });
      vy += 12;
    }
    doc.y = vy + 4;
  } else {
    doc.y = boxTop + 30;
  }
  doc.moveDown(0.4);

  const section = (label: string, lines: DeckLine[], count: number): void => {
    if (!lines.length) return;
    if (doc.y + 40 > bottomLimit(doc)) doc.addPage();
    const sx = doc.page.margins.left;
    doc.font(F.bold).fontSize(12).fillColor(INK).text(`${label}`, sx, doc.y, { continued: true });
    doc.font(F.reg).fontSize(10).fillColor(MUTED).text(`   ${count}`, { lineBreak: false });
    doc.moveDown(0.15);
    doc.save().moveTo(sx, doc.y).lineTo(sx + contentWidth(doc), doc.y).lineWidth(0.5).strokeColor(RULE).stroke().restore();
    doc.moveDown(0.3);
    for (const ln of lines) {
      if (doc.y + 14 > bottomLimit(doc)) doc.addPage();
      const y = doc.y;
      doc.font(F.bold).fontSize(9.5).fillColor(INK).text(`${ln.quantity}`, sx, y, { width: 18, lineBreak: false });
      doc.font(F.reg).fontSize(9.5).fillColor(INK).text(ln.name, sx + 22, y, { width: contentWidth(doc) - 150, lineBreak: false, ellipsis: true });
      const ref = [ln.setCode, ln.number].filter(Boolean).join(' ');
      const ownTag = ln.owned >= ln.quantity ? '✓ owned' : `have ${ln.owned}/${ln.quantity}`;
      doc.font(F.reg).fontSize(8.5).fillColor(MUTED).text(`${ref}${ref ? '   ' : ''}${ownTag}`, sx + contentWidth(doc) - 128, y + 0.5, { width: 128, align: 'right', lineBreak: false });
      doc.y = y + 13.5;
    }
    doc.moveDown(0.5);
  };

  section('Pokémon', d.pokemon, d.counts.pokemon);
  section('Trainer', d.trainer, d.counts.trainer);
  section('Energy', d.energy, d.counts.energy);

  paginate(doc, stamp);
  doc.end();
}

// ── List PDF: want-list / binder checklist (checkbox per item) ────────────────

export function renderListPdf(stream: Writable, d: ListPdfData): void {
  const doc = beginDoc(stream, `${d.name} — list`);
  const stamp = `pokedex · list export · ${d.generatedAt}`;
  const kindLabel = d.kind === 'pokedex_binder' ? 'Pokédex binder' : d.kind.charAt(0).toUpperCase() + d.kind.slice(1);
  header(doc, d.name, [
    `${kindLabel} list · ${d.itemCount} ${d.itemCount === 1 ? 'entry' : 'entries'}` +
      (d.hasProgress && d.ownedCount != null ? ` · ${d.ownedCount}/${d.itemCount} owned` : ''),
    ...(d.description ? [d.description] : []),
    'Check the box for each card you have; unchecked = still needed.',
  ]);

  if (!d.items.length) {
    doc.font(F.italic).fontSize(10).fillColor(MUTED).text('This list has no items yet.', { width: contentWidth(doc) });
    paginate(doc, stamp);
    doc.end();
    return;
  }

  const flow = new ColumnFlow(doc, { columns: 2, gutter: 24, rowHeight: 15 });
  for (const it of d.items) {
    const cell = flow.row();
    cardRow(doc, cell, {
      number: it.number,
      name: it.variant && it.variant.toLowerCase() !== 'normal' ? `${it.name ?? '—'} · ${it.variant}` : it.name,
      owned: it.owned,
      qty: d.kind === 'static' ? it.quantity : null,
    });
    if (it.setId) {
      doc.font(F.reg).fontSize(7).fillColor(MUTED).text(it.setId, cell.x + 15 + 34, cell.y + 9.5, { width: cell.w - 49, lineBreak: false, ellipsis: true });
    }
  }

  paginate(doc, stamp);
  doc.end();
}

// ── Set checklist PDF: every card in a set with an owned mark ──────────────────

export function renderSetChecklistPdf(stream: Writable, d: SetChecklistData): void {
  const doc = beginDoc(stream, `${d.setName} — set checklist`);
  const stamp = `pokedex · set checklist · ${d.generatedAt}`;
  header(doc, d.setName, [
    `${d.seriesName} · ${d.setId}${d.releasedOn ? ` · released ${d.releasedOn}` : ''}`,
    `${d.progress.owned}/${d.progress.total} owned (${d.progress.pct}%) · ${d.printedCount} printed${d.total > d.printedCount ? ` + ${d.total - d.printedCount} secret` : ''}`,
  ]);

  if (!d.cards.length) {
    doc.font(F.italic).fontSize(10).fillColor(MUTED).text('No cards found for this set.', { width: contentWidth(doc) });
    paginate(doc, stamp);
    doc.end();
    return;
  }

  const flow = new ColumnFlow(doc, { columns: 2, gutter: 24, rowHeight: 15 });
  for (const c of d.cards) {
    const cell = flow.row();
    cardRow(doc, cell, { number: c.number, name: c.name, rarity: c.rarity, owned: c.owned });
    if (c.rarity) {
      doc.font(F.reg).fontSize(7).fillColor(MUTED).text(c.rarity, cell.x + 15 + 34, cell.y + 9.5, { width: cell.w - 49, lineBreak: false, ellipsis: true });
    }
  }

  paginate(doc, stamp);
  doc.end();
}
