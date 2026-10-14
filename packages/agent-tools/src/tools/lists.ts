import { z } from 'zod';
import type { Ctx } from '../ctx.js';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { meansCreate, needList, presentRef } from '../entities.js';
import { forTools, pagingFooter, row, undoHint, usd } from '../format.js';
import { describeCard, describeVariant, pickVariant, resolveCardsBatch, variantsOfMany, type CardRef } from '../resolve.js';
import { FINISHES, GOALS, errText } from '../shared.js';
import { q, q1 } from '../db.js';
import { cardFilters, SEARCH_CTES } from './catalog.js';

/**
 * List tools — SPEC §5 #11–#13. Everything goes through deckpal-api
 * (apps/api/src/routes/lists.ts is the contract) via ctx.api.
 *
 * ## What changed (2026-08-19)
 *
 * `add_cards` used to take a `card_id` (which silently meant "the primary
 * variant") or an exact numeric `variant_id`, and nothing in between —
 * while `log_cards`, the sibling write tool, had accepted
 * name + set_id + number + variant_kind all along. So an agent that had just
 * been handed a perfectly good missing-cards list by `set_progress` — name,
 * number, variant kind, price, all of it — still had to call `get_card` once
 * per card to turn that into variant ids. Roughly ninety calls to add
 * eighty-seven cards the app had already identified.
 *
 * Two things fix that:
 *
 *  • `add_cards` now takes the same card reference shape as `log_cards`, and
 *    resolves the whole batch in two queries rather than one call per card.
 *  • `add_missing` derives the list server-side: "everything missing for this
 *    goal in this set, minus these rarities" is one call, because that is the
 *    single most common list an agent is asked to build.
 *
 * The rarity filter matters on its own. `tier` ('standard'/'special') is NOT
 * rarity: an Illustration Rare and a Special Illustration Rare are both
 * tier 'standard', which is why filtering by tier could not express "no special
 * illustrations" and reading `rarity` per card was the only way.
 *
 * Deletion is now reversible (migration 038) — see delete_list.
 */

const KINDS = ['dynamic', 'static', 'pokedex_binder'] as const;
const SOURCE = 'deckpal-mcp';
/** Items per page when reading one list. */
const ITEMS_PAGE = 100;

// ── API response shapes (only what we render) ─────────────────────────────────

interface ListSummary {
  id: string;
  kind: (typeof KINDS)[number];
  name: string;
  itemCount: number;
  progress: { owned: number; total: number; pct: number; copies: number } | null;
  marketValueUsd: number | null;
  updatedAt: string;
}

interface ListItem {
  itemId: string;
  position: number;
  kind: 'card' | 'species';
  cardId: string;
  name: string | null;
  variantId?: number | null;
  variant?: { kind: string | null; displayName: string | null };
  setId?: string | null;
  number?: string | null;
  rarity?: string | null;
  price?: { market: number | null; currency: string } | null;
  staticQuantity?: number | null;
  ownedQuantity?: number;
  note?: string | null;
  dexId?: number;
  ownership?: { have: boolean };
}

interface ListDetail {
  list: ListSummary;
  items: ListItem[];
}

function summaryLine(l: ListSummary): string {
  return row(
    l.name,
    l.id,
    l.kind,
    `${l.itemCount} item(s)`,
    l.progress ? `owned ${l.progress.owned}/${l.progress.total} (${l.progress.pct}%)` : null,
    l.marketValueUsd != null ? `value ${usd(l.marketValueUsd)}` : null,
  );
}

function itemLine(it: ListItem, listKind: ListSummary['kind']): string {
  if (it.kind === 'species') {
    return row(`#${it.dexId} ${it.name ?? '?'}`, it.ownership?.have ? 'captured' : 'not captured', `item ${it.itemId}`);
  }
  const qty = listKind === 'static' ? `x${it.staticQuantity ?? 1} ` : '';
  return row(
    `${qty}${it.name ?? '?'}`,
    it.cardId,
    it.variant?.displayName ?? it.variant?.kind ?? null,
    it.rarity ?? null,
    `own x${it.ownedQuantity ?? 0}`,
    it.price ? usd(it.price.market) : 'unpriced',
    it.note ? `note: ${it.note}` : null,
    `item ${it.itemId}`,
  );
}

// ── add_cards resolution ──────────────────────────────────────────────────────

const addCardSchema = z.object({
  card_id: z.string().optional().describe("TCGdex card id, e.g. 'me05-003'."),
  name: z.string().optional().describe('Card name (accent/case-insensitive). Add set_id and/or number to disambiguate.'),
  set_id: z.string().optional().describe("TCGdex set id to narrow a name match, e.g. 'me05'."),
  number: z.string().optional().describe("Card number within the set, e.g. '003'."),
  variant_id: z.number().int().positive().optional().describe('Exact numeric card_variant id. Wins over variant_kind.'),
  variant_kind: z
    .string()
    .optional()
    .describe("Which printing, e.g. 'normal', 'holo', 'reverse'. Omitted → the card's primary variant."),
  dex_id: z.number().int().positive().optional().describe('Species dex number — pokedex_binder lists only.'),
  quantity: z.number().int().min(1).optional().describe('Copies for this row (static lists only; default 1).'),
  note: z.string().max(500).optional().describe('Optional note stored on the item (≤500 chars).'),
});

type AddCard = z.infer<typeof addCardSchema>;

interface ResolvedAdd {
  ok: true;
  label: string;
  cardId?: string;
  body: Record<string, unknown>;
}
interface FailedAdd {
  ok: false;
  label: string;
  error: string;
  detail?: string[];
}

/**
 * Resolve every `add_cards` entry at once — the same two-query path `log_cards`
 * uses, with the same fall-through to per-item resolution for anything
 * ambiguous, so candidate lists still come back instead of a guess.
 */
async function resolveAdds(
  ctx: Ctx,
  specs: readonly AddCard[],
  listKind: ListSummary['kind'],
): Promise<Array<ResolvedAdd | FailedAdd>> {
  const out: Array<ResolvedAdd | FailedAdd | null> = specs.map(() => null);

  const needCard: number[] = [];
  specs.forEach((s, i) => {
    const given = [s.card_id ?? s.name, s.variant_id, s.dex_id].filter((x) => x !== undefined).length;
    const label = s.card_id ?? s.name ?? (s.variant_id != null ? `variant ${s.variant_id}` : `dex #${s.dex_id}`);
    if (given !== 1) {
      out[i] = { ok: false, label: JSON.stringify(s), error: 'pass exactly one of card_id/name, variant_id, or dex_id' };
      return;
    }
    if (s.dex_id !== undefined) {
      if (listKind !== 'pokedex_binder') {
        out[i] = { ok: false, label, error: `dex_id only works on a pokedex_binder list (this list is ${listKind})` };
        return;
      }
      out[i] = { ok: true, label, body: { dexId: s.dex_id, ...(s.note ? { note: s.note } : {}) } };
      return;
    }
    if (listKind === 'pokedex_binder') {
      out[i] = { ok: false, label, error: 'a pokedex_binder list takes dex_id items, not cards' };
      return;
    }
    if (s.variant_id !== undefined) {
      const body: Record<string, unknown> = { cardVariantId: s.variant_id };
      if (listKind === 'static' && s.quantity !== undefined) body.staticQuantity = s.quantity;
      if (s.note) body.note = s.note;
      out[i] = { ok: true, label, body };
      return;
    }
    needCard.push(i);
  });

  if (needCard.length > 0) {
    const refs: CardRef[] = needCard.map((i) => {
      const s = specs[i]!;
      return { card_id: s.card_id, name: s.name, set_id: s.set_id, number: s.number };
    });
    const { resolved, fallback } = await resolveCardsBatch(ctx, refs);
    const cardIds: number[] = [];
    needCard.forEach((_i, pos) => {
      const c = resolved.get(pos);
      if (c) cardIds.push(c.id);
    });
    const variantsByCard = await variantsOfMany(ctx, cardIds);

    needCard.forEach((inputIdx, pos) => {
      const s = specs[inputIdx]!;
      const label = s.card_id ?? s.name!;
      const card = resolved.get(pos);
      if (!card) {
        const res = fallback.get(pos);
        if (res?.status === 'ambiguous') {
          out[inputIdx] = {
            ok: false,
            label,
            error: `ambiguous — ${res.total >= 9 ? '9+' : res.total} cards match; pick one by card_id`,
            detail: res.candidates.map(describeCard),
          };
        } else {
          out[inputIdx] = { ok: false, label, error: res?.status === 'not_found' ? res.message : 'could not be resolved' };
        }
        return;
      }
      const all = variantsByCard.get(card.id) ?? [];
      const vres = pickVariant(all, s);
      if (vres.status !== 'ok') {
        out[inputIdx] = {
          ok: false,
          label: `${card.name} (${card.tcgdexId})`,
          error: vres.message,
          detail: vres.status === 'ambiguous' ? vres.variants.map(describeVariant) : undefined,
        };
        return;
      }
      const body: Record<string, unknown> = { cardVariantId: vres.variant.id };
      if (listKind === 'static' && s.quantity !== undefined) body.staticQuantity = s.quantity;
      if (s.note) body.note = s.note;
      out[inputIdx] = {
        ok: true,
        label: `${card.name} (${card.tcgdexId}, ${vres.variant.displayName ?? vres.variant.kindCode})`,
        cardId: card.tcgdexId,
        body,
      };
    });
  }

  return out.map((x) => x ?? { ok: false as const, label: '?', error: 'unresolved' });
}

// ── add_search: a whole search, one call ──────────────────────────────────────
//
// THE JOB THAT NEEDED IT (the owner's Haiku test, 2026-10-13): "make a list of my holo Pikachus".
// search_cards showed one page and no finishes, so the model checked about 150 cards one get_card
// call at a time, hit the 60-a-minute limit, added the normal printing of 44 cards that have a holo
// one, missed 19, and said "7 left". The search it needed already existed; adding its results did
// not. add_search runs the SAME filters as search_cards (cardFilters), every page, and picks each
// card's printing by finish in one query.

/** The most cards one add_search may add: the bulk endpoint's limit. */
const SEARCH_ADD_MAX = 500;

const addSearchSchema = z.object({
  query: z.string().optional(),
  set_id: z.string().optional(),
  category: z.enum(['Pokemon', 'Trainer', 'Energy']).optional(),
  rarity: z.string().optional(),
  standard_legal: z.boolean().optional(),
  tag: z.enum(['Tera', 'Ancient', 'Future']).optional(),
  owned_only: z.boolean().optional(),
  exclude_owned: z.boolean().optional(),
  min_value_usd: z.number().min(0).optional(),
  finish: z
    .array(z.enum(FINISHES))
    .min(1)
    .optional()
    .describe("Only cards printed in one of these, each added in the first it has: ['holo','reverse'] = holo, else reverse."),
  // STRICT: a filter it does not take (search_cards' `text`, `damage`) is an error, never dropped —
  // dropped, it widened the write to every card the other filters match (Astra, #345).
}).strict();
type AddSearch = z.infer<typeof addSearchSchema>;

interface SearchAdd {
  variantId: number;
  label: string;
  finish: string;
}

/** "12 card(s) the search finds (…): 9 holo, 3 reverse; 4 already in the list, skipped", finishes in the order asked. */
function searchSummary(adds: readonly SearchAdd[], filters: string, skipped: number, asked: readonly string[] = []): string {
  const byFinish = new Map<string, number>(asked.map((f) => [f, 0]));
  for (const a of adds) byFinish.set(a.finish, (byFinish.get(a.finish) ?? 0) + 1);
  for (const [f, count] of byFinish) if (count === 0) byFinish.delete(f);
  return (
    `${adds.length} card(s) the search finds (${filters})` +
    (byFinish.size ? `: ${[...byFinish].map(([f, n]) => `${n} ${f}`).join(', ')}` : '') +
    (skipped ? `; ${skipped} already in the list, skipped` : '')
  );
}

/**
 * Every card the search matches, with the printing to add: with `finish`, the first finish in the
 * order given that the card is printed in; without it, the card's primary printing. Within a
 * finish, the plainest printing (primary, then standard tier, then catalog order) — a holo, not
 * its stamped or cosmos-foil cousin. Cards whose tcgdex id is in `skip` are left out.
 */
async function searchForList(
  ctx: Ctx,
  args: AddSearch,
  skip: ReadonlySet<string>,
): Promise<{ ok: false; message: string } | { ok: true; adds: SearchAdd[]; matched: number; skipped: number; filters: string; setNote: string | null }> {
  const shared = await cardFilters(ctx, args);
  if (!shared.ok) return shared;
  if (shared.filters.length === 0) {
    return { ok: false, message: 'add_search needs at least one filter (query, set_id, rarity, finish…): it will not add the whole catalog.' };
  }
  const ps: unknown[] = [ctx.userId];
  const p = (v: unknown): string => {
    ps.push(v);
    return `$${ps.length}`;
  };
  const where = [`c.lang = 'en'`, ...shared.filters.map((f) => f.sql(p))].join(' AND ');
  const from = `FROM browsable_card c
       JOIN card_set cs ON cs.id = c.set_id
       LEFT JOIN owned o ON o.card_id = c.id
       LEFT JOIN best b ON b.card_id = c.id`;
  const skipIds = [...skip];
  const skipParam = p(skipIds);
  // Cards already in the list are left out IN the query, so the cap below counts only what would be
  // added; `count(*) OVER ()` is taken before the LIMIT, so an over-limit search says how big it was
  // instead of quietly adding the first 500.
  const wanted = await q<{ id: string; tcgdex_id: string; name: string; total: string }>(
    ctx.db,
    `${SEARCH_CTES}
     SELECT c.id, c.tcgdex_id, c.name, count(*) OVER () AS total
       ${from}
      WHERE ${where} AND NOT (c.tcgdex_id = ANY(${skipParam}::text[]))
      ORDER BY c.released_on NULLS LAST, cs.tcgdex_id, c.number_sort
      LIMIT ${SEARCH_ADD_MAX + 1}`,
    ps,
  );
  const skipped = skipIds.length
    ? Number((await q1<{ n: string }>(ctx.db, `${SEARCH_CTES} SELECT count(*) AS n ${from} WHERE ${where} AND c.tcgdex_id = ANY(${skipParam}::text[])`, ps))?.n ?? 0)
    : 0;
  const toAdd = Number(wanted[0]?.total ?? 0);
  const matched = toAdd + skipped;
  const filters = shared.filters.map((f) => f.label).join(' AND ');
  if (toAdd > SEARCH_ADD_MAX) {
    return {
      ok: false,
      message:
        `add_search would add ${toAdd} cards (${filters}${skipped ? `; ${skipped} more already in the list` : ''}); ` +
        `one call adds at most ${SEARCH_ADD_MAX}. Narrow it (set_id, rarity, finish, category) and add it in parts.`,
    };
  }
  const variants = wanted.length
    ? await q<{ card_id: string; id: string; finish: string; display_name: string | null; kind: string }>(
        ctx.db,
        `SELECT cv.card_id, cv.id, vk.finish, cv.display_name, cv.variant_kind_code AS kind
           FROM card_variant cv
           JOIN variant_kind vk ON vk.code = cv.variant_kind_code
           LEFT JOIN variant_tier_resolved vtr ON vtr.card_variant_id = cv.id
          WHERE cv.card_id = ANY($1::bigint[])
          ORDER BY cv.card_id, cv.is_primary DESC, (vtr.tier = 'standard') DESC NULLS LAST, vk.sort_hint, cv.sort_order`,
        [wanted.map((c) => Number(c.id))],
      )
    : [];
  const byCard = new Map<string, typeof variants>();
  for (const v of variants) byCard.set(String(v.card_id), [...(byCard.get(String(v.card_id)) ?? []), v]);
  const order = args.finish?.length ? [...new Set(args.finish)] : null;
  const adds: SearchAdd[] = [];
  for (const c of wanted) {
    const vs = byCard.get(String(c.id)) ?? [];
    const pick = order ? order.map((f) => vs.find((v) => v.finish === f)).find(Boolean) : vs[0];
    if (!pick) continue; // a card with no printing in the catalog: nothing to add
    adds.push({ variantId: Number(pick.id), label: `${c.name} (${c.tcgdex_id}, ${pick.display_name ?? pick.kind})`, finish: pick.finish });
  }
  return { ok: true, adds, matched, skipped, filters, setNote: shared.setNote };
}

// ── Tool registration ─────────────────────────────────────────────────────────

const listsTool = defineTool({
  name: 'lists',
  title: 'Browse card lists',
  description:
    'Read card lists (dynamic lists track collection ownership live; static lists are fixed bags ' +
    'with quantities; pokedex_binder lists track one slot per species). Without list_id: the list ' +
    'index with progress and value. With list_id: the list plus its items, 100 a page (item ids are needed to ' +
    'remove items via edit_list). Pass deleted:true for the recycle bin — lists that were deleted ' +
    'but can still be restored. Read-only — use edit_list to create/change, delete_list to delete.',
  inputSchema: z.object({
    list_id: z.string().optional().describe('One list, by UUID or by NAME. Omit to list them all with their ids.'),
    deleted: z
      .boolean()
      .default(false)
      .describe('true → show DELETED lists (the recycle bin) instead of live ones. Restore one with edit_list(restore:true).'),
    page: z.number().int().min(1).default(1).describe('With list_id: page of items, 1-based.'),
    // Cap 200, like every other page_size: 500 of these rows would be about
    // 55,000 characters, past what the audit allows any single read.
    page_size: z.number().int().min(1).max(200).default(100).describe('With list_id: items per page (default 100, cap 200).'),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async ({ list_id, deleted, page = 1, page_size = ITEMS_PAGE }, ctx) => {
    try {
      const ref = presentRef(list_id);
      if (!ref) {
        const res = (await ctx.api.get(`/lists${deleted ? '?deleted=true' : ''}`)) as { lists: ListSummary[] };
        if (res.lists.length === 0) {
          return ok(deleted ? 'Nothing in the recycle bin — no deleted lists.' : 'No lists yet. Create one with edit_list.');
        }
        const lines = res.lists.map(summaryLine);
        lines.push(
          deleted
            ? `${res.lists.length} deleted list(s) — restore one with edit_list(list_id, restore: true)`
            : `${res.lists.length} list(s)`,
        );
        return ok(lines.join('\n'));
      }
      // Loose: a read. A wrong hit costs one sentence, and the candidate list
      // makes the next call exact. `lists` also answered `No list '55d8fabb-…'`
      // in the record for an id that was a DECK's — `needList` says so now.
      const picked = await needList(ctx, ref);
      if (!picked.ok) return fail(picked.message);
      const detail = (await ctx.api.get(`/lists/${encodeURIComponent(picked.value.id)}`)) as ListDetail;
      const lines = [summaryLine(detail.list)];
      if (detail.items.length === 0) lines.push('(list is empty)');
      // PAGED. This returned every item, and a list has no upper bound: a
      // 300-card static list measured 32,789 characters and a master-set list
      // 42,228 (~10.5k tokens), before a smart list or a 1,025-slot Pokédex
      // binder. The API still sends them all; only what the model reads is cut.
      const from = (page - 1) * page_size;
      for (const it of detail.items.slice(from, from + page_size)) lines.push(`  ${itemLine(it, detail.list.kind)}`);
      if (detail.items.length > 0) lines.push(pagingFooter(page, page_size, detail.items.length));
      if (picked.note) lines.push(picked.note);
      return ok(lines.join('\n'));
    } catch (err) {
      return fail(`lists failed: ${errText(err)}`);
    }
  },
});

const editListTool = defineTool({
  name: 'edit_list',
  title: 'Create or edit a card list',
  description:
    'Create a list (omit list_id) or edit one (pass list_id): rename, add cards, remove items, ' +
    'or restore a deleted list. add_cards takes the same card reference as log_cards — a ' +
    "TCGdex card_id, or name + set_id/number, plus an optional variant_kind ('reverse', " +
    "'holo', …) — so you do NOT need to look up variant ids first. add_missing does the whole " +
    'job server-side: "everything missing for this goal in this set, optionally minus certain ' +
    'rarities or above a price" in one call; add_search adds every card a search matches (all pages), by finish. ' +
    'remove_item_ids are the item UUIDs shown by the ' +
    'lists tool. Renaming changes the name only, not what a list holds — to change contents use ' +
    'add_cards, add_missing, add_search or remove_item_ids. kind (static or dynamic) is set at create and cannot ' +
    'be changed by edit: a dynamic list tracks ownership live but does NOT re-filter by its name, so ' +
    'a list called "under $5" holds whatever was added, not every card under $5. ' +
    'Defaults to a dry run that prints the exact operations without executing — ' +
    're-run with dry_run:false to apply. Lists never modify the collection itself.',
  inputSchema: z.object({
    // ── SAY WHICH, RATHER THAN LEAVING IT TO BE INFERRED ────────────────────
    //
    // THE REPORTED BUG: asked to make a NEW list, it appended to an existing
    // one instead. Both outcomes were reachable from the same call shape, and
    // which one happened depended on whether an id happened to resolve — so a
    // list that merely shared a name with the one being asked for silently
    // became the target, and the reader's existing list gained cards they
    // never asked to put in it.
    //
    // The two mistakes are NOT symmetrical, which is what decides the default:
    //   creating when they meant edit  → a spare list. Annoying, deletable.
    //   editing when they meant create → someone's existing list is mutated.
    // So an ambiguous call creates, and only an explicit, resolvable target
    // edits.
    mode: z
      .enum(['create', 'edit'])
      .optional()
      .describe(
        "'create' makes a NEW list and never touches an existing one, even if a list of the " +
          "same name is already there. 'edit' changes the list named by list_id and never " +
          'creates. Say which — if you leave it out it is inferred from list_id, and an ' +
          'inference is how an existing list gets written to by accident.',
      ),
    list_id: z
      .string()
      .optional()
      .describe(
        'The list to EDIT, by UUID or by its exact name. Leave it out to create a new one. ' +
          "Ignored entirely when mode is 'create'.",
      ),
    name: z.string().max(120).optional().describe('List name — required when creating; renames when editing.'),
    kind: z
      .enum(KINDS)
      .default('dynamic')
      .describe("List kind when creating (default 'dynamic'). Ignored when editing — kind cannot change."),
    add_cards: z
      .array(addCardSchema)
      .max(500)
      .optional()
      .describe('Cards to ADD (existing items are kept). Each entry: exactly one of card_id/name, variant_id, or dex_id.'),
    add_missing: z
      .object({
        set_id: z.string().describe("TCGdex set id, e.g. 'me05'."),
        goal: z
          .enum(GOALS)
          .default('complete')
          .describe('complete = one of any variant per card, master = every standard-tier variant, grandmaster = every variant.'),
        finishes: z.array(z.enum(FINISHES)).optional().describe('Only these finishes (master/grandmaster).'),
        rarity: z.array(z.string()).optional().describe("ONLY these rarities, e.g. ['Illustration rare']. Case-insensitive."),
        rarity_exclude: z
          .array(z.string())
          .optional()
          .describe(
            "Leave these rarities OUT, e.g. ['Special illustration rare']. Rarity is NOT the same as variant tier — " +
              "an Illustration Rare and a Special Illustration Rare are both tier 'standard'.",
          ),
        max_price_usd: z.number().min(0).optional().describe('Only cards whose cheapest USD market price is at or below this.'),
        priced_only: z.boolean().optional().describe('Drop cards with no USD price at all.'),
      })
      .optional()
      .describe('Add everything still missing from a set, filtered. Resolved server-side in one call.'),
    add_search: addSearchSchema
      .optional()
      .describe("Add EVERY card a search_cards search with these filters matches (all pages, up to 500); each card's main printing unless finish. Cards already in the list are skipped."),
    remove_item_ids: z.array(z.string()).optional().describe('Item UUIDs to remove (from the lists tool output), not card ids.'),
    restore: z.boolean().default(false).describe('true → restore this deleted list (see lists(deleted:true)).'),
    dry_run: z.boolean().default(true).describe('true (default): only print what would happen. false: execute.'),
  }),
  // overwriteHint: remove_item_ids and renames (each revertible from mutation_history).
  annotations: { readOnlyHint: false, destructiveHint: false, overwriteHint: true, idempotentHint: false },
  handler: async ({ mode, list_id, name, kind, add_cards, add_missing, add_search, remove_item_ids, restore, dry_run }, ctx) => {
    try {
      // STRICT: this adds to, removes from and renames a list. A fuzzy hit
      // would edit a list that merely sounded like the one they meant.
      let resolvedId: string | null = null;
      // ── "new" MEANS CREATE, BECAUSE MODELS FILL FIELDS RATHER THAN OMIT ──
      //
      // Creating is documented as "omit list_id", and omitting is the one thing
      // a model reliably will not do. Measured: asked to make a list, he sent
      // `list_id: 'new'`, was told no list matches it, and then sent the NAME OF
      // THE LIST HE WAS ASKING US TO CREATE — which cannot exist yet. The turn
      // died with no answer. See `meansCreate`.
      //
      // ── AND `mode` OVERRIDES BOTH ────────────────────────────────────────
      //
      // `mode: 'create'` discards the id entirely. That is the fix for the
      // reported bug: "make a new list called X" while a list called X already
      // exists must not become "append to X". A restore is always an edit —
      // there is nothing to create.
      const wantsCreate = !restore && (mode === 'create' || (mode !== 'edit' && meansCreate(list_id)));
      const givenList = wantsCreate ? undefined : presentRef(list_id);
      if (mode === 'edit' && !givenList) {
        return fail(
          "mode 'edit' needs list_id — which list? Call `lists` to see them with their ids, " +
            "or use mode 'create' with a name to make a new one.",
        );
      }
      if (givenList) {
        // `deleted: restore` — a list being RESTORED is in the recycle bin, and
        // the live index excludes it. Without this the restore route documented
        // in `delete_list`'s own success message could never resolve.
        const picked = await needList(ctx, givenList, { strict: true, deleted: restore });
        if (!picked.ok) {
          // ── AND IF IT STILL DOES NOT RESOLVE, SAY HOW TO CREATE ───────────
          //
          // Deliberately NOT "create it for them". This is a write, and writes
          // in this package do not act on a guess — an unresolvable id plus a
          // name could equally be a typo against an existing list. But the
          // failure must carry its own recovery, which is the rule the
          // `sv3pt5` loop was written into this codebase to enforce: one extra
          // call with the right shape beats a dead end.
          const how = name
            ? ` To CREATE a new list called '${name}' instead, call edit_list again with NO list_id at all.`
            : ' To CREATE a new list, call edit_list with no list_id and a name.';
          return fail(picked.message + how);
        }
        resolvedId = picked.value.id;
      }

      if (restore) {
        if (!resolvedId) return fail('restore needs list_id.');
        if (dry_run) {
          return ok(`DRY RUN — would restore deleted list ${resolvedId}.\nRe-run with dry_run: false to restore.`);
        }
        const r = (await ctx.api.send('POST', `/lists/${encodeURIComponent(resolvedId)}/restore`, { source: SOURCE })) as {
          list: ListSummary;
        };
        return ok(`Restored ${summaryLine(r.list)}`);
      }

      let current: ListDetail | null = null;
      /** Creating one that shares a name with a list they already have. */
      let nameCollision = false;
      if (resolvedId) {
        current = (await ctx.api.get(`/lists/${encodeURIComponent(resolvedId)}`)) as ListDetail;
      } else if (!name) {
        return fail('name is required to create a list.');
      } else {
        // ── IS THERE ALREADY ONE OF THESE? ─────────────────────────────────
        //
        // Not to block it — they asked for a new list and they get one — but so
        // the approval card can SAY it. "Make a list called X" when X exists is
        // exactly the moment the old behaviour quietly appended instead, and a
        // reader who can see the collision can stop it.
        //
        // One extra read, only on the create path.
        try {
          const all = (await ctx.api.get('/lists')) as { lists: ListSummary[] };
          const want = name.trim().toLowerCase();
          nameCollision = (all.lists ?? []).some((l) => l.name.trim().toLowerCase() === want);
        } catch {
          // A warning we could not compute is not a reason to fail the write.
        }
      }
      const listKind = current?.list.kind ?? kind;

      // Resolve adds up front (read-only, safe in a dry run too).
      const adds = add_cards?.length ? await resolveAdds(ctx, add_cards, listKind) : [];

      // add_search: the whole search, resolved here (read-only). Cards already in the list are
      // skipped, except items this same call removes: "swap my normal printings for holos" is a
      // remove plus an add_search, and the removed cards must come back in the new finish.
      let searched: Extract<Awaited<ReturnType<typeof searchForList>>, { ok: true }> | null = null;
      if (add_search) {
        if (listKind === 'pokedex_binder') return fail('add_search adds cards; a pokedex_binder list takes dex_id items (add_cards).');
        const removing = new Set(remove_item_ids ?? []);
        const listed = new Set(
          (current?.items ?? []).filter((i) => i.kind === 'card' && !removing.has(i.itemId)).map((i) => i.cardId),
        );
        const s = await searchForList(ctx, add_search, listed);
        if (!s.ok) return fail(s.message);
        searched = s;
      }

      // ── AN ITEM REMOVED AND ADDED BACK AS THE SAME PRINTING IS KEPT ──────
      //
      // Adds run before removals. A dynamic list's bulk add skips a printing the list already holds,
      // so "remove this item, add the search" where the search chose that SAME printing (no holo,
      // so its reverse) skipped the add and then the removal deleted the card, reported as done
      // (Astra, #345). Such an item is now kept and both halves dropped. On a static list only
      // add_search's re-adds are: they are one copy, and keeping the item keeps its quantity,
      // while remove plus add_cards is how a static quantity is changed.
      const itemsById = new Map((current?.items ?? []).map((i) => [i.itemId, i]));
      const searchVariants = new Set((searched?.adds ?? []).map((a) => a.variantId));
      const cardVariants = new Set(
        adds.filter((a): a is ResolvedAdd => a.ok && a.body.cardVariantId !== undefined).map((a) => Number(a.body.cardVariantId)),
      );
      const keptVariants = new Set<number>();
      const keptItems: string[] = [];
      const removals = (remove_item_ids ?? []).filter((id) => {
        const it = itemsById.get(id);
        const v = it?.kind === 'card' && it.variantId != null ? Number(it.variantId) : null;
        if (v !== null && (searchVariants.has(v) || (listKind === 'dynamic' && cardVariants.has(v)))) {
          keptItems.push(id);
          keptVariants.add(v);
          return false;
        }
        return true;
      });
      if (searched && keptVariants.size) {
        searched = { ...searched, adds: searched.adds.filter((a) => !keptVariants.has(a.variantId)) };
      }
      const cardAdds = listKind === 'dynamic'
        ? adds.filter((a) => !(a.ok && keptVariants.has(Number(a.body.cardVariantId))))
        : adds;

      // add_missing is resolved by the API — ask it for the preview so the
      // dry run reports exactly what the execute call will add.
      let missingPreview: { wouldAdd: number; items: Array<{ label: string }> } | null = null;
      if (add_missing) {
        if (!resolvedId) {
          return fail('add_missing needs an existing list_id — create the list first, then add to it.');
        }
        missingPreview = (await ctx.api.send('POST', `/lists/${encodeURIComponent(resolvedId)}/items/bulk`, {
          addMissing: {
            setId: add_missing.set_id,
            goal: add_missing.goal,
            finishes: add_missing.finishes,
            rarity: add_missing.rarity,
            rarityExclude: add_missing.rarity_exclude,
            maxPriceUsd: add_missing.max_price_usd,
            pricedOnly: add_missing.priced_only,
          },
          dryRun: true,
          source: SOURCE,
        })) as { wouldAdd: number; items: Array<{ label: string }> };
      }

      // ── ONE LIMIT OVER EVERY ADD, CHECKED BEFORE ANYTHING IS WRITTEN ─────
      //
      // add_cards, add_search and add_missing go out as ONE bulk request, which the API refuses
      // over its limit. Counting only two of them let a 500-card add_missing plus one search card
      // through this check, and the refused write was followed by the removals it was meant to
      // replace (Astra, #345).
      const totalAdds = cardAdds.filter((a) => a.ok).length + (searched?.adds.length ?? 0) + (missingPreview?.wouldAdd ?? 0);
      if (totalAdds > SEARCH_ADD_MAX) {
        return fail(
          `That is ${totalAdds} cards in one call (add_cards, add_search and add_missing together); one call adds at most ` +
            `${SEARCH_ADD_MAX}. Split it.`,
        );
      }

      // ── Plan ─────────────────────────────────────────────────────────────
      const plan: string[] = [];
      // ── THE TARGET IS ALWAYS THE FIRST LINE ──────────────────────────────
      //
      // It used to be named only when CREATING. So an append read as
      //
      //     Would:  add Blastoise ex   add Tatsugiri   add Sinistcha ex
      //
      // with nothing anywhere saying which list was about to receive them —
      // and the reader approved it. That is how cards ended up appended to an
      // existing list when a new one was asked for: the dialog could not have
      // shown the difference, because the difference was never written down.
      //
      // Now the first line always says which it is, by name, so "create" and
      // "add to the list you already had" cannot look alike on the card.
      if (!current) {
        plan.push(`CREATE a new ${listKind} list called '${name!}'`);
        // A name collision is the reader's call, not ours: they asked for a new
        // list, so they get one — but they are told, on the dialog, before they
        // agree to it.
        if (nameCollision) {
          plan.push(
            `  (heads up: you already have a list called '${name!}' — this makes a SECOND one, it does not add to that one)`,
          );
        }
      } else {
        plan.push(`ADD TO your existing list '${current.list.name}' (${current.items.length} item(s) already in it)`);
        if (name !== undefined && name !== current.list.name) plan.push(`rename '${current.list.name}' → '${name}'`);
      }
      for (const a of cardAdds) {
        const qty = a.ok && listKind === 'static' && typeof a.body.staticQuantity === 'number'
          ? a.body.staticQuantity
          : 1;
        plan.push(a.ok
          ? a.cardId ? `add ${a.label} — card: add x${qty} ${a.cardId}` : `add ${a.label}`
          : `add ${a.label} — UNRESOLVABLE: ${a.error}`);
        if (!a.ok && a.detail) for (const d of a.detail) plan.push(`     ${d}`);
      }
      if (searched) {
        plan.push(`add ${searchSummary(searched.adds, searched.filters, searched.skipped, add_search?.finish)}`);
        for (const a of searched.adds.slice(0, 15)) plan.push(`     ${a.label}`);
        if (searched.adds.length > 15) plan.push(`     …and ${searched.adds.length - 15} more`);
        if (searched.setNote) plan.push(`     (${searched.setNote})`);
      }
      if (missingPreview) {
        plan.push(`add ${missingPreview.wouldAdd} missing card(s) from ${add_missing!.set_id} (goal ${add_missing!.goal})`);
        for (const it of missingPreview.items.slice(0, 15)) plan.push(`     ${it.label}`);
        if (missingPreview.items.length > 15) plan.push(`     …and ${missingPreview.items.length - 15} more`);
      }
      const knownItems = new Set((current?.items ?? []).map((i) => i.itemId));
      for (const id of keptItems) {
        const item = itemsById.get(id);
        plan.push(`keep item ${id} (${item?.name ?? item?.cardId ?? '?'}): it would be added back as the same printing`);
      }
      for (const id of removals) {
        const item = current?.items.find((i) => i.itemId === id);
        if (item?.kind === 'card') {
          plan.push(`remove item ${id}`);
          plan.push(`     card: remove x${listKind === 'static' ? item.staticQuantity ?? 1 : 1} ${item.cardId} — ${item.name ?? item.cardId}`);
        } else {
          plan.push(`remove item ${id}${current && !knownItems.has(id) ? ' — NOT IN THIS LIST (will fail)' : ''}`);
        }
      }
      if (plan.length === 0) return ok(`No changes — list '${current!.list.name}' already matches the requested state.`);

      if (dry_run) {
        return ok(
          ['DRY RUN — nothing executed. Would:', ...plan.map((p) => `  ${p}`), 'Re-run with dry_run: false to execute.'].join('\n'),
        );
      }

      // ── Execute ──────────────────────────────────────────────────────────
      const lines: string[] = [];
      let failures = 0;
      let targetId = resolvedId;
      if (!current) {
        const created = (await ctx.api.send('POST', '/lists', { name, kind: listKind, source: SOURCE })) as {
          list: ListSummary;
        };
        targetId = created.list.id;
        lines.push(`Created ${created.list.kind} list '${created.list.name}' ${forTools(`list_id "${targetId}"`)}`);
      }
      if (targetId === null) {
        // Unreachable: `current` only exists when `resolvedId` resolved to it, and
        // the branch above assigns a freshly created id. Narrowed rather than
        // asserted, because the alternative was interpolating the STRING 'null'
        // into every path below — which `/lists/${targetId}` silently did.
        throw new Error('no list to act on — neither resolved nor created');
      }
      if (current && name !== undefined && name !== current.list.name) {
        try {
          await ctx.api.send('PATCH', `/lists/${encodeURIComponent(targetId)}`, { name, source: SOURCE });
          lines.push(`  done: rename → '${name}'`);
        } catch (err) {
          failures++;
          lines.push(`  FAILED: rename — ${errText(err)}`);
        }
      }

      // Adds go through the bulk endpoint: one transaction, one round trip,
      // whatever the count. Unresolvable entries never leave this process.
      const resolvedAdds = cardAdds.filter((a): a is ResolvedAdd => a.ok);
      for (const a of cardAdds) {
        if (!a.ok) {
          failures++;
          lines.push(`  FAILED: add ${a.label} — ${a.error}`);
        }
      }
      const searchItems = (searched?.adds ?? []).map((a) => ({ cardVariantId: a.variantId, quantity: 1 }));
      let addFailed = false;
      if (resolvedAdds.length > 0 || add_missing || searchItems.length > 0) {
        try {
          const res = (await ctx.api.send('POST', `/lists/${encodeURIComponent(targetId)}/items/bulk`, {
            items: [
              ...resolvedAdds.map((a) => ({
                cardVariantId: a.body.cardVariantId,
                dexId: a.body.dexId,
                quantity: a.body.staticQuantity ?? 1,
                note: a.body.note,
              })),
              ...searchItems,
            ],
            ...(add_missing
              ? {
                  addMissing: {
                    setId: add_missing.set_id,
                    goal: add_missing.goal,
                    finishes: add_missing.finishes,
                    rarity: add_missing.rarity,
                    rarityExclude: add_missing.rarity_exclude,
                    maxPriceUsd: add_missing.max_price_usd,
                    pricedOnly: add_missing.priced_only,
                  },
                }
              : {}),
            source: SOURCE,
          })) as { added: number; alreadyPresent: number; unresolved: string[]; batchId: string };
          lines.push(
            `  done: added ${res.added}` +
              (res.alreadyPresent ? `, ${res.alreadyPresent} already in the list` : '') +
              (res.unresolved.length ? `, ${res.unresolved.length} unresolved` : ''),
          );
          if (res.batchId) lines.push(`  ${undoHint(res.batchId)}`);
        } catch (err) {
          failures++;
          addFailed = true;
          lines.push(`  FAILED: bulk add — ${errText(err)}`);
        }
      }
      // Always, written or not: "nothing new to add, 12 already in the list" is an answer too.
      if (searched) lines.push(`  from the search: ${searchSummary(searched.adds, searched.filters, searched.skipped, add_search?.finish)}`);

      for (const id of keptItems) lines.push(`  kept item ${id}: already that printing`);
      // A removal in the same call as an add is usually the other half of a swap: if the add
      // failed, taking the old items out would leave neither. Nothing is removed; say so.
      if (addFailed && removals.length) {
        lines.push(`  NOT DONE: ${removals.length} removal(s), because the add failed — nothing was taken out of the list`);
      }
      for (const id of addFailed ? [] : removals) {
        try {
          // `source` attributes the removal in mutation_history; without it the
          // route recorded the agent's removals as made in the web UI.
          await ctx.api.send('DELETE', `/lists/${encodeURIComponent(targetId)}/items/${encodeURIComponent(id)}`, { source: SOURCE });
          lines.push(`  done: remove item ${id}`);
        } catch (err) {
          failures++;
          lines.push(`  FAILED: remove item ${id} — ${errText(err)}`);
        }
      }

      const after = (await ctx.api.get(`/lists/${encodeURIComponent(targetId)}`)) as ListDetail;
      lines.push(
        `${failures ? `${failures} operation(s) FAILED — applied partially. ` : ''}List '${after.list.name}' now has ${after.list.itemCount} item(s).`,
      );
      return ok(lines.join('\n'), { listId: targetId, itemCount: after.list.itemCount, failures });
    } catch (err) {
      return fail(`edit_list failed: ${errText(err)}`);
    }
  },
});

const deleteListTool = defineTool({
  name: 'delete_list',
  title: 'Delete a card list',
  description:
    'Delete a list. By default this is REVERSIBLE: the list disappears from every view but is ' +
    'kept and can be restored with edit_list(list_id, restore:true), or found again with ' +
    'lists(deleted:true). The collection itself is never touched — lists only reference cards. ' +
    'Defaults to a dry run; re-run with dry_run:false to delete. purge:true is the exception: ' +
    'it destroys the list and its items for good, with no undo, and should only be used when ' +
    'the user has said they want it gone permanently. To remove individual items keep the ' +
    'list and use edit_list.',
  inputSchema: z.object({
    // EXACT ONLY. With `purge` this destroys a list and its items with no undo,
    // so an approximate name comes back as a choice rather than as an action.
    list_id: z.string().describe('The list to delete, by UUID or by its exact name.'),
    purge: z
      .boolean()
      .default(false)
      .describe('true → destroy it permanently instead of moving it to the recycle bin. NO UNDO.'),
    dry_run: z.boolean().default(true).describe('true (default): only report what would be deleted. false: delete.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  handler: async ({ list_id, purge, dry_run }, ctx) => {
    try {
      // STRICT: destructive, and `purge` has no undo.
      const picked = await needList(ctx, list_id, { strict: true });
      if (!picked.ok) return fail(picked.message);
      const listId = picked.value.id;

      const detail = (await ctx.api.get(`/lists/${encodeURIComponent(listId)}`)) as ListDetail;
      const what = `${detail.list.kind} list '${detail.list.name}' (${listId}) — ${detail.list.itemCount} item(s)`;
      if (dry_run) {
        return ok(
          purge
            ? `DRY RUN — nothing deleted. Would PERMANENTLY destroy ${what}. This cannot be undone.\nRe-run with dry_run: false to purge.`
            : `DRY RUN — nothing deleted. Would delete ${what} (restorable afterwards).\nRe-run with dry_run: false to delete.`,
        );
      }
      const r = (await ctx.api.send(
        'DELETE',
        `/lists/${encodeURIComponent(listId)}${purge ? '?purge=true' : ''}`,
        { source: SOURCE },
      )) as { restorable: boolean; batchId?: string };
      return ok(
        r.restorable
          ? `Deleted ${what}. It is in the recycle bin and can be restored ` +
              forTools(`edit_list list_id "${listId}", restore true, dry_run false${r.batchId ? `; or revert batch_id "${r.batchId}"` : ''}`) +
              '.'
          : `PURGED ${what}. This is gone for good.`,
      );
    } catch (err) {
      return fail(`delete_list failed: ${errText(err)}`);
    }
  },
});

export const listTools: ToolDefinition[] = [
  listsTool,
  editListTool,
  deleteListTool,
];
