import { Router } from 'express';
import { asyncHandler, str } from '../http.js';

/**
 * Client-side crash reports — the receiving end of the React error
 * boundaries in `apps/web/src/components/ErrorBoundary.tsx`.
 *
 * Deliberately the smallest thing that satisfies AGENTS.md B11 ("make
 * absence observable"): no DB row, no GitHub issue, no screenshot, no user
 * identity — just a truncated, PII-free line to the server's own log
 * (Vercel's function logs in cloud, stdout in self-host), rate-limited
 * (`rateLimit.ts`'s `clientErrorRateLimit`) so a repeating crash loop
 * cannot flood it.
 *
 * `/bugs`' pipeline (DB row + a real GitHub issue in cloud mode) was
 * considered and rejected as the transport for this: appropriate for a
 * report a human chose to send, wrong for an unattended beacon that could
 * otherwise open a GitHub issue on every affected page load across every
 * user hitting the same bug. See DECISIONS.md.
 *
 * Unauthenticated on purpose, and not just for symmetry with `/bugs`: an
 * error boundary can fire on a signed-out visitor's crash on the public
 * catalog, and there is no `bug_report`-style row here to attach an
 * identity to even when one is available.
 */
export const clientErrorsRouter: Router = Router();

const MAX_ROUTE = 300;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_BUILD_ID = 100;

export interface ClientErrorLog {
  route: string;
  message: string;
  stack?: string;
  buildId?: string;
  ts: string;
}

/**
 * Shape and truncate an untrusted request body into the line that gets
 * logged. Pure and exported for its own test — the truncation lengths and
 * defaults are the part that can drift silently (a raised limit is a bigger
 * log line per malicious/broken client; a lowered one quietly clips a real
 * stack trace).
 */
export function buildClientErrorLog(body: unknown, now = new Date()): ClientErrorLog {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    route: str(b.route)?.slice(0, MAX_ROUTE) ?? '(unknown)',
    message: str(b.message)?.slice(0, MAX_MESSAGE) ?? '(no message)',
    stack: str(b.stack)?.slice(0, MAX_STACK),
    buildId: str(b.buildId)?.slice(0, MAX_BUILD_ID),
    ts: now.toISOString(),
  };
}

clientErrorsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    // console.error, not a structured logger this repo doesn't have: Vercel
    // captures stdout/stderr per invocation, and the point is to be
    // greppable from the same message a user's screenshot would show.
    console.error('[client-error]', JSON.stringify(buildClientErrorLog(req.body)));
    res.status(204).end();
  }),
);
