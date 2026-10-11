import type { PathwayName } from './names.js'
import { BATTLE_LOG_TEXT } from './texts/battle_log.js'
import { BATTLE_REVIEW_TEXT } from './texts/battle_review.js'
import { CARD_RULES_TEXT } from './texts/card_rules.js'
import { COLLECTION_PLAN_TEXT } from './texts/collection_plan.js'
import { DECK_BUILD_TEXT } from './texts/deck_build.js'
import { DECK_ITERATE_TEXT } from './texts/deck_iterate.js'
import { LISTS_TEXT } from './texts/lists.js'
import { NAVIGATE_TEXT } from './texts/navigate.js'
import { PRICE_VALUE_TEXT } from './texts/price_value.js'
import { RESEARCH_TEXT } from './texts/research.js'
import { SMALL_TALK_TEXT } from './texts/small_talk.js'

/**
 * Request guidance is data, not control flow. Keeping this exhaustive means a
 * new pathway cannot silently receive the general prompt because somebody
 * forgot to add a switch arm.
 */
const PATHWAY_TEXT: Readonly<Record<PathwayName, string>> = {
  battle_log: BATTLE_LOG_TEXT,
  battle_review: BATTLE_REVIEW_TEXT,
  deck_build: DECK_BUILD_TEXT,
  deck_iterate: DECK_ITERATE_TEXT,
  collection_plan: COLLECTION_PLAN_TEXT,
  lists: LISTS_TEXT,
  price_value: PRICE_VALUE_TEXT,
  card_rules: CARD_RULES_TEXT,
  research: RESEARCH_TEXT,
  navigate: NAVIGATE_TEXT,
  small_talk: SMALL_TALK_TEXT,
  general: '',
}

export function pathwayText(name: PathwayName): string {
  return PATHWAY_TEXT[name]
}

/**
 * Triage may return a primary and secondary pathway. Preserve that order,
 * discard `general`, and de-duplicate so one rubric cannot drown out the core.
 */
export function pathwayBlock(names: readonly PathwayName[]): string {
  const useful = [...new Set(names)].filter((name) => name !== 'general')
  if (useful.length === 0) return ''

  return useful.slice(0, 2)
    .map((name) => `## This request: ${name}\n\n${pathwayText(name)}`)
    .join('\n\n')
}
