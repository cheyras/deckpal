/**
 * The shape a transcript row keeps, so it can be QUERIED later.
 *
 * The jsonb column's whole value is that a regression hunt can ask
 * `tools @> '[{"name":"plan_deck"}]'` and get an index scan. That only works if
 * every row has the same keys with the same meanings — a free-form blob would
 * be a column nobody can ask a question of, which is the failure this feature
 * exists to prevent rather than one it can afford to have.
 *
 * The content is CLIENT-SUPPLIED. It is what the reader actually saw, which is
 * the right record to keep, and it is also not evidence about the server — so
 * the two fields that ARE evidence (the build stamp) are written server-side and
 * never accepted from the body. See `deckeHistory.ts`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { MAX_TOOLS, UUID, seqFrom, shapeTools, type ToolRecord } from '../../routes/deckeHistory.js';

test('a well-formed call keeps all four fields', () => {
  assert.deepEqual(
    shapeTools([{ name: 'plan_deck', phase: 'error', title: 'Plan a deck', summary: 'spent' }]),
    [{ name: 'plan_deck', phase: 'error', title: 'Plan a deck', summary: 'spent' }],
  );
});

/** First element, asserted present — `noUncheckedIndexedAccess` is on here. */
function only(input: unknown): ToolRecord {
  const out = shapeTools(input);
  assert.equal(out.length, 1, `expected exactly one shaped tool, got ${out.length}`);
  return out[0] as ToolRecord;
}

test('an unknown phase is recorded as `unknown`, never passed through', () => {
  // The phase is the column a regression hunt filters on — "when did this start
  // coming back error". A free string there means the filter silently misses
  // rows, which is worse than a row that says it does not know.
  assert.equal(only([{ name: 'x', phase: 'weird' }]).phase, 'unknown');
  assert.equal(only([{ name: 'x', phase: 42 }]).phase, 'unknown');
  assert.equal(only([{ name: 'x' }]).phase, 'unknown');
  // The real ones survive intact.
  for (const p of ['start', 'progress', 'ok', 'partial', 'error', 'declined']) {
    assert.equal(only([{ name: 'x', phase: p }]).phase, p, p);
  }
});

test('a call with no name is dropped, because it cannot be queried for', () => {
  // `tools @> '[{"name": …}]'` is the query. A row with no name is weight in
  // the column and reachable by nothing.
  assert.deepEqual(shapeTools([{ phase: 'ok' }, { name: '', phase: 'ok' }, null, 7]), []);
});

test('nonsense in, empty array out — never a throw', () => {
  // This runs on the hot path of every exchange. A throw here would fail the
  // recording of a turn that otherwise went perfectly.
  for (const v of [null, undefined, 'nope', 42, {}, { length: 3 }]) {
    assert.deepEqual(shapeTools(v as unknown), [], String(v));
  }
});

test('the array is capped, and the cap keeps the FIRST calls', () => {
  // A turn's early calls are the ones that explain it. Truncating from the front
  // would keep the tail of a runaway loop and drop the thing that started it.
  const many = Array.from({ length: MAX_TOOLS + 25 }, (_, i) => ({ name: `t${i}`, phase: 'ok' }));
  const out = shapeTools(many);
  assert.equal(out.length, MAX_TOOLS);
  assert.equal(out[0]?.name, 't0');
});

test('long strings are truncated rather than rejected', () => {
  // Losing the tail of a record beats losing the record. This is a history, and
  // a turn that failed to save because its summary was long is the one somebody
  // will go looking for.
  const out = only([{ name: 'n'.repeat(500), title: 't'.repeat(900), summary: 's'.repeat(9000), phase: 'ok' }]);
  assert.equal(out.name.length, 80);
  assert.equal(out.title.length, 200);
  assert.equal(out.summary.length, 500);
});

test('the id must be a uuid, and things that merely look like one are refused', () => {
  assert.ok(UUID.test('3f1821e0-927d-4284-a855-a2bcb8aad6c6'));
  assert.ok(UUID.test('3F1821E0-927D-4284-A855-A2BCB8AAD6C6'));
  for (const bad of [
    '3f1821e0927d4284a855a2bcb8aad6c6',
    "3f1821e0-927d-4284-a855-a2bcb8aad6c6'; DROP TABLE decke_turn; --",
    '../../etc/passwd',
    '',
    '3f1821e0-927d-4284-a855-a2bcb8aad6c',
  ]) {
    assert.equal(UUID.test(bad), false, bad);
  }
});

test('WRITES go through the owning role, reads stay on the RLS client', () => {
  // A SOURCE PIN, and it exists because the route returned 500 on every insert
  // in production. `q()` runs inside the per-request RLS transaction, which has
  // `SET LOCAL role = 'authenticated'` — and migration 044 gives that role
  // SELECT and DELETE and deliberately NO insert, because a client that could
  // insert could claim any turn happened on any build.
  //
  // The migration's own header says the write path runs as the connection's
  // owning role. The code used the convenient helper instead. Same shape as the
  // credit log earlier in this pass: the comment described the mechanism and the
  // call site did something else.
  const src = readFileSync(
    fileURLToPath(new URL('../../routes/deckeHistory.ts', import.meta.url)),
    'utf8',
  )
  // ACROSS THE STATEMENT, NOT ONE LINE. The first version of this check tested
  // each line in isolation and came back GREEN under the exact mutation it was
  // written for: `await q1<{ id: string }>(` and the `INSERT` that follows it
  // are on different lines, so neither line matched both halves. A guard that
  // reads one line at a time cannot see a call whose SQL is on the next.
  const bad: string[] = [];
  for (const m of src.matchAll(/await q1?(?:<[^>]*>)?\(/g)) {
    const at = m.index ?? 0;
    const stmt = src.slice(at, at + 300);
    if (/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b/i.test(stmt)) {
      bad.push(stmt.slice(0, 70).replace(/\s+/g, ' '));
    }
  }
  assert.deepEqual(bad, [], `a write is going through the RLS client and will be denied: ${bad.join(' | ')}`)
  assert.match(src, /async function write</, 'the owning-role helper is gone')
  assert.match(src, /pool\.query</, 'write no longer uses the pool directly')
  // And the reads did NOT move: RLS is a second lock on top of `WHERE user_id`
  // and there is no reason for a read to leave it.
  assert.match(src, /const rows = await q\(|await q\(\s*\n?\s*`SELECT/, 'reads left the RLS client')
})

test('a JSON NUMBER is a valid seq — the bug that collapsed every conversation', () => {
  // `clampInt` goes through `str()`, which returns undefined for anything that
  // is not a string. A JSON body sends `seq` as a number, so `str(1)` was
  // undefined, the fallback was -1, and the clamp pulled that up to the
  // MINIMUM — zero. Every turn was written at seq 0 and overwrote the one
  // before it, so a conversation could only ever hold one exchange. The guard
  // meant to catch it could not fire, because the clamp had already made the
  // value non-negative.
  //
  // Found by posting two turns to a real deployment and reading back one row.
  assert.equal(seqFrom(0), 0)
  assert.equal(seqFrom(1), 1)
  assert.equal(seqFrom(37), 37)
  // A numeric string is fine too — some clients stringify.
  assert.equal(seqFrom('4'), 4)
})

test('a bad seq is REFUSED, never quietly moved to a position nobody asked for', () => {
  // Silently writing at 0 is how the original bug destroyed data. A 400 is the
  // only safe answer for a position that cannot be trusted.
  for (const v of [-1, 1.5, NaN, Infinity, 10_001, '', 'abc', null, undefined, {}, []]) {
    assert.equal(seqFrom(v), null, JSON.stringify(v) ?? String(v))
  }
})

test('the ROUTE uses seqFrom, and clampInt is nowhere near the body', () => {
  // A SOURCE PIN, because reverting the route to `clampInt(body.seq, …)` broke
  // NOTHING: every test above calls `seqFrom` directly, so the helper could be
  // perfect and unused while the route quietly wrote every turn at zero again.
  // That is the same defect this pass has now produced eight times.
  //
  // `clampInt` is still imported and still correct FOR QUERY STRINGS — the list
  // route's `limit` uses it — so the check is about where it is applied, not
  // about whether it exists.
  const src = readFileSync(
    fileURLToPath(new URL('../../routes/deckeHistory.ts', import.meta.url)),
    'utf8',
  )
  assert.match(src, /const seq = seqFrom\(body\.seq\)/, 'the route no longer parses seq properly')
  assert.doesNotMatch(src, /clampInt\(\s*body\./, 'clampInt is being used on a JSON body again')
})

test('the write path checks WHOSE conversation it is, and cannot rewrite a turn', () => {
  // Two blocking defects found in review, both in one statement.
  //
  // 1. `ON CONFLICT (id) DO NOTHING` on the conversation swallows the case where
  //    the id belongs to somebody else, and every statement here runs as the
  //    OWNING ROLE with RLS bypassed — so an entitled account posting another's
  //    conversationId had its turns written into that conversation. 043's claim
  //    that a guessed id "reaches nothing because it is namespaced by user_id in
  //    every query" was false for exactly the write path.
  //
  // 2. `DO UPDATE` made POST an update route, which 044 exists to forbid — and
  //    because `buildStamp()` is re-read on every post, a repost after a deploy
  //    silently RE-ATTRIBUTED the turn to the new build, destroying the one
  //    correlation this feature provides.
  const src = readFileSync(
    fileURLToPath(new URL('../../routes/deckeHistory.ts', import.meta.url)),
    'utf8',
  )
  assert.match(src, /SELECT user_id FROM decke_conversation WHERE id = \$1/, 'the write path no longer checks ownership')
  assert.match(src, /owner\.user_id !== userId\) throw notFound/, 'a foreign conversation is no longer refused')
  assert.match(src, /ON CONFLICT \(conversation_id, seq\) DO NOTHING/, 'the turn insert can rewrite a recorded turn again')
  assert.doesNotMatch(src, /DO UPDATE\s+SET asked/, 'the rewrite path is back')
  // And the list read carries the first lock as well as the second.
  assert.match(src, /LEFT JOIN decke_turn t ON t\.conversation_id = c\.id AND t\.user_id = \$1/, 'the summary can be polluted by another user’s turns')
})

// ── ARGUMENTS: 043's four keys became five ──────────────────────────────────
//
// The four answered WHICH tool and HOW IT WENT and never WITH WHAT, which is
// where every defect the agent-quality pass fixed actually lived. See
// `decke/toolArgs.ts`.

test('args are kept, and are queryable jsonb rather than a blob', () => {
  const [row] = shapeTools([
    { name: 'set_progress', phase: 'error', title: 'Check set completion', summary: 'no', args: { set_id: 'sv3pt5' } },
  ]);
  assert.deepEqual(row?.args, { set_id: 'sv3pt5' });
  // The whole point of the column: `tools @> '[{"args":{"set_id":"sv3pt5"}}]'`.
  assert.doesNotThrow(() => JSON.stringify([row]));
});

test('a tool with no args has NO args key, not a null one', () => {
  const [row] = shapeTools([{ name: 'health', phase: 'ok', title: 'Health', summary: 'ok' }]);
  assert.ok(row);
  assert.equal('args' in row, false, 'an absent key and a null one read differently in jsonb');
});

test('oversized args are dropped WHOLE rather than truncated into nonsense', () => {
  // Half a JSON object is not queryable, and the containment query is the whole
  // reason this column is jsonb. A record with no args is honest; one with
  // mangled args is a trap for whoever queries it next.
  const [row] = shapeTools([
    { name: 'deck_strategy', phase: 'ok', title: 'x', summary: 'y', args: { markdown: 'z'.repeat(50_000) } },
  ]);
  assert.equal(row?.args, undefined);
});

test('args that are not an object are refused', () => {
  // The body is just JSON — a caller that skipped the client entirely can send
  // anything, and this column is read for years.
  for (const bad of ['string', 42, true, null, ['a'], undefined]) {
    const [row] = shapeTools([{ name: 't', phase: 'ok', title: '', summary: '', args: bad }]);
    assert.equal(row?.args, undefined, String(bad));
  }
});

test('the other four keys are unchanged by the addition', () => {
  const [row] = shapeTools([
    { name: 'decks', phase: 'ok', title: 'Read decks', summary: 'one', args: { deck_id: 'd1' } },
  ]);
  assert.equal(row?.name, 'decks');
  assert.equal(row?.phase, 'ok');
  assert.equal(row?.title, 'Read decks');
  assert.equal(row?.summary, 'one');
});
