/**
 * Standard-pool coverage: which distinct cards (by game text) among the Standard printings of the frame snapshot are
 * scripted, vanilla (no text, play from the frame), or still to do. The same logic as the coverage gate test
 * (src/__tests__/standard-coverage.test.ts).
 *
 *   node --import tsx scripts/standard-gap.ts                 # the repo's frame snapshot, marks from formats.json
 *   node --import tsx scripts/standard-gap.ts frames.json     # a frames dump instead ({ id: CardFrame })
 *   node --import tsx scripts/standard-gap.ts --list          # also print every card still to script
 */
import { readFileSync } from 'node:fs';
import { FRAMES } from '../src/cards/frames-all.js';
import { gapCategory, standardGap } from '../src/maintenance/gap.js';
import type { CardFrame } from '../src/types.js';
import { standardMarks } from './lib/catalog.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const frames: CardFrame[] = file ? Object.values(JSON.parse(readFileSync(file, 'utf8')) as Record<string, CardFrame>) : Object.values(FRAMES);
const marks = standardMarks();
const gap = standardGap(frames, marks);
console.log(`Standard marks ${marks.join('/')}: printings ${gap.printings}, distinct cards ${gap.distinct}: scripted ${gap.scripted}, vanilla ${gap.vanilla}, to script ${gap.todo.length}`);
const cat: Record<string, number> = {};
for (const t of gap.todo) cat[gapCategory(t.frame)] = (cat[gapCategory(t.frame)] ?? 0) + 1;
console.log(JSON.stringify(cat));
if (process.argv.includes('--list')) for (const t of gap.todo) console.log(`  ${t.frame.cardId} ${t.frame.name} (${gapCategory(t.frame)}, ${t.printings.length} printing(s))`);
if (gap.todo.length) process.exitCode = 1;
