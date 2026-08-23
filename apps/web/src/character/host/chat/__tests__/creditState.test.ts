/**
 * The credit balance, as words.
 *
 * The daily cap is being replaced by a balance you top up. The balance itself is
 * another lane's work; these are the DECISIONS the panel makes about it — when a
 * balance counts as low, what the header says, and what he says when it is gone
 * — and every one of them is a sentence or a number on a screen, which is the
 * definition this codebase uses for "logic".
 *
 * ── WHY THE THRESHOLD IS TESTED AT ALL ───────────────────────────────────────
 *
 * "Low" is the kind of rule that gets written as a `< 10` in a JSX expression
 * and is then wrong for every reader whose plan is not the one the author had in
 * mind. It is a fraction OR a floor, and the interesting cases are the ones
 * where only one of the two bites.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  LOW_FLOOR,
  LOW_FRACTION,
  TOP_UP_LABEL,
  creditHeaderLabel,
  creditState,
  outOfCreditsDetail,
  outOfCreditsLine,
} from '../creditState'

/**
 * MUTATION: drop the `remaining <= LOW_FLOOR` arm and the third assertion goes
 * red. 1 credit of a 2,000 allowance is 0.05% and would be caught by the
 * fraction; 1 of 4 is 25% and would not, and it is unmistakably nearly out.
 */
test('low is a fraction OR a floor, because neither alone is right', () => {
  assert.equal(creditState({ remaining: 100, allowance: 100 }), 'ok')
  assert.equal(creditState({ remaining: 50, allowance: 100 }), 'ok')
  // The fraction bites on a big allowance.
  assert.equal(creditState({ remaining: 10, allowance: 100 }), 'low')
  assert.equal(creditState({ remaining: Math.ceil(LOW_FRACTION * 100) + 1, allowance: 100 }), 'ok')
  // The floor bites on a small one, where the fraction never would.
  assert.equal(creditState({ remaining: LOW_FLOOR, allowance: 6 }), 'low')
  assert.equal(creditState({ remaining: 3, allowance: 4 }), 'low', '3 of 4 is 75% and is still nearly out')
})

/**
 * MUTATION: return `'ok'` for a null balance and the second assertion goes red.
 *
 * `unknown` is not `ok`. A build with no credit system, and a session where the
 * balance has not loaded, are the same state — nothing is known — and the
 * correct behaviour is to SAY NOTHING rather than to imply a healthy balance.
 * Assuming `ok` is the comfortable direction and it is the one that shows a
 * reader a working composer when they may have none left.
 */
test('an unknown balance is its own state and shows nothing at all', () => {
  assert.equal(creditState(null), 'unknown')
  assert.equal(creditHeaderLabel(null), '', 'nothing is known, so nothing is claimed')
  assert.equal(creditHeaderLabel({ remaining: 90, allowance: 100 }), '', 'and a healthy balance is silent too')
})

/**
 * MUTATION: change `remaining === 0` to `remaining < 0` and a spent balance
 * reads "0 credits left" instead of "Out of credits" — technically true, and it
 * puts a number where the state belongs.
 */
test('the header counts credits, and names the empty state rather than counting it', () => {
  assert.equal(creditHeaderLabel({ remaining: 3, allowance: 100 }), '3 credits left')
  assert.equal(creditHeaderLabel({ remaining: 1, allowance: 100 }), '1 credit left')
  assert.equal(creditHeaderLabel({ remaining: 0, allowance: 100 }), 'Out of credits')
  assert.equal(creditState({ remaining: 0, allowance: 100 }), 'empty')
})

/**
 * MUTATION: remove the `Math.max(0, …)` clamp and a negative balance from a
 * server that has started charging for something reads "-2 credits left".
 */
test('a balance the server got wrong is not rendered as arithmetic', () => {
  assert.equal(creditState({ remaining: -2, allowance: 100 }), 'empty')
  assert.equal(creditHeaderLabel({ remaining: -2, allowance: 100 }), 'Out of credits')
  // An allowance of zero must not divide by zero into NaN, which compares false
  // against everything and would silently report `ok`.
  assert.equal(creditState({ remaining: 1, allowance: 0 }), 'low')
})

/**
 * HE SAYS IT, AND HE DOES NOT GROVEL.
 *
 * MUTATION: change `outOfCreditsLine` to "You have run out of credits." and this
 * goes red. The owner chose the first person over a system banner: a product
 * talking over a character who is standing four inches away is the tone this
 * pass removed from everywhere else on this surface.
 */
test('the out-of-credits line is his, in the first person, and offers no apology loop', () => {
  const line = outOfCreditsLine()
  assert.match(line, /^I'm\b/, 'he is the one saying it')
  assert.doesNotMatch(line, /\byou have\b|\byour account\b/i, 'that is a banner, not him')
  assert.doesNotMatch(line, /sorry|apolog|unfortunately|i'd love to/i, 'no grovelling')
  // And what still works is stated, because it is more than nothing.
  assert.match(outOfCreditsDetail(), /still here to read/)
  // The action is named as an action.
  assert.match(TOP_UP_LABEL, /^Top up/)
})
