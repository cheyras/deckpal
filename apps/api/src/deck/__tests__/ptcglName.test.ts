/**
 * The reader's PTCG Live name (migration 086, deck/ptcglName.ts): learned after three games under one name, never
 * overwritten, and used only for logs it actually appears in.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEARN_AFTER, chooseLearnedName, learnPtcglName, storedNameFor } from '../ptcglName.js';

test('three games under one name, more than any other, are what it takes', () => {
  assert.equal(LEARN_AFTER, 3);
  assert.equal(chooseLearnedName([]), null);
  assert.equal(chooseLearnedName([{ name: 'cheyras', n: 2 }]), null, 'two games are not enough');
  assert.equal(chooseLearnedName([{ name: 'cheyras', n: 3 }]), 'cheyras');
  assert.equal(chooseLearnedName([{ name: 'cheyras', n: 5 }, { name: 'alt', n: 2 }]), 'cheyras');
  assert.equal(chooseLearnedName([{ name: 'cheyras', n: 4 }, { name: 'alt', n: 4 }]), null, 'two accounts played equally: never guess');
  assert.equal(chooseLearnedName([{ name: '  ', n: 9 }]), null);
});

test('the stored name is used only for a log it plays in', () => {
  const log = "Setup\ncheyras drew 7 cards for the opening hand.\n\ncheyras's Turn\ncheyras drew a card.\n";
  assert.equal(storedNameFor(log, 'cheyras'), 'cheyras');
  assert.equal(storedNameFor(log, 'someone-else'), undefined, 'a game from another account is parsed as before');
  assert.equal(storedNameFor(log, null), undefined);
  assert.equal(storedNameFor(null, 'cheyras'), undefined);
});

/** A fake connection: what `user_settings` holds, and the game counts battle_log would group. */
function fakeDb(state: { name: string | null; counts: Array<{ name: string; n: number }> }) {
  const sql: string[] = [];
  const db = {
    async query(text: string, params: unknown[] = []) {
      sql.push(text);
      if (/^SELECT ptcgl_name FROM user_settings/.test(text.trim())) return { rows: [{ ptcgl_name: state.name }], rowCount: 1 };
      if (/FROM battle_log/.test(text)) return { rows: state.counts, rowCount: state.counts.length };
      if (/^UPDATE user_settings/.test(text.trim())) {
        // The guard in the statement itself: a name that is already there is never replaced.
        assert.match(text, /ptcgl_name IS NULL/);
        assert.match(text, /ptcgl_name_source = 'auto'/);
        if (state.name !== null) return { rows: [], rowCount: 0 };
        state.name = String(params[1]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error('unexpected SQL: ' + text);
    },
  };
  return { db: db as never, sql, state };
}

test('learnPtcglName fills an empty name once three games agree', async () => {
  const f = fakeDb({ name: null, counts: [{ name: 'cheyras', n: 3 }] });
  assert.equal(await learnPtcglName(f.db, 'user-1'), 'cheyras');
  assert.equal(f.state.name, 'cheyras');
  assert.ok(f.sql.some((s) => /origin = 'ptcgl'/.test(s)), 'only PTCG Live games count');
});

test('learnPtcglName never touches a name that is already set, typed or learned', async () => {
  const f = fakeDb({ name: 'MyRealName', counts: [{ name: 'cheyras', n: 10 }] });
  assert.equal(await learnPtcglName(f.db, 'user-1'), null);
  assert.equal(f.state.name, 'MyRealName');
  assert.ok(!f.sql.some((s) => /^UPDATE/.test(s.trim())), 'no UPDATE is even attempted');
});

test('learnPtcglName waits for the third game, and for a clear winner', async () => {
  assert.equal(await learnPtcglName(fakeDb({ name: null, counts: [{ name: 'cheyras', n: 2 }] }).db, 'u'), null);
  assert.equal(await learnPtcglName(fakeDb({ name: null, counts: [{ name: 'a', n: 3 }, { name: 'b', n: 3 }] }).db, 'u'), null);
});
