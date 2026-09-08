/**
 * PTCG Live export-line builder — turns catalogue deck rows into lines PTCG
 * Live's importer actually accepts, with structured warnings for anything that
 * cannot round-trip. DECK-FORMATS §1.8 plus rules verified 2026-07-30:
 *
 *  - Set codes come from the vendored alias table (data/ptcgl-set-alias.json),
 *    NEVER from an uppercased TCGdex id ("ME05"/"BASE1" are not PTCGL codes).
 *    ME-era codes (PFL/ASC/POR/CRI/PBL) verified against limitlesstcg.com/cards
 *    and 2026 NAIC / JP Championships decklists; see the JSON's per-entry notes.
 *  - Collector numbers are plain digits with leading zeros stripped — PTCGL's
 *    importer rejects "SHF 058"-style numbers (community.pokemon.com thread
 *    "Import deck problem... can't read numbers beginning with 0").
 *  - Basic Energy is canonicalised to PTCGL's own export spelling,
 *    "Basic {X} Energy SVE <n>" (7,713 corpus lines, DECK-FORMATS §1.5 case 2).
 *    PTCG Live grants unlimited basic Energy, so the SVE print always resolves
 *    regardless of which paper print the deck actually holds.
 *  - Energy cards whose printed name contains an energy symbol are written the
 *    way PTCGL writes them: type word -> brace ("Telepathic Psychic Energy" ->
 *    "Telepathic {P} Energy", §1.5 case 2b).
 *  - TCGdex parenthetical disambiguators are stripped ("Boss's Orders
 *    (Giovanni)" -> "Boss's Orders", §1.7.2) and curly apostrophes folded.
 *  - Prints PTCG Live does not have (pool floor = Sun & Moon series; XY/BW and
 *    older exist only as codes our importer accepts) are substituted with a
 *    fingerprint-identical Live-pool reprint when one exists, else exported as
 *    a bare name line (resolvable for Trainer/Energy per Limitless S10) with a
 *    structured warning. Never a silent garbage line.
 */
import type { Queryable } from '@deckpal/db';
import { serializePtcgl, type SerializableLine, type Section } from './ptcgl.js';
import { setAliases } from './data.js';
import { BRACE_TO_TYPE } from './names.js';
import { loadByName, computeFingerprints } from './db.js';

/** Minimal row shape the exporter needs (adapted from the route's DeckRow). */
export interface ExportRow {
  cardId: number;               // catalogue card.id (for fingerprint lookups)
  tcgdexId: string;             // for warning refs
  quantity: number;
  name: string;
  localId: string;
  category: 'Pokemon' | 'Trainer' | 'Energy';
  energyType: 'Normal' | 'Special' | null;
  setTcgdexId: string;
  setName: string;
}

/** Structured per-line export warning; `cardId` is the tcgdex id the UI speaks. */
export interface ExportWarning {
  code: 'SUBSTITUTED_PRINT' | 'NOT_ON_PTCGL';
  message: string;
  cardId: string;
}

export interface PtcglExportResult {
  text: string;
  warnings: ExportWarning[];
}

/** A Live-pool print found to substitute an unexportable one. */
export interface LiveReprint {
  setCode: string;
  number: string;
}

const TYPE_TO_BRACE: Record<string, string> = Object.fromEntries(
  Object.entries(BRACE_TO_TYPE).map(([b, t]) => [t, b]),
);

/** Canonical SVE collector number per basic-Energy type (SVE 1–8; no Fairy print exists). */
const SVE_NUMBER: Record<string, number> = {
  G: 1, R: 2, W: 3, L: 4, P: 5, F: 6, D: 7, M: 8,
};

// tcgdex set id -> { PTCGL code, in Live pool } (prefer the 'main' print of a code).
const REVERSE_ALIAS: Map<string, { code: string; live: boolean }> = (() => {
  const m = new Map<string, { code: string; live: boolean }>();
  for (const [code, a] of Object.entries(setAliases())) {
    if (!a.set) continue;
    if (!m.has(a.set) || a.kind === 'main') m.set(a.set, { code, live: a.live !== false });
  }
  return m;
})();

/** PTCGL code for a TCGdex set id, or null if the set has no PTCGL/Limitless code. */
export function ptcglCodeForSet(setTcgdexId: string): { code: string; live: boolean } | null {
  return REVERSE_ALIAS.get(setTcgdexId) ?? null;
}

const TYPE_WORDS = Object.keys(TYPE_TO_BRACE).join('|'); // Grass|Fire|...|Fairy

/**
 * Render a card name in PTCGL vocabulary: NFC, straight apostrophes, TCGdex
 * parenthetical disambiguator stripped, and (Energy cards only) an inner
 * energy-type word folded to its brace token.
 */
export function ptcglName(raw: string, category: ExportRow['category']): string {
  let s = raw.normalize('NFC').replace(/’/g, "'").trim();
  s = s.replace(/\s*\([^)]*\)\s*$/u, '').trim();
  if (category === 'Energy') {
    // "Telepathic Psychic Energy" -> "Telepathic {P} Energy"; leaves plain
    // "<Type> Energy" (basic) and no-type names ("Legacy Energy") untouched.
    const m = new RegExp(`^(.+) (${TYPE_WORDS}) Energy$`).exec(s);
    if (m) s = `${m[1]} {${TYPE_TO_BRACE[m[2]!]}} Energy`;
  }
  return s;
}

/** Brace letter if the row is a plain basic Energy ("Psychic Energy"), else null. */
export function basicEnergyBrace(row: Pick<ExportRow, 'name' | 'category' | 'energyType'>): string | null {
  if (row.category !== 'Energy' || row.energyType !== 'Normal') return null;
  const m = new RegExp(`^(${TYPE_WORDS}) Energy$`, 'i').exec(row.name.normalize('NFC').trim());
  if (!m) return null;
  const type = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase();
  return TYPE_TO_BRACE[type] ?? null;
}

function sectionOf(cat: ExportRow['category']): Section {
  return cat === 'Pokemon' ? 'pokemon' : cat === 'Trainer' ? 'trainer' : 'energy';
}

/**
 * Find a fingerprint-identical reprint of `row` in a set PTCG Live has.
 * Conservative: only substitutes when the playable fingerprint matches exactly
 * (same rules text), so a 1999 "Switch" with different wording is NOT swapped.
 * Newest Live print wins.
 */
export async function findLiveReprint(pool: Queryable, row: ExportRow): Promise<LiveReprint | null> {
  const candidates = (await loadByName(pool, row.name)).filter((c) => {
    if (c.id === row.cardId) return false;
    const alias = ptcglCodeForSet(c.setTcgdexId);
    return alias !== null && alias.live;
  });
  if (candidates.length === 0) return null;
  const fps = await computeFingerprints(pool, [row.cardId, ...candidates.map((c) => c.id)]);
  const own = fps.get(row.cardId);
  if (!own) return null; // too thin to trust — do not guess
  for (const c of candidates) { // loadByName orders newest first
    if (fps.get(c.id) === own) {
      return { setCode: ptcglCodeForSet(c.setTcgdexId)!.code, number: c.localId };
    }
  }
  return null;
}

/**
 * Build the PTCGL decklist text + structured warnings for a deck's rows.
 * `reprintLookup` is injected so unit tests need no database; the route passes
 * `(row) => findLiveReprint(dbHandle(), row)`.
 */
export async function buildPtcglExport(
  rows: ExportRow[],
  reprintLookup: (row: ExportRow) => Promise<LiveReprint | null>,
): Promise<PtcglExportResult> {
  const lines: SerializableLine[] = [];
  const warnings: ExportWarning[] = [];

  for (const row of rows) {
    const section = sectionOf(row.category);

    // 1. basic Energy -> canonical PTCGL form, independent of the paper print
    const brace = basicEnergyBrace(row);
    if (brace) {
      const sve = SVE_NUMBER[brace];
      lines.push({
        quantity: row.quantity,
        name: `Basic {${brace}} Energy`,
        setCode: sve !== undefined ? 'SVE' : null, // Fairy has no SVE print -> bare name
        number: sve !== undefined ? String(sve) : null,
        print: null,
        section,
      });
      continue;
    }

    const name = ptcglName(row.name, row.category);
    const alias = ptcglCodeForSet(row.setTcgdexId);

    // 2. print is in PTCG Live's pool -> emit its real code + number
    if (alias && alias.live) {
      lines.push({ quantity: row.quantity, name, setCode: alias.code, number: row.localId, print: null, section });
      continue;
    }

    // 3. print PTCG Live doesn't have -> try a fingerprint-identical Live reprint
    const sub = await reprintLookup(row);
    if (sub) {
      lines.push({ quantity: row.quantity, name, setCode: sub.setCode, number: sub.number, print: null, section });
      warnings.push({
        code: 'SUBSTITUTED_PRINT',
        message: `${row.name} (${row.setName} ${row.localId}) is not on PTCG Live — exported the identical reprint ${sub.setCode} ${sub.number} instead.`,
        cardId: row.tcgdexId,
      });
      continue;
    }

    // 4. no Live print at all -> bare name (resolvable for Trainer/Energy), never a fake code
    lines.push({ quantity: row.quantity, name, setCode: null, number: null, print: null, section });
    warnings.push({
      code: 'NOT_ON_PTCGL',
      message:
        row.category === 'Pokemon'
          ? `${row.name} (${row.setName} ${row.localId}) has no PTCG Live printing — this line will not import.`
          : `${row.name} (${row.setName} ${row.localId}) has no PTCG Live printing — exported as a name-only line; PTCG Live resolves Trainer/Energy cards by name if it has any version.`,
      cardId: row.tcgdexId,
    });
  }

  return { text: serializePtcgl(lines), warnings };
}
