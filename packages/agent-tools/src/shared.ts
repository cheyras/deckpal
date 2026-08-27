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

/**
 * Addresses, taken out of a message that is about to be said to a model.
 *
 * `errText` reduces a driver error to its `code` — but ONLY when it has one,
 * because the fallback has to keep our own deliberate messages readable
 * ("no response within 25s", "No deck 'dhelmise'"). A `pg` error with no
 * `code` field therefore reaches a tool result verbatim, and some of those
 * name the endpoint: a pool that fails mid-handshake, or anything a future
 * driver version raises as a plain `Error`.
 *
 * So the fallback is scrubbed rather than trusted. Each pattern matches a way
 * of writing WHERE the database is or WHO it thinks we are, and nothing else:
 * a URL carrying userinfo, a Postgres DSN, an IPv4 address, a `host:port`
 * pair, and `for user "…"`. A sentence keeps every word that describes what
 * went wrong and loses only the part that would help someone reach the box.
 */
const ENDPOINT_PATTERNS: readonly RegExp[] = [
  // Any URL with credentials in it — `postgres://deckpal:hunter2@db/deckpal`.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]*@\S*/gi,
  // A DSN without credentials still names the host.
  /\bpostgres(?:ql)?:\/\/\S+/gi,
  // `connect ECONNREFUSED 10.1.2.3:5432`, with or without the port.
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g,
  // `db.abcdefgh.supabase.co:5432`. The port is REQUIRED in this one — a
  // dotted name on its own is how half the sentences in this codebase spell a
  // filename, and redacting those would make every message unreadable.
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}:\d{1,5}\b/gi,
  // `password authentication failed for user "deckpal"`.
  /\bfor user ["'`][^"'`]{0,64}["'`]/gi,
];

function withoutEndpoints(msg: string): string {
  return ENDPOINT_PATTERNS.reduce((s, re) => s.replace(re, '[redacted]'), msg);
}

/**
 * Format a caught error for a TOOL RESULT. Surfaces a statement_timeout as an
 * actionable hint (SPEC §3); reduces every other driver error to its code.
 *
 * ## Every handler's catch goes through here — not only the SQL-backed ones
 *
 * The tempting rule is "route the tools whose file runs SQL and leave the
 * REST-backed ones alone", and it is the rule that produced issue #94:
 * `log_cards` reads as an API tool — its own header says the write is one HTTP
 * call — and its `planBatch` runs two queries before that call is made.
 * `tools/lists.ts` opens with "everything goes through deckpal-api via
 * ctx.api" in a file whose item planner calls `resolveCardsBatch`. Whether a
 * given catch can see a driver error is a call-graph question, re-answered
 * wrongly every time somebody adds a lookup to an existing tool.
 *
 * So the boundary is the one that is checkable instead: text that becomes a
 * tool result is formatted by this function. It costs nothing where no driver
 * error can reach — a message with no `code` and no address in it comes back
 * unchanged — and `__tests__/toolErrors.test.ts` fails on any tool source that
 * formats a caught error itself.
 */
export function errText(err: unknown): string {
  const msg = withoutEndpoints(err instanceof Error ? err.message : String(err));

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

  // No code: OUR OWN messages come through here, and they are written to be
  // read ("no response within 25s", "More than one deck matches 'slow'").
  // Reducing them all to "it failed" — which is the right answer one layer out,
  // in `safeToolError`, where an error has already escaped a handler and
  // nothing is known about it — would take the tool layer's whole vocabulary
  // with it. The scrub above is what makes keeping the sentence safe.
  return msg;
}
