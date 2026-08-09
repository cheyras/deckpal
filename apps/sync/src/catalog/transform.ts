// Pure, DB-free transforms for the TCGdex catalog import.
// Everything here is a deterministic function of the compiled-JSON card/set/series
// shapes (wiki: Data-Layer §3), so it can be unit-tested without a database.
// SCHEMA references are to research/SCHEMA.md.

export const TIER_RULE_VERSION = 3;

// ── raw upstream shapes (only the fields we read) ────────────────────────────
export interface RawVariant {
  type: string; // finish: normal|reverse|holo|lenticular|metal  (NON_NULL upstream)
  subtype?: string; // print_subtype (nullable)
  size: string; // standard|jumbo  (NON_NULL upstream)
  foil?: string; // nullable
  stamp?: string[]; // 0..2
  variantId: string; // NOT per-row unique — a facet-tuple hash (see importer notes)
  thirdParty?: { tcgplayer?: number; cardmarket?: number; cardtrader?: number };
}
export interface RawCard {
  id: string;
  localId: string;
  name: string;
  category: string;
  rarity?: string;
  illustrator?: string;
  hp?: number;
  stage?: string;
  suffix?: string;
  evolveFrom?: string;
  trainerType?: string;
  energyType?: string;
  retreat?: number;
  effect?: string;
  regulationMark?: string;
  updated?: string;
  types?: string[];
  attacks?: { name: string; damage?: string | number; effect?: string; cost?: string[] }[];
  abilities?: { type?: string; name: string; effect?: string }[];
  weaknesses?: { type: string; value: string }[];
  resistances?: { type: string; value: string }[];
  legal?: { standard?: boolean; expanded?: boolean };
  variants_detailed?: RawVariant[];
  thirdParty?: { tcgplayer?: number; cardmarket?: number; cardtrader?: number };
  set: { id: string };
}

// ── facet vocabulary labels ──────────────────────────────────────────────────
export const FINISH_LABEL: Record<string, string> = {
  normal: 'Normal',
  reverse: 'Reverse Holofoil',
  holo: 'Holofoil',
  lenticular: 'Lenticular',
  metal: 'Metal',
};
const ORGANISED_PLAY_FOILS = new Set(['league', 'player-reward', 'professor-program']);
const PACK_FINISHES = new Set(['normal', 'holo', 'reverse']);

// Seeded (013) foil / subtype labels, so we can compose display names and upsert any unseeded ones.
export const FOIL_LABEL: Record<string, string> = {
  energy: 'Energy', cosmos: 'Cosmos', pokeball: 'Poke Ball Pattern', masterball: 'Master Ball Pattern',
  rainbow: 'Rainbow', gold: 'Gold', galaxy: 'Galaxy', 'cracked-ice': 'Cracked Ice',
  duskball: 'Dusk Ball Pattern', loveball: 'Love Ball Pattern', friendball: 'Friend Ball Pattern',
  quickball: 'Quick Ball Pattern', tinsel: 'Tinsel', 'team-rocket': 'Team Rocket', mirror: 'Mirror',
  starlight: 'Starlight', league: 'League', 'player-reward': 'Player Reward',
  'professor-program': 'Professor Program',
};
export const SUBTYPE_LABEL: Record<string, string> = {
  shadowless: 'Shadowless', 'gold-border': 'Gold Border', glossy: 'Glossy',
  '1999-2000-copyright': '1999-2000 Copyright', '1999-copyright': '1999 Copyright',
  unlimited: 'Unlimited', 'no-e-reader': 'No E-Reader', 'blue-border': 'Blue Border',
  'shadowless-red-cheek': 'Shadowless Red Cheek', 'japanese-back': 'Japanese Back',
  'missing-expansion-symbol': 'Missing Expansion Symbol', 'aoki-error': 'Aoki Error',
  'no-holo-error': 'No Holo Error', 'rarity-error': 'Rarity Error', 'missing-hp': 'Missing HP',
  'evolution-box-error': 'Evolution Box Error', 'd-ink-dot-error': 'D Ink Dot Error',
  'energy-symbol-error': 'Energy Symbol Error', 'text-error': 'Text Error',
  'shifted-energy-cost': 'Shifted Energy Cost',
};
// Subtypes NOT flagged is_error (SCHEMA §4.5.2). Any subtype absent here that we insert is an error.
export const NON_ERROR_SUBTYPES = new Set([
  'shadowless', '1999-2000-copyright', 'unlimited', 'no-e-reader', 'blue-border',
  'shadowless-red-cheek', 'japanese-back', 'gold-border', 'glossy', '1999-copyright',
]);

export function humanize(code: string): string {
  return code
    .split('-')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
export function foilLabel(code: string): string {
  return FOIL_LABEL[code] ?? humanize(code);
}
export function subtypeLabel(code: string): string {
  return SUBTYPE_LABEL[code] ?? humanize(code);
}
export function stampLabel(code: string): string {
  // display-only; e.g. 'gamestop' -> 'Gamestop Stamp', 'jason-klaczynski' -> 'Jason Klaczynski Stamp'
  return `${humanize(code)} Stamp`;
}

// ── the normalized facet tuple ───────────────────────────────────────────────
export interface Facet {
  finish: string;
  subtype: string | null;
  size: string;
  foil: string | null;
  stamps: string[]; // sorted, deduped
}
export function toFacet(v: RawVariant): Facet {
  const stamps = Array.from(new Set(v.stamp ?? [])).sort();
  return {
    finish: v.type,
    subtype: v.subtype ?? null,
    size: v.size,
    foil: v.foil ?? null,
    stamps,
  };
}
export const SYNTHESIZED_FACET: Facet = {
  finish: 'normal', subtype: null, size: 'standard', foil: null, stamps: [],
};

// deterministic slug of the facet tuple -> variant_kind.code (SCHEMA §4.3)
export function variantKindCode(f: Facet): string {
  const parts: string[] = [f.finish];
  if (f.subtype) parts.push(f.subtype);
  if (f.foil) parts.push(`foil-${f.foil}`);
  if (f.size !== 'standard') parts.push(f.size);
  for (const s of f.stamps) parts.push(`stamp-${s}`);
  return parts.join('-');
}

export function isOrganisedPlayFoil(foil: string | null): boolean {
  return foil != null && ORGANISED_PLAY_FOILS.has(foil);
}

// tier rule v3 (SCHEMA §5.3) — pure function of facets.
export function tierDerived(f: Facet): 'standard' | 'special' {
  const standard =
    f.stamps.length === 0 &&
    f.size === 'standard' &&
    PACK_FINISHES.has(f.finish) &&
    (f.foil === null || !isOrganisedPlayFoil(f.foil)) &&
    (f.subtype === null || f.subtype === 'unlimited');
  return standard ? 'standard' : 'special';
}

// print run code (SCHEMA §5.4.1) — first match wins.
export function printRunCode(f: Facet): string {
  if (f.stamps.includes('1st-edition')) return 'first';
  if (f.subtype === 'shadowless') return 'shadowless';
  if (f.subtype === 'no-e-reader') return 'no-e-reader';
  if (f.subtype === null || f.subtype === 'unlimited') return 'base';
  return f.subtype; // one print_run row per other subtype, is_base=false
}

// provenance sentence (SCHEMA §5.4.1/§5.4.2) — only for actual booster pulls.
export function provenance(f: Facet): string | null {
  const otherStamps = f.stamps.filter((s) => s !== '1st-edition');
  const packLike =
    f.size === 'standard' &&
    PACK_FINISHES.has(f.finish) &&
    (f.foil === null || !isOrganisedPlayFoil(f.foil)) &&
    otherStamps.length === 0;
  if (!packLike) return null;
  switch (printRunCode(f)) {
    case 'base':
      return 'Found in Booster Packs';
    case 'first':
      return 'Found in First Print Run Booster Packs';
    case 'shadowless':
      return 'Found in Shadowless Print Run Booster Packs';
    default:
      return null; // no-e-reader / other runs: unobserved -> render nothing
  }
}

// ── display name composition (SCHEMA §5.4.2) — verified 5/5 against pkmn.gg captures §12.2 ──
function editionPrefix(f: Facet, siblings: Facet[]): string {
  if (f.stamps.includes('1st-edition')) return '1st Edition';
  // 'Unlimited' iff a sibling is identical except it carries the 1st-edition stamp.
  const target = [...f.stamps, '1st-edition'].sort().join('|');
  const hasFirstEdSibling = siblings.some(
    (s) =>
      s !== f &&
      s.finish === f.finish &&
      s.subtype === f.subtype &&
      s.size === f.size &&
      s.foil === f.foil &&
      s.stamps.slice().sort().join('|') === target,
  );
  return hasFirstEdSibling ? 'Unlimited' : '';
}
function printRunDisplayLabel(f: Facet): string {
  // driven by SUBTYPE, not by print_run_code (the 1st-edition stamp drives editionPrefix instead)
  if (f.subtype && f.subtype !== 'unlimited') return subtypeLabel(f.subtype);
  return '';
}
function trailingStampLabels(f: Facet): string {
  return f.stamps
    .filter((s) => s !== '1st-edition')
    .map(stampLabel)
    .join(' ');
}
export function displayName(f: Facet, siblings: Facet[]): string {
  const segs = [
    editionPrefix(f, siblings),
    f.foil ? foilLabel(f.foil) : '',
    FINISH_LABEL[f.finish] ?? humanize(f.finish),
    printRunDisplayLabel(f),
    trailingStampLabels(f),
    f.size !== 'standard' ? 'Jumbo' : '',
  ];
  return segs.filter((s) => s.length > 0).join(' ');
}

// vocabulary-level label for variant_kind.display_name (no card-scoped edition prefix). Display only.
export function kindDisplayName(f: Facet): string {
  const segs = [
    f.foil ? foilLabel(f.foil) : '',
    FINISH_LABEL[f.finish] ?? humanize(f.finish),
    printRunDisplayLabel(f),
    f.stamps.map(stampLabel).join(' '),
    f.size !== 'standard' ? 'Jumbo' : '',
  ];
  const s = segs.filter((x) => x.length > 0).join(' ');
  return s.length > 0 ? s : (FINISH_LABEL[f.finish] ?? humanize(f.finish));
}

// tcgplayer printing name (the ?Printing= param / TCGCSV subTypeName the price sync joins on)
export function tcgplayerPrinting(finish: string): string | null {
  if (finish === 'normal') return 'Normal';
  if (finish === 'holo') return 'Holofoil';
  if (finish === 'reverse') return 'Reverse Holofoil';
  return null; // lenticular / metal
}

// ── card-scalar transforms ───────────────────────────────────────────────────
export function normalizeName(name: string): string {
  // casefold + fold both apostrophe codepoints (U+2019 -> U+0027) — DEX-DATA §A.4 Farfetch'd.
  return name.normalize('NFC').replace(/’/g, "'").toLowerCase();
}
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
// §8.4: NULL unless local_id is purely numeric (TCGCSV numbers are always plain digits).
export function localIdNumeric(localId: string): number | null {
  return /^\d+$/.test(localId) ? parseInt(localId, 10) : null;
}
// number_sort collation key (SCHEMA §6/§13 Q1 [X]): every digit run zero-padded to 9 so a TEXT sort
// orders '13' after '006' and keeps lettered prefixes grouped. Deterministic.
export function numberSort(localId: string): string {
  return localId.replace(/\d+/g, (d) => d.padStart(9, '0'));
}

// ── primary-variant selection (at most one per card; SCHEMA §4.4 partial unique) ──
// Prefer a standard-tier, plainest base printing; finish order normal < holo < reverse.
const FINISH_RANK: Record<string, number> = { normal: 0, holo: 1, reverse: 2, lenticular: 3, metal: 4 };
export function pickPrimaryIndex(facets: Facet[]): number {
  let best = 0;
  let bestKey: number[] | null = null;
  for (let i = 0; i < facets.length; i++) {
    const f = facets[i]!;
    const key = [
      tierDerived(f) === 'standard' ? 0 : 1,
      f.stamps.length === 0 ? 0 : 1,
      f.foil === null ? 0 : 1,
      f.subtype === null || f.subtype === 'unlimited' ? 0 : 1,
      FINISH_RANK[f.finish] ?? 9,
      i, // stable tiebreak on upstream order
    ];
    if (bestKey === null || lexLess(key, bestKey)) {
      bestKey = key;
      best = i;
    }
  }
  return best;
}
function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (av !== bv) return av < bv;
  }
  return false;
}

// ── per-card variant plan (dedup on facet tuple; keep upstream order) ────────
export interface PlannedVariant {
  facet: Facet;
  code: string;
  tcgdexVariantId: string | null;
  sortOrder: number;
  isPrimary: boolean;
  isSynthesized: boolean;
  tcgplayerProductId: number | null;
  cardmarketProductId: number | null;
  cardtraderProductId: number | null;
  tcgplayerPrinting: string | null;
  idSource: 'variant' | 'card' | 'none';
  idConfidence: number;
  displayName: string;
  provenance: string | null;
}

export interface PlanResult {
  variants: PlannedVariant[];
  droppedDuplicates: number; // exact facet-tuple dupes within this card (upstream artifacts)
}

export function planCardVariants(card: RawCard): PlanResult {
  const raw = card.variants_detailed ?? [];
  const cardTP = card.thirdParty ?? {};
  const seen = new Map<string, RawVariant>();
  let dropped = 0;
  const orderedFacets: { facet: Facet; code: string; raw: RawVariant }[] = [];
  for (const v of raw) {
    const facet = toFacet(v);
    const code = variantKindCode(facet);
    if (seen.has(code)) {
      dropped++;
      continue; // exact facet-tuple duplicate within one card -> collapse (SCHEMA UNIQUE)
    }
    seen.set(code, v);
    orderedFacets.push({ facet, code, raw: v });
  }

  if (orderedFacets.length === 0) {
    // 75 zero-variant cards -> synthesize a normal/standard variant (SCHEMA §4.5.3)
    const f = SYNTHESIZED_FACET;
    return {
      droppedDuplicates: dropped,
      variants: [
        {
          facet: f,
          code: variantKindCode(f),
          tcgdexVariantId: null,
          sortOrder: 0,
          isPrimary: true,
          isSynthesized: true,
          tcgplayerProductId: cardTP.tcgplayer ?? null,
          cardmarketProductId: cardTP.cardmarket ?? null,
          cardtraderProductId: cardTP.cardtrader ?? null,
          tcgplayerPrinting: tcgplayerPrinting(f.finish),
          idSource: cardTP.tcgplayer != null || cardTP.cardmarket != null ? 'card' : 'none',
          idConfidence: cardTP.tcgplayer != null || cardTP.cardmarket != null ? 100 : 0,
          displayName: displayName(f, [f]),
          provenance: provenance(f),
        },
      ],
    };
  }

  const facets = orderedFacets.map((o) => o.facet);
  const primaryIdx = pickPrimaryIndex(facets);
  const variants = orderedFacets.map((o, i) => {
    const vTP = o.raw.thirdParty ?? {};
    const tcgplayer = vTP.tcgplayer ?? cardTP.tcgplayer ?? null;
    const cardmarket = vTP.cardmarket ?? cardTP.cardmarket ?? null;
    const cardtrader = vTP.cardtrader ?? cardTP.cardtrader ?? null;
    const variantHasPrimary = vTP.tcgplayer != null || vTP.cardmarket != null;
    const cardHasPrimary = cardTP.tcgplayer != null || cardTP.cardmarket != null;
    const hasPrimaryId = tcgplayer != null || cardmarket != null;
    let idSource: 'variant' | 'card' | 'none' = 'none';
    if (variantHasPrimary) idSource = 'variant';
    else if (cardHasPrimary && hasPrimaryId) idSource = 'card';
    return {
      facet: o.facet,
      code: o.code,
      tcgdexVariantId: o.raw.variantId ?? null,
      sortOrder: i,
      isPrimary: i === primaryIdx,
      isSynthesized: false,
      tcgplayerProductId: tcgplayer,
      cardmarketProductId: cardmarket,
      cardtraderProductId: cardtrader,
      tcgplayerPrinting: tcgplayerPrinting(o.facet.finish),
      idSource,
      idConfidence: idSource === 'none' ? 0 : 100,
      displayName: displayName(o.facet, facets),
      provenance: provenance(o.facet),
    };
  });
  return { variants, droppedDuplicates: dropped };
}
