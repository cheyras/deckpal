/**
 * Trainer Level + set-LVL — the two gamification formulas, as PURE functions.
 *
 * Both are settled formulas. The data points that fix them are listed below and
 * pinned by unit tests, so a change to either is a visible test failure:
 *
 *   Trainer Level = floor(unique_cards / 10)              (276 unique → badge 27)
 *   set LVL       = 0 if pct == 0 else 1 + floor(pct/25)  (nine data points; dots at 25/50/75)
 *
 * No DB access here — callers pass in counts. The DB adapters (collectionValue.ts,
 * pokedex.ts) produce the counts; these functions turn counts into levels.
 */

/**
 * ── ASSUMPTION (one-line switch) ────────────────────────────────────────────
 * What "unique cards" means for Trainer Level. The evidence leans toward
 * distinct CARDS (677 total / 276 unique on the reference account fits either
 * reading, but the stat card is labelled "Unique Cards" and the question of
 * card-vs-(card,variant) question as still-open). We default to distinct cards.
 * Flip to 'pairs' to count distinct (card, variant) pairs instead — nothing else
 * changes; the adapter selects the matching COUNT(DISTINCT …).
 */
export const TRAINER_UNIQUE_MODE: 'cards' | 'pairs' = 'cards';

/** Cards needed per Trainer Level — floor(unique / 10). See the data points above. */
export const CARDS_PER_LEVEL = 10;

/** Trainer Level from the count of unique owned cards. floor(unique / 10). */
export function trainerLevel(uniqueCards: number): number {
  if (!Number.isFinite(uniqueCards) || uniqueCards <= 0) return 0;
  return Math.floor(uniqueCards / CARDS_PER_LEVEL);
}

export interface TrainerLevelProgress {
  level: number;
  uniqueCards: number;
  /** how many of the CARDS_PER_LEVEL toward the next level are already held (0..9) */
  intoLevel: number;
  /** unique cards still needed to reach the next level (1..10) */
  toNext: number;
  /** the unique-card count at which the next level is reached */
  nextLevelAt: number;
  /** fraction toward the next level, 0..1 (for a progress ring) */
  fraction: number;
}

/** Trainer Level plus progress toward the next level (drives the avatar ring). */
export function trainerLevelProgress(uniqueCards: number): TrainerLevelProgress {
  const u = Number.isFinite(uniqueCards) && uniqueCards > 0 ? Math.floor(uniqueCards) : 0;
  const level = trainerLevel(u);
  const intoLevel = u % CARDS_PER_LEVEL;
  const toNext = CARDS_PER_LEVEL - intoLevel;
  return {
    level,
    uniqueCards: u,
    intoLevel,
    toNext,
    nextLevelAt: (level + 1) * CARDS_PER_LEVEL,
    fraction: intoLevel / CARDS_PER_LEVEL,
  };
}

// ── Set / species completion level ────────────────────────────────────────────

/**
 * The set-LVL ladder is 0,1,2,3,4,Max = 6 states.
 * `1 + floor(pct/25)` yields 1..5; 5 is the "Max" state reached only at 100%.
 * We clamp to MAX_SET_LEVEL so a rounding artdefact above 100 can't exceed it.
 */
export const MAX_SET_LEVEL = 5;

/**
 * One-decimal, round-half-up percentage — the single rounding rule every % in the
 * product uses, so two surfaces never disagree about the same fraction.
 * Accepts null (→ 0) because progress rollups bind SQL NULLs (routes/series.ts).
 */
export function pct(owned: number | null, total: number | null): number {
  if (!owned || !total) return 0;
  return Math.round((owned / total) * 1000) / 10;
}

/**
 * set LVL from a real percentage: 0 if pct<=0 else 1 + floor(pct/25), capped.
 * Pinned by these measured points: 0→0, 6.4→1, 14.2→1, 22.3→1, 26.2→2,
 * 62.5→3.
 */
export function setLevel(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(MAX_SET_LEVEL, 1 + Math.floor(percent / 25));
}

/**
 * set LVL straight from counts, mirroring the DB generated column
 * (user_set_progress.set_level: `1 + LEAST(4, owned*100/total/25)` in integer
 * math). Agrees with setLevel(pct(owned,total)) on every observed data point;
 * exposed so callers that already have counts don't round-trip through a float.
 */
export function setLevelFromCounts(owned: number, total: number): number {
  if (!owned || !total) return 0;
  const intPct = Math.floor((owned * 100) / total); // Postgres integer division
  return 1 + Math.min(MAX_SET_LEVEL - 1, Math.floor(intPct / 25));
}

/** Human label for a set/species level; 5 renders as "Max". */
export function setLevelLabel(level: number): string {
  return level >= MAX_SET_LEVEL ? 'Max' : String(level);
}
