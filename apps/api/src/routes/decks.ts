import { Router } from 'express';
import type pg from 'pg';
import { cardImages, pool, q, q1, toMajor, tcgplayerUrl, withTx } from '../db.js';
import { asyncHandler, badRequest, clampInt, notFound, oneOf, str, userCache } from '../http.js';
import { currentUserId } from '../identity.js';
import { recordDeckChange, recordStrategyChange, type SnapshotEntry } from '../deck/versions.js';
import { closeBatch, openBatch, OPS, recordEvents } from '../mutations.js';
import { buildCart, productIdLine, tokenLine, type CartInput } from '../tcgplayer/massentry.js';
import { parseBattleLog } from '../deck/battlelog.js';
import {
  validateDeck, resolveDeck, buildReprintOracle,
  parsePtcgl, parseMassEntry, serializeMassEntry,
  buildPtcglExport, findLiveReprint,
  expandLibrary, drawOpeningHand, mulberry32, hypergeometricMulligan,
  formatConfig, glcTypes, normalizeName,
  type FormatCode, type PokemonType, type CardFacts, type Deck, type DeckEntry,
  type ValidationResult, type ParsedDeck, type ParsedLine, type Section, type ExportRow,
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

// ── Attribution + version notes (migration 019) ───────────────────────────────
// Every deck write carries WHO wrote it (source) — same shape/validation as
// collection.ts parseSource, mirroring the DB CHECKs so a bad value is a 400,
// never a 500 from Postgres. Card ops also accept an optional versionNote that
// lands on the deck_version row (see deck/versions.ts).

const SOURCE_SHAPE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Writer attribution for a deck write; omitted → 'web' (the column default). */
function parseSource(v: unknown): string {
  if (v === undefined || v === null) return 'web';
  if (typeof v !== 'string' || !SOURCE_SHAPE.test(v)) {
    throw badRequest("source must match ^[a-z0-9][a-z0-9._-]{0,39}$ (e.g. 'web', 'deckpal-mcp')");
  }
  return v;
}

/** Optional free-text note: trimmed, length-capped, empty → null (never stored as ''). */
function parseNoteText(v: unknown, max: number, field: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw badRequest(`${field} too long (max ${max} chars)`);
  return trimmed;
}

const STRATEGY_MAX = 40000;
const VERSION_NOTE_MAX = 500;
const LOG_NOTES_MAX = 2000;
const RAW_LOG_MAX = 50000;

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
  set_group_id: number | null; // card_set.tcgplayer_group_id → Mass Entry set code
  set_card_count: number | null; // card_set.card_count_official → Mass Entry numbered-name sets
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
  version: number;
  strategy_md: string | null;
  created_at: string;
  updated_at: string;
}

const DECK_CARD_SELECT = `
  SELECT dc.card_id, dc.quantity,
         c.tcgdex_id, c.local_id, c.local_id_numeric, c.number_sort, c.name, c.name_normalized,
         c.category, c.stage, c.suffix, c.trainer_type, c.energy_type, c.hp, c.retreat,
         c.regulation_mark, c.evolve_from, c.released_on, c.rarity, c.illustrator,
         s.tcgdex_id AS set_tcgdex_id, s.name AS set_name, s.tcgplayer_group_id AS set_group_id, s.card_count_official AS set_card_count,
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

// soft-delete-exempt: a fragment, not a statement — every call site appends its
// own WHERE with the deleted_at predicate (loadMeta, and the index route which
// flips it for the recycle bin).
const DECK_META_SELECT =
  `SELECT id, name, description, format_code, glc_type, is_favorite, cover_card_id, cover_render, version, strategy_md, created_at, updated_at
     FROM deck`;

// Soft delete (migration 038): a deleted deck is invisible everywhere except
// the recycle bin, which asks for it by name.
async function loadMeta(deckId: string, userId: string): Promise<DeckMeta | null> {
  return q1<DeckMeta>(`${DECK_META_SELECT} WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [deckId, userId]);
}

async function loadRows(deckId: string, userId: string): Promise<{ rows: DeckRow[]; types: Map<number, PokemonType[]> }> {
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
    version: meta.version,
    totalCount: c.total,
    valueUsd: rows.length ? toMajor(value, 'USD') : 0,
    legal,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
  };
}

/** Full detail payload (deck + grouped cards + counts + validation under stored format). */
async function detailPayload(meta: DeckMeta, userId: string) {
  const { rows, types } = await loadRows(meta.id, userId);
  const { deck, facts } = buildDeckModel(meta, rows, types);
  const validation = await validate(deck, facts);
  return {
    deck: { ...shapeMeta(meta, rows, validation.legal), strategyMd: meta.strategy_md },
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
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    // ?deleted=true is the recycle bin: soft-deleted decks, restorable until purged.
    const deleted = String(req.query.deleted ?? '') === 'true';
    const metas = await q<DeckMeta>(
      `${DECK_META_SELECT} WHERE user_id = $1 AND deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'}
        ORDER BY is_favorite DESC, updated_at DESC`,
      [userId],
    );
    // Battle record per deck, aggregated over ALL versions, in one query.
    const records = await q<{ deck_id: string; wins: string; losses: string; ties: string }>(
      `SELECT bl.deck_id,
              count(*) FILTER (WHERE bl.result = 'win')  AS wins,
              count(*) FILTER (WHERE bl.result = 'loss') AS losses,
              count(*) FILTER (WHERE bl.result = 'tie')  AS ties
         FROM battle_log bl JOIN deck d ON d.id = bl.deck_id
        WHERE d.user_id = $1 AND d.deleted_at IS NULL GROUP BY bl.deck_id`,
      [userId],
    );
    const recordByDeck = new Map(records.map((r) => [r.deck_id, { wins: Number(r.wins), losses: Number(r.losses), ties: Number(r.ties) }]));
    const decks = [];
    for (const meta of metas) {
      const { rows, types } = await loadRows(meta.id, userId);
      const { deck, facts } = buildDeckModel(meta, rows, types);
      const v = await validate(deck, facts);
      decks.push({
        ...shapeMeta(meta, rows, v.legal),
        record: recordByDeck.get(meta.id) ?? { wins: 0, losses: 0, ties: 0 },
      });
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
    const source = parseSource(body.source);
    const userId = currentUserId(req);
    const deckId = await withTx(async (client) => {
      const row = await client.query<{ id: string }>(
        `INSERT INTO deck (user_id, format_code, glc_type, name, description)
              VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [userId, format, glcType, name, description],
      );
      const id = row.rows[0]!.id;
      await recordDeckChange(client, id, { source }); // seed the v1 snapshot (empty list)
      return id;
    });
    const meta = (await loadMeta(deckId, userId))!;
    userCache(res);
    res.status(201).json(await detailPayload(meta, userId));
  }),
);

// ── GET /decks/:id — detail ───────────────────────────────────────────────────
decksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
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
    const userId = currentUserId(req);
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
      const source = parseSource(body.source);
      const versionNote = parseNoteText(body.versionNote, VERSION_NOTE_MAX, 'versionNote');
      const formatChanged = nextFormat !== meta0.format_code;
      await withTx(async (client) => {
        await assertDeck(client, deckId, userId);
        await client.query(`UPDATE deck SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2`, params);
        // A format change alters what the list MEANS — same auto-bump rule as a
        // card edit. Rename/favorite/cover changes never touch versions.
        if (formatChanged) await recordDeckChange(client, deckId, { source, note: versionNote });
      });
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
    const userId = currentUserId(req);
    // Soft by default (migration 038). The old behaviour — a hard DELETE that
    // cascaded the deck's entire version history and every battle log with it,
    // stated in the tool description as "no undo" — is now `?purge=true`, and
    // has to be asked for by name.
    const purge = String(req.query.purge ?? '') === 'true';
    const source = parseSource((req.body ?? {}).source);

    const out = await withTx(async (client) => {
      const cur = await client.query<{ id: string; name: string; format_code: string; deleted_at: string | null }>(
        `SELECT id, name, format_code, deleted_at FROM deck WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [deckId, userId],
      );
      const deck = cur.rows[0];
      if (!deck) throw notFound(`No deck '${deckId}'`);

      const batchId = await openBatch(client, { userId, source, tool: purge ? 'deck.purge' : 'deck.delete' });
      if (purge) {
        const counts = await client.query<{ versions: string; logs: string; cards: string }>(
          `SELECT (SELECT count(*) FROM deck_version WHERE deck_id = $1) AS versions,
                  (SELECT count(*) FROM battle_log  WHERE deck_id = $1) AS logs,
                  (SELECT count(*) FROM deck_card   WHERE deck_id = $1) AS cards`,
          [deckId],
        );
        // soft-delete-exempt: this IS the purge — the one deliberate hard delete.
        await client.query(`DELETE FROM deck WHERE id = $1 AND user_id = $2`, [deckId, userId]);
        await recordEvents(client, batchId, userId, [
          {
            entityType: 'deck',
            entityId: deckId,
            operation: OPS.deckPurge,
            before: { name: deck.name, formatCode: deck.format_code, ...counts.rows[0] },
            after: null,
          },
        ]);
        await closeBatch(client, batchId, { purged: deckId });
        return { purged: deckId, deleted: deckId, restorable: false };
      }

      if (deck.deleted_at) return { deleted: deckId, restorable: true, alreadyDeleted: true };
      await client.query(`UPDATE deck SET deleted_at = now() WHERE id = $1 AND user_id = $2`, [deckId, userId]);
      await recordEvents(client, batchId, userId, [
        {
          entityType: 'deck',
          entityId: deckId,
          operation: OPS.deckDelete,
          before: { name: deck.name, formatCode: deck.format_code },
          after: null,
        },
      ]);
      await closeBatch(client, batchId, { deleted: deckId });
      return { deleted: deckId, restorable: true, batchId };
    });

    userCache(res);
    res.json(out);
  }),
);

// ── POST /decks/:id/restore — undelete ────────────────────────────────────────
decksRouter.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const source = parseSource((req.body ?? {}).source);

    await withTx(async (client) => {
      const cur = await client.query<{ id: string; name: string; format_code: string; deleted_at: string | null }>(
        `SELECT id, name, format_code, deleted_at FROM deck WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [deckId, userId],
      );
      const deck = cur.rows[0];
      if (!deck) throw notFound(`No deck '${deckId}'`);
      if (!deck.deleted_at) return;
      const batchId = await openBatch(client, { userId, source, tool: 'deck.restore' });
      await client.query(`UPDATE deck SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND user_id = $2`, [deckId, userId]);
      await recordEvents(client, batchId, userId, [
        { entityType: 'deck', entityId: deckId, operation: OPS.deckRestore, before: null, after: { name: deck.name } },
      ]);
      await closeBatch(client, batchId, { restored: deckId });
    });

    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    userCache(res);
    res.json({ restored: deckId, deck: await detailPayload(meta, userId) });
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

/**
 * The lock every deck write takes first. `deleted_at IS NULL` belongs HERE and
 * not only on the read paths: a soft-deleted deck must be un-writable, or an
 * agent holding a stale id could keep editing something the user believes is
 * gone. Restore it first (POST /decks/:id/restore), then edit it.
 */
async function assertDeck(client: pg.PoolClient, deckId: string, userId: string): Promise<void> {
  const r = await client.query(`SELECT 1 FROM deck WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE`, [
    deckId,
    userId,
  ]);
  if (!r.rows[0]) throw notFound(`No deck '${deckId}'`);
}

// POST /decks/:id/cards {cardId, quantity=1} — additive upsert (clamped to 60).
decksRouter.post(
  '/:id/cards',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const body = req.body ?? {};
    const ref = str(body.cardId) ?? str(body.card);
    if (!ref) throw badRequest('cardId is required');
    let qty = Number(body.quantity ?? 1);
    if (!Number.isInteger(qty) || qty < 1) qty = 1;
    const source = parseSource(body.source);
    const versionNote = parseNoteText(body.versionNote, VERSION_NOTE_MAX, 'versionNote');

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
      await recordDeckChange(client, deckId, { source, note: versionNote });
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
    const userId = currentUserId(req);
    const ref = String(req.params.cardId);
    const body = req.body ?? {};
    const qty = Number(body.quantity);
    if (!Number.isInteger(qty) || qty < 0 || qty > 60) throw badRequest('quantity must be an integer 0..60');
    const source = parseSource(body.source);
    const versionNote = parseNoteText(body.versionNote, VERSION_NOTE_MAX, 'versionNote');

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
      await recordDeckChange(client, deckId, { source, note: versionNote });
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
    const userId = currentUserId(req);
    const ref = String(req.params.cardId);
    const body = req.body ?? {};
    const source = parseSource(body.source);
    const versionNote = parseNoteText(body.versionNote, VERSION_NOTE_MAX, 'versionNote');
    await withTx(async (client) => {
      await assertDeck(client, deckId, userId);
      const cardId = await resolveCardId(client, ref);
      await client.query(`DELETE FROM deck_card WHERE deck_id = $1 AND card_id = $2 AND user_id = $3`, [deckId, cardId, userId]);
      await client.query(`UPDATE deck SET updated_at = now() WHERE id = $1`, [deckId]);
      await recordDeckChange(client, deckId, { source, note: versionNote });
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
    const userId = currentUserId(req);
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
    // `source` was already claimed by the decklist syntax above, so writer
    // attribution rides as `writeSource` on this one endpoint (everywhere else
    // it is plain `source`).
    const writeSource = parseSource(body.writeSource);
    const format = parseFormat(body.formatCode ?? body.format);
    let glcType = parseGlcType(body.glcType);
    if (format === 'glc' && !glcType) glcType = glcTypes()[0] ?? null;
    const name = parseName(body.name, false) || 'Imported Deck';
    const userId = currentUserId(req);

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
      await recordDeckChange(client, id, { source: writeSource }); // seed v1 with the imported list
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
    const userId = currentUserId(req);
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const kind = oneOf(req.query.format, ['ptcgl', 'massentry'] as const, 'ptcgl');
    const { rows } = await loadRows(deckId, userId);

    if (kind === 'massentry') {
      // Buy format (§1.9): use the stored per-variant Mass Entry line when present,
      // else a bare name line. Never share the PTCGL formatter.
      const text = serializeMassEntry(
        rows.map((r) => ({
          quantity: r.quantity,
          name: r.name,
          setCode: r.tcgplayer_mass_entry ? (r.tcgplayer_mass_entry.match(/\[([^\]]+)\]/)?.[1] ?? null) : null,
          number: null,
          raw: '',
        })),
      );
      userCache(res);
      res.json({ format: kind, text, warnings: [] });
      return;
    }

    // PTCGL: emit real PTCGL vocabulary (set codes, brace Energy, stripped zeros)
    // with structured warnings for anything Live cannot resolve — see deck/export.ts.
    const exportRows: ExportRow[] = rows.map((r) => ({
      cardId: Number(r.card_id),
      tcgdexId: r.tcgdex_id,
      quantity: r.quantity,
      name: r.name,
      localId: r.local_id,
      category: r.category,
      energyType: r.energy_type,
      setTcgdexId: r.set_tcgdex_id,
      setName: r.set_name,
    }));
    const { text, warnings } = await buildPtcglExport(exportRows, (row) => findLiveReprint(pool, row));
    userCache(res);
    res.json({ format: kind, text, warnings });
  }),
);

// ── GET /decks/:id/testhand?seed= — opening-hand draw (seedable) ──────────────
decksRouter.get(
  '/:id/testhand',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
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

/**
 * One deck row's Mass Entry line for `qty` copies, or null when the card has no
 * TCGplayer identity at all.
 *
 * `<qty>-<productId>` is exact: it names the TCGplayer product directly, so it
 * cannot be defeated by a card name that repeats inside its set — which is what
 * broke every name-based line for modern sets (see ../tcgplayer/massentry.ts).
 * A curated `tcgplayer_mass_entry` token is the only fallback; there is no
 * name-guessing tier, because Mass Entry is all-or-nothing and one bad guess
 * voids the whole cart.
 */
function deckMeLine(r: DeckRow, qty: number): string | null {
  if (r.tcgplayer_product_id !== null) return productIdLine(qty, r.tcgplayer_product_id);
  if (r.tcgplayer_mass_entry) return tokenLine(qty, r.tcgplayer_mass_entry);
  return null;
}

// ── GET /decks/:id/pricing — per-card + total, and the "buy missing" list ─────
decksRouter.get(
  '/:id/pricing',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
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
        // Shared Mass Entry vocabulary (../tcgplayer/massentry.ts): the exact
        // `<qty>-<productId>` form, or a curated token, or nothing at all.
        const massEntry = deckMeLine(r, missingQty);
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
      massEntryText: missing
        .map((m) => m.massEntry)
        .filter((l): l is string => l !== null)
        .join('\n'),
    });
  }),
);

// ── GET /decks/:id/massentry — TCGplayer cart deep link(s) for the missing cards ──
// Same missing math as /pricing (deck_card quantity minus owned across all
// variants), same builder as every other cart route (../tcgplayer/massentry.ts).
// Cards with no TCGplayer product id are returned as `unlinkable`, never
// silently dropped and never emitted as a name guess.
decksRouter.get(
  '/:id/massentry',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const { rows } = await loadRows(deckId, userId);

    const inputs: CartInput[] = [];
    for (const r of rows) {
      const missingQty = Math.max(0, r.quantity - Number(r.owned_qty));
      if (missingQty === 0) continue;
      inputs.push({
        quantity: missingQty,
        productId: r.tcgplayer_product_id,
        token: r.tcgplayer_mass_entry,
        name: r.name,
        number: r.local_id,
        setId: r.set_tcgdex_id,
        // Deck rows are variant-agnostic, so there is no variant label to give.
        variant: null,
      });
    }
    const build = buildCart(inputs);

    userCache(res);
    res.json({
      deck: { id: meta.id, name: meta.name },
      needed: {
        cards: build.needed.lines,
        items: build.needed.items,
        unlinkable: build.needed.unlinkable,
        exactLines: build.needed.exactLines,
        bestEffortLines: build.needed.bestEffortLines,
      },
      lines: [...build.exact.lines, ...build.bestEffort.lines],
      text: build.text,
      urls: build.urls, // ordered; open each in the logged-in browser — all add to one cart
      exactUrls: build.exact.urls,
      bestEffortUrls: build.bestEffort.urls,
      unlinkable: build.unlinkable,
      warnings: build.warnings,
      note: build.note,
    });
  }),
);

// ══ Deck intelligence (migration 019): strategy, versions, battle logs ════════
// Versioning semantics live in deck/versions.ts (the LOCKED auto-bump rule);
// the PTCG Live log parser in deck/battlelog.ts. Everything below is shaping +
// validation in the house style: withTx + assertDeck lock for writes,
// parameterized reads, userCache on every response.

interface VersionRow {
  version: number;
  format_code: string;
  cards: SnapshotEntry[];
  strategy_md: string | null;
  note: string | null;
  source: string;
  created_at: string;
}

interface WinLoss {
  total: number;
  wins: number;
  losses: number;
  ties: number;
}

const EMPTY_RECORD: WinLoss = { total: 0, wins: 0, losses: 0, ties: 0 };

/** Per-version W/L aggregate for one deck, as a Map keyed by version. */
async function battleRecordByVersion(deckId: string): Promise<Map<number, WinLoss>> {
  const rows = await q<{ deck_version: number; total: string; wins: string; losses: string; ties: string }>(
    `SELECT deck_version, count(*) AS total,
            count(*) FILTER (WHERE result = 'win')  AS wins,
            count(*) FILTER (WHERE result = 'loss') AS losses,
            count(*) FILTER (WHERE result = 'tie')  AS ties
       FROM battle_log WHERE deck_id = $1 GROUP BY deck_version`,
    [deckId],
  );
  return new Map(rows.map((r) => [r.deck_version, {
    total: Number(r.total), wins: Number(r.wins), losses: Number(r.losses), ties: Number(r.ties),
  }]));
}

const snapshotCount = (cards: SnapshotEntry[]): number => cards.reduce((n, c) => n + c.quantity, 0);

/** Card-list delta between two snapshots, keyed by catalogue card id. */
function diffSnapshots(prev: SnapshotEntry[], cur: SnapshotEntry[]) {
  const prevBy = new Map(prev.map((c) => [c.cardId, c]));
  const curBy = new Map(cur.map((c) => [c.cardId, c]));
  const added = cur.filter((c) => !prevBy.has(c.cardId))
    .map((c) => ({ name: c.name, tcgdexId: c.tcgdexId, quantity: c.quantity }));
  const removed = prev.filter((c) => !curBy.has(c.cardId))
    .map((c) => ({ name: c.name, tcgdexId: c.tcgdexId, quantity: c.quantity }));
  const changed = cur.filter((c) => prevBy.has(c.cardId) && prevBy.get(c.cardId)!.quantity !== c.quantity)
    .map((c) => ({ name: c.name, tcgdexId: c.tcgdexId, from: prevBy.get(c.cardId)!.quantity, to: c.quantity }));
  return { added, removed, changed };
}

function parseVersionNumber(v: unknown, field = 'version'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw badRequest(`${field} must be a positive integer`);
  return n;
}

// ── PUT /decks/:id/strategy { strategyMd, source? } ───────────────────────────
// Strategy edits NEVER bump the version (LOCKED): deck.strategy_md and the
// current snapshot are updated in place. null / '' clears the guide.
decksRouter.put(
  '/:id/strategy',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const body = req.body ?? {};
    if (!('strategyMd' in body)) throw badRequest('strategyMd is required (null or empty string clears the guide)');
    let strategyMd: string | null = null;
    if (body.strategyMd !== null) {
      if (typeof body.strategyMd !== 'string') throw badRequest('strategyMd must be a string or null');
      if (body.strategyMd.length > STRATEGY_MAX) throw badRequest(`strategyMd too long (max ${STRATEGY_MAX} chars)`);
      strategyMd = body.strategyMd.trim() ? body.strategyMd : null;
    }
    const source = parseSource(body.source); // validated shape; strategy edits leave the snapshot's writer as-is

    await withTx(async (client) => {
      await assertDeck(client, deckId, userId);
      // A strategy guide is full-replace, and until now the previous text was
      // simply gone — the tool only told you the old guide's first heading and
      // length, which made an accidental overwrite visible but not recoverable.
      // Snapshotting it here is what makes `revert` able to put it back.
      // soft-delete-exempt: behind assertDeck's lock, which filters deleted_at.
      const prev = await client.query<{ strategy_md: string | null }>(`SELECT strategy_md FROM deck WHERE id = $1`, [deckId]);
      const batchId = await openBatch(client, { userId, source, tool: 'deck.strategy.set' });
      await recordStrategyChange(client, deckId, strategyMd);
      await recordEvents(client, batchId, userId, [
        {
          entityType: 'deck_strategy',
          entityId: deckId,
          operation: OPS.deckStrategySet,
          before: { strategyMd: prev.rows[0]?.strategy_md ?? null },
          after: { strategyMd },
        },
      ]);
      await closeBatch(client, batchId, { deckId, length: strategyMd?.length ?? 0 });
    });
    const meta = (await loadMeta(deckId, userId))!;
    userCache(res);
    res.json(await detailPayload(meta, userId));
  }),
);

// ── GET /decks/:id/versions — the version timeline (newest first) ─────────────
decksRouter.get(
  '/:id/versions',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);

    const rows = await q<VersionRow>(
      `SELECT version, format_code, cards, strategy_md, note, source, created_at
         FROM deck_version WHERE deck_id = $1 ORDER BY version DESC`,
      [deckId],
    );
    const records = await battleRecordByVersion(deckId);
    userCache(res);
    res.json({
      current: meta.version,
      versions: rows.map((r) => ({
        version: r.version,
        note: r.note,
        source: r.source,
        createdAt: r.created_at,
        cardCount: snapshotCount(r.cards),
        formatCode: r.format_code,
        battleLogs: records.get(r.version) ?? EMPTY_RECORD,
        isCurrent: r.version === meta.version,
      })),
    });
  }),
);

// ── GET /decks/:id/versions/:v — one snapshot + diff vs the previous ──────────
decksRouter.get(
  '/:id/versions/:v',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const v = parseVersionNumber(req.params.v);

    const rows = await q<VersionRow>(
      `SELECT version, format_code, cards, strategy_md, note, source, created_at
         FROM deck_version WHERE deck_id = $1 AND version IN ($2, $2 - 1)`,
      [deckId, v],
    );
    const cur = rows.find((r) => r.version === v);
    if (!cur) throw notFound(`No version ${v} for deck '${deckId}'`);
    const prev = rows.find((r) => r.version === v - 1) ?? null;
    const records = await battleRecordByVersion(deckId);

    userCache(res);
    res.json({
      version: cur.version,
      isCurrent: cur.version === meta.version,
      formatCode: cur.format_code,
      note: cur.note,
      source: cur.source,
      createdAt: cur.created_at,
      strategyMd: cur.strategy_md,
      cardCount: snapshotCount(cur.cards),
      cards: cur.cards,
      battleLogs: records.get(cur.version) ?? EMPTY_RECORD,
      diff: prev ? diffSnapshots(prev.cards, cur.cards) : null,
    });
  }),
);

// ── POST /decks/:id/revert { toVersion, includeStrategy?=true, note?, source? }
// Non-destructive: applies the old snapshot through the SAME write path (so the
// auto-bump rule decides whether it lands as a new version or amends the current
// logless one). History is never deleted. Cards hard-deleted from the catalog
// since the snapshot (near-impossible under ON DELETE RESTRICT) are reported
// and skipped, never silently dropped.
decksRouter.post(
  '/:id/revert',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const body = req.body ?? {};
    const toVersion = parseVersionNumber(body.toVersion, 'toVersion');
    const includeStrategy = body.includeStrategy === undefined ? true : Boolean(body.includeStrategy);
    const source = parseSource(body.source);
    const note = parseNoteText(body.note, VERSION_NOTE_MAX, 'note') ?? `Reverted to v${toVersion}`;

    const revert = await withTx(async (client) => {
      await assertDeck(client, deckId, userId);
      // soft-delete-exempt: behind assertDeck's lock, which filters deleted_at.
      const deck = await client.query<{ version: number }>(`SELECT version FROM deck WHERE id = $1`, [deckId]);
      if (toVersion === deck.rows[0]!.version) throw badRequest(`deck is already at version ${toVersion}`);
      const snap = await client.query<VersionRow>(
        `SELECT version, format_code, cards, strategy_md, note, source, created_at
           FROM deck_version WHERE deck_id = $1 AND version = $2`,
        [deckId, toVersion],
      );
      const target = snap.rows[0];
      if (!target) throw notFound(`No version ${toVersion} for deck '${deckId}'`);

      // Resolve snapshot entries against the live catalog by card id.
      const wantIds = target.cards.map((c) => c.cardId);
      const live = wantIds.length
        ? await client.query<{ id: string }>(`SELECT id FROM card WHERE id = ANY($1)`, [wantIds])
        : { rows: [] as { id: string }[] };
      const liveIds = new Set(live.rows.map((r) => Number(r.id)));
      const apply = target.cards.filter((c) => liveIds.has(c.cardId));
      const skipped = target.cards.filter((c) => !liveIds.has(c.cardId))
        .map((c) => ({ cardId: c.cardId, tcgdexId: c.tcgdexId, name: c.name }));

      // Reconcile deck_card to the snapshot in one pass.
      await client.query(
        `DELETE FROM deck_card WHERE deck_id = $1 AND card_id <> ALL($2::bigint[])`,
        [deckId, apply.map((c) => c.cardId)],
      );
      for (const c of apply) {
        await client.query(
          `INSERT INTO deck_card (deck_id, card_id, user_id, quantity) VALUES ($1, $2, $3, $4)
           ON CONFLICT (deck_id, card_id) DO UPDATE SET quantity = $4`,
          [deckId, c.cardId, userId, Math.min(60, Math.max(1, c.quantity))],
        );
      }
      if (includeStrategy) {
        await client.query(`UPDATE deck SET strategy_md = $2 WHERE id = $1`, [deckId, target.strategy_md]);
      }
      await client.query(`UPDATE deck SET updated_at = now() WHERE id = $1`, [deckId]);
      const change = await recordDeckChange(client, deckId, { source, note });
      return { toVersion, version: change.version, bumped: change.bumped, skippedCards: skipped };
    });

    const meta = (await loadMeta(deckId, userId))!;
    userCache(res);
    res.json({ ...(await detailPayload(meta, userId)), revert });
  }),
);

// ── Battle logs ───────────────────────────────────────────────────────────────

interface LogRow {
  id: string;
  deck_version: number;
  raw_log: string;
  result: 'win' | 'loss' | 'tie' | null;
  opponent: string | null;
  opponent_deck: string | null;
  notes: string | null;
  parsed: Record<string, unknown> | null;
  source: string;
  played_at: string;
  created_at: string;
}

/** List-row shape: everything but the (potentially huge) raw log + parser blob. */
function shapeLogSummary(r: LogRow) {
  const parsed = r.parsed as { totalTurns?: number; prizesTaken?: { me: number; opponent: number } } | null;
  return {
    id: Number(r.id),
    deckVersion: r.deck_version,
    result: r.result,
    opponent: r.opponent,
    opponentDeck: r.opponent_deck,
    turns: parsed?.totalTurns ?? null,
    prizes: parsed?.prizesTaken ?? null,
    notes: r.notes,
    playedAt: r.played_at,
    source: r.source,
  };
}

function shapeLogFull(r: LogRow) {
  return { ...shapeLogSummary(r), rawLog: r.raw_log, parsed: r.parsed, createdAt: r.created_at };
}

/** Strict result field: undefined → absent, null → clear, else win|loss|tie. */
function parseResultField(v: unknown): 'win' | 'loss' | 'tie' | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (v === 'win' || v === 'loss' || v === 'tie') return v;
  throw badRequest("result must be 'win', 'loss' or 'tie'");
}

/** Optional played-at timestamp; invalid → 400, omitted → null (DB default now()). */
function parsePlayedAt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest('playedAt must be an ISO-8601 timestamp');
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest('playedAt must be an ISO-8601 timestamp');
  return d.toISOString();
}

function parseLogId(v: string): number {
  if (!/^\d+$/.test(v)) throw notFound(`No battle log '${v}'`);
  return Number(v);
}

// GET /decks/:id/logs?version=&page=&pageSize= — summaries (no raw_log), newest
// first, with the W/L record over the same filter scope.
decksRouter.get(
  '/:id/logs',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const versionFilter = req.query.version !== undefined ? parseVersionNumber(req.query.version) : null;
    const page = clampInt(req.query.page, 1, 1, 1_000_000);
    const pageSize = clampInt(req.query.pageSize, 50, 1, 200);

    const totals = await q1<{ total: string; wins: string; losses: string; ties: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE result = 'win')  AS wins,
              count(*) FILTER (WHERE result = 'loss') AS losses,
              count(*) FILTER (WHERE result = 'tie')  AS ties
         FROM battle_log WHERE deck_id = $1 AND ($2::int IS NULL OR deck_version = $2)`,
      [deckId, versionFilter],
    );
    const rows = await q<LogRow>(
      `SELECT id, deck_version, raw_log, result, opponent, opponent_deck, notes, parsed, source, played_at, created_at
         FROM battle_log
        WHERE deck_id = $1 AND ($2::int IS NULL OR deck_version = $2)
        ORDER BY played_at DESC, id DESC
        LIMIT $3 OFFSET $4`,
      [deckId, versionFilter, pageSize, (page - 1) * pageSize],
    );

    const total = Number(totals?.total ?? 0);
    userCache(res);
    res.json({
      version: versionFilter,
      logs: rows.map(shapeLogSummary),
      totals: {
        total,
        wins: Number(totals?.wins ?? 0),
        losses: Number(totals?.losses ?? 0),
        ties: Number(totals?.ties ?? 0),
      },
      pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    });
  }),
);

// POST /decks/:id/logs — paste a raw PTCG Live log. The parser runs here; its
// result/opponent/deck-guess fill any fields the caller omitted. Attaches to the
// deck's CURRENT version (that is the list the game was played with).
decksRouter.post(
  '/:id/logs',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const body = req.body ?? {};
    if (typeof body.rawLog !== 'string' || !body.rawLog.trim()) throw badRequest('rawLog is required');
    if (body.rawLog.length > RAW_LOG_MAX) throw badRequest(`rawLog too large (max ${RAW_LOG_MAX} chars)`);
    const rawLog = body.rawLog;
    const explicitResult = parseResultField(body.result) ?? undefined; // null clear is meaningless on create
    const opponent = parseOptText(body.opponent, 200, 'opponent');
    const opponentDeck = parseOptText(body.opponentDeck, 200, 'opponentDeck');
    const notes = parseNoteText(body.notes, LOG_NOTES_MAX, 'notes');
    const playedAt = parsePlayedAt(body.playedAt);
    const playerName = parseOptText(body.playerName, 100, 'playerName') ?? undefined;
    const source = parseSource(body.source);

    const out = await withTx(async (client) => {
      await assertDeck(client, deckId, userId);
      // soft-delete-exempt: behind assertDeck's lock, which filters deleted_at.
      const deck = await client.query<{ version: number }>(`SELECT version FROM deck WHERE id = $1`, [deckId]);
      const version = deck.rows[0]!.version;
      const names = await client.query<{ name: string }>(
        `SELECT c.name FROM deck_card dc JOIN card c ON c.id = dc.card_id WHERE dc.deck_id = $1`,
        [deckId],
      );
      const parsed = parseBattleLog(rawLog, names.rows.map((r) => r.name), playerName);

      const result = explicitResult ?? parsed.result;
      if (parsed.players.me === null && explicitResult === undefined) {
        throw badRequest(
          playerName
            ? `playerName '${playerName}' does not match a player in the log — check the exact screen name, or pass an explicit result`
            : 'could not determine which player is the deck owner — pass playerName (your exact screen name in the log) or an explicit result',
        );
      }

      const row = await client.query<LogRow>(
        // user_id: migration 020 added battle_log.user_id NOT NULL for direct
        // RLS scoping (no join through deck) and backfilled it from the owning
        // deck; this insert was never updated to supply it. assertDeck above
        // has already proved this userId owns this deck.
        `INSERT INTO battle_log (deck_id, deck_version, raw_log, result, opponent, opponent_deck, notes, parsed, source, played_at, user_id)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, COALESCE($10::timestamptz, now()), $11)
         RETURNING id, deck_version, raw_log, result, opponent, opponent_deck, notes, parsed, source, played_at, created_at`,
        [
          deckId, version, rawLog, result,
          opponent ?? parsed.players.opponent,
          opponentDeck ?? parsed.opponentDeckGuess,
          notes, JSON.stringify(parsed), source, playedAt, userId,
        ],
      );
      return { log: row.rows[0]!, attachedToVersion: version };
    });

    userCache(res);
    res.status(201).json({ log: shapeLogFull(out.log), attachedToVersion: out.attachedToVersion });
  }),
);

// GET /decks/:id/logs/:logId — the full row, raw log and parser output included.
decksRouter.get(
  '/:id/logs/:logId',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const logId = parseLogId(String(req.params.logId));
    const row = await q1<LogRow>(
      `SELECT id, deck_version, raw_log, result, opponent, opponent_deck, notes, parsed, source, played_at, created_at
         FROM battle_log WHERE id = $1 AND deck_id = $2`,
      [logId, deckId],
    );
    if (!row) throw notFound(`No battle log '${logId}'`);
    userCache(res);
    res.json({ log: shapeLogFull(row) });
  }),
);

// PATCH /decks/:id/logs/:logId { result?, opponent?, opponentDeck?, notes?, playedAt? }
// Metadata only — the raw log and its version attachment are immutable. Explicit
// null clears result/opponent/opponentDeck/notes.
decksRouter.patch(
  '/:id/logs/:logId',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const logId = parseLogId(String(req.params.logId));
    const body = req.body ?? {};

    const sets: string[] = [];
    const params: unknown[] = [logId, deckId];
    const push = (frag: string, val: unknown) => {
      params.push(val);
      sets.push(`${frag} = $${params.length}`);
    };
    if (body.result !== undefined) push('result', parseResultField(body.result));
    if (body.opponent !== undefined) push('opponent', parseOptText(body.opponent, 200, 'opponent'));
    if (body.opponentDeck !== undefined) push('opponent_deck', parseOptText(body.opponentDeck, 200, 'opponentDeck'));
    if (body.notes !== undefined) push('notes', parseNoteText(body.notes, LOG_NOTES_MAX, 'notes'));
    if (body.playedAt !== undefined) {
      const at = parsePlayedAt(body.playedAt);
      if (at === null) throw badRequest('playedAt cannot be cleared');
      push('played_at', at);
    }
    if (!sets.length) throw badRequest('nothing to update');

    const row = await q1<LogRow>(
      `UPDATE battle_log SET ${sets.join(', ')} WHERE id = $1 AND deck_id = $2
       RETURNING id, deck_version, raw_log, result, opponent, opponent_deck, notes, parsed, source, played_at, created_at`,
      params,
    );
    if (!row) throw notFound(`No battle log '${logId}'`);
    userCache(res);
    res.json({ log: shapeLogFull(row) });
  }),
);

// DELETE /decks/:id/logs/:logId
decksRouter.delete(
  '/:id/logs/:logId',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const logId = parseLogId(String(req.params.logId));
    const del = await q1<{ id: string }>(
      `DELETE FROM battle_log WHERE id = $1 AND deck_id = $2 RETURNING id`,
      [logId, deckId],
    );
    if (!del) throw notFound(`No battle log '${logId}'`);
    userCache(res);
    res.json({ deleted: logId });
  }),
);
