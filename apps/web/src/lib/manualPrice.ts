export function currencyMinorUnit(currency: string): number {
  return currency.toUpperCase() === 'JPY' ? 0 : 2
}

export function formatMinor(amountMinor: number, currency: string, locale = 'en-MY'): string {
  const unit = currencyMinorUnit(currency)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: unit,
    maximumFractionDigits: unit,
  }).format(amountMinor / 10 ** unit)
}

export function priceAge(observedOn: string, today = new Date()): { days: number; state: 'fresh' | 'aging' | 'stale'; label: string } {
  const observed = new Date(`${observedOn}T00:00:00Z`)
  const current = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const days = Math.max(0, Math.floor((current.getTime() - observed.getTime()) / 86_400_000))
  if (days <= 7) return { days, state: 'fresh', label: days === 0 ? 'Hari ini' : `${days} hari lalu` }
  if (days <= 30) return { days, state: 'aging', label: `${days} hari lalu` }
  return { days, state: 'stale', label: `Lama · ${days} hari` }
}
