/**
 * The ad-hoc screen schema, and the property that matters most about it:
 * a model cannot express markup through it, because there is nowhere to put any.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sanitizeScreen, screenSchema, validateBlock, type Screen } from '../screens.js';

test('there is no field a model could smuggle markup through', () => {
  // The guarantee is structural, not a filter: every string field is prose or a
  // catalog id, and none of them is ever interpreted as markup by the renderer.
  // If a future field is added that IS interpreted, this test should be the
  // thing that makes someone think twice.
  const shape = Object.keys(screenSchema.shape.blocks.element.shape).sort();
  assert.deepEqual(shape, [
    'cards', 'editable', 'kind', 'percent', 'quantities', 'text', 'tone', 'value',
  ]);
});

test('a well-formed screen survives intact', () => {
  const screen: Screen = {
    title: 'Added to your collection',
    blocks: [
      { kind: 'heading', text: '6 cards from Prismatic Evolutions' },
      { kind: 'cardGrid', cards: ['sv8pt5-1', 'sv8pt5-2'], quantities: [1, 2], editable: true },
      { kind: 'statTile', text: 'Set progress', value: '38%', tone: 'good' },
    ],
  };
  const { screen: out, dropped } = sanitizeScreen(screen);
  assert.equal(dropped.length, 0);
  assert.equal(out.blocks.length, 3);
});

test('a bad block is dropped, not the whole screen', () => {
  // The screen is usually "here is what I just added". Losing one panel is a
  // shame; losing the confirmation that their cards went in is a bug report.
  const screen: Screen = {
    title: 'Added',
    blocks: [
      { kind: 'cardGrid', cards: ['a', 'b'] },
      { kind: 'statTile', text: 'no value here' },
      { kind: 'text', text: 'still fine' },
    ],
  };
  const { screen: out, dropped } = sanitizeScreen(screen);
  assert.equal(out.blocks.length, 2);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0]!, /statTile needs both/);
});

test('quantities must line up with cards', () => {
  assert.match(
    validateBlock({ kind: 'cardGrid', cards: ['a', 'b'], quantities: [1] })!,
    /line up/,
  );
  assert.equal(validateBlock({ kind: 'cardGrid', cards: ['a', 'b'], quantities: [1, 2] }), null);
});

test('a quantity below one is refused rather than clamped', () => {
  // Rejecting loudly matches the engine's own command surface: a model that is
  // silently corrected learns nothing and repeats it next turn.
  assert.match(validateBlock({ kind: 'cardGrid', cards: ['a'], quantities: [0] })!, /below 1/);
});

test('an unknown block kind is refused by the schema itself', () => {
  const parsed = screenSchema.safeParse({
    title: 'x',
    blocks: [{ kind: 'iframe', text: 'nope' }],
  });
  assert.equal(parsed.success, false);
});

test('a screen must have at least one block and at most eight', () => {
  assert.equal(screenSchema.safeParse({ title: 'x', blocks: [] }).success, false);
  const nine = Array(9).fill({ kind: 'text', text: 'a' });
  assert.equal(screenSchema.safeParse({ title: 'x', blocks: nine }).success, false);
});
