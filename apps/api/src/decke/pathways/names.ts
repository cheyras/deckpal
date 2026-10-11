/**
 * The pathways Deck-E can be on, and the tier and effort each starts at.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE IS SMALL AND SHARED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A pathway is the kind of job a request is — log a battle, build a deck with
 * someone, plan a set completion — and it decides two things: which guidance
 * block rides with the core prompt (`pathways/index.ts`), and which model tier
 * the request starts on (`tiers.ts`). Triage (`triage.ts`, Claude Haiku 5.5)
 * names the pathway; CODE maps it to a tier through the floors below. A small
 * model filling a rubric is reliable; a small model grading its own competence
 * is not (roadmap/plans/decke-harness-v2/PLAN.md §2.1).
 *
 * The floors are the dial. Haiku 5.5 ties Sonnet 5.5 on bounded tool work and
 * trails it on judgment, so the judgment-heavy pathways start on Standard
 * (Sonnet) and the rest on Quick (Haiku). If the replay probe shows Haiku
 * failing a Quick pathway, that pathway's floor moves up here — one line, with
 * the evidence in the commit.
 *
 * Effort is per pathway on the Quick tier: `low` where nothing is looked up
 * (greetings, walking somewhere), `medium` for tool work — Anthropic's Haiku 5.5
 * guide measured that `low` with a long agent prompt "is more likely to skip a
 * search, stop early, or skip a check", which is Deck-E's worst failure shape.
 */

export const PATHWAY_NAMES = [
  'battle_log',
  'battle_review',
  'deck_build',
  'deck_iterate',
  'collection_plan',
  'lists',
  'price_value',
  'card_rules',
  'research',
  'navigate',
  'small_talk',
  'general',
] as const;

export type PathwayName = (typeof PATHWAY_NAMES)[number];

/** Quick = Claude Haiku 5.5; Standard = Claude Sonnet 5.5; Deep = Claude Opus 5.5 ("Deep Think", reader-consented). */
export type TierName = 'quick' | 'standard' | 'deep';

export type Effort = 'low' | 'medium' | 'high';

export interface PathwayMeta {
  readonly name: PathwayName;
  /** One line: what the reader wants when this is the pathway. Used by triage and the core prompt. */
  readonly summary: string;
  /** The lowest tier this pathway runs on. Deep is never a floor — it is always the reader's choice. */
  readonly floor: Exclude<TierName, 'deep'>;
  /** Effort when it runs on the Quick tier. Standard runs at `medium`; Deep at `high`. */
  readonly quickEffort: Effort;
}

export const PATHWAY_META: Readonly<Record<PathwayName, PathwayMeta>> = {
  battle_log: {
    name: 'battle_log',
    summary:
      'Log a game — a pasted PTCG Live log, an in-person report, or just a result — and write a note at the depth the game deserves.',
    floor: 'quick',
    quickEffort: 'medium',
  },
  battle_review: {
    name: 'battle_review',
    summary:
      "Read results across games (or one game in depth): record by opponent archetype, what's causing losses, what to try next.",
    floor: 'standard',
    quickEffort: 'medium',
  },
  deck_build: {
    name: 'deck_build',
    summary:
      'Build a new deck with the reader: format, goal, budget or owned cards, then a checked 60-card list they help shape.',
    floor: 'standard',
    quickEffort: 'medium',
  },
  deck_iterate: {
    name: 'deck_iterate',
    summary:
      'Make the next version of an existing deck from its results: small, evidenced changes, saved as a new version.',
    floor: 'standard',
    quickEffort: 'medium',
  },
  collection_plan: {
    name: 'collection_plan',
    summary:
      "Plan finishing a set or master set on a budget: what's missing, what it costs, the cheapest path.",
    floor: 'quick',
    quickEffort: 'medium',
  },
  lists: {
    name: 'lists',
    summary: "Create or edit a want or trade list, or fill one from a set's missing cards.",
    floor: 'quick',
    quickEffort: 'medium',
  },
  price_value: {
    name: 'price_value',
    summary: 'What cards or the collection are worth, price history, what moved.',
    floor: 'quick',
    quickEffort: 'medium',
  },
  card_rules: {
    name: 'card_rules',
    summary: 'What a card does: card text, attacks and abilities, rulings, format legality.',
    floor: 'quick',
    quickEffort: 'medium',
  },
  research: {
    name: 'research',
    summary: 'The current meta, archetypes, tournament results, rotation, new sets — things that change.',
    floor: 'quick',
    quickEffort: 'medium',
  },
  navigate: {
    name: 'navigate',
    summary: 'Take the reader somewhere in DeckPal, or show them something on the page.',
    floor: 'quick',
    quickEffort: 'low',
  },
  small_talk: {
    name: 'small_talk',
    summary: 'Greetings, thanks, chit-chat or venting, with no task in it.',
    floor: 'quick',
    quickEffort: 'low',
  },
  general: {
    name: 'general',
    summary: 'Anything else, or a mix with no clear pathway.',
    floor: 'quick',
    quickEffort: 'medium',
  },
};

export function isPathwayName(x: unknown): x is PathwayName {
  return typeof x === 'string' && (PATHWAY_NAMES as readonly string[]).includes(x);
}
