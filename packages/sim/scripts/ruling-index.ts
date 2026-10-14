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
  for (const m of text.matchAll(/\band \/(\d{1,4})\//g)) ids.add(Number(m[1]));
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

/** Card-script comments that cite a ruling: the text after the citation, with its continuation lines. */
function fromScripts(add: (id: number, summary: string) => void): void {
  const dirs = [join(ROOT, 'src', 'cards', 'scripts'), join(ROOT, 'src', 'cards', 'frames-extra')];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const lines = readFileSync(join(dir, f), 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const c = line.indexOf('//');
        if (c < 0 || !/compendium\.pokegym\.net\/ruling\/\d/i.test(line)) continue;
        const ids = idsIn(line);
        // The summary starts after the citation's closing "):" when there is one, else after the last URL.
        let body = line.slice(c + 2);
        const close = body.lastIndexOf('):');
        if (close >= 0) body = body.slice(close + 2);
        else body = body.replace(/^.*compendium\.pokegym\.net\/ruling\/\d+\/?\)?/i, '');
        // Continuation: following comment-only lines that do not start a new citation.
        for (let j = i + 1; j < lines.length && body.length < SUMMARY_MAX; j++) {
          const next = lines[j]!.trim();
          if (!next.startsWith('//') || /compendium\.pokegym\.net\/ruling\//i.test(next)) break;
          body += ' ' + next.slice(2);
        }
        const summary = clean(body);
        if (summary.length < 12) continue;
        for (const id of ids) add(id, summary);
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
