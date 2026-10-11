/** Print the TCGdex ids of card codes in the fixture logs that the frame snapshot lacks (for fetch-frames). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAMES } from '../src/cards/frames-all.js';
import { codeToCardId } from '../src/replay/cardCodes.js';

const dir = 'src/__tests__/fixtures/live-logs';
const want = new Set<string>();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
  const raw = readFileSync(join(dir, f), 'utf8');
  for (const m of raw.matchAll(/\(([A-Za-z0-9][A-Za-z0-9.-]*_\d+(?:_[A-Za-z][A-Za-z0-9]*)?)\)/g)) {
    const id = codeToCardId(m[1]!);
    if (id && !FRAMES[id]) want.add(id);
  }
}
console.log([...want].join(' '));
