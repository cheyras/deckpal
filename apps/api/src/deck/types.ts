/**
 * Shared types for the deck-format validation engine (Phase 5 backend, part 1).
 * See research/DECK-FORMATS.md for the spec these mirror.
 *
 * The validators operate on plain `CardFacts` objects, NOT on DB rows, so the
 * whole engine is pure and unit-testable with hand-built fixtures. `db.ts`
 * adapts real catalogue rows into `CardFacts`.
 */

export type FormatCode = 'standard' | 'expanded' | 'glc' | 'unlimited';
export type Category = 'Pokemon' | 'Trainer' | 'Energy';

/** The pokemon type set used by GLC's single-type rule. */
export type PokemonType =
  | 'Grass' | 'Fire' | 'Water' | 'Lightning' | 'Psychic' | 'Fighting'
  | 'Colorless' | 'Darkness' | 'Metal' | 'Dragon' | 'Fairy';

/**
 * Everything the validators need to know about a single printed card.
 * Sourced either from the catalogue (db.ts) or hand-built in tests.
 */
export interface CardFacts {
  /** Catalogue id (BIGINT) as number, or a synthetic id in tests. */
  id: number;
  tcgdexId: string;
  /** TCGdex set id, e.g. 'sv03' — used for ban print-scope + export set code. */
  setTcgdexId: string;
  /** Opaque collector number as printed, e.g. '006', 'TG02', 'SV013'. */
  localId: string;
  /** Numeric collector number, null when localId is not purely numeric. */
  localIdNumeric: number | null;

  name: string;
  /** English name, casefolded + parenthetical/δ/LV. stripped (DECK-FORMATS §1.7/§3.2). */
  normalizedName: string;
  category: Category;
  stage: string | null;            // 'Basic' | 'Stage1' | 'Stage2' | ...
  suffix: string | null;           // 'ex' | 'EX' | 'V' | 'GX' | 'TAG TEAM-GX' | ...
  trainerType: string | null;      // 'Item' | 'Supporter' | 'Stadium' | 'Tool'
  energyType: 'Normal' | 'Special' | null;
  hp: number | null;
  retreat: number | null;
  regulationMark: string | null;   // 'A'..'Z' | null
  evolveFrom: string | null;
  types: PokemonType[];            // pokemon energy types; [] for Trainer/Energy

  /** Set's tcgdex_id prefix era test is done from setTcgdexId; kept for convenience. */
  releasedOn?: string | null;
}

/** A resolved deck: N copies of a CardFacts, plus provenance for round-trip. */
export interface DeckEntry {
  card: CardFacts;
  quantity: number;
  section: 'pokemon' | 'trainer' | 'energy';
  /** interchange provenance so import -> export is byte-stable (DECK-FORMATS §5.5) */
  srcSetCode?: string | null;
  srcNumber?: string | null;
  srcPrint?: string | null;   // 'PH'
  srcName?: string | null;
  resolution?: 'exact' | 'name_in_set' | 'name_only' | 'alt_table' | 'unresolved';
}

export interface Deck {
  formatCode: FormatCode;
  /** GLC declared single type; null/undefined otherwise. */
  glcType?: PokemonType | null;
  entries: DeckEntry[];
  /** raw parsed sections + warnings from an import, for TOTAL_MISMATCH etc. */
  importWarnings?: ValidationWarning[];
}

export type Severity = 'error' | 'warning';

export type ViolationCode =
  | 'DECK_SIZE'
  | 'NO_BASIC_POKEMON'
  | 'COPY_LIMIT'
  | 'SINGLETON'
  | 'ACE_SPEC_LIMIT'
  | 'ACE_SPEC_FORBIDDEN'
  | 'RADIANT_LIMIT'
  | 'PRISM_STAR_LIMIT'
  | 'RULE_BOX_FORBIDDEN'
  | 'NOT_IN_FORMAT'
  | 'BANNED'
  | 'TYPE_MISMATCH'
  | 'EXCLUSIVE_GROUP'
  | 'NOT_TOURNAMENT_LEGAL'
  | 'UNRESOLVED_CARD'
  | 'TOTAL_MISMATCH'
  | 'STALE_FORMAT_DATA';

export interface Violation {
  code: ViolationCode;
  severity: Severity;
  rule: string;
  message: string;
  scope: 'deck' | 'name' | 'card' | 'group' | 'deck_card';
  subject?: string;
  card_ids?: number[];
  observed?: number;
  allowed?: number;
  delta?: number;
  detail?: Record<string, unknown>;
}

export interface ValidationWarning {
  code: ViolationCode;
  message: string;
}

export interface ValidationCounts {
  total: number;
  pokemon: number;
  trainer: number;
  energy: number;
  distinct_names: number;
  unresolved: number;
}

/** The rich validation result — DECK-FORMATS §5.6, enough to render a clickable "Not Legal". */
export interface ValidationResult {
  format: FormatCode;
  format_data_checked_at: string;
  legal: boolean;
  counts: ValidationCounts;
  violations: Violation[];
  warnings: ValidationWarning[];
}
