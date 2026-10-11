/**
 * Standard-pool coverage: which distinct cards (by printed game text) among the Standard printings of a frame set are
 * scripted, vanilla (no text, play from the frame), or still to do. Used by the coverage gate
 * (__tests__/standard-coverage.test.ts) and by scripts/standard-gap.ts and scripts/new-card-lanes.ts, so all three
 * agree. "Standard" is a list of regulation marks passed in by the caller, who reads them from
 * apps/api/src/deck/data/formats.json; nothing here knows which marks are legal.
 */
import { isVanilla, textKey } from '../cards/frame.js';
import { withPrintedWR } from '../cards/printed-wr.js';
import { withCleanText } from '../cards/clean-text.js';
import { scriptFor } from '../cards/registry.js';
import type { CardFrame } from '../types.js';

export interface GapResult {
  /** Standard printings considered. */
  printings: number;
  /** Distinct game texts among them. */
  distinct: number;
  scripted: number;
  vanilla: number;
  /** One entry per distinct unscripted, non-vanilla text: the canonical (lowest-id) printing and every printing sharing the text. */
  todo: { frame: CardFrame; printings: string[] }[];
}

export function isStandardFrame(f: CardFrame, marks: readonly string[]): boolean {
  return !!f.regulationMark && marks.includes(f.regulationMark);
}

/** Group the Standard-mark frames by text and classify each group. `frames` may hold more than Standard (they are filtered). */
export function standardGap(frames: Iterable<CardFrame>, marks: readonly string[]): GapResult {
  const standard = [...frames].filter((f) => isStandardFrame(f, marks)).map((f) => withPrintedWR(withCleanText(f))).sort((a, b) => a.cardId.localeCompare(b.cardId));
  const byKey = new Map<string, CardFrame[]>();
  for (const f of standard) {
    const k = textKey(f);
    const list = byKey.get(k);
    if (list) list.push(f);
    else byKey.set(k, [f]);
  }
  let scripted = 0;
  let vanilla = 0;
  const todo: GapResult['todo'] = [];
  for (const list of byKey.values()) {
    const f = list[0]!;
    if (scriptFor(f)) scripted++;
    else if (isVanilla(f)) vanilla++;
    else todo.push({ frame: f, printings: list.map((x) => x.cardId) });
  }
  return { printings: standard.length, distinct: byKey.size, scripted, vanilla, todo };
}

/** "Trainer/Supporter", "Pokemon", ... for the summary line. */
export function gapCategory(f: CardFrame): string {
  return f.category === 'Trainer' ? `Trainer/${f.trainerType ?? '?'}` : f.category;
}
