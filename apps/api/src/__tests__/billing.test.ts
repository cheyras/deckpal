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

describe('promptDue — a broken payment outranks the ask', () => {
  const base = { onboarded_at: new Date(NOW - 90 * DAY), visit_count: 999, support_cents: 500 };

  for (const status of ['past_due', 'unpaid', 'incomplete']) {
    test(`${status} asks about the card, not about the amount`, () => {
      assert.equal(promptDue(row({ ...base, subscription_status: status }), NOW), 'payment_issue');
    });
  }

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
