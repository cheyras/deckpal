/**
 * The daily meter — how much Deck-E each account may spend, and the one query
 * that both checks and charges it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Check and charge in ONE round trip, or it is not a limit
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The obvious shape is SELECT the counter, compare it to the cap, then UPDATE.
 * Two round trips, and a race between them: two requests that read 119 both see
 * "under 120" and both proceed, which is how a rate limit becomes a suggestion
 * under exactly the load that made you want one.
 *
 * `chargeSql()` is a single statement whose `ON CONFLICT … DO UPDATE … WHERE`
 * clause IS the check. Postgres takes a row lock for the conflicting insert, so
 * the comparison and the increment happen under it. Over cap, the `WHERE` is
 * false, no row is updated, and `RETURNING` yields NOTHING — which is how the
 * caller learns it was refused. Under cap, it yields the new count.
 *
 * The refusal costs one query and no model call, which is the point: a denial
 * path that is expensive is a denial path an attacker will happily exercise.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * The latency it adds, stated rather than discovered
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * One round trip to Postgres before the model is called. `apps/api/src/index.ts`
 * measures that at ~90 ms (the database lives in a different AWS region from the
 * function), against a measured 593 ms median TTFT for the chat model. So this
 * makes Deck-E's first token roughly 15% later, on every turn.
 *
 * That is a real cost and it is not avoidable while the meter is durable: the
 * decision to refuse has to be made BEFORE the spend, so it cannot be
 * overlapped with the model call. It is the price of the endpoint not being an
 * open tap, and it is cheaper than the alternative by several orders of
 * magnitude.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Not inside `withUserContext`
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Every other table this codebase touches holds user data, and is read and
 * written inside a transaction that hands RLS the caller's claims. This one
 * holds the server's accounting ABOUT a user, and migration 040 gives
 * `authenticated` a SELECT policy and nothing else — deliberately, because a
 * meter its subject can UPDATE is not a meter. So this runs as the connection's
 * own role. See 040's header; if this is ever "tidied" into `withUserContext`
 * it will fail closed and the reason will not be obvious from the error.
 */

/** How the counters are spelled in the schema. */
export type MeterTier = 'chat_turns' | 'deep_calls'

/** The one place these variable names are spelled. */
export const DECKE_MAX_TURNS_VAR = 'DECKE_MAX_TURNS_PER_DAY'
export const DECKE_MAX_DEEP_VAR = 'DECKE_MAX_DEEP_CALLS_PER_DAY'

/**
 * Defaults, chosen against measured prices rather than picked round.
 *
 * 120 chat turns: a turn is ONE BILLED REQUEST, and a journey spends up to four
 * of them (see migration 039), so this is roughly 30-40 real conversational
 * exchanges a day. At $0.000143 a turn that is under two cents.
 *
 * 10 deep calls: `models.ts` measures a single analysis call at $0.0356, and a
 * realistic `plan_deck` — large collection context, research, thinking — at
 * $0.50-$1. Ten is therefore a ceiling of a few dollars a day per account, and
 * it is deliberately the tightest number in this file. The owner's standing
 * decision is Sonnet by default with Opus reserved for an explicit ask.
 *
 * Both are overridable per deployment; neither may be raised by a caller.
 */
export const DEFAULT_MAX_TURNS_PER_DAY = 120
export const DEFAULT_MAX_DEEP_CALLS_PER_DAY = 10

/**
 * `parseInt`, not `Number` — an empty `DECKE_MAX_TURNS_PER_DAY=` line in a
 * dashboard must fall through to the default, not coerce to 0 and shut the
 * feature off for everyone. This is the same trap `apps/api/src/db.ts` calls
 * out for `PGPOOL_MAX_API`, and it is worth repeating because the failure is
 * silent and total.
 *
 * Zero IS respected when written deliberately, because "0" parses to 0 and 0 is
 * a legitimate way to turn a tier off. Only an ABSENT or unparseable value
 * falls back.
 */
function capFrom(name: string, fallback: number): number {
  const raw = (process.env[name] ?? '').trim()
  if (raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function maxTurnsPerDay(): number {
  return capFrom(DECKE_MAX_TURNS_VAR, DEFAULT_MAX_TURNS_PER_DAY)
}

export function maxDeepCallsPerDay(): number {
  return capFrom(DECKE_MAX_DEEP_VAR, DEFAULT_MAX_DEEP_CALLS_PER_DAY)
}

export function capFor(tier: MeterTier): number {
  return tier === 'chat_turns' ? maxTurnsPerDay() : maxDeepCallsPerDay()
}

/**
 * The statement. Parameters: `$1` = user id, `$2` = the cap for this tier.
 *
 * The tier is interpolated as a COLUMN NAME rather than bound, because a column
 * cannot be a bind parameter. It is therefore chosen from the `MeterTier` union
 * and never from anything a caller sends — the guard below makes that true at
 * runtime as well as in the type system, since this function is reachable from
 * JavaScript (`api/chat.mjs`) where the type is not checked at all.
 *
 * `(now() AT TIME ZONE 'utc')::date` rather than `CURRENT_DATE`: the latter is
 * the connection's timezone, which is a property of the server, so a cap could
 * quietly reset at a different hour for an instance in another region.
 */
export function chargeSql(tier: MeterTier): string {
  if (tier !== 'chat_turns' && tier !== 'deep_calls') {
    // Reached only from untyped callers. Throwing beats building a statement
    // out of an unknown string, and beats a default that silently charges the
    // wrong tier.
    throw new Error(`unknown meter tier: ${String(tier)}`)
  }
  return `
    INSERT INTO decke_usage AS u (user_id, day, ${tier})
    VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1)
    ON CONFLICT (user_id, day) DO UPDATE
      SET ${tier} = u.${tier} + 1, updated_at = now()
      WHERE u.${tier} < $2
    RETURNING u.${tier} AS used`
}

/**
 * What the caller does with the result.
 *
 * `allowed: false` carries the cap so the refusal can say the number. "You have
 * used everything you have for today" is answerable; "no" is not.
 */
export type MeterVerdict =
  | { allowed: true; used: number; cap: number }
  | { allowed: false; used: number; cap: number }

/**
 * Turn the statement's result into a verdict.
 *
 * Separated from the query so it can be tested without a database — the whole
 * behaviour worth asserting is "no row means refused", and that is a pure
 * function of the row count.
 */
export function verdictFrom(rows: { used: number }[], cap: number): MeterVerdict {
  const row = rows[0]
  if (!row) return { allowed: false, used: cap, cap }
  return { allowed: true, used: row.used, cap }
}

/**
 * The sentence he says when the meter is empty.
 *
 * IN HIS VOICE, and not an HTTP status the reader has to interpret. §4 of the
 * spec asks for "a spoken refusal, not a 500", and the reason is that this is a
 * character: a bare error turns a budget into a bug report. It also must not
 * apologise for a limit that is working correctly.
 */
export function refusalText(tier: MeterTier, cap: number): string {
  return tier === 'deep_calls'
    ? `That is the deep-thinking kind of question, and I have used up today's ${cap} of those. ` +
        `Ask me again tomorrow — or ask me something I can look up, those are separate.`
    : `I have hit my limit for today (${cap} turns). I will be back tomorrow.`
}
