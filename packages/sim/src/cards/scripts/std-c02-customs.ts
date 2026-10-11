/**
 * Bespoke effects for the "std-c02" batch (std-c02.ts). Names are prefixed `c02.` so batches can't collide.
 * Each is exercised by a card test in src/__tests__/cards-std-c02.test.ts.
 */
import { devolve } from '../../evolve.js';
import { registerCustom } from '../../customs.js';
import { endGame } from '../../flow.js';
import { emit, findSlot, leavePrizeZone, opp, removeFrom } from '../../state.js';
import type { Player, Val } from '../../types.js';

function slotIdOf(v: Val | undefined): number | undefined {
  return Array.isArray(v) ? v[0] : typeof v === 'number' ? v : undefined;
}

/**
 * Lt. Surge's Bargain: "If yes, each player takes a Prize card."
 * args: { who }: 'both' (default) = the controller, then the opponent; 'self'; 'opp'. A Prize card is taken from the
 * face-down pile and goes to its taker's hand. A player with no Prize cards left takes none. Taking the last one wins
 * the game (both players doing so at once is a draw), which the Knock Out step would otherwise not notice.
 */
registerCustom('c02.takePrize', (env, s, f, args) => {
  const who = String(args.who ?? 'both');
  const takers: Player[] = who === 'self' ? [f.player] : who === 'opp' ? [opp(f.player)] : [f.player, opp(f.player)];
  for (const p of takers) {
    const ps = s.p[p];
    const c = ps.prizes.pop();
    if (c === undefined) continue;
    ps.hand.push(c);
    removeFrom(ps.revealed, c); // taken face down, unless it was turned face up: then both players know it
    if (leavePrizeZone(ps, c)) ps.revealed.push(c);
    ps.prizesTaken++;
    emit(env, { type: 'prize_take', player: p, n: 1 });
  }
  const done = ([0, 1] as Player[]).filter((p) => s.p[p].prizes.length === 0 && s.p[p].prizesTaken > 0);
  if (done.length === 2) endGame(env, s, null, 'simultaneous win');
  else if (done.length === 1) endGame(env, s, done[0] as Player, 'prizes');
  return 'next';
});

/** Pokémon Center Lady: "...and it recovers from all Special Conditions." args: { slot } (variable holding the Pokémon). */
registerCustom('c02.cureConditions', (_env, s, f, args) => {
  const id = slotIdOf(f.vars[String(args.slot ?? 't')]);
  const loc = id === undefined ? null : findSlot(s, id);
  if (loc) loc.slot.cond = 0;
  return 'next';
});

/**
 * Wally's Compassion: "put all Energy attached to that Pokémon into your hand." args: { slot }.
 * Only the Energy cards go (Tools and the Pokémon stay); they are not discarded.
 */
registerCustom('c02.energyAllToHand', (_env, s, f, args) => {
  const id = slotIdOf(f.vars[String(args.slot ?? 't')]);
  const loc = id === undefined ? null : findSlot(s, id);
  if (!loc) return 'next';
  s.p[loc.owner].hand.push(...loc.slot.energy.splice(0));
  return 'next';
});

/**
 * Strange Timepiece: "Devolve 1 of your evolved {P} Pokémon by putting any number of Evolution cards on it into your
 * hand. (That Pokémon can't evolve this turn.)"
 * args: { slot, n }: the Pokémon, and a variable holding how many Evolution cards (from the top of its stack down;
 * clamped to the Evolution cards it has). Those cards go to the controller's hand, face up (both players saw them
 * leave play). As with evolving, the Pokémon recovers from all Special Conditions and loses the effects of attacks on
 * it (the Claydol precedent, `devolveDefender`). It is marked as having evolved this turn, so it can't evolve again.
 */
registerCustom('c02.devolve', (env, s, f, args) => {
  const id = slotIdOf(f.vars[String(args.slot ?? 't')]);
  const loc = id === undefined ? null : findSlot(s, id);
  if (!loc || loc.slot.cards.length < 2) return 'next';
  const sl = loc.slot;
  const wanted = typeof f.vars[String(args.n)] === 'number' ? (f.vars[String(args.n)] as number) : 1;
  const n = Math.max(1, Math.min(wanted, sl.cards.length - 1));
  const removed = devolve(env, s, sl, n, true); // "That Pokémon can't evolve this turn"
  const ps = s.p[loc.owner];
  ps.hand.push(...removed);
  ps.revealed.push(...removed);
  return 'next';
});
