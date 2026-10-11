// REPRINT FAMILIES — same-name printings that show the same picture.
//
// ── WHY THE SCANNER NEEDS TO KNOW ───────────────────────────────────────────
//
// Base Set Gust of Wind and its Base Set 2 reprint are the same illustration in
// the same frame; what tells them apart is a set symbol and a number a few
// pixels tall. Neither image signal this scanner has can see that: the dHash is
// a 9x8 picture of the whole card, and the embedding was trained NOT to tell
// same-art printings apart (asking it to taught it scan colour). Yet both will
// still answer — and on the owner's own verified photos (2026-10-10, 218 cards
// checked by eye), the ladder named the right card in the WRONG printing 21
// times, confidently: Base Set read as Base Set 2 or Legendary Collection, the
// hash at distance 4-7, the vector at margins up to 0.2 (the catalogue's Base
// Set scans carry a colour cast its reprints do not), and the printed NAME
// "corroborating" whichever printing the picture picked, because the name is
// on every printing. For a collection that is a wrong answer — the price gap
// between a Base Set and a Base Set 2 card is the whole value.
//
// So: an image signal may name a card that HAS same-art siblings only as far
// as the family. Which printing it is belongs to a printed key the OCR read
// (set badge, number with denominator, name with number) — or to the reader.
//
// ── THE TABLE ───────────────────────────────────────────────────────────────
//
// data/art-families.json, built by scripts/scan-bench/art_families.py from
// same_art.py's image comparison (ORB on CLAHE luma under one near-identity
// homography — colour-blind, crop-blind) plus the 9x8 dHash, plus a foil pass
// for holo vs non-holo printings of one picture (Jungle, Fossil, Team Rocket,
// e-Card: the foil scrambles the art features, so the frame's homography lays
// one card over the other and the shared FIGURE is compared), transitive.
// Rebuild it when the catalogue gains sets; a card missing from it is treated
// as having no siblings, which is the behaviour before this file existed.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ArtFamiliesFile {
  as_of: string;
  method: string;
  cards: number;
  families: string[][];
}

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
const FILE = JSON.parse(readFileSync(join(DATA_DIR, 'art-families.json'), 'utf8')) as ArtFamiliesFile;

const FAMILY_OF = new Map<string, readonly string[]>();
for (const fam of FILE.families) {
  const frozen = Object.freeze([...fam]);
  for (const id of fam) FAMILY_OF.set(id, frozen);
}

/** The other printings that share this card's picture (empty when none). */
export function artSiblings(cardId: string): readonly string[] {
  const fam = FAMILY_OF.get(cardId);
  return fam ? fam.filter((id) => id !== cardId) : [];
}

/**
 * POST /scan's half of the guard: is the printing of this hash top-1 still
 * open? True when the card shares its picture with another printing, so a hash
 * within its own bar names the family and not the printing. `router.ts` reports
 * it as `printingOpen: true` with `matched: false`; the scan bench replays it.
 * Undefined (no top-1) is never open.
 */
export function printingOpenFor(topCardId: string | undefined): boolean {
  return topCardId != null && artSiblings(topCardId).length > 0;
}

/**
 * The WotC era (1999-2003): Base Set to the e-Card sets. Every card shares one
 * yellow frame and one layout, which is most of what a 9x8 hash of the whole
 * card sees.
 */
const WOTC_SETS: ReadonlySet<string> = new Set([
  'base1', 'base2', 'base3', 'base4', 'base5', 'basep',
  'gym1', 'gym2', 'neo1', 'neo2', 'neo3', 'neo4', 'si1', 'lc',
  'ecard1', 'ecard2', 'ecard3', 'bog',
]);

/**
 * May the HASH name this top-1 on its own? Not when its printing is open (a
 * same-art family), and not for a WotC-era card at all.
 *
 * Measured on the owner's verified photos (2026-10-10, 96 vintage crops): within
 * today's bar the hash's confident vintage answers were 21 exact, 21 the wrong
 * printing and 22 A DIFFERENT CARD of 64 (a Hitmonchan named lc-79 Machop at
 * distance 4), and under the client's solo gate 8 of 11 vintage claims were
 * wrong — the shared frame dominates the hash. A vintage card still reaches a
 * confident answer through the resolve leg (the printed number, the vector, the
 * name); only the hash's shortcut is closed.
 */
export function hashMayNameAlone(topCardId: string | undefined): boolean {
  if (topCardId == null || printingOpenFor(topCardId)) return false;
  return !WOTC_SETS.has(topCardId.slice(0, topCardId.lastIndexOf('-')));
}
