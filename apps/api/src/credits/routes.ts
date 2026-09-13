import { AsyncLocalStorage } from 'node:async_hooks';
import { Router } from 'express';
import { requireAdminPermission, getAccessForUser } from '../admin/access.js';
import { currentUserId } from '../identity.js';
import { commitRequestTx, rlsStore, withTx } from '../db.js';
import { ApiError, asyncHandler, clampInt, UUID_RE } from '../http.js';
import { creditStripeClient, stripeMode } from '../billing/stripe.js';
import { CHARGE_NOTICE, ESTIMATE_NOTICE, attemptKey, integer, normalizePack, normalizePolicy, object, reasonText } from './policy.js';
import { checkoutParameters, ensureCreditCustomer, paymentStatus, trustedCreditOrigin, type FrozenOrder } from './payments.js';

const creditActor = new AsyncLocalStorage<string>();
export const adminCreditRouter: Router = Router();
export const meCreditRouter: Router = Router();
for (const router of [adminCreditRouter, meCreditRouter]) router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!req.authKind || req.authKind === 'token') return next(new ApiError(403, 'session_required', 'Use an application session.'));
  creditActor.run(currentUserId(req), next);
});
function uuid(v: unknown): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new ApiError(400, 'bad_request', 'Invalid identifier');
  return v;
}
async function call<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T> {
  try {
    const row = await withTx(async client => {
      if (!rlsStore.getStore()) await client.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:creditActor.getStore(),role:'local',deckpal_auth_kind:'local'})]);
      return (await client.query<{data:T}>(sql,args)).rows[0];
    });
    if (!row) throw new Error('Missing credit accounting response');
    return row.data;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '40001') throw new ApiError(409, 'conflict', (error as Error).message);
    if (code === '22023') throw new ApiError(400, 'invalid_input', (error as Error).message);
    if (code === '42501') throw new ApiError(403, 'forbidden', (error as Error).message);
    if (code === 'P0002') throw new ApiError(404, 'not_found', (error as Error).message);
    if (code === '54000') throw new ApiError(429, 'rate_limit', (error as Error).message);
    throw error;
  }
}
async function wallet(userId: string | null) {
  return call<{ balance: number; debt: number; purchaseHold: boolean }>('SELECT public.credit_wallet_read($1) AS data', [userId]);
}
adminCreditRouter.get('/settings', requireAdminPermission('credits.read'), asyncHandler(async (_req, res) => {
  const data=await call<{policy:{estimatedMicroUsd:{chatTurn:number}}}>('SELECT public.credit_policy_admin_read() AS data');
  res.json({ ...data, estimateNotice: data.policy.estimatedMicroUsd.chatTurn===143 ? ESTIMATE_NOTICE : null, chargeNotice: CHARGE_NOTICE });
}));
adminCreditRouter.put('/settings', requireAdminPermission('credits.manage'), asyncHandler(async (req, res) => {
  const body = object(req.body, ['policy', 'expectedRevision'], 'settings');
  const data = await call('SELECT public.credit_policy_save($1::jsonb,$2) AS data', [
    JSON.stringify(normalizePolicy(body.policy)), integer(body.expectedRevision, 1, Number.MAX_SAFE_INTEGER, 'expectedRevision'),
  ]);
  await commitRequestTx(currentUserId(req));
  res.json({ ...data, estimateNotice: normalizePolicy(body.policy).estimatedMicroUsd.chatTurn===143 ? ESTIMATE_NOTICE : null, chargeNotice: CHARGE_NOTICE });
}));
adminCreditRouter.get('/packs', requireAdminPermission('credits.read'), asyncHandler(async (_req, res) => {
  res.json(await call('SELECT public.credit_packs_read(true) AS data'));
}));
adminCreditRouter.post('/packs', requireAdminPermission('credits.manage'), asyncHandler(async (req, res) => {
  const data = await call('SELECT public.credit_pack_save(NULL,$1::jsonb,NULL) AS data', [JSON.stringify(normalizePack(req.body))]);
  await commitRequestTx(currentUserId(req)); res.status(201).json({ pack: {id:data.id,name:data.name,credits:data.credits,priceCents:data.price_cents,currency:data.currency,active:data.active,revision:data.revision} });
}));
adminCreditRouter.patch('/packs/:id', requireAdminPermission('credits.manage'), asyncHandler(async (req, res) => {
  const pack = normalizePack(req.body);
  const data = await call('SELECT public.credit_pack_save($1,$2::jsonb,$3) AS data', [
    uuid(req.params.id), JSON.stringify(pack), integer(req.body.expectedRevision, 1, 2_147_483_647, 'expectedRevision'),
  ]);
  await commitRequestTx(currentUserId(req)); res.json({ pack: {id:data.id,name:data.name,credits:data.credits,priceCents:data.price_cents,currency:data.currency,active:data.active,revision:data.revision} });
}));
adminCreditRouter.get('/payment-status', requireAdminPermission('credits.read'), asyncHandler(async (req, res) => {
  res.json(await paymentStatus(req.query.refresh === 'true'));
}));
adminCreditRouter.get('/users/:id', requireAdminPermission('credits.read'), asyncHandler(async (req, res) => {
  const userId = String(req.params.id);
  const result={ ...await wallet(userId), ...await call('SELECT public.credit_events_read($1,$2,$3) AS data', [
    userId, clampInt(req.query.limit, 25, 1, 100), clampInt(req.query.offset, 0, 0, 1_000_000),
  ]) };
  await commitRequestTx(currentUserId(req)); res.json(result);
}));
adminCreditRouter.post('/users/:id/adjustments', requireAdminPermission('credits.manage'), asyncHandler(async (req, res) => {
  const body = object(req.body, ['delta', 'reason', 'idempotencyKey'], 'adjustment');
  const delta = integer(body.delta, -1_000_000, 1_000_000, 'delta');
  if (!delta) throw new ApiError(400, 'invalid_input', 'delta cannot be zero');
  const userId = String(req.params.id);
  const outcome = await call('SELECT public.credit_adjust($1,$2,$3,$4) AS data', [userId, delta, reasonText(body.reason), attemptKey(body.idempotencyKey)]);
  const result={ ...await wallet(userId), ...outcome };
  await commitRequestTx(currentUserId(req)); res.json(result);
}));
adminCreditRouter.post('/users/:id/resolve-hold', requireAdminPermission('credits.manage'), asyncHandler(async (req, res) => {
  const body = object(req.body, ['reason'], 'hold resolution');
  const userId = String(req.params.id);
  await call('SELECT public.credit_hold_resolve($1,$2) AS data', [userId, reasonText(body.reason)]);
  const result=await wallet(userId);
  await commitRequestTx(currentUserId(req)); res.json(result);
}));
meCreditRouter.get('/', asyncHandler(async (req, res) => {
  const quote = await call<{enabled:boolean;lowAt:number;prices:Record<string,number>;pricingRevision:number}>('SELECT public.credit_quote_read() AS data');
  const state = await wallet(currentUserId(req));
  const canUse = (await getAccessForUser(currentUserId(req))).permissions.includes('decke.use');
  const packs = await call<{ packs: unknown[] }>('SELECT public.credit_packs_read(false) AS data');
  const setup = canUse && quote.enabled && packs.packs.length && !state.purchaseHold
    ? await paymentStatus() : null;
  const reason = !canUse ? 'Deck-E is not enabled for this account.' : !quote.enabled ? 'AI credit charging is disabled.'
    : state.purchaseHold ? 'Credit purchases are on hold while a refund or payment dispute is resolved.'
    : !packs.packs.length ? 'No credit packs are available yet.'
    : setup?.reason ?? null;
  await commitRequestTx(currentUserId(req));
  res.json({ ...state, enabled: quote.enabled, lowAt: quote.lowAt,
    prices: quote.prices, ...packs, purchasesEnabled: !!setup?.ready, purchaseUnavailableReason: reason,
    pricingRevision: quote.pricingRevision, chargeNotice: CHARGE_NOTICE });
}));
meCreditRouter.get('/events', asyncHandler(async (req, res) => {
  const result=await call('SELECT public.credit_events_read(NULL,$1,$2) AS data', [
    clampInt(req.query.limit, 25, 1, 100), clampInt(req.query.offset, 0, 0, 1_000_000),
  ]);
  await commitRequestTx(currentUserId(req));res.json(result);
}));
meCreditRouter.get('/orders/:id', asyncHandler(async (req, res) => {
  res.json(await call('SELECT public.credit_order_read($1) AS data', [uuid(req.params.id)]));
}));
meCreditRouter.post('/checkout', asyncHandler(async (req, res) => {
  const body = object(req.body, ['packId', 'idempotencyKey'], 'checkout');
  await call('SELECT public.credit_checkout_throttle() AS data');
  await commitRequestTx(currentUserId(req));
  const setup = await paymentStatus();
  if (!setup.ready) throw new ApiError(503, 'purchases_unavailable', setup.reason ?? 'Credit purchases are unavailable.');
  const stripe = creditStripeClient(); const origin = trustedCreditOrigin();
  if (!stripe || !origin) throw new ApiError(503, 'purchases_unavailable', 'Credit purchases are unavailable.');
  const userId = currentUserId(req);
  let order = await call<FrozenOrder>('SELECT public.credit_order_create($1,$2) AS data', [uuid(body.packId), attemptKey(body.idempotencyKey)]);
  if (order.status !== 'pending') throw new ApiError(409, 'order_finished', 'This checkout attempt has finished. Start a new purchase.');
  const age = Date.now() - new Date(order.created_at).getTime();
  if (age >= 30 * 60_000) throw new ApiError(409, 'order_expired', 'Start a new checkout attempt.');
  if (order.checkout_url) { await commitRequestTx(userId); res.json({ url: order.checkout_url, orderId: order.id }); return; }
  const existing = await call<string | null>('SELECT public.credit_customer_read() AS data');
  const customer = await ensureCreditCustomer(stripe, userId, existing);
  order = await call<FrozenOrder>('SELECT public.credit_order_prepare($1,$2,$3) AS data', [order.id, customer, stripeMode() === 'live']);
  // Freeze the order/customer before external checkout creation. Retrying the same
  // attempt recreates only the same Stripe session, using the immutable order ID.
  await commitRequestTx(userId);
  const session = await stripe.checkout.sessions.create(checkoutParameters(order, origin), { idempotencyKey: `deckpal-credit-checkout:${order.id}` });
  if (!session.url || !session.url.startsWith('https://checkout.stripe.com/')) throw new Error('Stripe did not return a hosted checkout URL');
  await call('SELECT public.credit_order_bind($1,$2,$3) AS data', [order.id, session.id, session.url]);
  await commitRequestTx(userId);
  res.json({ url: session.url, orderId: order.id });
}));

adminCreditRouter.get('/summary', requireAdminPermission('credits.read'), asyncHandler(async (req,res) => {
  const days=Number(req.query.days ?? 30);
  if (![7,30,90].includes(days)) throw new ApiError(400,'invalid_input','Choose 7, 30, or 90 days.');
  res.json(await call('SELECT public.credit_admin_summary($1) AS data',[days]));
}));
adminCreditRouter.get('/orders', requireAdminPermission('credits.read'), asyncHandler(async (req,res) => {
  const status=typeof req.query.status==='string' && req.query.status ? req.query.status : null;
  const user=typeof req.query.user==='string' && req.query.user ? req.query.user : null;
  res.json(await call('SELECT public.credit_admin_orders($1,$2,$3,$4) AS data',[status,user,clampInt(req.query.limit,25,1,100),clampInt(req.query.offset,0,0,1000000)]));
}));
