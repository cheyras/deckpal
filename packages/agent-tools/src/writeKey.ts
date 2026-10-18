import { createHash } from 'node:crypto';
import type { Ctx } from './ctx.js';

/**
 * A retried write lands once.
 *
 * Before this (2026-10-12) only `log_cards` and `save_deck` protected
 * themselves (each carries a key in its body). Every other write a model might
 * repeat after a timeout or a dropped connection ran again:
 * `scripts/test-db-integration.mjs`'s idempotency suite pins that a second
 * `add_battle_log` made a second log, a second deck revert made another
 * version, and a second bulk add doubled a static list's rows.
 *
 * deckpal-api already answers a repeated `Idempotency-Key` with the first
 * request's response instead of writing again (`apps/api/src/writeOnce.ts`).
 * Deck-E sends one per approved call. This gives every other caller — the MCP
 * server above all — a key of its own: a hash of the exact request (method,
 * path and body), in a 30-minute window. The same call repeated inside the
 * window is answered from the first run; the same call made deliberately later
 * (a second identical in-person game logged more than an hour on) is a new write.
 *
 * A retry that straddles a window boundary would otherwise get a fresh key, so
 * the previous window's key is looked up first and reused when it committed.
 * The effective span is therefore 30 to 60 minutes: a repeat within 30 minutes
 * of the first run is always absorbed, one 30-60 minutes later is absorbed
 * when it falls in the very next window, and one more than an hour later never
 * is. A replay says so, and names the argument that makes a deliberate repeat
 * distinct.
 *
 * The header name is lowercase on purpose: Deck-E's `keyedApi` sets the same
 * name for an approved call, and it must REPLACE this one, not sit beside it
 * under a different spelling.
 */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const RETRY_WINDOW_MS = 30 * 60_000;

export async function retryKey(
  ctx: Ctx,
  tool: string,
  request: { method: string; path: string; body?: unknown },
  now: number = Date.now(),
): Promise<Record<string, string>> {
  const { source: _source, ...body } = (request.body ?? {}) as Record<string, unknown>;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ v: 1, tool, method: request.method, path: request.path, body }))
    .digest('hex');
  const window = Math.floor(now / RETRY_WINDOW_MS);
  const key = (w: number): string => `retry:${tool}:${fingerprint}:${w}`;
  try {
    const prior = (await ctx.api.get(
      `/mutations?idempotency_key=${encodeURIComponent(key(window - 1))}&limit=1`,
    )) as { batches?: Array<{ status?: string }> } | undefined;
    if (prior?.batches?.[0]?.status === 'committed') return { [IDEMPOTENCY_HEADER]: key(window - 1) };
  } catch {
    // History unreachable: the current window's key still covers a prompt retry.
  }
  return { [IDEMPOTENCY_HEADER]: key(window) };
}

/** `ctx.api.send` with a retry key: the one way a tool sends a write that is not otherwise idempotent. */
export async function sendOnce(
  ctx: Ctx,
  tool: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  return ctx.api.send(method, path, body, await retryKey(ctx, tool, { method, path, body }));
}
