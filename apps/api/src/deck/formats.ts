/**
 * Per-format validators. DECK-FORMATS §2 + §5.6.
 * validateDeck() dispatches on format, runs every applicable rule with NO
 * short-circuit, and returns the rich §5.6 result (every failing rule, structured
 * to highlight offending cards in place).
 */
import type {
  CardFacts, Deck, FormatCode, PokemonType, ValidationResult,
  ValidationCounts, Violation, ValidationWarning,
} from './types.js';
import {
  banList, formatConfig, formatsCheckedAt, glcRules,
  type BanEntry, type FormatConfig,
} from './data.js';
import { normalizeName } from './names.js';
import {
  type WorkCard,
  ruleDeckSize, ruleBasicPokemon, ruleCopyLimit,
  ruleAceSpecLimit, ruleAceSpecForbidden, ruleRadiantLimit,
  rulePrismStarLimit, ruleRuleBoxForbidden, cardIsBasicEnergy,
} from './rules.js';

/**
 * A reprint-legality oracle. Given a card, returns true if it is in-format by the
 * reprint rule (fingerprint propagation, §2.1.5) even though its own mark/set is
 * out. db.ts builds a real one from the catalogue; pure tests can inject one.
 */
export interface ValidateContext {
  isInFormatByReprint?: (card: CardFacts) => boolean;
  now?: Date;
}

function counts(work: WorkCard[], unresolved: number): ValidationCounts {
  const total = work.reduce((n, w) => n + w.quantity, 0);
  const by = (cat: string) =>
    work.filter((w) => w.card.category === cat).reduce((n, w) => n + w.quantity, 0);
  const names = new Set(work.map((w) => w.card.normalizedName));
  return {
    total,
    pokemon: by('Pokemon'),
    trainer: by('Trainer'),
    energy: by('Energy'),
    distinct_names: names.size,
    unresolved,
  };
}

// ── Ban matching (§2.2 / §2.3.5) ──────────────────────────────────────────────

function localIdMatches(banIds: string[] | undefined, card: CardFacts): boolean {
  if (!banIds || banIds.length === 0) return true; // whole set
  const cardNum = card.localId.replace(/^0+(?=\d)/, '').toLowerCase();
  return banIds.some((raw) => {
    const b = raw.replace(/^0+(?=\d)/, '').toLowerCase();
    if (b === cardNum) return true;
    // numeric compare (e.g. ban '83' vs card '083')
    if (card.localIdNumeric !== null && /^\d+$/.test(raw)) {
      return parseInt(raw, 10) === card.localIdNumeric;
    }
    return false;
  });
}

function banViolation(card: CardFacts, ban: BanEntry, formatName: string): Violation {
  const dateStr = ban.banned_from ? ` as of ${ban.banned_from}` : '';
  return {
    code: 'BANNED',
    severity: 'error',
    rule: 'Banned in this format.',
    message: `${card.name} is banned in ${formatName}${dateStr}. (${ban.source_text})`,
    scope: 'card',
    subject: card.name,
    card_ids: [card.id],
    detail: { banned_from: ban.banned_from ?? null, scope: ban.scope, source_text: ban.source_text },
  };
}

function ruleBanned(work: WorkCard[], code: FormatCode, formatName: string): Violation[] {
  const bans = banList(code).bans;
  if (bans.length === 0) return [];
  const out: Violation[] = [];
  for (const w of work) {
    const nn = w.card.normalizedName;
    for (const ban of bans) {
      if (normalizeName(ban.name) !== nn) continue;
      if (ban.scope === 'name') {
        out.push(banViolation(w.card, ban, formatName));
        break;
      }
      // print scope: set must match AND (local id in list OR whole set)
      if (ban.set && ban.set === w.card.setTcgdexId && localIdMatches(ban.local_ids, w.card)) {
        out.push(banViolation(w.card, ban, formatName));
        break;
      }
    }
  }
  return out;
}

// ── Pool checks (§2.1 / §2.2 / §2.3) ──────────────────────────────────────────

function markLegal(card: CardFacts, legalMarks: string[]): boolean {
  return card.regulationMark !== null && legalMarks.includes(card.regulationMark);
}

function setInPool(card: CardFacts, prefixes: string[]): boolean {
  return prefixes.some((p) => card.setTcgdexId === p || card.setTcgdexId.startsWith(p));
}

/** Standard: mark ∈ {H,I,J} OR a fingerprint-identical legal reprint exists (§2.1.5). */
function ruleStandardPool(work: WorkCard[], cfg: FormatConfig, ctx: ValidateContext): Violation[] {
  const out: Violation[] = [];
  for (const w of work) {
    if (cardIsBasicEnergy(w.card)) continue; // basic Energy is always legal, no mark (§3.3)
    if (markLegal(w.card, cfg.legal_marks)) continue;
    const byReprint = ctx.isInFormatByReprint?.(w.card) ?? false;
    if (byReprint) continue;
    out.push({
      code: 'NOT_IN_FORMAT',
      severity: 'error',
      rule: `Standard is limited to regulation marks ${cfg.legal_marks.join(', ')}.`,
      message: `${w.card.name} (${w.card.setTcgdexId.toUpperCase()} ${w.card.localId}) has regulation mark ${w.card.regulationMark ?? '—'} and has no legal reprint.`,
      scope: 'card',
      subject: w.card.name,
      card_ids: [w.card.id],
      detail: {
        regulation_mark: w.card.regulationMark,
        legal_marks: cfg.legal_marks,
        reprint_checked: ctx.isInFormatByReprint !== undefined,
      },
    });
  }
  return out;
}

/** Expanded/GLC: set is BW-onward (prefix) OR mark ∈ pool, OR legal reprint. */
function ruleSetAllowancePool(
  work: WorkCard[], cfg: FormatConfig, formatName: string, ctx: ValidateContext,
): Violation[] {
  const prefixes = cfg.pool_from_series_prefixes ?? [];
  const out: Violation[] = [];
  for (const w of work) {
    if (cardIsBasicEnergy(w.card)) continue; // basic Energy is always legal (§3.3)
    if (setInPool(w.card, prefixes)) continue;
    if (markLegal(w.card, cfg.legal_marks)) continue;
    if (ctx.isInFormatByReprint?.(w.card) === true) continue;
    out.push({
      code: 'NOT_IN_FORMAT',
      severity: 'error',
      rule: `${formatName} pool is Black & White onward.`,
      message: `${w.card.name} (${w.card.setTcgdexId.toUpperCase()} ${w.card.localId}) is from a set outside the ${formatName} card pool.`,
      scope: 'card',
      subject: w.card.name,
      card_ids: [w.card.id],
      detail: { set: w.card.setTcgdexId, regulation_mark: w.card.regulationMark },
    });
  }
  return out;
}

// ── GLC-specific (§2.3) ───────────────────────────────────────────────────────

function ruleTypeCoherence(work: WorkCard[], deckType: PokemonType | null | undefined): Violation[] {
  if (!deckType) return [];
  const out: Violation[] = [];
  // names of pokemon that DO match the type — used for the Eevee-style helper message
  const okNames = new Set(
    work.filter((w) => w.card.category === 'Pokemon' && w.card.types.includes(deckType))
      .map((w) => w.card.normalizedName),
  );
  for (const w of work) {
    const c = w.card;
    if (c.category !== 'Pokemon') continue; // Trainers, Special Energy, Item-Pokémon exempt (§2.3.4.7)
    if (c.types.includes(deckType)) continue;
    // evolution-coherence flavour: does an in-deck, on-type Pokémon evolve from this one?
    const evolvesInto = work.find(
      (o) => o.card.category === 'Pokemon' &&
        o.card.evolveFrom && normalizeName(o.card.evolveFrom) === c.normalizedName &&
        o.card.types.includes(deckType),
    );
    const coherenceNote = evolvesInto
      ? ` Its evolution ${evolvesInto.card.name} is ${deckType}, but ${c.name} is ${c.types.join('/') || 'typeless'} — an evolution line that crosses types cannot be played (GLC FAQ).`
      : '';
    out.push({
      code: 'TYPE_MISMATCH',
      severity: 'error',
      rule: `A GLC deck may contain only one Pokémon type.`,
      message: `${c.name} is ${c.types.join('/') || 'typeless'}, not ${deckType}.${coherenceNote}`,
      scope: 'card',
      subject: c.name,
      card_ids: [c.id],
      detail: { deck_type: deckType, card_types: c.types, on_type_evolution: evolvesInto?.card.name ?? null },
    });
  }
  void okNames;
  return out;
}

function ruleExclusiveGroups(work: WorkCard[]): Violation[] {
  const out: Violation[] = [];
  for (const group of glcRules().exclusive_groups) {
    const members = new Set(group.members.map(normalizeName));
    const present = work.filter((w) => members.has(w.card.normalizedName));
    const total = present.reduce((n, w) => n + w.quantity, 0);
    if (total <= group.max_total) continue;
    out.push({
      code: 'EXCLUSIVE_GROUP',
      severity: 'error',
      rule: `GLC: at most ${group.max_total} of {${group.label}}.`,
      message: `Deck has ${total} of {${group.label}} — only ${group.max_total} allowed.`,
      scope: 'group',
      subject: group.label,
      card_ids: present.map((w) => w.card.id),
      observed: total,
      allowed: group.max_total,
    });
  }
  return out;
}

function ruleNotTournamentLegal(work: WorkCard[]): Violation[] {
  const banned = new Set(glcRules().not_tournament_legal.map(normalizeName));
  return work.filter((w) => banned.has(w.card.normalizedName)).map((w) => ({
    code: 'NOT_TOURNAMENT_LEGAL' as const,
    severity: 'error' as const,
    rule: 'Cards not legal for official tournament play are excluded from GLC.',
    message: `${w.card.name} is not legal for tournament play.`,
    scope: 'card' as const,
    subject: w.card.name,
    card_ids: [w.card.id],
  }));
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export function validateDeck(deck: Deck, ctx: ValidateContext = {}): ValidationResult {
  const cfg = formatConfig(deck.formatCode);
  const work: WorkCard[] = deck.entries.map((e) => ({ card: e.card, quantity: e.quantity }));
  const unresolved = (deck.importWarnings ?? []).filter((w) => w.code === 'UNRESOLVED_CARD').length;

  const violations: Violation[] = [];
  const warnings: ValidationWarning[] = [...(deck.importWarnings ?? [])];

  // Rules run in the §5.6 render order; none short-circuits.
  violations.push(...ruleDeckSize(work, cfg.deck_size));
  if (cfg.require_basic_pokemon) violations.push(...ruleBasicPokemon(work));

  violations.push(...ruleCopyLimit(work, cfg.max_copies_per_name, cfg.basic_energy_exempt));

  if (cfg.max_ace_spec === 0) violations.push(...ruleAceSpecForbidden(work));
  else if (cfg.max_ace_spec !== null) violations.push(...ruleAceSpecLimit(work, cfg.max_ace_spec));

  if (cfg.max_radiant !== null && !cfg.forbid_rule_box) {
    violations.push(...ruleRadiantLimit(work, cfg.max_radiant));
  }
  if (cfg.max_prism_star_per_name !== null && cfg.max_prism_star_per_name > 0) {
    violations.push(...rulePrismStarLimit(work, cfg.max_prism_star_per_name));
  }
  if (cfg.forbid_rule_box) violations.push(...ruleRuleBoxForbidden(work));

  // Pool + bans
  if (cfg.pool_strategy === 'regulation_mark') {
    violations.push(...ruleStandardPool(work, cfg, ctx));
  } else if (cfg.pool_strategy === 'set_allowance') {
    violations.push(...ruleSetAllowancePool(work, cfg, cfg.name, ctx));
  }
  violations.push(...ruleBanned(work, deck.formatCode, cfg.name));

  // GLC extras
  if (deck.formatCode === 'glc') {
    violations.push(...ruleTypeCoherence(work, deck.glcType ?? null));
    violations.push(...ruleExclusiveGroups(work));
    violations.push(...ruleNotTournamentLegal(work));
  }

  // staleness note (§2.6): if the vendored data is >30 days old, say so
  const checkedAt = formatsCheckedAt();
  const ageDays = (Date.now() - new Date(checkedAt).getTime()) / 86_400_000;
  if (ageDays > 30) {
    warnings.push({ code: 'STALE_FORMAT_DATA', message: `Format legality data last verified ${checkedAt}.` });
  }

  const legal = !violations.some((v) => v.severity === 'error');
  return {
    format: deck.formatCode,
    format_data_checked_at: checkedAt,
    legal,
    counts: counts(work, unresolved),
    violations,
    warnings,
  };
}
