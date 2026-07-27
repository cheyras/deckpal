import { Router } from 'express';
import { defaultUserId, pool, q, q1 } from '../db.js';
import { asyncHandler, notFound } from '../http.js';
import {
  validateDeck, buildReprintOracle, formatConfig, setAliases, normalizeName,
  type FormatCode, type PokemonType, type CardFacts, type Deck, type DeckEntry, type Section,
} from '../deck/index.js';
import {
  renderDeckPdf, renderListPdf, renderSetChecklistPdf,
  type DeckLine, type ListPdfItem, type SetChecklistCard,
} from './pdf.js';

/**
 * PDF export routes (BRIEF §7). Read-only, parameterized (ids come from the URL),
 * and each streams application/pdf with a Content-Disposition filename. These are
 * mounted at the /pokedex/api base BEFORE the /decks, /lists, /sets routers so the
 * `.../pdf` and `checklist.pdf` paths resolve here (those routers define no such
 * routes, but explicit ordering removes any ambiguity).
 *
 * The rendering lives in ./pdf.ts (pdfkit, pure-JS/ARM-safe). This file is only the
 * data layer + wiring: it reuses the same query shapes as scripts/export.mjs and the
 * sibling route modules, and the deck engine (validateDeck) for the legality verdict
 * — it never re-implements a rule or the DB helpers.
 */

export const exportRouter: Router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// tcgdex set id -> PTCGL set code (reverse of resolveSetAlias), for the deck list
// reference column. Built once; prefer the 'main' printing of a code.
const REVERSE_ALIAS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [ptcgl, a] of Object.entries(setAliases())) {
    if (!a.set) continue;
    if (!m.has(a.set) || a.kind === 'main') m.set(a.set, ptcgl);
  }
  return m;
})();

const nowStamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

/** RFC 5987-ish filename: strip to a safe slug, keep it short. */
function slug(s: string, fallback = 'export'): string {
  const out = s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return out || fallback;
}
function sendPdfHeaders(res: import('express').Response, filename: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
}

// ── GET /decks/:id/pdf ────────────────────────────────────────────────────────

interface DeckCardRow {
  card_id: string;
  quantity: number;
  tcgdex_id: string;
  local_id: string;
  local_id_numeric: number | null;
  name: string;
  name_normalized: string | null;
  category: 'Pokemon' | 'Trainer' | 'Energy';
  stage: string | null;
  suffix: string | null;
  trainer_type: string | null;
  energy_type: 'Normal' | 'Special' | null;
  hp: number | null;
  retreat: number | null;
  regulation_mark: string | null;
  evolve_from: string | null;
  released_on: string | null;
  set_tcgdex_id: string;
  owned_qty: string;
}

const sectionOf = (cat: DeckCardRow['category']): Section =>
  cat === 'Pokemon' ? 'pokemon' : cat === 'Trainer' ? 'trainer' : 'energy';

exportRouter.get(
  '/decks/:id/pdf',
  asyncHandler(async (req, res) => {
    const deckId = String(req.params.id);
    if (!UUID_RE.test(deckId)) throw notFound(`No deck '${deckId}'`);
    const userId = await defaultUserId();

    const meta = await q1<{ id: string; name: string; description: string | null; format_code: FormatCode; glc_type: string | null }>(
      `SELECT id, name, description, format_code, glc_type FROM deck WHERE id = $1 AND user_id = $2`,
      [deckId, userId],
    );
    if (!meta) throw notFound(`No deck '${deckId}'`);

    const rows = await q<DeckCardRow>(
      `SELECT dc.card_id, dc.quantity,
              c.tcgdex_id, c.local_id, c.local_id_numeric, c.name, c.name_normalized,
              c.category, c.stage, c.suffix, c.trainer_type, c.energy_type, c.hp, c.retreat,
              c.regulation_mark, c.evolve_from, c.released_on,
              s.tcgdex_id AS set_tcgdex_id,
              COALESCE(owned.owned_qty, 0) AS owned_qty
         FROM deck_card dc
         JOIN card c ON c.id = dc.card_id
         JOIN card_set s ON s.id = c.set_id
    LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(ci.quantity), 0) AS owned_qty
              FROM card_variant cv
              JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = dc.user_id
             WHERE cv.card_id = c.id
          ) owned ON true
        WHERE dc.deck_id = $1 AND dc.user_id = $2
        ORDER BY CASE c.category WHEN 'Pokemon' THEN 0 WHEN 'Trainer' THEN 1 ELSE 2 END, c.name, c.number_sort`,
      [deckId, userId],
    );

    // Card types (for the legality engine only).
    const ids = rows.map((r) => Number(r.card_id));
    const typeMap = new Map<number, PokemonType[]>();
    if (ids.length) {
      const trows = await q<{ card_id: string; type: string }>(
        `SELECT card_id, type FROM card_type WHERE card_id = ANY($1) ORDER BY card_id, slot`,
        [ids],
      );
      for (const t of trows) {
        const id = Number(t.card_id);
        const arr = typeMap.get(id) ?? [];
        arr.push(t.type as PokemonType);
        typeMap.set(id, arr);
      }
    }

    // Build the engine model + run validation exactly as routes/decks.ts does.
    const facts: CardFacts[] = [];
    const entries: DeckEntry[] = [];
    for (const r of rows) {
      const f: CardFacts = {
        id: Number(r.card_id),
        tcgdexId: r.tcgdex_id,
        setTcgdexId: r.set_tcgdex_id,
        localId: r.local_id,
        localIdNumeric: r.local_id_numeric,
        name: r.name,
        normalizedName: r.name_normalized ?? normalizeName(r.name),
        category: r.category,
        stage: r.stage,
        suffix: r.suffix,
        trainerType: r.trainer_type,
        energyType: r.energy_type,
        hp: r.hp,
        retreat: r.retreat,
        regulationMark: r.regulation_mark,
        evolveFrom: r.evolve_from,
        types: typeMap.get(Number(r.card_id)) ?? [],
        releasedOn: r.released_on,
      };
      facts.push(f);
      entries.push({ card: f, quantity: r.quantity, section: sectionOf(r.category) });
    }
    const deck: Deck = { formatCode: meta.format_code, glcType: (meta.glc_type as PokemonType | null) ?? null, entries };
    const cfg = formatConfig(meta.format_code);
    const validation =
      cfg.pool_strategy === 'all' || facts.length === 0
        ? validateDeck(deck, {})
        : validateDeck(deck, { isInFormatByReprint: await buildReprintOracle(pool, facts, cfg.legal_marks) });

    const toLine = (r: DeckCardRow): DeckLine => ({
      quantity: r.quantity,
      name: r.name,
      setCode: REVERSE_ALIAS.get(r.set_tcgdex_id) ?? r.set_tcgdex_id.toUpperCase(),
      number: r.local_id,
      owned: Number(r.owned_qty),
    });
    const byCat = (cat: DeckCardRow['category']): DeckLine[] => rows.filter((r) => r.category === cat).map(toLine);
    const sum = (cat: DeckCardRow['category']): number => rows.filter((r) => r.category === cat).reduce((n, r) => n + r.quantity, 0);

    sendPdfHeaders(res, `deck-${slug(meta.name, 'deck')}.pdf`);
    renderDeckPdf(res, {
      name: meta.name,
      description: meta.description,
      formatName: cfg.name,
      glcType: meta.glc_type,
      legal: validation.legal,
      violations: validation.violations
        .filter((v) => v.severity === 'error')
        .map((v) => v.message),
      counts: {
        total: rows.reduce((n, r) => n + r.quantity, 0),
        pokemon: sum('Pokemon'),
        trainer: sum('Trainer'),
        energy: sum('Energy'),
        distinctNames: new Set(rows.map((r) => r.name_normalized ?? r.name)).size,
      },
      pokemon: byCat('Pokemon'),
      trainer: byCat('Trainer'),
      energy: byCat('Energy'),
      generatedAt: nowStamp(),
    });
  }),
);

// ── GET /lists/:id/pdf ────────────────────────────────────────────────────────

interface ListRow {
  name: string;
  kind: 'dynamic' | 'static' | 'pokedex_binder';
  description: string | null;
}
interface ListItemRow {
  static_quantity: number | null;
  note: string | null;
  name: string | null;
  local_id: string | null;
  set_tcgdex_id: string | null;
  variant_display: string | null;
  owned_qty: string;
  dex_id: number | null;
  species_name: string | null;
  species_owned: boolean | null;
}

exportRouter.get(
  '/lists/:id/pdf',
  asyncHandler(async (req, res) => {
    const listId = String(req.params.id);
    if (!UUID_RE.test(listId)) throw notFound(`No list '${listId}'`);
    const userId = await defaultUserId();

    const list = await q1<ListRow>(
      `SELECT name, kind, description FROM card_list WHERE id = $1 AND user_id = $2`,
      [listId, userId],
    );
    if (!list) throw notFound(`No list '${listId}'`);

    const rows = await q<ListItemRow>(
      `SELECT li.static_quantity, li.note,
              c.name, c.local_id, s.tcgdex_id AS set_tcgdex_id, cv.display_name AS variant_display,
              COALESCE(ci.quantity, 0) AS owned_qty,
              li.dex_id, d.name AS species_name, sp.owned AS species_owned
         FROM list_item li
    LEFT JOIN card_variant cv ON cv.id = li.card_variant_id
    LEFT JOIN card c ON c.id = cv.card_id
    LEFT JOIN card_set s ON s.id = c.set_id
    LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
    LEFT JOIN dex_species d ON d.id = li.dex_id
    LEFT JOIN LATERAL (
            SELECT EXISTS (
               SELECT 1 FROM card_species csp
                 JOIN card_variant cvx ON cvx.card_id = csp.card_id
                 JOIN collection_item cix ON cix.card_variant_id = cvx.id AND cix.user_id = $2 AND cix.quantity >= 1
                WHERE csp.dex_id = li.dex_id
            ) AS owned
          ) sp ON true
        WHERE li.list_id = $1
        ORDER BY li.position, li.added_at`,
      [listId, userId],
    );

    const items: ListPdfItem[] = rows.map((r) => {
      if (r.dex_id != null) {
        return {
          name: r.species_name,
          setId: 'Pokédex',
          number: `#${r.dex_id}`,
          variant: null,
          owned: !!r.species_owned,
          quantity: null,
          note: r.note,
        };
      }
      const owned = Number(r.owned_qty);
      return {
        name: r.name,
        setId: r.set_tcgdex_id,
        number: r.local_id,
        variant: r.variant_display,
        owned: owned >= 1,
        quantity: r.static_quantity,
        note: r.note,
      };
    });
    const ownedCount = items.filter((i) => i.owned).length;
    const hasProgress = list.kind !== 'static';

    sendPdfHeaders(res, `list-${slug(list.name, 'list')}.pdf`);
    renderListPdf(res, {
      name: list.name,
      kind: list.kind,
      description: list.description,
      itemCount: items.length,
      ownedCount,
      hasProgress,
      items,
      generatedAt: nowStamp(),
    });
  }),
);

// ── GET /sets/:setId/checklist.pdf ────────────────────────────────────────────

interface SetMetaRow {
  id: string;
  tcgdex_id: string;
  name: string;
  released_on: string | null;
  card_count_official: number | null;
  card_count_total: number | null;
  series_name: string;
}
interface SetCardRow {
  local_id: string;
  name: string;
  rarity: string | null;
  category: string | null;
  sum_qty: string | null;
}

exportRouter.get(
  '/sets/:setId/checklist.pdf',
  asyncHandler(async (req, res) => {
    const setTcgdexId = String(req.params.setId);
    const userId = await defaultUserId();

    const set = await q1<SetMetaRow>(
      `SELECT cs.id, cs.tcgdex_id, cs.name, cs.released_on, cs.card_count_official, cs.card_count_total,
              ser.name AS series_name
         FROM card_set cs
         JOIN series ser ON ser.id = cs.series_id
        WHERE cs.tcgdex_id = $1`,
      [setTcgdexId],
    );
    if (!set) throw notFound(`No set '${setTcgdexId}'`);

    // One row per card: owned if ANY variant has qty >= 1 (the 'complete' goal,
    // matching routes/sets.ts card-fraction semantics).
    const rows = await q<SetCardRow>(
      `SELECT c.local_id, c.name, c.rarity, c.category,
              SUM(COALESCE(ci.quantity, 0)) AS sum_qty
         FROM card c
         JOIN card_variant cv ON cv.card_id = c.id
    LEFT JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = $2
        WHERE c.set_id = $1
        GROUP BY c.id, c.local_id, c.name, c.rarity, c.category, c.number_sort
        ORDER BY c.number_sort ASC`,
      [set.id, userId],
    );

    const cards: SetChecklistCard[] = rows.map((r) => ({
      number: r.local_id,
      name: r.name,
      rarity: r.rarity,
      category: r.category,
      owned: Number(r.sum_qty ?? 0) >= 1,
    }));
    const ownedCount = cards.filter((c) => c.owned).length;
    const total = cards.length;
    const printed = set.card_count_official ?? set.card_count_total ?? total;

    sendPdfHeaders(res, `set-${slug(set.tcgdex_id, 'set')}-checklist.pdf`);
    renderSetChecklistPdf(res, {
      setName: set.name,
      setId: set.tcgdex_id,
      seriesName: set.series_name,
      releasedOn: set.released_on ? new Date(set.released_on).toISOString().slice(0, 10) : null,
      printedCount: printed,
      total: set.card_count_total ?? total,
      progress: { owned: ownedCount, total, pct: total ? Math.round((ownedCount / total) * 1000) / 10 : 0 },
      cards,
      generatedAt: nowStamp(),
    });
  }),
);
