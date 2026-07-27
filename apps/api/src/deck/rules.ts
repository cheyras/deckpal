/**
 * Deck-construction rules shared across formats. DECK-FORMATS §3.
 * Every rule returns Violation[] (possibly empty). The validator (formats.ts)
 * runs the applicable subset and NEVER short-circuits (§5.6): all rules always
 * evaluate so the "Not Legal" disclosure can list every reason.
 */
import type { CardFacts, Violation } from './types.js';
import { isBasicEnergy, isRadiant, isPrismStar } from './names.js';
import { ACE_SPEC_NAMES, glcRules } from './data.js';

/** One entry in the flattened working set the rules operate on. */
export interface WorkCard {
  card: CardFacts;
  quantity: number;
}

// ── Card-level classifiers (derived from CardFacts + vendored data) ───────────

export function cardIsBasicEnergy(c: CardFacts): boolean {
  return isBasicEnergy(c);
}
export function cardIsAceSpec(c: CardFacts): boolean {
  return ACE_SPEC_NAMES.has(c.normalizedName);
}
export function cardIsRadiant(c: CardFacts): boolean {
  return isRadiant(c.name);
}
export function cardIsPrismStar(c: CardFacts): boolean {
  return isPrismStar(c.name);
}

/**
 * Rule-box classification (DECK-FORMATS §2.3.2). Returns the kind, or null.
 * suffix covers ex/EX/V/GX/TAG TEAM-GX; VMAX/VSTAR/V-UNION/BREAK are name-detected
 * (§7 item 9 — they are NOT in TCGdex suffix); Radiant/Prism/ACE SPEC folded in.
 */
export function ruleBoxKind(c: CardFacts): string | null {
  if (cardIsAceSpec(c)) return 'ACE_SPEC';
  if (cardIsRadiant(c)) return 'RADIANT';
  if (cardIsPrismStar(c)) return 'PRISM';
  const g = glcRules();
  for (const suf of g.rule_box_name_suffixes) {
    if (c.name.endsWith(suf)) return suf.trim();
  }
  if (c.suffix && g.rule_box_suffixes.includes(c.suffix)) return c.suffix;
  return null;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export function ruleDeckSize(work: WorkCard[], deckSize: number): Violation[] {
  const total = work.reduce((n, w) => n + w.quantity, 0);
  if (total === deckSize) return [];
  const delta = total - deckSize;
  return [{
    code: 'DECK_SIZE',
    severity: 'error',
    rule: 'A deck must contain exactly 60 cards.',
    message: `${total} / ${deckSize} cards. ${delta < 0 ? `Add ${-delta}.` : `Remove ${delta}.`}`,
    scope: 'deck',
    observed: total,
    allowed: deckSize,
    delta,
  }];
}

export function ruleBasicPokemon(work: WorkCard[]): Violation[] {
  const has = work.some((w) => w.card.category === 'Pokemon' && w.card.stage === 'Basic');
  if (has) return [];
  return [{
    code: 'NO_BASIC_POKEMON',
    severity: 'error',
    rule: 'A deck must contain at least one Basic Pokémon.',
    message: 'No Basic Pokémon in the deck. It cannot start a game.',
    scope: 'deck',
  }];
}

/**
 * Copy limit by NAME across printings (§3.2). Basic Energy exempt (§3.3).
 * cap=4 -> COPY_LIMIT (Std/Exp/Unl); cap=1 -> SINGLETON (GLC).
 */
export function ruleCopyLimit(work: WorkCard[], cap: number, basicEnergyExempt: boolean): Violation[] {
  const byName = new Map<string, { total: number; cards: CardFacts[] }>();
  for (const w of work) {
    if (basicEnergyExempt && cardIsBasicEnergy(w.card)) continue;
    const key = w.card.normalizedName;
    const e = byName.get(key) ?? { total: 0, cards: [] };
    e.total += w.quantity;
    if (!e.cards.some((c) => c.id === w.card.id)) e.cards.push(w.card);
    byName.set(key, e);
  }
  const out: Violation[] = [];
  for (const [, e] of byName) {
    if (e.total <= cap) continue;
    const display = e.cards[0]?.name ?? '(unknown)';
    const prints = e.cards.length;
    out.push({
      code: cap === 1 ? 'SINGLETON' : 'COPY_LIMIT',
      severity: 'error',
      rule: cap === 1
        ? 'GLC allows only one of each card by name (Basic Energy exempt).'
        : 'No more than 4 copies of a card with the same name (Basic Energy exempt).',
      message: cap === 1
        ? `${e.total} copies of "${display}" — GLC is singleton.`
        : `${e.total} copies of "${display}"${prints > 1 ? ` across ${prints} printings` : ''}.`,
      scope: 'name',
      subject: display,
      card_ids: e.cards.map((c) => c.id),
      observed: e.total,
      allowed: cap,
    });
  }
  return out;
}

/** Deck-wide ACE SPEC limit (§3.5). */
export function ruleAceSpecLimit(work: WorkCard[], limit: number): Violation[] {
  const aces = work.filter((w) => cardIsAceSpec(w.card));
  const total = aces.reduce((n, w) => n + w.quantity, 0);
  if (total <= limit) return [];
  return [{
    code: 'ACE_SPEC_LIMIT',
    severity: 'error',
    rule: 'Only one ACE SPEC card total per deck.',
    message: `${total} ACE SPEC cards (${aces.map((w) => w.card.name).join(', ')}). Limit ${limit}.`,
    scope: 'deck',
    card_ids: aces.map((w) => w.card.id),
    observed: total,
    allowed: limit,
  }];
}

/** GLC bans ACE SPEC outright (§2.3.1). One violation per offending card. */
export function ruleAceSpecForbidden(work: WorkCard[]): Violation[] {
  return work.filter((w) => cardIsAceSpec(w.card)).map((w) => ({
    code: 'ACE_SPEC_FORBIDDEN' as const,
    severity: 'error' as const,
    rule: 'ACE SPEC cards are not allowed in GLC.',
    message: `${w.card.name} is an ACE SPEC card, banned in GLC.`,
    scope: 'card' as const,
    card_ids: [w.card.id],
  }));
}

/** Deck-wide Radiant limit (§3.6). */
export function ruleRadiantLimit(work: WorkCard[], limit: number): Violation[] {
  const rad = work.filter((w) => cardIsRadiant(w.card));
  const total = rad.reduce((n, w) => n + w.quantity, 0);
  if (total <= limit) return [];
  return [{
    code: 'RADIANT_LIMIT',
    severity: 'error',
    rule: 'Only one Radiant Pokémon per deck.',
    message: `${total} Radiant Pokémon. Limit ${limit}.`,
    scope: 'deck',
    card_ids: rad.map((w) => w.card.id),
    observed: total,
    allowed: limit,
  }];
}

/** Prism Star: at most 1 PER NAME (§3.7) — the opposite of ACE SPEC/Radiant. */
export function rulePrismStarLimit(work: WorkCard[], perName: number): Violation[] {
  const byName = new Map<string, { total: number; card: CardFacts }>();
  for (const w of work) {
    if (!cardIsPrismStar(w.card)) continue;
    const e = byName.get(w.card.normalizedName) ?? { total: 0, card: w.card };
    e.total += w.quantity;
    byName.set(w.card.normalizedName, e);
  }
  const out: Violation[] = [];
  for (const [, e] of byName) {
    if (e.total <= perName) continue;
    out.push({
      code: 'PRISM_STAR_LIMIT',
      severity: 'error',
      rule: 'Only one copy of a Prism Star card by name.',
      message: `${e.total} copies of "${e.card.name}" (Prism Star). Limit ${perName} per name.`,
      scope: 'name',
      subject: e.card.name,
      card_ids: [e.card.id],
      observed: e.total,
      allowed: perName,
    });
  }
  return out;
}

/** GLC forbids any rule-box Pokémon (§2.3.2). ACE SPEC/Radiant/Prism reported by their own rules. */
export function ruleRuleBoxForbidden(work: WorkCard[]): Violation[] {
  const out: Violation[] = [];
  for (const w of work) {
    const kind = ruleBoxKind(w.card);
    if (!kind || kind === 'ACE_SPEC' || kind === 'RADIANT' || kind === 'PRISM') continue;
    out.push({
      code: 'RULE_BOX_FORBIDDEN',
      severity: 'error',
      rule: 'Cards with a Rule Box are not allowed in GLC.',
      message: `${w.card.name} (${kind}) has a Rule Box.`,
      scope: 'card',
      subject: w.card.name,
      card_ids: [w.card.id],
      detail: { rule_box_kind: kind },
    });
  }
  return out;
}
