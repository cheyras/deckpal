/**
 * Per-card format eligibility — the card modal's TCG tab.
 *
 * ── Why this is not `card.legal_standard` ──────────────────────────────────
 * The catalogue has `legal_standard` / `legal_expanded` columns and they are
 * NOT the answer. `003_catalog.sql:68` says so on the line that declares them:
 * "upstream-mirror ONLY; NOT the legality predicate". They are whatever TCGdex
 * happened to assert at import time; they know nothing about our vendored
 * rotation marks, our ban lists, or the reprint oracle. Rendering them in the
 * UI would put a confident wrong answer in front of the reader, which is
 * exactly what `apps/api/src/deck/data/_provenance.json` exists to prevent.
 *
 * ── Why it runs the deck validator instead of reimplementing it ────────────
 * The rules that decide whether a card may appear in a format at all — the
 * regulation-mark pool, the set-allowance pool, the reprint oracle, four ban
 * lists, GLC's rule-box and ACE SPEC exclusions — already exist, in
 * `formats.ts`, and the deck builder's legality panel is their only consumer
 * today. A second implementation would be a second thing to keep in step with
 * a rotation, and the two would eventually disagree in front of the same
 * reader on two screens of the same app.
 *
 * So this validates a one-card deck per format and keeps only the violations
 * that are ABOUT THE CARD. Everything else `validateDeck` reports for a
 * one-card deck is a construction rule that a single card necessarily breaks
 * (a 1-card deck is not 60 cards; a 1-card Trainer deck has no Basic Pokémon)
 * and says nothing about eligibility. The card tab and the deck panel are
 * therefore guaranteed to agree, by construction rather than by discipline.
 */
import { formatsCheckedAt } from './data.js';
import { validateDeck, type ValidateContext } from './formats.js';
import type { CardFacts, Category, DeckEntry, FormatCode, Violation } from './types.js';

/**
 * Violation codes that describe THE CARD's eligibility, as opposed to how a
 * deck is built. Everything not listed here is a construction rule.
 *
 *   NOT_IN_FORMAT        card's mark/set is outside the format's pool
 *   BANNED               named on the format's ban list
 *   NOT_TOURNAMENT_LEGAL GLC excludes cards not legal for official play
 *   RULE_BOX_FORBIDDEN   GLC admits no rule-box cards at all
 *   ACE_SPEC_FORBIDDEN   GLC admits no ACE SPEC at all
 *
 * The last two are limits of zero, which makes them facts about the card
 * rather than about the deck — unlike ACE_SPEC_LIMIT or RADIANT_LIMIT, whose
 * caps are >0 and can only be exceeded by a deck.
 */
const CARD_SCOPED = new Set([
  'NOT_IN_FORMAT',
  'BANNED',
  'NOT_TOURNAMENT_LEGAL',
  'RULE_BOX_FORBIDDEN',
  'ACE_SPEC_FORBIDDEN',
]);

/** A `DeckEntry` must declare its section; for one card it is just its category. */
const SECTION: Record<Category, DeckEntry['section']> = {
  Pokemon: 'pokemon',
  Trainer: 'trainer',
  Energy: 'energy',
};

export const LEGALITY_FORMATS: FormatCode[] = ['standard', 'expanded', 'glc', 'unlimited'];

export interface CardFormatLegality {
  format: FormatCode;
  legal: boolean;
  /** Why not, in the validator's own words. Empty when legal. */
  reasons: string[];
}

export interface CardLegality {
  /** The vendored data's own 'as of' date — the tab states its own freshness. */
  checkedAt: string;
  formats: CardFormatLegality[];
}

/**
 * The reprint oracle (§2.1.5) is REQUIRED, not optional, and that is deliberate.
 *
 * A card whose own mark has rotated out is still legal when a
 * fingerprint-identical printing carries a legal mark — and for GLC's
 * `cel25cc` and Pokémon TCG Classic cards the oracle is the ONLY one of the
 * three pool routes that fires. A caller who omits it does not get a slightly
 * different answer; it tells the reader their legal card is illegal, which is
 * the worse direction to be wrong in. `formats.test.ts`'s "every production
 * validateDeck call supplies the reprint oracle" is the tripwire, and it fired
 * on the first draft of this file, which had `ctx` defaulting to `{}`.
 *
 * Build one with `buildReprintOracle(pool, [card], legalMarks)`.
 */
export function cardLegality(card: CardFacts, ctx: ValidateContext): CardLegality {
  return {
    checkedAt: formatsCheckedAt(),
    formats: LEGALITY_FORMATS.map((format) => {
      const isInFormatByReprint = ctx.isInFormatByReprint;
      const result = validateDeck(
        { formatCode: format, entries: [{ card, quantity: 1, section: SECTION[card.category] }] },
        { isInFormatByReprint },
      );
      const blocking = result.violations.filter(
        (v: Violation) => v.severity === 'error' && CARD_SCOPED.has(v.code),
      );
      return {
        format,
        legal: blocking.length === 0,
        reasons: blocking.map((v) => v.message),
      };
    }),
  };
}
