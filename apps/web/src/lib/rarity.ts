// ─────────────────────────────────────────────────────────────────────────────
// Printed rarity marks for the TCG catalog.
//
// THE PRINT IS THE SOURCE OF TRUTH. Every entry below was read off a real
// high-resolution card scan (one per rarity); the card each claim was verified
// against is cited in the per-entry comment, so a future reader can re-check it.
// Scans live at https://images.pokemontcg.io/<set>/<number>_hires.png.
//
// The old `rarityGlyph()` in format.ts collapsed all 30 catalog values to five
// Unicode characters — a circle, a diamond, a single star, two stars, and a
// catch-all diamond — which rendered Hyper Rare (three gold stars on the real
// card) as one plain "☆". We now draw each mark ourselves as original SVG
// geometry: the correct SHAPE, COUNT, and COLOUR, rather than copies of TPCi
// artwork (there is no cleanly licensed source for the symbols).
//
// THE OFFICIAL STAR LADDER (Pokemon's own Scarlet & Violet rarity key, which a
// contract test pins): the classic three are a circle / diamond / star, then the
// SV ladder steps up by COUNT and COLOUR —
//   Common          = one BLACK circle            (me1/001)
//   Uncommon        = one BLACK diamond            (me1/005)
//   Rare            = one BLACK star               (me1/010)
//   Double rare     = TWO BLACK stars              (me1/003)
//   Ultra Rare      = TWO SILVER stars             (me1/155)
//   Illustration rare       = ONE GOLD star        (me1/133)
//   Special illustration rare = TWO GOLD stars     (me1/177)
//   Hyper rare      = THREE GOLD stars             (jtg/188)
//   Mega Hyper Rare = a four-point gold sparkle    (me1/187)
//   None            = no mark at all
//
// WHAT 'BLACK' AND 'WHITE' MEAN HERE. The printed colour tracks the card's own
// background — a star is inked black on a pale card and white on a dark one —
// so it is contrast, not identity. Our UI draws on ONE dark surface, so the
// 'black' tone resolves to currentColor and both black- and white-printed stars
// are the REGULAR five-point star in our vocabulary. The real distinction that
// must survive is REGULAR versus GOLD; we do not invent a matte-vs-metallic
// treatment to separate Double rare from Ultra Rare (on the card they are both
// plain stars and in the app they are allowed to look alike).
//
// The remaining catalog values (the Holo / Shiny / V / VMAX / VSTAR / PRIME /
// LEGEND / ACE SPEC / Amazing / Radiant / Black White family and so on) each get
// a deliberate mark chosen from the same vocabulary, cited per entry. Six of
// them used to render an invented LETTER BADGE (a 'wordmark' with a word like
// 'PRIME', 'LEGEND', 'RADIANT', 'TGU', 'V', 'SH') where the physical card simply
// prints a plain star — that is the exact defect the owner complained about for
// set symbols, reproduced in the rarity marks, and it is corrected below: every
// one of those now draws the star (or, for Shiny rare V, nothing at all) the
// scan actually shows. The only remaining wordmarks are Classic Collection
// (unverified) and Amazing Rare (a small multicolour mark that is not a star).
// No value falls through to a generic default silently.
// ─────────────────────────────────────────────────────────────────────────────

export type RarityShape =
  | 'circle'
  | 'diamond'
  | 'star'
  | 'star-outline'
  | 'star-double-stroke'
  | 'none'
  | 'promo-star'
  | 'wordmark'

// `black` is special: the renderer inherits `currentColor` so the mark still
// reads where the surrounding text colour changes (light surfaces, inverted
// rows). `silver` and `gold` are real metal fills so they read on the app's dark
// surfaces. `white` is the bright holo/silver-white used by the secret tier.
// `magenta` is the modern ACE SPEC pink; `rainbow` is the Amazing Rare starburst.
export type RarityTone = 'black' | 'silver' | 'gold' | 'white' | 'magenta' | 'rainbow'

export interface RarityMarkSpec {
  shape: RarityShape
  /** integer 0–3: how many copies of the shape to draw in a tight row */
  count: number
  tone: RarityTone
  /** human name — the tooltip / accessible name for the mark */
  label: string
  note?: string
  /** short suffix word printed beside the star for `wordmark` shapes (Classic Collection 'C', Amazing 'A') */
  word?: string
}

// The catalog rarity strings are the keys, SPELLED EXACTLY as the upstream
// catalog returns them — including its inconsistent capitalisation
// ('Double rare' and 'Illustration rare' are lowercase-r; 'Ultra Rare' and
// 'ACE SPEC Rare' are capital-R). Do not normalise these.
export const RARITY_MARKS: Record<string, RarityMarkSpec> = {
  // ── classic three ──────────────────────────────────────────────────────
  // me1/001 — one solid black circle.
  Common: { shape: 'circle', count: 1, tone: 'black', label: 'Common' },
  // me1/005 — one solid black diamond.
  Uncommon: { shape: 'diamond', count: 1, tone: 'black', label: 'Uncommon' },
  // me1/010 — one solid black star.
  Rare: { shape: 'star', count: 1, tone: 'black', label: 'Rare' },

  // ── SV star ladder ──────────────────────────────────────────────────────
  // me1/003 — two black stars.
  'Double rare': { shape: 'star', count: 2, tone: 'black', label: 'Double rare' },
  // me1/155 — two white stars (printed white on a dark card → silver in our vocabulary).
  'Ultra Rare': { shape: 'star', count: 2, tone: 'silver', label: 'Ultra Rare' },
  // me1/133 — one gold star.
  'Illustration rare': { shape: 'star', count: 1, tone: 'gold', label: 'Illustration rare' },
  // me1/177 — two gold stars.
  'Special illustration rare': { shape: 'star', count: 2, tone: 'gold', label: 'Special illustration rare' },
  // jtg/188 — THREE gold stars (the correction that matters most).
  'Hyper rare': { shape: 'star', count: 3, tone: 'gold', label: 'Hyper rare' },
  // me1/187 — a four-point gold sparkle, distinct from the five-point star.
  // Rendered as a clean gold sparkle (no dark inner fill); see RarityMark.tsx.
  'Mega Hyper Rare': {
    shape: 'star-double-stroke',
    count: 1,
    tone: 'gold',
    label: 'Mega Hyper Rare',
    note: 'four-point gold sparkle (me1/187); visually distinct from the plain five-point star',
  },
  // No rarity string on the card → no mark at all.
  None: { shape: 'none', count: 0, tone: 'black', label: 'None' },

  // ── Promo / Black Star Promos ───────────────────────────────────────────
  // UNVERIFIED — left exactly as-is (no scan checked). Do not change without a card.
  Promo: { shape: 'promo-star', count: 1, tone: 'black', label: 'Promo' },

  // ── Holo family ─────────────────────────────────────────────────────────
  // swsh12tg/TG01 — one solid star. The holo finish is a foil, not a different
  // shape or a metallic tone, so this is the regular star (no invented silver).
  'Holo Rare': {
    shape: 'star',
    count: 1,
    tone: 'black',
    label: 'Holo Rare',
    note: 'one solid star (swsh12tg/TG01); the holographic foil is a finish, not a different shape',
  },
  // dp5/1 — one solid black star (the same solid star as Rare).
  'Rare Holo': {
    shape: 'star',
    count: 1,
    tone: 'black',
    label: 'Rare Holo',
    note: 'one solid black star (dp5/1); the same solid star as Rare',
  },
  // swsh12tg/TG12 — one SOLID star. We previously drew it hollow (star-outline);
  // the scan shows a solid star, so it is now the regular solid star.
  'Holo Rare V': {
    shape: 'star',
    count: 1,
    tone: 'black',
    label: 'Holo Rare V',
    note: 'one solid star (swsh12tg/TG12); was drawn hollow, the scan shows solid',
  },
  // swsh12tg/TG15 — no rarity symbol is visible after the number on this scan.
  // Chose to mirror Holo Rare V (the rest of the V-family): one solid black star.
  // See summary.
  'Holo Rare VMAX': {
    shape: 'star',
    count: 1,
    tone: 'black',
    label: 'Holo Rare VMAX',
    note: 'no symbol visible on the scan (swsh12tg/TG15); mirrors the V-family solid star',
  },
  // swsh12/008 — one black star. Was the wordmark 'V'; the card prints a plain star.
  'Holo Rare VSTAR': {
    shape: 'star',
    count: 1,
    tone: 'black',
    label: 'Holo Rare VSTAR',
    note: 'one black star (swsh12/008); was the wordmark "V", the card prints a plain star',
  },

  // ── Secret tier ──────────────────────────────────────────────────────────
  // swsh12pt5gg/GG67 — one white star (the Galarian Gallery secret print).
  'Secret Rare': {
    shape: 'star',
    count: 1,
    tone: 'white',
    label: 'Secret Rare',
    note: 'one white star (swsh12pt5gg/GG67); the secret-tier bright silver-white',
  },

  // ── Shiny family ─────────────────────────────────────────────────────────
  // paf/092 — one hollow gold star.
  'Shiny rare': { shape: 'star-outline', count: 1, tone: 'gold', label: 'Shiny rare', note: 'one hollow gold star (paf/092)' },
  // paf/212 — TWO hollow gold stars.
  'Shiny Ultra Rare': {
    shape: 'star-outline',
    count: 2,
    tone: 'gold',
    label: 'Shiny Ultra Rare',
    note: 'two hollow gold stars (paf/212)',
  },
  // swsh45sv/SV105 — NO rarity symbol is printed on this card at all. Was the
  // wordmark 'SH'; renders nothing now, like None.
  'Shiny rare V': {
    shape: 'none',
    count: 0,
    tone: 'black',
    label: 'Shiny rare V',
    note: 'no rarity symbol printed (swsh45sv/SV105); was the wordmark "SH", now renders nothing',
  },
  // swsh45sv/SV106 — one small white star. Was the wordmark 'SH'.
  'Shiny rare VMAX': {
    shape: 'star',
    count: 1,
    tone: 'silver',
    label: 'Shiny rare VMAX',
    note: 'one small white star (swsh45sv/SV106); was the wordmark "SH"',
  },

  // ── Legacy LV.X ──────────────────────────────────────────────────────────
  // pl1/122 — one solid black star. "LV.X" appears in the card title, not in the
  // symbol; was drawn hollow, the scan shows a solid star.
  'Rare Holo LV.X': {
    shape: 'star',
    count: 1,
    tone: 'black',
    label: 'Rare Holo LV.X',
    note: 'one solid black star (pl1/122); "LV.X" is in the card title, not the symbol',
  },

  // ── ACE SPEC (modern magenta revival) ────────────────────────────────────
  // sv6/152 — one magenta/pink star.
  'ACE SPEC Rare': {
    shape: 'star',
    count: 1,
    tone: 'magenta',
    label: 'ACE SPEC Rare',
    note: 'one magenta-pink star (sv6/152)',
  },

  // ── Star (not wordmark) rarities that previously rendered a letter badge ──
  // hgss2/84 — one black star. Was the wordmark 'PRIME'; the card prints a plain star.
  'Rare PRIME': {
    shape: 'star',
    count: 1,
    tone: 'black',
    label: 'Rare PRIME',
    note: 'one black star (hgss2/84); was the wordmark "PRIME", the card prints a plain star',
  },
  // hgss2/90 — one HOLLOW star. Was the wordmark 'LEGEND'; the card prints a hollow star.
  LEGEND: {
    shape: 'star-outline',
    count: 1,
    tone: 'black',
    label: 'LEGEND',
    note: 'one hollow star (hgss2/90); was the wordmark "LEGEND", the card prints a hollow star',
  },
  // swsh12/016 — one black star. Was the wordmark 'RADIANT'; the card prints a plain star.
  'Radiant Rare': {
    shape: 'star',
    count: 1,
    tone: 'black',
    label: 'Radiant Rare',
    note: 'one black star (swsh12/016); was the wordmark "RADIANT", the card prints a plain star',
  },
  // swsh12tg/TG23 — one black star. Was the wordmark 'TGU'; the card prints a plain star.
  'Full Art Trainer': {
    shape: 'star',
    count: 1,
    tone: 'black',
    label: 'Full Art Trainer',
    note: 'one black star (swsh12tg/TG23); was the wordmark "TGU", the card prints a plain star',
  },

  // ── Wordmark rarities (star + a narrow suffix) ───────────────────────────
  // UNVERIFIED — left exactly as-is (no scan checked). Do not change without a card.
  'Classic Collection': { shape: 'wordmark', count: 1, tone: 'black', label: 'Classic Collection', word: 'C' },

  // ── Amazing Rare (rainbow faceted mark, NOT a star) ───────────────────────
  // swsh45/017 — a small multicolour mark, not a star; kept as the rainbow wordmark.
  'Amazing Rare': { shape: 'wordmark', count: 1, tone: 'rainbow', label: 'Amazing Rare', word: 'A' },

  // ── Black Bolt / White Flare ─────────────────────────────────────────────
  // UNVERIFIED — left exactly as-is (no scan checked). Do not change without a card.
  'Black White Rare': {
    shape: 'star-outline',
    count: 2,
    tone: 'black',
    label: 'Black White Rare',
    note: 'UNVERIFIED (no scan obtained). Drawn as two hollow stars; if a scan shows the two differ, split the spec rather than editing this note.',
  },
}

// Null / undefined rarity → no mark at all (a true no-rarity card prints nothing).
const NULL_SPEC: RarityMarkSpec = { shape: 'none', count: 0, tone: 'black', label: '' }

// A novel, non-null string we have never heard of → a neutral outlined silver
// star, so a future catalog value degrades visibly rather than vanishing. A
// casing change never reaches here: the case-insensitive pass below catches it.
const UNKNOWN_SPEC: RarityMarkSpec = {
  shape: 'star-outline',
  count: 1,
  tone: 'silver',
  label: 'Unknown rarity',
}

/**
 * Total rarity-mark lookup. Never throws. Resolves the raw catalog rarity
 * string to its {@link RarityMarkSpec}; falls back case-insensitively so a
 * future catalog casing change degrades gracefully, then to a neutral spec for
 * a genuinely novel string, and to no mark at all for null / undefined.
 */
export function rarityMark(rarity: string | null | undefined): RarityMarkSpec {
  if (rarity == null) return NULL_SPEC
  const exact = RARITY_MARKS[rarity]
  if (exact) return exact
  const lower = rarity.toLowerCase()
  for (const key of Object.keys(RARITY_MARKS)) {
    if (key.toLowerCase() === lower) return RARITY_MARKS[key]
  }
  return UNKNOWN_SPEC
}
