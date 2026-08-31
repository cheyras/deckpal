import { Router } from 'express';
import type pg from 'pg';
import { isDeckeEntitled } from '../decke/entitlement.js';
import { cardImages, q, q1, SUPABASE_MODE, withTx } from '../db.js';
import { asyncHandler, badRequest, notFound, userCache } from '../http.js';
import { currentUserId } from '../identity.js';
import { familyContext } from '../family/access.js';

/**
 * GET /me — the caller's own account identity. Currently just `username`
 * (issue #25: the profile page and header chip hardcoded "Trainer").
 *
 * Reads `app_user.username` rather than the JWT's `user_metadata.username`:
 * the signup form (routes/Auth.tsx) never sets that metadata key, so most
 * real accounts have it empty. `app_user.username` is always populated —
 * self-host seeds it once (migration 013), and cloud's `handle_new_user`
 * trigger (migration 021) falls back to the email's local part when no
 * metadata username was supplied — so the DB column is the one place the
 * value is guaranteed to exist.
 */
export const meRouter: Router = Router();

interface UsernameRow {
  username: string;
}

/**
 * Is this account the deployment's owner?
 *
 * Cloud: only the account named by DESIGN_EDITOR_USER_ID (a Supabase auth
 * UUID, set in the Vercel env) — unset means NOBODY, so an owner-only surface
 * can never open up by accident, only fail closed. Self-host: always, because
 * a self-host deployment has exactly one user (the owner) and sits behind the
 * owner's own auth proxy.
 *
 * This lives here, server-side, so the owner's identity is verified against
 * the JWT and never baked into the public JS bundle. A client-side check would
 * be a suggestion, not a gate.
 *
 * The env var keeps its original name because it is already set in production
 * and renaming it would silently close both surfaces on the next deploy. What
 * it means is "the owner"; `designEditor` was simply the first thing that
 * needed one.
 */
function isOwner(userId: string): boolean {
  if (!SUPABASE_MODE) return true;
  const owner = process.env.DESIGN_EDITOR_USER_ID;
  return !!owner && userId === owner;
}

/**
 * Whether an owner is configured at all — NOT who it is.
 *
 * Exported so `/health` can report it and boot can warn about it. "Unset means
 * nobody" is the right default, but it used to be a SILENT default: `/design`
 * shipped gated on this variable on 2026-08-14, the variable was never set in
 * Vercel, and nothing anywhere said so. It was found four days later only
 * because `/dev/decke` reused the same gate and someone went looking. See
 * AGENTS.md B11.
 */
export function ownerGateStatus(): 'configured' | 'unset' | 'self-host' {
  if (!SUPABASE_MODE) return 'self-host';
  return process.env.DESIGN_EDITOR_USER_ID ? 'configured' : 'unset';
}

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    userCache(res);
    const userId = currentUserId(req);
    const row = await q1<UsernameRow>('SELECT username FROM app_user WHERE id = $1', [userId]);
    if (!row) throw notFound('No such user');
    const owner = isOwner(userId);
    // `designEditor` is retained for the existing /design gate. `owner` is the
    // same answer under the name that actually describes it, and is what new
    // owner-only surfaces should use.
    res.json({
      username: row.username,
      userId,
      designEditor: owner,
      owner,
      decke: isDeckeEntitled(userId),
      family: await familyContext(userId),
    });
  }),
);

// ══════════════════════════════════════════════════════════════════════════════
// /me/settings — the account's preferences (migration 049)
// ══════════════════════════════════════════════════════════════════════════════
//
// `user_settings` has existed since migration 005 with a row per account, but
// only `default_goal` was ever read, and five UI preferences grew up in
// localStorage instead — so hiding Deck-E on a laptop left him on the phone,
// and the setting's own caption had to admit it ("remembered on this device
// only"). These endpoints make the account the source of truth; the client
// keeps localStorage only as an offline cache (lib/settingsSync.ts).

// `http.js`'s oneOf() FALLS BACK on an unknown value, which is right for a
// query param and wrong here: a settings write with a typo must be a 400, not
// a silent reset to the default.
function strictOneOf<T extends string>(field: string, v: unknown, allowed: readonly T[]): T {
  const s = typeof v === 'string' ? (v.toLowerCase() as T) : undefined;
  if (s !== undefined && allowed.includes(s)) return s;
  throw badRequest(`${field} must be one of: ${allowed.join('|')}`);
}

const GOAL_VALUES = ['complete', 'master', 'grandmaster'] as const;
const POCKET_SIZES = [4, 9, 12, 16] as const;
const AV_VALUES = ['hide', 'inline', 'end'] as const;
const SKIN_VALUES = ['premium', 'classic'] as const;
const TOPBAR_VALUES = ['cover', 'flat'] as const;
const SERIES_SORT_KEYS = ['recency', 'az', 'pct'] as const;
const SORT_DIRS = ['asc', 'desc'] as const;

interface SettingsRow {
  default_goal: string;
  display_currency: string;
  pricing_enabled: boolean;
  show_collection_value: boolean;
  binder_pocket_size: number;
  binder_stack_variants: boolean;
  binder_additional_variants: string;
  decke_hidden: boolean;
  skin: string | null;
  topbar: string | null;
  series_sort_key: string;
  series_sort_dir: string;
  series_group_owned: boolean;
}

const SETTINGS_COLS = `default_goal, display_currency, pricing_enabled, show_collection_value,
       binder_pocket_size, binder_stack_variants, binder_additional_variants,
       decke_hidden, skin, topbar, series_sort_key, series_sort_dir, series_group_owned`;

function shapeSettings(r: SettingsRow) {
  return {
    defaultGoal: r.default_goal,
    displayCurrency: r.display_currency.trim(),
    pricingEnabled: r.pricing_enabled,
    showCollectionValue: r.show_collection_value,
    binderPocketSize: r.binder_pocket_size,
    binderStackVariants: r.binder_stack_variants,
    binderAdditionalVariants: r.binder_additional_variants,
    deckeHidden: r.decke_hidden,
    skin: r.skin,
    topbar: r.topbar,
    seriesSortKey: r.series_sort_key,
    seriesSortDir: r.series_sort_dir,
    seriesGroupOwned: r.series_group_owned,
  };
}

async function settingsRow(userId: string): Promise<SettingsRow> {
  // Cloud accounts get their row from the signup trigger; self-host from the
  // seed. The upsert covers the one gap (an account created before either),
  // so GET can never 404 on a real user.
  const row = await q1<SettingsRow>(`SELECT ${SETTINGS_COLS} FROM user_settings WHERE user_id = $1`, [userId]);
  if (row) return row;
  await q(`INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
  const created = await q1<SettingsRow>(`SELECT ${SETTINGS_COLS} FROM user_settings WHERE user_id = $1`, [userId]);
  if (!created) throw notFound('No such user');
  return created;
}

meRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    userCache(res);
    const userId = currentUserId(req);
    res.json({ settings: shapeSettings(await settingsRow(userId)) });
  }),
);

meRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = req.body ?? {};
    const sets: string[] = [];
    const params: unknown[] = [userId];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (body.defaultGoal !== undefined) push('default_goal', strictOneOf('defaultGoal', body.defaultGoal, GOAL_VALUES));
    if (body.pricingEnabled !== undefined) push('pricing_enabled', Boolean(body.pricingEnabled));
    if (body.showCollectionValue !== undefined) push('show_collection_value', Boolean(body.showCollectionValue));
    if (body.binderStackVariants !== undefined) push('binder_stack_variants', Boolean(body.binderStackVariants));
    if (body.binderAdditionalVariants !== undefined) {
      push('binder_additional_variants', strictOneOf('binderAdditionalVariants', body.binderAdditionalVariants, AV_VALUES));
    }
    if (body.binderPocketSize !== undefined) {
      const ps = Number(body.binderPocketSize);
      if (!(POCKET_SIZES as readonly number[]).includes(ps)) throw badRequest('binderPocketSize must be 4|9|12|16');
      push('binder_pocket_size', ps);
    }
    if (body.displayCurrency !== undefined) {
      const cur = String(body.displayCurrency).trim().toUpperCase();
      // FK to currency(code); check here so a typo is a 400, not a pg error.
      const known = await q1(`SELECT 1 FROM currency WHERE code = $1`, [cur]);
      if (!known) throw badRequest(`unknown currency '${cur}'`);
      push('display_currency', cur);
    }
    if (body.deckeHidden !== undefined) push('decke_hidden', Boolean(body.deckeHidden));
    // skin/topbar accept null: "no explicit choice — follow the app default".
    if (body.skin !== undefined) push('skin', body.skin === null ? null : strictOneOf('skin', body.skin, SKIN_VALUES));
    if (body.topbar !== undefined) push('topbar', body.topbar === null ? null : strictOneOf('topbar', body.topbar, TOPBAR_VALUES));
    if (body.seriesSortKey !== undefined) push('series_sort_key', strictOneOf('seriesSortKey', body.seriesSortKey, SERIES_SORT_KEYS));
    if (body.seriesSortDir !== undefined) push('series_sort_dir', strictOneOf('seriesSortDir', body.seriesSortDir, SORT_DIRS));
    if (body.seriesGroupOwned !== undefined) push('series_group_owned', Boolean(body.seriesGroupOwned));

    if (!sets.length) throw badRequest('nothing to update — no known settings field in the body');

    // Ensure the row exists first (same gap the GET covers), then update it.
    await settingsRow(userId);
    const updated = await q1<SettingsRow>(
      `UPDATE user_settings SET ${sets.join(', ')} WHERE user_id = $1 RETURNING ${SETTINGS_COLS}`,
      params,
    );
    if (!updated) throw notFound('No such user');
    userCache(res);
    res.json({ settings: shapeSettings(updated) });
  }),
);

// ══════════════════════════════════════════════════════════════════════════════
// /me/showcase — the profile's featured cards (user_showcase, migration 005)
// ══════════════════════════════════════════════════════════════════════════════
//
// The table has existed since 005 — 8 slots, RLS'd in 021 — and the profile
// page never used it: the showcase lived in `deckpal.showcase.v1` in
// localStorage, so a profile curated on one device was empty on the next.
// These endpoints put the existing table to work. The client speaks card ids;
// the table stores a variant id, so PUT resolves each card to its primary
// variant the same way the list add does.

const SHOWCASE_MAX = 8;

interface ShowcaseRow {
  slot: number;
  card_id: string;
  name: string;
  serie: string;
  setcode: string;
  local_id: string;
}

async function showcaseRows(userId: string) {
  const rows = await q<ShowcaseRow>(
    `SELECT us.slot, c.tcgdex_id AS card_id, c.name,
            ser.tcgdex_id AS serie, cs.tcgdex_id AS setcode, c.local_id
       FROM user_showcase us
       JOIN card_variant cv ON cv.id = us.card_variant_id
       JOIN card c ON c.id = cv.card_id
       JOIN card_set cs ON cs.id = c.set_id
       JOIN series ser ON ser.id = cs.series_id
      WHERE us.user_id = $1
      ORDER BY us.slot`,
    [userId],
  );
  return rows.map((r) => ({
    slot: r.slot,
    cardId: r.card_id,
    name: r.name,
    images: cardImages(r.serie, r.setcode, r.local_id),
  }));
}

meRouter.get(
  '/showcase',
  asyncHandler(async (req, res) => {
    userCache(res);
    res.json({ showcase: await showcaseRows(currentUserId(req)) });
  }),
);

meRouter.put(
  '/showcase',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const body = req.body ?? {};
    if (!Array.isArray(body.cards) || body.cards.length > SHOWCASE_MAX) {
      throw badRequest(`cards must be an array of up to ${SHOWCASE_MAX} card ids (null for an empty slot)`);
    }
    const cards: (string | null)[] = body.cards.map((c: unknown) => {
      if (c === null) return null;
      if (typeof c !== 'string' || !c.trim()) throw badRequest('each cards entry must be a card id string or null');
      return c.trim();
    });

    // Resolve every named card to its primary variant in one query.
    const wanted = cards.filter((c): c is string => c !== null);
    const found = wanted.length
      ? await q<{ tcgdex_id: string; variant_id: string }>(
          `SELECT DISTINCT ON (c.tcgdex_id) c.tcgdex_id, cv.id AS variant_id
             FROM card c JOIN card_variant cv ON cv.card_id = c.id
            WHERE c.tcgdex_id = ANY($1::text[]) AND c.lang = 'en'
            ORDER BY c.tcgdex_id, cv.is_primary DESC, cv.sort_order`,
          [wanted],
        )
      : [];
    const byCard = new Map(found.map((r) => [r.tcgdex_id, Number(r.variant_id)]));
    const missing = wanted.filter((c) => !byCard.has(c));
    if (missing.length) throw notFound(`No card '${missing[0]}'`);

    // Replace-all in one transaction: the showcase is one small ordered thing,
    // and slot-by-slot patching would invite gaps and races for no benefit.
    await withTx(async (client: pg.PoolClient) => {
      await client.query(`DELETE FROM user_showcase WHERE user_id = $1`, [userId]);
      const vals: string[] = [];
      const params: unknown[] = [userId];
      cards.forEach((c, i) => {
        if (c === null) return;
        params.push(i + 1, byCard.get(c));
        vals.push(`($1, $${params.length - 1}, $${params.length})`);
      });
      if (vals.length) {
        await client.query(`INSERT INTO user_showcase (user_id, slot, card_variant_id) VALUES ${vals.join(', ')}`, params);
      }
    });

    userCache(res);
    res.json({ showcase: await showcaseRows(userId) });
  }),
);
