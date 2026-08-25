import type { Ctx } from './ctx.js';
import { q1 } from './db.js';

/**
 * Vocabulary and helpers shared across tool files. Everything here used to be
 * either re-declared per file (GOALS/FINISHES) or imported sideways from
 * tools/collection.ts (errText, defaultGoal, Goal) — one copy now, and no
 * tool-file-to-tool-file imports for it.
 */

export const GOALS = ['complete', 'master', 'grandmaster'] as const;
export const FINISHES = ['normal', 'reverse', 'holo', 'lenticular', 'metal'] as const;

export type Goal = 'complete' | 'master' | 'grandmaster';

/** The user's default completion goal (user_settings.default_goal). */
export async function defaultGoal(ctx: Ctx): Promise<Goal> {
  const r = await q1<{ default_goal: string }>(
    ctx.db,
    'SELECT default_goal FROM user_settings WHERE user_id = $1',
    [ctx.userId],
  );
  const g = r?.default_goal;
  return g === 'master' || g === 'grandmaster' ? g : 'complete';
}

/** Surface a statement_timeout as an actionable hint (SPEC §3). */
export function errText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  // The one driver error worth quoting, because the model can act on it.
  if (/statement timeout/i.test(msg)) {
    return `${msg} — the query hit the 30s statement timeout; narrow it (add filters or reduce page_size/limit)`;
  }

  // ── EVERY OTHER DRIVER ERROR IS REDUCED TO ITS CODE ─────────────────────────
  //
  // This text does not go to a log. It is a TOOL RESULT — it lands in a model's
  // context and the model may repeat it to whoever is reading.
  //
  // A `pg` error's message is built from the connection parameters, so
  // "password authentication failed for user \"deckpal\"" and
  // "connect ECONNREFUSED 10.1.2.3:5432" are what these catches see precisely
  // when the database is unreachable — which is the moment every tool fails at
  // once and the model is most likely to be asked what went wrong.
  //
  // Found by the adversarial review. `safeToolError` in the AI SDK adapter
  // already guards errors that are THROWN out of a tool, and the commit adding
  // it claimed to stand in front of this path too. It did not: almost every
  // tool catches internally and formats the message into its own `fail(...)`
  // text, which never passes through the adapter's catch at all.
  //
  // A SQLSTATE is what is diagnostic anyway, and it is safe to say: 28P01,
  // 57014, 42P01. Shape-checked rather than trusted, for the same reason the
  // meter's log line is — a field that is short and alphanumeric today may not
  // be after a driver upgrade.
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code)) {
    return `the database refused that (${code})`;
  }

  return msg;
}
