/**
 * Bespoke effects for lane "charizard" (meta-charizard.ts). Each is registered by
 * name and called as `{ op: 'custom', fn, args }`; each is tested through its card
 * in src/__tests__/cards-meta-charizard.test.ts.
 */
import { def } from '../../context.js';
import { registerCustom } from '../../customs.js';
import { cardMatches } from '../../eval.js';
import { countersFixed, effectsPrevented, ownerOf, statics } from '../../query.js';
import { allSlots, emit, findSlot, opp, removeFrom, topCard } from '../../state.js';
import type { Decision, Frame, GameState, Player, Val } from '../../types.js';

function cardsOf(v: Val | undefined): number[] {
  return Array.isArray(v) ? v.slice() : typeof v === 'number' ? [v] : [];
}
function ask(s: GameState, d: Decision, mode: 'cards' | 'index'): 'wait' {
  s.pending = { decision: d, resume: { k: 'frame', as: '__a', mode } };
  return 'wait';
}
function slotVar(s: GameState, f: Frame, name: string) {
  const id = cardsOf(f.vars[name])[0];
  return id === undefined ? null : (findSlot(s, id)?.slot ?? null);
}

/**
 * Mega Charizard X ex, Inferno X: "Discard any amount of {R} Energy from among your Pokémon" — the controller
 * picks any number (0..all) of the Basic {R} Energy cards attached to their Pokémon; they go to the discard pile.
 * The count lands in `args.as` (default `n`).
 */
registerCustom('charizard.discardEnergyAmong', (env, s, f, args, answer) => {
  const as = String(args.as ?? 'n');
  const ps = s.p[f.player];
  const pool: number[] = [];
  const labels: string[] = [];
  for (const sl of allSlots(ps)) {
    for (const c of sl.energy) {
      if (!cardMatches(env, c, { energyType: String(args.type ?? 'Fire') as 'Fire' })) continue;
      pool.push(c);
      labels.push(`${def(env.ctx, c).name} on ${def(env.ctx, topCard(sl)).name}`);
    }
  }
  if (!pool.length) {
    f.vars[as] = 0;
    return 'next';
  }
  if (answer === undefined) {
    return ask(s, { player: f.player, kind: 'cards', prompt: 'Discard any amount of Energy', min: 0, max: pool.length, values: pool, labels }, 'cards');
  }
  const chosen = (answer as number[]).filter((c) => pool.includes(c));
  for (const c of chosen) {
    for (const sl of allSlots(ps)) if (removeFrom(sl.energy, c)) break;
    ps.discard.push(c);
  }
  if (chosen.length) emit(env, { type: 'discard', player: f.player, cards: chosen });
  f.vars[as] = chosen.length;
  return 'next';
});

/**
 * Ninetales, Nine-Tailed Transfer: "Move all damage counters from 1 of your Benched Pokémon to your opponent's
 * Active Pokémon." The Benched Pokémon is in var `args.from`. No move under a countersFixed lock; moving them onto
 * the opponent's Pokémon is an effect of the attack (prevented by e.g. Hide 'n' Sneak).
 */
registerCustom('charizard.moveAllCounters', (env, s, f, args) => {
  const from = slotVar(s, f, String(args.from ?? 'from'));
  const to = s.p[opp(f.player)].active;
  if (!from || !to || from === to) return 'next';
  const all = statics(env, s);
  if (countersFixed(env, s, ownerOf(s, from), all) || countersFixed(env, s, ownerOf(s, to), all)) return 'next';
  if (effectsPrevented(env, s, to, f.player, 'attack', all)) return 'next';
  const n = Math.floor(from.damage / 10);
  if (n <= 0) return 'next';
  from.damage -= n * 10;
  to.damage += n * 10;
  emit(env, { type: 'counters', player: ownerOf(s, to), slot: to.id, n });
  return 'next';
});

/**
 * Blowtorch: "Discard a Pokémon Tool or Special Energy card from 1 of your opponent's Pokémon, or discard a Stadium
 * in play." Options: every Tool and every non-Basic Energy on the opponent's Pokémon, and the Stadium in play;
 * the chosen card goes to its owner's discard pile.
 */
registerCustom('charizard.blowtorch', (env, s, f, _args, answer) => {
  const o = opp(f.player);
  const opts: { card: number; label: string; kind: 'tool' | 'energy' | 'stadium' }[] = [];
  for (const sl of allSlots(s.p[o])) {
    const on = def(env.ctx, topCard(sl)).name;
    for (const t of sl.tools) opts.push({ card: t, label: `Discard ${def(env.ctx, t).name} (Tool on ${on})`, kind: 'tool' });
    for (const e of sl.energy) {
      if (cardMatches(env, e, { basicEnergy: false })) opts.push({ card: e, label: `Discard ${def(env.ctx, e).name} (Energy on ${on})`, kind: 'energy' });
    }
  }
  if (s.stadium) opts.push({ card: s.stadium.card, label: `Discard ${def(env.ctx, s.stadium.card).name} (Stadium)`, kind: 'stadium' });
  if (!opts.length) return 'next';
  let i: number;
  if (answer !== undefined) i = (answer as number[])[0] ?? 0;
  else if (opts.length === 1) i = 0;
  else return ask(s, { player: f.player, kind: 'option', prompt: 'Blowtorch: discard which card?', min: 1, max: 1, labels: opts.map((x) => x.label) }, 'index');
  const pick = opts[i];
  if (!pick) return 'next';
  const owner = env.ctx.owner[pick.card] as Player;
  if (pick.kind === 'stadium') {
    s.stadium = null;
  } else {
    for (const sl of allSlots(s.p[o])) if (removeFrom(sl.tools, pick.card) || removeFrom(sl.energy, pick.card)) break;
  }
  s.p[owner].discard.push(pick.card);
  emit(env, { type: 'discard', player: owner, cards: [pick.card] });
  return 'next';
});
