// ── Sets whose symbol IS their printed code ──────────────────────────────────
//
// From Scarlet & Violet on, a card prints no set symbol at all: its set mark is
// the three-letter code in a black box (SVI, PAL, MEG, PBL, …), and the upstream
// "symbol" asset for those sets is just a raster of that box. Those rasters are
// tiny — 25–38px; `me01`'s is 25×25 and `me02`'s 25×15 — so on a 3× phone the
// set tile blew them up three- and four-fold and MEG smudged into "M.EG" (owner,
// 2026-11-27, at 428px). The code is TEXT, so `SetSymbolTile` draws it — as the
// card prints it, plate and keyline and all (components/printedMark.ts): vector, crisp
// at every density and every tile size, and no asset at all.
//
// The codes come from the scanner's closed vocabulary (`scan/ocr/codes.ts`,
// transcribed from CROSSWALK §2.5) — the one table in this app of what is
// physically printed on a card — so the tile and the scanner agree. That table
// includes the two energy sets: `sve` prints SVE and `mee` prints MEE, which is
// what the owner asked their rows to show instead of a cluster of energy
// symbols ("it just says M-E-E… that's what we should use").
//
// EVERY code below was checked against crops of real cards on 2026-11-27: two
// to six cards per set from the image tier — the first card and one from the
// middle of the first page always, plus a trainer, the first secret rare and
// the last card for a dozen sets. All 26 rows the scanner's table supplies are
// right. The check also found four sets that print a code the scanner's table
// does not have or spells differently; they are in CODES_READ_FROM_CARDS.
//
// Left out, on purpose:
//   • `svp` — it prints SVP in a plate, like `mep` prints MEP, but its upstream
//     symbol is the Black Star PROMO star, which the tile's image ladder shows
//     and which says "promo" better than three letters (2026-11-27).
//   • `mfb` (My First Battle) — prints NO code: checked on four cards, the print
//     line is just the illustrator.
//   • `30th-c` (30th Celebration Classic Collection) — reprints that keep their
//     ORIGINAL print line (a Magikarp prints "G PAL EN 203/193", a Misty prints
//     none), so the set has no single code.
import { PRINTED_SETS } from '../scan/ocr/codes'

const EXCLUDED = new Set(['svp', 'mfb'])

/**
 * Printed codes read off card crops (2026-11-27) for sets the scanner's table
 * (`scan/ocr/codes.ts`, which this module may only read) lacks or spells
 * differently. Each wants folding into that table; a test fails once it has
 * been, so this list cannot quietly outlive the reason for it.
 */
export const CODES_READ_FROM_CARDS: Readonly<Record<string, string>> = {
  // McDonald's Collections: "M23 EN" / "M24 EN" on cards 1, 5, 8 and 15 of each.
  // The table has MCD23 / MCD24 ("printing unverified"), which is not printed.
  '2023sv': 'M23',
  '2024sv': 'M24',
  // McDonald's 2026: "M26 EN" on cards 1, 8 and 15. Not in the table.
  '2026me': 'M26',
  // 30th Celebration: "30C EN" on cards 001, 060, 100, 126 and 129. Not in the table.
  '30th': '30C',
}

const CODE_BY_SET: ReadonlyMap<string, string> = new Map([
  ...PRINTED_SETS.filter((s) => /^[A-Z0-9]{3}$/.test(s.code) && !EXCLUDED.has(s.setId)).map(
    (s) => [s.setId, s.code] as const,
  ),
  ...Object.entries(CODES_READ_FROM_CARDS),
])

/** The code printed as a set's mark (e.g. `me01` → MEG), or null when the set's mark is a symbol. */
export function printedSetCode(setId?: string | null): string | null {
  return setId ? (CODE_BY_SET.get(setId.toLowerCase()) ?? null) : null
}

/** Every set drawn as its printed code, set id → code. */
export function printedSetCodes(): ReadonlyMap<string, string> {
  return CODE_BY_SET
}
