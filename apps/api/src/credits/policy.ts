import { badRequest } from '../http.js';

export interface CreditPolicy {
  enabled: boolean;
  microUsdPerCredit: number;
  markupBps: number;
  estimatedMicroUsd: { chatTurn: number; analysis: number; planDeck: number };
  lowBalance: number;
}
export interface PolicyRevision { policy: CreditPolicy; revision: number; updatedAt: string }
export const DEFAULT_POLICY: CreditPolicy = {
  enabled: false, microUsdPerCredit: 10_000, markupBps: 0,
  estimatedMicroUsd: { chatTurn: 143, analysis: 35_600, planDeck: 750_000 }, lowBalance: 100,
};
export const ESTIMATE_NOTICE = 'Initial estimates preserve the previous 1 / 4 / 75 credit prices. The chat estimate is stale: current model notes estimate $0.01153 per turn, compared with the initial $0.000143. Review these estimates before enabling sales. Prices are flat estimates, not measured token costs or realized profit margins.';
export const CHARGE_NOTICE = 'Each chat request and approved deep operation has a flat credit price. Changes apply to future requests; existing balances and history keep their integer credit counts. Work cancelled before provider invocation is refunded. Once provider invocation begins, failures and cancellations retain the quoted charge; token settlement is not performed.';

export function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${label} must be an object`);
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !keys.includes(k))) throw badRequest(`${label} contains an unknown field`);
  return v;
}
export function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw badRequest(`${label} must be a whole number from ${min} to ${max}`);
  }
  return value;
}
export function normalizePolicy(value: unknown): CreditPolicy {
  const p = object(value, ['enabled', 'microUsdPerCredit', 'markupBps', 'estimatedMicroUsd', 'lowBalance'], 'policy');
  const e = object(p.estimatedMicroUsd, ['chatTurn', 'analysis', 'planDeck'], 'estimatedMicroUsd');
  if (typeof p.enabled !== 'boolean') throw badRequest('enabled must be a boolean');
  const policy: CreditPolicy = {
    enabled: p.enabled,
    microUsdPerCredit: integer(p.microUsdPerCredit, 1, 1_000_000_000, 'microUsdPerCredit'),
    markupBps: integer(p.markupBps, 0, 100_000, 'markupBps'),
    estimatedMicroUsd: {
      chatTurn: integer(e.chatTurn, 0, 1_000_000_000, 'chatTurn'),
      analysis: integer(e.analysis, 0, 1_000_000_000, 'analysis'),
      planDeck: integer(e.planDeck, 0, 1_000_000_000, 'planDeck'),
    },
    lowBalance: integer(p.lowBalance, 0, 1_000_000, 'lowBalance'),
  };
  pricesFor(policy);
  return policy;
}
export function priceFor(cost: number, policy: CreditPolicy): number {
  const numerator = BigInt(cost) * BigInt(10_000 + policy.markupBps);
  const denominator = BigInt(policy.microUsdPerCredit) * 10_000n;
  const result = (numerator + denominator - 1n) / denominator;
  if (result > 2_147_483_647n) throw badRequest('The policy produces an operation price above the supported credit limit');
  return Number(result > 0n ? result : 1n);
}
export function pricesFor(policy: CreditPolicy) {
  return {
    chatTurn: priceFor(policy.estimatedMicroUsd.chatTurn, policy),
    analysis: priceFor(policy.estimatedMicroUsd.analysis, policy),
    planDeck: priceFor(policy.estimatedMicroUsd.planDeck, policy),
  };
}
export function operationFor(tool: string): 'chatTurn' | 'analysis' | 'planDeck' {
  return tool === 'chat_turn' ? 'chatTurn' : ['analyze_collection', 'research_meta'].includes(tool) ? 'analysis' : 'planDeck';
}
export function attemptKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) throw badRequest('idempotencyKey must contain 8–100 letters, digits, underscores or hyphens');
  return value;
}
export function reasonText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > 500) throw badRequest('reason must contain 3–500 characters');
  return value.trim();
}
export function normalizePack(value: unknown) {
  const p = object(value, ['name', 'credits', 'priceCents', 'currency', 'active', 'expectedRevision'], 'pack');
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 80) throw badRequest('name must contain 1–80 characters');
  if (p.currency !== 'usd') throw badRequest('currency must be usd');
  if (typeof p.active !== 'boolean') throw badRequest('active must be a boolean');
  return { name: p.name.trim(), credits: integer(p.credits, 1, 1_000_000, 'credits'), priceCents: integer(p.priceCents, 100, 50_000, 'priceCents'), currency: 'usd' as const, active: p.active };
}
