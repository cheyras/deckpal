import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Ctx } from '../ctx.js';
import { fail, ok } from '../envelope.js';

/**
 * `set_cart` — thin wrapper over pokedex-api's GET /sets/:setId/massentry
 * (the single source of Mass Entry link generation, shared with the web UI's
 * Purchase Set button). Builds TCGplayer cart deep link(s) for everything
 * still needed to finish a set; it never buys anything itself.
 */

const GOALS = ['complete', 'master', 'grandmaster'] as const;
const FINISHES = ['normal', 'reverse', 'holo', 'lenticular', 'metal'] as const;

interface MassEntryResponse {
  set: { setId: string; name: string };
  goal: string;
  finishes: string[] | null;
  setCode: string | null;
  needed: { cards: number; items: number; unlinkable: number };
  lines: string[];
  text: string;
  urls: string[];
  unlinkable: Array<{ name: string; number: string; variant: string | null }>;
  warnings: string[];
  note: string;
}

export function registerShoppingTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'set_cart',
    {
      title: 'TCGplayer cart link for missing set cards',
      description:
        'Build TCGplayer Mass Entry deep link(s) that pre-fill a shopping cart with every card ' +
        'still needed to finish a set for a goal, plus a plain-text Mass Entry list as fallback. ' +
        'This tool only BUILDS links — it does not purchase anything, does not touch TCGplayer, ' +
        "and cannot add to a cart by itself: the user must open the link(s) in their own " +
        'logged-in browser (when the list is long it is split into several links; opening each ' +
        'adds to the same cart). Printing and card condition (NM/LP/…) cannot be preselected by ' +
        "link — they are chosen on TCGplayer's Mass Entry page. For what is missing and its " +
        'cost use set_progress; for buying deck gaps use decks with include=[pricing].',
      inputSchema: z.object({
        set_id: z.string().describe("TCGdex set id, e.g. 'me05', 'sv3pt5'."),
        goal: z
          .enum(GOALS)
          .optional()
          .describe(
            "What 'needed' means: complete = one of any variant per card (default), " +
              'master = every standard-tier variant, grandmaster = every variant.',
          ),
        finishes: z
          .array(z.enum(FINISHES))
          .optional()
          .describe(
            'Only include missing variants with these finishes (master/grandmaster only; ' +
              'ignored for complete, where any one printing counts). Omit for all finishes.',
          ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        const params = new URLSearchParams({ goal: args.goal ?? 'complete' });
        for (const f of args.finishes ?? []) params.append('finish', f);
        const r = (await ctx.api.get(
          `/sets/${encodeURIComponent(args.set_id.trim())}/massentry?${params.toString()}`,
        )) as MassEntryResponse;

        const lines: string[] = [
          `${r.set.name} (${r.set.setId}) — TCGplayer cart for goal '${r.goal}'` +
            (r.finishes ? ` (finishes: ${r.finishes.join(', ')})` : ''),
        ];
        if (r.needed.cards === 0) {
          lines.push('Nothing needed — this goal is already finished.');
          return ok(lines.join('\n'), { set: r.set.setId, goal: r.goal, needed: r.needed, urls: [] });
        }
        lines.push(
          `${r.needed.items} card(s) needed across ${r.needed.cards} Mass Entry line(s)` +
            (r.setCode ? ` — set code [${r.setCode}]` : ''),
        );
        lines.push(
          r.urls.length > 1
            ? `open ALL ${r.urls.length} links in the logged-in browser (each adds to the same cart):`
            : 'open in the logged-in browser:',
        );
        r.urls.forEach((u, i) => lines.push(`  ${r.urls.length > 1 ? `part ${i + 1}: ` : ''}${u}`));
        if (r.unlinkable.length > 0) {
          lines.push(`not on TCGplayer (${r.unlinkable.length}) — buy elsewhere:`);
          for (const u of r.unlinkable) {
            lines.push(`  ${u.name} #${u.number}${u.variant ? ` (${u.variant})` : ''}`);
          }
        }
        for (const w of r.warnings) lines.push(`warning: ${w}`);
        lines.push(r.note);
        lines.push('Mass Entry text fallback (paste at tcgplayer.com/massentry):');
        lines.push(r.text);
        return ok(lines.join('\n'), {
          set: r.set.setId,
          goal: r.goal,
          finishes: r.finishes,
          setCode: r.setCode,
          needed: r.needed,
          urls: r.urls,
          text: r.text,
          unlinkable: r.unlinkable,
        });
      } catch (err) {
        return fail(`set_cart failed: ${(err as Error).message}`);
      }
    },
  );
}
