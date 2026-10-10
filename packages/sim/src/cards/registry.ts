/**
 * Script lookup by printed text. A script is written against one canonical
 * printing (its `id`); its key is computed from that printing's frame in the
 * committed snapshot (frames.ts, generated), and any other printing with identical game
 * text resolves to the same script.
 */
import { FRAMES } from './frames.js';
import { SCRIPTS } from './scripts/index.js';
import type { CardScript } from '../dsl.js';
import type { CardFrame } from '../types.js';
import { textKey } from './frame.js';

export { FRAMES };

let byKey: Map<string, CardScript> | null = null;
let byId: Map<string, CardScript> | null = null;

function build(): void {
  byKey = new Map();
  byId = new Map();
  for (const s of SCRIPTS) {
    const f = FRAMES[s.id];
    if (!f) throw new Error(`script ${s.id} (${s.name}) has no frame in frames.json -- run the frames script`);
    if (f.name.trim() !== s.name) throw new Error(`script ${s.id} names "${s.name}" but the card is "${f.name}"`);
    const k = textKey(f);
    if (byKey.has(k)) throw new Error(`two scripts for the same card text: ${s.id} and ${byKey.get(k)!.id}`);
    byKey.set(k, s);
    byId.set(s.id, s);
  }
}

/** The script for this printing, or null when none exists. */
export function scriptFor(f: CardFrame): CardScript | null {
  if (!byKey) build();
  return byKey!.get(textKey(f)) ?? null;
}

export function scriptById(id: string): CardScript | null {
  if (!byId) build();
  return byId!.get(id) ?? null;
}

export function allScripts(): readonly CardScript[] {
  return SCRIPTS;
}
