/**
 * A booster rip, as a state machine.
 *
 * The existing scanner is built for ONE card: it samples frames, and when the
 * same match survives two frames in a row it stops itself and shows a result.
 * A pack opening is the opposite shape — cards arrive one after another and the
 * loop must never stop — so this owns the part the single-card flow cannot: how
 * a stream of noisy per-frame matches becomes a list of distinct cards.
 *
 * THE DEDUP RULE IS DEPARTURE-THEN-RETURN, and getting it wrong is the whole
 * difficulty. The obvious rule — "same card id within N seconds is the same
 * card" — is inverted. At the scanner's 700 ms cadence with two-frame stability,
 * a card held steady in front of the lens re-stabilises about every 1.4 s, so a
 * card held for four seconds would be logged three times. The card is not new
 * because it matched again; it is new because it LEFT and something came back.
 *
 * So a committed card is REFRACTORY until the stream stops seeing it. Only then
 * can the same id count again — and even then it is genuinely ambiguous whether
 * the reader pulled a second copy or simply re-showed the first, which no
 * heuristic can resolve. Quantity is therefore a user action, never inferred.
 */

/** One ranked match as `POST /scan` returns it. */
export type ScanHit = { cardId: string; name: string; distance: number }

/** One printing a card can be. A subset of the catalog's `Variant`. */
export type RipVariant = {
  variantId: number
  displayName: string
  isPrimary: boolean
}

export type RipEntry = {
  cardId: string
  name: string
  /** How many the reader says they pulled. Starts at 1; only they change it. */
  quantity: number
  /** Hamming distance of the frame that committed it. Lower is more certain. */
  distance: number
  /** Ordering, and what the UI animates in. */
  at: number
  /**
   * WHICH PRINTING. Null until the catalog answers, and it must stay a reader's
   * choice rather than an inference: the scanner matches ARTWORK, and a card and
   * its reverse holo share the same artwork, so the hash cannot tell them apart
   * even in principle. Every booster pack contains reverse holos, so defaulting
   * silently to the primary variant does not mis-file an edge case — it mis-files
   * a guaranteed fraction of every pack opened.
   */
  variantId: number | null
  /** What this card can be. Empty until `api.card` answers. */
  variants: RipVariant[]
}

export type RipState = {
  entries: RipEntry[]
  /** The card currently in front of the lens, committed or not. */
  holding: string | null
  /** Consecutive frames the current candidate has survived. */
  streak: number
  /** Committed cards that must leave the frame before they may count again. */
  refractory: Set<string>
  /** Consecutive frames with nothing trustworthy in them. */
  missStreak: number
}

export function emptyRip(): RipState {
  return { entries: [], holding: null, streak: 0, refractory: new Set(), missStreak: 0 }
}

/**
 * How many consecutive confident frames commit a card.
 *
 * The single-card scanner uses 2 and pauses itself afterwards. A rip runs
 * unattended for minutes, so a false positive is not corrected by the reader
 * noticing — it just lands in the list. Three frames costs ~0.7 s of extra hold
 * time per card and is the difference between a list you check and a list you
 * rewrite.
 */
export const COMMIT_FRAMES = 3

/**
 * Distance at or below which a match is trusted.
 *
 * The server's own threshold is 9, measured over 389 synthetic scans: correct
 * cards land at p50 3 / p95 9, and junk frames bottom out at 10. Rip mode is
 * STRICTER at 7, for the same reason the frame count is higher — nobody is
 * watching. The cost is a card that has to be held a moment longer; the
 * alternative is a near-miss reprint in a list presented as fact.
 */
export const TRUST_DISTANCE = 7

/**
 * Consecutive empty frames that count as the card having LEFT.
 *
 * One is not enough, and the first version used one. Cards wobble: a hand
 * shifts, a reflection catches the lens, and a single frame comes back over
 * threshold. Treating that as a departure means the card is logged again the
 * moment it steadies — the exact double-count this whole state machine exists
 * to prevent, arriving by a different route.
 *
 * Two frames is ~1.4 s at the scanner's cadence, which is longer than a wobble
 * and shorter than the gap between pulling two cards out of a pack.
 */
export const LEAVE_FRAMES = 2

/** What one frame's result does to the session. Pure: no I/O, no clock. */
export function onFrame(
  state: RipState,
  hit: ScanHit | null,
  now: number,
): { state: RipState; committed: RipEntry | null } {
  // NOTHING IN FRAME — or nothing trustworthy. This is what clears the
  // refractory set, and it is the only thing that does: a card the stream has
  // stopped seeing has genuinely left, so a later sighting is a new event.
  if (!hit || hit.distance > TRUST_DISTANCE) {
    const missStreak = state.missStreak + 1
    // A CANDIDATE dies on the first miss — it never reached the threshold, so
    // there is nothing to protect. A COMMITTED card needs `LEAVE_FRAMES`,
    // because one bad frame is a wobble and not a departure.
    const next: RipState = { ...state, holding: null, streak: 0, missStreak }
    if (missStreak >= LEAVE_FRAMES && state.refractory.size) next.refractory = new Set()
    return { state: next, committed: null }
  }

  // A DIFFERENT card than the one being tracked: start its streak over. The
  // previous candidate never reached the threshold, so it is simply dropped —
  // a card glimpsed for one frame while the reader moves their hand is not a
  // pull.
  if (hit.cardId !== state.holding) {
    return {
      state: { ...state, holding: hit.cardId, streak: 1, missStreak: 0 },
      committed: null,
    }
  }

  // Same card again. Already committed and still in frame — hold, do not
  // re-count. This is the branch the naive rule gets wrong.
  if (state.refractory.has(hit.cardId)) {
    return { state: { ...state, missStreak: 0 }, committed: null }
  }

  const streak = state.streak + 1
  if (streak < COMMIT_FRAMES) {
    return { state: { ...state, streak, missStreak: 0 }, committed: null }
  }

  const entry: RipEntry = {
    cardId: hit.cardId,
    name: hit.name,
    quantity: 1,
    distance: hit.distance,
    at: now,
    variantId: null,
    variants: [],
  }
  const refractory = new Set(state.refractory)
  refractory.add(hit.cardId)
  return {
    state: { ...state, entries: [...state.entries, entry], streak, refractory, missStreak: 0 },
    committed: entry,
  }
}

/**
 * The catalog answered: here is what this card can be.
 *
 * Defaults the selection to the primary printing, which matches what
 * `POST /collection/cards/:cardId/have` does in SQL — so a card added by the
 * scanner and one added by the Have toggle land in the same row. The default is
 * a starting point the reader can change, not a decision made for them.
 *
 * Late arrivals are ignored for a card the reader has already removed, and a
 * selection they have already made is preserved rather than reset.
 */
export function setVariants(state: RipState, cardId: string, variants: RipVariant[]): RipState {
  return {
    ...state,
    entries: state.entries.map((e) => {
      if (e.cardId !== cardId) return e
      const primary = variants.find((v) => v.isPrimary) ?? variants[0]
      return { ...e, variants, variantId: e.variantId ?? primary?.variantId ?? null }
    }),
  }
}

/** The reader says which printing it is. */
export function chooseVariant(state: RipState, cardId: string, variantId: number): RipState {
  return {
    ...state,
    entries: state.entries.map((e) => (e.cardId === cardId ? { ...e, variantId } : e)),
  }
}

/** The reader says they pulled more than one. Only they can say this. */
export function setQuantity(state: RipState, cardId: string, quantity: number): RipState {
  const q = Math.max(0, Math.round(quantity))
  return {
    ...state,
    entries: state.entries.flatMap((e) =>
      e.cardId !== cardId ? [e] : q === 0 ? [] : [{ ...e, quantity: q }],
    ),
  }
}

/** The reader says it is wrong. */
export function removeEntry(state: RipState, cardId: string): RipState {
  // Dropped from `refractory` too, so a corrected mis-read can be rescanned
  // immediately rather than being invisible until the card leaves the frame.
  const refractory = new Set(state.refractory)
  refractory.delete(cardId)
  return { ...state, entries: state.entries.filter((e) => e.cardId !== cardId), refractory }
}
