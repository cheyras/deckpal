import { Router } from 'express';
import type pg from 'pg';
import { cardImages, defaultUserId, pool, q, q1, toMajor, tcgplayerUrl, withTx } from '../db.js';
import { asyncHandler, badRequest, notFound, oneOf, str, userCache } from '../http.js';
import {
  validateDeck, resolveDeck, buildReprintOracle,
  parsePtcgl, parseMassEntry, serializePtcgl, serializeMassEntry,
  expandLibrary, drawOpeningHand, mulberry32, hypergeometricMulligan,
  formatConfig, setAliases, glcTypes, normalizeName,
  type FormatCode, type PokemonType, type CardFacts, type Deck, type DeckEntry,
  type ValidationResult, type ParsedDeck, type ParsedLine, type Section, type SerializableLine,
} from '../deck/index.js';

export const decksRouter: Router = Router();

/**
 * Deck builder (Phase 5, part 2). Persistence + validation + interchange, on top
 * of the already-verified deck engine in ../deck. This route NEVER re-implements a
 * rule — it adapts stored rows into the engine's `CardFacts`/`Deck` shapes, calls
 * validateDeck()/resolveDeck()/drawOpeningHand()/serializePtcgl(), and shapes the
 * result for the UI.
 *
 * The engine's db.ts adapter is read-only and takes a pg.Pool; we pass the shared
 * API pool (budget 2) so no extra connection is opened. Building CardFacts here
 * (loadDeckRows) duplicates data-adaptation, not rule logic — the engine exports no
 * "facts by card id" helper and its internals are off-limits.
 *
 * Live schema (read from the DB, not SCHEMA.md's richer proposal):
 *   deck(id uuid, user_id, format_code, glc_type, name, description, cover_card_id,
 *        cover_render, is_favorite, created_at, updated_at)
 *   deck_card(deck_id, card_id, user_id, quantity smallint 1..60) PK(deck_id,card_id)
 * deck_card is variant-agnostic (keyed by card.id, a print). Same print on two import
 * lines (PH vs non-PH) is summed. Unresolved lines cannot be stored (card_id NOT NULL,
 * FK) — they are reported to the caller, never dropped silently.
 *
 * Single default user, user_id threaded everywhere. Parameterized queries only —
 * users paste decklists, treat every value as untrusted.
 */

const FORMATS = ['standard', 'expanded', 'glc', 'unlimited'] as const;
const NAME_MAX = 120;
const DESC_MAX = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// tcgdex set id -> PTCGL set code, for lossless-ish export. Built once from the
// vendored alias table (prefer the 'main' print of a code). Reverse of resolveSetAlias.
const REVERSE_ALIAS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [ptcgl, a] of Object.entries(setAliases())) {
    if (!a.set) continue;
    if (!m.has(a.set) || a.kind === 'main') m.set(a.set, ptcgl);
  }
  return m;
})();

function parseFormat(v: unknown, fallback: FormatCode = 'standard'): FormatCode {
  return oneOf<FormatCode>(v, FORMATS, fallback);
}
function parseGlcType(v: unknown): PokemonType | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const hit = glcTypes().find((t) => t.toLowerCase() === s.toLowerCase());
  return hit ?? null;
}
function parseName(v: unknown, required = true): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) {
    if (required) throw badRequest('name is required');
    return '';
  }
  if (s.length > NAME_MAX) throw badRequest(`name must be ≤ ${NAME_MAX} chars`);
  return s;
}
function parseOptText(v: unknown, max: number, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw badRequest(`${field} must be ≤ ${max} chars`);
  return s;
}
function parseDeckId(v: string): string {
  if (!UUID_RE.test(v)) throw notFound(`No deck '${v}'`);
  return v;
}

// ── The shared loader: one query → CardFacts (for the engine) + display rows (for the UI) ──

interface DeckRow {
  card_id: string;
  quantity: number;
  tcgdex_id: string;
  local_id: string;
  local_id_numeric: number | null;
  number_sort: string | null;
  name: string;
  name_normalized: string;
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
  rarity: string | null;
  illustrator: string | null;
  set_tcgdex_id: string;
  set_name: string;
  series_tcgdex_id: string;
  series_slug: string;
  market_minor: number | null;
  currency_code: string | null;
  owned_qty: string;
  tcgplayer_url: string | null;
  tcgplayer_product_id: number | null;
  tcgplayer_printing: string | null;
  tcgplayer_mass_entry: string | null;
}

interface DeckMeta {
  id: string;
  name: string;
  description: string | null;
  format_code: FormatCode;
  glc_type: string | null;
  is_favorite: boolean;
  cover_card_id: string | null;
  cover_render: string;
  created_at: string;
  updated_at: string;
}

const DECK_CARD_SELECT = `
  SELECT dc.card_id, dc.quantity,
         c.tcgdex_id, c.local_id, c.local_id_numeric, c.number_sort, c.name, c.name_normalized,
         c.category, c.stage, c.suffix, c.trainer_type, c.energy_type, c.hp, c.retreat,
         c.regulation_mark, c.evolve_from, c.released_on, c.rarity, c.illustrator,
         s.tcgdex_id AS set_tcgdex_id, s.name AS set_name,
         ser.tcgdex_id AS series_tcgdex_id, ser.slug AS series_slug,
         price.market_minor, price.currency_code,
         owned.owned_qty,
         buy.tcgplayer_url, buy.tcgplayer_product_id, buy.tcgplayer_printing, buy.tcgplayer_mass_entry
    FROM deck_card dc
    JOIN card c ON c.id = dc.card_id
    JOIN card_set s ON s.id = c.set_id
    JOIN series ser ON ser.id = s.series_id
    LEFT JOIN LATERAL (
           SELECT pc.market_minor, pc.currency_code
             FROM card_variant cvp
             JOIN price_current pc ON pc.card_variant_id = cvp.id
              AND pc.source_code = 'tcgcsv' AND pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
            WHERE cvp.card_id = c.id
            ORDER BY cvp.is_primary DESC, cvp.sort_order LIMIT 1
         ) price ON true
    LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(ci.quantity), 0) AS owned_qty
             FROM card_variant cv
             JOIN collection_item ci ON ci.card_variant_id = cv.id AND ci.user_id = dc.user_id
            WHERE cv.card_id = c.id
         ) owned ON true
    LEFT JOIN LATERAL (
           SELECT cv.tcgplayer_url, cv.tcgplayer_product_id, cv.tcgplayer_printing, cv.tcgplayer_mass_entry
             FROM card_variant cv
            WHERE cv.card_id = c.id
            ORDER BY cv.is_primary DESC, cv.sort_order LIMIT 1
         ) buy ON true
   WHERE dc.deck_id = $1 AND dc.user_id = $2
   ORDER BY CASE c.category WHEN 'Pokemon' THEN 0 WHEN 'Trainer' THEN 1 ELSE 2 END,
            c.name, c.number_sort`;

function sectionOf(cat: DeckRow['category']): Section {
  return cat === 'Pokemon' ? 'pokemon' : cat === 'Trainer' ? 'trainer' : 'energy';
}

async function loadMeta(deckId: string, userId: number): Promise<DeckMeta | null> {
  return q1<DeckMeta>(
    `SELECT id, name, description, format_code, glc_type, is_favorite, cover_card_id, cover_render, created_at, updated_at
       FROM deck WHERE id = $1 AND user_id = $2`,
    [deckId, userId],
  );
}

async function loadRows(deckId: string, userId: number): Promise<{ rows: DeckRow[]; types: Map<number, PokemonType[]> }> {
  const rows = await q<DeckRow>(DECK_CARD_SELECT, [deckId, userId]);
  const ids = rows.map((r) => Number(r.card_id));
  const types = new Map<number, PokemonType[]>();
  if (ids.length) {
    const trows = await q<{ card_id: string; type: string }>(
      `SELECT card_id, type FROM card_type WHERE card_id = ANY($1) ORDER BY card_id, slot`,
      [ids],
    );
    for (const t of trows) {
      const id = Number(t.card_id);
      const arr = types.get(id) ?? [];
      arr.push(t.type as PokemonType);
      types.set(id, arr);
    }
  }
  return { rows, types };
}

function toFacts(r: DeckRow, types: PokemonType[]): CardFacts {
  return {
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
    types,
    releasedOn: r.released_on,
  };
}

function buildDeckModel(meta: DeckMeta, rows: DeckRow[], types: Map<number, PokemonType[]>, formatOverride?: FormatCode): { deck: Deck; facts: CardFacts[] } {
  const entries: DeckEntry[] = [];
  const facts: CardFacts[] = [];
  for (const r of rows) {
    const f = toFacts(r, types.get(Number(r.card_id)) ?? []);
    facts.push(f);
    entries.push({ card: f, quantity: r.quantity, section: sectionOf(r.category) });
  }
  return {
    deck: {
      formatCode: formatOverride ?? meta.format_code,
      glcType: (meta.glc_type as PokemonType | null) ?? null,
      entries,
    },
    facts,
  };
}

/** Run the engine with a reprint oracle (built from the shared pool) for pool-checked formats. */
async function validate(deck: Deck, facts: CardFacts[]): Promise<ValidationResult> {
  const cfg = formatConfig(deck.formatCode);
  if (cfg.pool_strategy === 'all' || facts.length === 0) {
    return validateDeck(deck, {});
  }
  const oracle = await buildReprintOracle(pool, facts, cfg.legal_marks);
  return validateDeck(deck, { isInFormatByReprint: oracle });
}

function priceUsd(r: DeckRow): number | null {
  return r.market_minor != null ? toMajor(r.market_minor, r.currency_code ?? 'USD') : null;
}

function shapeCard(r: DeckRow) {
  const owned = Number(r.owned_qty);
  return {
    cardId: r.tcgdex_id,
    name: r.name,
    number: r.local_id,
    numberSort: r.number_sort,
    category: r.category,
    section: sectionOf(r.category),
    stage: r.stage,
    rarity: r.rarity,
    artist: r.illustrator,
    regulationMark: r.regulation_mark,
    setId: r.set_tcgdex_id,
    setName: r.set_name,
    seriesSlug: r.series_slug,
    quantity: r.quantity,
    owned,
    have: owned >= r.quantity,
    images: cardImages(r.series_tcgdex_id, r.set_tcgdex_id, r.local_id),
    price: r.market_minor != null ? { market: priceUsd(r), currency: (r.currency_code ?? 'USD').trim() } : null,
  };
}

function counts(rows: DeckRow[]) {
  const by = (cat: string) => rows.filter((r) => r.category === cat).reduce((n, r) => n + r.quantity, 0);
  return {
    total: rows.reduce((n, r) => n + r.quantity, 0),
    pokemon: by('Pokemon'),
    trainer: by('Trainer'),
    energy: by('Energy'),
    distinctNames: new Set(rows.map((r) => r.name_normalized)).size,
  };
}

/** Map numeric card_ids referenced by violations → display refs so the UI can highlight in place. */
function cardRefs(rows: DeckRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    out[r.card_id] = {
      cardId: r.tcgdex_id,
      name: r.name,
      number: r.local_id,
      setId: r.set_tcgdex_id,
      seriesSlug: r.series_slug,
      image: cardImages(r.series_tcgdex_id, r.set_tcgdex_id, r.local_id).low,
    };
  }
  return out;
}

function shapeMeta(meta: DeckMeta, rows: DeckRow[], legal: boolean) {
  const value = rows.reduce((n, r) => n + (r.market_minor ?? 0) * r.quantity, 0);
  const cover = rows.find((r) => String(r.card_id) === String(meta.cover_card_id)) ?? rows[0];
  const c = counts(rows);
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    formatCode: meta.format_code,
    formatName: formatConfig(meta.format_code).name,
    glcType: meta.glc_type,
    isFavorite: meta.is_favorite,
    coverRender: meta.cover_render,
    coverImage: cover ? cardImages(cover.series_tcgdex_id, cover.set_tcgdex_id, cover.local_id) : null,
    totalCount: c.total,
    valueUsd: rows.length ? toMajor(value, 'USD') : 0,
    legal,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
  };
}

/** Full detail payload (deck + grouped cards + counts + validation under stored format). */
async function detailPayload(meta: DeckMeta, userId: number) {
  const { rows, types } = await loadRows(meta.id, userId);
  const { deck, facts } = buildDeckModel(meta, rows, types);
  const validation = await validate(deck, facts);
  return {
    deck: shapeMeta(meta, rows, validation.legal),
    counts: counts(rows),
    cards: rows.map(shapeCard),
    validation,
    cardRefs: cardRefs(rows),
    glcTypes: glcTypes(),
  };
}

// ── GET /decks — index ────────────────────────────────────────────────────────
decksRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const userId = await defaultUserId();
    const metas = await q<DeckMeta>(
      `SELECT id, name, description, format_code, glc_type, is_favorite, cover_card_id, cover_render, created_at, updated_at
         FROM deck WHERE user_id = $1 ORDER BY is_favorite DESC, updated_at DESC`,
      [userId],
    );
    const decks = [];
    for (const meta of metas) {
      const { rows, types } = await loadRows(meta.id, userId);
      const { deck, facts } = buildDeckModel(meta, rows, types);
      const v = await validate(deck, facts);
      decks.push(shapeMeta(meta, rows, v.legal));
    }
    userCache(res);
    res.json({ decks });
  }),
);

// ── POST /decks — create (empty) ──────────────────────────────────────────────
decksRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const name = parseName(body.name);
    const format = parseFormat(body.formatCode ?? body.format);
    const description = parseOptText(body.description, DESC_MAX, 'description');
    let glcType = parseGlcType(body.glcType);
    if (format === 'glc' && !glcType) glcType = glcTypes()[0] ?? null; // NOT NULL constraint for glc
    const userId = await defaultUserId();
    const row = await q1<{ id: string }>(
      `INSERT INTO deck (user_id, format_code, glc_type, name, description)
            VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, format, glcType, name, description],
    );
    const meta = (await loadMeta(row!.id, userId))!;
    userCache(res);
    res.status(201).json(await detailPayload(meta, userId));
  }),
);

// ── GET /decks/:id — detail ───────────────────────────────────────────────────
decksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    userCache(res);
    res.json(await detailPayload(meta, userId));
  }),
);

// ── PATCH /decks/:id — rename / format / glcType / favorite / cover ───────────
decksRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const body = req.body ?? {};

    const meta0 = await loadMeta(deckId, userId);
    if (!meta0) throw notFound(`No deck '${deckId}'`);

    const sets: string[] = [];
    const params: unknown[] = [deckId, userId];
    const push = (frag: string, val: unknown) => {
      params.push(val);
      sets.push(`${frag} = $${params.length}`);
    };
    if (body.name !== undefined) push('name', parseName(body.name));
    if (body.description !== undefined) push('description', parseOptText(body.description, DESC_MAX, 'description'));
    if (body.isFavorite !== undefined) push('is_favorite', Boolean(body.isFavorite));
    if (body.coverRender !== undefined) push('cover_render', oneOf(body.coverRender, ['full', 'art'] as const, 'full'));

    // format + glcType are coupled by the deck_check constraint (glc requires glc_type).
    const nextFormat = body.formatCode !== undefined || body.format !== undefined
      ? parseFormat(body.formatCode ?? body.format, meta0.format_code)
      : meta0.format_code;
    if (body.formatCode !== undefined || body.format !== undefined) push('format_code', nextFormat);
    if (nextFormat === 'glc') {
      let glcType = body.glcType !== undefined ? parseGlcType(body.glcType) : (meta0.glc_type as PokemonType | null);
      if (!glcType) glcType = glcTypes()[0] ?? null;
      push('glc_type', glcType);
    } else if (body.glcType !== undefined || (body.formatCode !== undefined || body.format !== undefined)) {
      push('glc_type', null); // clear when leaving GLC
    }

    if (sets.length) {
      await q(`UPDATE deck SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2`, params);
    }
    const meta = (await loadMeta(deckId, userId))!;
    userCache(res);
    res.json(await detailPayload(meta, userId));
  }),
);

// ── DELETE /decks/:id ─────────────────────────────────────────────────────────
decksRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const del = await q1<{ id: string }>(`DELETE FROM deck WHERE id = $1 AND user_id = $2 RETURNING id`, [deckId, userId]);
    if (!del) throw notFound(`No deck '${deckId}'`);
    userCache(res);
    res.json({ deleted: deckId });
  }),
);

// ── card add / set-quantity / remove ──────────────────────────────────────────
// deck_card is keyed by card.id (bigint). The UI speaks tcgdex ids; resolve first.
async function resolveCardId(client: pg.PoolClient, ref: string): Promise<number> {
  // numeric → catalogue id; else tcgdex id (english print)
  if (/^\d+$/.test(ref)) {
    const r = await client.query<{ id: string }>(`SELECT id FROM card WHERE id = $1`, [Number(ref)]);
    if (r.rows[0]) return Number(r.rows[0].id);
  }
  const r = await client.query<{ id: string }>(`SELECT id FROM card WHERE tcgdex_id = $1 AND lang = 'en' LIMIT 1`, [ref]);
  if (!r.rows[0]) throw notFound(`No card '${ref}'`);
  return Number(r.rows[0].id);
}

async function assertDeck(client: pg.PoolClient, deckId: string, userId: number): Promise<void> {
  const r = await client.query(`SELECT 1 FROM deck WHERE id = $1 AND user_id = $2 FOR UPDATE`, [deckId, userId]);
  if (!r.rows[0]) throw notFound(`No deck '${deckId}'`);
}

// POST /decks/:id/cards {cardId, quantity=1} — additive upsert (clamped to 60).
decksRouter.post(
  '/:id/cards',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const body = req.body ?? {};
    const ref = str(body.cardId) ?? str(body.card);
    if (!ref) throw badRequest('cardId is required');
    let qty = Number(body.quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1) qty = 1;

    await withTx(async (client) => {
      await assertDeck(client, deckId, userId);
      const cardId = await resolveCardId(client, ref);
      await client.query(
        `INSERT INTO deck_card (deck_id, card_id, user_id, quantity)
              VALUES ($1, $2, $3, LEAST($4, 60))
         ON CONFLICT (deck_id, card_id)
         DO UPDATE SET quantity = LEAST(deck_card.quantity + $4, 60)`,
        [deckId, cardId, userId, qty],
      );
      await client.query(`UPDATE deck SET updated_at = now() WHERE id = $1`, [deckId]);
    });

    const meta = (await loadMeta(deckId, userId))!;
    userCache(res);
    res.status(201).json(await detailPayload(meta, userId));
  }),
);

// PATCH /decks/:id/cards/:cardId {quantity} — set absolute (0 removes).
decksRouter.patch(
  '/:id/cards/:cardId',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const ref = String(req.params.cardId);
    const qty = Number((req.body ?? {}).quantity);
    if (!Number.isInteger(qty) || qty < 0 || qty > 60) throw badRequest('quantity must be an integer 0..60');

    await withTx(async (client) => {
      await assertDeck(client, deckId, userId);
      const cardId = await resolveCardId(client, ref);
      if (qty === 0) {
        await client.query(`DELETE FROM deck_card WHERE deck_id = $1 AND card_id = $2 AND user_id = $3`, [deckId, cardId, userId]);
      } else {
        await client.query(
          `INSERT INTO deck_card (deck_id, card_id, user_id, quantity) VALUES ($1, $2, $3, $4)
           ON CONFLICT (deck_id, card_id) DO UPDATE SET quantity = $4`,
          [deckId, cardId, userId, qty],
        );
      }
      await client.query(`UPDATE deck SET updated_at = now() WHERE id = $1`, [deckId]);
    });

    const meta = (await loadMeta(deckId, userId))!;
    userCache(res);
    res.json(await detailPayload(meta, userId));
  }),
);

// DELETE /decks/:id/cards/:cardId
decksRouter.delete(
  '/:id/cards/:cardId',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const ref = String(req.params.cardId);
    await withTx(async (client) => {
      await assertDeck(client, deckId, userId);
      const cardId = await resolveCardId(client, ref);
      await client.query(`DELETE FROM deck_card WHERE deck_id = $1 AND card_id = $2 AND user_id = $3`, [deckId, cardId, userId]);
      await client.query(`UPDATE deck SET updated_at = now() WHERE id = $1`, [deckId]);
    });
    const meta = (await loadMeta(deckId, userId))!;
    userCache(res);
    res.json(await detailPayload(meta, userId));
  }),
);

// ── GET /decks/:id/validate?format= — the engine result + card refs ───────────
decksRouter.get(
  '/:id/validate',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const format = req.query.format !== undefined ? parseFormat(req.query.format, meta.format_code) : meta.format_code;
    const { rows, types } = await loadRows(deckId, userId);
    const { deck, facts } = buildDeckModel(meta, rows, types, format);
    const validation = await validate(deck, facts);
    userCache(res);
    res.json({ validation, cardRefs: cardRefs(rows) });
  }),
);

// ── POST /decks/import — PTCGL or Mass Entry text → new deck ───────────────────
decksRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) throw badRequest('text is required');
    if (text.length > 20000) throw badRequest('decklist text too large');
    const source = oneOf(body.source, ['ptcgl', 'massentry'] as const, 'ptcgl');
    const format = parseFormat(body.formatCode ?? body.format);
    let glcType = parseGlcType(body.glcType);
    if (format === 'glc' && !glcType) glcType = glcTypes()[0] ?? null;
    const name = parseName(body.name, false) || 'Imported Deck';
    const userId = await defaultUserId();

    // Parse to a ParsedDeck the resolver understands. Mass Entry's set codes are a
    // THIRD namespace (TCGplayer abbrevs) the engine can't map, so we resolve those
    // lines by name only (setCode null) — §1.9.
    let parsed: ParsedDeck;
    if (source === 'massentry') {
      const me = parseMassEntry(text);
      const lines: ParsedLine[] = me.lines.map((l) => ({
        quantity: l.quantity, name: l.name, setCode: null, number: null, print: null, section: 'pokemon', raw: l.raw,
      }));
      parsed = { lines, headers: [], trailerCount: null, warnings: me.warnings };
    } else {
      parsed = parsePtcgl(text);
    }

    const resolved = await resolveDeck(pool, parsed, format, glcType);

    // Aggregate resolved entries by catalogue card id (same print on two lines sums).
    const byCard = new Map<number, number>();
    for (const e of resolved.entries) {
      byCard.set(e.card.id, Math.min(60, (byCard.get(e.card.id) ?? 0) + e.quantity));
    }
    const unresolved = (resolved.importWarnings ?? []).filter((w) => w.code === 'UNRESOLVED_CARD');

    const deckId = await withTx(async (client) => {
      const row = await client.query<{ id: string }>(
        `INSERT INTO deck (user_id, format_code, glc_type, name) VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, format, glcType, name],
      );
      const id = row.rows[0]!.id;
      for (const [cardId, quantity] of byCard) {
        await client.query(
          `INSERT INTO deck_card (deck_id, card_id, user_id, quantity) VALUES ($1, $2, $3, $4)`,
          [id, cardId, userId, quantity],
        );
      }
      return id;
    });

    const meta = (await loadMeta(deckId, userId))!;
    const payload = await detailPayload(meta, userId);
    userCache(res);
    res.status(201).json({
      ...payload,
      import: {
        source,
        resolvedEntries: resolved.entries.length,
        distinctCards: byCard.size,
        unresolved: unresolved.map((w) => w.message),
        warnings: (resolved.importWarnings ?? []).filter((w) => w.code !== 'UNRESOLVED_CARD'),
      },
    });
  }),
);

// ── GET /decks/:id/export?format=ptcgl|massentry ──────────────────────────────
decksRouter.get(
  '/:id/export',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const kind = oneOf(req.query.format, ['ptcgl', 'massentry'] as const, 'ptcgl');
    const { rows } = await loadRows(deckId, userId);

    let text: string;
    if (kind === 'massentry') {
      // Buy format (§1.9): use the stored per-variant Mass Entry line when present,
      // else a bare name line. Never share the PTCGL formatter.
      text = serializeMassEntry(
        rows.map((r) => ({
          quantity: r.quantity,
          name: r.name,
          setCode: r.tcgplayer_mass_entry ? (r.tcgplayer_mass_entry.match(/\[([^\]]+)\]/)?.[1] ?? null) : null,
          number: null,
          raw: '',
        })),
      );
    } else {
      const lines: SerializableLine[] = rows.map((r) => ({
        quantity: r.quantity,
        name: r.name,
        setCode: REVERSE_ALIAS.get(r.set_tcgdex_id) ?? r.set_tcgdex_id.toUpperCase(),
        number: r.local_id,
        print: null,
        section: sectionOf(r.category),
      }));
      text = serializePtcgl(lines);
    }
    userCache(res);
    res.json({ format: kind, text });
  }),
);

// ── GET /decks/:id/testhand?seed= — opening-hand draw (seedable) ──────────────
decksRouter.get(
  '/:id/testhand',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const { rows, types } = await loadRows(deckId, userId);
    const { deck } = buildDeckModel(meta, rows, types);

    const seed = req.query.seed !== undefined && /^\d+$/.test(String(req.query.seed))
      ? Number(req.query.seed) >>> 0
      : (Math.random() * 0xffffffff) >>> 0;

    const library = expandLibrary(deck.entries);
    const draw = drawOpeningHand(library, mulberry32(seed));

    // Display refs by catalogue card id, from the same rows.
    const refById = new Map<number, DeckRow>(rows.map((r) => [Number(r.card_id), r]));
    const shapeHand = (c: { isBasicPokemon: boolean; card?: CardFacts }) => {
      const r = c.card ? refById.get(c.card.id) : undefined;
      return {
        cardId: r?.tcgdex_id ?? null,
        name: c.card?.name ?? '—',
        number: r?.local_id ?? null,
        category: c.card?.category ?? null,
        isBasicPokemon: c.isBasicPokemon,
        image: r ? cardImages(r.series_tcgdex_id, r.set_tcgdex_id, r.local_id).low : null,
      };
    };

    const basicCount = library.filter((c) => c.isBasicPokemon).length;
    userCache(res);
    res.json({
      seed,
      deckSize: library.length,
      basicPokemonCount: basicCount,
      mulligans: draw.mulligans,
      // §4.2: the opponent may draw one card per EXTRA mulligan — the single most
      // useful test-hand output. Here it equals this player's mulligan count.
      opponentDraws: draw.mulligans,
      mulliganChancePct: Math.round(hypergeometricMulligan(library.length, basicCount) * 1000) / 10,
      hand: draw.hand.map(shapeHand),
      prizes: draw.prizes.map(shapeHand),
      note: draw.mulligans > 0
        ? `Drew ${draw.mulligans} mulligan${draw.mulligans === 1 ? '' : 's'} before a keepable hand — your opponent may draw ${draw.mulligans} extra card${draw.mulligans === 1 ? '' : 's'}.`
        : 'Keepable opening hand (contains a Basic Pokémon).',
    });
  }),
);

// ── GET /decks/:id/pricing — per-card + total, and the "buy missing" list ─────
decksRouter.get(
  '/:id/pricing',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = await defaultUserId();
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const { rows } = await loadRows(deckId, userId);

    let totalMinor = 0;
    let ownedMinor = 0;
    let missingMinor = 0;
    const cards = rows.map((r) => {
      const owned = Number(r.owned_qty);
      const unit = r.market_minor;
      const lineMinor = (unit ?? 0) * r.quantity;
      totalMinor += lineMinor;
      ownedMinor += (unit ?? 0) * Math.min(owned, r.quantity);
      return {
        cardId: r.tcgdex_id,
        name: r.name,
        number: r.local_id,
        setId: r.set_tcgdex_id,
        quantity: r.quantity,
        owned,
        unitPrice: toMajor(unit, 'USD'),
        lineTotal: unit != null ? toMajor(lineMinor, 'USD') : null,
        currency: 'USD',
      };
    });

    const missing = rows
      .map((r) => {
        const owned = Number(r.owned_qty);
        const missingQty = Math.max(0, r.quantity - owned);
        if (missingQty === 0) return null;
        const lineMinor = (r.market_minor ?? 0) * missingQty;
        missingMinor += lineMinor;
        const buyUrl = tcgplayerUrl(r.tcgplayer_url, r.tcgplayer_product_id, r.tcgplayer_printing);
        const massEntry = r.tcgplayer_mass_entry
          ? `${missingQty}${r.tcgplayer_mass_entry.replace(/^\d+/, '')}`
          : `${missingQty} ${r.name}`;
        return {
          cardId: r.tcgdex_id,
          name: r.name,
          number: r.local_id,
          setId: r.set_tcgdex_id,
          missingQty,
          unitPrice: toMajor(r.market_minor, 'USD'),
          lineTotal: r.market_minor != null ? toMajor(lineMinor, 'USD') : null,
          buyUrl,
          massEntry,
          image: cardImages(r.series_tcgdex_id, r.set_tcgdex_id, r.local_id).low,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    userCache(res);
    res.json({
      currency: 'USD',
      totalUsd: rows.length ? toMajor(totalMinor, 'USD') : 0,
      ownedValueUsd: toMajor(ownedMinor, 'USD'),
      missingValueUsd: toMajor(missingMinor, 'USD'),
      cards,
      missing,
      massEntryText: missing.map((m) => m.massEntry).join('\n'),
    });
  }),
);
