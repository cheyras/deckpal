// Pure matching for the TCGCSV link pass (no database, no network).
//
// WHY THIS EXISTS. A price only reaches a card when its `card_variant` carries
// `(tcgplayer_product_id, tcgplayer_printing)` — that pair is the whole join the daily TCGCSV
// ingest uses (tcgcsv.ts `writeSetPrices`). Those two columns were filled from exactly one place:
// TCGdex's `thirdParty.tcgplayer`. Wherever TCGdex has no TCGplayer id the card is permanently
// `unpriced`, however well TCGplayer prices it (svp-085 "Pikachu with Grey Felt Hat": TCGdex
// carries no id, TCGplayer lists it at four figures). The whole SVP promo set was in that state.
//
// This module decides, from data TCGCSV publishes for free, which product a catalog card is — and
// refuses whenever the answer is a guess. It is deliberately conservative: a card left unpriced is
// an honest gap; a card linked to the wrong product quotes a stranger's price with full confidence.
//
// WHAT COUNTS AS EVIDENCE. A card ↔ product link needs BOTH the collector number and the card name
// to agree. Number alone is not identity (a promo set reuses numbers across printings; "Pikachu"
// appears five times in SVP), and name alone is not identity either. The single exception is a
// name that is unique on both sides of the join, recorded at a lower confidence.

import type { TcgcsvPriceRow, TcgcsvProductRow } from './types.js';

// ── which TCGplayer printing names a variant kind can mean ──────────────────────────────────────
// Only plain, standard-size kinds and the 1st-Edition stamp are linkable, and each lists the
// printing names TCGplayer uses for it IN PREFERENCE ORDER (modern sets say "Normal" / "Holofoil";
// the WotC-era sets say "Unlimited" / "Unlimited Holofoil" and add "1st Edition …"). Any other kind
// — a promo stamp, a jumbo, a cosmos foil — maps to a product we cannot identify from number+name,
// so it stays unlinked rather than being pointed at the base card's price (SCHEMA §4.6: no
// invented prices).
const PLAIN_DIGITS = /^\d+$/;

const PRINTINGS_BY_KIND: Readonly<Record<string, readonly string[]>> = {
  normal: ['Normal', 'Unlimited'],
  holo: ['Holofoil', 'Unlimited Holofoil'],
  reverse: ['Reverse Holofoil'],
  'normal-stamp-1st-edition': ['1st Edition'],
  'holo-stamp-1st-edition': ['1st Edition Holofoil'],
};

export function linkablePrintings(kindCode: string): readonly string[] | null {
  return PRINTINGS_BY_KIND[kindCode] ?? null;
}

// ── name + number normalisation ───────────────────────────────────────────────────────────────

/** Fold a card or product name to a comparison key: accents, case, quotes, gender signs, spacing. */
export function foldName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/♀/g, ' f')
    .replace(/♂/g, ' m')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * TCGplayer product names look like "Charizard ex - 125/197", "Pikachu - 027" (promos) and, for
 * a distinct printing, "Pawmot - 006 (Prerelease) [Staff]" — the number comes BEFORE the
 * qualifiers. Strip the qualifiers first, then the number, and return the qualifiers: a
 * qualified product is a different printing than the base card and must lose to an unqualified
 * one that matches.
 */
export function productCardName(product: TcgcsvProductRow): { key: string; qualifiers: string[] } {
  let n = product.name;
  const qualifiers: string[] = [];
  n = n.replace(/\s*[(\[]([^)\]]*)[)\]]/g, (_m, q: string) => { qualifiers.push(q.trim().toLowerCase()); return ''; });
  n = n.replace(/\s+-\s+[A-Za-z]{0,6}\d+[A-Za-z]?(?:\s*\/\s*\S+)?\s*$/, '');
  return { key: foldName(n), qualifiers };
}

/**
 * A qualifier that only names the FINISH of the one printing TCGplayer lists ("Cosmos Holo") says
 * which product the card is. Stamps and events ("Prerelease", "Staff", "League") name a different
 * physical card than the catalog's plain entry, so they never count.
 */
const FINISH_QUALIFIER = /^(cosmos? holo(foil)?|holo(foil)?|reverse holo(foil)?|non-?holo(foil)?)$/;
export function onlyFinishQualifiers(qualifiers: string[]): boolean {
  return qualifiers.length > 0 && qualifiers.every((q) => FINISH_QUALIFIER.test(q));
}

/**
 * Collector-number key shared by both sides: the part before any "/", with leading zeros dropped
 * from the numeric run so TCGdex "085" ↔ TCGCSV "085" and "TG03" ↔ "TG3" compare equal. Returns
 * null for an empty value so a sealed product (no Number) can never match a card.
 */
export function numberKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const head = raw.split('/')[0]!.trim();
  if (!head) return null;
  const m = /^([A-Za-z]*)0*(\d+)([A-Za-z]*)$/.exec(head);
  if (m) return `${m[1]!.toUpperCase()}${parseInt(m[2]!, 10)}${m[3]!.toUpperCase()}`;
  return head.toUpperCase();
}

export function productNumberKey(product: TcgcsvProductRow): string | null {
  return numberKey(product.extendedData?.find((e) => e.name === 'Number')?.value);
}

// ── inputs ────────────────────────────────────────────────────────────────────────────────────

export interface LinkVariant {
  id: number;
  kind: string;
  /** Already carries a TCGplayer product id — never touched by the link pass. */
  productId: number | null;
  printing: string | null;
}
export interface LinkCard {
  cardId: number;
  localId: string;
  name: string;
  variants: LinkVariant[];
}

export type LinkEvidence = 'number_match' | 'name_match';

export interface PlannedLink {
  variantId: number;
  cardId: number;
  productId: number;
  printing: string;
  source: LinkEvidence;
  confidence: number;
}

export type SkipReason =
  | 'no-product' // nothing on TCGplayer's side agrees with this card
  | 'ambiguous-product' // several products fit equally well
  | 'name-mismatch' // a product has this number but a different name
  | 'special-variant' // stamped / jumbo / etc. — not identifiable from number+name
  | 'no-printing' // the product has no price row for this variant's printing
  | 'duplicate-target'; // another variant already owns (product, printing)

export interface PlanResult {
  links: PlannedLink[];
  skipped: { cardId: number; variantId: number; reason: SkipReason }[];
  /** Distinct cards that got at least one link. */
  cardsMatched: number;
  /**
   * Cards for which this group holds a product with the SAME collector number AND the SAME name,
   * whether or not a variant could then be linked (a stamped-only product agrees on identity and
   * still refuses to link). This — not `cardsMatched` — is the evidence a group is this set.
   */
  cardsAgreeing: number;
  /** Cards that still had a variant to link. */
  cardsConsidered: number;
  /** Numbered, priced products in the group: the other side of the agreement ratio. */
  numberedProducts: number;
}

interface IndexedProduct {
  row: TcgcsvProductRow;
  numKey: string | null;
  nameKey: string;
  qualifiers: string[];
  printings: Set<string>;
}

/**
 * Plan the links for ONE set against ONE TCGCSV group. Only variants with no product id are
 * considered; an existing link is authoritative (upstream wins, same precedence as the release
 * overlay in releasePriceLinks.ts) and its (product, printing) is reserved so a new link can
 * never land on the same price row.
 */
export function planSetLinks(
  cards: LinkCard[], products: TcgcsvProductRow[], prices: TcgcsvPriceRow[],
): PlanResult {
  const printingsByProduct = new Map<number, Set<string>>();
  for (const p of prices) {
    (printingsByProduct.get(p.productId) ?? printingsByProduct.set(p.productId, new Set()).get(p.productId)!)
      .add(p.subTypeName);
  }

  // Only products TCGplayer actually prices AND numbers are candidates: sealed product, code
  // cards and accessories carry no Number, so they cannot be mistaken for a card.
  const indexed: IndexedProduct[] = [];
  for (const row of products) {
    const printings = printingsByProduct.get(row.productId);
    const numKey = productNumberKey(row);
    if (!printings || printings.size === 0 || numKey == null) continue;
    const { key, qualifiers } = productCardName(row);
    indexed.push({ row, numKey, nameKey: key, qualifiers, printings });
  }

  const byNumber = new Map<string, IndexedProduct[]>();
  const byName = new Map<string, IndexedProduct[]>();
  for (const ip of indexed) {
    (byNumber.get(ip.numKey!) ?? byNumber.set(ip.numKey!, []).get(ip.numKey!)!).push(ip);
    (byName.get(ip.nameKey) ?? byName.set(ip.nameKey, []).get(ip.nameKey)!).push(ip);
  }
  const cardNumbers = new Set<string>();
  for (const c of cards) { const k = numberKey(c.localId); if (k) cardNumbers.add(k); }
  const cardsByName = new Map<string, number>();
  for (const c of cards) {
    const k = foldName(c.name);
    cardsByName.set(k, (cardsByName.get(k) ?? 0) + 1);
  }

  // Reserve every (product, printing) already owned, so we never create a second owner.
  const taken = new Set<string>();
  for (const c of cards) {
    for (const v of c.variants) {
      if (v.productId != null && v.printing) taken.add(`${v.productId}|${v.printing}`);
    }
  }

  const links: PlannedLink[] = [];
  const skipped: PlanResult['skipped'] = [];
  const matchedCards = new Set<number>();
  let agreeing = 0;
  let considered = 0;

  for (const card of cards) {
    const open = card.variants.filter((v) => v.productId == null);
    if (open.length === 0) continue;
    considered++;

    const nameKey = foldName(card.name);
    const numKey = numberKey(card.localId);

    // A sibling's id is NOT identity evidence for this card's product: a stamped or patterned
    // variant (a Poké Ball pattern, a Master Ball foil) is a different product, and copying its id
    // onto the plain variant priced Umbreon at its pattern's $3.69 instead of $0.47. The product is
    // found the same way for every card, from number AND name. The only use of a sibling is as a
    // cross-check: if a PLAIN sibling already holds a different product than the one we found,
    // upstream and we disagree about which card this is, and the honest answer is no link.
    const plainSiblingPid = card.variants.find((v) => v.productId != null && linkablePrintings(v.kind) != null)?.productId ?? null;

    let chosen: IndexedProduct | null = null;
    let source: LinkEvidence = 'number_match';
    let confidence = 100;
    let failure: SkipReason | null = null;

    {
      const sameNumber = numKey ? (byNumber.get(numKey) ?? []) : [];
      const named = sameNumber.filter((ip) => ip.nameKey === nameKey);
      if (named.length > 0) agreeing++;
      if (named.length === 1) {
        chosen = named[0]!;
        if (chosen.qualifiers.length > 0) {
          // The only product at this number is a qualified printing. A finish descriptor still
          // identifies the card (at lower confidence); a stamp or event does not.
          if (onlyFinishQualifiers(chosen.qualifiers)) confidence = 80;
          else { chosen = null; failure = 'ambiguous-product'; }
        }
      } else if (named.length > 1) {
        const plain = named.filter((ip) => ip.qualifiers.length === 0);
        if (plain.length === 1) chosen = plain[0]!;
        else failure = 'ambiguous-product';
      } else if (sameNumber.length > 0) {
        failure = 'name-mismatch';
      } else {
        // No product shares this number. Fall back to a name unique on BOTH sides, but only where
        // the numbers genuinely cannot be compared: a product with a qualifier is a different
        // printing; a product numbered like another card of ours is that card; and two plain-digit
        // numbers that differ are CONTRARY evidence ("Pikachu #027" is not "Pikachu - 088").
        const sameName = (byName.get(nameKey) ?? []).filter((ip) => ip.qualifiers.length === 0);
        if (sameName.length === 1 && cardsByName.get(nameKey) === 1) {
          const cand = sameName[0]!;
          const sameScheme = PLAIN_DIGITS.test(numKey ?? '') && PLAIN_DIGITS.test(cand.numKey ?? '');
          if (sameScheme || (cand.numKey != null && cardNumbers.has(cand.numKey))) {
            failure = 'name-mismatch';
          } else {
            chosen = cand;
            source = 'name_match';
            confidence = 70;
          }
        } else {
          failure = sameName.length > 1 || (cardsByName.get(nameKey) ?? 0) > 1 ? 'ambiguous-product' : 'no-product';
        }
      }
    }
    if (chosen && plainSiblingPid != null && plainSiblingPid !== chosen.row.productId) {
      chosen = null;
      failure = 'ambiguous-product';
    }

    if (!chosen) {
      for (const v of open) skipped.push({ cardId: card.cardId, variantId: v.id, reason: failure ?? 'no-product' });
      continue;
    }

    let linkedThisCard = false;
    for (const v of open) {
      const want = linkablePrintings(v.kind);
      if (want == null) {
        skipped.push({ cardId: card.cardId, variantId: v.id, reason: 'special-variant' });
        continue;
      }
      let printing: string | null = null;
      let conf = confidence;
      const hit = want.find((w) => chosen!.printings.has(w));
      if (hit) {
        printing = hit;
      } else if (
        card.variants.length === 1 && chosen.printings.size === 1
        && (v.kind === 'normal' || v.kind === 'holo')
        && ['Normal', 'Holofoil'].includes([...chosen.printings][0]!)
      ) {
        // The card's only variant, and the product is priced under exactly one printing: TCGplayer
        // and TCGdex disagree on the foil NAME (Normal <-> Holofoil), not on which card this is.
        // Never across an EDITION: a holo Unlimited card must not take a "1st Edition Holofoil" price.
        printing = [...chosen.printings][0]!;
        conf = Math.min(conf, 85);
      }
      if (printing == null) {
        skipped.push({ cardId: card.cardId, variantId: v.id, reason: 'no-printing' });
        continue;
      }
      const slot = `${chosen.row.productId}|${printing}`;
      if (taken.has(slot)) {
        skipped.push({ cardId: card.cardId, variantId: v.id, reason: 'duplicate-target' });
        continue;
      }
      taken.add(slot);
      links.push({
        variantId: v.id, cardId: card.cardId, productId: chosen.row.productId, printing,
        source, confidence: conf,
      });
      linkedThisCard = true;
    }
    if (linkedThisCard) matchedCards.add(card.cardId);
  }

  return {
    links, skipped, cardsMatched: matchedCards.size, cardsAgreeing: agreeing, cardsConsidered: considered,
    numberedProducts: indexed.length,
  };
}

// ── choosing a TCGCSV group for a set TCGdex has no group for ─────────────────────────────────

export interface GroupRef { groupId: number; name: string; abbreviation: string | null }
export interface SetRef {
  tcgdexId: string; name: string; abbreviation: string | null; ptcglCode: string | null;
}

const fold = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Groups worth FETCHING for a set — cheap filter, not a decision. Matches on the printed set code
 * (TCGdex id, its abbreviation, or its PTCGL code against TCGCSV's abbreviation) or on the group
 * name with its era prefix ("SV: ", "SWSH: ") removed. Whether a candidate is actually this set
 * is decided afterwards by `acceptGroup`, from card-level agreement.
 */
export function candidateGroups(set: SetRef, groups: GroupRef[], max = 6): GroupRef[] {
  const codes = new Set([fold(set.tcgdexId), fold(set.abbreviation), fold(set.ptcglCode)].filter(Boolean));
  const setName = fold(set.name);
  const out: GroupRef[] = [];
  for (const g of groups) {
    const abbr = fold(g.abbreviation);
    const bareName = fold(g.name.replace(/^[^:]{1,12}:\s*/, ''));
    const byCode = abbr !== '' && codes.has(abbr);
    const byName = setName !== '' && bareName !== '' && (bareName === setName);
    if (byCode || byName) out.push(g);
  }
  return out.slice(0, max);
}

export interface GroupScore { groupId: number; plan: PlanResult }

/**
 * Accept a group for a set only on card-level agreement. A group is this set's group when most of
 * what it numbers is cards we hold, agreeing on number AND name. Needs at least three agreeing
 * cards (one coincidence is not evidence) unless the set is itself that small, the agreement
 * ratio against the smaller side must reach 0.9, and the group must cover at least half of OUR
 * set. Two groups tying is a refusal, not a coin toss.
 */
export function acceptGroup(
  scores: GroupScore[], setCardCount: number,
): { groupId: number; plan: PlanResult } | { rejected: 'no-candidate' | 'weak-agreement' | 'tie' } {
  if (scores.length === 0) return { rejected: 'no-candidate' };
  const need = Math.min(3, Math.max(1, setCardCount));
  const ok = scores.filter((s) => {
    const denom = Math.min(Math.max(setCardCount, 1), Math.max(s.plan.numberedProducts, 1));
    // The 0.9 against the SMALLER side tolerates a TCGplayer group that lacks some of our cards;
    // the 0.5 against OUR side stops a tiny subset group (a gallery, a sealed-code group) being
    // taken for a large set on the strength of its few cards.
    return s.plan.cardsAgreeing >= need
      && s.plan.cardsAgreeing / denom >= 0.9
      && s.plan.cardsAgreeing / Math.max(setCardCount, 1) >= 0.5;
  });
  if (ok.length === 0) return { rejected: 'weak-agreement' };
  ok.sort((a, b) => b.plan.cardsAgreeing - a.plan.cardsAgreeing);
  if (ok.length > 1 && ok[0]!.plan.cardsAgreeing === ok[1]!.plan.cardsAgreeing) return { rejected: 'tie' };
  return { groupId: ok[0]!.groupId, plan: ok[0]!.plan };
}
