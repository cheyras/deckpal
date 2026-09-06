/**
 * Rung 9 — the card's own body text, as an ESCALATION and never as a key.
 *
 * Pure: no DB, no express, no `db.js`. The Postgres half is `catalogPort.ts`;
 * the ladder that calls this is `resolve.ts`.
 *
 * ── WHAT BODY TEXT CAN AND CANNOT ANSWER ────────────────────────────────────
 *
 * Every printing of one playable card carries the same attacks, the same
 * ability, the same rules text. That is what a reprint IS. So the text in the
 * middle of a card identifies the FAMILY — the set of printings that are the
 * same card — and it can never, at any confidence, identify WHICH printing is
 * in your hand. A `sv01-181` Nest Ball and an `sv04.5-084` Nest Ball print the
 * same forty words.
 *
 * The house ruling that follows from that (2026-09-06) is the shape of this
 * whole module:
 *
 *   confident ONLY when the family that wins has exactly one printing in the
 *   catalogue. Otherwise `matched: false` with the family's printings handed
 *   back as candidates, for the client's needs-you picker to put in front of a
 *   person.
 *
 * `matched: false` alongside a non-empty `matches` array is deliberate and is
 * the only place in this endpoint it happens. It is the literal truth: no CARD
 * was matched, and here is the short list a human can finish from.
 *
 * ── WHY THE FAMILY KEY IS `card.playable_fingerprint` ───────────────────────
 *
 * Because it already exists, it already means precisely this, and a second
 * definition of "same card" would be a second thing to keep true. Migration 047:
 * "SHA-256 over name + gameplay attributes (attacks, abilities, weaknesses,
 * resistances, retreat, types) and never over print fields. Rows sharing one are
 * the SAME CARD in different printings and may be swapped for each other; rows
 * sharing only a NAME may not — 218 Standard-legal names in this catalogue are
 * more than one card."
 *
 * That last clause is the trap this rung would otherwise walk into. Grouping by
 * name would put the 70 HP Shaymin and the 80 HP Shaymin in one family and call
 * a three-printing answer a one-printing answer.
 *
 * A NULL fingerprint is not a family. 047 is explicit that null means "too
 * little gameplay data to hash, which is not a claim of equality with the other
 * NULLs", and the port filters those rows out before they reach here.
 *
 * Note what the fingerprint being STRICTER than the text bag buys: two cards
 * whose printed text is identical but whose names differ — `Professor's
 * Research (Professor Oak)` and `Professor's Research (Professor Juniper)`, the
 * same four words on both — are two families with one bag. They tie, the margin
 * rule refuses, and nothing is returned. Which is right: with the title
 * unreadable, those two cards are genuinely indistinguishable, and the only
 * honest answer is silence.
 */
import { bodyTokens, probeTokens } from '@deckpal/db/cardText';
import type { CatalogCard } from './resolve.js';

/** A catalogue row with the two things this rung needs beyond identity. */
export interface FamilyTextCard extends CatalogCard {
  /** `card.playable_fingerprint`. Never null here — the port drops those rows. */
  familyKey: string;
  /** `card_text.tokens`, as written by the catalog importer. */
  tokens: readonly string[];
}

export interface FamilyScore {
  familyKey: string;
  /** Dice coefficient against the best-matching printing in this family, 0..1. */
  score: number;
  /** How many of the read's tokens that printing carried. */
  shared: number;
  /** Every printing of this family the pool contained. */
  cards: FamilyTextCard[];
}

// ── Defensive caps ──────────────────────────────────────────────────────────
//
// Everything below is a bound on USER-INFLUENCED INPUT that reaches a query
// path. The device is ours, but the endpoint is open and this is the only OCR
// field that is a list rather than a short string.

/** The owner's ruling caps the wire at 24 lines; this is the same number, enforced again. */
export const MAX_BODY_LINES = 24;
/** The longest single line of text a card prints is well under this. */
export const MAX_BODY_LINE_LENGTH = 200;
/** A card's whole bag runs 1–38 tokens (measured over 376 real cards); 120 is far past any honest read. */
export const MAX_READ_TOKENS = 120;
/** How many tokens are allowed into the SQL array the prefilter probes with. */
export const MAX_PROBE_TOKENS = 24;
/**
 * How many of those a card must carry to enter the candidate pool.
 *
 * 2, not 1: a single shared rare word is what every card in a mechanic shares
 * ("Stadium", "Knocked Out"), and probing on it returns hundreds of rows for a
 * scorer that is going to reject all of them on `MIN_SHARED_TOKENS` anyway. 2
 * is a prefilter, not a decision — the decision is `chooseFamily`, and this
 * number only has to be low enough never to drop a family that would have won.
 */
export const MIN_PROBE_OVERLAP = 2;
/**
 * Below this many RARE tokens, the probe is topped up with common ones rather
 * than left too short to satisfy `MIN_PROBE_OVERLAP`. See `probeTokens` — a
 * Trainer's whole vocabulary can be domain-common, and those are the cards this
 * rung is most needed on.
 */
export const MIN_PROBE_RARE = 6;
/**
 * How much of a WIDENED probe a row must carry to enter the pool, as a fraction
 * of the probe's length.
 *
 * A widened probe is mostly words half the game shares, so `MIN_PROBE_OVERLAP`
 * against it is barely a filter — `tokens && {pokemon, deck, search, …}` with a
 * floor of 2 is a scan of the catalogue wearing an index's clothing, and it is
 * reachable from the wire by anyone willing to post 24 lines of boilerplate.
 * Asking a proportion instead makes the widened case selective again.
 *
 * 0.3, measured on the same corpus the thresholds were: it takes the p90 pool
 * from 143 rows to 72 across 988 accepted reads and drops exactly the same two
 * winners the unproportioned filter did — i.e. none extra. It stays well under
 * what the Dice gate itself demands of a winner (a score of 0.40 over
 * comparably-sized bags already implies sharing ~0.4 of the read), so the
 * prefilter cannot become the thing that decides.
 */
export const WIDENED_OVERLAP_FRACTION = 0.3;
/** Rows the prefilter may return. Well above any real family's printing count. */
export const MAX_POOL_ROWS = 400;

// ── The decision rule, and the measurements that sized it ───────────────────
//
// Sized by sweep against 376 real cards pulled from the live TCGdex resource
// (all of sv01 and me05, two eras apart) on 2026-09-06, each read back at four
// OCR degradations — clean, and three levels of line-dropping plus glyph
// confusion (o→0, l→1, s→5, e→c, rn→m and the rest of the usual set). 1,504
// simulated reads, each ranked against all 283 families in the corpus, over an
// 80-cell grid of (minShared × minScore × minMargin).
//
// Three gates, because no one of them is sufficient and the failures they catch
// are different failures:

/**
 * How many of the read's tokens the winning printing must actually carry.
 *
 * THE LOAD-BEARING GATE, and the surprise of the sweep. A large margin is not
 * evidence when it is a large margin between two thin overlaps: at a floor of 3
 * shared tokens the corpus produced `sv01-155` resolving to a confidently wrong
 * Electrike at a margin of 0.42. Raising the floor to 6 took wrong accepts to
 * zero at every noise level and every margin at or above 0.15; at 5 they
 * persist. Costs recall on genuinely terse cards, and that is the trade the
 * house ruling asks for.
 */
export const MIN_SHARED_TOKENS = 6;

/**
 * Dice floor. On this corpus it removes nothing the other two gates did not
 * already remove — its job is the case the corpus CANNOT contain, which is text
 * that is not from this game at all. A Magic card's rules text scored 0.308
 * against its nearest Pokémon family with 2 shared tokens; a shop receipt 0.069;
 * OCR mush 0.000.
 */
export const MIN_SCORE = 0.4;

/**
 * How far ahead of the next family the winner must be. The rival is what makes
 * this rung refuse on reprints-of-near-things and on the identical-text /
 * different-name pairs; the sweep's last wrong accept disappears between 0.10
 * (2 wrong) and 0.15 (0 wrong).
 */
export const MIN_MARGIN = 0.15;

// Accept rates at (6, 0.40, 0.15), for the record: 90% of clean reads, 71%
// light, 57% moderate, 44% heavy — with ZERO wrong families accepted at any of
// them. The refusals are the point. And the simulation is optimistic in one
// direction only: a real read also picks up junk from the artwork, the
// copyright line and the set strip, which lengthens the read and LOWERS Dice,
// so the live behaviour of these thresholds is more conservative than measured,
// never less.

/**
 * Dice coefficient over two token sets: 2·|A∩B| / (|A|+|B|).
 *
 * Symmetric, which matters here — the read and the bag are both "the whole text
 * of one card" and neither is a subset of the other by design. Containment
 * (|A∩B|/|A|) was rejected for exactly that reason: it scores 1.0 for a read
 * that caught four words of a forty-word card.
 */
export function diceScore(read: readonly string[], bag: ReadonlySet<string>): { shared: number; score: number } {
  if (read.length === 0 || bag.size === 0) return { shared: 0, score: 0 };
  let shared = 0;
  for (const t of read) if (bag.has(t)) shared++;
  return { shared, score: (2 * shared) / (read.length + bag.size) };
}

/**
 * The read's tokens: capped, normalised and folded exactly as the catalogue
 * side was at import time (`@deckpal/db/cardText` is the single definition of
 * that folding, imported by both sides so they cannot drift).
 */
export function readTokens(bodyLines: readonly string[]): string[] {
  const lines = bodyLines.slice(0, MAX_BODY_LINES).map((l) => l.slice(0, MAX_BODY_LINE_LENGTH));
  return bodyTokens(lines).slice(0, MAX_READ_TOKENS);
}

export interface ProbePlan {
  /** The tokens to hand the GIN `&&`. */
  tokens: string[];
  /** How many of them a row must carry to enter the candidate pool. */
  minOverlap: number;
  /** True when there were too few rare tokens and common ones had to fill in. */
  widened: boolean;
}

/**
 * What to ask the index for, and how much of it to insist on.
 *
 * Two questions and not one, because they are not independent: the answer to
 * "which tokens" determines how selective a given overlap is, and a probe made
 * of words half the game shares needs a proportionally larger overlap to mean
 * anything at all.
 */
export function planProbe(read: readonly string[]): ProbePlan {
  const { tokens, rareCount } = probeTokens(read, MAX_PROBE_TOKENS, MIN_PROBE_RARE);
  const widened = rareCount < MIN_PROBE_RARE;
  const minOverlap = widened
    ? Math.max(MIN_PROBE_OVERLAP, Math.ceil(WIDENED_OVERLAP_FRACTION * tokens.length))
    : MIN_PROBE_OVERLAP;
  return { tokens, minOverlap, widened };
}

/**
 * Group a candidate pool into families and score each one, best first.
 *
 * A family's score is its BEST printing's, not the union of its printings'.
 * Union would be wrong in a way that quietly inflates: printings of one card
 * share every gameplay word but may carry different flavour lines, and pooling
 * those would credit a family for text that appears on no single card.
 */
export function scoreFamilies(read: readonly string[], pool: readonly FamilyTextCard[]): FamilyScore[] {
  const byFamily = new Map<string, FamilyScore>();
  for (const card of pool) {
    const { shared, score } = diceScore(read, new Set(card.tokens));
    const existing = byFamily.get(card.familyKey);
    if (!existing) {
      byFamily.set(card.familyKey, { familyKey: card.familyKey, score, shared, cards: [card] });
      continue;
    }
    existing.cards.push(card);
    if (score > existing.score) {
      existing.score = score;
      existing.shared = shared;
    }
  }
  // Ties broken on the family key so the order is deterministic — two families
  // at the same score must not swap places between requests, because which one
  // is "top" and which is "the rival" decides whether we answer at all.
  return [...byFamily.values()].sort(
    (a, b) => b.score - a.score || (a.familyKey < b.familyKey ? -1 : a.familyKey > b.familyKey ? 1 : 0),
  );
}

export interface FamilyDecision {
  /** The family that won, or null when nothing did. */
  family: FamilyScore | null;
  /** Why not, when `family` is null. Logged and asserted on; never sent to a client. */
  reason: 'no-read' | 'no-pool' | 'too-few-shared' | 'low-score' | 'indecisive' | 'accepted';
  /** The runner-up's score, for logs. */
  rivalScore: number;
}

/**
 * Decide, or refuse. Silence over lies: an indecisive text match returns
 * nothing at all and the ladder carries on as though this rung did not exist.
 */
export function chooseFamily(read: readonly string[], pool: readonly FamilyTextCard[]): FamilyDecision {
  if (read.length === 0) return { family: null, reason: 'no-read', rivalScore: 0 };
  if (pool.length === 0) return { family: null, reason: 'no-pool', rivalScore: 0 };

  const ranked = scoreFamilies(read, pool);
  const top = ranked[0]!;
  const rivalScore = ranked[1]?.score ?? 0;

  if (top.shared < MIN_SHARED_TOKENS) return { family: null, reason: 'too-few-shared', rivalScore };
  if (top.score < MIN_SCORE) return { family: null, reason: 'low-score', rivalScore };
  if (top.score - rivalScore < MIN_MARGIN) return { family: null, reason: 'indecisive', rivalScore };
  return { family: top, reason: 'accepted', rivalScore };
}
