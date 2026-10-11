/**
 * Bespoke effects for lane "trevenant" cards (see customs.ts for the contract).
 * Names are prefixed `trevenant.` so lanes can't collide. Each is exercised by a
 * card test in src/__tests__/cards-meta-trevenant.test.ts.
 */
import { registerCustom, registerCustomCond } from '../../customs.js';
import { cardMatches } from '../../eval.js';
import { emit, findSlot } from '../../state.js';
import type { Frame, GameState } from '../../types.js';

function slotIds(f: Frame, key: string): number[] {
  const v = f.vars[key];
  return Array.isArray(v) ? v : typeof v === 'number' ? [v] : [];
}

/**
 * Hop's Trevenant, Horrifying Revenge: "If any of your Hop's Pokémon were Knocked Out by damage from an attack during
 * your opponent's last turn". Reads the controller's `attackKoTurn`/`attackKoCards` (flow.ts knockOut records them).
 */
registerCustomCond('trevenant.hopsKoByAttackLastTurn', (env, s: GameState, ec) => {
  const ps = s.p[ec.player];
  if (ps.attackKoTurn !== s.turn - 1) return false;
  return (ps.attackKoCards ?? []).some((c) => cardMatches(env, c, { cat: 'pokemon', nameIncludes: "Hop's" }));
});

/**
 * Ruffian: "Discard a Pokémon Tool ... from 1 of your opponent's Pokémon." args: { slot } — the variable holding the
 * chosen Pokémon. Discards the first Tool attached to it (the rules allow one Tool per Pokémon), to its owner's discard pile.
 */
registerCustom('trevenant.discardToolFrom', (env, s, f, args) => {
  const id = slotIds(f, String(args.slot ?? 't'))[0];
  const loc = id === undefined ? null : findSlot(s, id);
  if (!loc || !loc.slot.tools.length) return 'next';
  const c = loc.slot.tools.shift() as number;
  const owner = env.ctx.owner[c] as 0 | 1;
  s.p[owner].discard.push(c);
  emit(env, { type: 'discard', player: owner, cards: [c] });
  return 'next';
});
