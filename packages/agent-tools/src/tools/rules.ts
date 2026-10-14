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

/**
 * Names a ruling is filed under, matched EXACTLY (case, accents and apostrophes aside). Containment is not identity:
 * "Switch Cart" is not "Switch", and "N" is not every word with an n in it (Astra, #340).
 */
const RULINGS_BY_NAME = new Map<string, RulingIndexEntry[]>();
for (const r of RULING_INDEX) {
  for (const c of r.categories) {
    const key = loose(c);
    const list = RULINGS_BY_NAME.get(key) ?? [];
    list.push(r);
    RULINGS_BY_NAME.set(key, list);
  }
}

/** Case kept: a card name in a question is written with capitals ("Cursed Blast"), a plain word is not ("switch"). */
const cased = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/s+/g, ' ').trim();
const CASED_NAMES = [...new Set(RULING_INDEX.flatMap((r) => r.categories))]
  .map((c) => ({ name: c, cased: cased(c) }))
  .filter((c) => c.cased.length >= 3 && /[A-Z]/.test(c.cased))
  .sort((a, b) => b.cased.length - a.cased.length);

/** Ruling names written in the question itself, longest first, each consuming its words so "Hide n Sneak" does not also yield "N". */
function namesInQuery(query: string): string[] {
  let text = ` ${cased(query)} `;
  const found: string[] = [];
  for (const c of CASED_NAMES) {
    const needle = ` ${c.cased} `;
    if (text.includes(needle)) {
      found.push(c.name);
      text = text.split(needle).join(' ');
    }
  }
  return found;
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
    // Rulings only for NAMES: the ones passed in `cards`, and card/attack/Ability names written in the question.
    // A topic-only match ("prize", "damage") is what the core rules are for, and it buried the ruling that mattered.
    const named = [...new Set([...cards, ...namesInQuery(query).map(loose)])];
    const hits = new Map<number, { r: RulingIndexEntry; names: number; words: number }>();
    for (const n of named) {
      for (const r of RULINGS_BY_NAME.get(n) ?? []) {
        const hit = hits.get(r.id) ?? { r, names: 0, words: 0 };
        hit.names++;
        hits.set(r.id, hit);
      }
    }
    for (const hit of hits.values()) {
      const hay = loose(`${hit.r.categories.join(' ')} ${hit.r.summaries.join(' ')}`);
      hit.words = qWords.filter((w) => hay.includes(w)).length;
    }
    // Most of the named things first (a ruling filed under BOTH names beats one under either), then the question's
    // words, then rulings the simulator pins, then newest.
    const rulings = [...hits.values()].sort(
      (a, b) => b.names - a.names || b.words - a.words || b.r.summaries.length - a.r.summaries.length || b.r.id - a.r.id,
    );

    const lines: string[] = [];
    if (rules.length) {
      lines.push('Core rules (DeckPal reference, checked against the battle simulator):');
      for (const { r } of rules) lines.push(`- ${r.title}: ${r.text}`);
    } else if (query) {
      lines.push('No core rule matched those words. Core rules available: ' + CORE_RULES.map((r) => r.title).join('; ') + '.');
    }
    const namedLabel = [...new Set([...(args.cards ?? []), ...namesInQuery(query)])].join(', ');
    if (rulings.length) {
      lines.push(`Official rulings filed under ${namedLabel} (${rulings.length}${rulings.length > MAX_RULINGS ? `, showing ${MAX_RULINGS}` : ''}):`);
      for (const { r } of rulings.slice(0, MAX_RULINGS)) lines.push(renderRuling(r));
    } else if (named.length) {
      lines.push(`No official ruling is filed under ${namedLabel}. The card text (get_card) and the core rules decide it.`);
    }
    lines.push('If these leave two answers, say what is unclear rather than guessing; a ruling link is the authority.');
    return ok(lines.join('\n'), { rules: rules.map((x) => x.r.id), rulings: rulings.slice(0, MAX_RULINGS).map((x) => x.r.id) });
  },
});

export const rulesTools: ToolDefinition[] = [rulesLookupTool];
