import type { PaymentHistoryItem } from './api'

const supported = new Set(((Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency') ?? ['USD', 'JPY']).map(v => v.toUpperCase()))
export function formatMinorAmount(amountMinor: number, currency: string, locale?: string): string {
  const code = currency.toUpperCase()
  if (!Number.isSafeInteger(amountMinor) || !/^[A-Z]{3}$/.test(code) || !supported.has(code)) return `${Number.isFinite(amountMinor) ? Math.trunc(amountMinor) : 0} ${/^[A-Z]{3}$/.test(code) ? code : 'currency units'}`
  try {
    // Stripe keeps ISK and UGX API amounts in hundredths for backwards
    // compatibility even though Intl correctly describes their display exponent
    // as zero. Preserve synthetic fractional values defensively for old records.
    if (code === 'ISK' || code === 'UGX') {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(amountMinor / 100)
    }
    const probe = new Intl.NumberFormat(locale, { style: 'currency', currency: code })
    const digits = probe.resolvedOptions().maximumFractionDigits
    return probe.format(amountMinor / 10 ** (digits ?? 2))
  } catch { return `${amountMinor} ${code}` }
}
export function paymentStatusText(item: Pick<PaymentHistoryItem, 'status' | 'refundedMinor' | 'disputed'>): string {
  const base = item.status === 'paid' ? 'Paid' : item.status === 'authorized' ? 'Authorized, not captured' : item.status === 'pending' ? 'Pending attempt' : 'Failed attempt'
  return `${base}${item.refundedMinor > 0 ? ` · ${item.refundedMinor} refunded` : ''}${item.disputed ? ' · Disputed' : ''}`
}
