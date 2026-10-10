import { Router } from 'express';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { cardImages, dbHandle, q, q1, toMajor, tcgplayerUrl, withTx } from '../db.js';
import { ApiError, asyncHandler, badRequest, clampInt, notFound, oneOf, parseName, parseOptText, str, userCache, UUID_RE } from '../http.js';
import { currentUserId } from '../identity.js';
import { registerDeckImportFix } from './deckImportFix.js';
import { recordDeckChange, recordStrategyChange, restoreSnapshot, type SnapshotEntry } from '../deck/versions.js';
import { basicEnergyType, loadOwnedPrints, type OwnedSource } from '../deck/ownedPrints.js';
import {
  closeBatch, findCommittedBatch, loadBatchResponse, openBatch, OPS, type StoredBatch,
  parseSource, recordEvents, ReplayError,
} from '../mutations.js';
import { buildCart, productIdLine, tokenLine, type CartInput } from '../tcgplayer/massentry.js';
import {
  digestBattleLog, normalizeOpponentArchetype, parseBattleLog, prepareBattleLog, scoreDeckMatch,
  type BattleLogOrigin,
} from '../deck/battlelog.js';
import {
  validateDeck, resolveDeck, buildReprintOracle,
  parsePtcgl, parseMassEntry, serializeMassEntry,
  buildPtcglExport, findLiveReprint, ptcglCodeForSet,
  expandLibrary, drawOpeningHand, mulberry32, hypergeometricMulligan,
  formatConfig, glcTypes, inferGlcType, normalizeName,
  type FormatCode, type PokemonType, type CardFacts, type Deck, type DeckEntry,
  type ValidationResult, type ParsedDeck, type ParsedLine, type Section, type ExportRow,
} from '../deck/index.js';

export const decksRouter: Router = Router();
registerDeckImportFix(decksRouter);

/**
 * Deck builder (Phase 5, part 2). Persistence + validation + interchange, on top
 * of the already-verified deck engine in ../deck. This route NEVER re-implements a
 * rule — it adapts stored rows into the engine's `CardFacts`/`Deck` shapes, calls
 * validateDeck()/resolveDeck()/drawOpeningHand()/serializePtcgl(), and shapes the
 * result for the UI.
 *
 * The engine's db.ts adapter is read-only and takes a Queryable; it is handed
 * `dbHandle()`, never `pool` — inside SUPABASE_MODE the request already holds a
 * pooled client and `pool.query()` would check out a second one against the same
 * `max` (B2, and see db.ts). Building CardFacts here (loadDeckRows) duplicates
 * data-adaptation, not rule logic — the engine exports no "facts by card id"
 * helper and its internals are off-limits.
 *
 * Live schema (read from the DB, not SCHEMA.md's richer proposal):
 *   deck(id uuid, user_id, format_code, glc_type, name, description, cover_card_id,
 *        cover_render, is_favorite, created_at, updated_at)
 *   deck_card(deck_id, card_id, card_variant_id, user_id, quantity smallint 1..60)
 *             PK(deck_id, card_variant_id)   — migration 051
 * deck_card is VARIANT-scoped: one row per printing, so "2 normals and 1 reverse
 * holofoil" is two rows. card_id stays denormalised (kept honest by a composite
 * FK) so the legality engine and every card-level join stay card-keyed — the
 * ENGINE model aggregates rows by card before validating, since the rules of
 * the game do not care which printing you sleeve. `owned` and `price` are the
 * ROW's variant's own numbers now, not a rollup/representative. Unresolved
 * import lines cannot be stored (FKs) — reported to the caller, never dropped.
 *
 * Single default user, user_id threaded everywhere. Parameterized queries only —
 * users paste decklists, treat every value as untrusted.
 */

const FORMATS = ['standard', 'expanded', 'glc', 'unlimited'] as const;
const DESC_MAX = 2000;

function parseFormat(v: unknown, fallback: FormatCode = 'standard'): FormatCode {
  return oneOf<FormatCode>(v, FORMATS, fallback);
}
function parseGlcType(v: unknown): PokemonType | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const hit = glcTypes().find((t) => t.toLowerCase() === s.toLowerCase());
  return hit ?? null;
}
function parseDeckId(v: string): string {
  if (!UUID_RE.test(v)) throw notFound(`No deck '${v}'`);
  return v;
}

// ── Attribution + version notes (migration 019) ───────────────────────────────
// Every deck write carries WHO wrote it (source) — the shared parseSource in
// ../mutations.ts, mirroring the DB CHECKs so a bad value is a 400, never a 500
// from Postgres. Card ops also accept an optional versionNote that lands on the
// deck_version row (see deck/versions.ts).

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
const LOG_REVIEW_MAX = 12000;
const RAW_LOG_MAX = 50000;

// ── POST /decks/log-preview fan-out bounds (security finding B) ───────────────
//
// The log-preview handler scores a pasted log against the caller's decks, 2
// queries per deck, and used to iterate EVERY non-deleted deck with no rate
// limit — an unbounded fan-out a caller could hammer. Two bounds:
//   • LOG_PREVIEW_DECK_CAP caps the scoring set to the RECENT decks (40 is far
//     above any real collection and bounds the fan-out).
//   • a per-user in-memory rate limit (20 req/min) stops a caller running the
//     parse+score loop in a tight loop. bugs.ts's rate limiter is module-local
//     (not exported), so the minimal pattern is replicated here rather than
//     shared — same shape: a Map of buckets with a resetAt, swept on a timer.
/** Exported so logPreview.test.ts can pin the bound without a database. */
export const LOG_PREVIEW_DECK_CAP = 40;
export const LOG_PREVIEW_RATE_MAX = 20; // requests per user per window
export const LOG_PREVIEW_RATE_WINDOW_MS = 60_000; // 1 minute
export const LOG_PREVIEW_RATE_SWEEP_MS = 5 * 60_000; // sweep stale buckets every 5 min

export interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * Pure rate-limit decision for ONE bucket. Returns the (possibly new/updated)
 * bucket to store and whether the request is under the cap. The route keeps a
 * `Map<userId, RateBucket>` and threads `Date.now()`; tests call this directly
 * with a fixed clock so the limiter can be pinned without a DB or a timer.
 *
 * First request in a window starts a fresh bucket at count 1; an expired
 * window resets the same way. The bucket is ALWAYS returned (count bumped),
 * so a burst just over the limit is recorded — the caller is refused, not
 * silently let through, and the next in-window request sees the real count.
 */
export function rateLimitCheck(
  bucket: RateBucket | undefined,
  now: number,
  max: number = LOG_PREVIEW_RATE_MAX,
  windowMs: number = LOG_PREVIEW_RATE_WINDOW_MS,
): { ok: boolean; bucket: RateBucket } {
  if (!bucket || bucket.resetAt <= now) {
    return { ok: 1 <= max, bucket: { count: 1, resetAt: now + windowMs } };
  }
  const count = bucket.count + 1;
  return { ok: count <= max, bucket: { count, resetAt: bucket.resetAt } };
}

// Module-local state for the route. ONE map per process, keyed by userId —
// never by IP (the route is authed; userId is the right identity). Swept on a
// timer so a quiet process does not accumulate buckets for ever.
//
// HONEST LIMITATION — this is a per-PROCESS limiter, not a global one. On
// Vercel each warm lambda instance has its own Map, so the real ceiling is
// 20/min × (number of warm instances), not 20/min total. That is acceptable
// here because the load-bearing bound on log-preview cost is LOG_PREVIEW_DECK_CAP
// (the per-request deck fan-out), not this limiter: a single request is already
// bounded, so a caller over-running the per-instance cap mostly adds latency,
// not unbounded work. This limiter is best-effort per instance — it stops a
// tight loop on ONE instance, not a flood across many. If a true global cap is
// ever needed it has to live in shared state (Redis/edge), not in a Map.
const logPreviewBuckets = new Map<string, RateBucket>();
setInterval(() => {
  const now = Date.now();
  for (const [user, b] of logPreviewBuckets) {
    if (b.resetAt <= now) logPreviewBuckets.delete(user);
  }
}, LOG_PREVIEW_RATE_SWEEP_MS).unref();

function logPreviewRateOk(userId: string): boolean {
  const res = rateLimitCheck(logPreviewBuckets.get(userId), Date.now());
  logPreviewBuckets.set(userId, res.bucket);
  return res.ok;
}

// ── The shared loader: one query → CardFacts (for the engine) + display rows (for the UI) ──

interface DeckRow {
  card_id: string;
  card_variant_id: string;
  variant_kind_code: string;
  variant_display: string | null;
  variant_kind_display: string;
  variant_tier: string | null;
  variant_is_primary: boolean;
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
  owned_as: OwnedSource[];
  pin_exact: boolean;
  identical_print_group: string | null;
  is_promo: boolean;
  is_stamped: boolean;
  format_code: FormatCode;
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
  SELECT dc.card_id, dc.card_variant_id, dc.quantity, dc.pin_exact, d.format_code,
         cvd.variant_kind_code, cvd.display_name AS variant_display, vk.display_name AS variant_kind_display,
         vtr.tier AS variant_tier, cvd.is_primary AS variant_is_primary,
         c.tcgdex_id, c.local_id, c.local_id_numeric, c.number_sort, c.name, c.name_normalized,
         c.category, c.stage, c.suffix, c.trainer_type, c.energy_type, c.hp, c.retreat,
         c.regulation_mark, c.evolve_from, c.released_on, c.rarity, c.illustrator, c.identical_print_group,
         s.tcgdex_id AS set_tcgdex_id, s.name AS set_name, s.tcgplayer_group_id AS set_group_id, s.card_count_official AS set_card_count,
         s.is_promo, EXISTS (SELECT 1 FROM variant_kind_stamp vks WHERE vks.variant_kind_code = cvd.variant_kind_code) AS is_stamped,
         ser.tcgdex_id AS series_tcgdex_id, ser.slug AS series_slug,
         price.market_minor, price.currency_code,
         cvd.tcgplayer_url, cvd.tcgplayer_product_id, cvd.tcgplayer_printing, cvd.tcgplayer_mass_entry
    FROM deck_card dc
    JOIN deck d ON d.id = dc.deck_id
    JOIN card_variant cvd ON cvd.id = dc.card_variant_id
    JOIN variant_kind vk ON vk.code = cvd.variant_kind_code
    LEFT JOIN variant_tier_resolved vtr ON vtr.card_variant_id = cvd.id
    JOIN card c ON c.id = dc.card_id
    JOIN card_set s ON s.id = c.set_id
    JOIN series ser ON ser.id = s.series_id
    LEFT JOIN LATERAL (
           -- THE ROW'S OWN PRINTING'S price — the whole point of migration
           -- 051. No representative fallback: an unpriced printing is null,
           -- exactly as it is on a list row.
           SELECT pc.market_minor, pc.currency_code
             FROM price_current pc
            WHERE pc.card_variant_id = dc.card_variant_id
              AND pc.source_code = 'tcgcsv' AND pc.currency_code = 'USD' AND pc.market_minor IS NOT NULL
            LIMIT 1
         ) price ON true
   WHERE dc.deck_id = $1 AND dc.user_id = $2 AND (d.deleted_at IS NULL OR $3::boolean)
   ORDER BY CASE c.category WHEN 'Pokemon' THEN 0 WHEN 'Trainer' THEN 1 ELSE 2 END,
            c.name, c.number_sort, cvd.sort_order`;

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

async function loadRows(deckId: string, userId: string, includeDeleted = false): Promise<{ rows: DeckRow[]; types: Map<number, PokemonType[]> }> {
  const rows = await q<DeckRow>(DECK_CARD_SELECT, [deckId, userId, includeDeleted]);
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
  const allocations = await loadOwnedPrints(dbHandle(), userId, rows[0]?.format_code ?? 'standard', rows.map((r) => ({
    cardId: Number(r.card_id), variantId: Number(r.card_variant_id), variantKind: r.variant_kind_code,
    quantity: r.quantity, group: r.identical_print_group,
    basicEnergyType: r.category === 'Energy' && r.energy_type === 'Normal'
      ? basicEnergyType(r.name, types.get(Number(r.card_id))?.[0] ?? null) : null,
    isPromo: r.is_promo, isStamped: r.is_stamped, pinExact: r.pin_exact,
  })));
  for (const row of rows) {
    const allocation = allocations.get(Number(row.card_variant_id));
    row.owned_qty = String(allocation?.owned ?? 0);
    row.owned_as = allocation?.ownedAs ?? [];
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
  // The rules of the game do not care which printing you sleeve, so the
  // ENGINE model aggregates the per-variant rows back to one entry per card
  // (2 Normal + 1 RH = one entry, quantity 3). This is also what keeps the
  // legality engine's prints/reprint logic exactly as it was before 051 —
  // it never sees two "copies" of one card id.
  const entries: DeckEntry[] = [];
  const facts: CardFacts[] = [];
  const byCard = new Map<number, DeckEntry>();
  for (const r of rows) {
    const id = Number(r.card_id);
    const existing = byCard.get(id);
    if (existing) {
      existing.quantity = Math.min(60, existing.quantity + r.quantity);
      continue;
    }
    const f = toFacts(r, types.get(id) ?? []);
    facts.push(f);
    const e: DeckEntry = { card: f, quantity: r.quantity, section: sectionOf(r.category) };
    byCard.set(id, e);
    entries.push(e);
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

/** Run the engine with a reprint oracle (built on the request's connection) for pool-checked formats. */
async function validate(deck: Deck, facts: CardFacts[]): Promise<ValidationResult> {
  const cfg = formatConfig(deck.formatCode);
  if (cfg.pool_strategy === 'all' || facts.length === 0) {
    return validateDeck(deck, {});
  }
  const oracle = await buildReprintOracle(dbHandle(), facts, cfg.legal_marks);
  return validateDeck(deck, { isInFormatByReprint: oracle });
}

function priceUsd(r: DeckRow): number | null {
  return r.market_minor != null ? toMajor(r.market_minor, r.currency_code ?? 'USD') : null;
}

function shapeCard(r: DeckRow) {
  const owned = Number(r.owned_qty);
  return {
    cardId: r.tcgdex_id,
    // Which PRINTING this row is (migration 051). Same shape as a list item's
    // `variant`, so VariantChip renders both.
    variantId: Number(r.card_variant_id),
    variant: {
      kind: r.variant_kind_code,
      displayName: r.variant_display ?? r.variant_kind_display,
      tier: r.variant_tier,
      isPrimary: r.variant_is_primary,
    },
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
    // The expansion code actually PRINTED on the card, next to the collector
    // number ("PBL 39"), which is what a player reads off the card in hand —
    // our `setId` is TCGdex's internal id ("me05") and is printed nowhere
    // (issue #57). Null for sets with no PTCGL/Limitless code at all. The
    // authority is the vendored alias table, never card_set.ptcgl_code.
    setCode: ptcglCodeForSet(r.set_tcgdex_id)?.code ?? null,
    setName: r.set_name,
    seriesSlug: r.series_slug,
    quantity: r.quantity,
    owned,
    ownedAs: r.owned_as,
    pinExact: r.pin_exact,
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
      const { rows, types } = await loadRows(meta.id, userId, deleted);
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

// ── POST /decks/save — create or replace a whole deck atomically ─────────────
//
// This is the write boundary used by save_deck. Resolving every id, writing the
// deck row, replacing the card list and recording its first/next snapshot all
// happen in ONE transaction. A bad id throws before the deck can exist, and a
// deterministic idempotency key replays the deck id after an ambiguous timeout
// instead of creating a twin.
interface SaveDeckCardInput { cardId: string; quantity: number }

function parseSaveDeckCards(value: unknown): SaveDeckCardInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw badRequest('cards must be an array');
  const byId = new Map<string, number>();
  for (const raw of value) {
    const cardId = str((raw as { cardId?: unknown })?.cardId)?.trim();
    const quantity = Number((raw as { quantity?: unknown })?.quantity);
    if (!cardId) throw badRequest('every card needs cardId');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 60) {
      throw badRequest(`quantity for ${cardId} must be an integer 1..60`);
    }
    byId.set(cardId, Math.min(60, (byId.get(cardId) ?? 0) + quantity));
  }
  if (byId.size > 60) throw badRequest('cards may contain at most 60 distinct ids');
  return [...byId].map(([cardId, quantity]) => ({ cardId, quantity }));
}

// ── Retry keys for whole-deck writes ─────────────────────────────────────────
//
// A key is derived from the request's CONTENT — no clock in it, so a retry is
// recognised however long the first attempt took. What stops a content key
// from replaying forever is the replay rule: a stored result is honoured only
// while the deck it made is still alive and unchanged since that request
// committed. Once it has been deleted or edited, the key is spent and the
// request moves to the key's next GENERATION, derived from the spent batch —
// so a retry of that later save lands on the same generation and replays it
// instead of making a twin.
const RETRY_HOPS = 8;

function contentKey(prefix: string, content: unknown): string {
  return `${prefix}:${createHash('sha256').update(JSON.stringify(content)).digest('hex')}`;
}

function saveDeckKey(input: {
  deckId: string | null; name: string | null; format: FormatCode | null; glcType: PokemonType | null;
  cards: SaveDeckCardInput[] | undefined;
  // The deck's updated_at before this write. An edit's key must change when the
  // deck does, or A → B → A would replay the first save and leave the deck on B.
  state: string | null;
}): string {
  const cards = input.cards === undefined
    ? null
    : [...input.cards].sort((a, b) => a.cardId.localeCompare(b.cardId));
  return contentKey('deck-save', { ...input, cards });
}

async function resolveRetryKey(userId: string, key: string): Promise<{ key: string; replay: StoredBatch | null }> {
  let current = key;
  for (let hop = 0; hop < RETRY_HOPS; hop++) {
    const batch = await withTx((client) => findCommittedBatch(client, userId, [current]));
    if (!batch) return { key: current, replay: null };
    const deckId = (batch.response as { deckId?: string } | null)?.deckId;
    // Compared in SQL against the batch row itself: a timestamptz that goes
    // through a JS Date loses its microseconds, and then every deck looks
    // "changed since" the request that made it.
    const live = deckId
      ? await q1<{ id: string }>(
          `SELECT d.id FROM deck d JOIN mutation_batch b ON b.id = $3 AND b.user_id = $2
            WHERE d.id = $1 AND d.user_id = $2 AND d.deleted_at IS NULL AND d.updated_at <= b.finished_at`,
          [deckId, userId, batch.id],
        )
      : null;
    if (live) return { key: current, replay: batch };
    current = contentKey(`${key.slice(0, 60)}:gen`, { key, spent: batch.id });
  }
  throw badRequest('This exact save has been repeated too many times. Change the name or the list and try again.');
}

decksRouter.post(
  '/save',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const userId = currentUserId(req);
    const source = parseSource(body.source);
    const versionNote = parseNoteText(body.versionNote, VERSION_NOTE_MAX, 'versionNote');
    const deckId = body.deckId === undefined || body.deckId === null || String(body.deckId).trim() === ''
      ? null
      : parseDeckId(String(body.deckId));
    const cards = parseSaveDeckCards(body.cards);
    const requestedName = body.name === undefined ? null : parseName(body.name);
    if (!deckId && !requestedName) throw badRequest('name is required to create a deck');
    const formatGiven = body.formatCode !== undefined || body.format !== undefined;
    const format = parseFormat(body.formatCode ?? body.format);
    const glcGiven = body.glcType !== undefined ? parseGlcType(body.glcType) : null;
    const before = deckId
      ? await q1<{ updated_at: string }>(
          `SELECT updated_at::text AS updated_at FROM deck WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [deckId, userId],
        )
      : null;
    if (deckId && !before) throw notFound(`No deck '${deckId}'`);
    const requestedKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : saveDeckKey({
          deckId, name: requestedName, format: formatGiven ? format : null, glcType: glcGiven,
          cards, state: before?.updated_at ?? null,
        });
    if (requestedKey.length > 200) throw badRequest('idempotencyKey must be 200 characters or fewer');
    const { key: callerKey, replay } = await resolveRetryKey(userId, requestedKey);
    const keys = [callerKey];

    let outcome: { deckId: string; created: boolean; replayed: boolean };
    if (replay) {
      const stored = replay.response as { deckId?: string; created?: boolean } | null;
      if (!stored?.deckId) throw badRequest('saved deck replay is missing its deck id');
      outcome = { deckId: stored.deckId, created: stored.created === true, replayed: true };
    } else {
      try {
        outcome = await withTx(async (client) => {
          // FIRST write: reserve the key. A concurrent retry blocks here and
          // replays after the winning transaction commits.
          const batchId = await openBatch(client, {
            userId, source, tool: 'deck.save', note: versionNote, idempotencyKey: callerKey,
          });

          // Resolve EVERY id before anything is written, and fold two refs to
          // the same card (a TCGdex id and its catalogue id) into one line.
          const want = new Map<number, { ref: string; quantity: number }>();
          const badIds: string[] = [];
          for (const card of cards ?? []) {
            try {
              const cardId = await resolveCardId(client, card.cardId);
              const seen = want.get(cardId);
              want.set(cardId, { ref: seen?.ref ?? card.cardId, quantity: Math.min(60, (seen?.quantity ?? 0) + card.quantity) });
            } catch (error) {
              if (error instanceof ApiError && error.status === 404) badIds.push(card.cardId);
              else throw error;
            }
          }
          if (badIds.length) {
            throw badRequest(`Unresolved card ids: ${badIds.join(', ')}. Nothing was saved.`);
          }

          let id = deckId;
          let created = false;
          let formatChanged = false;
          if (!id) {
            const glcType = format === 'glc' ? (glcGiven ?? glcTypes()[0] ?? null) : null; // NOT NULL constraint for glc
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO deck (user_id, format_code, glc_type, name)
                    VALUES ($1, $2, $3, $4) RETURNING id`,
              [userId, format, glcType, requestedName],
            );
            id = inserted.rows[0]!.id;
            created = true;
          } else {
            await assertDeck(client, id, userId);
            const current = (await client.query<{ format_code: FormatCode; glc_type: PokemonType | null }>(
              `SELECT format_code, glc_type FROM deck WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [id, userId],
            )).rows[0]!;
            const sets: string[] = [];
            const params: unknown[] = [id, userId];
            const push = (column: string, value: unknown) => { params.push(value); sets.push(`${column} = $${params.length}`); };
            if (requestedName !== null) push('name', requestedName);
            // Restating the deck's own format changes nothing — above all not a
            // GLC deck's Pokémon type, which the same logic as PATCH /decks/:id
            // keeps unless the caller names a new one.
            if (formatGiven && format !== current.format_code) {
              formatChanged = true;
              push('format_code', format);
              push('glc_type', format === 'glc' ? (glcGiven ?? current.glc_type ?? glcTypes()[0] ?? null) : null);
            } else if (glcGiven && current.format_code === 'glc' && glcGiven !== current.glc_type) {
              formatChanged = true;
              push('glc_type', glcGiven);
            }
            if (sets.length) {
              await client.query(`UPDATE deck SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2`, params);
            }
          }

          if (cards !== undefined) {
            if (created) {
              for (const [cardId, line] of want) {
                await client.query(
                  `INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity) VALUES ($1, $2, $3, $4, $5)`,
                  [id, cardId, await resolveVariantId(client, cardId, null), userId, line.quantity],
                );
              }
            } else {
              // AN EDIT CHANGES ONLY WHAT CHANGED. Since 051 a deck row is a
              // PRINTING (2 normal + 1 reverse holo are two rows) and 076 can pin
              // one; rewriting the list would put every card back on its primary
              // printing and clear every pin. So a card whose total is unchanged
              // is not touched, a single-printing card is resized in place, a
              // removed card's rows go, and only a NEW card gets its primary.
              const rows = (await client.query<{ card_id: string; card_variant_id: string; quantity: number }>(
                `SELECT card_id, card_variant_id, quantity FROM deck_card WHERE deck_id = $1 AND user_id = $2`, [id, userId],
              )).rows;
              const held = new Map<number, Array<{ variantId: number; quantity: number }>>();
              for (const row of rows) {
                const list = held.get(Number(row.card_id)) ?? [];
                list.push({ variantId: Number(row.card_variant_id), quantity: Number(row.quantity) });
                held.set(Number(row.card_id), list);
              }
              for (const cardId of held.keys()) {
                if (!want.has(cardId)) {
                  await client.query(`DELETE FROM deck_card WHERE deck_id = $1 AND card_id = $2 AND user_id = $3`, [id, cardId, userId]);
                }
              }
              for (const [cardId, line] of want) {
                const printings = held.get(cardId);
                if (!printings) {
                  await client.query(
                    `INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity) VALUES ($1, $2, $3, $4, $5)`,
                    [id, cardId, await resolveVariantId(client, cardId, null), userId, line.quantity],
                  );
                  continue;
                }
                const total = printings.reduce((sum, p) => sum + p.quantity, 0);
                if (total === line.quantity) continue;
                if (printings.length > 1) {
                  throw badRequest(
                    `${line.ref} is in this deck as ${printings.length} printings, so changing its count would have to guess which one. ` +
                    'Nothing was saved; change that card in the deck editor, or leave its count as it is.',
                  );
                }
                await client.query(
                  `UPDATE deck_card SET quantity = $4 WHERE deck_id = $1 AND card_variant_id = $2 AND user_id = $3`,
                  [id, printings[0]!.variantId, userId, line.quantity],
                );
              }
            }
            await client.query(`UPDATE deck SET updated_at = now() WHERE id = $1 AND user_id = $2`, [id, userId]);
          }

          if (created || cards !== undefined || formatChanged) {
            await recordDeckChange(client, id, { source, note: versionNote });
          }
          await recordEvents(client, batchId, userId, [{
            entityType: 'deck', entityId: id, operation: OPS.deckCards,
            before: created ? null : { cardsReplaced: cards !== undefined, formatChanged },
            after: { name: requestedName, format: created || formatChanged ? format : null, cards: cards ?? null },
          }]);
          const stored = { deckId: id, created };
          await closeBatch(client, batchId, stored, { cards: want.size, created });
          return { ...stored, replayed: false };
        });
      } catch (error) {
        if (!(error instanceof ReplayError)) throw error;
        const stored = await withTx((client) => loadBatchResponse(client, userId, keys));
        const response = stored.response as { deckId?: string; created?: boolean } | null;
        if (!response?.deckId) throw badRequest('saved deck replay is missing its deck id');
        outcome = { deckId: response.deckId, created: response.created === true, replayed: true };
      }
    }

    const meta = await loadMeta(outcome.deckId, userId);
    if (!meta) throw notFound(`No deck '${outcome.deckId}'`);
    const payload = await detailPayload(meta, userId);
    userCache(res);
    res.status(outcome.created && !outcome.replayed ? 201 : 200).json({ ...payload, replayed: outcome.replayed });
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
// deck_card is keyed by (deck, card_variant) since migration 051. The UI
// speaks tcgdex card ids (+ an optional variantId); resolve the card first,
// then the printing — omitted variantId means the card's primary variant, the
// same default every import and the pre-051 backfill used.
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
/**
 * Resolve which PRINTING a write means. An explicit variantId must belong to
 * the card (a variant of a different card is a caller bug, said plainly);
 * omitted means the card's primary variant.
 */
async function resolveVariantId(client: pg.PoolClient, cardId: number, variantRef: unknown): Promise<number> {
  if (variantRef !== undefined && variantRef !== null && String(variantRef).trim() !== '') {
    const vid = Number(variantRef);
    if (!Number.isInteger(vid) || vid <= 0) throw badRequest('variantId must be a positive integer');
    const r = await client.query(`SELECT 1 FROM card_variant WHERE id = $1 AND card_id = $2`, [vid, cardId]);
    if (!r.rows[0]) throw badRequest(`variant ${vid} is not a printing of that card`);
    return vid;
  }
  const r = await client.query<{ id: string }>(
    `SELECT id FROM card_variant WHERE card_id = $1 ORDER BY is_primary DESC, sort_order LIMIT 1`,
    [cardId],
  );
  if (!r.rows[0]) throw notFound(`card ${cardId} has no printings`);
  return Number(r.rows[0].id);
}

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
      const variantId = await resolveVariantId(client, cardId, body.variantId ?? body.cardVariantId);
      await client.query(
        `INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity)
              VALUES ($1, $2, $3, $4, LEAST($5, 60))
         ON CONFLICT (deck_id, card_variant_id)
         DO UPDATE SET quantity = LEAST(deck_card.quantity + $5, 60)`,
        [deckId, cardId, variantId, userId, qty],
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
    const qty = body.quantity === undefined ? null : Number(body.quantity);
    if (qty !== null && (!Number.isInteger(qty) || qty < 0 || qty > 60)) throw badRequest('quantity must be an integer 0..60');
    const pinExact = body.pinExact;
    if (pinExact !== undefined && typeof pinExact !== 'boolean') throw badRequest('pinExact must be a boolean');
    if (qty === null && pinExact === undefined) throw badRequest('quantity or pinExact is required');
    const source = parseSource(body.source);
    const versionNote = parseNoteText(body.versionNote, VERSION_NOTE_MAX, 'versionNote');

    await withTx(async (client) => {
      await assertDeck(client, deckId, userId);
      const cardId = await resolveCardId(client, ref);
      // Which printing? Explicit variantId wins. Without one: if the card is
      // in the deck as exactly one printing, that row is obviously the one
      // meant (and every pre-051 caller keeps working); as several, the
      // request is genuinely ambiguous and 400s rather than guessing which
      // printing to resize. A card not in the deck yet targets its primary.
      const explicit = body.variantId ?? body.cardVariantId ?? req.query.variant;
      let variantId: number;
      if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
        variantId = await resolveVariantId(client, cardId, explicit);
      } else {
        const inDeck = await client.query<{ card_variant_id: string }>(
          `SELECT card_variant_id FROM deck_card WHERE deck_id = $1 AND card_id = $2 AND user_id = $3`,
          [deckId, cardId, userId],
        );
        if (inDeck.rows.length > 1) {
          throw badRequest(
            `that card is in this deck as ${inDeck.rows.length} printings — pass variantId to say which one`,
          );
        }
        variantId = inDeck.rows[0] ? Number(inDeck.rows[0].card_variant_id) : await resolveVariantId(client, cardId, null);
      }
      if (qty === null) {
        const changed = await client.query(
          `UPDATE deck_card SET pin_exact = $4
            WHERE deck_id = $1 AND card_variant_id = $2 AND user_id = $3`,
          [deckId, variantId, userId, pinExact],
        );
        if (!changed.rowCount) throw notFound('That printing is not in this deck');
      } else if (qty === 0) {
        await client.query(`DELETE FROM deck_card WHERE deck_id = $1 AND card_variant_id = $2 AND user_id = $3`, [deckId, variantId, userId]);
      } else {
        await client.query(
          `INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity, pin_exact)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::boolean, FALSE))
           ON CONFLICT (deck_id, card_variant_id) DO UPDATE
             SET quantity = $5, pin_exact = COALESCE($6::boolean, deck_card.pin_exact)`,
          [deckId, cardId, variantId, userId, qty, pinExact ?? null],
        );
      }
      await client.query(`UPDATE deck SET updated_at = now() WHERE id = $1`, [deckId]);
      if (qty !== null) await recordDeckChange(client, deckId, { source, note: versionNote });
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
      // ?variant=<id> (or body.variantId) removes ONE printing; without it the
      // whole card goes, every printing — which is both what "remove this
      // card" means and exactly what pre-051 callers expect.
      const explicit = body.variantId ?? body.cardVariantId ?? req.query.variant;
      if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
        const variantId = await resolveVariantId(client, cardId, explicit);
        await client.query(`DELETE FROM deck_card WHERE deck_id = $1 AND card_variant_id = $2 AND user_id = $3`, [deckId, variantId, userId]);
      } else {
        await client.query(`DELETE FROM deck_card WHERE deck_id = $1 AND card_id = $2 AND user_id = $3`, [deckId, cardId, userId]);
      }
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
// `dryRun: true` resolves the text and writes NOTHING: the import dialog asks
// first, so a line that matches no card is shown to the reader, who fixes or
// skips it, instead of being left out of a deck they then have to audit.
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
    const requestedGlcType = parseGlcType(body.glcType);
    const name = parseName(body.name, false) || 'Imported Deck';
    const dryRun = body.dryRun === true;
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

    const resolved = await resolveDeck(dbHandle(), parsed, format, requestedGlcType);
    const glcType = format === 'glc' ? requestedGlcType ?? inferGlcType(resolved.entries) : null;
    resolved.glcType = glcType;

    // Aggregate resolved entries by catalogue card id (same print on two lines sums).
    const byCard = new Map<number, number>();
    for (const e of resolved.entries) {
      byCard.set(e.card.id, Math.min(60, (byCard.get(e.card.id) ?? 0) + e.quantity));
    }
    const unresolved = (resolved.importWarnings ?? []).filter((w) => w.code === 'UNRESOLVED_CARD');
    const formatIssues = dryRun
      ? (await validate(resolved, resolved.entries.map((entry) => entry.card))).violations
        .filter((violation) => violation.severity === 'error' && violation.scope === 'card')
        .flatMap((violation) => (violation.card_ids ?? []).flatMap((id) => {
          const card = resolved.entries.find((entry) => entry.card.id === id)?.card;
          return card ? [{ cardId: card.tcgdexId, reason: violation.message }] : [];
        }))
      : [];
    const summary = {
      source,
      resolvedEntries: resolved.entries.length,
      distinctCards: byCard.size,
      totalCards: [...byCard.values()].reduce((n, q) => n + q, 0),
      unresolved: unresolved.map((w) => w.message),
      // The same lines, verbatim, for the dialog to list and find in the text.
      unresolvedLines: unresolved.map((w) => w.line ?? w.message),
      glcType,
      // A missing or ambiguous type cannot decide whether a Pokémon correction
      // belongs in this one-type deck. Keep it pending instead of guessing Grass.
      pendingTypeCardIds: format === 'glc' && !glcType
        ? [...new Set(resolved.entries
          .filter((entry) => entry.card.category === 'Pokemon')
          .map((entry) => entry.card.tcgdexId))]
        : [],
      formatIssues,
      warnings: (resolved.importWarnings ?? []).filter((w) => w.code !== 'UNRESOLVED_CARD'),
      // Decklist text carries no printing info; every line is stored as the
      // card's primary variant (migration 051).
      variantNote: 'Imported lines have no printing information — each card was added as its primary printing.',
    };
    if (dryRun) {
      userCache(res);
      res.json({ import: summary });
      return;
    }

    if (unresolved.length > 0) {
      throw badRequest(`Unresolved deck lines: ${summary.unresolvedLines.join('; ')}. Nothing was saved.`);
    }

    if (format === 'glc' && !glcType) {
      throw badRequest('Cannot import a GLC deck until its Pokémon type is known. Edit the list so its Pokémon share one type, or choose another format.');
    }

    const canonicalCards = [...byCard].sort((a, b) => a[0] - b[0]);
    // Only a caller that asks for retry safety gets it here. The web dialog
    // sends no key, so importing the same list twice on purpose still makes two
    // decks, as it always has; Deck-E's save path sends one.
    const requestedKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : null;
    if (requestedKey && requestedKey.length > 200) throw badRequest('idempotencyKey must be 200 characters or fewer');
    const resolvedKey = requestedKey
      ? await resolveRetryKey(userId, requestedKey)
      : { key: null, replay: null };
    const callerKey: string | null = resolvedKey.key;
    const keys = callerKey ? [callerKey] : [];
    const replay = resolvedKey.replay;
    let deckId: string;
    let replayed = false;
    if (replay) {
      const stored = replay.response as { deckId?: string } | null;
      if (!stored?.deckId) throw badRequest('import replay is missing its deck id');
      deckId = stored.deckId;
      replayed = true;
    } else {
      try {
        deckId = await withTx(async (client) => {
          const batchId = await openBatch(client, {
            userId, source: writeSource, tool: 'deck.import', ...(callerKey ? { idempotencyKey: callerKey } : {}),
          });
          const row = await client.query<{ id: string }>(
            `INSERT INTO deck (user_id, format_code, glc_type, name) VALUES ($1, $2, $3, $4) RETURNING id`,
            [userId, format, glcType, name],
          );
          const id = row.rows[0]!.id;
          // PTCG Live text has no printing information, so every imported line
          // lands on the card's PRIMARY variant — the same representative the
          // pre-051 read paths always assumed, resolved in one batch. Said in the
          // response (`import.variantNote`) rather than silently.
          const primaries = byCard.size
            ? await client.query<{ card_id: string; id: string }>(
                `SELECT DISTINCT ON (card_id) card_id, id FROM card_variant
                  WHERE card_id = ANY($1::bigint[])
                  ORDER BY card_id, is_primary DESC, sort_order`,
                [[...byCard.keys()]],
              )
            : { rows: [] as { card_id: string; id: string }[] };
          const primaryOf = new Map(primaries.rows.map((r) => [Number(r.card_id), Number(r.id)]));
          const missingPrintings = [...byCard.keys()].filter((cardId) => !primaryOf.has(cardId));
          if (missingPrintings.length) {
            throw badRequest(`Cards without a resolvable printing: ${missingPrintings.join(', ')}. Nothing was saved.`);
          }
          for (const [cardId, quantity] of byCard) {
            await client.query(
              `INSERT INTO deck_card (deck_id, card_id, card_variant_id, user_id, quantity) VALUES ($1, $2, $3, $4, $5)`,
              [id, cardId, primaryOf.get(cardId)!, userId, quantity],
            );
          }
          await recordDeckChange(client, id, { source: writeSource }); // seed v1 with the imported list
          await recordEvents(client, batchId, userId, [{
            entityType: 'deck', entityId: id, operation: OPS.deckCards,
            before: null, after: { name, format, cards: canonicalCards },
          }]);
          await closeBatch(client, batchId, { deckId: id }, { cards: byCard.size, created: true });
          return id;
        });
      } catch (error) {
        if (!(error instanceof ReplayError)) throw error;
        const stored = await withTx((client) => loadBatchResponse(client, userId, keys));
        const response = stored.response as { deckId?: string } | null;
        if (!response?.deckId) throw badRequest('import replay is missing its deck id');
        deckId = response.deckId;
        replayed = true;
      }
    }

    const meta = (await loadMeta(deckId, userId))!;
    const payload = await detailPayload(meta, userId);
    userCache(res);
    res.status(201).json({
      ...payload,
      replayed,
      import: summary,
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
      // else a bare name line. Never share the PTCGL formatter. Deliberately
      // NOT aggregated by card (unlike PTCGL below): each row is a printing
      // with its own TCGplayer token, and buying is exactly where the
      // printing matters.
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
    // PTCGL lines are PER CARD: since migration 051 the deck rows are per
    // printing, so "2 Normal + 1 RH" must aggregate to "3 Shieldon PBL 61",
    // never two lines of the same card.
    const byCardExport = new Map<number, ExportRow>();
    for (const r of rows) {
      const id = Number(r.card_id);
      const cur = byCardExport.get(id);
      if (cur) {
        cur.quantity = Math.min(60, cur.quantity + r.quantity);
        continue;
      }
      byCardExport.set(id, {
        cardId: id,
        tcgdexId: r.tcgdex_id,
        quantity: r.quantity,
        name: r.name,
        localId: r.local_id,
        category: r.category,
        energyType: r.energy_type,
        setTcgdexId: r.set_tcgdex_id,
        setName: r.set_name,
      });
    }
    const exportRows: ExportRow[] = [...byCardExport.values()];
    const { text, warnings } = await buildPtcglExport(exportRows, (row) => findLiveReprint(dbHandle(), row));    userCache(res);
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
        variantId: Number(r.card_variant_id),
        variant: r.variant_display ?? r.variant_kind_display,
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
          variantId: Number(r.card_variant_id),
          variant: r.variant_display ?? r.variant_kind_display,
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
        // Since migration 051 the row IS a printing — name it, so the cart
        // line buys the variant actually sleeved.
        variant: r.variant_display ?? r.variant_kind_display,
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

/**
 * Card-list delta between two snapshots.
 *
 * Snapshots are one entry per PRINTING since migration 051, and pre-051
 * snapshots are one entry per card with no variantId — so the diff runs at
 * the CARD level (totals aggregated first), which makes an old snapshot vs a
 * new one of the same cards read as "no change", never as everything having
 * swapped. Printings get their own quiet lane: when a card's total is
 * unchanged but its printing mix moved (both sides variant-aware), that is a
 * `printings` line naming the swap — and nothing is said about printings
 * anywhere else, per the plan: name the variant when two printings of one
 * card diverge, stay quiet about it when they don't.
 */
export function diffSnapshots(prev: SnapshotEntry[], cur: SnapshotEntry[]) {
  interface Agg {
    name: string;
    tcgdexId: string;
    quantity: number;
    /** printing mix, only when EVERY entry of the card names its variant. */
    variants: Map<number, { quantity: number; label: string }> | null;
  }
  const aggregate = (list: SnapshotEntry[]): Map<number, Agg> => {
    const by = new Map<number, Agg>();
    for (const c of list) {
      let a = by.get(c.cardId);
      if (!a) {
        a = { name: c.name, tcgdexId: c.tcgdexId, quantity: 0, variants: new Map() };
        by.set(c.cardId, a);
      }
      a.quantity += c.quantity;
      if (a.variants !== null && typeof c.variantId === 'number') {
        const v = a.variants.get(c.variantId);
        a.variants.set(c.variantId, {
          quantity: (v?.quantity ?? 0) + c.quantity,
          label: c.variantName ?? v?.label ?? `printing ${c.variantId}`,
        });
      } else {
        a.variants = null; // pre-051 entry — the mix is unknowable
      }
    }
    return by;
  };
  const prevBy = aggregate(prev);
  const curBy = aggregate(cur);
  const added = [...curBy.entries()].filter(([id]) => !prevBy.has(id))
    .map(([, c]) => ({ name: c.name, tcgdexId: c.tcgdexId, quantity: c.quantity }));
  const removed = [...prevBy.entries()].filter(([id]) => !curBy.has(id))
    .map(([, c]) => ({ name: c.name, tcgdexId: c.tcgdexId, quantity: c.quantity }));
  const changed = [...curBy.entries()]
    .filter(([id, c]) => prevBy.has(id) && prevBy.get(id)!.quantity !== c.quantity)
    .map(([id, c]) => ({ name: c.name, tcgdexId: c.tcgdexId, from: prevBy.get(id)!.quantity, to: c.quantity }));
  const mixOf = (m: Map<number, { quantity: number; label: string }>): string =>
    [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => `${v.quantity}× ${v.label}`)
      .join(' + ');
  const printings = [...curBy.entries()]
    .filter(([id, c]) => {
      const p2 = prevBy.get(id);
      if (!p2 || p2.quantity !== c.quantity || !p2.variants || !c.variants) return false;
      if (p2.variants.size !== c.variants.size) return true;
      for (const [vid, v] of c.variants) if (p2.variants.get(vid)?.quantity !== v.quantity) return true;
      return false;
    })
    .map(([id, c]) => ({
      name: c.name,
      tcgdexId: c.tcgdexId,
      from: mixOf(prevBy.get(id)!.variants!),
      to: mixOf(c.variants!),
    }));
  return { added, removed, changed, printings };
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
// Non-destructive: the old snapshot always lands as a NEW version, so the list
// it replaces keeps its own, even when that list was never played (see
// restoreSnapshot and deck/versions.ts). History is never deleted.
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

      const restored = await restoreSnapshot(
        client, deckId, userId,
        { cards: target.cards, strategyMd: target.strategy_md },
        { includeStrategy, source, note },
      );
      return { toVersion, ...restored };
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
  raw_log: string | null;
  origin: BattleLogOrigin;
  result: 'win' | 'loss' | 'tie' | null;
  opponent: string | null;
  opponent_deck: string | null;
  opponent_archetype: string | null;
  notes: string | null;
  review_md: string | null;
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
    opponentArchetype: r.opponent_archetype,
    origin: r.origin,
    turns: parsed?.totalTurns ?? null,
    prizes: parsed?.prizesTaken ?? null,
    notes: r.notes,
    reviewMd: r.review_md,
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

function parseLogOrigin(v: unknown): BattleLogOrigin {
  if (v === undefined || v === null) return 'ptcgl';
  if (v === 'ptcgl' || v === 'in_person' || v === 'other') return v;
  throw badRequest("origin must be 'ptcgl', 'in_person' or 'other'");
}

/** Normalize at the trust boundary; callers never get to choose stored key syntax. */
function parseOpponentArchetype(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw badRequest('opponentArchetype must be a string');
  if (!v.trim()) return null;
  const key = normalizeOpponentArchetype(v);
  if (!key) throw badRequest('opponentArchetype must normalize to 1-64 lowercase ASCII letters, digits or hyphen-separated words');
  return key;
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
      `SELECT id, deck_version, raw_log, origin, result, opponent, opponent_deck, opponent_archetype,
              notes, review_md, parsed, source, played_at, created_at
         FROM battle_log
        WHERE deck_id = $1 AND ($2::int IS NULL OR deck_version = $2)
        ORDER BY played_at DESC, id DESC
        LIMIT $3 OFFSET $4`,
      [deckId, versionFilter, pageSize, (page - 1) * pageSize],
    );
    const archetypes = await q<{
      opponent_archetype: string;
      games: string;
      wins: string;
      losses: string;
      ties: string;
      last_played_at: string;
    }>(
      `SELECT opponent_archetype,
              count(*) AS games,
              count(*) FILTER (WHERE result = 'win') AS wins,
              count(*) FILTER (WHERE result = 'loss') AS losses,
              count(*) FILTER (WHERE result = 'tie') AS ties,
              max(played_at) AS last_played_at
         FROM battle_log
        WHERE deck_id = $1 AND opponent_archetype IS NOT NULL
        GROUP BY opponent_archetype
        ORDER BY max(played_at) DESC, opponent_archetype`,
      [deckId],
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
      archetypes: archetypes.map((a) => ({
        opponentArchetype: a.opponent_archetype,
        games: Number(a.games),
        wins: Number(a.wins),
        losses: Number(a.losses),
        ties: Number(a.ties),
        lastPlayedAt: a.last_played_at,
      })),
      pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    });
  }),
);

// POST /decks/:id/logs — record a PTCG Live or debriefed in-person game.
// `dryRun: true` performs the SAME deck resolution, preparation, owner gate,
// and field merge as an insert, then
// returns the row-facing values without writing. Both branches consume the one
// `prepareBattleLog` result: the approval preview cannot promise a write that
// owner identification would reject. A real write attaches to the CURRENT
// version (that is the list the game was played with).
decksRouter.post(
  '/:id/logs',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const body = req.body ?? {};
    const origin = parseLogOrigin(body.origin);
    let rawLog: string | null = null;
    if (body.rawLog !== undefined && body.rawLog !== null) {
      // Preserve the shipped PTCG Live validation message byte-for-byte. The
      // type-specific message is new and only reachable on origins where the
      // field itself is optional.
      if (typeof body.rawLog !== 'string') {
        if (origin === 'ptcgl') throw badRequest('rawLog is required');
        throw badRequest('rawLog must be a string');
      }
      if (body.rawLog.trim()) rawLog = body.rawLog;
    }
    if (origin === 'ptcgl' && rawLog === null) throw badRequest('rawLog is required');
    if (rawLog !== null && rawLog.length > RAW_LOG_MAX) throw badRequest(`rawLog too large (max ${RAW_LOG_MAX} chars)`);
    const explicitResult = parseResultField(body.result) ?? undefined; // null clear is meaningless on create
    const opponent = parseOptText(body.opponent, 200, 'opponent');
    const opponentDeck = parseOptText(body.opponentDeck, 200, 'opponentDeck');
    const opponentArchetype = parseOpponentArchetype(body.opponentArchetype);
    const notes = parseNoteText(body.notes, LOG_NOTES_MAX, 'notes');
    const reviewMd = parseNoteText(body.reviewMd, LOG_REVIEW_MAX, 'reviewMd');
    const playedAt = parsePlayedAt(body.playedAt);
    const playerName = parseOptText(body.playerName, 100, 'playerName') ?? undefined;
    const source = parseSource(body.source);
    const dryRun = body.dryRun === true;

    const out = await withTx(async (client) => {
      await assertDeck(client, deckId, userId);
      // soft-delete-exempt: behind assertDeck's lock, which filters deleted_at.
      const deck = await client.query<{ version: number; name: string; played_at: string }>(
        `SELECT version, name, now() AS played_at FROM deck WHERE id = $1`,
        [deckId],
      );
      const { version, name: deckName } = deck.rows[0]!;
      // A preview needs a concrete display value, so resolve its omitted time
      // from this transaction's database clock. A later confirmed request is a
      // different request and may naturally report a later time. The INSERT
      // below keeps the original database default path: passing null to
      // COALESCE preserves PostgreSQL's full timestamp precision and makes an
      // omitted played_at exactly the same `now()` as created_at (2026-10-10).
      const resolvedPlayedAt = playedAt ?? new Date(deck.rows[0]!.played_at).toISOString();
      const names = origin === 'ptcgl'
        ? await client.query<{ name: string }>(
            `SELECT c.name FROM deck_card dc JOIN card c ON c.id = dc.card_id WHERE dc.deck_id = $1`,
            [deckId],
          )
        : { rows: [] as { name: string }[] };
      let prepared;
      try {
        prepared = prepareBattleLog(rawLog, names.rows.map((r) => r.name), {
          origin,
          playerName,
          result: explicitResult,
          opponent,
          opponentDeck,
        });
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : 'could not prepare battle log');
      }

      if (dryRun) {
        return {
          dryRun: true as const,
          preview: {
            deckName,
            version,
            result: prepared.result,
            opponent: prepared.opponent,
            opponentDeck: prepared.opponentDeck,
            opponentDeckGuess: prepared.opponentDeck,
            opponentArchetype,
            origin,
            prizes: prepared.parsed?.prizesTaken ?? null,
            turns: prepared.parsed?.totalTurns ?? null,
            notes,
            reviewMd,
            playedAt: resolvedPlayedAt,
            confidence: prepared.parsed?.confidence ?? null,
            myPokemon: prepared.parsed?.myPokemon ?? [],
          },
          parsed: prepared.parsed,
          attachedToVersion: version,
        };
      }

      const row = await client.query<LogRow>(
        // user_id: migration 020 added battle_log.user_id NOT NULL for direct
        // RLS scoping (no join through deck) and backfilled it from the owning
        // deck; this insert was never updated to supply it. assertDeck above
        // has already proved this userId owns this deck.
        `INSERT INTO battle_log
           (deck_id, deck_version, raw_log, origin, result, opponent, opponent_deck,
            opponent_archetype, notes, review_md, parsed, source, played_at, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, COALESCE($13::timestamptz, now()), $14)
         RETURNING id, deck_version, raw_log, origin, result, opponent, opponent_deck,
                   opponent_archetype, notes, review_md, parsed, source, played_at, created_at`,
        [
          deckId, version, rawLog, origin, prepared.result, prepared.opponent,
          prepared.opponentDeck, opponentArchetype, notes, reviewMd,
          // playedAt, not the preview's resolved clock: an omitted time stays
          // NULL into COALESCE so PostgreSQL stamps it at insert precision (2026-10-10).
          prepared.parsed === null ? null : JSON.stringify(prepared.parsed), source, playedAt, userId,
        ],
      );
      return { dryRun: false as const, log: row.rows[0]!, attachedToVersion: version };
    });

    userCache(res);
    if (out.dryRun) {
      res.json(out);
      return;
    }
    res.status(201).json({ log: shapeLogFull(out.log), attachedToVersion: out.attachedToVersion });
  }),
);

// POST /decks/log-preview — parse a pasted log (NO writes anywhere) and score
// it against the caller's decks' current-version card lists, so the agent can
// pick which deck a log belongs to before attaching it. Pure scoring lives in
// scoreDeckMatch; this handler only loads + shapes, in the file's house style
// (asyncHandler, currentUserId, q/loadRows, userCache, res.json).
//
// Response contract (load-bearing — a follow-up builds the agent tool against
// exactly these field names):
//   { parsed: { result, opponent, turns, prizes, confidence, myPokemon, opponentDeckGuess },
//     candidates: [{ deckId, name, format, version, score, matchedNames, total }] }
// candidates are sorted by score descending, capped at 5, and an empty array
// when nothing scores above zero.
//
// `parsed` is built from a RE-PARSE against the best-scoring candidate's card
// names when one exists (see below), so owner identification — which scores the
// overlap between the cards each player plays and the deck — can actually
// resolve "me" and populate result/opponent/prizes/myPokemon/opponentDeckGuess
// with a meaningful confidence. When NO candidate scores above zero the response
// keeps the deck-agnostic parse: turns survives (it is perspective-free) but
// result, opponent, prizes, myPokemon and opponentDeckGuess are NULL and
// confidence is 'low' — owner identification cannot run without a deck, and the
// caller must supply playerName or an explicit result at attach time.
decksRouter.post(
  '/log-preview',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    // Per-user rate limit (security finding B): the parse+score loop is
    // unbounded fan-out a caller could hammer. 20/min/user is far above any
    // real use and stops a tight loop cold. Returned as the SAME JSON envelope
    // the agent-tools API client reads ({ error: { code, message } }, see
    // packages/agent-tools/src/api.ts) — a plain-text 429 made JSON.parse throw,
    // so the client fell back to 'deckpal-api POST /decks/log-preview → 429' and
    // discarded this authored guidance entirely (verified repro). Status stays 429.
    if (!logPreviewRateOk(userId)) {
      res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many log-preview requests — try again shortly.',
        },
      });
      return;
    }
    const body = req.body ?? {};
    if (typeof body.log !== 'string' || !body.log.trim()) throw badRequest('log is required');
    if (body.log.length > RAW_LOG_MAX) throw badRequest(`log too large (max ${RAW_LOG_MAX} chars)`);
    // The brief names this body field `player_name` (snake_case); accept it
    // literally so the follow-up agent tool — built against the brief's field
    // names — works. Fall back to the file's camelCase convention for any other
    // caller. Either way an empty/absent value means "omit" (deck-agnostic parse).
    const playerName = parseOptText(body.player_name ?? body.playerName, 100, 'player_name') ?? undefined;

    // Deck-agnostic parse: no deck names are passed, so owner scoring will not
    // resolve "me" (and the drift tripwire is suppressed for an empty deck).
    // parsed.playerCards carries both players' extracted names + codes, which is
    // what scoreDeckMatch ranks decks on.
    const parsed = parseBattleLog(body.log, [], playerName);

    // CAPPED at the recent decks (security finding B): the scoring set is the
    // recent decks — 40 is far above any real collection and bounds the fan-out
    // (2 queries per deck). Ordered by updated_at DESC so the cap keeps the
    // decks a reader actually touches, not the long tail. `id DESC` is a
    // deterministic tiebreaker: updated_at ties are common (a bulk edit bumps
    // several decks in one tick) and without it the cap is nondeterministic on
    // which of the tied decks survives the LIMIT. deck.id is the UUID PK
    // (research/SCHEMA.md), the table's stable key.
    const metas = await q<DeckMeta>(
      `${DECK_META_SELECT} WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT ${LOG_PREVIEW_DECK_CAP}`,
      [userId],
    );

    const candidates: {
      deckId: string;
      name: string;
      format: FormatCode;
      version: number;
      score: number;
      matchedNames: number;
      total: number;
    }[] = [];
    // The best-scoring candidate's card NAMES, kept so the log can be re-parsed
    // against them without a second query (the rows are already loaded above).
    // Null until a candidate scores above zero.
    let bestDeckNames: string[] | null = null;
    let bestScore = 0;
    for (const meta of metas) {
      const { rows } = await loadRows(meta.id, userId);
      const deckCards = rows.map((r) => ({ name: r.name, cardId: r.tcgdex_id }));
      const m = scoreDeckMatch(parsed, deckCards);
      if (m.score <= 0) continue; // nothing above zero → not a candidate
      candidates.push({
        deckId: meta.id,
        name: meta.name,
        format: meta.format_code,
        version: meta.version,
        score: m.score,
        matchedNames: m.matchedNames,
        total: m.total,
      });
      if (m.score > bestScore) {
        bestScore = m.score;
        // Re-parse needs only the names (owner identification scores name-key
        // overlap, exactly as POST /:id/logs passes names from deck_card⋈card).
        bestDeckNames = rows.map((r) => r.name);
      }
    }
    candidates.sort((a, b) => b.score - a.score);

    // Re-parse against the best candidate's card names so owner identification
    // can resolve "me". The deck-agnostic parse above (parseBattleLog with [])
    // could never overlap an empty deck list, so it early-returned before
    // result/opponent/prizes/myPokemon/opponentDeckGuess were populated — only
    // turns and playerCards survived (the hollow shape that shipped broken).
    // The deck rows are already loaded (bestDeckNames); this re-uses them, it
    // does NOT re-query. This also makes `confidence` meaningful: a clear-margin
    // name overlap → 'high'. playerName, when supplied, still overrides scoring
    // exactly as it does on the deck-agnostic parse, so this never makes a
    // populated parse worse. When no candidate scores, bestDeckNames stays null
    // and the deck-agnostic parse stands (see the response-contract comment
    // above for which fields are null in that case).
    const responseParsed = bestDeckNames
      ? parseBattleLog(body.log, bestDeckNames, playerName)
      : parsed;

    userCache(res);
    res.json({
      parsed: {
        result: responseParsed.result,
        opponent: responseParsed.players.opponent,
        turns: responseParsed.totalTurns,
        prizes: responseParsed.prizesTaken,
        confidence: responseParsed.confidence,
        myPokemon: responseParsed.myPokemon,
        opponentDeckGuess: responseParsed.opponentDeckGuess,
      },
      candidates: candidates.slice(0, 5),
    });
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
      `SELECT id, deck_version, raw_log, origin, result, opponent, opponent_deck, opponent_archetype,
              notes, review_md, parsed, source, played_at, created_at
         FROM battle_log WHERE id = $1 AND deck_id = $2`,
      [logId, deckId],
    );
    if (!row) throw notFound(`No battle log '${logId}'`);
    userCache(res);
    res.json({ log: shapeLogFull(row) });
  }),
);

// GET /decks/:id/logs/:logId/digest?playerName= — one STORED PTCG Live log read
// into a compact timeline (deck/battlelog.ts `digestBattleLog`): prizes by turn
// and what they paid for, first attacks, mulligans, the opponent's cards seen,
// how it ended, whether it was close, and what the log cannot tell. Read-only,
// and the same ownership gate as the detail route above: the deck must be the
// caller's (loadMeta) and the log must hang off that deck.
//
// WHY A ROUTE AND NOT THE STORED `parsed` (2026-10-10). The stored parse is
// frozen at insert time and was never asked for a timeline; this re-reads the
// immutable raw log on demand, so the digest improves for every past game the
// day the digest does, with no backfill.
//
// WHOSE SIDE. `?playerName=` wins; otherwise the owner the row was STORED with
// (`parsed.players.me`) — that is the identification the battle's result and
// record already rest on, made against the list the game was played with.
// Re-identifying against today's list could pick the other chair for a deck
// that has since changed. The current list is only the last resort, for a row
// stored without an owner.
decksRouter.get(
  '/:id/logs/:logId/digest',
  asyncHandler(async (req, res) => {
    const deckId = parseDeckId(String(req.params.id));
    const userId = currentUserId(req);
    const meta = await loadMeta(deckId, userId);
    if (!meta) throw notFound(`No deck '${deckId}'`);
    const logId = parseLogId(String(req.params.logId));
    const playerName = parseOptText(str(req.query.playerName), 100, 'playerName') ?? undefined;
    const row = await q1<Pick<LogRow, 'id' | 'deck_version' | 'raw_log' | 'origin' | 'result' | 'parsed'>>(
      `SELECT id, deck_version, raw_log, origin, result, parsed
         FROM battle_log WHERE id = $1 AND deck_id = $2`,
      [logId, deckId],
    );
    if (!row) throw notFound(`No battle log '${logId}'`);
    if (row.raw_log === null || !row.raw_log.trim()) {
      // 404, not 400: the request is well-formed and the THING asked for — a
      // game log — does not exist for this battle. Worded for the model that
      // will read it, which should fall back to the notes and review.
      throw notFound(
        row.origin === 'in_person'
          ? 'no game log to digest — this game was reported in person'
          : 'no game log to digest — this game was logged without one',
      );
    }
    const storedMe = (row.parsed as { players?: { me?: unknown } } | null)?.players?.me;
    const names = await q<{ name: string }>(
      `SELECT c.name FROM deck_card dc JOIN card c ON c.id = dc.card_id WHERE dc.deck_id = $1`,
      [deckId],
    );
    const digest = digestBattleLog(row.raw_log, names.map((r) => r.name), {
      playerName: playerName ?? (typeof storedMe === 'string' && storedMe ? storedMe : undefined),
    });
    userCache(res);
    res.json({
      logId: Number(row.id),
      deckVersion: row.deck_version,
      origin: row.origin,
      // The STORED result, which explicit corrections may have set; the
      // digest's own `result` is what the log text alone says.
      result: row.result,
      digest,
    });
  }),
);

// PATCH /decks/:id/logs/:logId { result?, opponent?, opponentDeck?, opponentArchetype?, notes?, reviewMd?, playedAt? }
// Metadata only — the raw log and its version attachment are immutable. Explicit
// null clears result/opponent/opponentDeck/opponentArchetype/notes/reviewMd.
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
    if (body.opponentArchetype !== undefined) push('opponent_archetype', parseOpponentArchetype(body.opponentArchetype));
    if (body.notes !== undefined) push('notes', parseNoteText(body.notes, LOG_NOTES_MAX, 'notes'));
    if (body.reviewMd !== undefined) push('review_md', parseNoteText(body.reviewMd, LOG_REVIEW_MAX, 'reviewMd'));
    if (body.playedAt !== undefined) {
      const at = parsePlayedAt(body.playedAt);
      if (at === null) throw badRequest('playedAt cannot be cleared');
      push('played_at', at);
    }
    if (!sets.length) throw badRequest('nothing to update');

    const row = await q1<LogRow>(
      `UPDATE battle_log SET ${sets.join(', ')} WHERE id = $1 AND deck_id = $2
       RETURNING id, deck_version, raw_log, origin, result, opponent, opponent_deck, opponent_archetype,
                 notes, review_md, parsed, source, played_at, created_at`,
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
