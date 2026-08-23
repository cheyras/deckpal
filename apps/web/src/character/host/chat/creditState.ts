/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CREDIT BALANCE, AS WORDS HE SAYS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The daily "10 deep questions" cap is being replaced by a single balance you
 * top up. The balance itself is somebody else's work in flight; this is the
 * PRESENTATION, built so that wiring it is passing a number in.
 *
 * ── TWO STATES, AND THE OWNER CHOSE HOW EACH ONE BEHAVES ─────────────────────
 *
 *  **Out.** The panel still OPENS, the history stays readable, and **he says it
 *  himself, in his own voice** — not a system banner, not a toast, not a modal
 *  in front of the conversation. And the COMPOSER IS REPLACED by a "Top up"
 *  action rather than left there accepting text he cannot answer.
 *
 *  That last part is the whole reason this file exists rather than a disabled
 *  attribute. An input that takes a question, swallows it, and shows a modal
 *  afterwards is the *pretending* this entire pass was commissioned to remove —
 *  the same defect as answering as though a cancelled write had happened, one
 *  surface along. A control that is gone cannot lie about what it will do.
 *
 *  **Low.** Nothing at all until it is genuinely getting low, and then it
 *  surfaces in the HEADER and stays there. Not a toast: a toast about a resource
 *  is either missed or dismissed, and in both cases the reader learns about the
 *  balance at zero. A persistent, quiet number in the chrome is the honest
 *  shape — it is a fact about the session, not an event.
 *
 * ── WHY THE THRESHOLD IS A FRACTION AND A FLOOR ──────────────────────────────
 *
 * "Low" cannot be a fixed number, because a balance somebody bought in a large
 * top-up and a balance from a small one are not comparable — 20 left out of 25
 * is nearly full and 20 out of 2,000 is nearly empty. It also cannot be purely a
 * fraction, because 1 of 4 is 25% and is unmistakably nearly out. So it is
 * either, and both are named constants rather than magic numbers in a `?:`.
 *
 * ── X2 ───────────────────────────────────────────────────────────────────────
 *
 * Every sentence here is a function of a number that came from the server. There
 * is no "you have plenty left", no estimate of how many questions a balance buys
 * — that depends on what is asked — and no promise about when anything resets,
 * because a credit balance does not reset. When the balance is UNKNOWN, this
 * says nothing at all rather than assuming a healthy one.
 */

/** What the panel knows about the balance. `null` means "not loaded". */
export type CreditBalance = {
  /** Credits left. Never negative on the wire; clamped here anyway. */
  remaining: number
  /** What a full top-up of this reader's plan grants, for the "low" fraction. */
  allowance: number
}

export type CreditState = 'ok' | 'low' | 'empty' | 'unknown'

/** Below this fraction of the allowance, say so. */
export const LOW_FRACTION = 0.15
/** Or below this many, whichever bites first. */
export const LOW_FLOOR = 5

export function creditState(balance: CreditBalance | null): CreditState {
  if (!balance) return 'unknown'
  const remaining = Math.max(0, Math.floor(balance.remaining))
  if (remaining === 0) return 'empty'
  const allowance = Math.max(1, Math.floor(balance.allowance))
  if (remaining <= LOW_FLOOR) return 'low'
  return remaining / allowance <= LOW_FRACTION ? 'low' : 'ok'
}

/**
 * The header's line, or `''`.
 *
 * COUNTS THE THING ITSELF, not a derived estimate. "About 3 more questions" is a
 * guess — a deep question costs more than a shallow one — and a guess in the
 * chrome is a number somebody will hold us to.
 */
export function creditHeaderLabel(balance: CreditBalance | null): string {
  const state = creditState(balance)
  if (state === 'ok' || state === 'unknown' || !balance) return ''
  const remaining = Math.max(0, Math.floor(balance.remaining))
  if (remaining === 0) return 'Out of credits'
  return remaining === 1 ? '1 credit left' : `${remaining} credits left`
}

/**
 * What he says when the balance is gone.
 *
 * FIRST PERSON, AND HE OWNS IT. The owner chose this over a system notice, and
 * the difference is not decoration: a banner saying "You have run out of
 * credits" is the product talking over a character who is standing right there,
 * and the reader's next move — top up, or come back later — is a decision they
 * make with him rather than about him.
 *
 * NO APOLOGY LOOP AND NO UPSELL. One sentence about what is true, one about what
 * still works, and the action is the button. "I'd love to help but…" is the tone
 * this pass removed from everywhere else.
 */
export function outOfCreditsLine(): string {
  return "I'm out of credits, so I can't take anything new on right now."
}

/** The line under it: what still works, which is more than nothing. */
export function outOfCreditsDetail(): string {
  return 'Everything we already talked about is still here to read.'
}

/** The one action. Named as an action, not as a plea. */
export const TOP_UP_LABEL = 'Top up credits'
