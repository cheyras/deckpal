/**
 * The public DeckPal catalog as the maintenance scripts see it (read-only GETs on deckpal.app/api, no sign-in):
 *   GET /series, GET /series/:slug        -> sets
 *   GET /search?set=<id>&sort=number      -> every printing of a set, with its regulation mark
 *   GET /cards/:id                        -> one printed frame (what src/cards/frames*.ts snapshot)
 * and the Standard rotation, read from apps/api/src/deck/data/formats.json (the same file the API's
 * legality checks use), never from a list in the sim.
 *
 * DECKPAL_API overrides the base URL (a local API).
 */
import { readFileSync } from 'node:fs';
import { getJson } from './net.js';

export const API = process.env.DECKPAL_API ?? 'https://deckpal.app/api';
const FORMATS_JSON = new URL('../../../../apps/api/src/deck/data/formats.json', import.meta.url);

/** The regulation marks legal in Standard right now, from formats.json. */
export function standardMarks(): string[] {
  const marks = (JSON.parse(readFileSync(FORMATS_JSON, 'utf8')) as { formats: { standard: { legal_marks: string[] } } }).formats.standard.legal_marks;
  if (!Array.isArray(marks) || !marks.length) throw new Error('formats.json has no Standard legal_marks');
  return marks;
}

export interface CatalogSet {
  setId: string;
  name: string;
  releasedOn: string | null;
  isPromo: boolean;
  series: string;
}
export interface CatalogPrinting {
  cardId: string;
  name: string;
  category: string;
  mark: string | null;
  setId: string;
}

/** Series whose first release is on or after `since` (default: the Scarlet & Violet era, where every Standard mark lives). */
export async function catalogSets(since = '2023-01-01'): Promise<CatalogSet[]> {
  const { series } = await getJson<{ series: { slug: string; tcgdexId: string; firstReleaseOn: string }[] }>(`${API}/series`);
  const out: CatalogSet[] = [];
  for (const s of series.filter((x) => x.firstReleaseOn >= since)) {
    const { sets } = await getJson<{ sets: { setId: string; name: string; releasedOn: string | null; isPromo: boolean }[] }>(`${API}/series/${s.slug}`);
    for (const x of sets) out.push({ setId: x.setId, name: x.name, releasedOn: x.releasedOn, isPromo: x.isPromo, series: s.tcgdexId });
  }
  return out;
}

interface SearchPage {
  pagination: { pageCount: number };
  cards: { cardId: string; name: string; category: string; regulationMark: string | null; set: { setId: string } }[];
}

/** Every printing of one set. `extra` is appended to the query (e.g. `&cardType=Pokemon&weakness=Fire`). */
export async function setPrintings(setId: string, extra = ''): Promise<CatalogPrinting[]> {
  const out: CatalogPrinting[] = [];
  for (let page = 1; ; page++) {
    const r = await getJson<SearchPage>(`${API}/search?set=${encodeURIComponent(setId)}&sort=number&dir=asc&pageSize=250&page=${page}${extra}`);
    for (const c of r.cards) out.push({ cardId: c.cardId, name: c.name, category: c.category, mark: c.regulationMark, setId: c.set.setId });
    if (page >= r.pagination.pageCount) break;
  }
  return out;
}

/** Every printing in the catalog's recent sets, grouped by set (`sets` is the list from catalogSets()). */
export async function catalogPrintings(sets: CatalogSet[]): Promise<CatalogPrinting[]> {
  const all: CatalogPrinting[] = [];
  for (const s of sets) all.push(...(await setPrintings(s.setId)));
  return all;
}

export const ENERGY_TYPES = ['Colorless', 'Darkness', 'Dragon', 'Fairy', 'Fighting', 'Fire', 'Grass', 'Lightning', 'Metal', 'Psychic', 'Water'];

/**
 * Ids of the Pokémon in a set whose catalog frame carries no Weakness AND no Resistance. Uses the catalog's
 * weakness / resistance search filters (one query each, any type), so it does not need a frame per printing.
 */
export async function pokemonWithoutWeaknessOrResistance(setId: string): Promise<CatalogPrinting[]> {
  const q = (kind: 'weakness' | 'resistance') => ENERGY_TYPES.map((t) => `&${kind}=${t}`).join('');
  const pokemon = await setPrintings(setId, '&cardType=Pokemon');
  const has = new Set<string>();
  for (const kind of ['weakness', 'resistance'] as const) for (const p of await setPrintings(setId, `&cardType=Pokemon${q(kind)}`)) has.add(p.cardId);
  return pokemon.filter((p) => !has.has(p.cardId));
}
