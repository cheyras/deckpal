import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HistoryError, paymentHistory, type HistoryProvider, type ProviderCharge } from '../billing/history.js';
import { historyProvider } from '../routes/billing.js';
import type Stripe from 'stripe';

const secret = 'test-only-cursor-secret-32-bytes';
const actor = 'user-111';
const base: ProviderCharge = { id: 'ch_paid', amount: 500, amount_captured: 500, amount_refunded: 0, currency: 'usd', created: 1_700_000_000, paid: true, captured: true, status: 'succeeded', disputed: false, receipt_url: 'https://pay.stripe.com/receipts/good' };
function fake(over: Partial<HistoryProvider> = {}) {
  const calls: Array<{customer:string;limit:number;starting_after?:string}> = [];
  const provider: HistoryProvider = {
    retrieveCustomer: async id => ({ id, livemode: false, metadata: { deckpal_user_id: actor } }),
    listCharges: async args => { calls.push(args); return { data: [base], has_more: false } }, ...over,
  };
  return { provider, calls };
}
function request(provider: HistoryProvider, over: Partial<Parameters<typeof paymentHistory>[0]> = {}) {
  return paymentHistory({ actorId: actor, kind: 'support', customerId: 'cus_current', expectedLive: false, cursorSecret: secret, provider, ...over });
}

describe('read-only payment history', () => {
  test('verifies exact customer ownership and mode before listing', async () => {
    for (const customer of [{ id: 'cus_current', livemode: false, metadata: { deckpal_user_id: 'someone-else' } }, { id: 'cus_current', deleted: true }, null, { id: 'cus_current', livemode: true, metadata: { deckpal_user_id: actor } }]) {
      let listed = false;
      const { provider } = fake({ retrieveCustomer: async () => customer, listCharges: async () => { listed = true; return { data: [], has_more: false } } });
      await assert.rejects(request(provider), (e: HistoryError) => e.code === 'billing_account_unavailable' && !e.message.includes('cus_'));
      assert.equal(listed, false);
    }
  });
  test('distinguishes no current pointer from provider failure', async () => {
    const { provider } = fake();
    const empty = await request(provider, { customerId: null });
    assert.equal(empty.billingAccountPresent, false); assert.match(empty.coverage, /current billing account only/i);
    const broken = fake({ retrieveCustomer: async () => { throw new Error('secret customer dump') } }).provider;
    await assert.rejects(request(broken), (e: HistoryError) => e.code === 'provider_unavailable' && !e.message.includes('secret'));
  });
  test('binds cursors to actor, kind, and current customer generation', async () => {
    const first = fake({ listCharges: async () => ({ data: [base], has_more: true }) });
    const page = await request(first.provider);
    assert.ok(page.nextCursor && !page.nextCursor.includes('cus_current') && !page.nextCursor.includes(actor));
    for (const over of [{ actorId: 'user-222' }, { kind: 'credits' as const }, { customerId: 'cus_replaced' }, { cursor: page.nextCursor!.slice(0, -1) + 'x' }]) {
      const f = fake(); await assert.rejects(request(f.provider, { cursor: page.nextCursor!, ...over }), (e: HistoryError) => e.code === 'invalid_request'); assert.equal(f.calls.length, 0);
    }
  });
  test('constrains every page to the verified customer and exposes no mutations', async () => {
    const first = fake({ listCharges: async () => ({ data: [base], has_more: true }) });
    const cursor = (await request(first.provider)).nextCursor!;
    const second = fake(); await request(second.provider, { cursor });
    assert.deepEqual(first.calls[0], undefined); // overridden reader still receives only its args
    assert.deepEqual(second.calls[0], { customer: 'cus_current', limit: 20, starting_after: 'ch_paid' });
    assert.deepEqual(Object.keys(second.provider).sort(), ['listCharges', 'retrieveCustomer']);
  });
  test('uses captured settlement amounts and bounds refunds without changing attempt amounts', async () => {
    const charges: ProviderCharge[] = [
      { ...base, id: 'ch_partial', amount: 1000, amount_captured: 400, amount_refunded: 900 },
      { ...base, id: 'ch_full', amount: 1000, amount_captured: 1000, amount_refunded: 200 },
      { ...base, id: 'ch_auth', amount: 1000, amount_captured: 0, captured: false },
      { ...base, id: 'ch_missing', amount: 1000, amount_captured: undefined as unknown as number },
    ];
    const page = await request(fake({ listCharges: async () => ({ data: charges, has_more: false }) }).provider);
    assert.deepEqual(page.items.map(item => [item.status, item.amountMinor, item.refundedMinor]), [
      ['paid', 400, 400], ['paid', 1000, 200], ['authorized', 1000, 0], ['paid', 0, 0],
    ]);
  });

  test('Stripe history adapter applies per-call limits and maps captured amount without mutations', async () => {
    const calls: unknown[][] = [];
    const stripe = {
      customers: { retrieve: async (...args: unknown[]) => { calls.push(['retrieve', ...args]); return { id: 'cus_current', livemode: false, metadata: { deckpal_user_id: actor } } } },
      charges: { list: async (...args: unknown[]) => { calls.push(['list', ...args]); return { has_more: false, data: [{ ...base, object: 'charge' }] } } },
    } as unknown as Stripe;
    const provider = historyProvider(stripe);
    const customer = await provider.retrieveCustomer('cus_current');
    const page = await provider.listCharges({ customer: 'cus_current', limit: 20 });
    assert.equal(customer?.id, 'cus_current');
    assert.equal(page.data[0]?.amount_captured, 500);
    assert.deepEqual(calls, [
      ['retrieve', 'cus_current', {}, { timeout: 4000, maxNetworkRetries: 0 }],
      ['list', { customer: 'cus_current', limit: 20 }, { timeout: 4000, maxNetworkRetries: 0 }],
    ]);
    assert.deepEqual(Object.keys(provider).sort(), ['listCharges', 'retrieveCustomer']);
  });

  test('reports attempts honestly and returns only safe receipt links', async () => {
    const charges: ProviderCharge[] = [base, { ...base, id: 'ch_refund', amount_refunded: 200, disputed: true }, { ...base, id: 'ch_auth', captured: false }, { ...base, id: 'ch_fail', paid: false, captured: false, status: 'failed', receipt_url: 'https://pay.stripe.com/nope' }, { ...base, id: 'ch_bad_url', receipt_url: 'https://pay.stripe.com.evil.test/x' }, { ...base, id: 'ch_bad_port', receipt_url: 'https://pay.stripe.com:444/x' }];
    const { provider } = fake({ listCharges: async () => ({ data: charges, has_more: false }) });
    const page = await request(provider);
    assert.deepEqual(page.items.map(i => i.status), ['paid', 'paid', 'authorized', 'failed', 'paid', 'paid']);
    assert.equal(page.items[1]!.refundedMinor, 200); assert.equal(page.items[1]!.disputed, true); assert.ok(page.items[0]!.receiptUrl);
    assert.equal(page.items[3]!.receiptUrl, undefined); assert.equal(page.items[4]!.receiptUrl, undefined); assert.equal(page.items[5]!.receiptUrl, undefined);
    assert.deepEqual(Object.keys(page.items[0]!).sort(), ['amountMinor','createdAt','currency','disputed','id','receiptUrl','refundedMinor','status','type']);
  });
});
