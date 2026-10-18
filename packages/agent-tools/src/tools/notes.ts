/**
 * Knowledge notes (Phase 6): short, sourced statements about how cards interact. An agent proposes one when its
 * research settles a rules question (`propose_note`); a reviewer approves it in DeckPal's admin; approved notes then
 * appear for every account in `get_card` and `rules_lookup` (`approvedNotes`).
 *
 * A note is someone else's text by the time another account reads it, so it is printed through `untrusted()` and
 * labelled as a reviewed community note whose source link is the authority, never as DeckPal's own rule.
 */
import { z } from 'zod';
import type { Queryable } from '@deckpal/db';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { errText } from '../shared.js';
import { oneLine, untrusted } from '../format.js';

export interface ApprovedNote {
  cards: string[];
  statement: string;
  sourceUrl: string;
  quote: string;
}

/**
 * Approved notes about any of these card names, newest first. Never throws: a database without the table (an
 * install that has not run 089) or a failed read gives no notes, and the tool answers without them.
 */
export async function approvedNotes(db: Queryable | undefined, names: readonly string[], limit = 3): Promise<ApprovedNote[]> {
  const keys = [...new Set(names.map((n) => n.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  if (!db || !keys.length) return [];
  try {
    const r = await db.query<{ card_names: string[]; statement: string; source_url: string; quote: string }>(
      `SELECT card_names, statement, source_url, quote FROM knowledge_note
        WHERE status = 'approved' AND card_names && $1::text[] ORDER BY id DESC LIMIT $2`,
      [keys, limit],
    );
    return r.rows.map((x) => ({ cards: x.card_names, statement: x.statement, sourceUrl: x.source_url, quote: x.quote }));
  } catch {
    return [];
  }
}

/** The lines a tool prints for approved notes; empty when there are none. */
export function noteLines(notes: readonly ApprovedNote[]): string[] {
  if (!notes.length) return [];
  return [
    'Community notes (proposed by agents, approved by a DeckPal reviewer; the source is the authority):',
    // Free text is ALWAYS quoted (untrusted() leaves a plain sentence bare, and a bare sentence reads as DeckPal's own).
    ...notes.map((n) => `- [${n.cards.map((c) => untrusted(c, 40)).join(', ')}] ${JSON.stringify(oneLine(n.statement, 600))} Source quote: ${JSON.stringify(oneLine(n.quote, 600))} (${untrusted(n.sourceUrl, 200)})`),
  ];
}

export const proposeNoteTool = defineTool({
  name: 'propose_note',
  title: 'Propose a shared rules note',
  description:
    "Share a rules finding with every DeckPal user: how named cards interact, with a source link and the source's own words. " +
    'Use it after research settles a rules question. A reviewer approves it before others see it. No personal data. ' +
    'dry_run (default true) previews; dry_run: false submits.',
  inputSchema: z.object({
    cards: z.array(z.string()).min(1).max(6).describe('Card names involved, as printed.'),
    statement: z.string().describe('What is true, in one or two sentences.'),
    source_url: z.string().describe('https link to the ruling or source.'),
    quote: z.string().describe("The source's own words that say it."),
    dry_run: z.boolean().default(true),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  handler: async ({ cards, statement, source_url, quote, dry_run }, ctx) => {
    try {
      const r = (await ctx.api.send('POST', '/knowledge/notes', { cards, statement, source_url, quote, dry_run })) as {
        dryRun?: boolean;
        duplicate?: boolean;
        flags?: string[];
        note?: { id?: number; status?: string };
      };
      const flags = r.flags?.length ? ` The reviewer will see these flags: ${r.flags.join('; ')}.` : '';
      if (r.dryRun) return ok(`DRY RUN — this note would go to review: [${cards.join(', ')}] ${statement}${flags} Re-run with dry_run: false to submit it.`);
      if (r.duplicate) return ok(`That note already exists (${r.note?.status ?? 'pending'}); nothing new was submitted.`);
      return ok(`Submitted for review. Only you see it until a reviewer approves it.${flags}`);
    } catch (e) {
      return fail(`propose_note failed: ${errText(e)}`);
    }
  },
});

export const notesTools: ToolDefinition[] = [proposeNoteTool];
