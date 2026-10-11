/**
 * Bespoke effects for the rulings-audit lane "r07" (src/__tests__/rulings-r07.test.ts). Names are prefixed `rul07.`.
 */
import { def, ensureCode } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { evalCond } from '../../eval.js';

function idsOf(v: unknown): number[] {
  return Array.isArray(v) ? (v as number[]) : typeof v === 'number' ? [v] : [];
}

/**
 * A copy of a Supporter's play program in which every "up to" choice of cards (a `chooseCards` step with a fixed lower
 * bound of 1 or more under a larger fixed upper bound) may be left at none. A Trainer's "up to X" is 1 to X when it is
 * played (TPCi 2026-02-19); when the same effect is used through an attack it is 0 to X again (April 2026 Rulebook).
 * Choices of an exact count (equal bounds) and choices whose bounds are computed are left as they are.
 */
function relaxUpTo<T>(program: T): T {
  if (Array.isArray(program)) return program.map((x) => relaxUpTo(x)) as unknown as T;
  if (program && typeof program === 'object') {
    const o = program as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = relaxUpTo(v);
    if (o.op === 'chooseCards' && typeof o.min === 'number' && typeof o.max === 'number' && o.min >= 1 && o.max > o.min) out.min = 0;
    return out as T;
  }
  return program;
}

/**
 * Ninetales, Supernatural Shapeshifter: "... if that card is a Supporter card, use the effect of that card as the effect of this attack."
 * Like c01.useSupporterEffect (the Supporter is not played, so it doesn't count as the turn's Supporter and can't be declined), but
 * the Supporter's "up to" choices of cards may be left at none (Compendium #2376: Eri used this way may discard zero Item cards).
 * args: { card } -- the variable holding the Supporter card.
 */
registerCustom('rul07.useSupporterEffect', (env, s, f, args) => {
  const card = idsOf(f.vars[String(args.card ?? 'x')])[0];
  if (card === undefined) return 'next';
  const d = def(env.ctx, card);
  if (d.kind !== 'trainer' || d.ttype !== 'supporter' || !d.playCode || !d.script?.play) return 'next';
  if (d.playable && !evalCond(env, s, { player: f.player, slot: 0, vars: { __src: card } }, d.playable)) return 'next';
  const key = ensureCode(env.ctx, `rul07#attackUse:${d.idx}`, relaxUpTo(d.script.play));
  f.pc++; // resume after this op when the Supporter's frame finishes
  s.stack.push({ code: key, pc: 0, vars: {}, player: f.player, src: card, slot: 0, kind: 'trainer' });
  return 'wait';
});
