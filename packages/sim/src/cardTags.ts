/**
 * The printed-card tags the DeckPal catalog does not carry, for readers outside the engine.
 *
 * TCGdex, which the catalog syncs from, has no Tera marker and no Ancient / Future tag: `card_subtype` and `card_tag` hold
 * no rows. The engine has had both since #318, generated from pokemontcg.io's `subtypes` (cards/tera.ts, cards/tags.ts), so
 * this module is the one place agents read them from. It imports nothing but those two tables, so a caller that only
 * wants the tags (`get_card`, `search_cards`) does not load the engine.
 *
 * Why it matters: on 2026-10-12 every model, Haiku and Sonnet alike, told the owner that Nighttime Mine ("attacks used by
 * each Tera Pokémon in play cost {C} more") could not have blocked his Dragapult ex, because the card lookup showed no
 * Tera marker. Dragapult ex is a Tera Pokémon. The game's own UI showed the extra cost; the tools could not.
 */
import { TERA_PRINTINGS } from './cards/tera.js';
import { CARD_TAGS } from './cards/tags.js';

export type CardTag = 'Tera' | 'Ancient' | 'Future';

export const CARD_TAG_NAMES: readonly CardTag[] = ['Tera', 'Ancient', 'Future'];

/**
 * What each tag means in play, in our words. The Tera line is the rule box the engine applies (query.ts, rules-gaps.test.ts):
 * damage from attacks is prevented on the Bench, damage counters are not.
 */
export const CARD_TAG_MEANING: Readonly<Record<CardTag, string>> = {
  Tera:
    'Tera Pokémon: while it is on the Bench, all damage done to it by attacks is prevented (both players\' attacks); ' +
    'damage counters placed by attacks still land. Cards that name "Tera Pokémon" (Stadiums, Supporters) affect it.',
  Ancient: 'Ancient: cards that name "Ancient" Pokémon or Trainers (search, damage and cost effects) apply to it.',
  Future: 'Future: cards that name "Future" Pokémon or Trainers (search, damage and cost effects) apply to it.',
};

/** The tags printed on one printing, by TCGdex id. Empty for an untagged or unknown id. */
export function cardTags(tcgdexId: string): CardTag[] {
  const out: CardTag[] = [];
  if (TERA_PRINTINGS.has(tcgdexId)) out.push('Tera');
  const t = CARD_TAGS[tcgdexId];
  if (t) out.push(t);
  return out;
}

/** Every printing carrying a tag, by TCGdex id — for a SQL `= ANY($1)` filter. */
export function idsWithTag(tag: CardTag): string[] {
  if (tag === 'Tera') return [...TERA_PRINTINGS];
  return Object.entries(CARD_TAGS)
    .filter(([, v]) => v === tag)
    .map(([k]) => k);
}
