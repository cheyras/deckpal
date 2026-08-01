/**
 * Pure battle-synthesis logic — archetype normalization, narrative validation,
 * merge semantics for idempotent re-synthesis, and queue "needs" computation.
 *
 * NO I/O in this file (CI purity, BATTLE-INTEL-SPEC §1 Ground Truth #9): the
 * registry rows come in as arguments; tools/synthesis.ts does the SQL.
 */

// ── Archetype normalization (W0 registry contract, migration 020) ────────────

/**
 * One archetype-registry row, aggregated from `archetype` + `archetype_alias`:
 * canonical slug (what battle_log.my/opp_archetype stores, FK-enforced),
 * display name, and normalized aliases.
 */
export interface ArchetypeRow {
  slug: string;
  name: string;
  aliases: readonly string[];
}

export interface ArchetypeSuggestion {
  slug: string;
  name: string;
}

export type NormalizeResult =
  | { ok: true; slug: string; name: string; via: 'slug' | 'name' | 'alias' }
  | { ok: false; input: string; suggestions: ArchetypeSuggestion[] };

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Lowercase character-trigram set, for cheap fuzzy suggestion ranking. */
function trigrams(s: string): Set<string> {
  const t = new Set<string>();
  const p = `  ${norm(s)} `;
  for (let i = 0; i < p.length - 2; i++) t.add(p.slice(i, i + 3));
  return t;
}

function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const g of ta) if (tb.has(g)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Normalize a free-text archetype label through the registry, per migration
 * 020's grouping rule: normalize (lower/trim/collapse whitespace), match the
 * canonical slug directly (the slug is its own implicit alias), then
 * archetype_alias. The display name is additionally accepted — it resolves to
 * a registered slug, so nothing is invented. No match → REJECT with ranked
 * suggestions; this layer NEVER creates slugs (matchup_stats groups on them,
 * and battle_log's FK would refuse anyway).
 */
export function normalizeArchetype(input: string, registry: readonly ArchetypeRow[]): NormalizeResult {
  const n = norm(input);
  if (!n) return { ok: false, input, suggestions: [] };
  for (const r of registry) {
    if (r.slug === n) return { ok: true, slug: r.slug, name: r.name, via: 'slug' };
  }
  for (const r of registry) {
    if (r.aliases.some((a) => norm(a) === n)) return { ok: true, slug: r.slug, name: r.name, via: 'alias' };
  }
  for (const r of registry) {
    if (norm(r.name) === n) return { ok: true, slug: r.slug, name: r.name, via: 'name' };
  }
  const suggestions = registry
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      score: Math.max(similarity(input, r.slug), similarity(input, r.name), ...r.aliases.map((a) => similarity(input, a))),
    }))
    .filter((s) => s.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ slug, name }) => ({ slug, name }));
  return { ok: false, input, suggestions };
}

// ── Narrative validation ─────────────────────────────────────────────────────

/** Rubric target (SKILL.md): ~150–300 words, written for retrieval. */
export const NARRATIVE_TARGET_MIN = 150;
export const NARRATIVE_TARGET_MAX = 300;
/** Hard bounds: below/above these the save is refused, not just advised. */
export const NARRATIVE_HARD_MIN = 50;
export const NARRATIVE_HARD_MAX = 500;

export function wordCount(s: string): number {
  const words = s.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Validate a narrative against the rubric bounds.
 * → { ok: false } = refuse the save; { ok: true, advisory } = save, advisory
 * (or null) is appended to the confirmation so drift is visible, not silent.
 */
export function checkNarrative(s: string): { ok: false; reason: string } | { ok: true; words: number; advisory: string | null } {
  const words = wordCount(s);
  if (words < NARRATIVE_HARD_MIN) {
    return { ok: false, reason: `narrative is ${words} words — too short to be retrieval-worthy (hard minimum ${NARRATIVE_HARD_MIN}; rubric target ${NARRATIVE_TARGET_MIN}–${NARRATIVE_TARGET_MAX}).` };
  }
  if (words > NARRATIVE_HARD_MAX) {
    return { ok: false, reason: `narrative is ${words} words — over the hard maximum ${NARRATIVE_HARD_MAX} (rubric target ${NARRATIVE_TARGET_MIN}–${NARRATIVE_TARGET_MAX}). Tighten it; the structured fields carry the facts.` };
  }
  let advisory: string | null = null;
  if (words < NARRATIVE_TARGET_MIN) advisory = `narrative is ${words} words — under the ${NARRATIVE_TARGET_MIN}–${NARRATIVE_TARGET_MAX} rubric target.`;
  else if (words > NARRATIVE_TARGET_MAX) advisory = `narrative is ${words} words — over the ${NARRATIVE_TARGET_MIN}–${NARRATIVE_TARGET_MAX} rubric target.`;
  return { ok: true, words, advisory };
}

// ── Merge semantics (idempotent re-synthesis / partial correction) ───────────

/** The five structured synthesis fields on battle_log (W0 schema contract). */
export interface SynthesisFields {
  narrative: string | null;
  my_archetype: string | null;
  opp_archetype: string | null;
  tags: string[];
  key_cards: string[];
}

export interface MergeInput {
  narrative?: string;
  my_archetype?: string;
  opp_archetype?: string;
  tags?: string[];
  key_cards?: string[];
}

export interface MergeOutcome {
  fields: SynthesisFields;
  /** Field names whose value actually changed vs stored. */
  changed: (keyof SynthesisFields)[];
  /** Required fields still missing after the merge (narrative + both archetypes). */
  missing: ('narrative' | 'my_archetype' | 'opp_archetype')[];
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Merge an incoming save over the stored fields: provided fields replace,
 * omitted fields keep their stored value (so a re-save can fix one archetype,
 * or re-embed a pending narrative, without restating everything). The merged
 * record must be complete — `missing` lists what still isn't.
 */
export function mergeSynthesis(stored: SynthesisFields, incoming: MergeInput): MergeOutcome {
  const clean = (l: readonly string[] | undefined, lower = false): string[] | undefined =>
    l?.map((s) => s.trim().replace(/\s+/g, ' ')).map((s) => (lower ? s.toLowerCase() : s)).filter(Boolean);
  const fields: SynthesisFields = {
    narrative: incoming.narrative !== undefined ? incoming.narrative.trim() : stored.narrative,
    my_archetype: incoming.my_archetype !== undefined ? incoming.my_archetype.trim() : stored.my_archetype,
    opp_archetype: incoming.opp_archetype !== undefined ? incoming.opp_archetype.trim() : stored.opp_archetype,
    // tags are lowercase by contract (battle_log.tags comment, migration 020);
    // key_cards are card names and keep their casing.
    tags: clean(incoming.tags, true) ?? stored.tags,
    key_cards: clean(incoming.key_cards) ?? stored.key_cards,
  };
  const changed: (keyof SynthesisFields)[] = [];
  if (fields.narrative !== stored.narrative) changed.push('narrative');
  if (fields.my_archetype !== stored.my_archetype) changed.push('my_archetype');
  if (fields.opp_archetype !== stored.opp_archetype) changed.push('opp_archetype');
  if (!sameList(fields.tags, stored.tags)) changed.push('tags');
  if (!sameList(fields.key_cards, stored.key_cards)) changed.push('key_cards');
  const missing: MergeOutcome['missing'] = [];
  if (!fields.narrative?.trim()) missing.push('narrative');
  if (!fields.my_archetype?.trim()) missing.push('my_archetype');
  if (!fields.opp_archetype?.trim()) missing.push('opp_archetype');
  return { fields, changed, missing };
}

// ── Queue "needs" computation ────────────────────────────────────────────────

export interface QueueState {
  narrative: string | null;
  my_archetype: string | null;
  opp_archetype: string | null;
  /** true = battle_memories row exists with a non-null embedding. */
  embedded: boolean;
}

/** What a queue row still needs: subset of narrative / archetypes / embedding. */
export function needsOf(s: QueueState): ('narrative' | 'archetypes' | 'embedding')[] {
  const needs: ('narrative' | 'archetypes' | 'embedding')[] = [];
  if (!s.narrative?.trim()) needs.push('narrative');
  if (!s.my_archetype?.trim() || !s.opp_archetype?.trim()) needs.push('archetypes');
  if (!s.embedded) needs.push('embedding');
  return needs;
}
