/**
 * Turn the Standard cards that still have no script into scripting batches ("lanes"): one JSON file per batch with, for each
 * card, its canonical id, every printing that shares its text, its printed frame, and the Compendium rulings that name it.
 * The next step is scripts/standard-tiers.ts (routes templated Pokémon to scripts/codegen-cheap.ts, the rest to model
 * lanes), then Sonnet batches with the brief in CARDS.md. (This replaces the old standard-lanes.ts, which took a hand-made
 * frames dump and a hand-made rulings file.)
 *
 *   node --import tsx scripts/new-card-lanes.ts <outDir> [--size 40] [--frames dump.json] [--rulings page.html]
 *
 *   <outDir>/std01.json ...   { lane, cards: [{ id, name, printings, frame, rulings }] }
 *   <outDir>/summary.json     { marks, distinct, todo, lanes: [{ lane, cards, rulings, sets }] }
 *
 * "Standard" is the list of regulation marks in apps/api/src/deck/data/formats.json, read at run time, so a rotation needs
 * no edit here. By default the frames are the repo's snapshot (src/cards/frames*.ts: run scripts/sync-frames.ts first so a new
 * set's printings are in it). The rulings are downloaded from the Compendium for this run (one GET; or a saved copy of the page with --rulings page.html) and written into the lane files only: the repo keeps no ruling text.
 * Lanes are grouped by set so a batch reads one set's cards together. Writes nothing if there is nothing to script.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAMES } from '../src/cards/frames-all.js';
import { gapCategory, standardGap } from '../src/maintenance/gap.js';
import { parseRulingsHtml, rulingMatch, rulingsNamingCard, type Ruling } from '../src/maintenance/rulings.js';
import type { CardFrame } from '../src/types.js';
import { standardMarks } from './lib/catalog.js';
import { getText } from './lib/net.js';

const argv = process.argv.slice(2);
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const outDir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1]!.startsWith('--')));
if (!outDir) {
  console.error('usage: node --import tsx scripts/new-card-lanes.ts <outDir> [--size 40] [--frames dump.json] [--rulings page.html]');
  process.exit(2);
}
const size = Number(flag('--size') ?? 40);
const marks = standardMarks();
const frames: CardFrame[] = flag('--frames') ? Object.values(JSON.parse(readFileSync(flag('--frames')!, 'utf8')) as Record<string, CardFrame>) : Object.values(FRAMES);
const html = flag('--rulings') ? readFileSync(flag('--rulings')!, 'utf8') : await getText('https://compendium.pokegym.net/all-rulings-by-date/', { timeoutMs: 180_000 });
const rulings = parseRulingsHtml(html);

const gap = standardGap(frames, marks);
console.log(`Standard marks ${marks.join('/')}: ${gap.printings} printings, ${gap.distinct} distinct texts: ${gap.scripted} scripted, ${gap.vanilla} vanilla, ${gap.todo.length} to script`);
if (!gap.todo.length) {
  console.log('nothing to script.');
  process.exit(0);
}
console.log(JSON.stringify(gap.todo.reduce<Record<string, number>>((m, t) => ({ ...m, [gapCategory(t.frame)]: (m[gapCategory(t.frame)] ?? 0) + 1 }), {})));

/** Rulings filed under the card's name, naming it in the question, or filed under one of its attack / Ability names. */
function rulingsFor(f: CardFrame): Ruling[] {
  const parts = [...(f.attacks ?? []).map((a) => a.name), ...(f.abilities ?? []).map((a) => a.name)];
  const byName = new Set(rulingsNamingCard(rulings, f.name).map((r) => r.id));
  return rulings.filter((r) => byName.has(r.id) || (parts.length > 0 && rulingMatch(r, parts)?.by === 'category'));
}
const set = (id: string) => id.slice(0, id.lastIndexOf('-'));
const todo = [...gap.todo].sort((a, b) => set(a.frame.cardId).localeCompare(set(b.frame.cardId)) || a.frame.cardId.localeCompare(b.frame.cardId));
mkdirSync(outDir, { recursive: true });
const lanes: { lane: string; cards: number; rulings: number; sets: string[] }[] = [];
for (let i = 0; i < todo.length; i += size) {
  const batch = todo.slice(i, i + size);
  const lane = `std${String(lanes.length + 1).padStart(2, '0')}`;
  const cards = batch.map(({ frame, printings }) => ({ id: frame.cardId, name: frame.name, printings, frame, rulings: rulingsFor(frame) }));
  writeFileSync(join(outDir, `${lane}.json`), JSON.stringify({ lane, cards }, null, 1));
  lanes.push({ lane, cards: cards.length, rulings: cards.reduce((n, c) => n + c.rulings.length, 0), sets: [...new Set(batch.map((b) => set(b.frame.cardId)))] });
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ marks, distinct: gap.distinct, todo: todo.length, lanes }, null, 1));
console.log(`wrote ${lanes.length} lane(s) to ${outDir}: ${todo.length} cards, ${lanes.reduce((n, l) => n + l.rulings, 0)} rulings attached`);
