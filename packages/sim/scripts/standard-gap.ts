/**
 * Standard-pool coverage: which distinct cards (by game text) in a frames dump are scripted,
 * vanilla (no text, play from the frame), or still to do.
 *   node --import tsx scripts/standard-gap.ts <frames.json>
 */
import { readFileSync } from 'node:fs';
import { isVanilla, textKey } from '../src/cards/frame.js';
import { scriptFor } from '../src/cards/registry.js';
import type { CardFrame } from '../src/types.js';

const frames = Object.values(JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Record<string, CardFrame>);
const byKey = new Map<string, CardFrame[]>();
for (const f of frames) {
  const k = textKey(f);
  byKey.set(k, [...(byKey.get(k) ?? []), f]);
}
let scripted = 0;
let vanilla = 0;
const todo: CardFrame[] = [];
const cat: Record<string, number> = {};
for (const list of byKey.values()) {
  const f = list[0]!;
  if (scriptFor(f)) scripted++;
  else if (isVanilla(f)) vanilla++;
  else {
    todo.push(f);
    const c = f.category === 'Trainer' ? `Trainer/${f.trainerType ?? '?'}` : f.category;
    cat[c] = (cat[c] ?? 0) + 1;
  }
}
console.log(`printings ${frames.length}, distinct cards ${byKey.size}: scripted ${scripted}, vanilla ${vanilla}, to script ${todo.length}`);
console.log(JSON.stringify(cat));
