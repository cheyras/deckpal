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
import { MODELS, type Job } from './models.js';

/** Where the Gateway lists what a key can reach. */
const MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';

export interface ModelCheck {
  /** Every configured id that the key cannot reach. Empty is the good case. */
  missing: string[];
  /** How many ids were checked. */
  checked: number;
  /** Set when the Gateway could not be asked — NOT the same as "all present". */
  unreachable?: string;
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
    const body = (await res.json()) as { data?: { id?: string }[] };
    const have = new Set((body.data ?? []).map((m) => m.id).filter((x): x is string => !!x));
    // An EMPTY catalogue is not evidence that everything is missing — it is
    // evidence that the answer was not usable. Reporting 5 missing models
    // because a response shape changed would be a false alarm loud enough to
    // train people to ignore this.
    if (have.size === 0) {
      return { missing: [], checked: ids.length, unreachable: 'gateway returned no models' };
    }
    return { missing: ids.filter((id) => !have.has(id)), checked: ids.length };
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
  if (check.missing.length === 0) return null;
  return (
    `[deck-e] ${check.missing.length} configured model id(s) DO NOT EXIST on this ` +
    `Gateway key: ${check.missing.join(', ')}. Every call routed to one of them will ` +
    `fail with a 404. Fix the id in decke/models.ts.`
  );
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
} {
  if (check.unreachable) return { status: 'unverified', checked: check.checked };
  if (check.missing.length) {
    return { status: 'missing', checked: check.checked, missing: check.missing };
  }
  return { status: 'ok', checked: check.checked };
}
