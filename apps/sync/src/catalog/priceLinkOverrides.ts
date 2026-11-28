// Verified per-printing TCGplayer links that win over what TCGdex says.
//
// WHY THIS EXISTS. A card's price and its "Buy on TCGplayer" button both come from one pair on its
// `card_variant`: (tcgplayer_product_id, tcgplayer_printing). TCGdex supplies that pair, and the
// weekly catalog import rewrites it from TCGdex every time (import.ts, `= EXCLUDED`, no COALESCE).
// The TCGCSV link pass (prices/linkTcgcsv.ts) only fills a NULL, and refuses whenever the match is
// a guess. So two kinds of card can never be fixed by either path:
//   - TCGdex names the WRONG product: an Aquapolis "b" card pointing at its "a" twin, a Classic
//     Collection reprint pointing at the main Celebrations card, two trainer-kit energies sharing
//     one product. The import puts the wrong id back every week, and the link pass never touches a
//     non-NULL id.
//   - TCGdex names none, and the honest match is one the link pass is right to refuse in general:
//     a trainer-kit card TCGplayer names "Poke Ball (Noivern)", a promo TCGplayer lists only as
//     "(Prerelease)", a product filed in another TCGplayer group than the set's.
// Each entry below was checked by hand against TCGplayer's own record of the product (TCGCSV
// `/3/<group>/products` and `/prices`): the name, the collector number (letter suffix included), the
// group, and the printing (TCGCSV `subTypeName`) the product is priced under.
//
// HOW IT IS APPLIED. Both writers of the pair honour it, so neither can undo the other:
//   - import.ts writes the override in place of TCGdex's value (or of the release overlay's).
//   - linkTcgcsv.ts writes it before planning, so a fix lands on the next price run instead of the
//     next weekly import, and the planner treats the override's (product, printing) as taken.
//   - The price ingest (prices/tcgcsv.ts) prices an override whose product lives outside its set's
//     group from that group, by product id: the set walk only joins a set's own group.
//
// IDENTITY. An entry is keyed by TCGdex card id + variant kind, and also pins the set, the
// collector number and the card name. If any of them stops agreeing (TCGdex re-keys or renames the
// card), the entry is refused and the upstream value stands: the override can only ever apply to
// the printing it was verified for. Refusals are logged.
//
// NOT HERE, ON PURPOSE: printings TCGplayer does not list. Linking them to a neighbouring product
// would quote another printing's price. Checked the same way on 2026-11-27:
//   - mep-064 Serperior, mep-067 Doublade, mep-074 Delphox, mep-075 Ampharos, mep-076 Crobat,
//     mep-077 Goodra (plain holo): group 24451 lists only "<Name> - 0NN" and "<Name> - 0NN [Staff]",
//     which TCGdex already links to the set-logo-stamped and staff printings.
//   - mep-120 Celebratory Fanfare: group 24451 lists Celebratory Fanfare only at 028.
//   - svp-190 Pikachu (plain): group 22872 lists one "Pikachu - 190", which TCGdex links to the
//     Worlds 2024 stamped printing.
//   - det1-25 Lt. Yoshida: group 2409 (Detective Pikachu) lists cards 1-18 only.
// Correct already, so not here either:
//   - tk-sm-r-3 Lightning Energy -> 152852 "Lightning Energy (#3)". TCGplayer files its number as
//     2/30; the name says #3, and 152851 "Lightning Energy (#2)" 2/30 is the #2 card (below).

import { foldName } from '../prices/linkMatch.js';

export interface PriceLinkOverride {
  /** TCGdex card id, e.g. 'ecard2-50b'. */
  cardId: string;
  /** TCGdex set id the card must still belong to. */
  setId: string;
  /** Collector number the card must still carry. */
  localId: string;
  /** Catalog card name the card must still carry (compared folded: accents, quotes, case). */
  cardName: string;
  /** `card_variant.variant_kind_code` of the printing this links. */
  kind: string;
  /** TCGplayer group the product is listed in. */
  groupId: number;
  productId: number;
  /** The printing TCGplayer prices the product under (TCGCSV `subTypeName`). */
  printing: string;
  /** The product id TCGdex carried for this printing when it was verified (null = none). */
  was: number | null;
  /** TCGplayer's own record of the product: name and number as TCGCSV lists them. */
  evidence: string;
}

type Row = [
  cardId: string, setId: string, localId: string, cardName: string, kind: string,
  groupId: number, productId: number, printing: string, was: number | null, evidence: string,
];

// Verified 2026-11-27 against TCGCSV group products + prices.
const ROWS: Row[] = [
  // ── Aquapolis (group 1397): TCGdex links each of these to its a/b twin's product ──
  ['ecard2-50b', 'ecard2', '50b', 'Golduck', 'normal', 1397, 85814, 'Normal', 85813, '"Golduck (50b)" 050b/147'],
  ['ecard2-50b', 'ecard2', '50b', 'Golduck', 'reverse', 1397, 85814, 'Reverse Holofoil', 85813, '"Golduck (50b)" 050b/147'],
  ['ecard2-74b', 'ecard2', '74b', 'Drowzee', 'normal', 1397, 84972, 'Normal', 84971, '"Drowzee (74b)" 074b/147'],
  ['ecard2-95a', 'ecard2', '95a', 'Mr. Mime', 'normal', 1397, 87590, 'Normal', 87591, '"Mr. Mime (95a)" 095a/147'],
  ['ecard2-95a', 'ecard2', '95a', 'Mr. Mime', 'reverse', 1397, 87590, 'Reverse Holofoil', 87591, '"Mr. Mime (95a)" 095a/147'],
  ['ecard2-103b', 'ecard2', '103b', 'Porygon', 'normal', 1397, 88307, 'Normal', 88306, '"Porygon (103b)" 103b/147'],
  ['ecard2-103b', 'ecard2', '103b', 'Porygon', 'reverse', 1397, 88307, 'Reverse Holofoil', 88306, '"Porygon (103b)" 103b/147'],

  // ── Celebrations: Classic Collection (group 2931): TCGdex links the main Celebrations card ──
  // A reprint prints the original card's number: these are Black & White 113/114 and 114/114.
  ['cel25cc-CC020', 'cel25cc', 'CC020', 'Reshiram', 'holo-stamp-25th-celebration', 2931, 250337, 'Holofoil', 250301,
    '"Reshiram" 113/114, rarity Classic Collection (250301 is Celebrations "Reshiram" 002/025)'],
  ['cel25cc-CC021', 'cel25cc', 'CC021', 'Zekrom', 'holo-stamp-25th-celebration', 2931, 250338, 'Holofoil', 250308,
    '"Zekrom" 114/114, rarity Classic Collection (250308 is Celebrations "Zekrom" 010/025)'],

  // ── My First Battle (group 23330, no collector numbers): two Switch printings point at Potion ──
  ['mfb-34', 'mfb', '34', 'Switch', 'normal-stamp-pikachu', 23330, 524035, 'Normal', 524028,
    '"Switch (Pikachu)" (524028 is "Potion (Pikachu)")'],
  ['mfb-34', 'mfb', '34', 'Switch', 'normal-stamp-bulbasaur', 23330, 524037, 'Normal', 524026,
    '"Switch (Bulbasaur)" (524026 is "Potion (Bulbasaur)")'],

  // ── SM Trainer Kit: Lycanroc & Alolan Raichu (group 2069): #2 and #3 shared the #3 product ──
  ['tk-sm-r-2', 'tk-sm-r', '2', 'Lightning Energy', 'normal', 2069, 152851, 'Normal', 152852,
    '"Lightning Energy (#2)" 2/30 (152852 is "Lightning Energy (#3)", tk-sm-r-3\'s)'],

  // ── Unbroken Bonds 195a: right product, wrong printing; it lives in Alternate Art Promos ──
  ['sm10-195a', 'sm10', '195a', 'Dedenne GX', 'normal', 1938, 216699, 'Holofoil', 216699,
    '"Dedenne GX - 195a/214" 195a/214, priced as Holofoil only'],

  // ── MEP "Pikachu at the Museum": right product; listed in Jumbo Cards, so priced from there ──
  ['mep-Museum', 'mep', 'Museum', 'Pikachu at the Museum', 'normal-jumbo', 1528, 678659, 'Normal', 678659,
    '"Pikachu at the Museum" (Jumbo Cards, no number)'],

  // ── Yellow A Alternate: listed in Alternate Art Promos (group 1938), non-holo and holo apart ──
  ['xya-92a', 'xya', '92a', 'Trainers’ Mail', 'normal', 1938, 133815, 'Normal', null,
    '"Trainers\' Mail - 92a/108 (Non-Holo)" 092a/108'],
  ['xya-107a', 'xya', '107a', 'Professor Sycamore', 'normal', 1938, 133814, 'Normal', null,
    '"Professor Sycamore - 107a/122 (Non-Holo)" 107a/122'],

  // ── XY Promos (group 1451): TCGplayer lists these only as their prerelease printing (+ Staff) ──
  // The catalog carries one printing per promo here, the non-staff one TCGplayer lists.
  ['xyp-XY39', 'xyp', 'XY39', 'Kingdra', 'normal', 1451, 96413, 'Holofoil', null,
    '"Kingdra - XY39 (Prerelease)" XY39 (96414 is the [Staff] printing)'],
  ['xyp-XY46', 'xyp', 'XY46', 'Altaria', 'normal', 1451, 100503, 'Holofoil', null,
    '"Altaria - XY46 (Prerelease)" XY46 (100504 is the [Staff] printing)'],
  ['xyp-XY68', 'xyp', 'XY68', 'Chesnaught', 'normal', 1451, 108597, 'Holofoil', null,
    '"Chesnaught (Prerelease)" XY68 (108598 is the [Staff] printing)'],

  // ── XY Trainer Kit: Sylveon & Noivern (group 1532): one group, both decks numbered 1-30 ──
  ['tk-xy-n-14', 'tk-xy-n', '14', 'Pokémon Catcher', 'normal', 1532, 98009, 'Normal', null, '"Pokemon Catcher (Noivern)" 14/30'],
  ['tk-xy-n-21', 'tk-xy-n', '21', 'Poké Ball', 'normal', 1532, 98019, 'Normal', null, '"Poke Ball (Noivern)" 21/30'],
  ['tk-xy-n-23', 'tk-xy-n', '23', 'Noibat', 'normal', 1532, 98020, 'Normal', null, '"Noibat (#23)" 23/30'],
  ['tk-xy-n-24', 'tk-xy-n', '24', 'Professor’s Letter', 'normal', 1532, 98021, 'Normal', null, '"Professor\'s Letter (Noivern)" 24/30'],
  // TCGplayer files this one as 4/30, which in the Noivern deck is Bunnelby (97999, tk-xy-n-4's). It
  // is the deck's only Switch, and the only Noivern-deck product no other card of the deck links.
  ['tk-xy-n-29', 'tk-xy-n', '29', 'Switch', 'normal', 1532, 98024, 'Normal', null,
    '"Switch (Noivern)", number listed as 4/30 (the Noivern deck\'s 4/30 is "Bunnelby", 97999)'],
  ['tk-xy-sy-23', 'tk-xy-sy', '23', 'Pokémon Catcher', 'normal', 1532, 97988, 'Normal', null, '"Pokemon Catcher (Sylveon)" 23/30'],
  ['tk-xy-sy-26', 'tk-xy-sy', '26', 'Poké Ball', 'normal', 1532, 97991, 'Normal', null, '"Poke Ball (Sylveon)" 26/30'],
  ['tk-xy-sy-28', 'tk-xy-sy', '28', 'Professor’s Letter', 'normal', 1532, 97993, 'Normal', null, '"Professor\'s Letter (Sylveon)" 28/30'],

  // ── HGSS Trainer Kit: Gyarados & Raichu (group 1540) ──
  ['tk-hs-g-20', 'tk-hs-g', '20', 'Gyarados', 'normal', 1540, 85997, 'Normal', null,
    '"Gyarados (#20 Non-Holo)" 20/30 (85998 is the #30 holo)'],
];

export const PRICE_LINK_OVERRIDES: readonly PriceLinkOverride[] = ROWS.map(
  ([cardId, setId, localId, cardName, kind, groupId, productId, printing, was, evidence]) => ({
    cardId, setId, localId, cardName, kind, groupId, productId, printing, was, evidence,
  }),
);

export type OverrideIndex = ReadonlyMap<string, PriceLinkOverride>;

const key = (cardId: string, kind: string): string => `${cardId}|${kind}`;

/** Index a list of overrides by (card, kind). Throws on a duplicate key or a shared target. */
export function indexOverrides(list: readonly PriceLinkOverride[]): OverrideIndex {
  const byKey = new Map<string, PriceLinkOverride>();
  const targets = new Map<string, string>();
  for (const o of list) {
    const k = key(o.cardId, o.kind);
    if (byKey.has(k)) throw new Error(`price-link override listed twice: ${k}`);
    const t = `${o.productId}|${o.printing}`;
    const other = targets.get(t);
    // Two printings on one (product, printing) is exactly the fault this table repairs.
    if (other) throw new Error(`price-link overrides ${other} and ${k} both target ${t}`);
    byKey.set(k, o);
    targets.set(t, k);
  }
  return byKey;
}

export const OVERRIDES: OverrideIndex = indexOverrides(PRICE_LINK_OVERRIDES);

/** The TCGdex card ids an index covers (the link pass loads only these). */
export function overrideCardIds(index: OverrideIndex): string[] {
  return [...new Set([...index.values()].map((o) => o.cardId))];
}

export type OverrideCheck =
  | { applies: true; override: PriceLinkOverride }
  | { applies: false; refused: string; override: PriceLinkOverride }
  | null;

/**
 * The override for one printing of one card, after the identity check, or null when there is none.
 * `refused` says why an override exists but does not apply; the caller keeps the upstream value.
 */
export function checkOverride(
  index: OverrideIndex,
  input: { language: string; setId: string; cardId: string; localId: string; name: string; kind: string },
): OverrideCheck {
  const o = index.get(key(input.cardId, input.kind));
  if (!o) return null;
  const refuse = (refused: string): OverrideCheck => ({ applies: false, refused, override: o });
  if (input.language !== 'en') return refuse(`language ${input.language}`);
  if (input.setId !== o.setId) return refuse(`set is ${input.setId}, pinned ${o.setId}`);
  if (input.localId !== o.localId) return refuse(`number is ${input.localId}, pinned ${o.localId}`);
  if (foldName(input.name) !== foldName(o.cardName)) return refuse(`name is "${input.name}", pinned "${o.cardName}"`);
  return { applies: true, override: o };
}

/** The four `card_variant` columns a TCGplayer link occupies, as the importer writes them. */
export interface VariantLink {
  productId: number | null;
  printing: string | null;
  idSource: 'variant' | 'card' | 'none';
  idConfidence: number;
}

/**
 * The importer's boundary: the link one planned printing is written with. An override that applies
 * replaces the upstream link whatever upstream said (a wrong id, or none); otherwise the upstream
 * link is returned untouched. `check` reports which happened, for the import summary.
 */
export function overrideVariantLink(
  index: OverrideIndex,
  input: { language: string; setId: string; card: { id: string; localId: string; name: string }; kind: string },
  upstream: VariantLink,
): { link: VariantLink; check: OverrideCheck } {
  const check = checkOverride(index, {
    language: input.language, setId: input.setId, cardId: input.card.id,
    localId: input.card.localId, name: input.card.name, kind: input.kind,
  });
  if (!check?.applies) return { link: upstream, check };
  const o = check.override;
  return { link: { productId: o.productId, printing: o.printing, idSource: 'variant', idConfidence: 100 }, check };
}
