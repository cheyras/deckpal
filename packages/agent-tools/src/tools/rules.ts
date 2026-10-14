import { z } from 'zod';
import { RULING_INDEX, RULING_URL, type RulingIndexEntry } from '@deckpal/sim/rulings';
import { defineTool, type ToolDefinition } from '../registry.js';
import { ok } from '../result.js';
import { CORE_RULES, type CoreRule } from '../rules/coreRules.js';

/**
 * rules_lookup — the game's rules and the official rulings, so a rules answer never comes from model memory.
 *
 * Two sources, both checked by the battle simulator:
 *  - CORE_RULES (../rules/coreRules.ts): the rulebook in our own words, each entry pinned by a simulator test.
 *  - RULING_INDEX (@deckpal/sim/rulings): every official ruling the Pokémon Rulings Compendium lists, filed under the card,
 *    attack and Ability names it concerns, with DeckPal's one-line summary wherever the simulator pins it. No ruling text
 *    is copied; each line links to the official question and answer.
 *
 * Why a tool and not a longer prompt: the rules a question needs are a handful out of hundreds, and a model that has to
 * call for them states where the answer came from. Card TEXT is still get_card's job.
 */

const MAX_RULES = 4;
const MAX_RULINGS = 8;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** "Hide 'n' Sneak", "hide n sneak" and "Hide ’n’ Sneak" are one name. */
const loose = (s: string): string => norm(s).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');

const STOP = new Set(['a', 'an', 'the', 'is', 'it', 'of', 'to', 'in', 'on', 'and', 'or', 'can', 'does', 'do', 'i', 'my', 'if', 'when', 'what', 'how', 'with', 'for', 'be', 'are', 'that', 'this', 'pokemon']);
const words = (s: string): string[] => loose(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));

function scoreRule(rule: CoreRule, query: string, qWords: string[]): number {
  if (!query) return 0;
  const q = loose(query);
  let score = 0;
  for (const k of rule.keywords) if (q.includes(loose(k))) score += 3;
  const hay = loose(`${rule.title} ${rule.keywords.join(' ')} ${rule.text}`);
  for (const w of qWords) if (hay.includes(w)) score += 1;
  return score;
}

/** A ruling matches a named card when one of its filed names is that name (or contains it, for "X ex" / "Mega X ex"). */
function rulingMatches(r: RulingIndexEntry, cards: string[], qWords: string[]): number {
  let score = 0;
  const cats = r.categories.map(loose);
  // Whole words only, and at least 3 letters for a partial match: the Supporter "N" must not match "Not a real card".
  const within = (outer: string, inner: string): boolean => inner.length >= 3 && ` ${outer} `.includes(` ${inner} `);
  for (const c of cards) {
    if (cats.some((x) => x === c)) score += 6;
    else if (cats.some((x) => within(x, c) || within(c, x))) score += 3;
  }
  if (qWords.length) {
    const hay = loose(`${r.categories.join(' ')} ${r.summaries.join(' ')}`);
    const hits = qWords.filter((w) => hay.includes(w)).length;
    score += hits >= 2 ? hits : 0;
  }
  return score;
}

function renderRuling(r: RulingIndexEntry): string {
  const head = `#${r.id} · ${r.date} · ${r.categories.join(', ')} (${r.source})`;
  const body = r.summaries.length ? r.summaries.slice(0, 2).map((s) => `    DeckPal: ${s}`) : ['    (no DeckPal summary: read it at the link)'];
  return [head, ...body, `    ${RULING_URL(r.id)}`].join('\n');
}

const rulesLookupTool = defineTool({
  name: 'rules_lookup',
  title: 'Game rules and official rulings',
  description:
    'Look up the game rules and official rulings instead of answering from memory. Returns the matching core rules ' +
    '(turn 1, evolving, Rare Candy, Weakness, damage vs damage counters, Tera, Prizes, Special Conditions…) in ' +
    "DeckPal's words, and official rulings filed under the cards, attacks or Abilities you name, each with a link. " +
    'Card text itself comes from get_card.',
  inputSchema: z.object({
    query: z.string().max(300).optional().describe('The rules question in plain words.'),
    cards: z
      .array(z.string().min(1).max(80))
      .max(6)
      .optional()
      .describe('Card, attack or Ability names involved, e.g. ["Cursed Blast", "Hide \'n\' Sneak"].'),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (args) => {
    const query = (args.query ?? '').trim();
    const cards = (args.cards ?? []).map(loose).filter(Boolean);
    const qWords = words(query);
    if (!query && cards.length === 0) {
      return ok(
        'Pass query (the question) and/or cards (names involved). Core rules available: ' +
          CORE_RULES.map((r) => r.title).join('; ') +
          '.',
      );
    }

    const rules = CORE_RULES.map((r) => ({ r, s: scoreRule(r, query, qWords) }))
      .filter((x) => x.s >= 2)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_RULES);
    const rulings = RULING_INDEX.map((r) => ({ r, s: rulingMatches(r, cards, qWords) }))
      .filter((x) => x.s > 0)
      // Pinned rulings (with a DeckPal summary) and newer ones first among equals.
      .sort((a, b) => b.s - a.s || b.r.summaries.length - a.r.summaries.length || b.r.id - a.r.id);

    const lines: string[] = [];
    if (rules.length) {
      lines.push('Core rules (DeckPal reference, checked against the battle simulator):');
      for (const { r } of rules) lines.push(`- ${r.title}: ${r.text}`);
    } else if (query) {
      lines.push('No core rule matched those words. Core rules available: ' + CORE_RULES.map((r) => r.title).join('; ') + '.');
    }
    if (rulings.length) {
      lines.push(`Official rulings (${rulings.length} filed under those names${rulings.length > MAX_RULINGS ? `, showing ${MAX_RULINGS}` : ''}):`);
      for (const { r } of rulings.slice(0, MAX_RULINGS)) lines.push(renderRuling(r));
    } else if (cards.length) {
      lines.push('No official ruling is filed under ' + (args.cards ?? []).join(', ') + '. The card text (get_card) and the core rules decide it.');
    }
    lines.push('If these leave two answers, say what is unclear rather than guessing; a ruling link is the authority.');
    return ok(lines.join('\n'), { rules: rules.map((x) => x.r.id), rulings: rulings.slice(0, MAX_RULINGS).map((x) => x.r.id) });
  },
});

export const rulesTools: ToolDefinition[] = [rulesLookupTool];
