/**
 * The ad-hoc screen schema, and the property that matters most about it:
 * a model cannot express markup through it, because there is nowhere to put any.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  BLOCK_KINDS,
  LEAF_BLOCK_KINDS,
  MAX_BLOCKS,
  SCREEN_CARD_BUDGET,
  sanitizeScreen,
  screenSchema,
  validateBlock,
  type Screen,
} from '../screens.js';

test('there is no field a model could smuggle markup through', () => {
  // The guarantee is structural, not a filter: every string field is prose, a
  // catalog id, or a nested block of the same closed shape, and none of them is
  // ever interpreted as markup by the renderer. If a future field is added that
  // IS interpreted, this test should be the thing that makes someone think
  // twice. `left`/`right` were added deliberately and are not strings at all.
  const shape = Object.keys(screenSchema.shape.blocks.element.shape).sort();
  assert.deepEqual(shape, [
    'cards', 'columns', 'editable', 'kind', 'left', 'percent',
    'quantities', 'right', 'rows', 'text', 'tone', 'value',
  ]);
});

test('the leaf palette is the full palette minus the one kind that nests', () => {
  // `BLOCK_KINDS` is spelled out rather than derived, so that the browser-side
  // mirror test can read it as text. This is the assertion that pays for that.
  assert.deepEqual([...BLOCK_KINDS], [...LEAF_BLOCK_KINDS, 'group']);
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

test('quantities may stop early but may not overrun', () => {
  // Short is normalised by `sanitizeScreen` (see below) and so is valid here:
  // omitting the array entirely already means every card is a single.
  assert.equal(validateBlock({ kind: 'cardGrid', cards: ['a', 'b'], quantities: [1] }), null);
  assert.equal(validateBlock({ kind: 'cardGrid', cards: ['a', 'b'], quantities: [1, 2] }), null);
  assert.match(
    validateBlock({ kind: 'cardGrid', cards: ['a'], quantities: [1, 2] })!,
    /more quantities than cards/,
  );
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

test('a screen must have at least one block and at most MAX_BLOCKS', () => {
  assert.equal(screenSchema.safeParse({ title: 'x', blocks: [] }).success, false);
  const atCap = Array(MAX_BLOCKS).fill({ kind: 'text', text: 'a' });
  assert.equal(screenSchema.safeParse({ title: 'x', blocks: atCap }).success, true);
  const overCap = Array(MAX_BLOCKS + 1).fill({ kind: 'text', text: 'a' });
  assert.equal(screenSchema.safeParse({ title: 'x', blocks: overCap }).success, false);
});

test('a short quantities array is filled in rather than rejected', () => {
  // Omitting `quantities` entirely already means "every card is a single", so
  // stopping early has exactly the same reading. This was the most common
  // rejection in practice — models list quantities only where they differ.
  const { screen, dropped } = sanitizeScreen({
    title: 'Haul',
    blocks: [{ kind: 'cardGrid', cards: ['a', 'b', 'c', 'd'], quantities: [1, 1, 2] }],
  })
  assert.deepEqual(dropped, [])
  assert.deepEqual(screen.blocks[0]!.quantities, [1, 1, 2, 1])
})

test('more quantities than cards is still rejected', () => {
  const { screen, dropped } = sanitizeScreen({
    title: 'Haul',
    blocks: [{ kind: 'cardGrid', cards: ['a'], quantities: [1, 2] }],
  })
  assert.equal(screen.blocks.length, 0)
  assert.match(dropped[0]!, /more quantities than cards/)
})

test('normalising does not rescue a genuinely bad quantity', () => {
  const { screen, dropped } = sanitizeScreen({
    title: 'Haul',
    blocks: [{ kind: 'cardGrid', cards: ['a', 'b'], quantities: [0] }],
  })
  assert.equal(screen.blocks.length, 0, 'a zero is still not a card you own')
  assert.match(dropped[0]!, /below 1/)
})

// ── table ──────────────────────────────────────────────────────
// `statTile` was the only numeric primitive, and eight of them stacked is a
// worse answer than four rows of two columns. Everything below rejects; nothing
// below pads, because a figure under the wrong heading is worse than no table.

test('a table needs headers, rows, and one cell per column', () => {
  assert.equal(
    validateBlock({
      kind: 'table',
      text: 'Value by set',
      columns: ['Set', 'Owned', 'Value'],
      rows: [['Mega Evolution', '70', '$412'], ['Prismatic', '18', '$96']],
    }),
    null,
  );
  assert.match(validateBlock({ kind: 'table', rows: [['a', 'b']] })!, /needs columns/);
  assert.match(validateBlock({ kind: 'table', columns: ['a', 'b'] })!, /at least one row/);
});

test('a short table row is refused rather than padded out', () => {
  // The case that most looks like it deserves the `quantities` treatment. It
  // does not: padding means inventing which column the missing figure belongs
  // to, and there is no reading of "Charizard | 4" against three columns that
  // is not a guess.
  const bad = validateBlock({
    kind: 'table',
    columns: ['Card', 'Owned', 'Value'],
    rows: [['Charizard', '4', '$300'], ['Pikachu', '2']],
  });
  assert.match(bad!, /row 2 has 2 cells but the table has 3 columns/);
});

test('a table row with too many cells is refused too', () => {
  const bad = validateBlock({
    kind: 'table',
    columns: ['Card', 'Owned'],
    rows: [['Charizard', '4', 'extra']],
  });
  assert.match(bad!, /row 1 has 3 cells/);
});

test('the table caps live in the schema, and they reject', () => {
  const fiveColumns = {
    kind: 'table',
    columns: ['a', 'b', 'c', 'd', 'e'],
    rows: [['1', '2', '3', '4', '5']],
  };
  assert.equal(screenSchema.safeParse({ title: 'x', blocks: [fiveColumns] }).success, false);
  const elevenRows = { kind: 'table', columns: ['a', 'b'], rows: Array(11).fill(['1', '2']) };
  assert.equal(screenSchema.safeParse({ title: 'x', blocks: [elevenRows] }).success, false);
});

// ── group ──────────────────────────────────────────────────────
// Two columns, one level deep, and the depth limit is the interesting part.

test('a group needs both columns', () => {
  const both = validateBlock({
    kind: 'group',
    text: 'Before and after',
    left: [{ kind: 'statTile', text: 'Owned', value: '70' }],
    right: [{ kind: 'statTile', text: 'Needed', value: '50' }],
  });
  assert.equal(both, null);
  assert.match(
    validateBlock({ kind: 'group', left: [{ kind: 'text', text: 'alone' }] })!,
    /both columns/,
  );
  assert.match(validateBlock({ kind: 'group' })!, /both columns/);
});

test('a bad block inside a group takes the group down, and says where', () => {
  // Not the screen, and not silently the one column — a group is one block, so
  // the reader either sees the comparison or sees a reason it is missing.
  const bad = validateBlock({
    kind: 'group',
    left: [{ kind: 'text', text: 'fine' }],
    right: [{ kind: 'text', text: 'fine' }, { kind: 'statTile', text: 'no value' }],
  });
  assert.match(bad!, /group\.right\[1\]: statTile needs both/);
});

test('a group cannot contain another group — by schema, and again in code', () => {
  // The schema types a column as a LEAF block, so this never parses…
  const nested = {
    title: 'x',
    blocks: [
      {
        kind: 'group',
        left: [
          {
            kind: 'group',
            left: [{ kind: 'text', text: 'a' }],
            right: [{ kind: 'text', text: 'b' }],
          },
        ],
        right: [{ kind: 'text', text: 'c' }],
      },
    ],
  };
  assert.equal(screenSchema.safeParse(nested).success, false);

  // …and `validateBlock` is exported and callable on objects that never went
  // through the schema, so it says so itself rather than trusting its caller.
  // A rule that holds at only one of its two entrances is not a rule.
  const bad = validateBlock(nested.blocks[0] as never);
  assert.match(bad!, /a group cannot contain another group/);
});

test('the one allowed clamp reaches into a group’s columns too', () => {
  // A grid inside a group is the same grid. Applying the short-`quantities`
  // rule at the top level and silently not one level in would reintroduce
  // exactly the inconsistency that rule was added to remove.
  const { screen, dropped } = sanitizeScreen({
    title: 'Comparison',
    blocks: [
      {
        kind: 'group',
        left: [{ kind: 'cardGrid', cards: ['a', 'b', 'c'], quantities: [2] }],
        right: [{ kind: 'text', text: 'the other side' }],
      },
    ],
  });
  assert.deepEqual(dropped, []);
  assert.deepEqual(screen.blocks[0]!.left![0]!.quantities, [2, 1, 1]);
});

test('the column cap rejects rather than dropping the extra blocks', () => {
  const fiveDeep = {
    title: 'x',
    blocks: [
      {
        kind: 'group',
        left: Array(5).fill({ kind: 'text', text: 'a' }),
        right: [{ kind: 'text', text: 'b' }],
      },
    ],
  };
  assert.equal(screenSchema.safeParse(fiveDeep).success, false);
});

// ── cardGrid caption ───────────────────────────────────────────

test('a cardGrid carries its caption in `text`, and does not require one', () => {
  // "Your five most valuable" is the half of the answer a grid cannot carry.
  // It goes in `text` because `text` already means "the label for this block"
  // everywhere else, and a second field meaning the same thing is a second
  // thing to be sure about.
  assert.equal(
    validateBlock({ kind: 'cardGrid', text: 'Your five most valuable', cards: ['a'] }),
    null,
  );
  assert.equal(validateBlock({ kind: 'cardGrid', cards: ['a'] }), null);
});

// ── the screen-wide card budget ────────────────────────────────

test('a screen may not show more cards than the budget, across every grid', () => {
  // Twelve blocks of 60 cards is 720 catalog lookups the browser makes to draw
  // one panel — a request storm one tool call can trigger. The per-grid cap
  // used to be the screen's cap because one grid was the only way to show
  // cards; raising the block cap is what made this a separate rule.
  const grid = (n: number) => ({
    kind: 'cardGrid' as const,
    cards: Array.from({ length: n }, (_, i) => 'c' + i),
  });
  const { screen, dropped } = sanitizeScreen({
    title: 'Everything',
    blocks: [grid(40), grid(20), grid(1)],
  });
  assert.equal(screen.blocks.length, 2, 'the first two fit exactly');
  assert.equal(dropped.length, 1);
  assert.match(dropped[0]!, new RegExp('over ' + SCREEN_CARD_BUDGET));
});

test('the budget counts cards nested inside a group', () => {
  const many = Array.from({ length: 55 }, (_, i) => 'c' + i);
  const { screen, dropped } = sanitizeScreen({
    title: 'Comparison',
    blocks: [
      {
        kind: 'group',
        left: [{ kind: 'cardGrid', cards: many }],
        right: [{ kind: 'cardGrid', cards: ['x', 'y', 'z', 'w', 'v', 'u'] }],
      },
    ],
  });
  assert.equal(screen.blocks.length, 0, '55 + 6 is over the budget');
  assert.match(dropped[0]!, /over 60/);
});

test('a grid dropped for the budget does not take the rest of the screen', () => {
  const { screen, dropped } = sanitizeScreen({
    title: 'Everything',
    blocks: [
      { kind: 'cardGrid', cards: Array.from({ length: 60 }, (_, i) => 'c' + i) },
      { kind: 'cardGrid', cards: ['one more'] },
      { kind: 'text', text: 'and the words still arrive' },
    ],
  });
  assert.equal(screen.blocks.length, 2);
  assert.equal(screen.blocks[1]!.kind, 'text');
  assert.equal(dropped.length, 1);
});

test('every kind in BLOCK_KINDS has a validateBlock case that can reject', () => {
  // A kind the schema accepts but `validateBlock` has no case for falls through
  // to `default`, which reports it as unknown — so the model is told a kind it
  // was offered does not exist. This catches that the moment a kind is added.
  for (const kind of BLOCK_KINDS) {
    const reason = validateBlock({ kind } as never);
    assert.ok(reason, kind + ' with no props should be refused, not accepted');
    assert.doesNotMatch(
      reason,
      /^unknown block/,
      kind + ' is in BLOCK_KINDS but validateBlock has no case for it',
    );
  }
});
