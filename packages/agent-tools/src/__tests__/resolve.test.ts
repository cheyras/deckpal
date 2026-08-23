/**
 * `variantCertainty` — and the pinning test that says it did not change
 * `pickVariant`.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * The approval card the owner designed has two sections: printings we know,
 * and printings to ask about. The plan proposed keying that split on
 * `pickVariant`'s STATUS (`stated | defaulted | ambiguous`). A reviewer caught
 * that this is insufficient in the one direction that matters:
 *
 *   An omitted variant on a card with several printings resolves SUCCESSFULLY.
 *   `pickVariant` returns `status: 'ok'` with the primary silently substituted.
 *   Keyed on status, that row is "resolved fine" and lands in section 1 —
 *   which is EXACTLY the row the owner wants asked about.
 *
 * So classification keys on CANDIDATE COUNT. The two tests that carry the whole
 * correction are the first two below.
 *
 * ── AND THE HARD CONSTRAINT ─────────────────────────────────────────────────
 *
 * `variantCertainty` must be a NEW field beside `pickVariant`'s answer, never a
 * change to it. `add_cards` and every other non-Deck-E caller depend on the
 * silent primary default, and turning those into errors would be a regression
 * well outside this pass. The last test in this file is the executable form of
 * that sentence: the same fixtures through `pickVariant`, with its output
 * asserted verbatim.
 *
 * This package had no tests before this file. `pnpm --filter @deckpal/agent-tools
 * test:variants` runs it; there is no database and no network in it, because
 * both functions under test are pure.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  certaintyAsksSelection,
  pickVariant,
  variantCertainty,
  type ResolvedVariant,
} from '../resolve.js';

const v = (id: number, kindCode: string, isPrimary = false, ownedQty = 0): ResolvedVariant => ({
  id,
  kindCode,
  displayName: kindCode === 'reverse' ? 'Reverse Holo' : null,
  isPrimary,
  ownedQty,
});

/** A card with two printings — the shape the whole correction is about. */
const TWO = [v(37183, 'normal', true), v(37184, 'reverse')];
/** A card with exactly one. */
const ONE = [v(41000, 'normal', true)];

// ── The two that carry the blocker ───────────────────────────────────────────

test('omitted variant on a MULTI-printing card is a question, even though it resolved ok', () => {
  // THE CORRECTION. `pickVariant` says `ok` and hands back the primary; the
  // plan's status-keyed field would have called that `defaulted` and filed it
  // under "known". It is the row the owner most wants asked about.
  const ref = {};
  const res = pickVariant(TWO, ref);
  assert.equal(res.status, 'ok', 'fixture assumption: this genuinely resolves');

  const c = variantCertainty(TWO, ref, res);
  assert.equal(c.kind, 'unstated');
  assert.equal(certaintyAsksSelection(c), true, 'a silently-defaulted printing must be asked about');
  assert.deepEqual(c.kind === 'unstated' ? c.candidates.map((x) => x.id) : null, [37183, 37184]);
  assert.equal(c.kind === 'unstated' ? c.wouldUse : null, 37183, 'the default is shown, not written');
});

test('a STATED printing on a multi-printing card is NOT a question', () => {
  // The other half of the rule order: `stated` and `all.length > 1` are both
  // true here, and the row still needs nothing asked. `stated` is therefore
  // tested before anything that counts candidates.
  for (const ref of [{ variant_id: 37184 }, { variant_kind: 'reverse' }]) {
    const res = pickVariant(TWO, ref);
    assert.equal(res.status, 'ok');
    const c = variantCertainty(TWO, ref, res);
    assert.equal(c.kind, 'stated', `${JSON.stringify(ref)} should be stated`);
    assert.equal(certaintyAsksSelection(c), false);
  }
});

// ── The rest of the five rules ───────────────────────────────────────────────

test('omitted on a SINGLE-printing card is known — there is nothing to ask', () => {
  // The settled detail: defaulted-but-unambiguous belongs in section 1.
  const ref = {};
  const c = variantCertainty(ONE, ref, pickVariant(ONE, ref));
  assert.equal(c.kind, 'only-one');
  assert.equal(certaintyAsksSelection(c), false);
});

test("pickVariant's own `ambiguous` carries its candidate list into section 2", () => {
  // The narrow case: an ABSOLUTE quantity on a card the user owns more than one
  // printing of. Different condition from `unstated`, same bucket.
  const owned = [v(37183, 'normal', true, 3), v(37184, 'reverse', false, 2)];
  const ref = {};
  const res = pickVariant(owned, ref, { forAbsoluteQuantity: true });
  assert.equal(res.status, 'ambiguous', 'fixture assumption');

  const c = variantCertainty(owned, ref, res);
  assert.equal(c.kind, 'ambiguous');
  assert.equal(certaintyAsksSelection(c), true);
  assert.deepEqual(c.kind === 'ambiguous' ? c.candidates.map((x) => x.id) : null, [37183, 37184]);
});

test('a printing that does not belong to the card is unresolvable, not stated', () => {
  // Rule 1 runs before rule 2 on purpose. `variant_id: 99999` IS an explicit
  // statement — and it resolved to nothing, so there is no printing to be
  // certain about, and calling it `stated` would put a dead row in section 1
  // with a confident label on it.
  const ref = { variant_id: 99999 };
  const res = pickVariant(TWO, ref);
  assert.equal(res.status, 'not_found');
  assert.equal(variantCertainty(TWO, ref, res).kind, 'unresolvable');
});

test('a card with no catalog variants at all is unresolvable', () => {
  const ref = {};
  const res = pickVariant([], ref);
  assert.equal(res.status, 'not_found');
  assert.equal(variantCertainty([], ref, res).kind, 'unresolvable');
});

test('an unknown variant_kind is unresolvable rather than silently defaulted', () => {
  const ref = { variant_kind: 'holo-stamped-nonsense' };
  const res = pickVariant(TWO, ref);
  assert.equal(res.status, 'not_found');
  assert.equal(variantCertainty(TWO, ref, res).kind, 'unresolvable');
});

test('the candidate list is a copy — a caller that sorts it cannot reorder the catalog', () => {
  const ref = {};
  const c = variantCertainty(TWO, ref, pickVariant(TWO, ref));
  assert.equal(c.kind, 'unstated');
  if (c.kind !== 'unstated') return;
  c.candidates.reverse();
  assert.deepEqual(
    TWO.map((x) => x.id),
    [37183, 37184],
    'variantCertainty aliased its input',
  );
});

// ── THE HARD CONSTRAINT, MADE EXECUTABLE ─────────────────────────────────────

test('pickVariant is UNCHANGED: the silent primary default still holds', () => {
  // `add_cards` and every non-Deck-E caller depend on this exact behaviour. If
  // somebody ever "fixes" the silent default by making it ambiguous, this test
  // fails first and names the flows that would break.
  const omitted = pickVariant(TWO, {});
  assert.equal(omitted.status, 'ok');
  assert.deepEqual(omitted.status === 'ok' ? omitted.variant : null, TWO[0]);

  // Explicit id and kind still win, and still return `ok`.
  assert.deepEqual(pickVariant(TWO, { variant_id: 37184 }), { status: 'ok', variant: TWO[1] });
  assert.deepEqual(pickVariant(TWO, { variant_kind: 'REVERSE ' }), { status: 'ok', variant: TWO[1] });

  // Single-printing card, omitted: still `ok`, still the only row.
  assert.deepEqual(pickVariant(ONE, {}), { status: 'ok', variant: ONE[0] });

  // `ambiguous` still fires ONLY for absolute quantity on >1 OWNED printing —
  // not for a delta, and not for >1 printing merely existing.
  const owned = [v(1, 'normal', true, 3), v(2, 'reverse', false, 2)];
  assert.equal(pickVariant(owned, {}).status, 'ok', 'a delta on two owned printings is not ambiguous');
  assert.equal(
    pickVariant(TWO, {}, { forAbsoluteQuantity: true }).status,
    'ok',
    'nothing owned is not ambiguous',
  );
  assert.equal(pickVariant(owned, {}, { forAbsoluteQuantity: true }).status, 'ambiguous');
});
