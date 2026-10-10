/**
 * Which cards of a set of decks still need scripts? Groups printings by text
 * key, drops vanilla cards (no effect text) and cards already scripted, and
 * prints one line per distinct card to script (canonical id = first printing seen).
 *
 *   node --import tsx scripts/coverage.ts            # the gauntlet + owner decks
 *   node --import tsx scripts/coverage.ts --json
 */
import { FRAMES } from '../src/cards/frames.js';
import { isVanilla, textKey } from '../src/cards/frame.js';
import { scriptFor } from '../src/cards/registry.js';
import { GAUNTLET_LISTS } from '../src/__tests__/gauntlet.js';

const decks = Object.entries(GAUNTLET_LISTS);
const need = new Map<string, { id: string; name: string; category: string; decks: Set<string>; printings: Set<string> }>();
for (const [deck, list] of decks) {
  for (const [id] of list) {
    const f = FRAMES[id];
    if (!f) {
      console.error(`missing frame ${id}`);
      continue;
    }
    if (isVanilla(f) || scriptFor(f)) continue;
    const k = textKey(f);
    const e = need.get(k) ?? { id, name: f.name, category: f.category, decks: new Set(), printings: new Set() };
    e.decks.add(deck);
    e.printings.add(id);
    need.set(k, e);
  }
}
const rows = [...need.values()].sort((a, b) => b.decks.size - a.decks.size || a.name.localeCompare(b.name));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows.map((r) => ({ id: r.id, name: r.name, category: r.category, decks: [...r.decks], printings: [...r.printings] })), null, 1));
} else {
  for (const r of rows) console.log(`${r.id}\t${r.category}\t${r.name}\t(${r.decks.size} decks; printings ${[...r.printings].join(',')})`);
  console.log(`${rows.length} distinct cards need scripts`);
}
