/**
 * Credits: one balance, spent down, hard stop at zero.
 *
 * The daily two-counter meter produced what the owner called a useless agent —
 * "he can chat and lookup but he can only pretend to do other stuff and that
 * sucks". I recommended keeping cheap features alive at zero and he overruled
 * it, correctly: an agent that can only pretend is worse than one honestly away.
 *
 * These are pure. No database, because the whole behaviour worth asserting is
 * "no row means refused", the prices, and the sentence at the end.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BALANCE_SQL,
  COST,
  CREDIT_USD,
  DEEP_DEFAULT,
  GRANT_BALANCE_SQL,
  LOW_BALANCE,
  SPEND_SQL,
  balanceIsLow,
  creditVerdictFrom,
  creditsEnabled,
  deepCost,
  outOfCreditsText,
} from '../credits.js';

test('IT IS OFF BY DEFAULT, which is what keeps 041 from locking everyone out', () => {
  // Migration 041 creates every balance at ZERO. Switching credits on before
  // granting balances makes Deck-E unavailable to every account at once,
  // including the owner's. Order: migrate, grant, then flag.
  const prev = process.env.DECKE_CREDITS_ENABLED;
  try {
    delete process.env.DECKE_CREDITS_ENABLED;
    assert.equal(creditsEnabled(), false);
    process.env.DECKE_CREDITS_ENABLED = 'false';
    assert.equal(creditsEnabled(), false);
    // Only the exact string. "1", "yes" and "TRUE" are how a deployment turns
    // something on by accident.
    process.env.DECKE_CREDITS_ENABLED = '1';
    assert.equal(creditsEnabled(), false);
    process.env.DECKE_CREDITS_ENABLED = 'true';
    assert.equal(creditsEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.DECKE_CREDITS_ENABLED;
    else process.env.DECKE_CREDITS_ENABLED = prev;
  }
});

test('no row means refused, and the refusal says what they HAVE', () => {
  // "You have 12 and this costs 75" is answerable. "No" is not, and neither is
  // a refusal that only quotes the price.
  const refused = creditVerdictFrom([], 75, 12);
  assert.equal(refused.allowed, false);
  assert.equal(refused.allowed === false && refused.balance, 12);
  assert.equal(refused.allowed === false && refused.needed, 75);
});

test('a row means it went through, and reports what is left', () => {
  const ok = creditVerdictFrom([{ balance: 25 }], 75, 100);
  assert.equal(ok.allowed, true);
  assert.equal(ok.allowed === true && ok.balance, 25);
  assert.equal(ok.allowed === true && ok.spent, 75);
});

test('a refusal never reports a negative balance', () => {
  // `balanceIfRefused` is read a moment earlier and passed in. A stale or absent
  // read must not produce "you have -3 credits", which reads as a billing bug on
  // the one screen where trust matters most.
  for (const b of [0, -1, -999, Number.NaN]) {
    const v = creditVerdictFrom([], 10, b);
    assert.equal(v.allowed, false);
    assert.ok(v.allowed === false && v.balance >= 0, `balance was ${v.allowed === false && v.balance}`);
  }
});

test('NOTHING IS EVER FREE — an unnamed deep tool costs the expensive end', () => {
  // The failure mode is somebody adding an expensive tool and discovering the
  // pricing gap from a bill. A missing entry falls to the top of the range,
  // never to zero.
  assert.equal(deepCost('some_tool_added_next_year'), DEEP_DEFAULT);
  assert.ok(DEEP_DEFAULT > 1);
  for (const n of ['plan_deck', 'write_strategy_guide', 'analyze_collection', 'research_meta']) {
    assert.ok(deepCost(n) >= 1, `${n} costs ${deepCost(n)}`);
  }
});

test('every price is a whole number of at least one credit', () => {
  // A spend that rounds to zero is free work with an audit row, and enough of
  // them is an unmetered endpoint with extra steps.
  const all = [COST.chat_turn, DEEP_DEFAULT, ...Object.values(COST.deep)];
  for (const c of all) {
    assert.ok(Number.isInteger(c), `${c} is not an integer`);
    assert.ok(c >= 1, `${c} is free`);
  }
});

test('the deep tier really is dearer than conversation', () => {
  // The reason there were two counters at all: they differ by orders of
  // magnitude. Collapsing to one balance must not collapse that.
  assert.ok(deepCost('plan_deck') > COST.chat_turn * 20, 'a deck plan is priced like a chat turn');
  assert.ok(deepCost('plan_deck') >= deepCost('analyze_collection'));
});

test('the prices follow CREDIT_USD rather than being hand-picked', () => {
  // If somebody halves the value of a credit, every price must move with it.
  // A table of literals drifts from what things cost, invisibly, until a bill.
  assert.equal(CREDIT_USD, 0.01);
  assert.equal(deepCost('plan_deck'), Math.ceil(0.75 / CREDIT_USD));
  assert.equal(deepCost('analyze_collection'), Math.ceil(0.0356 / CREDIT_USD));
});

test('low means "can I still do the expensive thing"', () => {
  // Not an arbitrary round number: the question someone is actually asking when
  // they glance at a balance is whether the big thing is still available.
  assert.ok(LOW_BALANCE > deepCost('plan_deck'));
  assert.equal(balanceIsLow(0), true);
  assert.equal(balanceIsLow(LOW_BALANCE), true);
  assert.equal(balanceIsLow(LOW_BALANCE + 1), false);
  assert.equal(balanceIsLow(Number.NaN), false);
});

test('the spend is ONE statement, and it is conditional', () => {
  // A SELECT-then-UPDATE lets two concurrent turns both read enough and both
  // spend. The check and the decrement must be under the same row lock, which
  // is what makes zero-rows-affected the refusal.
  assert.match(SPEND_SQL, /UPDATE decke_credit_balance/);
  assert.match(SPEND_SQL, /WHERE user_id = \$1 AND balance >= \$2/);
  assert.match(SPEND_SQL, /RETURNING balance/);
  assert.doesNotMatch(SPEND_SQL, /SELECT/i, 'the spend reads before it writes');
});

test('a grant adds to what is there and never replaces it', () => {
  // `SET balance = $2` instead of `b.balance + EXCLUDED.balance` would make a
  // top-up DESTROY the remaining balance — silently, and only for people who
  // still had some left.
  assert.match(GRANT_BALANCE_SQL, /SET balance = b\.balance \+ EXCLUDED\.balance/);
  assert.match(BALANCE_SQL, /SELECT balance FROM decke_credit_balance WHERE user_id = \$1/);
});

test('he says it himself, in the first person, and does not negotiate', () => {
  const t = outOfCreditsText();
  assert.match(t, /^I'm out of credits/);
  assert.doesNotMatch(t, /tomorrow/i, 'a topped-up balance does not reset overnight');
  assert.doesNotMatch(t, /sorry/i);
});
