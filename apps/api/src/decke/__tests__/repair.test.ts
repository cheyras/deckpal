/**
 * Mending a tool call the schema rejected, without spending a step on it.
 *
 * The shape under test is `showScreen`'s: a panel with a title and blocks, each
 * with its own capped text — the schema on which the model spent five of twelve
 * steps shortening the wrong field.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RepairLog, clampStrings } from '../repair.js';

/** A cut-down `showScreen` schema, with the caps that actually bit. */
const SCREEN = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 80 },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          text: { type: 'string', maxLength: 280 },
        },
      },
    },
  },
};

test('the over-long field is found and named, not guessed at', () => {
  // THE MEASURED BUG. The title was fine; a block's text was over the cap; the
  // model shortened the title five times because the error said what broke and
  // not where.
  const input = {
    title: 'Your five most valuable cards',
    blocks: [
      { kind: 'text', text: 'short' },
      { kind: 'text', text: 'x'.repeat(400) },
    ],
  };
  const { value, repairs } = clampStrings(input, SCREEN);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0]!.path, 'blocks.1.text', 'the path is the whole point');
  assert.equal(repairs[0]!.was, 400);
  assert.equal(repairs[0]!.now, 280);

  const out = value as typeof input;
  assert.equal(out.blocks[1]!.text.length, 280);
  // And nothing else moved.
  assert.equal(out.title, 'Your five most valuable cards');
  assert.equal(out.blocks[0]!.text, 'short');
});

test('a valid call is not "repaired" — the caller must return null', () => {
  const { repairs } = clampStrings({ title: 'fine', blocks: [{ kind: 'text', text: 'ok' }] }, SCREEN);
  assert.equal(repairs.length, 0);
});

test('a string exactly at the limit is left alone', () => {
  const { repairs } = clampStrings({ title: 'x'.repeat(80) }, SCREEN);
  assert.equal(repairs.length, 0);
});

test('structure is never altered — no key added, removed or retyped', () => {
  const input = {
    title: 'y'.repeat(200),
    blocks: [{ kind: 'stat', text: 'z' }],
    extra: { kept: true, n: 3 },
  };
  const out = clampStrings(input, SCREEN).value as Record<string, unknown>;
  assert.deepEqual(Object.keys(out).sort(), ['blocks', 'extra', 'title']);
  assert.deepEqual(out.extra, { kept: true, n: 3 }, 'a field with no schema passes through untouched');
  assert.equal((out.blocks as { kind: string }[])[0]!.kind, 'stat');
});

test('several over-long fields are all reported', () => {
  const input = {
    title: 'a'.repeat(90),
    blocks: [{ kind: 'text', text: 'b'.repeat(300) }, { kind: 'text', text: 'c'.repeat(999) }],
  };
  const { repairs } = clampStrings(input, SCREEN);
  assert.deepEqual(
    repairs.map((r) => r.path),
    ['title', 'blocks.0.text', 'blocks.1.text'],
  );
});

test('no schema means no repair — never a guess', () => {
  const { repairs, value } = clampStrings({ anything: 'x'.repeat(9999) }, undefined);
  assert.equal(repairs.length, 0);
  assert.deepEqual(value, { anything: 'x'.repeat(9999) });
});

test('a tuple `items` schema is honoured positionally', () => {
  const tuple = {
    type: 'object',
    properties: {
      pair: { type: 'array', items: [{ type: 'string', maxLength: 3 }, { type: 'string', maxLength: 10 }] },
    },
  };
  const { value, repairs } = clampStrings({ pair: ['toolong', 'fine'] }, tuple);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0]!.path, 'pair.0');
  assert.deepEqual((value as { pair: string[] }).pair, ['too', 'fine']);
});

test('the trim is a HARD cut, so the reported length is the truth', () => {
  // An ellipsis would push it back over the limit by one character, and a word
  // boundary would make "trimmed to 280" a lie.
  const { value } = clampStrings({ title: 'w'.repeat(100) }, SCREEN);
  const title = (value as { title: string }).title;
  assert.equal(title.length, 80);
  assert.ok(!title.endsWith('…'));
});

// ── The log ─────────────────────────────────────────────────────────────────

test('the log names the field, and is consumed once', () => {
  const log = new RepairLog();
  log.note('call-1', { path: 'blocks.1.text', was: 400, now: 280 });
  const said = log.take('call-1');
  assert.equal(said.length, 1);
  assert.match(said[0]!, /blocks\.1\.text/);
  assert.match(said[0]!, /400 characters/);
  assert.match(said[0]!, /trimmed to fit/);
  // Taken once: a second tool call must not inherit the first one's report.
  assert.deepEqual(log.take('call-1'), []);
});

test('a call with no repairs reports nothing', () => {
  assert.deepEqual(new RepairLog().take('nope'), []);
});

test('repairs are keyed per call, never shared', () => {
  const log = new RepairLog();
  log.note('a', { path: 'title', was: 90, now: 80 });
  log.note('b', { path: 'blocks.0.text', was: 300, now: 280 });
  assert.match(log.take('a')[0]!, /title/);
  assert.match(log.take('b')[0]!, /blocks\.0\.text/);
});
