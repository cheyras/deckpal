// Pokédex importer — populates dex_species + dex_species_type from the vendored PokeAPI CSVs,
// then maps the TCGdex catalog's Pokémon cards onto species (card_species, M:N) and seeds the
// known-upstream-error override table (card_species_conflict). Idempotent; re-running is a no-op.
//
// Connection budget: a SINGLE pooled client for the whole run (sync = 1 of 3). Stays strictly in the
// dex tables: dex_species, dex_species_type, card_species, card_species_conflict. Reads `card`.
// Does NOT touch price/catalog/collection/user_dex_state tables.
//
// Mapping rules (wiki: Dex-Data §A, research/SCHEMA.md §10):
//   • gate on category='Pokemon' (4 Trainers carry dexId — must NOT capture)
//   • dexId is an ARRAY; map ALL ids (dexId[0] is unsafe on multi-species cards)
//   • 66 cards with no dexId → name-normalisation fallback
//   • 13 known-wrong dexId cards → card_species_conflict override that WINS over the raw dexId
//   • apostrophe codepoint fold before joining (Farfetch'd)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePool, loadEnv } from '@deckpal/db';
import { batchInsert } from '../batchInsert.js';
import {
  buildSpecies, buildSpeciesIndex, detectConflicts, mapCard, MAX_SPECIES,
  type RawCatalogCard, type SpeciesLink,
} from './transform.js';

const EXPECTED_CONFLICTS = 13; // DEX-DATA §A.4-F6, measured 2026-07-24

export interface DexImportSummary {
  species: number;
  speciesTypes: number;
  pokemonCards: number;
  cardSpeciesRows: number;
  mappedByTcgdex: number;
  mappedByFallback: number;
  mappedByOverride: number;
  zeroSpeciesCards: number;
  conflictsSeeded: number;
}

export async function importDex(pokeapiDir: string, catalogDir: string): Promise<DexImportSummary> {
  loadEnv();

  // ── read vendored species CSVs + build rows ──────────────────────────────
  const csv = {
    species: readFileSync(join(pokeapiDir, 'pokemon_species.csv'), 'utf-8'),
    names: readFileSync(join(pokeapiDir, 'pokemon_species_names.csv'), 'utf-8'),
    types: readFileSync(join(pokeapiDir, 'pokemon_types.csv'), 'utf-8'),
    typeVocab: readFileSync(join(pokeapiDir, 'types.csv'), 'utf-8'),
  };
  const { species, types } = buildSpecies(csv);
  if (species.length !== MAX_SPECIES)
    throw new Error(`expected ${MAX_SPECIES} species (Gen 1-9), got ${species.length}`);

  // ── read the compiled catalog for the mapping ────────────────────────────
  const cards: RawCatalogCard[] = JSON.parse(readFileSync(join(catalogDir, 'cards.json'), 'utf-8'));
  const pokemonCards = cards.filter((c) => c.category === 'Pokemon');

  const validSpecies = new Set(species.map((s) => s.id));
  const idx = buildSpeciesIndex(species);

  // Cross-check names against dexId → the 13 known upstream errors (§A.4-F6).
  const conflicts = detectConflicts(cards, idx);
  if (conflicts.length !== EXPECTED_CONFLICTS)
    console.warn(
      `[dex-import] WARN: detected ${conflicts.length} single-species conflicts, expected ${EXPECTED_CONFLICTS}. ` +
        'Upstream data may have shifted — review before trusting the override seed.',
    );

  const pool = makePool(1);
  const client = await pool.connect();
  const summary: DexImportSummary = {
    species: 0, speciesTypes: 0, pokemonCards: pokemonCards.length, cardSpeciesRows: 0,
    mappedByTcgdex: 0, mappedByFallback: 0, mappedByOverride: 0, zeroSpeciesCards: 0, conflictsSeeded: 0,
  };
  try {
    // ── 1. dex_species (self-FK: insert with NULL parent, then set it) ───────
    await client.query('BEGIN');
    await batchInsert(
      client,
      () => `INSERT INTO dex_species
               (id, identifier, name, genus, generation, evolution_chain_id,
                is_baby, is_legendary, is_mythical, dex_order)
             VALUES __VALUES__
             ON CONFLICT (id) DO UPDATE SET
               identifier=EXCLUDED.identifier, name=EXCLUDED.name, genus=EXCLUDED.genus,
               generation=EXCLUDED.generation, evolution_chain_id=EXCLUDED.evolution_chain_id,
               is_baby=EXCLUDED.is_baby, is_legendary=EXCLUDED.is_legendary,
               is_mythical=EXCLUDED.is_mythical, dex_order=EXCLUDED.dex_order`,
      10,
      species.map((s) => [
        s.id, s.identifier, s.name, s.genus, s.generation, s.evolutionChainId,
        s.isBaby, s.isLegendary, s.isMythical, s.dexOrder,
      ]),
    );
    // evolves_from_species_id in a second pass (parent id can exceed child id, e.g. Pichu 172 → Pikachu 25)
    const withParent = species.filter((s) => s.evolvesFrom != null);
    await batchInsert(
      client,
      (n) => `UPDATE dex_species AS d SET evolves_from_species_id = v.parent::int
              FROM (VALUES __VALUES__) AS v(id, parent) WHERE d.id = v.id::int
              -- n=${n}`,
      2,
      withParent.map((s) => [s.id, s.evolvesFrom]),
    );
    summary.species = species.length;

    // ── 2. dex_species_type (rebuild) ───────────────────────────────────────
    await client.query('DELETE FROM dex_species_type');
    await batchInsert(
      client,
      () => `INSERT INTO dex_species_type (dex_id, slot, type) VALUES __VALUES__`,
      3,
      types.map((t) => [t.dexId, t.slot, t.type]),
    );
    summary.speciesTypes = types.length;
    await client.query('COMMIT');

    // ── 3. resolve card_id by tcgdex_id for every Pokémon card ──────────────
    const { rows: cardIdRows } = await client.query<{ id: string; tcgdex_id: string }>(
      `SELECT id, tcgdex_id FROM card WHERE category = 'Pokemon'`,
    );
    const cardIdByTcgdex = new Map<string, number>();
    for (const r of cardIdRows) cardIdByTcgdex.set(r.tcgdex_id, Number(r.id));

    // ── 4. seed card_species_conflict (override that wins) ──────────────────
    // resolved_to is set to the name-derived id: DEX-DATA §A.4-F6 measured all 13 name-implied ids
    // to be correct. This one-time curated seed IS the human review the schema comment reserves.
    const overrideByTcgdexId = new Map<string, number>();
    const conflictRows: unknown[][] = [];
    for (const c of conflicts) {
      const cardId = cardIdByTcgdex.get(c.tcgdexId);
      if (cardId == null) continue; // card not in DB (shouldn't happen for imported catalog)
      overrideByTcgdexId.set(c.tcgdexId, c.nameDexId);
      conflictRows.push([cardId, c.tcgdexDexId, c.nameDexId, c.nameDexId]);
    }
    await client.query('BEGIN');
    if (conflictRows.length)
      await batchInsert(
        client,
        () => `INSERT INTO card_species_conflict
                 (card_id, tcgdex_dex_id, name_dex_id, resolved_to, resolved_by, resolved_at)
               SELECT v.card_id::bigint, v.tcgdex_dex_id::int, v.name_dex_id::int, v.resolved_to::int,
                      'dex-importer-seed (DEX-DATA §A.4-F6)', now()
               FROM (VALUES __VALUES__) AS v(card_id, tcgdex_dex_id, name_dex_id, resolved_to)
               ON CONFLICT (card_id) DO UPDATE SET
                 tcgdex_dex_id=EXCLUDED.tcgdex_dex_id, name_dex_id=EXCLUDED.name_dex_id,
                 resolved_to=EXCLUDED.resolved_to, resolved_by=EXCLUDED.resolved_by,
                 resolved_at=EXCLUDED.resolved_at`,
        4,
        conflictRows.map((r) => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3])]),
      );
    summary.conflictsSeeded = conflictRows.length;
    await client.query('COMMIT');

    // ── 5. build + write card_species (rebuild for all Pokémon cards) ───────
    const speciesRows: unknown[][] = [];
    for (const c of pokemonCards) {
      const cardId = cardIdByTcgdex.get(c.id);
      if (cardId == null) continue;
      const links: SpeciesLink[] = mapCard(c, idx, overrideByTcgdexId, validSpecies);
      if (links.length === 0) { summary.zeroSpeciesCards++; continue; }
      // A card maps via exactly one source; count CARDS by that source, rows separately.
      const src = links[0]!.source;
      if (src === 'tcgdex') summary.mappedByTcgdex++;
      else if (src === 'name_fallback') summary.mappedByFallback++;
      else summary.mappedByOverride++;
      const seenDex = new Set<number>();
      for (const l of links) {
        if (seenDex.has(l.dexId)) continue; // PK (card_id, dex_id) — collapse dup ids on one card
        seenDex.add(l.dexId);
        speciesRows.push([cardId, l.dexId, l.ord, l.source]);
      }
    }

    await client.query('BEGIN');
    const pokemonCardIds = pokemonCards
      .map((c) => cardIdByTcgdex.get(c.id))
      .filter((x): x is number => x != null);
    await client.query(`DELETE FROM card_species WHERE card_id = ANY($1::bigint[])`, [pokemonCardIds]);
    await batchInsert(
      client,
      () => `INSERT INTO card_species (card_id, dex_id, ord, source) VALUES __VALUES__`,
      4,
      speciesRows,
      300,
    );
    await client.query('COMMIT');
    summary.cardSpeciesRows = speciesRows.length;

    return summary;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
