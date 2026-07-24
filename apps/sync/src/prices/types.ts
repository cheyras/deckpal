// Upstream row shapes (only the fields we read) + shared helpers.

export interface TcgcsvPriceRow {
  productId: number;
  subTypeName: string; // 'Normal' | 'Holofoil' | 'Reverse Holofoil' | '1st Edition' | 'Unlimited' | …
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
}
export interface TcgcsvPriceEnvelope {
  success: boolean;
  errors: string[];
  results: TcgcsvPriceRow[];
}

export interface TcgcsvProductRow {
  productId: number;
  name: string;
  cleanName?: string;
  url?: string;
  extendedData?: { name: string; value: string }[];
}
export interface TcgcsvProductEnvelope {
  success: boolean;
  errors: string[];
  results: TcgcsvProductRow[];
}

export interface CardmarketGuide {
  idProduct: number;
  idCategory: number;
  avg: number | null;
  low: number | null;
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  'avg-holo': number | null;
  'low-holo': number | null;
  'trend-holo': number | null;
  'avg1-holo': number | null;
  'avg7-holo': number | null;
  'avg30-holo': number | null;
}
export interface CardmarketFile {
  version: number;
  createdAt: string;
  priceGuides: CardmarketGuide[];
}

// price minor units: null / non-positive → NULL (the schema's `> 0` CHECKs make 0 unrepresentable,
// so absence is a NULL, i.e. "no price"). SCHEMA §7.2 / DATA-LAYER §4.6.
export function toMinor(price: number | null | undefined, minorUnit: number): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const v = Math.round(price * 10 ** minorUnit);
  return v > 0 ? v : null;
}

// The 9 price_observation / price_current metric columns, in a fixed order for batch inserts.
export const METRIC_COLS = [
  'market_minor', 'low_minor', 'mid_minor', 'high_minor', 'direct_low_minor',
  'trend_minor', 'avg1_minor', 'avg7_minor', 'avg30_minor',
] as const;
export type Metrics = Partial<Record<(typeof METRIC_COLS)[number], number | null>>;

export function hasAnyMetric(m: Metrics): boolean {
  return METRIC_COLS.some((c) => m[c] != null);
}

// leading integer of a TCGplayer extendedData Number value ("38/114" → 38); null if not numeric.
export function cardNumberNumeric(product: TcgcsvProductRow): number | null {
  const raw = product.extendedData?.find((e) => e.name === 'Number')?.value;
  if (!raw) return null;
  const m = /^\s*(\d+)/.exec(raw);
  return m ? parseInt(m[1]!, 10) : null;
}
