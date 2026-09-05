// THE CLOSED VOCABULARY — every set code that is physically printed on a card.
//
// Copied from `roadmap/plans/card-scanner-redesign/p2-work/ocr/CROSSWALK.md`
// §2.5 ("The 29 printed-era sets, with the numbers a lookup needs"), which is
// the authority. If a new set prints, that table is where the row is added
// first and this file is the transcription — not the other way round.
//
// ── WHY THE TABLE IS 29 ROWS AND NOT THE WHOLE CATALOG ──────────────────────
//
// A printed set code exists only from Scarlet & Violet (2023-03-31) onward.
// CROSSWALK §3.1: 16,264 of 21,068 physical cards — 77 % of the catalog —
// predate it and print no code at all. So a read that resolves to none of these
// 29 is not necessarily a bad read; it is the overwhelmingly common case, and
// the resolution ladder (§7.3) is built to land on number+denominator instead.
//
// ── WHY `denominator: null` IS A VALUE AND NOT A GAP ────────────────────────
//
// Four of the 29 print no denominator: the two energy sets (`SVE`, `MEE`) and
// the two promo sets (`SVP`, `MEP`). Their `null` is load-bearing evidence, not
// missing data — see `eliminatedByDenominator` in `fields.ts`, and REPORT.md
// §4.2, where treating it as "nothing to compare, so exempt" produced the
// bakeoff's ONLY false accept.

export interface PrintedSet {
  /** The three-glyph code as printed, uppercase. */
  code: string
  /**
   * The denominator printed after the collector number (`nnn/182`), or null for
   * the four sets that print no denominator at all. NOT the set's card count:
   * `total` in CROSSWALK §2.5 runs higher because secret rares number above the
   * printed denominator (`sv10` prints /182 and goes to 244).
   */
  denominator: number | null
  /** TCGdex set id, so a resolved code can be handed to the catalog. */
  setId: string
}

/** CROSSWALK.md §2.5, transcribed. Order is the crosswalk's (release order). */
export const PRINTED_SETS: readonly PrintedSet[] = [
  { code: 'SVE', denominator: null, setId: 'sve' }, // Scarlet & Violet Energy
  { code: 'SVP', denominator: null, setId: 'svp' }, // SVP Black Star Promos
  { code: 'SVI', denominator: 198, setId: 'sv01' },
  { code: 'PAL', denominator: 193, setId: 'sv02' },
  { code: 'MCD23', denominator: 15, setId: '2023sv' }, // printing unverified — §9.1
  { code: 'OBF', denominator: 197, setId: 'sv03' },
  { code: 'MEW', denominator: 165, setId: 'sv03.5' },
  { code: 'MFB', denominator: 48, setId: 'mfb' }, // printing unverified — §9.1
  { code: 'PAR', denominator: 182, setId: 'sv04' },
  { code: 'PAF', denominator: 91, setId: 'sv04.5' },
  { code: 'TEF', denominator: 162, setId: 'sv05' },
  { code: 'TWM', denominator: 167, setId: 'sv06' },
  { code: 'SFA', denominator: 64, setId: 'sv06.5' },
  { code: 'SCR', denominator: 142, setId: 'sv07' },
  { code: 'SSP', denominator: 191, setId: 'sv08' },
  { code: 'MCD24', denominator: 15, setId: '2024sv' }, // printing unverified — §9.1
  { code: 'PRE', denominator: 131, setId: 'sv08.5' },
  { code: 'JTG', denominator: 159, setId: 'sv09' },
  { code: 'DRI', denominator: 182, setId: 'sv10' },
  { code: 'WHT', denominator: 86, setId: 'sv10.5w' },
  { code: 'BLK', denominator: 86, setId: 'sv10.5b' },
  { code: 'MEE', denominator: null, setId: 'mee' }, // Mega Evolution Energy
  { code: 'MEP', denominator: null, setId: 'mep' }, // MEP Black Star Promos
  { code: 'MEG', denominator: 132, setId: 'me01' },
  { code: 'PFL', denominator: 94, setId: 'me02' },
  { code: 'ASC', denominator: 217, setId: 'me02.5' },
  { code: 'POR', denominator: 88, setId: 'me03' },
  { code: 'CRI', denominator: 86, setId: 'me04' },
  { code: 'PBL', denominator: 84, setId: 'me05' },
]

/** code → printed denominator (null for the four that print none). */
export const PRINTED_DENOMINATOR: ReadonlyMap<string, number | null> = new Map(
  PRINTED_SETS.map((s) => [s.code, s.denominator]),
)

/** code → TCGdex set id. Not used by the extractor; the resolve endpoint wants
 *  the code, and this is here so a caller never has to re-derive the mapping. */
export const PRINTED_SET_ID: ReadonlyMap<string, string> = new Map(
  PRINTED_SETS.map((s) => [s.code, s.setId]),
)
