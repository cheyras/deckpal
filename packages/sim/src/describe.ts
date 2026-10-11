/** Human-readable option labels and a compact board view (debugging, the coach, an LLM player). */
import { def, type GameContext } from './context.js';
import { findSlot, topCard } from './state.js';
import type { Action, Decision, GameState, Slot } from './types.js';

function slotName(ctx: GameContext, s: GameState, id: number): string {
  const f = findSlot(s, id);
  if (!f) return `slot ${id}`;
  return `${def(ctx, topCard(f.slot)).name}${f.active ? ' (Active)' : ''}`;
}

export function describeAction(ctx: GameContext, s: GameState, a: Action): string {
  switch (a.t) {
    case 'end':
      return 'End turn';
    case 'bench':
      return `Bench ${def(ctx, a.card).name}`;
    case 'evolve':
      return `Evolve ${slotName(ctx, s, a.slot)} into ${def(ctx, a.card).name}`;
    case 'attach':
      return `Attach ${def(ctx, a.card).name} to ${slotName(ctx, s, a.slot)}`;
    case 'trainer':
      return `Play ${def(ctx, a.card).name}`;
    case 'tool':
      return `Attach ${def(ctx, a.card).name} to ${slotName(ctx, s, a.slot)}`;
    case 'retreat':
      return 'Retreat';
    case 'ability': {
      const f = findSlot(s, a.slot);
      const d = f ? def(ctx, topCard(f.slot)) : null;
      return `Use ${d?.abilities[a.idx]?.name ?? 'Ability'} (${slotName(ctx, s, a.slot)})`;
    }
    case 'stadium':
      return `Use the Stadium (${s.stadium ? def(ctx, s.stadium.card).name : '?'})`;
    case 'attack': {
      const act = s.p[s.current].active;
      return `Attack: ${act ? (def(ctx, topCard(act)).attacks[a.idx]?.name ?? '?') : '?'}`;
    }
  }
}

export function describeOptions(ctx: GameContext, s: GameState, d: Decision): string[] {
  if (d.actions) return d.actions.map((a) => describeAction(ctx, s, a));
  if (d.labels) return d.labels.slice();
  if (d.values) {
    if (d.kind === 'slots' || d.kind === 'promote') return d.values.map((id) => slotName(ctx, s, id));
    return d.values.map((c) => def(ctx, c).name);
  }
  return [];
}

function slotLine(ctx: GameContext, sl: Slot): string {
  const d = def(ctx, topCard(sl));
  const e = sl.energy.map((c) => def(ctx, c).name.replace(/ Energy$/, '')).join('+');
  const t = sl.tools.map((c) => def(ctx, c).name).join(',');
  return `${d.name} ${d.hp - sl.damage}/${d.hp}${e ? ` [${e}]` : ''}${t ? ` {${t}}` : ''}${sl.cond ? ` cond=${sl.cond}` : ''}`;
}

export function describeBoard(ctx: GameContext, s: GameState): string {
  const lines: string[] = [`turn ${s.turn}, ${s.current === 0 ? 'P1' : 'P2'} to act${s.stadium ? `, Stadium ${def(ctx, s.stadium.card).name}` : ''}`];
  for (const p of [0, 1] as const) {
    const ps = s.p[p];
    lines.push(
      `P${p + 1}: prizes ${ps.prizes.length}, hand ${ps.hand.length}, deck ${ps.deck.length}, discard ${ps.discard.length}`,
      `  Active: ${ps.active ? slotLine(ctx, ps.active) : '-'}`,
      ...ps.bench.map((b) => `  Bench: ${slotLine(ctx, b)}`),
    );
  }
  return lines.join('\n');
}
