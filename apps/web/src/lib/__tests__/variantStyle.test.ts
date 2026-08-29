import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seriesColors, variantMeta } from '../variantStyle.js';

/**
 * `seriesColors` exists because the chip palette and a chart palette answer
 * different questions.
 *
 * A chip is a filled block with its label inside it, so every special-tier
 * printing sharing one grey is fine — the label disambiguates. A chart line is
 * a 2.5px stroke, and three identical greys are one line as far as the reader
 * is concerned. Found by looking at `ex9-55`, which has one standard printing
 * and three specials.
 */

const V = (kind: string, tier: string | null) => ({ kind, tier });

test('the standard tiers keep their system colour — they are already distinct', () => {
  const out = seriesColors([V('normal', 'standard'), V('reverse', 'standard'), V('holo', 'standard')]);
  assert.deepEqual(out, [
    variantMeta(V('normal', 'standard')).color,
    variantMeta(V('reverse', 'standard')).color,
    variantMeta(V('holo', 'standard')).color,
  ]);
  assert.equal(new Set(out).size, 3, 'the three standard tiers must stay three colours');
});

test('special printings that would collide get distinct colours', () => {
  // The real shape of ex9-55: one standard, three specials that all map to the
  // single `--color-variant-other` token.
  const out = seriesColors([
    V('normal', 'standard'),
    V('reverse-stamp-set-logo', 'special'),
    V('normal-stamp-curran-hill', 'special'),
    V('holo-stamp-set-logo', 'special'),
  ]);
  assert.equal(new Set(out).size, 4, `four printings must be four colours, got ${out.join(', ')}`);
});

test('the first special keeps the system grey; only the collisions move', () => {
  const out = seriesColors([V('reverse-stamp-set-logo', 'special'), V('holo-stamp-set-logo', 'special')]);
  assert.equal(out[0], variantMeta(V('x', 'special')).color, 'the first special is unchanged');
  assert.notEqual(out[1], out[0]);
});

test('substituted hues avoid cyan and pink, which mean something', () => {
  // A substitute that lands on cyan would read as "this is the reverse holo".
  const many = Array.from({ length: 6 }, () => V('stamp', 'special'));
  for (const c of seriesColors(many).slice(1)) {
    const hue = Number(/hsl\((\d+)/.exec(c)?.[1]);
    assert.ok(Number.isFinite(hue), `expected an hsl() substitute, got ${c}`);
    assert.ok(hue < 170 || hue > 210, `hue ${hue} is too close to the reverse-holo cyan`);
    assert.ok(hue < 310 || hue > 350, `hue ${hue} is too close to the holofoil pink`);
  }
});

test('an empty list is an empty list', () => {
  assert.deepEqual(seriesColors([]), []);
});
