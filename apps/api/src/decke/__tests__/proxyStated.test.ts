/**
 * A printing Deck-E chose is a PROPOSAL. A printing the reader named is a
 * decision. The shared resolver calls both of them `stated`, and it is right to
 * — for an MCP caller, "they said which one" is literally true.
 *
 * Deck-E is a proxy. Measured: he names a printing on 100 items out of 100 when
 * nobody asked for one, so every row reached the approval card `stated`, the
 * picker never rendered, and the reader never learned there was a choice.
 * Reported as "for some reason he has completely stopped asking me about
 * variance". This is where that is undone, without touching the classification
 * that is correct for everyone else.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reopenIfProxyStated } from '../adapters/aisdk.js';

const row = (over: Record<string, unknown> = {}) =>
  ({
    index: 0,
    cardId: 'swsh4-25',
    cardName: 'Squirtle',
    setId: 'swsh4',
    number: '25',
    certainty: 'stated',
    candidates: [
      { variantId: 1, kindCode: 'normal', label: 'Normal', isPrimary: true, ownedQty: 0 },
      { variantId: 2, kindCode: 'reverse', label: 'Reverse holo', isPrimary: false, ownedQty: 1 },
    ],
    wouldUseVariantId: null,
    variantId: 1,
    variantLabel: 'Normal',
    mode: 'delta',
    value: 1,
    before: 0,
    after: 1,
    clamped: false,
    ...over,
  }) as never;

test('the reader said nothing, so his pick becomes a question again', () => {
  const out = reopenIfProxyStated(row(), false);
  assert.equal(out.certainty, 'unstated', 'the row still claims the reader stated it');
  // And his choice survives as the PRE-SELECTION, not as the answer — the
  // picker opens on what he proposed rather than on nothing.
  assert.equal(out.wouldUseVariantId, 1);
});

test('the reader DID say, so nothing is re-opened', () => {
  const out = reopenIfProxyStated(row(), true);
  assert.equal(out.certainty, 'stated');
  assert.deepEqual(out, row());
});

test('a single printing is never turned into a question', () => {
  // There is genuinely nothing to choose. Asking anyway is how a dialog starts
  // feeling like paperwork, and the owner wanted the OPPOSITE — one chip,
  // visibly alone, IS the answer to "why is he sure".
  const one = row({
    candidates: [{ variantId: 1, kindCode: 'normal', label: 'Normal', isPrimary: true, ownedQty: 0 }],
    certainty: 'only-one',
  });
  assert.equal(reopenIfProxyStated(one, false).certainty, 'only-one');
  const statedButSingle = row({
    candidates: [{ variantId: 1, kindCode: 'normal', label: 'Normal', isPrimary: true, ownedQty: 0 }],
  });
  assert.equal(reopenIfProxyStated(statedButSingle, false).certainty, 'stated');
});

test('a row with no candidates is left exactly alone', () => {
  // Re-opening needs something to pick from. An empty picker is worse than no
  // picker, and `editable` would refuse the whole card anyway — so this fails
  // closed rather than producing a dialog with a question and no answers.
  const bare = row({ candidates: [] });
  assert.deepEqual(reopenIfProxyStated(bare, false), bare);
});

test('the kinds that already ask are untouched', () => {
  // `unstated` and `ambiguous` were always questions. Passing them through this
  // must not change their shape, or the card's own classification test breaks
  // for a reason that has nothing to do with proxies.
  for (const certainty of ['unstated', 'ambiguous', 'unresolvable'] as const) {
    const r = row({ certainty });
    assert.deepEqual(reopenIfProxyStated(r, false), r, certainty);
  }
});
