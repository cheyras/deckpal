/**
 * Canonical rarity ladder for sorting. `card.rarity` is a free-text label from
 * TCGdex, so a plain ORDER BY sorts alphabetically ("Uncommon" > "Ultra Rare"),
 * which is issue 2026-07-30_00-38-11-751: rarity DESC started at diamonds.
 *
 * Ranks ascend with rarity. Sources for the ordering:
 * - Modern era (SV / Mega Evolution): official Japanese rarity codes
 *   C < U < R < RR (Double Rare) < AR (Illustration Rare) < SR (Ultra Rare)
 *   < SAR (Special Illustration Rare) < UR (Hyper Rare), corroborated by
 *   English pull-rate data (tcgplayer.com "Scarlet & Violet Pull Rates").
 * - SWSH era: C < U < Rare < Rare Holo < V < VMAX/VSTAR < Radiant/Amazing
 *   < Ultra Rare (full arts) < baby Shiny < Shiny V/VMAX < Secret Rare (gold).
 * - TCG Pocket: in-game order ◊ < ◊◊ < ◊◊◊ < ◊◊◊◊ < ☆ < ☆☆ < ☆☆☆ < ✵ < ✵✵ < ♛.
 *
 * Ranks are spaced so new tiers can slot in without renumbering. Every DISTINCT
 * rarity in the DB must have an entry; genuinely unknown labels fall through
 * ILIKE tier heuristics (closest-tier placement) before the mid-ladder default,
 * so a new rarity never lands at a random end of the sort.
 */
export const RARITY_RANK: Readonly<Record<string, number>> = {
  // Rarity-less / promotional
  'None': 0,
  'Promo': 5,
  // Baseline ladder (all eras) + TCG Pocket diamonds
  'Common': 10,
  'One Diamond': 10,
  'Uncommon': 20,
  'Two Diamond': 20,
  'Rare': 30,
  'Three Diamond': 30,
  'Rare Holo': 40,
  'Holo Rare': 40,
  'Four Diamond': 40,
  // DP / HGSS chase tiers
  'Rare Holo LV.X': 42,
  'Rare PRIME': 44,
  'LEGEND': 46,
  // SWSH V family
  'Holo Rare V': 48,
  'Holo Rare VMAX': 50,
  'Holo Rare VSTAR': 50,
  // One-per-deck special holos (SWSH)
  'Radiant Rare': 52,
  'Amazing Rare': 52,
  // SV/ME Double Rare (RR) and ACE SPEC
  'Double rare': 54,
  'ACE SPEC Rare': 55,
  // Celebrations Classic Collection reprint slot
  'Classic Collection': 56,
  // Art rares (SV AR) + Pocket ☆
  'Illustration rare': 58,
  'One Star': 58,
  // Full-art tier (SV SR / SWSH full arts) + Pocket ☆☆
  'Full Art Trainer': 62,
  'Ultra Rare': 62,
  'Two Star': 62,
  // Shiny tiers + Pocket ✵/✵✵
  'Shiny rare': 66,
  'One Shiny': 66,
  'Shiny rare V': 68,
  'Two Shiny': 68,
  'Shiny rare VMAX': 70,
  'Shiny Ultra Rare': 70,
  // Special art tier (SV SAR) + Pocket ☆☆☆ (immersive)
  'Special illustration rare': 74,
  'Three Star': 74,
  // Gold / top chase tiers
  'Secret Rare': 80,
  'Hyper rare': 80,
  'Black White Rare': 84,
  'Mega Hyper Rare': 86,
  'Crown': 90,
};

/** Keyword heuristics for rarities not in the map yet (new sets before this
 * ladder is updated): place them next to their closest tier. First match wins. */
const FALLBACK_TIERS: ReadonlyArray<readonly [pattern: string, rank: number]> = [
  ['%special illustration%', 74],
  ['%mega hyper%', 86],
  ['%hyper%', 80],
  ['%secret%', 80],
  ['%crown%', 90],
  ['%shiny%', 66],
  ['%illustration%', 58],
  ['%full art%', 62],
  ['%ultra%', 62],
  ['%holo%', 40],
  ['%rare%', 30],
  ['%promo%', 5],
];

/** Rank for a label no rule recognises: treat as a garden-variety Rare so it
 * sorts mid-ladder rather than at either extreme of ASC/DESC. */
const UNKNOWN_RANK = 30;

const sq = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/**
 * SQL expression mapping a rarity column to its integer rank, for ORDER BY.
 * Never yields NULL, so ASC/DESC behave symmetrically regardless of NULLS
 * FIRST/LAST (NULL rarity falls into the unknown default). All literals come
 * from the static tables above — nothing user-supplied is interpolated.
 */
export function raritySortSql(col: string): string {
  const exact = Object.entries(RARITY_RANK)
    .map(([name, rank]) => `WHEN ${col} = ${sq(name)} THEN ${rank}`)
    .join(' ');
  const fuzzy = FALLBACK_TIERS
    .map(([pattern, rank]) => `WHEN ${col} ILIKE ${sq(pattern)} THEN ${rank}`)
    .join(' ');
  return `(CASE ${exact} ${fuzzy} ELSE ${UNKNOWN_RANK} END)`;
}
