import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';

/**
 * `set_cart` — TCGplayer Mass Entry deep links, built from a set, a saved list,
 * or an explicit set of cards.
 *
 * ## Why it takes three kinds of input
 *
 * It used to take only `set_id` + `goal`, which meant it always recomputed
 * "what is missing from this whole set at this goal" from scratch. An agent
 * that had carefully built a FILTERED list — say, everything missing except the
 * Special Illustration Rares — had no way to cart it: this tool re-derived from
 * the set and put the excluded cards straight back in. The user was told one
 * thing was in the cart and something else was. That was a structural hole
 * (the list and the cart had no shared source of truth), not a mistake anybody
 * made, so `list_id` and `items` close it.
 *
 * ## Why the links work now
 *
 * Mass Entry matched on TCGplayer's *product name*, and a product name is only
 * unique inside a set when the card name is. Every modern set reprints base
 * card names as Illustration / Special Illustration / hyper rares, so a large
 * fraction of name lines resolved to nothing — and Mass Entry is
 * ALL-OR-NOTHING, so one bad line meant an empty cart. Measured on Pitch Black:
 * the old format added 0 of 40 cards.
 *
 * Lines are now `<qty>-<productId>`, which names the TCGplayer product
 * directly. Same 40 cards: 40 of 40. Cards with no TCGplayer product id are
 * reported as unlinkable instead of being guessed at, because a guess that
 * misses would take the whole cart down with it.
 */

const GOALS = ['complete', 'master', 'grandmaster'] as const;
const FINISHES = ['normal', 'reverse', 'holo', 'lenticular', 'metal'] as const;

interface CartResponse {
  source: 'set' | 'list' | 'items';
  set?: { setId: string; name: string };
  list?: { id: string; name: string; kind: string };
  goal?: string;
  finishes: string[] | null;
  rarity?: string[] | null;
  rarityExclude?: string[] | null;
  needed: { cards: number; items: number; unlinkable: number; exactLines: number; bestEffortLines: number };
  lines: string[];
  text: string;
  urls: string[];
  exactUrls: string[];
  bestEffortUrls: string[];
  unlinkable: Array<{ name: string; number: string; setId?: string; variant: string | null }>;
  unresolved?: string[];
  warnings: string[];
  note: string;
}

function render(r: CartResponse): string[] {
  const what =
    r.source === 'set'
      ? `${r.set!.name} (${r.set!.setId}) — cards still needed for goal '${r.goal}'`
      : r.source === 'list'
        ? `List "${r.list!.name}" (${r.list!.kind})`
        : `${r.needed.items} card(s) you named`;
  const filters = [
    r.finishes ? `finishes: ${r.finishes.join(', ')}` : null,
    r.rarity?.length ? `rarity: ${r.rarity.join(', ')}` : null,
    r.rarityExclude?.length ? `excluding: ${r.rarityExclude.join(', ')}` : null,
  ].filter(Boolean);

  const lines: string[] = [`${what}${filters.length ? ` (${filters.join('; ')})` : ''} — TCGplayer cart`];

  if (r.needed.items === 0 && r.needed.unlinkable === 0) {
    // "Nothing to buy" and "none of what you asked for exists" are different
    // answers, and only one of them is good news.
    if (r.unresolved?.length) {
      lines.push(`None of the ${r.unresolved.length} card(s) you named could be found in the catalog:`);
      for (const u of r.unresolved.slice(0, 10)) lines.push(`  ${u}`);
      if (r.unresolved.length > 10) lines.push(`  …and ${r.unresolved.length - 10} more`);
      return lines;
    }
    lines.push(r.source === 'set' ? 'Nothing needed — this goal is already finished.' : 'Nothing to buy.');
    return lines;
  }

  lines.push(`${r.needed.items} card(s) across ${r.needed.cards} Mass Entry line(s)`);
  if (r.exactUrls.length > 0) {
    lines.push(
      r.exactUrls.length > 1
        ? `open ALL ${r.exactUrls.length} links in the logged-in browser (each adds to the same cart):`
        : 'open in the logged-in browser:',
    );
    r.exactUrls.forEach((u, i) => lines.push(`  ${r.exactUrls.length > 1 ? `part ${i + 1}: ` : ''}${u}`));
  }
  if (r.bestEffortUrls.length > 0) {
    lines.push('best-effort link(s) — these use a name rather than a product id and may not resolve, kept separate so a miss cannot void the cart above:');
    r.bestEffortUrls.forEach((u) => lines.push(`  ${u}`));
  }
  if (r.unlinkable.length > 0) {
    lines.push(`not sold on TCGplayer as singles (${r.unlinkable.length}) — buy elsewhere:`);
    for (const u of r.unlinkable.slice(0, 25)) {
      lines.push(`  ${u.name} #${u.number}${u.variant ? ` (${u.variant})` : ''}`);
    }
    if (r.unlinkable.length > 25) lines.push(`  …and ${r.unlinkable.length - 25} more`);
  }
  for (const w of r.warnings) lines.push(`warning: ${w}`);
  lines.push(r.note);
  if (r.text) {
    lines.push('Mass Entry text fallback (paste at tcgplayer.com/massentry):');
    lines.push(r.text);
  }
  return lines;
}

const setCartTool = defineTool({
  name: 'set_cart',
  title: 'Build a TCGplayer cart',
  description:
    'Build TCGplayer Mass Entry deep link(s) that pre-fill a shopping cart, from ONE of: a ' +
    'set (everything still needed for a goal), a saved list (list_id), or an explicit set of ' +
    'cards (items). Use list_id when you have already built and filtered a list — that way ' +
    'the cart contains exactly what the list contains, instead of being re-derived from the ' +
    'set. This tool only BUILDS links — it does not purchase anything, does not touch ' +
    'TCGplayer, and cannot add to a cart by itself: the user must open the link(s) in their ' +
    'own logged-in browser (a long list is split across several links; opening each adds to ' +
    'the same cart). Printing and condition cannot be preselected by link — they are chosen ' +
    "on TCGplayer's Mass Entry page. For what is missing and its cost use set_progress; for " +
    'buying deck gaps use decks with include=[pricing].',
  inputSchema: z.object({
    set_id: z.string().optional().describe("TCGdex set id, e.g. 'me05'. Carts what you still need from that set."),
    list_id: z.string().optional().describe('List UUID (from the lists tool). Carts that list\'s own contents — nothing re-derived.'),
    items: z
      .array(
        z.object({
          variant_id: z.number().int().positive().optional().describe('Exact card_variant id — the most precise choice.'),
          card_id: z.string().optional().describe("TCGdex card id, e.g. 'me05-003'. Resolves to its cheapest printing."),
          quantity: z.number().int().min(1).max(100).default(1).describe('Copies to buy (default 1).'),
        }),
      )
      .max(500)
      .optional()
      .describe('An explicit set of cards to cart, when you have not saved them as a list. Each needs variant_id or card_id.'),
    goal: z
      .enum(GOALS)
      .optional()
      .describe(
        "set_id only. What 'needed' means: complete = one of any variant per card (default), " +
          'master = every standard-tier variant, grandmaster = every variant.',
      ),
    finishes: z
      .array(z.enum(FINISHES))
      .optional()
      .describe('set_id only. Restrict to these finishes (master/grandmaster; ignored for complete).'),
    rarity: z
      .array(z.string())
      .optional()
      .describe("set_id only. ONLY these rarities, e.g. ['Illustration rare']. Case-insensitive, exact names."),
    rarity_exclude: z
      .array(z.string())
      .optional()
      .describe(
        "set_id only. Leave these rarities OUT, e.g. ['Special illustration rare']. Note that variant tier " +
          "('standard'/'special') is NOT rarity — an Illustration Rare and a Special Illustration Rare are both " +
          "tier 'standard', so use this rather than a tier filter.",
      ),
    missing_only: z
      .boolean()
      .default(false)
      .describe('list_id only. true → cart only the list rows you do not already own.'),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async (args, ctx) => {
    try {
      const given = [args.set_id, args.list_id, args.items].filter((x) => x !== undefined);
      if (given.length === 0) return fail('Pass one of set_id, list_id, or items.');
      if (given.length > 1) return fail('Pass exactly ONE of set_id, list_id, or items — they are three different sources.');

      let r: CartResponse;
      if (args.set_id) {
        const params = new URLSearchParams({ goal: args.goal ?? 'complete' });
        for (const f of args.finishes ?? []) params.append('finish', f);
        for (const v of args.rarity ?? []) params.append('rarity', v);
        for (const v of args.rarity_exclude ?? []) params.append('rarity_exclude', v);
        r = (await ctx.api.get(`/sets/${encodeURIComponent(args.set_id.trim())}/massentry?${params.toString()}`)) as CartResponse;
      } else if (args.list_id) {
        const params = new URLSearchParams();
        if (args.missing_only) params.set('missing_only', 'true');
        r = (await ctx.api.get(
          `/lists/${encodeURIComponent(args.list_id.trim())}/massentry${params.size ? `?${params.toString()}` : ''}`,
        )) as CartResponse;
      } else {
        r = (await ctx.api.send('POST', '/massentry', {
          items: args.items!.map((i) => ({
            ...(i.variant_id !== undefined ? { variantId: i.variant_id } : {}),
            ...(i.card_id !== undefined ? { cardId: i.card_id } : {}),
            quantity: i.quantity,
          })),
        })) as CartResponse;
      }

      return ok(render(r).join('\n'), {
        source: r.source,
        set: r.set?.setId,
        list: r.list?.id,
        goal: r.goal,
        needed: r.needed,
        urls: r.urls,
        exactUrls: r.exactUrls,
        bestEffortUrls: r.bestEffortUrls,
        text: r.text,
        unlinkable: r.unlinkable,
        ...(r.unresolved ? { unresolved: r.unresolved } : {}),
      });
    } catch (err) {
      return fail(`set_cart failed: ${(err as Error).message}`);
    }
  },
});

export const shoppingTools: ToolDefinition[] = [
  setCartTool,
];
