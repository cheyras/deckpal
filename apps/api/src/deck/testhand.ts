/**
 * Opening-hand / mulligan simulator. DECK-FORMATS §4.
 * Draw 7; if no Basic Pokémon, reveal + reshuffle + redraw (the mulligan); the
 * opponent draws one card per EXTRA mulligan. Pure logic with an INJECTABLE RNG
 * so tests are deterministic (§4.3 "Determinism").
 */
import type { CardFacts } from './types.js';

export type Rng = () => number; // uniform in [0,1)

/** mulberry32 — small, fast, seedable PRNG. Do not use for anything cryptographic. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A card in the shuffled library: only the flags the draw cares about. */
export interface HandCard {
  isBasicPokemon: boolean;
  card?: CardFacts;
}

/** Expand a resolved deck (card + quantity) into the 60-card library. */
export function expandLibrary(entries: { card: CardFacts; quantity: number }[]): HandCard[] {
  const lib: HandCard[] = [];
  for (const e of entries) {
    const isBasic = e.card.category === 'Pokemon' && e.card.stage === 'Basic';
    for (let i = 0; i < e.quantity; i++) lib.push({ isBasicPokemon: isBasic, card: e.card });
  }
  return lib;
}

/** In-place Fisher-Yates using the injected RNG. */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

export interface DrawResult {
  hand: HandCard[];
  mulligans: number;   // number of redraws before a keepable hand
  prizes: HandCard[];  // 6 prizes from the remaining 53 (§4.1)
}

const MAX_MULLIGANS = 8; // §4.2 / §7.4.2 safety valve

/**
 * Draw a keepable opening hand: 7 cards, redrawing while no Basic Pokémon.
 * Caps auto-mulligans at 8 (§7.4.2) so a 1-basic deck cannot spin forever.
 */
export function drawOpeningHand(library: HandCard[], rng: Rng): DrawResult {
  let mulligans = 0;
  let deck = shuffle(library.slice(), rng);
  let hand = deck.slice(0, 7);
  while (!hand.some((c) => c.isBasicPokemon) && mulligans < MAX_MULLIGANS) {
    mulligans++;
    deck = shuffle(library.slice(), rng);
    hand = deck.slice(0, 7);
  }
  const prizes = deck.slice(7, 13); // 6 prizes, taken after the hand (§4.1)
  return { hand, mulligans, prizes };
}

export interface MulliganStats {
  samples: number;
  /** hands (of the first 7 drawn) with no Basic Pokémon */
  mulliganHands: number;
  /** P(first 7-card hand needs a mulligan) — simulated */
  mulliganRate: number;
  /** closed-form P(no Basic Pokémon in opening 7), hypergeometric */
  hypergeometric: number;
  basicPokemonCount: number;
  deckSize: number;
}

/** Exact P(no basic in opening 7) = ∏_{i=0..6} (N-B-i)/(N-i). */
export function hypergeometricMulligan(deckSize: number, basicCount: number, handSize = 7): number {
  if (basicCount <= 0) return 1;
  if (deckSize - basicCount < handSize) return 0;
  let p = 1;
  for (let i = 0; i < handSize; i++) {
    p *= (deckSize - basicCount - i) / (deckSize - i);
  }
  return p;
}

/**
 * Monte-Carlo mulligan rate over N seeded draws (§4.3). Measures the FIRST-hand
 * mulligan probability (redraw needed), which is what the hypergeometric predicts.
 */
export function simulateMulliganRate(
  library: HandCard[], samples: number, rng: Rng,
): MulliganStats {
  const deckSize = library.length;
  const basicCount = library.filter((c) => c.isBasicPokemon).length;
  let mulliganHands = 0;
  for (let s = 0; s < samples; s++) {
    const hand = shuffle(library.slice(), rng).slice(0, 7);
    if (!hand.some((c) => c.isBasicPokemon)) mulliganHands++;
  }
  return {
    samples,
    mulliganHands,
    mulliganRate: mulliganHands / samples,
    hypergeometric: hypergeometricMulligan(deckSize, basicCount),
    basicPokemonCount: basicCount,
    deckSize,
  };
}
