/**
 * Do the models we are configured to call actually exist?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `MODELS.research.id` was `openai/o3-deep-research` for the entire life of the
 * feature. That model is not on the Gateway key. Every research call answered
 * HTTP 404 `model_not_found`, and nothing anywhere said so:
 *
 *   - it typechecks, because a model id is a string;
 *   - it builds, because nothing resolves it at build time;
 *   - it passes CI, because CI never calls a model;
 *   - it passed code review twice, because `openai/o3-deep-research` is a real
 *     OpenAI product name and looks exactly right;
 *   - and at runtime the failure was framed as an answer (see `deep.ts`), so
 *     even using the feature did not reveal it.
 *
 * Six ways to not notice. The defect was found by asking the Gateway what it
 * has, which is the one thing nobody had done — so that question is now asked
 * automatically, on the same schedule as every other B11 configuration report.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT IT DOES NOT DO
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * It does not check that a model is any GOOD, or that it can search, or that it
 * will answer within a budget. Those are measurements and they belong in
 * `models.ts`'s comments where the evidence lives. This answers one question —
 * *is this id real* — because that is the question whose "no" was invisible.
 *
 * It also never blocks a boot. A Gateway that is unreachable at cold start is
 * not a reason to take Deck-E down; it is a reason to say so.
 */
import { EVALUATION, MODELS, TIERS, TRIAGE, type Job } from './models.js';
import { DIRECT_MODELS } from './aiRoute.js';

/** Where the Gateway lists what a key can reach. */
const MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';

export interface ModelCheck {
  /** Every configured id that the key cannot reach. Empty is the good case. */
  missing: string[];
  /** How many ids were checked. */
  checked: number;
  /** Set when the Gateway could not be asked — NOT the same as "all present". */
  unreachable?: string;
  /**
   * Anthropic models whose Gateway price no longer matches `DIRECT_MODELS` in
   * `aiRoute.ts`. The direct road prices calls with that table so a credit
   * costs the same on either road; a drifted row means it no longer does.
   */
  priceDrift?: string[];
}

interface GatewayPriceTier { cost?: string; min?: number }
interface GatewayModelRow {
  id?: string;
  pricing?: Record<string, unknown> & {
    input?: string; output?: string; input_cache_read?: string; input_cache_write?: string;
  };
}

/** Numeric equality of two decimal strings ("0.0000025" vs "0.00000250"). */
function sameRate(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.trim() !== '' && Number(a) === Number(b);
}

/**
 * Compare the Gateway's published per-token prices with the rates the direct
 * road charges. Only models present in BOTH are compared: a model the Gateway
 * does not list is already reported as missing above.
 */
export function priceDrift(rows: GatewayModelRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const spec = row.id ? DIRECT_MODELS[row.id] : undefined;
    const p = row.pricing;
    if (!spec || !p) continue;
    const base = sameRate(p.input, spec.rates.input) && sameRate(p.output, spec.rates.output) &&
      sameRate(p.input_cache_read, spec.rates.cacheRead) && sameRate(p.input_cache_write, spec.rates.cacheWrite);
    const upper = (key: string) => {
      const tiers = p[key];
      return Array.isArray(tiers) ? (tiers as GatewayPriceTier[]).find((t) => (t.min ?? 0) > 0) : undefined;
    };
    const lc = spec.longContext;
    const tiered = ['input_tiers', 'output_tiers', 'input_cache_read_tiers', 'input_cache_write_tiers'].some((k) => upper(k));
    const long = !lc
      ? !tiered
      : upper('input_tiers')?.min === lc.above + 1 &&
        sameRate(upper('input_tiers')?.cost, lc.rates.input) && sameRate(upper('output_tiers')?.cost, lc.rates.output) &&
        sameRate(upper('input_cache_read_tiers')?.cost, lc.rates.cacheRead) &&
        sameRate(upper('input_cache_write_tiers')?.cost, lc.rates.cacheWrite);
    if (!base || !long) out.push(row.id!);
  }
  return out.sort();
}

/**
 * Every model id this deployment might call, primary and fallback and escalate.
 *
 * All three, because a fallback nobody has verified is a fallback that fails at
 * exactly the moment it is needed — which is the failure mode of the row this
 * file was written for.
 */
export function configuredModelIds(): string[] {
  const out = new Set<string>();
  for (const job of Object.keys(MODELS) as Job[]) {
    const c = MODELS[job];
    out.add(c.id);
    if (c.fallback) out.add(c.fallback);
    if (c.escalate) out.add(c.escalate);
  }
  // Conversation routing is separate from `MODELS.chat`: other routes still
  // use that legacy row, while Deck-E itself can now reach all three tiers.
  for (const c of Object.values(TIERS)) {
    out.add(c.id);
    if (c.fallback) out.add(c.fallback);
  }
  out.add(TRIAGE.id);
  // The judgment model too: a Jev id the Gateway stopped listing would fail
  // open on every turn, silently, which is exactly what this check exists for.
  out.add(EVALUATION.id);
  return [...out].sort();
}

/**
 * Ask the Gateway which of them are real.
 *
 * `fetchImpl` is injected so the test can answer without a network call and
 * without a key — the same shape `entitlement.ts` and `build.ts` use for their
 * own environment reads.
 */
export async function checkModels(
  apiKey: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelCheck> {
  const ids = configuredModelIds();
  if (!apiKey) return { missing: [], checked: ids.length, unreachable: 'no gateway key configured' };
  try {
    const res = await fetchImpl(MODELS_URL, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      return { missing: [], checked: ids.length, unreachable: `gateway answered ${res.status}` };
    }
    const body = (await res.json()) as { data?: GatewayModelRow[] };
    const have = new Set((body.data ?? []).map((m) => m.id).filter((x): x is string => !!x));
    // An EMPTY catalogue is not evidence that everything is missing — it is
    // evidence that the answer was not usable. Reporting 5 missing models
    // because a response shape changed would be a false alarm loud enough to
    // train people to ignore this.
    if (have.size === 0) {
      return { missing: [], checked: ids.length, unreachable: 'gateway returned no models' };
    }
    const drift = priceDrift(body.data ?? []);
    return { missing: ids.filter((id) => !have.has(id)), checked: ids.length, ...(drift.length ? { priceDrift: drift } : {}) };
  } catch (err) {
    return {
      missing: [],
      checked: ids.length,
      unreachable: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The boot line, in the shape B11 already uses elsewhere.
 *
 * Returns null when there is nothing worth saying, so a healthy deployment
 * stays quiet and the one that is broken is the one that speaks.
 */
export function modelCheckWarning(check: ModelCheck): string | null {
  if (check.unreachable) {
    return (
      `[deck-e] could not verify model ids with the AI Gateway (${check.unreachable}). ` +
      `This is not a failure on its own — but a model id that does not exist fails ` +
      `at call time with a 404, and that is how research was silently broken.`
    );
  }
  const lines: string[] = [];
  if (check.missing.length > 0) {
    lines.push(
      `[deck-e] ${check.missing.length} configured model id(s) DO NOT EXIST on this ` +
      `Gateway key: ${check.missing.join(', ')}. Every call routed to one of them will ` +
      `fail with a 404. Fix the id in decke/models.ts.`,
    );
  }
  if (check.priceDrift?.length) {
    lines.push(
      `[ai-route] the AI Gateway's price for ${check.priceDrift.join(', ')} no longer matches ` +
      `DIRECT_MODELS in decke/aiRoute.ts. Calls served on the Anthropic-direct road are being ` +
      `metered at the OLD rate, so credits differ by road until the table is updated.`,
    );
  }
  return lines.length ? lines.join('\n') : null;
}

/**
 * What `/api/health` reports.
 *
 * NAMES THE MISSING IDS, unlike `deckeEntitlementStatus`, which deliberately
 * never returns its list. The difference is what the value IS: entitlement
 * holds user ids, and `/health` is unauthenticated. A model id is a public
 * product name, and naming it is the entire use of the check — "one model is
 * wrong" without saying which is a puzzle rather than a report.
 */
export function modelCheckStatus(check: ModelCheck): {
  status: 'ok' | 'missing' | 'unverified';
  checked: number;
  missing?: string[];
  priceDrift?: string[];
} {
  if (check.unreachable) return { status: 'unverified', checked: check.checked };
  const drift = check.priceDrift?.length ? { priceDrift: check.priceDrift } : {};
  if (check.missing.length) {
    return { status: 'missing', checked: check.checked, missing: check.missing, ...drift };
  }
  return { status: 'ok', checked: check.checked, ...drift };
}
