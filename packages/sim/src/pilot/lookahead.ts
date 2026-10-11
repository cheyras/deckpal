/**
 * Shared machinery for lookahead pilots: run a (determinised) state forward,
 * answering sub-decisions with the policy, until the next decision worth
 * branching on, the end of the turn, or the end of the game; and a canonical
 * hash of a position so transpositions merge.
 */
import type { Env } from '../context.js';
import { submit } from '../flow.js';
import type { Decision, GameState, Player, Slot } from '../types.js';
import { DEFAULT_PROFILE, policyChoose, type PolicyProfile } from './policy.js';
import { optionCount } from './random.js';

export { optionCount };

/** A small single-pick decision of `me` that lookahead may branch on (main, targets, promote, copied attack). */
export function branchable(d: Decision, me: Player, subs: boolean): boolean {
  if (d.player !== me) return false;
  if (d.kind === 'main') return true;
  if (!subs) return false;
  if (d.min !== 1 || d.max !== 1) return false;
  const n = optionCount(d);
  if (n < 2 || n > 6) return false;
  return d.kind === 'slots' || d.kind === 'promote' || d.kind === 'option';
}

export type Stop = 'leaf' | 'branch';

/**
 * Advance `s` (in place) with the policy until: the game ends or the turn
 * number changes ('leaf'), or `me` faces a branchable decision ('branch').
 */
export function settle(
  env: Env,
  s: GameState,
  me: Player,
  rootTurn: number,
  subs: boolean,
  profile: PolicyProfile = DEFAULT_PROFILE,
  guard = 400,
): Stop {
  for (let i = 0; i < guard; i++) {
    if (s.phase === 'over' || s.turn !== rootTurn) return 'leaf';
    const d = s.pending?.decision;
    if (!d) return 'leaf';
    if (branchable(d, me, subs)) return 'branch';
    submit(env, s, policyChoose(env, s, d, profile));
  }
  return 'leaf';
}

function slotKey(env: Env, sl: Slot): string {
  const cd = env.ctx.cardDef;
  const e = sl.energy.map((c) => cd[c] as number).sort((a, b) => a - b);
  return `${sl.cards.map((c) => cd[c]).join('.')}|${e.join('.')}|${sl.tools.map((c) => cd[c]).join('.')}|${sl.damage}|${sl.cond}|${sl.usedAbilities.join('.')}|${sl.enteredTurn}|${sl.evolvedTurn}`;
}

function defs(env: Env, cards: number[], sort: boolean): string {
  const cd = env.ctx.cardDef;
  const out = cards.map((c) => cd[c] as number);
  if (sort) out.sort((a, b) => a - b);
  return out.join('.');
}

/** Canonical key of a position: card instances by definition, Bench as a multiset (collisions only merge near-identical lines). */
export function hashState(env: Env, s: GameState): string {
  const parts: string[] = [String(s.turn), String(s.current), s.step, s.stadium ? `${env.ctx.cardDef[s.stadium.card]}@${s.stadium.owner}` : '-'];
  for (const ps of s.p) {
    parts.push(
      defs(env, ps.hand, true),
      // The deck by length only: its order follows from the RNG state (hashed below) and what left it.
      String(ps.deck.length),
      defs(env, ps.discard, true),
      String(ps.prizes.length),
      `${+ps.supporterPlayed}${+ps.stadiumPlayed}${+ps.energyAttached}${+ps.retreated}${+ps.stadiumAbilityUsed}${ps.globalAbilitiesUsed.join(',')}`,
      ps.active ? slotKey(env, ps.active) : '-',
      ps.bench.map((b) => slotKey(env, b)).sort().join('/'),
      String(ps.lost.length),
    );
  }
  parts.push(String(s.effects.length), s.rng.join(','));
  return parts.join(';');
}
