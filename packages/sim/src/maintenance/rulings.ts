/**
 * Pokémon Rulings Compendium (https://compendium.pokegym.net/): parsing its "all rulings by date" page, matching rulings
 * to card names, and finding which rulings the simulator's source already cites. Pure (no I/O); the I/O is in
 * scripts/rulings-sync.ts. The Compendium's question and answer text is its own (TPCi Rules Team / Japanese Q&A as it publishes
 * them): this repo keeps only an index of it (RulingIndexEntry: id, date, filing names, source label, hash), never the text.
 */

export interface Ruling {
  /** The Compendium's own ruling id: https://compendium.pokegym.net/ruling/<id>/ . New rulings get higher ids. */
  id: number;
  /** ISO date of the ruling, from its source line "(YYYY-MM-DD)" (the latest when several), or null. */
  date: string | null;
  /** The leaf category names the Compendium files it under: card, attack and Ability names, "Errata", ... */
  categories: string[];
  /** The same with their top-level category: "Attacks » Pleasing Present". */
  paths: string[];
  /** The question, or null for an errata / single-entry ruling that only has an answer. */
  q: string | null;
  a: string;
  /** The source line as printed ("Chaos Rising FAQ; TPCi Rules Team (2026-05-21)"). */
  source: string;
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', raquo: '»', laquo: '«', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', Eacute: 'É' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? m;
  });
}

/** Remove every tag, repeating until none is left (a single pass can leave one formed from the pieces of two). */
function stripTags(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^<>]*>/g, '');
  } while (s !== prev);
  return s;
}

/** HTML fragment -> plain text, keeping paragraph and list breaks. The result is plain text, never HTML. */
export function htmlToText(html: string): string {
  const text = decodeEntities(
    stripTags(
      html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|ul|ol)>/gi, '\n\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<\/li>/gi, '\n'),
    ),
  );
  // An entity such as `&lt;` decodes to a literal bracket in the ruling's words: this is plain text for the console and
  // the index hash, never inserted into HTML.
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The latest ISO date in a source line; falls back to a "Jun 13, 2025" style date. */
export function sourceDate(source: string): string | null {
  const iso = [...source.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1]!).sort();
  if (iso.length) return iso[iso.length - 1]!;
  const m = /\b([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}),? (\d{4})\b/.exec(source);
  const mon = m ? MONTHS.indexOf(m[1]!.toLowerCase()) : -1;
  return m && mon >= 0 ? `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null;
}

/** Parse the Compendium's "all rulings" page into rulings, in page order (newest first). Throws on a page with none. */
export function parseRulingsHtml(html: string): Ruling[] {
  const out: Ruling[] = [];
  const chunks = html.split('<div class="entry-summary">').slice(1);
  for (const chunk of chunks) {
    const id = /class="ruling-(\d+)"/.exec(chunk)?.[1];
    if (!id) continue;
    const catHtml = /<div class="ruling-categories">([\s\S]*?)<\/div>/.exec(chunk)?.[1] ?? '';
    const paths: string[] = [];
    const categories: string[] = [];
    // Each "|"-separated group is "Top » Leaf"; a group can be just "Top".
    for (const group of catHtml.split(/\s\|\s/)) {
      const names = [...group.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((m) => htmlToText(m[1]!));
      if (!names.length) continue;
      paths.push(names.join(' » '));
      categories.push(names[names.length - 1]!);
    }
    const qm = /<dt>([\s\S]*?)<\/dt>/.exec(chunk);
    const answers = [...chunk.matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map((m) => htmlToText(m[1]!));
    const srcHtml = /<div id="source">[\s\S]*?Source: <\/span>([\s\S]*?)<\/div>/.exec(chunk)?.[1] ?? '';
    const source = htmlToText(srcHtml).replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/,\s*$/, '').trim();
    out.push({
      id: Number(id),
      date: sourceDate(source),
      categories: [...new Set(categories)],
      paths: [...new Set(paths)],
      q: qm ? htmlToText(qm[1]!) : null,
      a: answers.join('\n\n'),
      source,
    });
  }
  if (!out.length) throw new Error('no rulings found in the page: did the Compendium change its markup?');
  return out;
}

const norm = (s: string) => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/é/g, 'e').toLowerCase().replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How a ruling relates to a set of names (a card's name plus its attack and Ability names):
 *  'category': filed under one of the names (the Compendium's own index, the strong signal);
 *  'text':     one of the names appears in the question or answer, spelled as printed with word boundaries
 *              (weaker: a common word like "Switch" can match unrelated prose);
 *  null:       neither.
 */
export function rulingMatch(r: Ruling, names: readonly string[]): { by: 'category' | 'text'; name: string } | null {
  const cats = new Set(r.categories.map(norm));
  for (const n of names) if (cats.has(norm(n))) return { by: 'category', name: n };
  const text = `${r.q ?? ''}\n${r.a}`.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
  for (const n of names) {
    const pn = n.replace(/[‘’ʼ]/g, "'");
    if (pn.length >= 4 && new RegExp(`(?<![\\p{L}\\p{N}])${esc(pn)}(?![\\p{L}\\p{N}])`, 'u').test(text)) return { by: 'text', name: n };
  }
  return null;
}

/** Looser matching used to attach rulings to a card in a lane file (the old behaviour): filed under the name, or the question names it. */
export function rulingsNamingCard(rulings: readonly Ruling[], name: string): Ruling[] {
  const n = norm(name);
  return rulings.filter((r) => r.categories.some((c) => norm(c) === n) || norm(r.q ?? '').includes(n));
}

/** What the repo keeps of a ruling: no question or answer text (that stays on the Compendium), only enough to find and re-check it. */
export interface RulingIndexEntry {
  id: number;
  date: string | null;
  /** The card / attack / Ability names it is filed under. */
  categories: string[];
  source: string;
  /** 16 hex chars of a hash of question + answer: a changed hash means the ruling was edited. */
  hash: string;
}

/** Two 32-bit FNV-1a passes (different seeds) over question + answer, as 16 hex chars. Not cryptographic; change detection only. */
export function rulingHash(q: string | null, a: string): string {
  const text = `${q ?? ''}
${a}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function toIndexEntry(r: Ruling): RulingIndexEntry {
  return { id: r.id, date: r.date, categories: r.categories, source: r.source, hash: rulingHash(r.q, r.a) };
}

/** Compendium ruling ids cited in some source text: `compendium.pokegym.net/ruling/<id>` (with or without the trailing slash) and `Compendium #<id>`. */
export function citedRulingIds(text: string): Set<number> {
  const ids = new Set<number>();
  for (const m of text.matchAll(/compendium\.pokegym\.net\/ruling\/(\d+)/g)) ids.add(Number(m[1]));
  for (const m of text.matchAll(/Compendium #(\d+)/g)) ids.add(Number(m[1]));
  // "Compendium #12, #34" and "Compendium #12 and #34"
  for (const m of text.matchAll(/Compendium #\d+((?:\s*(?:,|and|&)\s*#\d+)+)/g)) for (const x of m[1]!.matchAll(/#(\d+)/g)) ids.add(Number(x[1]));
  return ids;
}
