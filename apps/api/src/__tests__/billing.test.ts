/**
 * The two parts of billing that have an opinion in them, and no database.
 *
 * `promptDue` decides when this product asks somebody for money, and
 * `normalizeAmountCents` decides how much it is allowed to charge. Everything
 * else in `src/billing` is a round trip to Stripe and is verified against
 * Stripe; these two are ours, and they are the ones that would be wrong quietly
 * — a cadence bug does not throw, it just nags, and an amount bug does not
 * throw either, it bills.
 *
 * Pure by construction: `promptDue` takes its clock as an argument, so there is
 * no fake-timer machinery here and no test that passes at 23:59 and fails at
 * 00:01.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  PAYMENT_ISSUE_INTERVAL_DAYS,
  PROMPT_INTERVAL_DAYS,
  VISIT_THRESHOLD,
  PRESET_LADDERS,
  presetsFor,
  promptDue,
  type BillingRow,
} from '../billing/store.js';
import { SUPPORT_MAX_CENTS, SUPPORT_MIN_CENTS, normalizeAmountCents } from '../billing/stripe.js';
import { ApiError, errorMiddleware } from '../http.js';
import { stripeFailure } from '../routes/billing.js';
import { sweepDuplicatePayingSubscriptions } from '../billing/service.js';
import { PaymentInFlightError, SubscriptionPausedError } from '../billing/service.js';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** A brand-new account: nothing paid, nothing asked, nowhere been. */
function row(over: Partial<BillingRow> = {}): BillingRow {
  return {
    user_id: '00000000-0000-4000-8000-000000000001',
    stripe_customer_id: null,
    subscription_id: null,
    subscription_status: null,
    support_cents: 0,
    currency: 'USD',
    current_period_end: null,
    cancel_at_period_end: false,
    card_brand: null,
    card_last4: null,
    card_exp_month: null,
    card_exp_year: null,
    stripe_synced_at: null,
    visit_count: 0,
    last_visit_at: null,
    prompt_last_shown_at: null,
    onboarded_at: null,
    ab_presets: 'without_1',
    ...over,
  };
}

describe('promptDue — onboarding', () => {
  test('a brand-new account is asked on its first visit', () => {
    assert.equal(promptDue(row(), NOW), 'onboarding');
  });

  test('onboarding ignores the visit threshold — it IS the first visit', () => {
    assert.equal(promptDue(row({ visit_count: 0 }), NOW), 'onboarding');
  });

  test('once settled it never comes back, however long it has been', () => {
    const settled = row({ onboarded_at: new Date(NOW - 400 * DAY), visit_count: 0 });
    assert.equal(promptDue(settled, NOW), null);
  });
});

describe('promptDue — the check-in', () => {
  const onboarded = { onboarded_at: new Date(NOW - 30 * DAY) };

  test('stays quiet below the visit threshold', () => {
    for (let v = 0; v < VISIT_THRESHOLD; v++) {
      assert.equal(promptDue(row({ ...onboarded, visit_count: v }), NOW), null, `visit ${v}`);
    }
  });

  test('fires on the threshold visit', () => {
    assert.equal(promptDue(row({ ...onboarded, visit_count: VISIT_THRESHOLD }), NOW), 'checkin');
  });

  test('a dismissal buys a full month of quiet', () => {
    const justAsked = row({ ...onboarded, visit_count: 99, prompt_last_shown_at: new Date(NOW - 1 * DAY) });
    assert.equal(promptDue(justAsked, NOW), null);
    const almost = row({
      ...onboarded,
      visit_count: 99,
      prompt_last_shown_at: new Date(NOW - (PROMPT_INTERVAL_DAYS - 1) * DAY),
    });
    assert.equal(promptDue(almost, NOW), null);
  });

  test('and comes back the month after', () => {
    const due = row({
      ...onboarded,
      visit_count: 99,
      prompt_last_shown_at: new Date(NOW - PROMPT_INTERVAL_DAYS * DAY),
    });
    assert.equal(promptDue(due, NOW), 'checkin');
  });
});

describe('promptDue — an account that already pays is left alone', () => {
  const paying = { onboarded_at: new Date(NOW - 90 * DAY), visit_count: 999, support_cents: 500, subscription_status: 'active' };

  test('never asked again, at any visit count or interval', () => {
    assert.equal(promptDue(row(paying), NOW), null);
    assert.equal(promptDue(row({ ...paying, prompt_last_shown_at: new Date(NOW - 999 * DAY) }), NOW), null);
  });

  test('one who has set it to end is not re-asked before it ends', () => {
    const ending = row({
      ...paying,
      cancel_at_period_end: true,
      current_period_end: new Date(NOW + 10 * DAY),
    });
    assert.equal(promptDue(ending, NOW), null);
  });

  test('but rejoins the ordinary cadence once it has', () => {
    const ended = row({
      ...paying,
      support_cents: 0,
      subscription_status: 'canceled',
      cancel_at_period_end: true,
      current_period_end: new Date(NOW - 1 * DAY),
    });
    assert.equal(promptDue(ended, NOW), 'checkin');
  });
});

describe('promptDue — A CONTRIBUTOR IS NEVER ASKED AGAIN', () => {
  // The owner's requirement, and the one that would be embarrassing to get
  // wrong: "I don't want to be proactively reminding them that they can
  // cancel." Every one of these rows is somebody who pays; none of them may
  // ever produce a 'checkin'.
  const contributing = {
    onboarded_at: new Date(NOW - 400 * DAY),
    visit_count: 9999,
    support_cents: 500,
    prompt_last_shown_at: new Date(NOW - 999 * DAY),
  }

  // Every Stripe status in which money is actually flowing.
  for (const status of ['active', 'trialing', null]) {
    test(`status ${String(status)} is never asked, however long it has been`, () => {
      assert.equal(promptDue(row({ ...contributing, subscription_status: status }), NOW), null)
    })
  }

  test('not at any visit count', () => {
    for (const v of [0, 3, 50, 100000]) {
      assert.equal(promptDue(row({ ...contributing, subscription_status: 'active', visit_count: v }), NOW), null)
    }
  })

  test('not a year later', () => {
    assert.equal(promptDue(row({ ...contributing, subscription_status: 'active' }), NOW + 365 * DAY), null)
  })

  test('not at $1 — the smallest contribution counts the same', () => {
    assert.equal(promptDue(row({ ...contributing, support_cents: 100, subscription_status: 'active' }), NOW), null)
  })

  test('not while a pending stop has not taken effect yet', () => {
    const leaving = row({
      ...contributing,
      subscription_status: 'active',
      cancel_at_period_end: true,
      current_period_end: new Date(NOW + 10 * DAY),
    })
    assert.equal(promptDue(leaving, NOW), null)
  })

  test('not even when we do not know when the pending stop lands', () => {
    // A missing period end used to fall through to the cadence, which made a
    // NULL date the one way a cancelling contributor got the check-in on the
    // way out. "Do not know" now reads as "do not ask".
    const leaving = row({
      ...contributing,
      subscription_status: 'active',
      cancel_at_period_end: true,
      current_period_end: null,
    })
    assert.equal(promptDue(leaving, NOW), null)
  })

  test('a broken card IS still surfaced to them — that is help, not an ask', () => {
    const broken = row({ ...contributing, subscription_status: 'past_due' })
    assert.equal(promptDue(broken, NOW), 'payment_issue')
  })
})

describe('promptDue — a broken payment outranks the ask', () => {
  const base = { onboarded_at: new Date(NOW - 90 * DAY), visit_count: 999, support_cents: 500 };

  for (const status of ['past_due', 'unpaid']) {
    test(`${status} asks about the card, not about the amount`, () => {
      assert.equal(promptDue(row({ ...base, subscription_status: status }), NOW), 'payment_issue');
    });
  }

  test('an ABANDONED attempt is not a failed charge', () => {
    // `incomplete` used to be treated as a payment problem, and the copy that
    // produced -- "your bank turned down the most recent charge" -- was simply
    // false: nothing was ever charged. The dunning flow could not help either,
    // having no outstanding invoice to settle, yet reported success.
    //
    // `pullState` no longer counts an incomplete subscription's price as
    // `support_cents`, so the realistic row is `incomplete` at 0 -- and the
    // honest answer is the ordinary check-in, because that is somebody who is
    // not paying.
    const abandoned = row({
      ...base,
      support_cents: 0,
      subscription_status: 'incomplete',
      prompt_last_shown_at: null,
    });
    assert.equal(promptDue(abandoned, NOW), 'checkin');
  });

  test('it is reminded on its own faster cadence, not every load', () => {
    const justTold = row({
      ...base,
      subscription_status: 'past_due',
      prompt_last_shown_at: new Date(NOW - 1 * DAY),
    });
    assert.equal(promptDue(justTold, NOW), null);

    const due = row({
      ...base,
      subscription_status: 'past_due',
      prompt_last_shown_at: new Date(NOW - PAYMENT_ISSUE_INTERVAL_DAYS * DAY),
    });
    assert.equal(promptDue(due, NOW), 'payment_issue');
  });

  test('and it beats onboarding, which would otherwise be first', () => {
    const both = row({ subscription_status: 'past_due', support_cents: 300, onboarded_at: null });
    assert.equal(promptDue(both, NOW), 'payment_issue');
  });
});

describe('promptDue — the backfilled existing account (migration 053)', () => {
  // The shape migration 053 leaves behind for somebody who signed up before
  // this feature existed: at the threshold, onboarding marked settled so the
  // welcome flow is not shown to a month-old account, never asked.
  const backfilled = row({ visit_count: 3, onboarded_at: new Date(NOW - 1 * DAY), prompt_last_shown_at: null });

  test('is asked on its next visit, and gets the check-in rather than the welcome', () => {
    assert.equal(promptDue(backfilled, NOW), 'checkin');
  });
});

describe('the $1 experiment (migration 055)', () => {
  test('the two ladders differ by exactly one rung, and it is $1', () => {
    const withOne = PRESET_LADDERS.with_1
    const without = PRESET_LADDERS.without_1
    const extra = withOne.filter((c) => !(without as readonly number[]).includes(c))
    assert.deepEqual(extra, [100], 'the arms must differ ONLY by the $1 rung, or the experiment measures two things at once')
    assert.deepEqual([...without], withOne.filter((c) => c !== 100))
  })

  test('$0 is first in both arms — that is the product, not the experiment', () => {
    assert.equal(PRESET_LADDERS.with_1[0], 0)
    assert.equal(PRESET_LADDERS.without_1[0], 0)
  })

  test('an unassigned account gets the control ladder, never a crash', () => {
    assert.deepEqual(presetsFor(row({ ab_presets: null })), [...PRESET_LADDERS.without_1])
  })

  test('each arm gets its own ladder', () => {
    assert.deepEqual(presetsFor(row({ ab_presets: 'with_1' })), [...PRESET_LADDERS.with_1])
    assert.deepEqual(presetsFor(row({ ab_presets: 'without_1' })), [...PRESET_LADDERS.without_1])
  })

  test('every offerable amount survives the server validator', () => {
    // A ladder rung the API would reject is a button that 400s. $1 is the new
    // one and is exactly at SUPPORT_MIN_CENTS, which is the edge worth pinning.
    for (const cents of new Set([...PRESET_LADDERS.with_1, ...PRESET_LADDERS.without_1])) {
      assert.equal(normalizeAmountCents(cents), cents, `ladder offers ${cents} but the server refuses it`)
    }
  })
})

describe('the one-time ladder (the $0 follow-up)', () => {
  // The ladder lives in routes/billing.ts (the server owns what is offerable);
  // these pin the properties that would break the feature or the experiment.
  const ONE_TIME = [300, 500, 1000, 2500]

  test('every rung survives the server validator', () => {
    for (const c of ONE_TIME) assert.equal(normalizeAmountCents(c), c)
  })

  test('there is no $0 rung — declining is a button, not an amount', () => {
    assert.ok(!ONE_TIME.includes(0), '$0 in a one-off ladder is a meaningless answer')
  })

  test('it anchors higher than the monthly ladder', () => {
    // A one-off is compared against a single coffee, a monthly against a
    // subscription. Offering the same numbers for both invites people to read
    // the one-off as the cheaper version of the same thing.
    assert.ok(Math.min(...ONE_TIME) >= Math.min(...PRESET_LADDERS.without_1.filter((c) => c > 0)))
  })
})

describe('normalizeAmountCents', () => {
  test('zero is an answer, not a rejection', () => {
    assert.equal(normalizeAmountCents(0), 0);
    assert.equal(normalizeAmountCents('0'), 0);
  });

  test('whole dollars pass through', () => {
    assert.equal(normalizeAmountCents(500), 500);
    assert.equal(normalizeAmountCents(SUPPORT_MIN_CENTS), SUPPORT_MIN_CENTS);
    assert.equal(normalizeAmountCents(SUPPORT_MAX_CENTS), SUPPORT_MAX_CENTS);
  });

  test('part-dollars are refused — the picker cannot produce them', () => {
    assert.throws(() => normalizeAmountCents(437), /whole number of dollars/);
  });

  test('below the floor is refused, and the message offers the alternative', () => {
    // 50c: a real amount, under the floor, and the branch that would be dead if
    // the whole-dollar rule were tested first (nothing between 0 and 100 is a
    // multiple of 100). The ordering in normalizeAmountCents is what keeps this
    // message reachable.
    assert.throws(() => normalizeAmountCents(50), /choose \$0/);
    assert.throws(() => normalizeAmountCents(SUPPORT_MIN_CENTS - 1), /choose \$0/);
  });

  test('above the ceiling is refused — that is a slipped decimal point', () => {
    assert.throws(() => normalizeAmountCents(SUPPORT_MAX_CENTS + 100), /typo/);
  });

  test('nonsense is refused rather than coerced', () => {
    for (const bad of [-100, 1.5, NaN, Infinity, 'five', null, undefined, {}]) {
      assert.throws(() => normalizeAmountCents(bad), `accepted ${String(bad)}`);
    }
  });
});

/**
 * The error funnel, which is the third thing in billing with an opinion.
 *
 * ── WHY THIS TEST EXISTS ────────────────────────────────────────────────────
 *
 * `errorMiddleware` answers 500 "Internal server error" for anything that is
 * not an `ApiError`. It does NOT read a `status` property off a plain Error —
 * and two refusals and the upstream wrapper were written as plain Errors with
 * `status` bolted on, so every one of them reached the reader as an outage.
 * Including the do-not-retry sentence — the one written to stop a one-off
 * being paid for twice — which had never once been rendered. (It has since
 * been split in two: `stripeFailure` sends a subscription's reader to their
 * profile, which shows subscription state, and a gift's reader to their
 * receipt, because 057 gives the profile no gift history and a standalone
 * PaymentIntent produces no invoice either.)
 *
 * Nothing else in the suite touches the funnel, which is how it survived seven
 * reviews. So: the shape of a billing error is asserted here, cheaply, and the
 * next person who invents one has to make it an ApiError to get out.
 */
describe('billing errors reach the reader', () => {
  const answered = (err: unknown): { status: number; body: unknown } => {
    let status = 200;
    let body: unknown = null;
    const res = {
      status(s: number) {
        status = s;
        return this;
      },
      json(b: unknown) {
        body = b;
        return this;
      },
    } as unknown as Parameters<typeof errorMiddleware>[2];
    errorMiddleware(err, {} as never, res, (() => {}) as never);
    return { status, body };
  };

  test('an ApiError keeps its status, code and sentence', () => {
    const { status, body } = answered(new ApiError(400, 'payment_in_flight', 'still processing'));
    assert.equal(status, 400);
    assert.deepEqual(body, { error: { code: 'payment_in_flight', message: 'still processing' } });
  });

  test('a plain Error with a bolted-on status is NOT honoured — the bug this guards', () => {
    const bolted = new Error('give it a minute') as Error & { status?: number; code?: string };
    bolted.status = 400;
    bolted.code = 'payment_in_flight';
    const { status, body } = answered(bolted);
    assert.equal(status, 500, 'a plain Error must not be able to fake a 4xx');
    assert.deepEqual(body, { error: { code: 'internal', message: 'Internal server error' } });
  });

  test('the real refusal classes ARE ApiErrors — revert them and this fails', () => {
    // The point of naming them here rather than constructing an equivalent
    // ApiError: this test fails if somebody changes `extends ApiError` back to
    // `extends Error`, which is exactly the regression it exists for. The
    // previous version of this block asserted the middleware's behaviour and
    // would have passed happily through that revert.
    for (const err of [new PaymentInFlightError(), new SubscriptionPausedError()]) {
      assert.ok(err instanceof ApiError, `${err.constructor.name} must extend ApiError to reach the reader`);
      const { status, body } = answered(err);
      assert.equal(status, 400, `${err.constructor.name} must be a 400`);
      const shown = (body as { error: { code: string; message: string } }).error;
      assert.notEqual(shown.code, 'internal');
      assert.equal(shown.message, err.message, 'the sentence written for the reader must be the one sent');
    }
  });

  test('their codes are the ones API.md documents', () => {
    assert.equal((answered(new PaymentInFlightError()).body as { error: { code: string } }).error.code, 'payment_in_flight');
    assert.equal((answered(new SubscriptionPausedError()).body as { error: { code: string } }).error.code, 'subscription_paused');
  });

  test('the upstream wrapper reaches the reader, because it is an ApiError', () => {
    // The 502 shape stripeFailure throws. Its message is the do-not-retry
    // instruction; a 500 here would replace it with "Internal server error".
    const { status, body } = answered(
      new ApiError(502, 'billing_upstream', 'Open your profile to check whether it went through.'),
    );
    assert.equal(status, 502);
    assert.match(JSON.stringify(body), /Open your profile/);
  });

  /**
   * ⚠️ THROUGH `stripeFailure` ITSELF, not through a hand-built ApiError.
   *
   * The first version of these asserted on an `ApiError` written out in the
   * test, so it could not fail on anything: the sentences it checked were the
   * sentences it supplied. "A test that cannot fail on the change it guards is
   * scenery" (DECISIONS §12), repeated one round after recording it. That is
   * why the function is exported.
   *
   * ⚠️ What this pins, precisely: that each `kind` produces the sentence its
   * reader can act on. It does NOT pin the CALL SITES — reverting
   * `stripeFailure(err, 'one_time')` to a bare call in `routes/billing.ts`
   * would still leave these green, because that needs a request through the
   * route and there is no DB in this suite. The call sites are enumerated in
   * DECISIONS §26 instead, which is weaker than a test and is said plainly
   * rather than implied.
   */
  const upstream = (kind?: Parameters<typeof stripeFailure>[1]): string => {
    try {
      stripeFailure(new Error('upstream blew up'), kind);
    } catch (e) {
      return (e as ApiError).message;
    }
    throw new Error('stripeFailure must always throw');
  };

  test('a gift is not sent to a profile that has no gift history', () => {
    // 057 gives the profile no gift history and a standalone PaymentIntent
    // produces no invoice, so both surfaces the subscription sentence names are
    // provably empty for a one-off contributor. The receipt is the only one
    // that can answer, which is why `chargeOnce` sets `receipt_email`.
    const shown = upstream('one_time');
    assert.match(shown, /receipt/);
    assert.doesNotMatch(shown, /profile/);
  });

  test('a subscription IS sent to its profile, which does show its state', () => {
    const shown = upstream('subscription');
    assert.match(shown, /profile/);
  });

  test('a route that moves no money says so instead of asking about a charge', () => {
    // `/setup-intent` and `/portal`. "Check whether it went through" is a
    // question about nothing there — and `/setup-intent` is on the gift leg
    // too, so the subscription sentence was doubly wrong on it.
    const shown = upstream('no_charge');
    assert.match(shown, /[Nn]othing has been charged/);
    assert.doesNotMatch(shown, /profile/);
  });

  test('the default kind is the subscription sentence', () => {
    assert.equal(upstream(), upstream('subscription'));
  });
});

/**
 * The dunning cadence for somebody who has already asked to stop.
 *
 * `payment_issue` outranks everything and runs on a 3-day clock, which is right
 * for a supporter who wants to keep paying. It is not right for one who pressed
 * "stop my support" while their card was failing: they owe one outstanding
 * month for time they have had, so asking is fair, and asking ten times on the
 * way out is not. Round 35 found the profile ALSO never acknowledged the stop
 * on that path; this pins the half that lives in the scheduler.
 */
describe('a cancelling supporter is asked once, not nagged', () => {
  const dunning = (over: Partial<BillingRow> = {}): BillingRow =>
    row({ subscription_status: 'past_due', support_cents: 500, ...over });

  test('an ordinary broken payment keeps the fast cadence', () => {
    const r = dunning({ prompt_last_shown_at: new Date(NOW - PAYMENT_ISSUE_INTERVAL_DAYS * DAY) });
    assert.equal(promptDue(r, NOW), 'payment_issue');
  });

  test('...and is silent inside it', () => {
    const r = dunning({ prompt_last_shown_at: new Date(NOW - (PAYMENT_ISSUE_INTERVAL_DAYS - 1) * DAY) });
    assert.equal(promptDue(r, NOW), null);
  });

  test('one who has asked to stop is NOT re-asked on the fast cadence', () => {
    const r = dunning({
      cancel_at_period_end: true,
      prompt_last_shown_at: new Date(NOW - PAYMENT_ISSUE_INTERVAL_DAYS * DAY),
    });
    assert.equal(promptDue(r, NOW), null, 'three days is nagging somebody on their way out');
  });

  test('...but is still asked once, on the ordinary monthly clock', () => {
    const r = dunning({
      cancel_at_period_end: true,
      prompt_last_shown_at: new Date(NOW - PROMPT_INTERVAL_DAYS * DAY),
    });
    assert.equal(promptDue(r, NOW), 'payment_issue', 'the outstanding month is real and still worth one ask');
  });

  test('a first ask needs no wait either way', () => {
    assert.equal(promptDue(dunning({ cancel_at_period_end: true }), NOW), 'payment_issue');
    assert.equal(promptDue(dunning(), NOW), 'payment_issue');
  });
});

/**
 * The one function in this feature that cancels subscriptions and issues
 * refunds — and it had no test at all.
 *
 * ── WHY THAT MATTERED ───────────────────────────────────────────────────────
 *
 * `sweepDuplicatePayingSubscriptions` is driven by a PUBLIC, unauthenticated
 * endpoint (Stripe's `invoice.paid`), runs outside the request transaction and
 * therefore outside the advisory lock every money route takes, and is the only
 * code path that can take money back. It shipped twice with the keeper chosen
 * wrongly — round thirty-seven kept `pullState`'s display choice, round
 * thirty-eight kept it again through a `preferId` argument that matched the
 * newest subscription whenever the newest was paying, while its own header said
 * "oldest". Both were caught by a reviewer executing it, not by this suite.
 *
 * Stripe is a parameter, so nothing here needs a network or a database: a stub
 * that records what it was asked to cancel and refund is enough to pin the
 * decision, which is the part that has been wrong three times.
 */
describe('the duplicate sweep cancels the newer subscription, never the older', () => {
  const OURS = { deckpal_support: 'true' } as const;

  /** A Stripe stub that records the destructive calls. */
  function stripeWith(subs: { id: string; created: number; status: string; ours?: boolean }[]) {
    const cancelled: string[] = [];
    const refunded: string[] = [];
    const stripe = {
      subscriptions: {
        // Newest first, as Stripe returns them — the ordering that made
        // `limit: 20` hide a live subscription behind dead ones.
        list: async () => ({
          data: [...subs]
            .sort((a, b) => b.created - a.created)
            .map((s) => ({
              id: s.id,
              created: s.created,
              status: s.status,
              latest_invoice: `in_${s.id}`,
              metadata: s.ours === false ? {} : OURS,
            })),
          has_more: false,
        }),
        cancel: async (id: string) => {
          cancelled.push(id);
          return { id };
        },
      },
      invoices: {
        list: async ({ subscription }: { subscription: string }) => ({
          data: [{ id: `in_${subscription}`, amount_paid: 500, status: 'paid' }],
        }),
        retrieve: async (id: string) => ({
          id,
          status: 'paid',
          amount_paid: 500,
          payments: { data: [{ payment: { payment_intent: `pi_${id}` } }] },
        }),
      },
      refunds: { create: async ({ payment_intent }: { payment_intent: string }) => refunded.push(payment_intent) },
    } as unknown as Parameters<typeof sweepDuplicatePayingSubscriptions>[0];
    return { stripe, cancelled, refunded };
  }

  const run = async (subs: Parameters<typeof stripeWith>[0]) => {
    const s = stripeWith(subs);
    await sweepDuplicatePayingSubscriptions(s.stripe, 'cus_1');
    return s;
  };

  test('the six-month supporter survives; the day-old duplicate does not', async () => {
    // The executed failure: both keepers wrong, both times, kept the newest.
    const { cancelled, refunded } = await run([
      { id: 'sub_old', created: 1_000, status: 'active' },
      { id: 'sub_new', created: 9_000, status: 'active' },
    ]);
    assert.deepEqual(cancelled, ['sub_new'], 'the older subscription must never be the one cancelled');
    assert.deepEqual(refunded, ['pi_in_sub_new']);
  });

  test('...even when the newer one is the one in dunning', async () => {
    // `past_due` is a PAYING status, so it is sweepable — but it is still the
    // younger record, and refunding twelve months of a healthy subscription to
    // keep a failing one is the expensive mistake.
    const { cancelled } = await run([
      { id: 'sub_old', created: 1_000, status: 'active' },
      { id: 'sub_new', created: 9_000, status: 'past_due' },
    ]);
    assert.deepEqual(cancelled, ['sub_new']);
  });

  test('a single paying subscription is never touched — this runs on every renewal', async () => {
    const { cancelled, refunded } = await run([
      { id: 'sub_1', created: 1_000, status: 'active' },
      { id: 'sub_dead', created: 9_000, status: 'canceled' },
      { id: 'sub_ghost', created: 9_500, status: 'incomplete' },
    ]);
    assert.deepEqual(cancelled, [], 'an ordinary renewal must cancel nothing');
    assert.deepEqual(refunded, []);
  });

  test('a paused subscription is not a duplicate and not a stray', async () => {
    // Nothing in this app pauses one; the owner did, from the dashboard.
    const { cancelled } = await run([
      { id: 'sub_paid', created: 1_000, status: 'active' },
      { id: 'sub_paused', created: 9_000, status: 'paused' },
    ]);
    assert.deepEqual(cancelled, []);
  });

  test('somebody else\u2019s subscription on the same customer is never touched', async () => {
    const { cancelled } = await run([
      { id: 'sub_ours', created: 1_000, status: 'active' },
      { id: 'sub_theirs', created: 9_000, status: 'active', ours: false },
    ]);
    assert.deepEqual(cancelled, [], 'only subscriptions carrying our metadata are ours to cancel');
  });

  test('three paying subscriptions leave exactly the oldest', async () => {
    const { cancelled } = await run([
      { id: 'sub_a', created: 1_000, status: 'active' },
      { id: 'sub_b', created: 5_000, status: 'trialing' },
      { id: 'sub_c', created: 9_000, status: 'unpaid' },
    ]);
    assert.deepEqual(cancelled.sort(), ['sub_b', 'sub_c']);
  });
});
