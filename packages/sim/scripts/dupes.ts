/** List cards scripted in more than one lane file (same printed-text key). */
import { readdirSync } from 'node:fs';
import '../src/cards/scripts/index.js'; // load in the normal order first (lane customs import the registry)
import { FRAMES } from '../src/cards/frames-all.js';
import { textKey } from '../src/cards/frame.js';

const dir = new URL('../src/cards/scripts/', import.meta.url);
const seen = new Map<string, string[]>();
for (const f of readdirSync(dir).sort()) {
  if (!f.endsWith('.ts') || f === 'index.ts' || f === 'helpers.ts' || f.endsWith('-customs.ts')) continue;
  const mod = (await import(new URL(f, dir).href)) as Record<string, unknown>;
  for (const v of Object.values(mod)) {
    if (!Array.isArray(v)) continue;
    for (const s of v as { id: string; name: string }[]) {
      const fr = FRAMES[s.id];
      if (!fr) continue;
      const k = textKey(fr);
      const list = seen.get(k) ?? [];
      list.push(`${f}:${s.id}:${s.name}`);
      seen.set(k, list);
    }
  }
}
for (const list of seen.values()) if (list.length > 1) console.log(list.join('  |  '));
