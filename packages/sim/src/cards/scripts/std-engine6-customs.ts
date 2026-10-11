/**
 * Bespoke effects for the "std-engine6" batch (std-engine6.ts). Names are prefixed `engine6.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-engine6.test.ts.
 */
import { registerCustom } from '../../customs.js';
import { opp, removeFrom } from '../../state.js';
import type { GameState } from '../../types.js';
import './std-seed2-customs.js'; // seed2.randomOppHandCard (a random card from the opponent's hand)

function askYesNo(s: GameState, player: 0 | 1, prompt: string): 'wait' {
  s.pending = {
    decision: { player, kind: 'yesno', prompt, min: 1, max: 1, labels: ['Yes', 'No'] },
    resume: { k: 'frame', as: '__a', mode: 'bool' },
  };
  return 'wait';
}

/**
 * Team Rocket's Bother-Bot, after the Prize card was turned face up and a random card was chosen from the opponent's hand
 * (variables named by `args.prize` and `args.card`): "Your opponent reveals that card. You may have your opponent switch those
 * cards."
 *
 * The hand card is revealed (it stays known to the player while it is in that hand). If both cards exist the controller is asked;
 * on yes the two change places: the hand card takes the Prize card's position, face up (the Prize position was turned up, and the
 * card that is in it is known to both players), and the former Prize card is in the hand, revealed. With no face-down Prize card
 * or an empty hand there is nothing to switch and no question (TPCi Rules Team 2025-05-29, ruling 2167: you still get to look).
 */
registerCustom('engine6.revealAndSwitch', (_env, s, f, args, answer) => {
  const o = opp(f.player);
  const ps = s.p[o];
  const prize = (f.vars[String(args.prize ?? 'up')] as number[] | undefined)?.[0];
  const card = (f.vars[String(args.card ?? 'pick')] as number[] | undefined)?.[0];
  if (card === undefined || !ps.hand.includes(card)) return 'next';
  if (!ps.revealed.includes(card)) ps.revealed.push(card);
  if (prize === undefined || !ps.prizes.includes(prize)) return 'next';
  if (answer === undefined) return askYesNo(s, f.player, 'Have your opponent switch those cards?');
  if (answer !== true) return 'next';
  ps.prizes[ps.prizes.indexOf(prize)] = card;
  ps.hand[ps.hand.indexOf(card)] = prize;
  removeFrom(ps.revealed, card);
  ps.revealed.push(prize);
  ps.prizesUp = [...(ps.prizesUp ?? []).filter((c) => c !== prize), card];
  return 'next';
});
