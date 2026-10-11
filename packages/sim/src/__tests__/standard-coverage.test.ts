/**
 * Coverage gate: every Standard printing in the frame snapshot is either scripted or vanilla.
 *
 * "Standard" = the regulation marks in apps/api/src/deck/data/formats.json (standard.legal_marks), read here, so a
 * rotation needs no edit to this test. A failure lists the cards that play wrong (no script) and says how to fix it.
 * This sees only frames already in the snapshot: after a new set releases, run
 * `node --import tsx scripts/sync-frames.ts` first so its printings are in it (packages/sim/CARDS.md, "New set").
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FRAMES } from '../cards/frames-all.js';
import { standardGap } from '../maintenance/gap.js';

const FORMATS = new URL('../../../../apps/api/src/deck/data/formats.json', import.meta.url);
const marks = (JSON.parse(readFileSync(FORMATS, 'utf8')) as { formats: { standard: { legal_marks: string[] } } }).formats.standard.legal_marks;

test('Standard marks come from formats.json', () => {
  assert.ok(marks.length > 0 && marks.every((m) => /^[A-Z]$/.test(m)), `unexpected legal_marks ${JSON.stringify(marks)}`);
});

test('every Standard printing in the frame snapshot is scripted or vanilla', () => {
  const gap = standardGap(Object.values(FRAMES), marks);
  assert.ok(gap.printings > 1000, `only ${gap.printings} Standard printings (marks ${marks.join('/')}) in the snapshot: is the snapshot or formats.json wrong?`);
  const list = gap.todo.map((t) => `${t.frame.cardId} ${t.frame.name} [${t.frame.category}${t.printings.length > 1 ? `, ${t.printings.length} printings` : ''}]`);
  assert.deepEqual(
    list,
    [],
    `${gap.todo.length} Standard card text(s) have no script (marks ${marks.join('/')}). Script them (packages/sim/CARDS.md: "New set, rotation, FAQ update" then "The loop"):\n  ${list.join('\n  ')}`,
  );
});

test('the gate counts a missing script', () => {
  // Disabling nothing here: prove standardGap itself reports an unscripted card by handing it one no script matches.
  const f = Object.values(FRAMES).find((x) => x.category === 'Pokemon' && x.regulationMark && marks.includes(x.regulationMark) && (x.attacks ?? []).some((a) => a.effect))!;
  const unscripted = { ...f, cardId: 'zz99-001', name: 'Zzyzx Test Card' };
  const gap = standardGap([unscripted], marks);
  assert.equal(gap.todo.length, 1);
  assert.equal(gap.todo[0]!.frame.cardId, 'zz99-001');
});
