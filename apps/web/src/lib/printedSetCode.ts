// ── Sets whose symbol IS their printed code ──────────────────────────────────
//
// From Scarlet & Violet on, a card prints no set symbol at all: its set mark is
// the three-letter code in a black box (SVI, PAL, MEG, PBL, …), and the upstream
// "symbol" asset for those sets is just a raster of that box. Those rasters are
// tiny — 25–38px; `me01`'s is 25×25 and `me02`'s 25×15 — so on a 3× phone the
// set tile blew them up three- and four-fold and MEG smudged into "M.EG" (owner,
// 2026-11-27, at 428px). The code is TEXT, so `SetSymbolTile` draws it as text:
// a vector badge is crisp at every density and every tile size, and needs no
// asset at all.
//
// The codes come from the scanner's closed vocabulary (`scan/ocr/codes.ts`,
// transcribed from CROSSWALK §2.5) — the one table in this app of what is
// physically printed on a card — so the tile and the scanner cannot disagree.
// That table includes the two energy sets: `sve` prints SVE and `mee` prints
// MEE, which is what the owner asked their rows to show instead of a cluster of
// energy symbols ("it just says M-E-E… that's what we should use").
//
// Left out, on purpose:
//   • `svp` — its printed code is SVP but its symbol is the Black Star PROMO
//     star, which the tile's image ladder already shows.
//   • the McDonald's and My First Battle rows — marked "printing unverified" in
//     the crosswalk, and the McDonald's symbols print M23/M24, not MCD23/MCD24.
//     The three-letter test drops MCDxx; `mfb` is named here.
import { PRINTED_SETS } from '../scan/ocr/codes'

const EXCLUDED = new Set(['svp', 'mfb'])

const CODE_BY_SET: ReadonlyMap<string, string> = new Map(
  PRINTED_SETS.filter((s) => /^[A-Z]{3}$/.test(s.code) && !EXCLUDED.has(s.setId)).map((s) => [s.setId, s.code]),
)

/** The code printed as a set's mark (e.g. `me01` → MEG), or null when the set's mark is a symbol. */
export function printedSetCode(setId?: string | null): string | null {
  return setId ? (CODE_BY_SET.get(setId.toLowerCase()) ?? null) : null
}
