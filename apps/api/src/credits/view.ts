export interface FlatCreditQuote {
  enabled: boolean;
  lowAt: number;
  mode?: 'flat';
  prices: Record<string, number>;
  pricingRevision: number;
  unlimited: boolean;
  overrideRevision: number;
}

export interface MeteredCreditQuote {
  enabled: boolean;
  lowAt: number;
  mode: 'metered';
  holdCredits: number;
  holdMinCredits: number;
  pricingRevision: number;
  unlimited: boolean;
  overrideRevision: number;
}

export type CreditQuote = FlatCreditQuote | MeteredCreditQuote;

function decimalText(value: unknown): string {
  const text = typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) throw new Error('Invalid decimal credit balance');
  return text;
}

/** Round a trusted SQL numeric string for JSON display without doing money arithmetic in a float. */
export function decimalNumber(value: unknown, places = 4): number {
  const exact = decimalText(value);
  const negative = exact.startsWith('-');
  const unsigned = negative ? exact.slice(1) : exact;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const kept = fraction.slice(0, places).padEnd(places, '0');
  const next = fraction[places] ?? '0';
  let scaled = BigInt(whole) * 10n ** BigInt(places) + BigInt(kept || '0');
  if (next >= '5') scaled += 1n;
  if (negative) scaled = -scaled;
  const rendered = places === 0
    ? scaled.toString()
    : `${scaled < 0n ? '-' : ''}${(scaled < 0n ? -scaled : scaled).toString().padStart(places + 1, '0').slice(0, -places)}.${(scaled < 0n ? -scaled : scaled).toString().padStart(places + 1, '0').slice(-places)}`;
  const result = Number(rendered);
  if (!Number.isFinite(result) || !Number.isSafeInteger(Number(whole))) throw new Error('Credit balance is outside the supported JSON range');
  return result;
}

export function shapeWalletAccounting(quote: CreditQuote, state: Record<string, unknown>): Record<string, unknown> {
  if (quote.mode === 'metered') {
    const exact = decimalText(state.balance);
    const { prices: _retiredPrices, ...withoutPrices } = state;
    return {
      ...withoutPrices,
      mode: 'metered',
      balance: decimalNumber(exact),
      balanceExact: exact,
      heldCredits: Number(state.heldCredits ?? 0),
      holdCredits: quote.holdCredits,
      holdMinCredits: quote.holdMinCredits,
    };
  }
  return { ...state, mode: 'flat', prices: quote.prices };
}
