/**
 * Regenerate the three card-data tables the DeckPal catalog does not carry, from pokemontcg.io's public API:
 *   src/cards/tera.ts        Tera Pokémon printings              (q=subtypes:Tera)
 *   src/cards/tags.ts        Ancient / Future tags               (q=subtypes:Ancient, q=subtypes:Future)
 *   src/cards/printed-wr.ts  printed Weakness / Resistance for Pokémon printings whose catalog frame has neither
 *                            (q=set.id:<id> supertype:pokemon, only for sets that have such a printing)
 *
 *   node --import tsx scripts/refresh-card-tables.ts                    # dry run: fetch, print a diff summary, write nothing
 *   node --import tsx scripts/refresh-card-tables.ts --write            # rewrite the three files
 *   node --import tsx scripts/refresh-card-tables.ts --check            # dry run that exits 1 on any difference or problem
 *   node --import tsx scripts/refresh-card-tables.ts --write --allow-removals   # also let Tera / tag entries upstream dropped go
 *
 * Read-only GETs only (pokemontcg.io, deckpal.app/api), one at a time with a pause. SIM_FETCH_CACHE=<dir> caches them.
 *
 * Every pokemontcg.io entry is matched against the FULL DeckPal catalog (every printing of every Scarlet & Violet /
 * Mega Evolution era set, from GET /search), NOT the sim's frame snapshot, which keeps one printing per distinct
 * text. (Matching against the snapshot once left 184 printings without a Weakness.) The decision logic is
 * src/maintenance/refresh.ts (unit-tested on fixtures).
 *
 * Nothing is written when validation found a problem (an upstream entry whose set is unmapped, whose id is not in the
 * catalog, or whose name differs): all three files stay as they are, so an upstream rename cannot silently drop an
 * entry that is right today. Existing Weakness/Resistance entries are kept for printings upstream does not (yet) resolve;
 * they go only when the catalog now supplies the data itself. Tera / tag entries upstream no longer lists need
 * --allow-removals.
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
import { buildTables, type Printing, type PtcgCard } from '../src/maintenance/refresh.js';
import { diffTables, ptcgSetToOurs, renderPrintedWR, renderTags, renderTera, type WRTable } from '../src/maintenance/tables.js';
import { catalogPrintings, catalogSets, pokemonWithoutWeaknessOrResistance, standardMarks } from './lib/catalog.js';
import { getJson } from './lib/net.js';

const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');
const ALLOW_REMOVALS = process.argv.includes('--allow-removals');
const CARDS = new URL('../src/cards/', import.meta.url);
const PTCG = 'https://api.pokemontcg.io/v2';

async function ptcgCards(q: string, select: string): Promise<PtcgCard[]> {
  const out: PtcgCard[] = [];
  for (let page = 1; ; page++) {
    const r = await getJson<{ data: PtcgCard[]; totalCount: number }>(`${PTCG}/cards?q=${encodeURIComponent(q)}&pageSize=250&page=${page}&select=${select}`, { timeoutMs: 120_000 });
    out.push(...r.data);
    if (out.length >= r.totalCount || !r.data.length) return out;
  }
}

const marks = standardMarks();
console.log(`Standard marks (formats.json): ${marks.join(', ')}`);

// 1. The full catalog, recent sets.
const sets = await catalogSets();
const printings = await catalogPrintings(sets);
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

// 3. What pokemontcg.io says.
const tera = await ptcgCards('subtypes:Tera', 'id,name,set,number');
const tags = { Ancient: await ptcgCards('subtypes:Ancient', 'id,name,set,number'), Future: await ptcgCards('subtypes:Future', 'id,name,set,number') };
const lacking = new Map<string, Printing[]>();
const wrUpstream = new Map<string, PtcgCard[]>();
for (const setId of [...new Set(standard.map((p) => p.setId))]) {
  const l = (await pokemonWithoutWeaknessOrResistance(setId)).filter((p) => p.mark && marks.includes(p.mark));
  lacking.set(setId, l);
  const ptcgId = ptcgOfOurs.get(setId);
  if (l.length && ptcgId) wrUpstream.set(setId, await ptcgCards(`set.id:${ptcgId} supertype:pokemon`, 'id,name,number,set,weaknesses,resistances,types'));
}

// 4. Build and validate the complete candidate.
const r = buildTables({ marks, printings, tera, tags, lacking, wrUpstream, existing: { tera: TERA_PRINTINGS, tags: CARD_TAGS, wr: PRINTED_WR as WRTable } });

// 5. Diff against the committed tables.
const read = (f: string) => readFileSync(new URL(f, CARDS), 'utf8');
const out = {
  'tera.ts': renderTera(read('tera.ts'), r.tera),
  'tags.ts': renderTags(read('tags.ts'), r.tags),
  'printed-wr.ts': renderPrintedWR(read('printed-wr.ts'), r.wr),
};
const asObj = (s: Iterable<string>) => Object.fromEntries([...s].map((x) => [x, true]));
const diffs = {
  'tera.ts': diffTables(asObj(TERA_PRINTINGS), asObj(r.tera)),
  'tags.ts': diffTables(CARD_TAGS, r.tags),
  'printed-wr.ts': diffTables(PRINTED_WR as WRTable, r.wr),
};
const show = (xs: string[]) => (xs.length > 40 ? `${xs.slice(0, 40).join(' ')} ... (+${xs.length - 40})` : xs.join(' '));
let changed = false;
const toWrite: [string, string][] = [];
for (const [file, text] of Object.entries(out)) {
  const same = text === read(file).replace(/\r\n/g, '\n');
  const d = diffs[file as keyof typeof diffs];
  console.log(`\n${file}: ${same ? 'unchanged' : 'CHANGED'}  (added ${d.added.length}, removed ${d.removed.length}, changed ${d.changed.length})`);
  if (d.added.length) console.log(`  added:   ${show(d.added)}`);
  if (d.removed.length) console.log(`  removed: ${show(d.removed)}`);
  if (d.changed.length) console.log(`  changed: ${show(d.changed)}`);
  if (!same) {
    changed = true;
    toWrite.push([file, text]);
  }
}
if (r.keptRotated) console.log(`\nprinted W/R: kept ${r.keptRotated} entries for printings that are not Standard now (rotated)`);
if (r.keptUnresolved) console.log(`printed W/R: kept ${r.keptUnresolved} entries for Standard printings pokemontcg.io does not resolve (removal not verified)`);
console.log(`printed W/R: ${Object.keys(r.wr).length} printings in the table; ${r.noUpstream} Standard Pokémon printings lack W/R in the catalog AND on pokemontcg.io (nothing to write)`);
console.log(`gaps (upstream lacks the data; do not fail --check): ${r.gaps.length}${r.gaps.length ? '\n  ' + r.gaps.join('\n  ') : ''}`);
console.log(`problems: ${r.problems.length}${r.problems.length ? '\n  ' + r.problems.join('\n  ') : ''}`);
for (const u of r.unverifiedRemovals) console.log(`removals not verified (${u.table}): ${show(u.ids)}`);

const blocked = r.problems.length > 0 || (r.unverifiedRemovals.length > 0 && !ALLOW_REMOVALS);
if (WRITE && blocked) {
  console.log(`\nNOT WRITTEN: ${r.problems.length ? 'validation found problems (above); fix the mapping in PTCG_SET_OVERRIDES or the catalog first.' : 'Tera / tag entries would be removed; re-run with --allow-removals once the removal is verified.'} No file was changed.`);
  process.exitCode = 1;
} else if (WRITE) {
  for (const [file, text] of toWrite) writeFileSync(new URL(file, CARDS), text);
  console.log(changed ? '\nwrote the changed files; now run the full test suite and the coverage gate (CARDS.md, "New set").' : '\nnothing to write.');
} else console.log(changed ? '\n(dry run) re-run with --write to apply.' : '\nidentical to the committed tables.');
if (CHECK && (changed || r.problems.length)) process.exitCode = 1;
