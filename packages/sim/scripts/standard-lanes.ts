/**
 * Split the Standard pool's unscripted cards into scripting batches, each with the rulings that name
 * its cards. Writes <out>/<lane>.json and <out>/summary.json.
 *   node --import tsx scripts/standard-lanes.ts <frames.json> <rulings.json> <outDir> [batchSize=40]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isVanilla, normText, textKey } from '../src/cards/frame.js';
import { scriptFor } from '../src/cards/registry.js';
import type { CardFrame } from '../src/types.js';
import { withPrintedWR } from '../src/cards/printed-wr.js';

const [framesPath, rulingsPath, outDir, sizeArg] = process.argv.slice(2);
const size = Number(sizeArg ?? 40);
const frames = JSON.parse(readFileSync(framesPath!, 'utf8')) as Record<string, CardFrame>;
const rulings = JSON.parse(readFileSync(rulingsPath!, 'utf8')) as { id: number; categories: string[]; q: string; a: string; source: string }[];
const norm = (s: string) => normText(s).toLowerCase().replace(/[’']/g, "'");

// One canonical printing per distinct game text: the lowest card id (earliest set) wins.
const byKey = new Map<string, CardFrame[]>();
for (const f of Object.values(frames).sort((a, b) => a.cardId.localeCompare(b.cardId))) {
  const k = textKey(withPrintedWR(f));
  byKey.set(k, [...(byKey.get(k) ?? []), f]);
}
const todo: { frame: CardFrame; printings: string[] }[] = [];
for (const list of byKey.values()) {
  const f = list[0]!;
  if (scriptFor(f) || isVanilla(f)) continue;
  todo.push({ frame: f, printings: list.map((x) => x.cardId) });
}
// A ruling belongs to a card when it is filed under the card's name, or its question names it.
const rulingsFor = (name: string) => {
  const n = norm(name);
  return rulings.filter((r) => r.categories.some((c) => norm(c) === n) || norm(r.q).includes(n));
};
const set = (id: string) => id.slice(0, id.lastIndexOf('-'));
todo.sort((a, b) => set(a.frame.cardId).localeCompare(set(b.frame.cardId)) || a.frame.cardId.localeCompare(b.frame.cardId));
mkdirSync(outDir!, { recursive: true });
const lanes: { lane: string; cards: number; rulings: number; sets: string[] }[] = [];
for (let i = 0; i < todo.length; i += size) {
  const batch = todo.slice(i, i + size);
  const lane = `std${String(lanes.length + 1).padStart(2, '0')}`;
  const cards = batch.map(({ frame, printings }) => ({ id: frame.cardId, name: frame.name, printings, frame, rulings: rulingsFor(frame.name) }));
  writeFileSync(join(outDir!, `${lane}.json`), JSON.stringify({ lane, cards }, null, 1));
  lanes.push({ lane, cards: cards.length, rulings: cards.reduce((n, c) => n + c.rulings.length, 0), sets: [...new Set(batch.map((b) => set(b.frame.cardId)))] });
}
writeFileSync(join(outDir!, 'summary.json'), JSON.stringify({ distinct: byKey.size, todo: todo.length, lanes }, null, 1));
console.log(`distinct ${byKey.size}, to script ${todo.length}, lanes ${lanes.length}, rulings matched ${lanes.reduce((n, l) => n + l.rulings, 0)}`);
