import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Ctx } from '../ctx.js';
import { fail, ok } from '../envelope.js';
import {
  describeCard,
  describeVariant,
  resolveCard,
  resolveVariant,
  type ResolvedCard,
  type ResolvedVariant,
} from '../resolve.js';

/**
 * `log_cards` — THE write tool (SPEC §5 #14). Batch-log collection changes:
 * each item resolves to one card variant and either increments its owned
 * quantity by a signed `delta` or sets it to an absolute `quantity`.
 *
 * All writes go through deckpal-api (SPEC §3 — write logic stays
 * single-sourced): delta → POST /collection/variants/:id/increment,
 * quantity → PATCH /collection/variants/:id, always with
 * `source: 'deckpal-mcp'` so `collection_log` attributes the change (migration
 * 018). Calls are strictly sequential — each mutation recomputes set progress
 * in its own transaction and parallel writes would contend on the same rows.
 *
 * Failure policy (SPEC §4/§5): ambiguity is returned, never guessed; an
 * unresolvable or invalid item is reported per-item and does NOT block the
 * rest of the batch. `dry_run` defaults to true and writes nothing.
 */

const SOURCE = 'deckpal-mcp';

const itemSchema = z.object({
  card_id: z
    .string()
    .optional()
    .describe("TCGdex card id, e.g. 'me05-84'. The most precise way to pick a card."),
  name: z
    .string()
    .optional()
    .describe('Card name (accent/case-insensitive). Used when card_id is omitted; add set_id and/or number to disambiguate.'),
  set_id: z.string().optional().describe("TCGdex set id to narrow a name match, e.g. 'me05'."),
  number: z.string().optional().describe("Card number within the set (local id), e.g. '84'."),
  variant_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Exact card_variant.id to target. Wins over variant_kind.'),
  variant_kind: z
    .string()
    .optional()
    .describe("Variant kind code, e.g. 'normal', 'holo', 'reverse'. Omitted → the card's primary variant."),
  delta: z
    .number()
    .int()
    .optional()
    .describe('Signed change to the owned quantity, e.g. 1 or -2. Floors at 0. Exactly one of delta or quantity per item.'),
  quantity: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Absolute owned quantity to set (>= 0). Exactly one of delta or quantity per item.'),
});

type Item = z.infer<typeof itemSchema>;

const inputSchema = z.object({
  items: z
    .array(itemSchema)
    .min(1)
    .max(100)
    .describe('1–100 changes to log. Each item picks one card (card_id, or name + set_id/number), optionally a variant, and exactly one of delta or quantity.'),
  note: z
    .string()
    .max(500)
    .optional()
    .describe("Optional free-text note stored on every event in this batch, e.g. 'pulls from 2 Prismatic packs'."),
  dry_run: z
    .boolean()
    .default(true)
    .describe('true (default): preview current → new per item, write NOTHING. Re-call with false to apply.'),
});

/** What each mutation endpoint returns (apps/api/src/routes/collection.ts MutationResult). */
interface GoalProgress {
  owned: number;
  total: number;
  pct: number;
}
interface MutationResult {
  variantId: number;
  quantity: number;
  delta: number;
  isFirstAcquisition: boolean;
  setId: string;
  progress: { complete: GoalProgress; master: GoalProgress; grandmaster: GoalProgress };
}

type ItemOutcome = 'applied' | 'would_apply' | 'failed' | 'skipped';

interface ItemResult {
  index: number;
  outcome: ItemOutcome;
  lines: string[];
  structured: Record<string, unknown>;
}

/** Short card label for result rows: name | tcgdex id (set #number is in describeCard for candidates). */
function cardLabel(c: ResolvedCard): string {
  return `${c.name} | ${c.tcgdexId}`;
}

function variantLabel(v: ResolvedVariant): string {
  return v.displayName ?? v.kindCode;
}

function progressLine(setId: string, p: MutationResult['progress']): string {
  const g = (label: string, gp: GoalProgress): string => `${label} ${gp.owned}/${gp.total} (${gp.pct}%)`;
  return `set ${setId}: ${g('complete', p.complete)} · ${g('master', p.master)} · ${g('grandmaster', p.grandmaster)}`;
}

/** Identify the item in error rows without echoing the whole object. */
function itemRef(item: Item): string {
  if (item.card_id) return `card_id '${item.card_id}'`;
  const parts = [item.name && `'${item.name}'`, item.set_id && `set ${item.set_id}`, item.number && `#${item.number}`];
  const named = parts.filter(Boolean).join(', ');
  return named || '(no card reference)';
}

async function processItem(ctx: Ctx, index: number, item: Item, note: string | undefined, dryRun: boolean): Promise<ItemResult> {
  const tag = `#${index + 1}`;
  const skip = (reason: string, extra: string[] = [], structured: Record<string, unknown> = {}): ItemResult => ({
    index,
    outcome: 'skipped',
    lines: [`${tag} ✗ ${itemRef(item)} — ${reason}`, ...extra.map((l) => `     ${l}`)],
    structured: { index, outcome: 'skipped', reason, ...structured },
  });

  // Exactly one of delta | quantity — a violation is a per-item error (SPEC §5 #14).
  const hasDelta = item.delta !== undefined;
  const hasQuantity = item.quantity !== undefined;
  if (hasDelta === hasQuantity) {
    return skip(
      hasDelta ? 'has BOTH delta and quantity — provide exactly one' : 'has NEITHER delta nor quantity — provide exactly one',
    );
  }
  if (hasDelta && item.delta === 0) return skip('delta must be non-zero (use quantity to assert the current count)');

  // Card resolution — ambiguity is returned with candidates, never guessed (SPEC §4).
  const cardRes = await resolveCard(ctx, item);
  if (cardRes.status === 'not_found') return skip(cardRes.message);
  if (cardRes.status === 'ambiguous') {
    return skip(
      `ambiguous — ${cardRes.total >= 9 ? '9+' : cardRes.total} cards match; pick one by card_id:`,
      cardRes.candidates.map(describeCard),
      { candidates: cardRes.candidates.map((c) => c.tcgdexId) },
    );
  }
  const card = cardRes.card;

  // Variant resolution: explicit id/kind wins; omitted → primary; absolute quantity
  // on a multi-variant-owned card with no explicit variant → refuse with the list.
  const variantRes = await resolveVariant(ctx, card.id, item, { forAbsoluteQuantity: hasQuantity });
  if (variantRes.status === 'not_found') return skip(`${cardLabel(card)} — ${variantRes.message}`);
  if (variantRes.status === 'ambiguous') {
    return skip(`${cardLabel(card)} — ${variantRes.message}`, variantRes.variants.map(describeVariant), {
      cardId: card.tcgdexId,
      variants: variantRes.variants.map((v) => v.id),
    });
  }
  const variant = variantRes.variant;
  const current = variant.ownedQty;

  if (dryRun) {
    // Mirror the API's clamp (floor 0, cap 100000) so the preview matches what
    // an execute call would actually do.
    const target = hasQuantity ? item.quantity! : current + item.delta!;
    const next = Math.max(0, Math.min(100_000, target));
    const effective = next - current;
    const floored = hasDelta && effective !== item.delta ? ' — floors at 0' : '';
    const deltaTxt = effective === 0 ? 'no change' : `Δ${effective > 0 ? '+' : ''}${effective}`;
    return {
      index,
      outcome: 'would_apply',
      lines: [`${tag} ${cardLabel(card)} | ${variantLabel(variant)} | ${current} → ${next} (${deltaTxt}${floored})`],
      structured: { index, outcome: 'would_apply', cardId: card.tcgdexId, variantId: variant.id, current, next },
    };
  }

  // Execute — the API response is the authoritative new state.
  try {
    const raw = hasDelta
      ? await ctx.api.send('POST', `/collection/variants/${variant.id}/increment`, { delta: item.delta, source: SOURCE, note })
      : await ctx.api.send('PATCH', `/collection/variants/${variant.id}`, { quantity: item.quantity, source: SOURCE, note });
    const res = raw as MutationResult;
    const oldQty = res.quantity - res.delta;
    const deltaTxt = res.delta === 0 ? 'no change' : `Δ${res.delta > 0 ? '+' : ''}${res.delta}`;
    return {
      index,
      outcome: 'applied',
      lines: [
        `${tag} ✓ ${cardLabel(card)} | ${variantLabel(variant)} | ${oldQty} → ${res.quantity} (${deltaTxt})`,
        `     ${progressLine(res.setId, res.progress)}`,
      ],
      structured: {
        index,
        outcome: 'applied',
        cardId: card.tcgdexId,
        variantId: res.variantId,
        oldQuantity: oldQty,
        newQuantity: res.quantity,
        delta: res.delta,
      },
    };
  } catch (err) {
    return {
      index,
      outcome: 'failed',
      lines: [`${tag} ✗ ${cardLabel(card)} | ${variantLabel(variant)} — API error: ${(err as Error).message}`],
      structured: { index, outcome: 'failed', cardId: card.tcgdexId, variantId: variant.id, error: (err as Error).message },
    };
  }
}

export function registerLoggingTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'log_cards',
    {
      title: 'Log collection changes',
      description:
        'Log card acquisitions/removals to the LOCAL DeckPal collection database — this edits ' +
        'only this app\'s collection tracker, nothing external (no store, no marketplace, no ' +
        'purchases). Batch of 1–100 items; each picks a card (card_id, or name + set_id/number), ' +
        'optionally a variant, and exactly one of delta (signed change, e.g. +1 pulled / -1 traded ' +
        'away) or quantity (absolute count). dry_run defaults to TRUE: the first call only ' +
        'previews current → new quantities; re-call with dry_run:false to actually write. ' +
        'Unresolvable or ambiguous items are reported individually and never guessed; the rest of ' +
        'the batch still processes. Do NOT use this to read history — use collection_log for ' +
        'that, and get_card to check current owned quantities.',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ items, note, dry_run }) => {
      try {
        // Strictly sequential — each write recomputes set progress in its own
        // transaction; parallel calls would contend on the same progress rows.
        const results: ItemResult[] = [];
        for (let i = 0; i < items.length; i++) {
          results.push(await processItem(ctx, i, items[i]!, note, dry_run));
        }

        const count = (o: ItemOutcome): number => results.filter((r) => r.outcome === o).length;
        const skipped = count('skipped');
        const lines: string[] = [];

        if (dry_run) {
          lines.push(`log_cards DRY RUN — ${items.length} item(s)`);
          for (const r of results) lines.push(...r.lines);
          lines.push(`would apply ${count('would_apply')}, skipped ${skipped} (unresolved/invalid)`);
          lines.push('dry run — nothing written; re-call with dry_run:false to apply');
        } else {
          lines.push(`log_cards — ${items.length} item(s)`);
          for (const r of results) lines.push(...r.lines);
          lines.push(`applied ${count('applied')}, failed ${count('failed')}, skipped ${skipped} (unresolved)`);
        }

        return ok(lines.join('\n'), {
          dryRun: dry_run,
          applied: count('applied'),
          wouldApply: count('would_apply'),
          failed: count('failed'),
          skipped,
          items: results.map((r) => r.structured),
        });
      } catch (err) {
        return fail(`log_cards failed: ${(err as Error).message}`);
      }
    },
  );
}
