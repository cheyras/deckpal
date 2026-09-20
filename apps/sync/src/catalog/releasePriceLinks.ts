// Release-scoped price-link overlay for sets whose TCGdex upstream has no
// thirdParty.tcgplayer data yet, verified against authoritative TCGCSV sources.
//
// SCOPE: Only two English sets — 30th (ME: 30th Celebration, group 24722)
// and 30th-c (ME: 30th Celebration Classic Collection, group 24837).
//
// This registry is consumed by the catalog importer to fill tcgplayer_group_id
// on card_set and (tcgplayer_product_id, tcgplayer_printing) on card_variant,
// so the TCGCSV price ingest can resolve and join these sets.
//
// AUTHORITY (captured 2026-09-19, see evidence/ in the task directory):
//   Products: https://tcgcsv.com/tcgplayer/3/24722/products
//             https://tcgcsv.com/tcgplayer/3/24837/products
//   Prices:   https://tcgcsv.com/tcgplayer/3/24722/prices  (161 Holofoil, 51 Normal=sealed)
//             https://tcgcsv.com/tcgplayer/3/24837/prices  (30 Holofoil)
//   Cards:    https://api.tcgdex.net/v2/en/sets/30th       (158 cards)
//             https://api.tcgdex.net/v2/en/sets/30th-c     (30 cards)
//   LEGEND halves: https://api.tcgdex.net/v2/en/cards/30th-c-019 (no `attacks` key = Top)
//                  https://api.tcgdex.net/v2/en/cards/30th-c-020 (has attacks   = Bottom)
//
// JOIN METHOD — 30th main (158/158 verified):
//   Collector number identity: TCGdex localId NNN <-> TCGCSV extendedData Number NNN/128.
//   Name cross-check on the 158 catalog cards: 156 exact, 1 Nidoran♀ vs "Nidoran F"
//   (explicit ♀<->F normalization, allowed), and 1 "Poké Pad" (30th-126) whose TCGCSV
//   product name is the de-accented "Poke Pad" — matched by the same NFKD
//   combining-mark removal the production resolver already applies in
//   normalizeCardName, so the accented and de-accented names fold equal. Every
//   linked numbered product has a Holofoil price row.
//
// JOIN METHOD — 30th-c classic (30/30 verified):
//   Curated exact name match after stripping TCGCSV qualifiers
//   ((Delta Species), (Team Plasma), (Prime), LV.X, (Top), (Bottom)); localIds in
//   30th-c do NOT line up with the original-set collector numbers TCGCSV uses.
//   Darkrai & Cresselia LEGEND halves distinguished by POSITIVE evidence from the
//   per-card TCGdex endpoints: 30th-c-019 has NO `attacks` field (Top half) ->
//   TCGCSV "Darkrai & Cresselia Legend (Top)" (pid 716199, 99/102);
//   30th-c-020 HAS `attacks` (Lost Crisis, Moon's Invite) (Bottom half) ->
//   TCGCSV "...(Bottom)" (pid 716200, 100/102). Both endpoints fetched and saved.
//
// EXCLUDED: 3 Mew RGB products (pids 717607/717608/717609, numbers R/RGB, G/RGB,
//   B/RGB) — alpha collector numbers with no TCGdex catalog card. Also excluded:
//   all sealed products (booster packs, ETBs, mini tins, figure collections).
//   30th-126 "Poké Pad" IS linked (product 716515 "Poke Pad", Number 126/128):
//   the accented TCGdex name and the de-accented TCGCSV name are equivalent
//   under the resolver's NFKD combining-mark removal — not a force-map.
//
// CONFLICT PRECEDENCE (no SQL COALESCE anywhere — the prior global COALESCE that
//   preserved stale ids across unrelated sets is removed):
//   - The set-level group fallback (getOverlay) is a pure TypeScript static
//     value computed BEFORE the INSERT, applied only when upstream is NULL.
//   - The per-variant resolver (resolveReleasePriceLink) refuses to overlay when
//     upstream already carries a nonnull product id, when an upstream group id
//     conflicts with the overlay's group, when the variant is not the canonical
//     synthesized singleton (normal/standard/no-foil/no-stamp), or when name /
//     collector-number / set / language identity fails. On refusal it returns
//     null and the importer keeps the original upstream fields untouched.
//   - ON CONFLICT writes EXCLUDED for tcgplayer_group_id, tcgplayer_product_id
//     and tcgplayer_printing, so a NULL upstream value writes NULL — it does not
//     silently keep a stale id written by some other source.

import type { RawCard, PlannedVariant } from './transform.js';

/** A verified link from one catalog card/variant to its TCGplayer product. */
export interface ReleasePriceLink {
  /** TCGdex card id, e.g. '30th-001' */
  cardId: string;
  /** TCGdex localId (collector number), e.g. '001' */
  localId: string;
  /** Canonical TCGdex card name — the exact identity the resolver checks against */
  cardName: string;
  /** TCGplayer product id */
  productId: number;
  /** TCGplayer printing name (the subTypeName the price join uses) */
  printing: string;
}

/** Per-set overlay: group id + per-card product links. */
export interface ReleaseSetOverlay {
  /** TCGdex set id */
  setId: string;
  /** TCGplayer group id for card_set.tcgplayer_group_id */
  groupId: number;
  /** Source URL for audit trail */
  sourceUrl: string;
  /** Per-card links keyed by TCGdex card id */
  links: ReadonlyMap<string, ReleasePriceLink>;
}

// ── 30th main set: 158 of 158 cards linked, group 24722 ──────────────────────
// [cardId, localId, canonicalCardName, productId] — collector-number join.
// 30th-126 "Poké Pad" maps to product 716515 "Poke Pad" (de-accented in TCGCSV).
// The resolver's normalizeCardName drops combining marks via NFKD, so the
// accented TCGdex name "Poké Pad" and the de-accented TCGCSV name "Poke Pad"
// fold to the same value — this is accent equivalence, not a force-map; it is
// the same NFKD combining-mark removal already present in the production
// resolver. The pinned cardName carries the actual accented canonical form.
const MAIN_LINKS: [string, string, string, number][] = [
  ['30th-001', '001', 'Exeggcute', 716435],
  ['30th-002', '002', 'Alolan Exeggutor', 716436],
  ['30th-003', '003', 'Volbeat', 716437],
  ['30th-004', '004', 'Illumise', 716438],
  ['30th-005', '005', 'Tropius', 716439],
  ['30th-006', '006', 'Cherubi', 716440],
  ['30th-007', '007', 'Cherrim', 716441],
  ['30th-008', '008', 'Vivillon', 716442],
  ['30th-009', '009', 'Vulpix', 716443],
  ['30th-010', '010', 'Ninetales', 716444],
  ['30th-011', '011', 'Moltres', 716445],
  ['30th-012', '012', 'Ho-Oh', 716446],
  ['30th-013', '013', 'Victini', 696830],
  ['30th-014', '014', 'Reshiram', 716447],
  ['30th-015', '015', 'Fuecoco ex', 716448],
  ['30th-016', '016', 'Slowpoke', 716449],
  ['30th-017', '017', 'Lapras', 716450],
  ['30th-018', '018', 'Articuno', 716451],
  ['30th-019', '019', 'Kyogre', 716452],
  ['30th-020', '020', 'Palkia', 716453],
  ['30th-021', '021', 'Greninja ex', 696676],
  ['30th-022', '022', 'Wishiwashi', 716454],
  ['30th-023', '023', 'Pikachu', 712934],
  ['30th-024', '024', 'Pikachu', 716309],
  ['30th-025', '025', 'Pikachu', 712935],
  ['30th-026', '026', 'Pikachu', 712936],
  ['30th-027', '027', 'Pikachu', 716310],
  ['30th-028', '028', 'Pikachu', 712937],
  ['30th-029', '029', 'Pikachu', 716311],
  ['30th-030', '030', 'Pikachu', 712938],
  ['30th-031', '031', 'Pikachu', 716312],
  ['30th-032', '032', 'Pikachu', 712939],
  ['30th-033', '033', 'Pikachu', 712940],
  ['30th-034', '034', 'Pikachu', 712941],
  ['30th-035', '035', 'Pikachu', 716313],
  ['30th-036', '036', 'Pikachu', 696680],
  ['30th-037', '037', 'Pikachu', 696681],
  ['30th-038', '038', 'Pikachu', 712942],
  ['30th-039', '039', 'Pikachu', 712943],
  ['30th-040', '040', 'Pikachu', 712944],
  ['30th-041', '041', 'Pikachu', 712945],
  ['30th-042', '042', 'Pikachu', 712946],
  ['30th-043', '043', 'Pikachu', 712947],
  ['30th-044', '044', 'Pikachu', 712948],
  ['30th-045', '045', 'Pikachu', 716314],
  ['30th-046', '046', 'Pikachu', 716315],
  ['30th-047', '047', 'Pikachu', 696682],
  ['30th-048', '048', 'Pikachu', 716316],
  ['30th-049', '049', 'Pikachu', 712949],
  ['30th-050', '050', 'Pikachu', 712950],
  ['30th-051', '051', 'Pikachu', 716317],
  ['30th-052', '052', 'Pikachu', 716318],
  ['30th-053', '053', 'Pikachu ex', 712951],
  ['30th-054', '054', 'Pikachu ex', 712952],
  ['30th-055', '055', 'Zapdos', 716455],
  ['30th-056', '056', 'Zekrom', 716456],
  ['30th-057', '057', 'Zeraora', 696831],
  ['30th-058', '058', 'Toxel', 716457],
  ['30th-059', '059', 'Toxtricity', 716458],
  ['30th-060', '060', 'Toxtricity', 716459],
  ['30th-061', '061', 'Morpeko', 716460],
  ['30th-062', '062', 'Miraidon', 716461],
  ['30th-063', '063', 'Mewtwo', 716462],
  ['30th-064', '064', 'Mewtwo ex', 716463],
  ['30th-065', '065', 'Mew', 716464],
  ['30th-066', '066', 'Mew ex', 716465],
  ['30th-067', '067', 'Marill', 716466],
  ['30th-068', '068', 'Azumarill', 716467],
  ['30th-069', '069', 'Espeon', 696678],
  ['30th-070', '070', 'Espeon ex', 696834],
  ['30th-071', '071', 'Sylveon ex', 696677],
  ['30th-072', '072', 'Unown', 716468],
  ['30th-073', '073', 'Drifloon', 716469],
  ['30th-074', '074', 'Cresselia', 716470],
  ['30th-075', '075', 'Chandelure', 716471],
  ['30th-076', '076', 'Xerneas', 716472],
  ['30th-077', '077', 'Comfey', 716473],
  ['30th-078', '078', 'Cosmog', 716474],
  ['30th-079', '079', 'Cosmoem', 716475],
  ['30th-080', '080', 'Lunala', 716476],
  ['30th-081', '081', 'Gimmighoul', 716477],
  ['30th-082', '082', 'Groudon', 716478],
  ['30th-083', '083', 'Lucario', 716479],
  ['30th-084', '084', 'Seismitoad', 716480],
  ['30th-085', '085', 'Lycanroc', 716481],
  ['30th-086', '086', 'Koraidon', 716482],
  ['30th-087', '087', 'Nidoran♀', 716483],
  ['30th-088', '088', 'Nidorina', 716484],
  ['30th-089', '089', 'Alolan Meowth', 714359],
  ['30th-090', '090', 'Gengar ex', 716485],
  ['30th-091', '091', 'Umbreon', 696679],
  ['30th-092', '092', 'Umbreon ex', 696835],
  ['30th-093', '093', 'Murkrow', 716486],
  ['30th-094', '094', 'Scraggy', 716487],
  ['30th-095', '095', 'Zorua', 716488],
  ['30th-096', '096', 'Zoroark', 716489],
  ['30th-097', '097', 'Deino', 716490],
  ['30th-098', '098', 'Zweilous', 716491],
  ['30th-099', '099', 'Hydreigon', 716492],
  ['30th-100', '100', 'Yveltal', 716493],
  ['30th-101', '101', 'Galarian Meowth', 716494],
  ['30th-102', '102', 'Jirachi ex', 716495],
  ['30th-103', '103', 'Dialga', 716496],
  ['30th-104', '104', 'Ferrothorn', 716497],
  ['30th-105', '105', 'Solgaleo', 716498],
  ['30th-106', '106', 'Zacian', 716499],
  ['30th-107', '107', 'Zamazenta', 716500],
  ['30th-108', '108', 'Gholdengo', 716501],
  ['30th-109', '109', 'Salamence ex', 716502],
  ['30th-110', '110', 'Jangmo-o', 716503],
  ['30th-111', '111', 'Hakamo-o', 716504],
  ['30th-112', '112', 'Kommo-o', 716505],
  ['30th-113', '113', 'Meowth', 714356],
  ['30th-114', '114', 'Kangaskhan', 716506],
  ['30th-115', '115', 'Ditto', 716507],
  ['30th-116', '116', 'Eevee', 714357],
  ['30th-117', '117', 'Eevee', 696832],
  ['30th-118', '118', 'Eevee', 696833],
  ['30th-119', '119', 'Snorlax', 716508],
  ['30th-120', '120', 'Igglybuff', 716509],
  ['30th-121', '121', 'Lugia', 716510],
  ['30th-122', '122', 'Hisuian Zorua', 716511],
  ['30th-123', '123', 'Hisuian Zoroark', 716512],
  ['30th-124', '124', 'Minior', 716513],
  ['30th-125', '125', 'Maushold', 716514],
  ['30th-126', '126', 'Poké Pad', 716515],
  ['30th-127', '127', 'Switch', 716516],
  ['30th-128', '128', 'Ultra Ball', 716517],
  ['30th-129', '129', 'Alolan Exeggutor', 716218],
  ['30th-130', '130', 'Moltres', 716219],
  ['30th-131', '131', 'Lapras', 696683],
  ['30th-132', '132', 'Articuno', 716220],
  ['30th-133', '133', 'Zapdos', 716221],
  ['30th-134', '134', 'Toxtricity', 716222],
  ['30th-135', '135', 'Morpeko', 716223],
  ['30th-136', '136', 'Drifloon', 696684],
  ['30th-137', '137', 'Chandelure', 716224],
  ['30th-138', '138', 'Lycanroc', 696685],
  ['30th-139', '139', 'Alolan Meowth', 714360],
  ['30th-140', '140', 'Scraggy', 716225],
  ['30th-141', '141', 'Galarian Meowth', 716226],
  ['30th-142', '142', 'Gholdengo', 716227],
  ['30th-143', '143', 'Kommo-o', 717621],
  ['30th-144', '144', 'Meowth', 714358],
  ['30th-145', '145', 'Hisuian Zorua', 696686],
  ['30th-146', '146', 'Maushold', 716228],
  ['30th-147', '147', 'Fuecoco ex', 716229],
  ['30th-148', '148', 'Greninja ex', 716230],
  ['30th-149', '149', 'Pikachu ex', 712953],
  ['30th-150', '150', 'Pikachu ex', 712954],
  ['30th-151', '151', 'Mewtwo ex', 717603],
  ['30th-152', '152', 'Mew ex', 717605],
  ['30th-153', '153', 'Sylveon ex', 716231],
  ['30th-154', '154', 'Gengar ex', 717610],
  ['30th-155', '155', 'Jirachi ex', 716232],
  ['30th-156', '156', 'Salamence ex', 716233],
  ['30th-157', '157', 'Mewtwo ex', 696687],
  ['30th-158', '158', 'Mew ex', 696688],
];

// ── 30th-c classic collection: 30 cards, group 24837 ──────────────────────────
// [cardId, localId, canonicalCardName, productId] — curated exact name match;
// LEGEND 019/020 split verified by attack presence on the per-card TCGdex endpoints.
const CLASSIC_LINKS: [string, string, string, number][] = [
  ['30th-c-001', '001', 'Charizard', 714372],
  ['30th-c-002', '002', 'Delcatty', 716156],
  ['30th-c-003', '003', 'Metagross', 716157],
  ['30th-c-004', '004', 'Genesect EX', 716158],
  ['30th-c-005', '005', 'Misty', 716159],
  ['30th-c-006', '006', 'Dark Tyranitar', 716160],
  ['30th-c-007', '007', 'Sneasel', 716161],
  ['30th-c-008', '008', 'Pikachu & Zekrom GX', 714373],
  ['30th-c-009', '009', 'Greninja BREAK', 716162],
  ['30th-c-010', '010', 'Uxie', 716163],
  ['30th-c-011', '011', 'Crobat G', 716191],
  ['30th-c-012', '012', 'Raikou', 716192],
  ['30th-c-013', '013', 'Buzzwole GX', 716193],
  ['30th-c-014', '014', 'Pikachu', 716194],
  ['30th-c-015', '015', "Erika's Jigglypuff", 716195],
  ['30th-c-016', '016', 'Rayquaza EX', 716196],
  ['30th-c-017', '017', 'Solgaleo GX', 716197],
  ['30th-c-018', '018', 'Gengar', 716198],
  ['30th-c-019', '019', 'Darkrai & Cresselia LEGEND', 716199],
  ['30th-c-020', '020', 'Darkrai & Cresselia LEGEND', 716200],
  ['30th-c-021', '021', 'N', 716202],
  ['30th-c-022', '022', 'Palkia', 716203],
  ['30th-c-023', '023', 'M Gardevoir EX', 716204],
  ['30th-c-024', '024', 'Shining Celebi', 716205],
  ['30th-c-025', '025', 'Scizor ex', 716206],
  ['30th-c-026', '026', 'Mew VMAX', 716207],
  ['30th-c-027', '027', 'Arceus VSTAR', 716208],
  ['30th-c-028', '028', 'Zacian V', 716209],
  ['30th-c-029', '029', 'Lugia', 714386],
  ['30th-c-030', '030', 'Magikarp', 716210],];

function buildMap(pairs: [string, string, string, number][], printing: string): ReadonlyMap<string, ReleasePriceLink> {
  const m = new Map<string, ReleasePriceLink>();
  for (const [cardId, localId, cardName, productId] of pairs) {
    m.set(cardId, { cardId, localId, cardName, productId, printing });
  }
  return m;
}

const OVERLAYS: ReadonlyMap<string, ReleaseSetOverlay> = new Map([
  ['30th', {
    setId: '30th',
    groupId: 24722,
    sourceUrl: 'https://tcgcsv.com/tcgplayer/3/24722/products',
    links: buildMap(MAIN_LINKS, 'Holofoil'),
  }],
  ['30th-c', {
    setId: '30th-c',
    groupId: 24837,
    sourceUrl: 'https://tcgcsv.com/tcgplayer/3/24837/products',
    links: buildMap(CLASSIC_LINKS, 'Holofoil'),
  }],
]);

/**
 * Look up a release-scoped price-link overlay for a set.
 * Returns undefined for sets not covered by this registry.
 *
 * Used by the importer ONLY for the set-level `tcgplayer_group_id` static
 * fallback (computed before the INSERT, applied when upstream is NULL). The
 * per-variant product link is resolved by {@link resolveReleasePriceLink}.
 */
export function getOverlay(tcgdexSetId: string): ReleaseSetOverlay | undefined {
  return OVERLAYS.get(tcgdexSetId);
}

/**
 * Normalize a card name for the exact-identity check.
 *
 * Folds accents (NFKD + drop combining marks), folds the curly apostrophe,
 * maps the gender glyphs ♀/♂ to F/M, lowercases, and collapses ALL whitespace.
 * The whitespace collapse is the explicit Nidoran♀ <-> "Nidoran F" allowance
 * (the one allowed source-name mismatch); it cannot cause false matches here
 * because the name is only ever compared against the single pinned name for an
 * already-resolved cardId, never across different cards.
 */
function normalizeCardName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/♀/g, 'F')
    .replace(/♂/g, 'M')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Resolve a release-scoped TCGplayer price link for one planned variant.
 *
 * This is the ONLY boundary the importer consumes for product ids. It returns
 * the verified (groupId, productId, printing) triple, or `null` to REFUSE the
 * overlay — in which case the importer keeps the original upstream fields
 * untouched and writes whatever upstream provided (including NULL).
 *
 * Refusal conditions (all checked; order is not part of the contract):
 *  - `language` is not `'en'` (this overlay is English-only).
 *  - `setId` is not one of the two covered sets.
 *  - `card.set.id` does not agree with `setId` (canonical set vs provided set).
 *  - the variant is a supported canonical singleton: either the synthesized
 *    singleton `planCardVariants` produces for zero-variant cards, OR a real
 *    upstream variant that carries the explicit `generated` variantId (the
 *    marker TCGdex emits for the canonical generated variant) — both with the
 *    canonical facet (finish `normal`, size `standard`, no subtype, no foil,
 *    no stamps). Any other real holo/reverse/stamped/oversize/subtype variant,
 *    including a future real normal variant WITHOUT the `generated` marker, is
 *    refused until separately verified.
 *  - `variant.tcgplayerProductId` is nonnull (upstream already has an id — it wins).
 *  - `groupId` is nonnull and conflicts with the overlay's group id
 *    (a conflicting upstream group prevents the product fallback).
 *  - `card.id` is not in the overlay.
 *  - `card.localId` does not match the pinned collector number.
 *  - `card.name` does not match the pinned canonical name (normalized, with the
 *    explicit Nidoran♀/Nidoran F allowance).
 */
export function resolveReleasePriceLink(input: {
  language: string;
  setId: string;
  /** Upstream TCGplayer group id for the SET (raw, before any fallback). */
  groupId: number | null;
  card: RawCard;
  variant: PlannedVariant;
  /** Number of variants the card's plan produced. */
  variantCount: number;
}): { groupId: number; productId: number; printing: string } | null {
  const { language, setId, groupId, card, variant, variantCount } = input;

  if (language !== 'en') return null;
  const overlay = OVERLAYS.get(setId);
  if (!overlay) return null;
  if (card.set?.id !== setId) return null;
  if (variantCount !== 1) return null;

  // The supported canonical variant is the synthesized singleton (the shape
  // `planCardVariants` produces for zero-variant cards) OR a real upstream
  // variant carrying the explicit `generated` variantId (the marker TCGdex
  // emits for the canonical generated variant). Both must still present the
  // canonical facet below. Any other real holo/reverse/stamped/oversize/
  // subtype variant — including a future real normal variant WITHOUT the
  // `generated` marker — is refused until separately verified.
  const isSupportedVariant = variant.isSynthesized || variant.tcgdexVariantId === 'generated';
  if (!isSupportedVariant) return null;
  const f = variant.facet;
  if (
    !f ||
    f.finish !== 'normal' ||
    f.subtype !== null ||
    f.size !== 'standard' ||
    f.foil !== null ||
    f.stamps.length !== 0
  ) {
    return null;
  }

  if (variant.tcgplayerProductId != null) return null;
  if (groupId != null && groupId !== overlay.groupId) return null;

  const link = overlay.links.get(card.id);
  if (!link) return null;
  if (card.localId !== link.localId) return null;
  if (normalizeCardName(card.name) !== normalizeCardName(link.cardName)) return null;

  return { groupId: overlay.groupId, productId: link.productId, printing: link.printing };
}
