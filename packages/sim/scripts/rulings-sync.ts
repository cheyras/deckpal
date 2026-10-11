/**
 * Download the Pokémon Rulings Compendium's full "all rulings by date" list, keep an INDEX of it in the repo (no question or
 * answer text), and report the rulings that are NEW or CHANGED since the last index AND name a card the simulator scripts. That report is the to-do
 * list after every TPCi FAQ update: for each ruling it shows the script file and whether a test (or the script itself)
 * already cites it.
 *
 *   node --import tsx scripts/rulings-sync.ts                 # fetch, report new rulings on scripted cards, update the index
 *   node --import tsx scripts/rulings-sync.ts --no-write      # same, but leave the index as it is (the next run reports again)
 *   node --import tsx scripts/rulings-sync.ts --all           # report every ruling on a scripted card, not only the new ones
 *   node --import tsx scripts/rulings-sync.ts --uncited       # EVERY ruling on a scripted card that no test cites (not only the new ones)
 *   node --import tsx scripts/rulings-sync.ts --verbose       # print every row of --all / --uncited / the first run (default: first 60). The new/changed report is always printed in full
 *   node --import tsx scripts/rulings-sync.ts --from page.html   # parse a saved copy of the page instead of fetching
 *
 * Index: packages/sim/data/rulings-compendium.json (one entry per line, newest first): id, date, the card / attack / Ability
 * names it is filed under, the source label and a hash of question + answer. The text itself is not republished here: it
 * stays on compendium.pokegym.net, is downloaded each run, used in memory (name matching, this report) and printed below.
 * "New" = the id is not in the previous index; "changed" = same id, different hash (the Compendium edited it).
 *
 * "Names a scripted card": the ruling is filed under the card's name or one of its attack / Ability names (match
 * "category", the strong signal), or the card's name appears in its question or answer ("text", weaker: read it).
 * "Cited": a test under src/__tests__ contains `compendium.pokegym.net/ruling/<id>` or `Compendium #<id>`; a script
 * or other source file citing it is reported separately. One GET, no crawling.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allScripts } from '../src/cards/registry.js';
import { citedRulingIds, parseRulingsHtml, rulingMatch, toIndexEntry, type Ruling, type RulingIndexEntry } from '../src/maintenance/rulings.js';
import { getText } from './lib/net.js';

const here = dirname(fileURLToPath(import.meta.url));
const SIM = join(here, '..');
const SNAPSHOT = join(SIM, 'data', 'rulings-compendium.json');
const PAGE = 'https://compendium.pokegym.net/all-rulings-by-date/';
const argv = process.argv.slice(2);
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const ALL_ = argv.includes('--all');
const NO_WRITE = argv.includes('--no-write') || ALL_ || argv.includes('--uncited'); // a listing run never advances the index: only the full new/changed report does
const ALL = argv.includes('--all');
const UNCITED = argv.includes('--uncited');
const VERBOSE = argv.includes('--verbose');
const FROM = flag('--from');

// 1. The page, parsed.
const html = FROM ? readFileSync(FROM, 'utf8') : await getText(PAGE, { timeoutMs: 180_000 });
const rulings = parseRulingsHtml(html).sort((a, b) => b.id - a.id);
if (new Set(rulings.map((r) => r.id)).size !== rulings.length) throw new Error('duplicate ruling ids in the page');
const missingAnswer = rulings.filter((r) => !r.a);
console.log(`Compendium: ${rulings.length} rulings (ids ${rulings[rulings.length - 1]!.id}..${rulings[0]!.id}), ${rulings.filter((r) => r.q).length} with a question, ${rulings.filter((r) => r.date).length} dated, ${missingAnswer.length} without an answer`);

// 2. The previous index.
interface Snapshot { rulings: RulingIndexEntry[] }
const prev: Snapshot | null = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Snapshot) : null;
const known = new Map(prev?.rulings.map((r) => [r.id, r.hash]) ?? []);
const index = rulings.map(toIndexEntry);
const hashOf = new Map(index.map((e) => [e.id, e.hash]));
const fresh = rulings.filter((r) => known.get(r.id) !== hashOf.get(r.id));
const nChanged = fresh.filter((r) => known.has(r.id)).length;
console.log(prev ? `previous index: ${prev.rulings.length} rulings; ${fresh.length - nChanged} new, ${nChanged} changed` : 'no previous index: every ruling counts as new');

// 3. Which scripted cards each ruling names; which are cited.
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : files(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
const srcFiles = files(join(SIM, 'src'));
const inTests = new Set<number>();
const inCode = new Set<number>();
for (const f of srcFiles) {
  const ids = citedRulingIds(readFileSync(f, 'utf8'));
  for (const id of ids) (/[\\/]__tests__[\\/]/.test(f) ? inTests : inCode).add(id);
}
const scriptFile = new Map<string, string>();
for (const f of srcFiles.filter((x) => /[\\/]cards[\\/]scripts[\\/]/.test(x))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/\bid:\s*'([^']+)'/g)) if (!scriptFile.has(m[1]!)) scriptFile.set(m[1]!, f.slice(SIM.length + 1).replace(/\\/g, '/'));
}
const cards = allScripts().map((s) => ({
  id: s.id,
  name: s.name,
  file: scriptFile.get(s.id) ?? '?',
  names: [...new Set([s.name, ...Object.keys(s.attacks ?? {}), ...(s.abilities ?? []).map((a) => a.name)])],
}));
interface Row { ruling: Ruling; by: 'category' | 'text'; cards: { id: string; name: string; file: string; via: string }[]; test: boolean; code: boolean }
function rows(list: Ruling[]): Row[] {
  const out: Row[] = [];
  for (const r of list) {
    const hits = cards.flatMap((c) => {
      const m = rulingMatch(r, c.names);
      return m ? [{ c, m }] : [];
    });
    if (!hits.length) continue;
    // A category hit beats any number of text hits: if the Compendium files it under a name, only those cards are named.
    const strong = hits.filter((h) => h.m.by === 'category');
    const use = strong.length ? strong : hits;
    out.push({ ruling: r, by: strong.length ? 'category' : 'text', cards: use.map((h) => ({ id: h.c.id, name: h.c.name, file: h.c.file, via: h.m.name })), test: inTests.has(r.id), code: inCode.has(r.id) });
  }
  return out;
}

const DELTA = !ALL && !UNCITED && !!prev; // the report of what is new / changed since the last index
const scope = DELTA ? fresh : rulings;
const hit = rows(scope);
const everyHit = DELTA ? rows(rulings) : hit;
const count = (rs: Row[]) => `${rs.length} (category ${rs.filter((r) => r.by === 'category').length}, text ${rs.filter((r) => r.by === 'text').length}; cited in a test ${rs.filter((r) => r.test).length}, only in a script ${rs.filter((r) => !r.test && r.code).length}, uncited ${rs.filter((r) => !r.test && !r.code).length})`;
console.log(`scripted cards: ${cards.length}; rulings anywhere citing a Compendium id: tests ${inTests.size}, other source ${inCode.size}`);
console.log(`ALL ${rulings.length} rulings: ${count(everyHit)} name a scripted card`);
console.log(`${DELTA ? 'NEW/CHANGED' : 'REPORTED'} rulings (${scope.length}): ${count(hit)} name a scripted card`);

const shown = hit.filter((r) => !UNCITED || !r.test);
console.log(`\n${shown.length} row(s)${UNCITED ? ' not cited by a test' : ''}${VERBOSE || DELTA || shown.length <= 60 ? '' : ' (first 60; --verbose for all)'}:`);
// The delta is always printed in full: the index advances after this run, so a row dropped here would never be reported again.
for (const r of VERBOSE || DELTA ? shown : shown.slice(0, 60)) {
  const cites = r.test ? 'test' : r.code ? 'script only' : 'UNCITED';
  const kind = DELTA ? (known.has(r.ruling.id) ? 'CHANGED ' : 'NEW ') : '';
  const who = r.cards.slice(0, 4).map((c) => `${c.name} (${c.id}, ${c.file})`).join('; ') + (r.cards.length > 4 ? ` +${r.cards.length - 4} more` : '');
  console.log(`  #${r.ruling.id} ${r.ruling.date ?? '----------'} [${kind}${r.by}, ${cites}] ${who}\n      ${(r.ruling.q ?? r.ruling.a).replace(/\s+/g, ' ').slice(0, 150)}`);
}

// 4. The index (no ruling text).
if (!NO_WRITE) {
  const same = prev && prev.rulings.length === rulings.length && JSON.stringify(prev.rulings) === JSON.stringify(index);
  if (same) console.log('\nindex unchanged.');
  else {
    const header = {
      _comment:
        "Index of the Pokémon Rulings Compendium's 'all rulings by date' page (https://compendium.pokegym.net/all-rulings-by-date/). It holds no ruling text: the questions and answers (TPCi Rules Team / Japanese Q&A as published by the Compendium) stay on compendium.pokegym.net/ruling/<id>/. Each entry is the ruling id, its date, the card / attack / Ability names it is filed under, its source label, and a hash of question + answer so scripts/rulings-sync.ts can tell when a ruling is new or was edited. Do not edit by hand.",
      source: PAGE,
      fetchedOn: new Date().toISOString().slice(0, 10),
      count: rulings.length,
    };
    const body = `{\n${Object.entries(header).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}\n "rulings": [\n${index.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n ]\n}\n`;
    mkdirSync(dirname(SNAPSHOT), { recursive: true });
    writeFileSync(SNAPSHOT, body);
    console.log(`\nwrote ${SNAPSHOT.slice(SIM.length + 1).replace(/\\/g, '/')} (${rulings.length} rulings).`);
  }
}
