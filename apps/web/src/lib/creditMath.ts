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
