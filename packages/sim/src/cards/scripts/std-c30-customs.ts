/**
 * Bespoke effects for the "std-c30" batch (std-c30.ts). Names are prefixed `c30.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c30.test.ts.
 */
import { registerCustom } from '../../customs.js';
import { endGame } from '../../flow.js';

/**
 * N's Sigilyph, Victory Symbol: "If you use this attack when you have exactly 1 Prize card remaining, you win this game."
 * (the winning half; the script guards it with the Prize count)
 * The controller wins at once. An attack that is already over the game (a Knock Out check ahead of it) is not affected.
 */
registerCustom('c30.winGame', (env, s, f) => {
  if (s.phase === 'over') return 'next';
  endGame(env, s, f.player, 'attack effect');
  return 'next';
});
