/** Decimal inputs are parsed as integers, never rounded through binary floats. */
export function decimalUnits(text: string, places: number): number | null {
  const value = text.trim()
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > places) return null
  const result = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0') || '0')
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null
}
export function creditPrice(cost: number, microUsdPerCredit: number, markupBps: number): number | null {
  if (![cost, microUsdPerCredit, markupBps].every(Number.isSafeInteger) || cost < 0 || microUsdPerCredit <= 0 || markupBps < 0) return null
  const numerator = BigInt(cost) * (10_000n + BigInt(markupBps)), denominator = BigInt(microUsdPerCredit) * 10_000n
  const amount = (numerator + denominator - 1n) / denominator
  return amount > BigInt(Number.MAX_SAFE_INTEGER) ? null : Math.max(1, Number(amount))
}
export const dollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

export const creditCount = (count: number | null) => count === null ? '—' : count.toLocaleString() + (count === 1 ? ' credit' : ' credits')

/** A money-facing credit number: never invent precision beyond the API's four decimals. */
export function formatCreditDecimal(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toFixed(4).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
}

export function decimalCreditCount(value: number | null): string {
  if (value === null) return '—'
  const formatted = formatCreditDecimal(value)
  return `${formatted} ${Math.abs(value) === 1 ? 'credit' : 'credits'}`
}

/** Headers are strings because a metered balance can carry fractional credits. */
export function parseCreditHeader(value: string | null): number | null {
  if (value === null || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export type WalletViewModel = { mode: 'flat' | 'metered'; usageTitle: string; usageDetail: string; heldDetail: string | null }
export function walletViewModel(wallet: { mode: 'flat' | 'metered'; holdCredits?: number; heldCredits?: number }): WalletViewModel {
  if (wallet.mode === 'metered') return {
    mode: 'metered',
    usageTitle: 'How metered usage works',
    usageDetail: `You pay what the AI model actually costs. Each reply briefly sets aside up to ${formatCreditDecimal(wallet.holdCredits ?? 0)} credits and returns what it didn't use. If a reply runs a little past what you have left, it still finishes and DeckPal covers the difference.`,
    heldDetail: wallet.heldCredits ? `${formatCreditDecimal(wallet.heldCredits)} credits currently set aside for an active reply.` : null,
  }
  return { mode: 'flat', usageTitle: 'Usage prices', usageDetail: '', heldDetail: null }
}

export function meteredPolicyValid(policy: { legHoldCredits: string; legHoldMinCredits: string; denomination: string; markup: string; lowBalance: string; overageBufferMaxCredits: string }): boolean {
  const hold = Number(policy.legHoldCredits), min = Number(policy.legHoldMinCredits)
  const denomination = decimalUnits(policy.denomination, 6), markup = decimalUnits(policy.markup, 2)
  return /^\d+$/.test(policy.legHoldCredits) && /^\d+$/.test(policy.legHoldMinCredits) && Number.isSafeInteger(hold) && Number.isSafeInteger(min) && min >= 1 && min <= hold && hold <= 10_000 && denomination !== null && denomination > 0 && markup !== null && /^\d+$/.test(policy.lowBalance) && Number.isSafeInteger(Number(policy.lowBalance)) && /^\d+$/.test(policy.overageBufferMaxCredits) && Number(policy.overageBufferMaxCredits) <= 10_000_000
}
