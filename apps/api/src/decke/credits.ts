/**
 * Legacy flat-price constants and manual-grant script helpers. Runtime charging
 * is DB-authoritative in ../credits/runtime.ts and migrations066/067.
 * These values preserve initial 1/4/75 compatibility; they are historical
 * estimates, not measurements of the currently selected provider model.
 */
/** One credit, in dollars of MODEL SPEND. Not a retail price. */
export const CREDIT_USD = 0.01;

/** Measured dollar cost per unit of work. See the header for provenance. */
const USD = {
  chat_turn: 0.000143,
  /** The cheap end of the deep tier: one analysis call. */
  deep_call: 0.0356,
  /** The expensive end, and the one that decides the number people feel. */
  plan_deck: 0.75,
} as const;

/**
 * Credits per unit of work, rounded UP and never below one.
 *
 * Rounding up because a spend that rounds to zero is free work with an audit
 * row, and enough of them is an unmetered endpoint with extra steps. The floor
 * of 1 is what makes a conversational turn cost anything at all: at measured
 * cost it is 0.0143 credits, which is not a number a balance can hold.
 *
 * That floor means ordinary conversation is priced ~70x its cost. That is a real
 * distortion and it is the right one: the alternative is integer credits with a
 * chat turn free, and free conversation on a metered endpoint is how the
 * unmetered-endpoint problem comes back.
 */
const ceilCredits = (usd: number): number => Math.max(1, Math.ceil(usd / CREDIT_USD));

/**
 * What each thing costs, in credits.
 *
 * A deep tool not named here falls to `DEEP_DEFAULT` rather than to zero. A
 * missing entry must never mean free — that is the failure mode where somebody
 * adds an expensive tool and discovers the pricing gap from a bill.
 */
export const COST = {
  chat_turn: ceilCredits(USD.chat_turn),
  deep: {
    plan_deck: ceilCredits(USD.plan_deck),
    write_strategy_guide: ceilCredits(USD.plan_deck),
    analyze_collection: ceilCredits(USD.deep_call),
    research_meta: ceilCredits(USD.deep_call),
  } as Record<string, number>,
} as const;

/** An unnamed deep tool costs the EXPENSIVE end, never nothing. */
export const DEEP_DEFAULT = ceilCredits(USD.plan_deck);

/** What one call of a deep tool costs. */
export function deepCost(toolName: string): number {
  return COST.deep[toolName] ?? DEEP_DEFAULT;
}

/** Legacy bootstrap parser; runtime enablement lives in credit_policy_current. */
export function creditsEnabled(): boolean {
  return process.env.DECKE_CREDITS_ENABLED === 'true';
}

/**
 * Below this, the balance stops being invisible.
 *
 * The owner chose "only when it's getting low": nothing shown in the ordinary
 * case, surfaced and kept once the end is in sight. The number is one deck plan
 * plus change — the threshold that matters is "can I still do the expensive
 * thing", not an arbitrary round number, because that is the question somebody
 * is actually asking when they glance at it.
 */
export const LOW_BALANCE = DEEP_DEFAULT + 25;

/**
 * The spend. Parameters: `$1` = user id, `$2` = credits.
 *
 * ONE STATEMENT, for the reason `meter.ts` gives for its counter: a
 * SELECT-then-UPDATE lets two concurrent turns both read enough and both spend.
 * The `WHERE balance >= $2` and the subtraction happen under the same row lock,
 * so zero rows affected IS the refusal — a verdict rather than an exception.
 *
 * Deriving the balance from the event log instead reads better and cannot be
 * spent atomically without SERIALIZABLE or a table lock, because the sum a
 * transaction reads is not held against a concurrent writer. The whole point of
 * a hard stop is that it cannot be crossed.
 */
export const SPEND_SQL = `
  UPDATE decke_credit_balance
     SET balance = balance - $2, updated_at = now()
   WHERE user_id = $1 AND balance >= $2
  RETURNING balance`;

/**
 * The audit row for a spend. Written after the balance moves, never instead.
 *
 * If this fails the credits are still gone, which is the safe direction: a
 * missing log line is a gap in a statement, where a missing decrement is free
 * work. The log is the evidence and the balance is the product.
 *
 * ── `-($2::int)`, AND THE CAST IS NOT DECORATION ─────────────────────────────
 *
 * This read `-$2` and threw on every single call:
 *
 *     42725  operator is not unique: - unknown
 *
 * Postgres cannot infer a type for a bare parameter under unary minus, so the
 * statement is ambiguous before it ever looks at the value. Verified against
 * production: the balance moved 2000 → 1999 → 1998 across two real turns and the
 * ledger held nothing but the two original grants.
 *
 * It was invisible because the caller catches this insert and does not rethrow —
 * correctly, since the credits are already gone and a broken audit table must
 * not take down a turn. A `.catch()` that exists to protect a turn will also
 * hide a statement that has never once succeeded. `GRANT_LOG_SQL` was fine
 * throughout because its `$2` is positive and needs no operator to type it,
 * which is why grants appeared in the ledger and spends did not.
 */
export const SPEND_LOG_SQL = `
  INSERT INTO decke_credit_event (user_id, delta, kind, reason)
  VALUES ($1, -($2::int), 'spend', $3)`;

/**
 * A grant. Parameters: `$1` = user id, `$2` = credits, `$3` = reason,
 * `$4` = ref or null.
 *
 * `ON CONFLICT DO UPDATE` because a first grant and a top-up are the same act.
 * The event row's `ref` carries the idempotency — migration 041 puts a partial
 * unique index on it, so a retried payment webhook is a constraint violation
 * rather than free money, and the caller must write the EVENT FIRST and let it
 * fail before touching the balance.
 */
export const GRANT_BALANCE_SQL = `
  INSERT INTO decke_credit_balance AS b (user_id, balance)
  VALUES ($1, $2)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = b.balance + EXCLUDED.balance, updated_at = now()
  RETURNING b.balance`;

export const GRANT_LOG_SQL = `
  INSERT INTO decke_credit_event (user_id, delta, kind, reason, ref)
  VALUES ($1, $2, 'grant', $3, $4)`;

/** Read a balance without changing it. */
export const BALANCE_SQL = `
  SELECT balance FROM decke_credit_balance WHERE user_id = $1`;

/**
 * What the caller does with a spend attempt.
 *
 * `balance` is present on BOTH branches, and on the refusal it is what they
 * still have rather than what they needed. "You have 12 and this costs 75" is
 * answerable; "no" is not, and neither is a refusal that only quotes the price.
 */
export type CreditVerdict =
  | { allowed: true; balance: number; spent: number }
  | { allowed: false; balance: number; needed: number };

/**
 * Turn the statement's result into a verdict.
 *
 * Pure, and separated from the query for the reason `verdictFrom` is: the whole
 * behaviour worth asserting is "no row means refused", and that is a function of
 * the row count alone.
 *
 * `balanceIfRefused` is passed rather than re-queried. It is only ever used to
 * say a number in a sentence, so a value read a moment earlier is fine — and
 * a second round trip on the refusal path to make a message more precise is
 * cost paid on exactly the turn that earned nothing.
 */
export function creditVerdictFrom(
  rows: { balance: number }[],
  needed: number,
  balanceIfRefused: number,
): CreditVerdict {
  const row = rows[0];
  // `Math.max(0, NaN)` IS NaN, which reaches the screen as "NaN credits" on the
  // one surface where a reader is being told about their money. Caught by this
  // module's own test rather than in a browser.
  if (!row) {
    const b = Number.isFinite(balanceIfRefused) ? Math.max(0, balanceIfRefused) : 0;
    return { allowed: false, balance: b, needed };
  }
  return { allowed: true, balance: row.balance, spent: needed };
}

/** Should the panel show the balance at all? See `LOW_BALANCE`. */
export function balanceIsLow(balance: number): boolean {
  return Number.isFinite(balance) && balance <= LOW_BALANCE;
}

/**
 * What he says when there is nothing left.
 *
 * First person, and it does not apologise twice or offer a workaround that does
 * not exist. The owner chose that the panel still OPENS and he says this himself
 * rather than a system banner doing it — so it has to sound like him, and it has
 * to be the end of the sentence rather than the start of a negotiation.
 */
export function outOfCreditsText(): string {
  return "I'm out of credits, so I can't take anything new on right now.";
}
