import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type HistoryKind = 'support' | 'credits';
export type HistoryStatus = 'paid' | 'authorized' | 'pending' | 'failed';

export interface ProviderCustomer {
  id: string;
  deleted?: boolean;
  livemode?: boolean;
  metadata?: Record<string, string> | null;
}
export interface ProviderCharge {
  id: string;
  amount: number;
  amount_captured: number;
  amount_refunded: number;
  currency: string;
  created: number;
  paid: boolean;
  captured: boolean;
  status: string;
  disputed: boolean;
  receipt_url: string | null;
}
export interface ChargePage { data: ProviderCharge[]; has_more: boolean }
export interface HistoryProvider {
  retrieveCustomer(id: string): Promise<ProviderCustomer | null>;
  listCharges(args: { customer: string; limit: number; starting_after?: string }): Promise<ChargePage>;
}
export interface HistoryItem {
  id: string;
  type: string;
  createdAt: string;
  amountMinor: number;
  currency: string;
  status: HistoryStatus;
  refundedMinor: number;
  disputed: boolean;
  receiptUrl?: string;
}
export interface HistoryPage {
  kind: HistoryKind;
  items: HistoryItem[];
  nextCursor: string | null;
  coverage: string;
  billingAccountPresent: boolean;
}

export class HistoryError extends Error {
  constructor(readonly code: 'invalid_request' | 'billing_account_unavailable' | 'provider_unavailable', message: string) { super(message) }
}

const COVERAGE = 'Shows the current billing account only. Payments on older replaced or deleted billing accounts may be missing.';
const B64 = /^[A-Za-z0-9_-]{1,900}$/;
function digest(value: string): string { return createHash('sha256').update(value).digest('base64url').slice(0, 22) }
function signature(payload: string, secret: string): string { return createHmac('sha256', secret).update(payload).digest('base64url') }
function encodeCursor(data: object, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}
function decodeCursor(raw: string, secret: string): Record<string, unknown> {
  if (raw.length > 1000) throw new HistoryError('invalid_request', 'Invalid payment history cursor.');
  const parts = raw.split('.');
  if (parts.length !== 2 || !B64.test(parts[0]!) || !B64.test(parts[1]!)) throw new HistoryError('invalid_request', 'Invalid payment history cursor.');
  const expected = signature(parts[0]!, secret);
  const got = parts[1]!;
  if (expected.length !== got.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(got))) throw new HistoryError('invalid_request', 'Invalid payment history cursor.');
  try {
    const value = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HistoryError('invalid_request', 'Invalid payment history cursor.'); }
}
function receiptUrl(raw: string | null, paid: boolean): string | undefined {
  if (!raw || !paid) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'pay.stripe.com' || url.port || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined }
}
function status(charge: ProviderCharge): HistoryStatus {
  if (charge.status === 'pending') return 'pending';
  if (charge.status === 'failed' || !charge.paid) return 'failed';
  if (!charge.captured || charge.status !== 'succeeded') return 'authorized';
  return 'paid';
}

export async function paymentHistory(input: {
  actorId: string;
  kind: HistoryKind;
  customerId: string | null;
  expectedLive: boolean;
  cursor?: string;
  limit?: number;
  cursorSecret: string;
  provider: HistoryProvider;
}): Promise<HistoryPage> {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || input.cursorSecret.length < 16) throw new HistoryError('invalid_request', 'Invalid payment history request.');
  if (!input.customerId) return { kind: input.kind, items: [], nextCursor: null, coverage: COVERAGE, billingAccountPresent: false };
  const binding = { a: digest(input.actorId), k: input.kind, c: digest(input.customerId) };
  let starting_after: string | undefined;
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor, input.cursorSecret);
    if (cursor.v !== 1 || cursor.a !== binding.a || cursor.k !== binding.k || cursor.c !== binding.c || typeof cursor.p !== 'string' || !/^ch_[A-Za-z0-9_]{1,200}$/.test(cursor.p)) throw new HistoryError('invalid_request', 'Invalid payment history cursor.');
    starting_after = cursor.p;
  }
  let customer: ProviderCustomer | null;
  try { customer = await input.provider.retrieveCustomer(input.customerId) }
  catch { throw new HistoryError('provider_unavailable', 'Payment history is temporarily unavailable. Try again later.') }
  if (!customer || customer.deleted || customer.metadata?.deckpal_user_id !== input.actorId || customer.livemode !== input.expectedLive) throw new HistoryError('billing_account_unavailable', 'This billing account cannot be used for payment history.');
  let page: ChargePage;
  try { page = await input.provider.listCharges({ customer: input.customerId, limit, ...(starting_after ? { starting_after } : {}) }) }
  catch { throw new HistoryError('provider_unavailable', 'Payment history is temporarily unavailable. Try again later.') }
  const items = page.data.map((charge): HistoryItem => {
    const chargeStatus = status(charge);
    const paid = chargeStatus === 'paid';
    const intended = Number.isSafeInteger(charge.amount) ? Math.max(0, charge.amount) : 0;
    // A settled charge is money actually captured, not the original authorization.
    // Stripe always supplies amount_captured; treating malformed/missing provider data
    // as the intended amount would silently overstate a payment.
    const captured = Number.isSafeInteger(charge.amount_captured) ? Math.max(0, charge.amount_captured) : 0;
    const amountMinor = paid ? captured : intended;
    const refunded = Number.isSafeInteger(charge.amount_refunded) ? Math.max(0, charge.amount_refunded) : 0;
    return {
      id: charge.id,
      type: input.kind === 'support' ? 'Support payment' : 'AI credit payment',
      createdAt: new Date(charge.created * 1000).toISOString(),
      amountMinor,
      currency: /^[a-zA-Z]{3}$/.test(charge.currency) ? charge.currency.toUpperCase() : 'XXX',
      status: chargeStatus,
      refundedMinor: Math.min(refunded, paid ? captured : intended),
      disputed: Boolean(charge.disputed),
      ...(receiptUrl(charge.receipt_url, paid) ? { receiptUrl: receiptUrl(charge.receipt_url, paid) } : {}),
    };
  });
  const last = page.data.at(-1);
  return {
    kind: input.kind, items, coverage: COVERAGE, billingAccountPresent: true,
    nextCursor: page.has_more && last ? encodeCursor({ v: 1, ...binding, p: last.id }, input.cursorSecret) : null,
  };
}
