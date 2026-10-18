/**
 * A readable play-by-play of a simulated game, from its event stream — in the
 * spirit of a Pokémon TCG Live battle log, but omniscient (both players'
 * draws are named). Meant for a person who knows the game to skim: a wrong
 * ruling, an illegal play or a damage number that can't be right should jump
 * out. Pure: events + context in, lines out.
 */
import { def, type GameContext } from './context.js';
import type { GameEvent, Player } from './types.js';

export interface TranscriptOptions {
  /** Names for the two seats (default "P1"/"P2"). */
  names?: [string, string];
  /** Leave out draws (shorter). Default false. */
  hideDraws?: boolean;
}

export function transcript(ctx: GameContext, events: readonly GameEvent[], o: TranscriptOptions = {}): string[] {
  const who = (p: Player | null) => (p === null ? 'nobody' : (o.names?.[p] ?? `P${p + 1}`));
  const card = (iid: number) => def(ctx, iid).name;
  const slotName = new Map<number, string>();
  const slotOwner = new Map<number, Player>();
  const nameOf = (slot: number) => slotName.get(slot) ?? `Pokémon #${slot}`;
  const lines: string[] = [];
  let pendingDraws: { p: Player; cards: number[] } | null = null;
  const flushDraws = () => {
    if (!pendingDraws || o.hideDraws) {
      pendingDraws = null;
      return;
    }
    const { p, cards } = pendingDraws;
    lines.push(`  ${who(p)} drew ${cards.length === 1 ? card(cards[0]!) : `${cards.length} cards: ${cards.map(card).join(', ')}`}.`);
    pendingDraws = null;
  };

  for (const e of events) {
    if (e.type !== 'draw') flushDraws();
    switch (e.type) {
      case 'coin_toss':
        lines.push(`${who(e.winner)} won the coin toss.`);
        break;
      case 'go_first':
        lines.push(`${who(e.player)} goes first.`);
        break;
      case 'mulligan':
        lines.push(`${who(e.player)} took a mulligan (no Basic Pokémon in ${e.hand.map(card).join(', ')}).`);
        break;
      case 'opening_hand':
        lines.push(`${who(e.player)} kept a ${e.size}-card hand.`);
        break;
      case 'turn_start':
        lines.push('', `— Turn ${e.turn}: ${who(e.player)} —`);
        break;
      case 'draw':
        if (pendingDraws && pendingDraws.p === e.player) pendingDraws.cards.push(e.card);
        else {
          flushDraws();
          pendingDraws = { p: e.player, cards: [e.card] };
        }
        break;
      case 'play_to_active':
        slotName.set(e.slot, card(e.card));
        slotOwner.set(e.slot, e.player);
        lines.push(`  ${who(e.player)} put ${card(e.card)} in the Active Spot.`);
        break;
      case 'play_to_bench':
        slotName.set(e.slot, card(e.card));
        slotOwner.set(e.slot, e.player);
        lines.push(`  ${who(e.player)} benched ${card(e.card)}.`);
        break;
      case 'evolve': {
        const from = nameOf(e.slot);
        slotName.set(e.slot, card(e.card));
        lines.push(`  ${who(e.player)} evolved ${from} into ${card(e.card)}.`);
        break;
      }
      case 'attach':
        lines.push(`  ${who(e.player)} attached ${card(e.card)} to ${nameOf(e.slot)}.`);
        break;
      case 'play_trainer':
        lines.push(`  ${who(e.player)} played ${card(e.card)}.`);
        break;
      case 'play_stadium':
        break; // play_trainer already said it
      case 'use_ability':
        lines.push(e.slot === 0 ? `  ${who(e.player)} used the Stadium, ${e.name}.` : `  ${who(e.player)} used ${nameOf(e.slot)}'s ${e.name}.`);
        break;
      case 'attack':
        lines.push(`  ${who(e.player)}'s ${nameOf(e.slot)} used ${e.name}.`);
        break;
      case 'damage':
        lines.push(`    → ${e.amount} damage to ${who(e.player)}'s ${nameOf(e.slot)}.`);
        break;
      case 'counters':
        lines.push(`    → ${e.n} damage counter${e.n === 1 ? '' : 's'} on ${who(e.player)}'s ${nameOf(e.slot)}.`);
        break;
      case 'condition':
        lines.push(`    → ${who(e.player)}'s ${nameOf(e.slot)} is now ${e.cond[0]!.toUpperCase()}${e.cond.slice(1)}.`);
        break;
      case 'coin_flip':
        lines.push(`    (${who(e.player)} flipped ${e.heads ? 'heads' : 'tails'})`);
        break;
      case 'knockout':
        lines.push(`  ✖ ${who(e.player)}'s ${nameOf(e.slot)} was Knocked Out.`);
        break;
      case 'prize_take':
        lines.push(`  ${who(e.player)} took ${e.n} Prize card${e.n === 1 ? '' : 's'}.`);
        break;
      case 'promote':
        lines.push(`  ${who(e.player)} promoted ${nameOf(e.slot)} to the Active Spot.`);
        break;
      case 'retreat':
        lines.push(`  ${who(e.player)} retreated ${nameOf(e.from)}; ${nameOf(e.to)} is now Active.`);
        break;
      case 'switch':
        lines.push(`  ${who(e.player)}'s ${nameOf(e.to)} is now Active (${nameOf(e.from)} went to the Bench).`);
        break;
      case 'discard':
        lines.push(`    (${who(e.player)} discarded ${e.cards.map(card).join(', ')})`);
        break;
      case 'search':
        lines.push(`    (${who(e.player)} found ${e.found.map(card).join(', ') || 'nothing'})`);
        break;
      case 'shuffle':
      case 'end_turn':
        break;
      case 'game_end':
        lines.push('', `GAME OVER on turn ${e.turn}: ${e.winner === null ? `draw (${e.reason})` : `${who(e.winner)} wins (${e.reason})`}.`);
        break;
      case 'sudden_death':
        lines.push('', `BOTH PLAYERS WON AT ONCE: sudden death${e.n > 1 ? ` #${e.n}` : ''}, a new game with 1 Prize card each.`, '');
        break;
    }
  }
  flushDraws();
  void slotOwner;
  return lines;
}
