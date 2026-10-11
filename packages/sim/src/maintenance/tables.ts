/**
 * Pure helpers for scripts/refresh-card-tables.ts: mapping pokemontcg.io ids to DeckPal ids, comparing card
 * names, and re-rendering the three generated tables (cards/tera.ts, cards/tags.ts, cards/printed-wr.ts).
 * No I/O here, so the mapping and the rendering are unit-tested (maintenance.test.ts).
 */

/**
 * pokemontcg.io set ids that do not follow the regular pattern, mapped to DeckPal set ids. The regular pattern
 * (see ptcgSetToOurs) covers `sv<N>`, `sv<N>pt5`, `me<N>`, `me<N>pt5`. To teach the refresh a new irregular
 * set, add one line here: key = pokemontcg.io set id (https://api.pokemontcg.io/v2/sets), value = our tcgdex set id
 * (https://deckpal.app/api/series/<slug>). Anything the refresh cannot map is printed under "unmapped sets".
 */
export const PTCG_SET_OVERRIDES: Readonly<Record<string, string>> = {
  zsv10pt5: 'sv10.5b', // Black Bolt
  rsv10pt5: 'sv10.5w', // White Flare
  svp: 'svp', // Scarlet & Violet promos
  sve: 'sve', // Scarlet & Violet energies
  mep: 'mep', // Mega Evolution promos
  mee: 'mee', // Mega Evolution energies
  me55: '30th', // 30th Celebration (me55c, the Classic Collection reprints, has no regulation mark: not Standard)
};

/** `sv5` -> `sv05`, `sv6pt5` -> `sv06.5`, `me2pt5` -> `me02.5`, `zsv10pt5` -> `sv10.5b`; null when the id is not one we know. */
export function ptcgSetToOurs(ptcgId: string): string | null {
  const o = PTCG_SET_OVERRIDES[ptcgId];
  if (o) return o;
  const m = /^(sv|me)(\d+)(pt5)?$/.exec(ptcgId);
  if (!m) return null;
  return `${m[1]}${m[2]!.padStart(2, '0')}${m[3] ? '.5' : ''}`;
}

/** pokemontcg.io card (`sv6pt5`, `15`) -> our card id (`sv06.5-015`). Non-numeric numbers keep their text. */
export function ptcgCardToOurs(setId: string, number: string): string | null {
  const set = ptcgSetToOurs(setId);
  if (!set) return null;
  return `${set}-${/^\d+$/.test(number) ? number.padStart(3, '0') : number}`;
}

/** Name comparison that ignores case, accents, apostrophes and punctuation ("Pokémon" = "Pokemon", "Team Rocket’s" = "Team Rocket's"). */
export function normName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export type WRTable = Record<string, { weaknesses: { type: string; value: string }[]; resistances: { type: string; value: string }[] }>;

const lf = (s: string) => s.replace(/\r\n/g, '\n');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Splice a regenerated body between the markers of an existing file, keeping its header and footer (hand-edited prose survives). */
function splice(existing: string, start: RegExp, end: RegExp, body: string): string {
  const text = lf(existing);
  const lines = text.split('\n');
  const s = lines.findIndex((l) => start.test(l));
  if (s < 0) throw new Error(`cannot find the start of the data block (${start})`);
  const e = lines.findIndex((l, i) => i > s && end.test(l));
  if (e < 0) throw new Error(`cannot find the end of the data block (${end})`);
  return [...lines.slice(0, s + 1), ...(body ? [body] : []), ...lines.slice(e)].join('\n');
}

export function renderTera(existing: string, ids: Iterable<string>): string {
  const body = [...new Set(ids)].sort(cmp).map((id) => `  ${JSON.stringify(id)},`).join('\n');
  return splice(existing, /^export const TERA_PRINTINGS\b.*new Set\(\[$/, /^\]\);$/, body);
}

export function renderTags(existing: string, tags: Record<string, 'Ancient' | 'Future'>): string {
  const body = Object.keys(tags).sort(cmp).map((id) => `  '${id}': '${tags[id]}',`).join('\n');
  return splice(existing, /^export const CARD_TAGS\b.*= \{$/, /^\};$/, body);
}

export function renderPrintedWR(existing: string, table: WRTable): string {
  const side = (xs: { type: string; value: string }[]) => `[${xs.map((x) => `{type:${JSON.stringify(x.type)},value:${JSON.stringify(x.value)}}`).join(',')}]`;
  const body = Object.keys(table).sort(cmp).map((id) => `  ${JSON.stringify(id)}: {weaknesses:${side(table[id]!.weaknesses)},resistances:${side(table[id]!.resistances)}},`).join('\n');
  const out = splice(existing, /^export const PRINTED_WR\b.*= \{$/, /^\};$/, body);
  // The header states how many printings the table holds; keep that number true.
  return out.replace(/ \d+ printings,/, ` ${Object.keys(table).length} printings,`);
}

/** Which ids were added / removed / changed between two keyed tables (for the diff summary). */
export function diffTables<T>(before: Record<string, T>, after: Record<string, T>): { added: string[]; removed: string[]; changed: string[] } {
  const added = Object.keys(after).filter((k) => !(k in before)).sort(cmp);
  const removed = Object.keys(before).filter((k) => !(k in after)).sort(cmp);
  const changed = Object.keys(after).filter((k) => k in before && JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort(cmp);
  return { added, removed, changed };
}
