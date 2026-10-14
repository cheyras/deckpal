import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry.js';
import { ok } from '../result.js';
import { PLAYBOOK_INDEX_TEXT, PLAYBOOK_TEXT } from '../playbooks/texts.js';

/**
 * `playbook` — DeckPal's step-by-step guide for a job, served by DeckPal itself (2026-10-14).
 *
 * WHY. The owner tested a claude.ai skill written for DeckPal (2026-10-13) and asked for it to live in one place:
 * "host the skill at something like deckpal.app/skill, as one source of truth", with the copy saved in claude.ai only a
 * pointer. A skill file saved in a client goes stale the day DeckPal changes; a guide the server returns is always the
 * one that matches the tools it serves. The same texts (playbooks/texts.ts) are published at deckpal.app/skill, and the
 * downloadable claude.ai skill is a pointer to this tool and that page.
 *
 * Small models are the audience: numbered steps, exact tool calls and arguments, the reply shape. Every tool and
 * argument a playbook names is checked against the registry in __tests__/playbooks.test.ts.
 */

export type PlaybookName = keyof typeof PLAYBOOK_TEXT;
export const PLAYBOOK_NAMES = Object.keys(PLAYBOOK_TEXT) as PlaybookName[];

const playbookTool = defineTool({
  name: 'playbook',
  title: 'Playbook for a job',
  description:
    "DeckPal's step-by-step guide for a job: which tools to call, with what, and how to reply. Open it before the first " +
    'DeckPal call of a job; with no name it gives the rules for every job and which playbook fits. Read-only.',
  inputSchema: z.object({
    name: z.enum(PLAYBOOK_NAMES as [PlaybookName, ...PlaybookName[]]).optional(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ name }) => ok(name ? PLAYBOOK_TEXT[name] : PLAYBOOK_INDEX_TEXT),
});

export const playbookTools: ToolDefinition[] = [playbookTool];
