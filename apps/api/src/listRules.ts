import { q1 } from './db.js';
import { badRequest, notFound, str } from './http.js';
import { assertKnownRarities, FINISHES, GOALS, missingForGoal, type Goal, type MissingRow } from './missing.js';

/**
 * Smart lists — the saved query a dynamic list can carry (migration 050).
 *
 * The owner's original complaint: "I satisfied the condition of owning
 * Growlithe, he should not be on the list anymore." A dynamic list built by
 * `addMissing` materialised the query once, so its membership aged the moment
 * the collection moved. The decision (DECISIONS.md 2026-08-29): a dynamic
 * list MAY store the query itself and be RE-EVALUATED ON EVERY READ.
 *
 * The rule's filter half is deliberately the same shape `addMissing` accepts —
 * one vocabulary for "which cards", whether you materialise it once or keep it
 * live — and `parseMissingSpec` below is that shared parser (the `addMissing`
 * handler calls it too, so the two cannot drift). On top of it a rule adds:
 *
 *   setName  — resolved at write time, display-only (the editor shows it
 *              without a lookup).
 *   exclude  — card_variant ids the user removed BY HAND. "Remove this card"
 *              on a rule-backed list cannot be a row delete (there is no row,
 *              and the rule would put the card straight back), so it is an
 *              exclusion the rule subtracts. Un-excluding lives in the rule
 *              editor.
 *
 * Evaluation delegates to `missingForGoal` — the one definition of "missing"
 * shared with the cart routes and MCP's set_progress — so a smart list, the
 * cart and the progress numbers can never disagree about membership.
 */

/** The filter half — exactly the `addMissing` spec. */
export interface MissingSpec {
  setId: string;
  goal: Goal;
  finishes: string[] | null;
  rarity: string[] | null;
  rarityExclude: string[] | null;
  maxPriceUsd: number | null;
  pricedOnly: boolean;
}

export interface ListRule extends MissingSpec {
  setName: string | null;
  exclude: number[];
}

/** Ceiling on hand-excluded cards; far above any real use, keeps the JSONB bounded. */
const EXCLUDE_MAX = 500;

function oneOfStrict<T extends string>(field: string, v: unknown, allowed: readonly T[]): T {
  const s = typeof v === 'string' ? (v.toLowerCase() as T) : undefined;
  if (s !== undefined && allowed.includes(s)) return s;
  throw badRequest(`${field} must be one of: ${allowed.join('|')}`);
}

/**
 * Validate the shared filter spec. Field-for-field the checks `addMissing`
 * always made, hoisted so the rule path is the same code. `where` prefixes the
 * error messages ('addMissing' | 'rule').
 */
export function parseMissingSpec(raw: unknown, where: string): MissingSpec {
  if (raw === null || typeof raw !== 'object') throw badRequest(`${where} must be an object`);
  const spec = raw as Record<string, unknown>;
  const setId = str(spec.setId);
  if (!setId) throw badRequest(`${where}.setId is required`);
  const goal = spec.goal === undefined ? 'complete' : oneOfStrict(`${where}.goal`, spec.goal, GOALS);
  let finishes: string[] | null = null;
  if (spec.finishes !== undefined && spec.finishes !== null) {
    if (!Array.isArray(spec.finishes)) throw badRequest(`${where}.finishes must be an array`);
    finishes = (spec.finishes as unknown[]).map((f) => String(f).toLowerCase());
    const bad = finishes.filter((f) => !(FINISHES as readonly string[]).includes(f));
    if (bad.length) throw badRequest(`Unknown finish '${bad[0]}' — expected one of: ${FINISHES.join(', ')}`);
    if (finishes.length === 0) finishes = null;
  }
  const rarity = Array.isArray(spec.rarity) && spec.rarity.length ? (spec.rarity as unknown[]).map(String) : null;
  const rarityExclude =
    Array.isArray(spec.rarityExclude) && spec.rarityExclude.length ? (spec.rarityExclude as unknown[]).map(String) : null;
  if (rarity) assertKnownRarities(rarity);
  if (rarityExclude) assertKnownRarities(rarityExclude);
  const maxPriceUsd = spec.maxPriceUsd === undefined || spec.maxPriceUsd === null ? null : Number(spec.maxPriceUsd);
  if (maxPriceUsd !== null && !(Number.isFinite(maxPriceUsd) && maxPriceUsd >= 0)) {
    throw badRequest(`${where}.maxPriceUsd must be a non-negative number`);
  }
  return { setId, goal, finishes, rarity, rarityExclude, maxPriceUsd, pricedOnly: spec.pricedOnly === true };
}

/** Validate a full rule (filter spec + exclusions). `setName` is ignored on
 *  input — it is resolved server-side at write time, never trusted. */
export function parseRule(raw: unknown): Omit<ListRule, 'setName'> {
  const spec = parseMissingSpec(raw, 'rule');
  const rec = raw as Record<string, unknown>;
  let exclude: number[] = [];
  if (rec.exclude !== undefined && rec.exclude !== null) {
    if (!Array.isArray(rec.exclude)) throw badRequest('rule.exclude must be an array of variant ids');
    exclude = [...new Set((rec.exclude as unknown[]).map((v) => Number(v)))];
    if (exclude.some((n) => !Number.isInteger(n) || n <= 0)) throw badRequest('rule.exclude must contain positive integers');
    if (exclude.length > EXCLUDE_MAX) throw badRequest(`rule.exclude must be ${EXCLUDE_MAX} entries or fewer`);
  }
  return { ...spec, exclude };
}

/** Resolve the rule's set to its DB id + display name; 404s on an unknown set. */
export async function resolveRuleSet(setId: string): Promise<{ id: string; name: string }> {
  const set = await q1<{ id: string; name: string }>(
    `SELECT cs.id, cs.name FROM card_set cs JOIN series ser ON ser.id = cs.series_id
      WHERE cs.tcgdex_id = $1 ORDER BY (ser.catalogue_code = 'en') DESC LIMIT 1`,
    [setId],
  );
  if (!set) throw notFound(`No set '${setId}'`);
  return set;
}

/**
 * Evaluate a rule for a user: `missingForGoal` minus the hand-exclusions.
 * The order is the evaluator's (number_sort) — a smart list has no custom
 * order, which is also why reorder is refused on one.
 */
export async function evaluateRule(userId: string, rule: ListRule): Promise<MissingRow[]> {
  const set = await resolveRuleSet(rule.setId);
  const rows = await missingForGoal(userId, set.id, rule.goal, {
    finishes: rule.finishes,
    rarity: rule.rarity,
    rarityExclude: rule.rarityExclude,
    maxPriceUsd: rule.maxPriceUsd,
    pricedOnly: rule.pricedOnly,
  });
  if (!rule.exclude.length) return rows;
  const out = new Set(rule.exclude.map(Number));
  return rows.filter((r) => !out.has(Number(r.card_variant_id)));
}

/** Normalise whatever JSONB came back from the DB into a well-typed rule. */
export function ruleFromDb(raw: unknown): ListRule | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    setId: String(r.setId ?? ''),
    setName: r.setName == null ? null : String(r.setName),
    goal: (GOALS as readonly string[]).includes(String(r.goal)) ? (String(r.goal) as Goal) : 'complete',
    finishes: Array.isArray(r.finishes) ? r.finishes.map(String) : null,
    rarity: Array.isArray(r.rarity) ? r.rarity.map(String) : null,
    rarityExclude: Array.isArray(r.rarityExclude) ? r.rarityExclude.map(String) : null,
    maxPriceUsd: r.maxPriceUsd == null ? null : Number(r.maxPriceUsd),
    pricedOnly: r.pricedOnly === true,
    exclude: Array.isArray(r.exclude) ? r.exclude.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
  };
}

/** The synthetic item id a rule-evaluated row carries ("rule-<variantId>").
 *  There is no list_item row to name, and DELETE /items/:itemId uses this
 *  shape to recognise "remove" as an exclusion. */
export function ruleItemId(variantId: number | string): string {
  return `rule-${variantId}`;
}

export function parseRuleItemId(itemId: string): number | null {
  const m = /^rule-(\d{1,12})$/.exec(itemId);
  return m ? Number(m[1]) : null;
}
