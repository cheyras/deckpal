/**
 * The ledger that stops him asking the same question nine times.
 *
 * Every case here is a shape taken from the owner's transcript history rather
 * than invented — see `repeat.ts` for the counts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CallLedger, callKey } from '../repeat.js';

test('callKey: argument ORDER does not make two identical calls look different', () => {
  // A model emits object keys in whatever order it happens to. Without the
  // sort, half the repeats would slip through and nothing would look broken.
  assert.equal(
    callKey('set_progress', { set_id: 'me05', goal: 'complete' }),
    callKey('set_progress', { goal: 'complete', set_id: 'me05' }),
  );
});

test('callKey: nested objects and arrays are ordered too', () => {
  assert.equal(
    callKey('t', { a: [{ y: 2, x: 1 }], b: 3 }),
    callKey('t', { b: 3, a: [{ x: 1, y: 2 }] }),
  );
});

test('callKey: different arguments are different keys', () => {
  assert.notEqual(callKey('set_progress', { set_id: 'me05' }), callKey('set_progress', { set_id: 'me02' }));
  assert.notEqual(callKey('decks', { id: 'a' }), callKey('lists', { id: 'a' }));
});

test('callKey: a missing field and an explicitly undefined one agree', () => {
  // `{set_id: 'me05'}` and `{set_id: 'me05', goal: undefined}` are the same
  // call; JSON.stringify drops undefined values, so both fold to one key.
  assert.equal(callKey('t', { a: 1 }), callKey('t', { a: 1, b: undefined }));
});

test('a repeated FAILING call does not reach the handler a second time', async () => {
  // The measured shape: set_progress('sv3pt5') nine times in one turn, each
  // one a database round trip and a step out of twelve.
  const ledger = new CallLedger();
  let ran = 0;
  const exec = async () => {
    ran += 1;
    return { text: "No set matches 'sv3pt5'.", failed: true };
  };
  const key = callKey('set_progress', { set_id: 'sv3pt5' });

  const first = await ledger.share(key, exec);
  assert.equal(ran, 1);
  assert.equal(first.repeated, false);
  assert.equal(first.text, "No set matches 'sv3pt5'.");

  const second = await ledger.share(key, exec);
  assert.equal(ran, 1, 'the handler must not run again');
  assert.equal(second.repeated, true);
  assert.match(second.text, /failed the same way each time/);
  assert.match(second.text, /Change the arguments/);
});

test('a repeated SUCCESSFUL read is served from the ledger and says so', async () => {
  // decks x4 and battle_logs x4 within one turn, identical results each time.
  const ledger = new CallLedger();
  let ran = 0;
  const exec = async () => {
    ran += 1;
    return { text: "Hide 'n' Sneak (Dhelmise)", failed: false };
  };
  const key = callKey('decks', { deck_id: 'x' });

  await ledger.share(key, exec);
  const again = await ledger.share(key, exec);
  assert.equal(ran, 1);
  assert.equal(again.repeated, true);
  assert.match(again.text, /this is the first result again/);
  // The answer itself is still there — the note is an addition, not a
  // replacement. A suppressed repeat that lost the data would be worse than
  // the repeat.
  assert.match(again.text, /Hide 'n' Sneak/);
});

test('CONCURRENT identical calls share one execution — the parallel case', async () => {
  // This is the case a results-only cache misses entirely. Five identical
  // `set_progress('none')` calls arrived back to back in the record, issued in
  // the same step, before any of them had finished.
  const ledger = new CallLedger();
  let ran = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const exec = async () => {
    ran += 1;
    await gate;
    return { text: 'the answer', failed: false };
  };
  const key = callKey('set_progress', { set_id: 'none' });

  const all = Promise.all([
    ledger.share(key, exec),
    ledger.share(key, exec),
    ledger.share(key, exec),
    ledger.share(key, exec),
    ledger.share(key, exec),
  ]);
  release!();
  const results = await all;

  assert.equal(ran, 1, 'five concurrent identical calls must run the handler once');
  assert.equal(results.filter((r) => !r.repeated).length, 1);
  assert.equal(results.filter((r) => r.repeated).length, 4);
  for (const r of results) assert.match(r.text, /the answer/);
});

test('a write invalidates everything, so a later read is genuinely re-run', async () => {
  const ledger = new CallLedger();
  let ran = 0;
  const exec = async () => {
    ran += 1;
    return { text: `summary ${ran}`, failed: false };
  };
  const key = callKey('collection_summary', {});

  await ledger.share(key, exec);
  assert.equal(ran, 1);

  // …a write happens…
  ledger.invalidate();

  const after = await ledger.share(key, exec);
  assert.equal(ran, 2, 'a read after a write must not be served from before it');
  assert.equal(after.repeated, false);
  assert.equal(after.text, 'summary 2');
});

test('a rejection is not remembered — the next identical call gets a real attempt', async () => {
  // A stored rejected promise would make every later identical call reject too,
  // including one made after whatever caused it had cleared.
  const ledger = new CallLedger();
  let ran = 0;
  const exec = async () => {
    ran += 1;
    if (ran === 1) throw new Error('transient');
    return { text: 'fine', failed: false };
  };
  const key = callKey('decks', {});

  await assert.rejects(() => ledger.share(key, exec), /transient/);
  const second = await ledger.share(key, exec);
  assert.equal(ran, 2);
  assert.equal(second.repeated, false);
  assert.equal(second.text, 'fine');
});

test('the ledger is bounded', async () => {
  const ledger = new CallLedger();
  for (let i = 0; i < 300; i++) {
    await ledger.share(callKey('t', { i }), async () => ({ text: String(i), failed: false }));
  }
  assert.ok(ledger.size <= 128, `expected <= 128 entries, got ${ledger.size}`);
});

test('two ledgers do not see each other — one per request, never module state', async () => {
  const a = new CallLedger();
  const b = new CallLedger();
  let ran = 0;
  const exec = async () => {
    ran += 1;
    return { text: 'x', failed: false };
  };
  const key = callKey('collection_summary', {});
  await a.share(key, exec);
  const other = await b.share(key, exec);
  assert.equal(ran, 2, "a second request's ledger must start empty");
  assert.equal(other.repeated, false);
});
