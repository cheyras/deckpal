/**
 * Regenerate the three card-data tables the DeckPal catalog does not carry, from pokemontcg.io's public API:
 *   src/cards/tera.ts        Tera Pokémon printings              (q=subtypes:Tera)
 *   src/cards/tags.ts        Ancient / Future tags               (q=subtypes:Ancient, q=subtypes:Future)
 *   src/cards/printed-wr.ts  printed Weakness / Resistance for Pokémon printings whose catalog frame has neither
 *                            (q=set.id:<id> supertype:pokemon, only for sets that have such a printing)
 *
 *   node --import tsx scripts/refresh-card-tables.ts            # dry run: fetch, print a diff summary, write nothing
 *   node --import tsx scripts/refresh-card-tables.ts --write    # rewrite the three files
 *   node --import tsx scripts/refresh-card-tables.ts --check    # dry run that exits 1 on any difference or problem
 *
 * Read-only GETs only (pokemontcg.io, deckpal.app/api), one at a time with a pause. SIM_FETCH_CACHE=<dir> caches them.
 *
 * Every pokemontcg.io entry is matched against the FULL DeckPal catalog (every printing of every Scarlet & Violet /
 * Mega Evolution era set, from GET /search), NOT the sim's frame snapshot, which keeps one printing per distinct
 * text. (Matching against the snapshot once left 184 printings without a Weakness.) An entry is written only when the
 * mapped id exists in the catalog AND the names agree; everything else is listed under "problems" and left out.
 *
 * The set map (pokemontcg.io id -> ours) is derived by rule from the id (sv5 -> sv05, sv6pt5 -> sv06.5, me2pt5 ->
 * me02.5) plus PTCG_SET_OVERRIDES in src/maintenance/tables.ts for the irregular ones (zsv10pt5 -> sv10.5b,
 * rsv10pt5 -> sv10.5w, svp, sve, mep, mee). A pokemontcg.io set this cannot map is printed under "unmapped sets":
 * add it to PTCG_SET_OVERRIDES. The header and footer prose of each file is kept as it is, only the data is replaced.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PRINTED_WR } from '../src/cards/printed-wr.js';
import { CARD_TAGS } from '../src/cards/tags.js';
import { TERA_PRINTINGS } from '../src/cards/tera.js';
import { diffTables, normName, ptcgCardToOurs, ptcgSetToOurs, renderPrintedWR, renderTags, renderTera, type WRTable } from '../src/maintenance/tables.js';
import { catalogPrintings, catalogSets, pokemonWithoutWeaknessOrResistance, standardMarks } from './lib/catalog.js';
import { getJson } from './lib/net.js';

const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');
const CARDS = new URL('../src/cards/', import.meta.url);
const PTCG = 'https://api.pokemontcg.io/v2';

interface PtcgCard {
  id: string;
  name: string;
  number: string;
  set: { id: string };
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
}
async function ptcgCards(q: string, select: string): Promise<PtcgCard[]> {
  const out: PtcgCard[] = [];
  for (let page = 1; ; page++) {
    const r = await getJson<{ data: PtcgCard[]; totalCount: number }>(`${PTCG}/cards?q=${encodeURIComponent(q)}&pageSize=250&page=${page}&select=${select}`, { timeoutMs: 120_000 });
    out.push(...r.data);
    if (out.length >= r.totalCount || !r.data.length) return out;
  }
}

/** Mismatches that mean a table entry would be wrong (fail --check). */
const problems: string[] = [];
/** Upstream simply lacks the data (a new set not on pokemontcg.io yet): reported, does not fail --check. */
const gaps: string[] = [];
const marks = standardMarks();
console.log(`Standard marks (formats.json): ${marks.join(', ')}`);

// 1. The full catalog, recent sets.
const sets = await catalogSets();
const printings = await catalogPrintings(sets);
const byId = new Map(printings.map((p) => [p.cardId, p]));
const ourSets = new Set(sets.map((s) => s.setId));
const standard = printings.filter((p) => p.mark && marks.includes(p.mark));
console.log(`catalog: ${sets.length} recent sets, ${printings.length} printings, ${standard.length} Standard printings`);

// 2. Set map check: every recent pokemontcg.io set must map to one of ours.
const ptcgSets = (await getJson<{ data: { id: string; name: string; releaseDate: string }[] }>(`${PTCG}/sets?select=id,name,releaseDate&pageSize=250`)).data;
const ptcgOfOurs = new Map<string, string>();
const unmapped: string[] = [];
for (const s of ptcgSets.filter((x) => x.releaseDate >= '2023/01/01')) {
  const ours = ptcgSetToOurs(s.id);
  if (ours && ourSets.has(ours)) ptcgOfOurs.set(ours, s.id);
  else unmapped.push(`${s.id} (${s.name})${ours ? ` -> ${ours}, not in the catalog` : ''}`);
}
if (unmapped.length) console.log(`unmapped sets (add to PTCG_SET_OVERRIDES if they matter): ${unmapped.join('; ')}`);

/** A pokemontcg.io card -> our printing id, or null (reason pushed to problems) when it does not match. */
function match(c: PtcgCard, what: string): string | null {
  const id = ptcgCardToOurs(c.set.id, c.number);
  if (!id) {
    problems.push(`${what}: ${c.id} "${c.name}" is in set ${c.set.id}, which has no mapping`);
    return null;
  }
  const p = byId.get(id);
  if (!p) {
    problems.push(`${what}: ${c.id} "${c.name}" maps to ${id}, which is not in the catalog`);
    return null;
  }
  if (normName(p.name) !== normName(c.name)) {
    problems.push(`${what}: ${c.id} is "${c.name}" but the catalog's ${id} is "${p.name}"`);
    return null;
  }
  return id;
}

// 3. Tera and Ancient / Future.
const tera = new Set<string>();
for (const c of await ptcgCards('subtypes:Tera', 'id,name,set,number')) {
  const id = match(c, 'Tera');
  if (id) tera.add(id);
}
const tags: Record<string, 'Ancient' | 'Future'> = {};
for (const tag of ['Ancient', 'Future'] as const) {
  for (const c of await ptcgCards(`subtypes:${tag}`, 'id,name,set,number')) {
    const id = match(c, tag);
    if (!id) continue;
    if (tags[id] && tags[id] !== tag) problems.push(`${tag}: ${id} is tagged both ${tags[id]} and ${tag}`);
    tags[id] = tag;
  }
}

// 4. Printed Weakness / Resistance for Standard Pokémon the catalog gives neither.
const wr: WRTable = {};
let noUpstream = 0;
const standardSetIds = [...new Set(standard.map((p) => p.setId))];
for (const setId of standardSetIds) {
  const lacking = (await pokemonWithoutWeaknessOrResistance(setId)).filter((p) => p.mark && marks.includes(p.mark));
  if (!lacking.length) continue;
  const ptcgId = ptcgOfOurs.get(setId);
  if (!ptcgId) {
    gaps.push(`W/R: ${lacking.length} printings of ${setId} (${lacking.map((p) => p.cardId).join(' ')}) lack Weakness/Resistance and the set has no pokemontcg.io mapping (not published there yet, or add it to PTCG_SET_OVERRIDES)`);
    continue;
  }
  const upstream = new Map<string, PtcgCard>();
  for (const c of await ptcgCards(`set.id:${ptcgId} supertype:pokemon`, 'id,name,number,set,weaknesses,resistances,types')) {
    const id = ptcgCardToOurs(c.set.id, c.number);
    if (id) upstream.set(id, c);
  }
  for (const p of lacking) {
    const c = upstream.get(p.cardId);
    if (!c) {
      gaps.push(`W/R: ${p.cardId} "${p.name}" is not on pokemontcg.io set ${ptcgId}`);
      continue;
    }
    if (normName(c.name) !== normName(p.name)) {
      problems.push(`W/R: ${c.id} is "${c.name}" but the catalog's ${p.cardId} is "${p.name}"`);
      continue;
    }
    if (!c.weaknesses?.length && !c.resistances?.length) {
      noUpstream++;
      continue;
    }
    wr[p.cardId] = { weaknesses: (c.weaknesses ?? []).map((w) => ({ type: w.type, value: w.value })), resistances: (c.resistances ?? []).map((w) => ({ type: w.type, value: w.value })) };
  }
}

// A rotation never drops a Weakness/Resistance entry: a rotated printing still plays (Expanded), and removing its
// entry would change its text key (cards/frame.ts textKey includes Weakness/Resistance). Only printings that are
// Standard now are recomputed; an entry for one that is no longer Standard is kept as it is.
let keptRotated = 0;
for (const [id, v] of Object.entries(PRINTED_WR as WRTable)) {
  const p = byId.get(id);
  if (id in wr || (p?.mark && marks.includes(p.mark))) continue;
  wr[id] = v;
  keptRotated++;
  if (!p) gaps.push(`W/R: kept ${id}, which is no longer in the catalog`);
}
if (keptRotated) console.log(`printed W/R: kept ${keptRotated} entries for printings that are not Standard now (rotated)`);

// 5. Diff against the committed tables, then write.
const read = (f: string) => readFileSync(new URL(f, CARDS), 'utf8');
const out = {
  'tera.ts': renderTera(read('tera.ts'), tera),
  'tags.ts': renderTags(read('tags.ts'), tags),
  'printed-wr.ts': renderPrintedWR(read('printed-wr.ts'), wr),
};
const asObj = (s: Iterable<string>) => Object.fromEntries([...s].map((x) => [x, true]));
const diffs = {
  'tera.ts': diffTables(asObj(TERA_PRINTINGS), asObj(tera)),
  'tags.ts': diffTables(CARD_TAGS, tags),
  'printed-wr.ts': diffTables(PRINTED_WR as WRTable, wr),
};
const show = (xs: string[]) => (xs.length > 40 ? `${xs.slice(0, 40).join(' ')} ... (+${xs.length - 40})` : xs.join(' '));
let changed = false;
for (const [file, text] of Object.entries(out)) {
  const same = text === read(file).replace(/\r\n/g, '\n');
  const d = diffs[file as keyof typeof diffs];
  console.log(`\n${file}: ${same ? 'unchanged' : 'CHANGED'}  (added ${d.added.length}, removed ${d.removed.length}, changed ${d.changed.length})`);
  if (d.added.length) console.log(`  added:   ${show(d.added)}`);
  if (d.removed.length) console.log(`  removed: ${show(d.removed)}`);
  if (d.changed.length) console.log(`  changed: ${show(d.changed)}`);
  if (!same) {
    changed = true;
    if (WRITE) writeFileSync(new URL(file, CARDS), text);
  }
}
console.log(`\nprinted W/R: ${Object.keys(wr).length} printings in the table; ${noUpstream} Standard Pokémon printings lack W/R in the catalog AND on pokemontcg.io (nothing to write)`);
console.log(`gaps (upstream lacks the data; do not fail --check): ${gaps.length}${gaps.length ? '\n  ' + gaps.join('\n  ') : ''}`);
console.log(`problems: ${problems.length}${problems.length ? '\n  ' + problems.join('\n  ') : ''}`);
console.log(WRITE ? (changed ? '\nwrote the changed files; now run the full test suite and the coverage gate (CARDS.md, "New set").' : '\nnothing to write.') : changed ? '\n(dry run) re-run with --write to apply.' : '\nidentical to the committed tables.');
if (CHECK && (changed || problems.length)) process.exitCode = 1;
