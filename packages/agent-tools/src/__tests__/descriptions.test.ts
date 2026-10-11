/**
 * The shared tool descriptions are served to EVERY client.
 *
 * `allTools()` is both Deck-E's data-tool catalogue and what `tools/list`
 * returns to a claude.ai, ChatGPT or Claude Code connector. A description that
 * names something only Deck-E has — `showDeck`, `goTo`, an `ask_user` card, the
 * `@pasted` handle, "Deck-E's analysis" — tells a connector client to call a
 * tool it does not hold or to write in a voice that is not its own. Until
 * 2026-10-10 `check_deck` said "run it again before showDeck" and both battle-
 * log `review` fields said "Deck-E's markdown analysis".
 *
 * Deck-E-only guidance belongs in its pathway texts and adapter
 * (apps/api/src/decke), never here. The capability-gated improvement tools are
 * deliberately not in `allTools()`: their subject IS Deck-E's conversations.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { allTools } from '../index.js';

// `express`, `escort`, `journey` and `consult` are also English words ("leave
// these rarities OUT" sits beside "express" in set_progress), so they count only
// when written as a tool name, in backticks.
const DECKE_ONLY = /\b(showDeck|showScreen|goTo|flyTo|ask_user|web_research)\b|`(express|escort|journey|consult)`|@pasted|Deck-E|Deep Think/;

/** Every `description` string anywhere in a JSON Schema. */
function descriptions(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) descriptions(item, out);
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'description' && typeof value === 'string') out.push(value);
      else descriptions(value, out);
    }
  }
  return out;
}

test('no shared tool description or argument description names a Deck-E-only thing', () => {
  const offenders: string[] = [];
  for (const tool of allTools()) {
    // `health` has no inputSchema at all (registry.ts), so there is nothing to walk.
    const schema = tool.inputSchema ? z.toJSONSchema(tool.inputSchema as z.ZodType, { io: 'input' }) : {};
    const texts = [tool.title ?? '', tool.description, ...descriptions(schema)];
    for (const text of texts) {
      const hit = text.match(DECKE_ONLY);
      if (hit) offenders.push(`${tool.name}: "${hit[0]}" in ${JSON.stringify(text.slice(0, 120))}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the walk actually reaches argument descriptions', () => {
  // Without this a schema shape the walk misses would make the test above vacuous.
  const add = allTools().find((t) => t.name === 'add_battle_log')!;
  const texts = descriptions(z.toJSONSchema(add.inputSchema as z.ZodType, { io: 'input' }));
  assert.ok(texts.some((t) => /own words in notes/.test(t)), 'the review field description was not reached');
});
