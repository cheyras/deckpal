/**
 * The decision logic of scripts/refresh-card-tables.ts, with no I/O so it can be tested on fixtures: given the catalog's
 * printings and what pokemontcg.io says, build the candidate tables and say what is wrong with them.
 *
 *  - `problems`: an upstream entry that does not match the catalog (unknown set, id not in the catalog, different name).
 *    The script writes NOTHING while there are any, because a name or mapping change upstream would otherwise silently drop
 *    an entry that is right today.
 *  - `gaps`: upstream simply lacks the data (set not published yet, card missing, no Weakness/Resistance there). Existing
 *    Weakness/Resistance entries for such printings are KEPT: a removal must be positively verified (the catalog now carries
 *    them, or the printing rotated out of Standard, which never removes).
 *  - `unverifiedRemovals`: ids in the committed Tera / tag tables that upstream no longer lists. Writing them away needs
 *    --allow-removals.
 */
import { normName, ptcgCardToOurs, type WRTable } from './tables.js';

export interface Printing {
  cardId: string;
  name: string;
  category: string;
  mark: string | null;
  setId: string;
}
export interface PtcgCard {
  id: string;
  name: string;
  number: string;
  set: { id: string };
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
}
export interface RefreshInput {
  marks: readonly string[];
  printings: readonly Printing[];
  tera: readonly PtcgCard[];
  tags: Record<'Ancient' | 'Future', readonly PtcgCard[]>;
  /** Our Standard set id -> its Standard Pokémon printings whose catalog frame has neither Weakness nor Resistance. */
  lacking: ReadonlyMap<string, readonly Printing[]>;
  /** Our set id -> that set's pokemontcg.io Pokémon cards. A set with no pokemontcg.io mapping has no entry. */
  wrUpstream: ReadonlyMap<string, readonly PtcgCard[]>;
  existing: { tera: ReadonlySet<string>; tags: Readonly<Record<string, 'Ancient' | 'Future'>>; wr: Readonly<WRTable> };
}
export interface RefreshResult {
  tera: Set<string>;
  tags: Record<string, 'Ancient' | 'Future'>;
  wr: WRTable;
  problems: string[];
  gaps: string[];
  noUpstream: number;
  keptRotated: number;
  keptUnresolved: number;
  unverifiedRemovals: { table: 'tera.ts' | 'tags.ts'; ids: string[] }[];
}

export function buildTables(input: RefreshInput): RefreshResult {
  const { marks } = input;
  const problems: string[] = [];
  const gaps: string[] = [];
  const byId = new Map(input.printings.map((p) => [p.cardId, p]));

  function match(c: PtcgCard, what: string): string | null {
    const id = ptcgCardToOurs(c.set.id, c.number);
    if (!id) {
      problems.push(`${what}: ${c.id} "${c.name}" is in set ${c.set.id}, which has no mapping`);
      return null;
    }
    const p = byId.get(id);
    if (!p) {
      problems.push(`${what}: ${c.id} "${c.name}" maps to ${id}, which is not in the catalog`);
      return null;
    }
    if (normName(p.name) !== normName(c.name)) {
      problems.push(`${what}: ${c.id} is "${c.name}" but the catalog's ${id} is "${p.name}"`);
      return null;
    }
    return id;
  }

  const tera = new Set<string>();
  for (const c of input.tera) {
    const id = match(c, 'Tera');
    if (id) tera.add(id);
  }
  const tags: Record<string, 'Ancient' | 'Future'> = {};
  for (const tag of ['Ancient', 'Future'] as const) {
    for (const c of input.tags[tag]) {
      const id = match(c, tag);
      if (!id) continue;
      if (tags[id] && tags[id] !== tag) problems.push(`${tag}: ${id} is tagged both ${tags[id]} and ${tag}`);
      tags[id] = tag;
    }
  }

  const wr: WRTable = {};
  const unresolved = new Set<string>();
  let noUpstream = 0;
  for (const [setId, lacking] of input.lacking) {
    if (!lacking.length) continue;
    const upstream = input.wrUpstream.get(setId);
    if (!upstream) {
      gaps.push(`W/R: ${lacking.length} printings of ${setId} (${lacking.map((p) => p.cardId).join(' ')}) lack Weakness/Resistance and the set has no pokemontcg.io mapping (not published there yet, or add it to PTCG_SET_OVERRIDES)`);
      for (const p of lacking) unresolved.add(p.cardId);
      continue;
    }
    const byOurId = new Map<string, PtcgCard>();
    for (const c of upstream) {
      const id = ptcgCardToOurs(c.set.id, c.number);
      if (id) byOurId.set(id, c);
    }
    for (const p of lacking) {
      const c = byOurId.get(p.cardId);
      if (!c) {
        gaps.push(`W/R: ${p.cardId} "${p.name}" is not on pokemontcg.io set ${upstream[0]?.set.id ?? setId}`);
        unresolved.add(p.cardId);
        continue;
      }
      if (normName(c.name) !== normName(p.name)) {
        problems.push(`W/R: ${c.id} is "${c.name}" but the catalog's ${p.cardId} is "${p.name}"`);
        unresolved.add(p.cardId);
        continue;
      }
      if (!c.weaknesses?.length && !c.resistances?.length) {
        noUpstream++;
        unresolved.add(p.cardId);
        continue;
      }
      wr[p.cardId] = { weaknesses: (c.weaknesses ?? []).map((w) => ({ type: w.type, value: w.value })), resistances: (c.resistances ?? []).map((w) => ({ type: w.type, value: w.value })) };
    }
  }

  // Keep an existing entry unless its removal is verified: a rotated printing still plays (Expanded) and its Weakness is part
  // of its text key; an unresolved printing (upstream lacks or mismatches it) is not evidence the entry is wrong. Verified
  // removal = a Standard printing the catalog now gives a Weakness/Resistance itself.
  let keptRotated = 0;
  let keptUnresolved = 0;
  for (const [id, v] of Object.entries(input.existing.wr)) {
    if (id in wr) continue;
    const p = byId.get(id);
    const standardNow = !!p?.mark && marks.includes(p.mark);
    if (standardNow && !unresolved.has(id)) continue; // verified: the catalog supplies it now
    wr[id] = v as WRTable[string];
    if (standardNow) keptUnresolved++;
    else keptRotated++;
    if (!p) gaps.push(`W/R: kept ${id}, which is no longer in the catalog`);
  }

  const gone = (before: Iterable<string>, after: (id: string) => boolean) => [...before].filter((id) => !after(id)).sort();
  const unverifiedRemovals: RefreshResult['unverifiedRemovals'] = [];
  const t = gone(input.existing.tera, (id) => tera.has(id));
  if (t.length) unverifiedRemovals.push({ table: 'tera.ts', ids: t });
  const g = gone(Object.keys(input.existing.tags), (id) => id in tags);
  if (g.length) unverifiedRemovals.push({ table: 'tags.ts', ids: g });
  return { tera, tags, wr, problems, gaps, noUpstream, keptRotated, keptUnresolved, unverifiedRemovals };
}
