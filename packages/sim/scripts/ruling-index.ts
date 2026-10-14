/**
 * Builds src/rulingIndex.ts: every official ruling the Compendium lists (data/rulings-compendium.json — id, date, source and
 * the card / attack / Ability names it is filed under), joined with the one-line summaries the simulator already writes in
 * its own words wherever a ruling is pinned: test names ("Compendium #2425: …", "… (ruling 2200): …") and the comments on
 * card scripts ("// Ruling (…, https://compendium.pokegym.net/ruling/2257/): …").
 *
 * No ruling text is copied. The questions and answers stay on compendium.pokegym.net; summaries are ours (#334 paraphrased the
 * last quoted ones), and an entry with no summary carries only its link.
 *
 *   node --import tsx scripts/ruling-index.ts          write src/rulingIndex.ts
 *   node --import tsx scripts/ruling-index.ts --check  exit 1 if it is stale (also run by rulingIndex.test.ts)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src', 'rulingIndex.ts');
const SUMMARY_MAX = 280;

interface CompendiumEntry { id: number; date: string; categories: string[]; source: string }
export interface BuiltEntry { id: number; date: string; source: string; categories: string[]; summaries: string[] }

const clean = (s: string): string => {
  let t = s
    .replace(/\(?https?:\/\/\S+?\)?(?=[\s,;:.]|$)/g, '')
    // A citation a test name wrote without its scheme ("compendium.pokegym.net/ruling/2417/)").
    .replace(/\(?(?:compendium)?\.?pokegym\.net\/ruling\/\d+\/?\)?/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\\(['"`])/g, '$1')
    .trim();
  t = t.replace(/^[-–—:;,.\s]+/, '').replace(/[\s,;:]+$/, '');
  return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : t;
};

/** Every ruling id a line names. */
function idsIn(text: string): number[] {
  const ids = new Set<number>();
  for (const m of text.matchAll(/compendium\.pokegym\.net\/ruling\/(\d{1,4})/gi)) ids.add(Number(m[1]));
  for (const m of text.matchAll(/(?:\band |(?:\.\.\.|…))\/(\d{1,4})\//g)) ids.add(Number(m[1]));
  for (const m of text.matchAll(/(?:Compendium #|\bRuling #?|\brulings? )(\d{1,4}(?:\s*(?:,|and)\s*\d{1,4})*)/gi)) {
    for (const n of m[1]!.split(/\s*(?:,|and)\s*/)) if (n) ids.add(Number(n));
  }
  return [...ids];
}

/** Test names that cite a ruling: the name, minus a leading "Compendium #N:" / "Ruling N:". */
function fromTests(add: (id: number, summary: string) => void): void {
  const dir = join(ROOT, 'src', '__tests__');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.test.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/^test\((['"`])((?:\\.|(?!\1).)*)\1/gm)) {
      const name = m[2]!;
      const ids = idsIn(name);
      if (ids.length === 0) continue;
      const summary = clean(name.replace(/^(?:Compendium #|Ruling #?)\d{1,4}(?:\s*(?:,|and)\s*\d{1,4})*\s*[:\-–—]?\s*/i, ''));
      for (const id of ids) add(id, summary);
    }
  }
}

/** One citation: the URL (with any "and /2240/" that shares it), its closing parenthesis and colon. */
const CITATION = /https?:\/\/compendium\.pokegym\.net\/ruling\/\d{1,4}\/?(?:\s*(?:,|and)\s*(?:\.\.\.|…)?\/\d{1,4}\/?)*\)?:?/gi;

/**
 * The explanation each citation in one comment carries. A comment can cite several rulings, each with its own explanation
 * ("Ruling (…/2328/): devolving is not benching. Ruling #2327 (…/2327/): the reminder text is overridden."), so each
 * citation gets the text after it, up to the sentence where the next citation's lead-in begins, and the ids named in its
 * own lead-in. Taking the text after the LAST citation for every id gave #2328 the explanation of #2327 (Astra, #340).
 */
export function citedExplanations(comment: string): Array<{ ids: number[]; text: string }> {
  const cites = [...comment.matchAll(CITATION)];
  const out: Array<{ ids: number[]; text: string }> = [];
  let leadStart = 0;
  for (let k = 0; k < cites.length; k++) {
    const m = cites[k]!;
    const end = m.index! + m[0].length;
    const next = cites[k + 1]?.index ?? comment.length;
    let text = comment.slice(end, next);
    let nextLead = next;
    if (k + 1 < cites.length) {
      // The next citation's lead-in ("Ruling #2327 (") starts after the last sentence end before it.
      const cut = Math.max(text.lastIndexOf('. '), text.lastIndexOf('; '));
      if (cut >= 0) {
        text = text.slice(0, cut + 1);
        nextLead = end + cut + 1;
      } else {
        text = '';
      }
    }
    // A citation whose parenthesis closes after more source text ("(https://…/2327/, TPCi 2026-04-09): …").
    const close = text.indexOf('):');
    if (close >= 0 && close < 80 && !/[.;]/.test(text.slice(0, close))) text = text.slice(close + 2);
    out.push({ ids: idsIn(comment.slice(leadStart, end)), text });
    leadStart = nextLead;
  }
  return out;
}

/**
 * The comment on a source line: a block comment's ` * ` line, or the text after `//` — never the `//` of "https://", which
 * is how a URL inside a string literal used to pass for a comment.
 */
function commentOf(line: string): { text: string; block: boolean } | null {
  const t = line.trimStart();
  if (t.startsWith('*') && !t.startsWith('*/')) return { text: t.replace(/^\*\s?/, ''), block: true };
  if (t.startsWith('/*')) return { text: t.replace(/^\/\*+\s?/, ''), block: true };
  const m = /(?:^|[^:])\/\//.exec(line);
  return m ? { text: line.slice(m.index + m[0].length), block: false } : null;
}

/** Card-script comments that cite a ruling: the text after each citation, with the comment's continuation lines. */
function fromScripts(add: (id: number, summary: string) => void): void {
  const dirs = [join(ROOT, 'src', 'cards', 'scripts'), join(ROOT, 'src', 'cards', 'frames-extra')];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const lines = readFileSync(join(dir, f), 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const c = commentOf(lines[i]!);
        if (!c || !/compendium\.pokegym\.net\/ruling\/\d/i.test(c.text)) continue;
        let comment = c.text;
        // Continuation: following lines of the same comment that do not start a new citation.
        for (let j = i + 1; j < lines.length && comment.length < SUMMARY_MAX * 2; j++) {
          const raw = lines[j]!.trim();
          const next = commentOf(lines[j]!);
          // A block comment goes on to document other things (a function's arguments), so it continues only to the end of
          // the sentence that cites the ruling.
          const sameKind = c.block
            ? raw.startsWith('*') && !raw.startsWith('*/') && !/[.!?)]\s*$/.test(comment) && next?.text.trim() !== ''
            : raw.startsWith('//');
          if (!next || !sameKind || /compendium\.pokegym\.net\/ruling\//i.test(next.text)) break;
          comment += ' ' + next.text;
        }
        for (const { ids, text } of citedExplanations(comment)) {
          const summary = clean(text);
          if (summary.length < 12) continue;
          for (const id of ids) add(id, summary);
        }
      }
    }
  }
}

export function buildRulingIndex(): BuiltEntry[] {
  const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'rulings-compendium.json'), 'utf8')) as { rulings: CompendiumEntry[] };
  const byId = new Map<number, BuiltEntry>();
  for (const r of raw.rulings) {
    byId.set(r.id, { id: r.id, date: r.date, source: r.source, categories: [...r.categories], summaries: [] });
  }
  const add = (id: number, summary: string): void => {
    const e = byId.get(id);
    // A summary for a ruling the index does not list (an old id, a typo) is dropped: the index is what the link points at.
    if (!e || !summary) return;
    if (!e.summaries.some((s) => s.toLowerCase() === summary.toLowerCase())) e.summaries.push(summary);
  };
  fromTests(add);
  fromScripts(add);
  for (const e of byId.values()) e.summaries.sort();
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

export function renderRulingIndex(entries: BuiltEntry[]): string {
  const body = entries
    .map((e) => `  ${JSON.stringify({ id: e.id, date: e.date, source: e.source, categories: e.categories, summaries: e.summaries })},`)
    .join('\n');
  return `// GENERATED by scripts/ruling-index.ts from data/rulings-compendium.json and the simulator's own ruling summaries.
// Do not edit by hand: run \`node --import tsx scripts/ruling-index.ts\`. rulingIndex.test.ts fails when it is stale.
// Summaries are DeckPal's own one-line wording; the official question and answer live at RULING_URL(id).

export interface RulingIndexEntry {
  id: number;
  date: string;
  source: string;
  categories: readonly string[];
  summaries: readonly string[];
}

export const RULING_URL = (id: number): string => \`https://compendium.pokegym.net/ruling/\${id}/\`;

export const RULING_INDEX: readonly RulingIndexEntry[] = [
${body}
];
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = renderRulingIndex(buildRulingIndex());
  if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
    if (current !== text) {
      console.error('src/rulingIndex.ts is stale: run node --import tsx scripts/ruling-index.ts');
      process.exit(1);
    }
    console.log('src/rulingIndex.ts is current');
  } else {
    writeFileSync(OUT, text);
    const all = buildRulingIndex();
    console.log(`wrote ${all.length} rulings, ${all.filter((e) => e.summaries.length).length} with a DeckPal summary`);
  }
}
