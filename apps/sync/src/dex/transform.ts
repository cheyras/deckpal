// Pure, DB-free transforms for the Pokédex species import + card→species mapping.
// Sources: vendored PokeAPI CSVs (data/pokeapi/, BSD-3, pinned SHA) and the compiled TCGdex
// catalog (data/catalog/en/cards.json). Everything here is deterministic and unit-testable.
// References: wiki: Dex-Data (§A mapping, §B species), research/SCHEMA.md §10.

// ── minimal CSV parser (handles quoted fields + embedded commas/quotes) ──────
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Parse a PokeAPI CSV into header-keyed objects, dropping the header row + trailing blank rows.
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]!;
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    if (cells.length === 1 && cells[0] === '') continue; // blank trailing line
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]!] = cells[c] ?? '';
    out.push(obj);
  }
  return out;
}

const ENGLISH_LANGUAGE_ID = '9';

// ── species dataset shaping ──────────────────────────────────────────────────
export interface DexSpeciesRow {
  id: number;
  identifier: string;
  name: string;
  genus: string | null;
  generation: number;
  evolvesFrom: number | null;
  evolutionChainId: number | null;
  isBaby: boolean;
  isLegendary: boolean;
  isMythical: boolean;
  dexOrder: number;
}

const MAX_SPECIES = 1025; // National Dex through Gen 9 (DEX-DATA §B.1). Assert this.

export interface SpeciesData {
  species: DexSpeciesRow[];
  types: { dexId: number; slot: number; type: string }[];
}

// Build the species + species-type rows from the vendored CSVs.
export function buildSpecies(csv: {
  species: string;
  names: string;
  types: string;
  typeVocab: string;
}): SpeciesData {
  // English names + genus, keyed by species id.
  const nameBy: Map<number, { name: string; genus: string | null }> = new Map();
  for (const r of parseCsvObjects(csv.names)) {
    if (r.local_language_id !== ENGLISH_LANGUAGE_ID) continue;
    nameBy.set(Number(r.pokemon_species_id), { name: r.name ?? '', genus: r.genus || null });
  }

  const species: DexSpeciesRow[] = [];
  for (const r of parseCsvObjects(csv.species)) {
    const id = Number(r.id);
    if (!Number.isFinite(id) || id > MAX_SPECIES) continue; // alt forms live at 10001+
    const nm = nameBy.get(id);
    species.push({
      id,
      identifier: r.identifier ?? '',
      name: nm?.name ?? r.identifier ?? '',
      genus: nm?.genus ?? null,
      generation: Number(r.generation_id),
      evolvesFrom: r.evolves_from_species_id ? Number(r.evolves_from_species_id) : null,
      evolutionChainId: r.evolution_chain_id ? Number(r.evolution_chain_id) : null,
      isBaby: r.is_baby === '1',
      isLegendary: r.is_legendary === '1',
      isMythical: r.is_mythical === '1',
      dexOrder: Number(r.order),
    });
  }

  // type identifier by type_id (lowercase english slug, e.g. 'fire') — SCHEMA §10 dex_species_type.type
  const typeIdent: Map<string, string> = new Map();
  for (const r of parseCsvObjects(csv.typeVocab)) typeIdent.set(r.id ?? '', r.identifier ?? '');

  const types: { dexId: number; slot: number; type: string }[] = [];
  for (const r of parseCsvObjects(csv.types)) {
    const pid = Number(r.pokemon_id);
    if (!Number.isFinite(pid) || pid > MAX_SPECIES) continue; // default form id == species id (DEX-DATA §B.2)
    const ident = typeIdent.get(r.type_id ?? '');
    if (!ident) continue;
    types.push({ dexId: pid, slot: Number(r.slot), type: ident });
  }

  return { species, types };
}

export { MAX_SPECIES };

// ── name normalisation + species index (DEX-DATA §A.5 fallback) ──────────────
// NFKD-fold diacritics; fold every apostrophe codepoint to U+0027 (Farfetch'd trap, §A.4-F5);
// lowercase; drop . : ? ; fold all Unicode dashes to '-'; collapse whitespace.
export function normName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`´]/g, "'")
    .toLowerCase()
    .replace(/[.:?]/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
// Index key: normalised, with '-', "'" and spaces stripped entirely so Ho-Oh / ho oh / hooh collide.
export function indexKey(s: string): string {
  return normName(s).replace(/[-'\s]/g, '');
}

// Noise words stripped ONLY on the second pass (try full token windows first — the Sandy Shocks
// foot-gun, DEX-DATA §A.5).
const NOISE_WORDS = new Set(
  ('ex gx v vmax vstar break legend star mega m alolan galarian hisuian paldean dark shining ' +
    'radiant delta prime lv lvx').split(' '),
);

export class SpeciesIndex {
  private index = new Map<string, number>();
  add(text: string, id: number): void {
    const k = indexKey(text);
    if (k && !this.index.has(k)) this.index.set(k, id);
  }
  private attempt(tokens: string[]): number | null {
    for (let len = tokens.length; len >= 1; len--) {
      for (let start = 0; start + len <= tokens.length; start++) {
        const k = tokens.slice(start, start + len).join('').replace(/[-'\s]/g, '');
        const hit = this.index.get(k);
        if (hit != null) return hit;
      }
    }
    return null;
  }
  private resolveSegment(seg: string): number | null {
    const toks = normName(seg).split(' ').filter(Boolean);
    const full = this.attempt(toks);
    if (full != null) return full; // longest full window FIRST
    const denoised = toks.filter((t) => !NOISE_WORDS.has(t) && !/'s$/.test(t));
    return this.attempt(denoised);
  }
  // Resolve every species named on a card. Splits on '&' (tag-team/duo), strips [..] brackets and
  // '____' blanks. Returns de-duped ids in first-seen order.
  resolveAll(name: string): number[] {
    const cleaned = normName(name).replace(/\[[^\]]*\]/g, '').replace(/_+/g, '');
    const ids: number[] = [];
    for (const seg of cleaned.split('&')) {
      const id = this.resolveSegment(seg);
      if (id != null && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }
}

export function buildSpeciesIndex(species: DexSpeciesRow[]): SpeciesIndex {
  const idx = new SpeciesIndex();
  for (const s of species) {
    idx.add(s.name, s.id);       // display name (may carry ' ♀ ♂ - .)
    idx.add(s.identifier, s.id); // slug fallback (farfetchd, ho-oh, …)
  }
  return idx;
}

// ── card→species mapping (DEX-DATA §A) ───────────────────────────────────────
export interface RawCatalogCard {
  id: string;
  name: string;
  category: string;
  dexId?: number[];
}
export interface SpeciesLink {
  dexId: number;
  ord: number;
  source: 'tcgdex' | 'name_fallback' | 'manual_override';
}
export interface ConflictSeed {
  tcgdexId: string;
  tcgdexDexId: number;
  nameDexId: number;
}

// Detect single-species cards whose TCGdex dexId disagrees with the name-derived id (§A.4-F6).
// Only single-element dexId arrays are cross-checked (multi-species ordering is not an error).
export function detectConflicts(cards: RawCatalogCard[], idx: SpeciesIndex): ConflictSeed[] {
  const out: ConflictSeed[] = [];
  for (const c of cards) {
    if (c.category !== 'Pokemon') continue;
    if (!Array.isArray(c.dexId) || c.dexId.length !== 1) continue;
    const ids = idx.resolveAll(c.name);
    if (ids.length !== 1) continue; // only decide when the name resolves unambiguously
    if (ids[0] !== c.dexId[0]) out.push({ tcgdexId: c.id, tcgdexDexId: c.dexId[0]!, nameDexId: ids[0]! });
  }
  return out;
}

// Produce the card_species links for one Pokémon card, given the conflict override map.
export function mapCard(
  card: RawCatalogCard,
  idx: SpeciesIndex,
  overrideByTcgdexId: Map<string, number>, // resolved_to species that WINS over the raw dexId
  validSpecies: Set<number>,
): SpeciesLink[] {
  const override = overrideByTcgdexId.get(card.id);
  if (override != null) return [{ dexId: override, ord: 0, source: 'manual_override' }];

  if (Array.isArray(card.dexId) && card.dexId.length > 0) {
    const links: SpeciesLink[] = [];
    card.dexId.forEach((d, i) => {
      if (validSpecies.has(d)) links.push({ dexId: d, ord: i, source: 'tcgdex' });
    });
    if (links.length > 0) return links;
    // dexId present but all out of range (shouldn't happen: DEX-DATA §A.2) → fall through to name.
  }

  // No usable dexId → name fallback (the 66 Owner's Pokémon, §A.4-F1).
  const ids = idx.resolveAll(card.name);
  return ids.filter((d) => validSpecies.has(d)).map((d, i) => ({ dexId: d, ord: i, source: 'name_fallback' as const }));
}
