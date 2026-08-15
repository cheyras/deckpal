import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from '../ctx.js';
import { fail, ok } from '../envelope.js';
import { row } from '../format.js';

/**
 * List tools — SPEC §5 #11–#13. Everything goes through deckpal-api
 * (apps/api/src/routes/lists.ts is the contract) via ctx.api; no SQL here.
 *
 * List items are keyed by numeric card_variant.id (dynamic/static) or dex_id
 * (pokedex_binder) — POST /lists/:id/items requires cardVariantId or dexId.
 * add_cards therefore accepts variant_id directly, OR a TCGdex card_id which
 * is resolved to the card's PRIMARY variant via GET /cards/:cardId (still the
 * API — no SQL), OR dex_id for binder lists.
 */

const KINDS = ['dynamic', 'static', 'pokedex_binder'] as const;

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
  // card items
  variantId?: number | null;
  variant?: { kind: string | null; displayName: string | null };
  setId?: string | null;
  number?: string | null;
  price?: { market: number | null; currency: string } | null;
  staticQuantity?: number | null;
  ownedQuantity?: number;
  note?: string | null;
  // species items
  dexId?: number;
  ownership?: { have: boolean };
}

interface ListDetail {
  list: ListSummary;
  items: ListItem[];
}

interface CardDetail {
  card: { cardId: string; name: string };
  variants: { variantId: number; kind: string; displayName: string; isPrimary: boolean }[];
}

const usd = (v: number | null | undefined): string => (v == null ? 'unpriced' : `$${v.toFixed(2)}`);

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
    `own x${it.ownedQuantity ?? 0}`,
    it.price ? usd(it.price.market) : 'unpriced',
    it.note ? `note: ${it.note}` : null,
    `item ${it.itemId}`,
  );
}

// ── edit_list operation planning ──────────────────────────────────────────────

interface AddSpec {
  card_id?: string;
  variant_id?: number;
  dex_id?: number;
  quantity?: number;
  note?: string;
}

type AddResolved =
  | { ok: true; label: string; body: Record<string, unknown> }
  | { ok: false; label: string; error: string };

/**
 * Resolve one add_cards entry to the exact POST /lists/:id/items body.
 * card_id → the card's PRIMARY variant via GET /cards/:cardId (API-side, read-only).
 */
async function resolveAdd(ctx: Ctx, spec: AddSpec, listKind: ListSummary['kind']): Promise<AddResolved> {
  const given = [spec.card_id, spec.variant_id, spec.dex_id].filter((x) => x !== undefined).length;
  const label = spec.card_id ?? (spec.variant_id != null ? `variant ${spec.variant_id}` : `dex #${spec.dex_id}`);
  if (given !== 1) return { ok: false, label: JSON.stringify(spec), error: 'pass exactly one of card_id, variant_id, dex_id' };

  if (spec.dex_id !== undefined) {
    if (listKind !== 'pokedex_binder') return { ok: false, label, error: `dex_id only works on a pokedex_binder list (this list is ${listKind})` };
    return { ok: true, label, body: { dexId: spec.dex_id, ...(spec.note ? { note: spec.note } : {}) } };
  }
  if (listKind === 'pokedex_binder') return { ok: false, label, error: 'a pokedex_binder list takes dex_id items, not cards' };

  let variantId = spec.variant_id;
  let display = label;
  if (variantId === undefined) {
    try {
      const detail = (await ctx.api.get(`/cards/${encodeURIComponent(spec.card_id!)}`)) as CardDetail;
      const primary = detail.variants.find((v) => v.isPrimary) ?? detail.variants[0];
      if (!primary) return { ok: false, label, error: 'card has no variants in the catalog' };
      variantId = primary.variantId;
      display = `${detail.card.name} (${spec.card_id}, ${primary.displayName} variant ${variantId})`;
    } catch (err) {
      return { ok: false, label, error: (err as Error).message };
    }
  }
  const body: Record<string, unknown> = { cardVariantId: variantId };
  if (listKind === 'static' && spec.quantity !== undefined) body.staticQuantity = spec.quantity;
  if (spec.note) body.note = spec.note;
  return { ok: true, label: display, body };
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerListTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'lists',
    {
      title: 'Browse card lists',
      description:
        'Read card lists (dynamic lists track collection ownership live; static lists are fixed bags ' +
        'with quantities; pokedex_binder lists track one slot per species). Without list_id: the list ' +
        'index with progress and value. With list_id: the list plus every item (item ids are needed to ' +
        'remove items via edit_list). Read-only — use edit_list to create/change, delete_list to delete.',
      inputSchema: z.object({
        list_id: z.string().optional().describe('List UUID from the index. Omit to list all lists.'),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ list_id }) => {
      try {
        if (!list_id) {
          const res = (await ctx.api.get('/lists')) as { lists: ListSummary[] };
          if (res.lists.length === 0) return ok('No lists yet. Create one with edit_list.');
          const lines = res.lists.map(summaryLine);
          lines.push(`${res.lists.length} list(s)`);
          return ok(lines.join('\n'));
        }
        const detail = (await ctx.api.get(`/lists/${encodeURIComponent(list_id)}`)) as ListDetail;
        const lines = [summaryLine(detail.list)];
        if (detail.items.length === 0) lines.push('(list is empty)');
        for (const it of detail.items) lines.push(`  ${itemLine(it, detail.list.kind)}`);
        return ok(lines.join('\n'));
      } catch (err) {
        return fail(`lists failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    'edit_list',
    {
      title: 'Create or edit a card list',
      description:
        'Create a list (omit list_id) or edit one (pass list_id): rename, add cards, remove items. ' +
        'add_cards entries take a TCGdex card_id (resolved to the card\'s primary variant), an explicit ' +
        'numeric variant_id, or a dex_id (pokedex_binder lists only). remove_item_ids are the item UUIDs ' +
        'shown by the lists tool. Defaults to a dry run that prints the exact operations without ' +
        'executing — re-run with dry_run: false to apply. Not for reading (use lists) or deleting the ' +
        'whole list (use delete_list). Lists never modify the collection itself.',
      inputSchema: z.object({
        list_id: z.string().optional().describe('List UUID to edit. Omit to create a new list.'),
        name: z
          .string()
          .max(120)
          .optional()
          .describe('List name — required when creating; renames when editing.'),
        kind: z
          .enum(KINDS)
          .default('dynamic')
          .describe("List kind when creating (default 'dynamic'). Ignored when editing — kind cannot change."),
        add_cards: z
          .array(
            z.object({
              card_id: z.string().optional().describe("TCGdex card id, e.g. 'sv01-25' — its primary variant is added."),
              variant_id: z.number().int().positive().optional().describe('Exact numeric card_variant id to add.'),
              dex_id: z.number().int().positive().optional().describe('Species dex number — pokedex_binder lists only.'),
              quantity: z.number().int().min(1).optional().describe('Copies for this row (static lists only; default 1).'),
              note: z.string().max(500).optional().describe('Optional note stored on the item (≤500 chars).'),
            }),
          )
          .optional()
          .describe('Items to ADD (existing items are kept). Each entry: exactly one of card_id / variant_id / dex_id.'),
        remove_item_ids: z
          .array(z.string())
          .optional()
          .describe('Item UUIDs to remove (from the lists tool output), not card ids.'),
        dry_run: z
          .boolean()
          .default(true)
          .describe('true (default): only print what would happen. false: execute.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ list_id, name, kind, add_cards, remove_item_ids, dry_run }) => {
      try {
        // Current state (edit) — also validates the id early.
        let current: ListDetail | null = null;
        if (list_id) {
          current = (await ctx.api.get(`/lists/${encodeURIComponent(list_id)}`)) as ListDetail;
        } else if (!name) {
          return fail('name is required to create a list.');
        }
        const listKind = current?.list.kind ?? kind;

        // Resolve adds up front (read-only API calls, safe in a dry run too).
        const adds: AddResolved[] = [];
        for (const spec of add_cards ?? []) adds.push(await resolveAdd(ctx, spec, listKind));

        // Plan.
        const plan: string[] = [];
        if (!current) plan.push(`create ${listKind} list '${name!}'`);
        else if (name !== undefined && name !== current.list.name) plan.push(`rename '${current.list.name}' → '${name}'`);
        for (const a of adds) plan.push(a.ok ? `add ${a.label}` : `add ${a.label} — UNRESOLVABLE: ${a.error}`);
        const knownItems = new Set((current?.items ?? []).map((i) => i.itemId));
        for (const id of remove_item_ids ?? []) {
          plan.push(`remove item ${id}${current && !knownItems.has(id) ? ' — NOT IN THIS LIST (will fail)' : ''}`);
        }
        if (plan.length === 0) return ok(`No changes — list '${current!.list.name}' already matches the requested state.`);

        if (dry_run) {
          return ok(
            ['DRY RUN — nothing executed. Would:', ...plan.map((p) => `  ${p}`), 'Re-run with dry_run: false to execute.'].join('\n'),
          );
        }

        // Execute — per-operation results, failures do not stop the rest.
        const lines: string[] = [];
        let failures = 0;
        let targetId = list_id;
        if (!current) {
          const created = (await ctx.api.send('POST', '/lists', { name, kind: listKind })) as { list: ListSummary };
          targetId = created.list.id;
          lines.push(`Created ${created.list.kind} list '${created.list.name}' — id ${targetId}`);
        } else if (name !== undefined && name !== current.list.name) {
          try {
            await ctx.api.send('PATCH', `/lists/${targetId}`, { name });
            lines.push(`  done: rename → '${name}'`);
          } catch (err) {
            failures++;
            lines.push(`  FAILED: rename — ${(err as Error).message}`);
          }
        }
        for (const a of adds) {
          if (!a.ok) {
            failures++;
            lines.push(`  FAILED: add ${a.label} — ${a.error}`);
            continue;
          }
          try {
            const res = (await ctx.api.send('POST', `/lists/${targetId}/items`, a.body)) as {
              itemId: string | null;
              alreadyPresent: boolean;
            };
            lines.push(res.alreadyPresent ? `  skipped: ${a.label} already in the list` : `  done: add ${a.label} (item ${res.itemId})`);
          } catch (err) {
            failures++;
            lines.push(`  FAILED: add ${a.label} — ${(err as Error).message}`);
          }
        }
        for (const id of remove_item_ids ?? []) {
          try {
            await ctx.api.send('DELETE', `/lists/${targetId}/items/${encodeURIComponent(id)}`);
            lines.push(`  done: remove item ${id}`);
          } catch (err) {
            failures++;
            lines.push(`  FAILED: remove item ${id} — ${(err as Error).message}`);
          }
        }

        const after = (await ctx.api.get(`/lists/${targetId}`)) as ListDetail;
        lines.push(
          `${failures ? `${failures} operation(s) FAILED — applied partially. ` : ''}List '${after.list.name}' now has ${after.list.itemCount} item(s).`,
        );
        return ok(lines.join('\n'));
      } catch (err) {
        return fail(`edit_list failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    'delete_list',
    {
      title: 'Delete a card list',
      description:
        'Permanently delete a list and its items (the collection is NOT touched — lists only reference ' +
        'cards). Defaults to a dry run that shows what would be deleted; re-run with dry_run: false to ' +
        'actually delete. To remove individual items keep the list and use edit_list.',
      inputSchema: z.object({
        list_id: z.string().describe('List UUID to delete (from the lists index).'),
        dry_run: z
          .boolean()
          .default(true)
          .describe('true (default): only report what would be deleted. false: delete.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ list_id, dry_run }) => {
      try {
        const detail = (await ctx.api.get(`/lists/${encodeURIComponent(list_id)}`)) as ListDetail;
        const what = `${detail.list.kind} list '${detail.list.name}' (${list_id}) — ${detail.list.itemCount} item(s)`;
        if (dry_run) {
          return ok(`DRY RUN — nothing deleted. Would delete ${what}.\nRe-run with dry_run: false to delete.`);
        }
        await ctx.api.send('DELETE', `/lists/${encodeURIComponent(list_id)}`);
        return ok(`Deleted ${what}.`);
      } catch (err) {
        return fail(`delete_list failed: ${(err as Error).message}`);
      }
    },
  );
}
