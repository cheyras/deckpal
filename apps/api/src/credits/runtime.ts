import { createHash } from 'node:crypto';
import type { Queryable } from '@deckpal/db';
import { ApiError } from '../http.js';
import { getAccessForUser } from '../admin/access.js';
import { normalizePolicy, operationFor, type LegacyPolicy, type PolicyRevision } from './policy.js';

export async function readPolicy(db: Queryable, userId?: string): Promise<PolicyRevision> {
  const { rows } = await db.query(userId ? 'SELECT public.credit_effective_policy($1) AS data' : 'SELECT public.credit_policy_read() AS data', userId ? [userId] : []);
  const data = rows[0]?.data;
  if (!data) throw new ApiError(503, 'credit_setup_required', 'Credit accounting is not ready.');
  return { policy: normalizePolicy(data.policy), revision: Number(data.revision), updatedAt: String(data.updatedAt), unlimited: data.unlimited === true, overrideRevision: Number(data.overrideRevision ?? 0) };
}
export function payloadHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** A replay is rejected, never treated as another free provider invocation. Changed
 * payloads produce another paid request. No browser-provided balance/price is used.
 * `exchange` (the browser's exchangeId and seq) is part of the identity because the
 * browser now sends a bounded WINDOW of history (SEC-04): two genuinely new
 * exchanges can carry byte-identical windows, and without it the second was
 * refused as a replay of the first. A retried leg of the SAME exchange still
 * hashes the same and is still refused.
 * `tierRoute` is the continuation leg's VALIDATED route echo (`decke/routeEcho.ts`,
 * null when absent or invalid): it chooses the model that runs, so it is input to
 * the request like the messages are. Omitted from the hash when null, so a request
 * without one hashes exactly as it did before the echo existed. */
export function chatChargeReference(conversationId: unknown, messages: unknown, route: unknown, landmarks: unknown, exchange?: { exchangeId?: unknown; seq?: unknown }, tierRoute?: unknown) {
  if (typeof conversationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(conversationId)) {
    throw new ApiError(400, 'invalid_conversation', 'A conversation identifier is required.');
  }
  const hash = payloadHash({ messages, route, landmarks, ...(exchange ? { exchange } : {}), ...(tierRoute != null ? { tierRoute } : {}) });
  return { key: `chat:${conversationId}:${hash}`, hash };
}
export async function assertDeckeAccess(userId: string): Promise<void> {
  const access = await getAccessForUser(userId);
  if (!access.ready) throw new ApiError(503, 'admin_setup_required', 'Account permissions are not ready.');
  if (access.suspended || !access.permissions.includes('decke.use')) throw new ApiError(403, 'forbidden', 'Deck-E is not available on this account.');
}
export interface SpendResult {
  allowed: boolean; balance: number | string; spent?: number; needed?: number; debt?: number | string; held?: boolean; spendId?: string; unlimited?: boolean;
}
export interface MeteredBeginResult {
  allowed: boolean;
  mode?: 'paid' | 'unlimited' | 'daily';
  reason?: 'payment_hold' | 'debt' | 'insufficient';
  balance?: string;
  heldCredits?: number;
  capCredits?: string | null;
  needed?: number;
  debt?: number | string;
}
export async function reserveCredits(db: Queryable, userId: string, tool: string, quote: Omit<PolicyRevision, 'policy'> & { policy: LegacyPolicy }, key: string, hash: string): Promise<SpendResult> {
  await assertDeckeAccess(userId);
  try {
    const { rows } = await db.query('SELECT public.credit_spend_create_effective($1,$2,$3,$4,$5,$6) AS data',
      [userId, operationFor(tool), quote.revision, quote.overrideRevision ?? 0, key, hash]);
    if (!rows[0]?.data) throw new Error('Missing accounting result');
    return rows[0].data as SpendResult;
  } catch (error) {
    if ((error as { code?: string }).code === '40001') throw new ApiError(409, 'operation_replayed', 'This operation was already accepted. Send a new message to continue.');
    throw error;
  }
}
export async function beginMeteredCredits(db: Queryable, userId: string, requestId: string): Promise<MeteredBeginResult> {
  await assertDeckeAccess(userId);
  const { rows } = await db.query('SELECT public.decke_metered_begin($1) AS data', [requestId]);
  const result = rows[0]?.data as MeteredBeginResult | undefined;
  if (!result) throw new Error('Missing metered accounting result');
  return result;
}
export async function startCreditWork(db: Queryable, userId: string, spendId?: string): Promise<void> {
  await assertDeckeAccess(userId);
  if (spendId) await db.query('SELECT public.credit_spend_start($1,$2)', [userId, spendId]);
}
export async function refundUnstarted(db: Queryable, userId: string, spendId?: string): Promise<void> {
  if (spendId) await db.query('SELECT public.credit_spend_refund($1,$2)', [userId, spendId]);
}
