import { createHash } from 'node:crypto';
import type { Queryable } from '@deckpal/db';
import { ApiError } from '../http.js';
import { getAccessForUser } from '../admin/access.js';
import { normalizePolicy, operationFor, type PolicyRevision } from './policy.js';

export async function readPolicy(db: Queryable): Promise<PolicyRevision> {
  const { rows } = await db.query('SELECT public.credit_policy_read() AS data');
  const data = rows[0]?.data;
  if (!data) throw new ApiError(503, 'credit_setup_required', 'Credit accounting is not ready.');
  return { policy: normalizePolicy(data.policy), revision: Number(data.revision), updatedAt: String(data.updatedAt) };
}
export function payloadHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** A replay is rejected, never treated as another free provider invocation. Changed
 * payloads produce another paid request. No browser-provided balance/price is used. */
export function chatChargeReference(conversationId: unknown, messages: unknown, route: unknown, landmarks: unknown) {
  if (typeof conversationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(conversationId)) {
    throw new ApiError(400, 'invalid_conversation', 'A conversation identifier is required.');
  }
  const hash = payloadHash({ messages, route, landmarks });
  return { key: `chat:${conversationId}:${hash}`, hash };
}
export async function assertDeckeAccess(userId: string): Promise<void> {
  const access = await getAccessForUser(userId);
  if (!access.ready) throw new ApiError(503, 'admin_setup_required', 'Account permissions are not ready.');
  if (access.suspended || !access.permissions.includes('decke.use')) throw new ApiError(403, 'forbidden', 'Deck-E is not available on this account.');
}
export interface SpendResult {
  allowed: boolean; balance: number; spent?: number; needed?: number; debt?: number; held?: boolean; spendId?: string;
}
export async function reserveCredits(db: Queryable, userId: string, tool: string, quote: PolicyRevision, key: string, hash: string): Promise<SpendResult> {
  await assertDeckeAccess(userId);
  try {
    const { rows } = await db.query('SELECT public.credit_spend_create($1,$2,$3,$4,$5) AS data',
      [userId, operationFor(tool), quote.revision, key, hash]);
    if (!rows[0]?.data) throw new Error('Missing accounting result');
    return rows[0].data as SpendResult;
  } catch (error) {
    if ((error as { code?: string }).code === '40001') throw new ApiError(409, 'operation_replayed', 'This operation was already accepted. Send a new message to continue.');
    throw error;
  }
}
export async function startCreditWork(db: Queryable, userId: string, spendId?: string): Promise<void> {
  await assertDeckeAccess(userId);
  if (spendId) await db.query('SELECT public.credit_spend_start($1,$2)', [userId, spendId]);
}
export async function refundUnstarted(db: Queryable, userId: string, spendId?: string): Promise<void> {
  if (spendId) await db.query('SELECT public.credit_spend_refund($1,$2)', [userId, spendId]);
}
