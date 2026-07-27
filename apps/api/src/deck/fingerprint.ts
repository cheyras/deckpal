/**
 * playable_fingerprint — reprint-equivalence hash. PRIOR-ART.md §3 item 4,
 * DECK-FORMATS §2.1.5.
 *
 * SHA-256 over a canonically-serialised, whitespace/case-normalised payload of a
 * card's NAME + GAMEPLAY attributes (never its print/variant/set/number/rarity/
 * illustrator/image). Two prints of the same playable card collide; a card with
 * the same name but different text does not.
 *
 * Uses:
 *   - reprint confers legality: an old-marked card is Standard-legal iff some
 *     fingerprint-identical card carries a legal mark (§2.1.5).
 *   - "can I build this from what I own": any print satisfying the slot.
 *   NOT the 4-copy rule — that keys on NAME, a looser relation (§3.2).
 */
import { createHash } from 'node:crypto';

export interface AttackFacts {
  name: string;
  cost?: string | null;   // 'Fire,Fire,Colorless'
  damage?: string | null;
  effect?: string | null;
}
export interface AbilityFacts {
  kind?: string | null;
  name: string;
  effect?: string | null;
}
export interface MatchupFacts {
  type: string;
  value: string;          // '×2', '-30'
}

/** Everything gameplay-relevant. Print-identifying fields are deliberately absent. */
export interface FingerprintInput {
  name: string;
  category: string;
  hp?: number | null;
  types?: string[];
  stage?: string | null;
  suffix?: string | null;
  evolveFrom?: string | null;
  trainerType?: string | null;
  energyType?: string | null;
  effect?: string | null;             // trainer/energy rule text
  attacks?: AttackFacts[];
  abilities?: AbilityFacts[];
  weaknesses?: MatchupFacts[];
  resistances?: MatchupFacts[];
  retreat?: number | null;
}

function norm(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  return s.normalize('NFC').replace(/’/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Refuse to fingerprint a card we don't have full gameplay data for, so weak
 * fingerprints never enter the index (PRIOR-ART §3 item 4 `_has_full_gameplay_data`).
 * A Pokémon must have HP and at least one attack or ability; a Trainer/Energy must
 * have some effect text.
 */
export function hasFullGameplayData(c: FingerprintInput): boolean {
  if (c.category === 'Pokemon') {
    return (
      c.hp !== null &&
      c.hp !== undefined &&
      ((c.attacks?.length ?? 0) > 0 || (c.abilities?.length ?? 0) > 0)
    );
  }
  // Trainers and Special Energy carry rule text; basic Energy legitimately has none.
  return true;
}

/** Canonical, order-stable payload. */
function canonical(c: FingerprintInput): string {
  const attacks = (c.attacks ?? [])
    .map((a) => [norm(a.name), norm(a.cost), norm(a.damage), norm(a.effect)].join('|'))
    .sort();
  const abilities = (c.abilities ?? [])
    .map((a) => [norm(a.kind), norm(a.name), norm(a.effect)].join('|'))
    .sort();
  const weak = (c.weaknesses ?? []).map((w) => `${norm(w.type)}${norm(w.value)}`).sort();
  const res = (c.resistances ?? []).map((w) => `${norm(w.type)}${norm(w.value)}`).sort();
  const types = (c.types ?? []).map(norm).sort();

  const payload = {
    name: norm(c.name),
    category: norm(c.category),
    hp: c.hp ?? null,
    types,
    stage: norm(c.stage),
    suffix: norm(c.suffix),
    evolveFrom: norm(c.evolveFrom),
    trainerType: norm(c.trainerType),
    energyType: norm(c.energyType),
    effect: norm(c.effect),
    attacks,
    abilities,
    weaknesses: weak,
    resistances: res,
    retreat: c.retreat ?? null,
  };
  return JSON.stringify(payload);
}

/** SHA-256 hex of the canonical payload, or null when data is too thin to trust. */
export function playableFingerprint(c: FingerprintInput): string | null {
  if (!hasFullGameplayData(c)) return null;
  return createHash('sha256').update(canonical(c), 'utf8').digest('hex');
}
