/**
 * PTCG Live card codes → TCGdex card ids, and card lookup against the frame
 * snapshot. Ported from apps/api/src/deck/battlelog.ts `normalizeCardCode`
 * (the sim package must not import from apps/api), plus the two Black Bolt /
 * White Flare set tokens observed in real logs.
 *
 * A Live code is `<set>_<number>[_variant]`, printed in parentheses before
 * every card name since mid-2026: `(sv10_102)`, `(me2-5_98)`, `(mee_6)`,
 * `(me5_29_ph)`, `(zsv10-5_79)`.
 *   - the set token's leading digit run pads to 2 (me5 → me05, sv6 → sv06);
 *   - a trailing `-N` becomes `.N` (sv6-5 → sv06.5, me2-5 → me02.5);
 *   - the number pads to 3 (38 → 038);
 *   - a trailing `_ph` (foil printing variant) is dropped;
 *   - `zsv10-5` is Black Bolt (sv10.5b) and `rsv10-5` White Flare (sv10.5w):
 *     Zekrom and Reshiram. Observed: `(zsv10-5_79) Air Balloon` = sv10.5b-079,
 *     `(rsv10-5_84) Hilda` = sv10.5w-084, both matching the frame snapshot.
 */
import { FRAMES } from '../cards/frames-all.js';
import { FRAMES as BASE_FRAMES } from '../cards/frames.js'; // lane:excadrill
import { normText, textKey } from '../cards/frame.js';
import type { CardFrame } from '../types.js';

const CARD_CODE_RE = /^([A-Za-z0-9][A-Za-z0-9.-]*)_(\d+)(?:_([A-Za-z][A-Za-z0-9]*))?$/;

/** Set tokens whose TCGdex id is not the mechanical normalisation. */
const SET_TOKEN_OVERRIDES: Record<string, string> = {
  'zsv10.5': 'sv10.5b',
  'rsv10.5': 'sv10.5w',
};

function normaliseSetToken(raw: string): string {
  let s = raw.toLowerCase().replace(/-(\d+[a-z]?)$/, '.$1');
  const m = s.match(/^([a-z]+)(\d)(\D.*)?$/);
  if (m) s = `${m[1]}0${m[2]}${m[3] ?? ''}`;
  return SET_TOKEN_OVERRIDES[s] ?? s;
}

/** `sv6-5_38` → `sv06.5-038`; null when the token is not a Live card code. */
export function codeToCardId(raw: string): string | null {
  const token = raw.replace(/^\(/, '').replace(/\)$/, '').trim();
  const m = CARD_CODE_RE.exec(token);
  if (!m) return null;
  return `${normaliseSetToken(m[1]!)}-${m[2]!.padStart(3, '0')}`;
}

/** Live writes Basic Energy as "Basic Psychic Energy"; the catalog calls it "Psychic Energy". */
export function canonicalName(name: string): string {
  return normText(name).replace(/^Basic (\w+) Energy$/, '$1 Energy');
}

let byName: Map<string, CardFrame[]> | null = null;

function nameIndex(): Map<string, CardFrame[]> {
  if (byName) return byName;
  byName = new Map();
  for (const f of Object.values(FRAMES)) {
    const k = canonicalName(f.name);
    const list = byName.get(k) ?? [];
    list.push(f);
    byName.set(k, list);
  }
  return byName;
}

export type Resolution = 'code' | 'name' | 'none';

/**
 * The printed frame for a card mention. With a code, ONLY that exact printing
 * counts: a same-named card from another set can be a different card (Riolu
 * me01-076 is 80 HP, sv08.5-050 is 70). Without a code (older logs), a name
 * resolves when every frame of that name shares one game text.
 */
export function resolveFrame(name: string, id?: string | null): { frame: CardFrame | null; via: Resolution } {
  if (id) {
    const f = FRAMES[id];
    return f ? { frame: f, via: 'code' } : { frame: null, via: 'none' };
  }
  const list = nameIndex().get(canonicalName(name)) ?? [];
  if (!list.length) return { frame: null, via: 'none' };
  // Catalog noise outside game text (a Basic Energy's "stage") doesn't split a name.
  const keyOf = (f: CardFrame) => textKey({ ...f, stage: f.category === 'Pokemon' ? f.stage : null });
  const keys = new Set(list.map(keyOf));
  if (keys.size === 1) return { frame: list[0]!, via: 'name' };
  // lane:excadrill — a meta lane's frames-extra snapshot can add a same-named card with other text (Metang sv05-114
  // beside me04-060). Codeless logs predate the meta lanes and come from the decks the base snapshot covers, so a
  // name still resolves when the base snapshot alone has one text for it. REVIEW: a heuristic, flagged at merge.
  const base = list.filter((f) => BASE_FRAMES[f.cardId]);
  if (base.length && base.length < list.length && new Set(base.map(keyOf)).size === 1) return { frame: base[0]!, via: 'name' };
  return { frame: null, via: 'none' };
}
