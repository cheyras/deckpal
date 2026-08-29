/**
 * Read-only catalogue adapter for the deck engine. Turns real `card` rows into
 * `CardFacts`, resolves PTCGL lines via the §1.7 five-step ladder, computes
 * playable_fingerprints from the child tables, and materialises the reprint
 * legality oracle (§2.1.5).
 *
 * Everything here is read-only and parameterised. Uses its own pool clamped to a
 * SINGLE connection (the task's "prefer a single connection for tests"), created
 * on demand and closed by the caller — see prove.ts / the DB tests.
 */
import pg from 'pg';
import { loadEnv, makePool } from '@deckpal/db';
import type { CardFacts, Deck, DeckEntry, FormatCode, PokemonType, ValidationWarning } from './types.js';
import type { ParsedDeck, ParsedLine } from './ptcgl.js';
import { normalizeName, BRACE_TO_TYPE } from './names.js';
import { resolveSetAlias, formatConfig } from './data.js';
import { playableFingerprint, type FingerprintInput } from './fingerprint.js';

export function makeDeckPool(): pg.Pool {
  loadEnv();
  return makePool(1); // single connection; stays within the 3-total budget
}

interface CardRow {
  id: string;
  tcgdex_id: string;
  set_tcgdex_id: string;
  local_id: string;
  local_id_numeric: number | null;
  name: string;
  category: 'Pokemon' | 'Trainer' | 'Energy';
  stage: string | null;
  suffix: string | null;
  trainer_type: string | null;
  energy_type: 'Normal' | 'Special' | null;
  hp: number | null;
  retreat: number | null;
  regulation_mark: string | null;
  evolve_from: string | null;
  released_on: Date | string | null; // pg returns DATE columns as Date objects
}

const CARD_SELECT = `
  SELECT c.id, c.tcgdex_id, s.tcgdex_id AS set_tcgdex_id, c.local_id, c.local_id_numeric,
         c.name, c.category, c.stage, c.suffix, c.trainer_type, c.energy_type,
         c.hp, c.retreat, c.regulation_mark, c.evolve_from, c.released_on
    FROM card c JOIN card_set s ON s.id = c.set_id`;

async function typesFor(pool: pg.Pool, ids: number[]): Promise<Map<number, PokemonType[]>> {
  const out = new Map<number, PokemonType[]>();
  if (ids.length === 0) return out;
  const { rows } = await pool.query<{ card_id: string; type: string }>(
    `SELECT card_id, type FROM card_type WHERE card_id = ANY($1) ORDER BY card_id, slot`,
    [ids],
  );
  for (const r of rows) {
    const id = Number(r.card_id);
    const arr = out.get(id) ?? [];
    arr.push(r.type as PokemonType);
    out.set(id, arr);
  }
  return out;
}

function toFacts(row: CardRow, types: PokemonType[]): CardFacts {
  return {
    id: Number(row.id),
    tcgdexId: row.tcgdex_id,
    setTcgdexId: row.set_tcgdex_id,
    localId: row.local_id,
    localIdNumeric: row.local_id_numeric,
    name: row.name,
    normalizedName: normalizeName(row.name),
    category: row.category,
    stage: row.stage,
    suffix: row.suffix,
    trainerType: row.trainer_type,
    energyType: row.energy_type,
    hp: row.hp,
    retreat: row.retreat,
    regulationMark: row.regulation_mark,
    evolveFrom: row.evolve_from,
    types,
    // pg returns DATE columns as Date objects; CardFacts declares an ISO string
    releasedOn:
      row.released_on instanceof Date
        ? row.released_on.toISOString().slice(0, 10)
        : row.released_on,
  };
}

async function factsFromRows(pool: pg.Pool, rows: CardRow[]): Promise<CardFacts[]> {
  const typeMap = await typesFor(pool, rows.map((r) => Number(r.id)));
  return rows.map((r) => toFacts(r, typeMap.get(Number(r.id)) ?? []));
}

/** Load one card by (tcgdex set id, numeric collector number). */
export async function loadBySetNumber(
  pool: pg.Pool, setTcgdexId: string, number: string, offset = 0,
): Promise<CardFacts | null> {
  const numeric = /^\d+$/.test(number) ? parseInt(number, 10) + offset : null;
  if (numeric !== null) {
    const { rows } = await pool.query<CardRow>(
      `${CARD_SELECT} WHERE s.tcgdex_id = $1 AND c.local_id_numeric = $2 AND c.lang='en' LIMIT 1`,
      [setTcgdexId, numeric],
    );
    if (rows[0]) return (await factsFromRows(pool, [rows[0]]))[0]!;
  }
  // text fallback for non-numeric local ids (TG02, SV013, SWSH251)
  const { rows } = await pool.query<CardRow>(
    `${CARD_SELECT} WHERE s.tcgdex_id = $1 AND lower(c.local_id) = lower($2) AND c.lang='en' LIMIT 1`,
    [setTcgdexId, number],
  );
  return rows[0] ? (await factsFromRows(pool, [rows[0]]))[0]! : null;
}

/** Load one card by its catalogue id ('base1-60'). Exact, unlike splitting the
 *  id on '-': a set id may itself contain punctuation ('me02.5'), so the caller
 *  should never have to take the string apart. */
export async function loadByTcgdexId(pool: pg.Pool, tcgdexId: string): Promise<CardFacts | null> {
  const { rows } = await pool.query<CardRow>(
    `${CARD_SELECT} WHERE c.tcgdex_id = $1 AND c.lang='en' LIMIT 1`,
    [tcgdexId],
  );
  return rows[0] ? (await factsFromRows(pool, [rows[0]]))[0]! : null;
}

/** All prints of a normalized name (parenthetical-insensitive via LIKE prefilter + JS filter). */
export async function loadByName(pool: pg.Pool, rawName: string): Promise<CardFacts[]> {
  const nn = normalizeName(rawName);
  const { rows } = await pool.query<CardRow>(
    `${CARD_SELECT} WHERE c.name_normalized LIKE $1 AND c.lang='en'
     ORDER BY c.released_on DESC NULLS LAST, c.id`,
    [`${nn.replace(/[%_]/g, '')}%`],
  );
  const facts = await factsFromRows(pool, rows);
  return facts.filter((f) => f.normalizedName === nn);
}

/** Basic Energy of a given type (for {brace}/`Energy` pseudo-set, §1.5 case 2/3). */
async function loadBasicEnergyOfType(pool: pg.Pool, type: string): Promise<CardFacts | null> {
  const { rows } = await pool.query<CardRow>(
    `${CARD_SELECT}
      JOIN card_type t ON t.card_id = c.id
      WHERE c.category='Energy' AND c.energy_type='Normal' AND t.type=$1 AND c.lang='en'
      ORDER BY s.released_on DESC NULLS LAST LIMIT 1`,
    [type],
  );
  return rows[0] ? (await factsFromRows(pool, [rows[0]]))[0]! : null;
}

/** brace token in a name like "Basic {R} Energy" -> type; else null. */
function braceType(name: string): string | null {
  const m = /\{([A-Z])\}/.exec(name);
  return m ? (BRACE_TO_TYPE[m[1]!] ?? null) : null;
}

/**
 * Resolve one parsed line to a CardFacts via the §1.7.2 five-step ladder.
 * Returns the entry (with resolution provenance) or null if wholly unresolved.
 */
export async function resolveLine(
  pool: pg.Pool, line: ParsedLine, formatCode: FormatCode,
): Promise<DeckEntry | null> {
  const provenance = {
    quantity: line.quantity,
    section: line.section,
    srcSetCode: line.setCode,
    srcNumber: line.number,
    srcPrint: line.print,
    srcName: line.name,
  };

  const bt = braceType(line.name);
  const alias0 = line.setCode ? resolveSetAlias(line.setCode) : undefined;

  // basic Energy by brace when the set is the `Energy` pseudo-set, an energy set,
  // or an unmappable ALT pseudo-set (resolve by type, ignore the number — §1.5 case 2/3/5)
  if (bt && (line.setCode === 'Energy' || alias0?.kind === 'energy' || alias0?.kind === 'alt')) {
    const c = await loadBasicEnergyOfType(pool, bt);
    if (c) return { ...provenance, card: c, resolution: 'name_only' };
  }

  // step 1: (set, number) exact via the alias table
  if (line.setCode && line.number) {
    const alias = alias0;
    if (alias?.set) {
      const c = await loadBySetNumber(pool, alias.set, line.number, alias.number_offset ?? 0);
      if (c) return { ...provenance, card: c, resolution: 'exact' };
    }
    // step 2: (name, set) — one card of that name in the aliased set
    if (alias?.set) {
      const byName = await loadByName(pool, line.name);
      const inSet = byName.filter((c) => c.setTcgdexId === alias.set);
      if (inSet.length === 1) return { ...provenance, card: inSet[0]!, resolution: 'name_in_set' };
    }
  }

  // step 3: (name) alone -> pick by policy (legal in format, else most recent)
  const cfg = formatConfig(formatCode);
  const candidates = bt && line.setCode === 'Energy'
    ? [] // handled above
    : await loadByName(pool, line.name);
  if (candidates.length > 0) {
    const legal = candidates.find(
      (c) => c.regulationMark !== null && cfg.legal_marks.includes(c.regulationMark),
    );
    const pick = legal
      ?? candidates.slice().sort((a, b) => (b.releasedOn ?? '').localeCompare(a.releasedOn ?? ''))[0]!;
    return { ...provenance, card: pick, resolution: 'name_only' };
  }

  // last resort: a brace-energy name we could not place by set -> resolve by type
  if (bt) {
    const c = await loadBasicEnergyOfType(pool, bt);
    if (c) return { ...provenance, card: c, resolution: 'name_only' };
  }

  return null; // step 4: unresolved
}

/** Resolve a whole parsed deck. Never drops a line silently (§1.7.2 step 5). */
export async function resolveDeck(
  pool: pg.Pool, parsed: ParsedDeck, formatCode: FormatCode, glcType?: PokemonType | null,
): Promise<Deck> {
  const entries: DeckEntry[] = [];
  const warnings: ValidationWarning[] = [...parsed.warnings];
  for (const line of parsed.lines) {
    const resolved = await resolveLine(pool, line, formatCode);
    if (resolved) {
      // recompute the true section from the catalogue category (input is a hint)
      resolved.section =
        resolved.card.category === 'Pokemon' ? 'pokemon'
        : resolved.card.category === 'Trainer' ? 'trainer' : 'energy';
      entries.push(resolved);
    } else {
      warnings.push({
        code: 'UNRESOLVED_CARD',
        message: `"${line.quantity} ${line.name}${line.setCode ? ` ${line.setCode} ${line.number ?? ''}` : ''}" — could not resolve to a catalogue card.`,
      });
    }
  }
  return { formatCode, glcType: glcType ?? null, entries, importWarnings: warnings };
}

// ── Fingerprints + reprint oracle ─────────────────────────────────────────────

/** Build FingerprintInputs for a set of card ids by joining the child tables. */
export async function fingerprintInputs(pool: pg.Pool, ids: number[]): Promise<Map<number, FingerprintInput>> {
  const out = new Map<number, FingerprintInput>();
  if (ids.length === 0) return out;
  const { rows: base } = await pool.query<CardRow & { effect: string | null }>(
    `SELECT c.id, c.tcgdex_id, s.tcgdex_id AS set_tcgdex_id, c.local_id, c.local_id_numeric,
            c.name, c.category, c.stage, c.suffix, c.trainer_type, c.energy_type,
            c.hp, c.retreat, c.regulation_mark, c.evolve_from, c.released_on, c.effect
       FROM card c JOIN card_set s ON s.id=c.set_id WHERE c.id = ANY($1)`,
    [ids],
  );
  const types = await typesFor(pool, ids);
  const { rows: atk } = await pool.query<{ card_id: string; name: string; cost: string | null; damage: string | null; effect: string | null }>(
    `SELECT card_id, name, cost, damage, effect FROM card_attack WHERE card_id = ANY($1) ORDER BY card_id, ord`, [ids]);
  const { rows: abi } = await pool.query<{ card_id: string; kind: string | null; name: string; effect: string | null }>(
    `SELECT card_id, kind, name, effect FROM card_ability WHERE card_id = ANY($1) ORDER BY card_id, ord`, [ids]);
  const { rows: mu } = await pool.query<{ card_id: string; kind: string; type: string; value: string }>(
    `SELECT card_id, kind, type, value FROM card_matchup WHERE card_id = ANY($1) ORDER BY card_id, ord`, [ids]);

  const group = <T,>(rows: (T & { card_id: string })[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) { const id = Number(r.card_id); const a = m.get(id) ?? []; a.push(r); m.set(id, a); }
    return m;
  };
  const atkM = group(atk), abiM = group(abi), muM = group(mu);

  for (const r of base) {
    const id = Number(r.id);
    out.set(id, {
      name: r.name,
      category: r.category,
      hp: r.hp,
      types: types.get(id) ?? [],
      stage: r.stage,
      suffix: r.suffix,
      evolveFrom: r.evolve_from,
      trainerType: r.trainer_type,
      energyType: r.energy_type,
      effect: r.effect,
      attacks: (atkM.get(id) ?? []).map((a) => ({ name: a.name, cost: a.cost, damage: a.damage, effect: a.effect })),
      abilities: (abiM.get(id) ?? []).map((a) => ({ kind: a.kind, name: a.name, effect: a.effect })),
      weaknesses: (muM.get(id) ?? []).filter((x) => x.kind === 'weakness').map((x) => ({ type: x.type, value: x.value })),
      resistances: (muM.get(id) ?? []).filter((x) => x.kind === 'resistance').map((x) => ({ type: x.type, value: x.value })),
      retreat: r.retreat,
    });
  }
  return out;
}

export async function computeFingerprints(pool: pg.Pool, ids: number[]): Promise<Map<number, string | null>> {
  const inputs = await fingerprintInputs(pool, ids);
  const out = new Map<number, string | null>();
  for (const [id, inp] of inputs) out.set(id, playableFingerprint(inp));
  return out;
}

/**
 * The oracle computed from scratch, without consulting the stored fingerprint.
 *
 * The original implementation, kept whole because it is the ONLY path that
 * works on a database where `card.playable_fingerprint` has not been filled — a
 * fresh deployment, or one migrated without running `fingerprint:index`. See
 * {@link buildReprintOracle}.
 *
 * `name_normalized` is a prefilter and nothing more: it narrows the candidates
 * cheaply, and fingerprint equality decides. The two are not the same test —
 * measured, 30 rotated cards sharing a normalized name with a legal-marked card
 * produced ZERO fingerprint matches, because a promo Grookey and a modern
 * Grookey are different cards with one name.
 */
async function reprintOracleByCompute(
  pool: pg.Pool, need: CardFacts[], legalMarks: string[],
): Promise<Set<number>> {
  const legalIds = new Set<number>();
  const fpCache = await computeFingerprints(pool, need.map((c) => c.id));

  for (const card of need) {
    const fp = fpCache.get(card.id);
    if (!fp) continue;
    // candidate legal reprints share the normalized name and carry a legal mark
    const { rows } = await pool.query<{ id: string }>(
      `SELECT c.id FROM card c
        WHERE c.name_normalized = (SELECT name_normalized FROM card WHERE id=$1)
          AND c.regulation_mark = ANY($2) AND c.lang='en'`,
      [card.id, legalMarks],
    );
    const candFps = await computeFingerprints(pool, rows.map((r) => Number(r.id)));
    for (const [, cfp] of candFps) {
      if (cfp === fp) { legalIds.add(card.id); break; }
    }
  }
  return legalIds;
}

/**
 * Build the reprint-legality oracle for a specific deck (§2.1.5): for each deck
 * card, whether a fingerprint-identical card carrying a legal mark exists, so
 * the (synchronous) validator can consult it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE QUERY, BECAUSE THE FINGERPRINT IS A COLUMN NOW
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This used to hash everything at request time: `computeFingerprints` over the
 * deck, then per card a candidate lookup plus another five-query hydration to
 * hash the candidates. Measured against the real catalogue, 30 rotated cards
 * cost **185 queries and 5.6 seconds** — on `/decks/:id/validate`, which is
 * what `decks(include: ['validate'])` calls, which is what the agent calls.
 *
 * It hashed at request time because nothing had ever written
 * `card.playable_fingerprint`. Migration 047 and `fingerprintIndex.ts` fixed
 * that and indexed the column for exactly this lookup, so the whole oracle is
 * now one statement: for each deck card, does a row with the same fingerprint
 * carry a legal mark.
 *
 * ── AND IT MUST NOT ANSWER "NO" JUST BECAUSE THE INDEX IS EMPTY ─────────────
 *
 * The failure this guards is severe and silent. On a database where the pass
 * has not run, every `playable_fingerprint` is NULL, `NULL = NULL` is not true,
 * and the one-query form would report NO CARD as reprint-legal — turning legal
 * decks illegal, with a confident violation, on the validator whose whole job
 * is to be trusted. Nothing would throw.
 *
 * So a NULL fingerprint is never read as "no reprint". Those cards fall back to
 * {@link reprintOracleByCompute}, which consults no column, and the answer is
 * the one this code has always given.
 *
 * The warning separates the two reasons a fingerprint can be NULL, because one
 * is a problem and the other is not: a card too thin to hash is legitimately
 * NULL for ever (107 rows here), while a card that CAN be hashed and is not
 * stored means the index is behind. Only the second is worth saying — and
 * saying it is B11's shape, a deployment missing something saying so rather
 * than degrading quietly.
 */
export async function buildReprintOracle(
  pool: pg.Pool, cards: CardFacts[], legalMarks: string[],
): Promise<(card: CardFacts) => boolean> {
  const need = cards.filter((c) => !(c.regulationMark && legalMarks.includes(c.regulationMark)));
  if (need.length === 0) return () => false;

  const byId = new Map(need.map((c) => [c.id, c]));
  const { rows } = await pool.query<{ id: string; has_fp: boolean; legal: boolean }>(
    `SELECT mine.id,
            (mine.playable_fingerprint IS NOT NULL) AS has_fp,
            EXISTS (
              SELECT 1 FROM card legal
               WHERE legal.playable_fingerprint = mine.playable_fingerprint
                 AND legal.regulation_mark = ANY($2)
                 AND legal.lang = 'en'
            ) AS legal
       FROM card mine
      WHERE mine.id = ANY($1)`,
    [[...byId.keys()], legalMarks],
  );

  const legalIds = new Set<number>();
  const unindexed: CardFacts[] = [];
  for (const r of rows) {
    const id = Number(r.id);
    if (!r.has_fp) {
      const card = byId.get(id);
      if (card) unindexed.push(card);
    } else if (r.legal) {
      legalIds.add(id);
    }
  }

  if (unindexed.length > 0) {
    const computed = await computeFingerprints(pool, unindexed.map((c) => c.id));
    const stale = unindexed.filter((c) => computed.get(c.id));
    if (stale.length > 0) {
      console.warn(
        `[deck] ${stale.length} of ${need.length} card(s) can be hashed but have no stored ` +
          'playable_fingerprint — the index is behind the catalogue. Falling back to per-request ' +
          'hashing for those: correct, and slow. Run `pnpm --filter deckpal-api fingerprint:index`.',
      );
    }
    for (const id of await reprintOracleByCompute(pool, unindexed, legalMarks)) legalIds.add(id);
  }

  return (card: CardFacts) => legalIds.has(card.id);
}
