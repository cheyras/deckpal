import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { errText } from '../shared.js';
import { needDeck } from '../entities.js';
import { oneLine } from '../format.js';

/**
 * `battle_turn_review` — what the battle simulator's strongest pilot would have done on one of the reader's turns of a
 * stored PTCG Live game, beside what they did (2026-10-14).
 *
 * The owner asked why Claude over MCP could not use the simulator's own evaluation of the plays available on a turn. This
 * is that evaluation as a DeckPal tool, so Deck-E and any MCP client get the same answer: the route
 * (`GET /decks/:id/logs/:logId/turns/:turn/review`, packages/sim/src/replay/turnReview.ts) replays the log to the
 * reader's first decision of the turn and runs the own-turn search the simulator's games are played with.
 *
 * Read-only, and the deck resolves loosely like the other battle reads.
 */

/** The review's ceiling on the text a model receives. */
export const TURN_REVIEW_TEXT_MAX = 3_500;

interface WireOption {
  rank: number;
  first: string;
  line: string[];
  prizes: number;
  knockOuts: string[];
  behindBest: number;
  winsIn: number;
  reader: boolean;
}

export interface TurnReviewPayload {
  logId: number;
  turn: number;
  players: { me: string | null; opponent: string | null };
  review: {
    turn: number;
    found: boolean;
    reason: string | null;
    readerDid: string[];
    options: WireOption[];
    offered: number;
    worlds: number;
    nodes: number;
    hiddenInHand: number;
    ms: number;
  } | null;
  reason?: string;
}

/** Options within this many Prize cards of each other are effectively equal by the engine's evaluation. */
const EVEN = 0.3;

export function renderTurnReview(p: TurnReviewPayload, deckName: string, note?: string | null): string {
  const r = p.review;
  const out: string[] = [];
  out.push(`turn review: battle #${p.logId} · '${oneLine(deckName, 60)}' · turn ${p.turn}`);
  if (!r) {
    out.push(oneLine(p.reason ?? 'could not tell which player owns this deck; pass player_name', 300));
    if (note) out.push(note);
    return out.join('\n');
  }
  if (!r.found) {
    out.push(`no review: ${oneLine(r.reason ?? 'unknown', 300)}`);
    if (r.readerDid.length) out.push(`you did: ${r.readerDid.map((a) => oneLine(a, 90)).join(' → ')}`);
    if (note) out.push(note);
    return out.join('\n');
  }
  out.push(
    `the simulator's strongest pilot searched ${r.offered} first actions over ${r.worlds} sampled worlds (${r.nodes} positions, ${r.ms} ms)`,
  );
  out.push(`you did: ${r.readerDid.map((a) => oneLine(a, 90)).join(' → ') || '(nothing logged)'}`);
  out.push('options, best first ("behind" = how much worse than the best, in Prize cards of the engine\'s evaluation):');
  const lineCap = (o: WireOption, n: number): string => {
    const steps = o.line.slice(0, n).map((x) => oneLine(x, 70));
    if (o.line.length > n) steps.push(`+${o.line.length - n} more`);
    return steps.join(' → ');
  };
  const build = (steps: number): string => {
    const lines = r.options.map((o) => {
      const took = o.prizes ? `takes ${o.prizes} Prize${o.prizes === 1 ? '' : 's'}${o.knockOuts.length ? ` (KO ${o.knockOuts.map((k) => oneLine(k, 40)).join(', ')})` : ''}` : 'takes no Prizes';
      const won = o.winsIn ? ` · wins the game in ${o.winsIn}/${r.worlds} worlds` : '';
      return `${o.rank}. ${o.reader ? '[YOUR first action] ' : ''}${oneLine(o.first, 80)} — behind ${o.behindBest.toFixed(1)} · ${took}${won}\n   line: ${lineCap(o, steps)}`;
    });
    const mine = r.options.find((o) => o.reader);
    const verdict = !mine
      ? 'your first action is not among the options listed (it was not one the engine offered at that point)'
      : mine.behindBest <= EVEN
        ? `your first action is as good as the best by the engine's evaluation (within ${EVEN} Prize)`
        : `your first action trails the best by ${mine.behindBest.toFixed(1)} Prize cards by the engine's evaluation`;
    return [
      ...out,
      ...lines,
      `verdict: ${verdict}.`,
      `caveats: lines are from one sampled world, so later steps depend on the cards drawn there; the opponent's hand and both decks' order were sampled${r.hiddenInHand ? `; ${r.hiddenInHand} card(s) in your hand the log never showed were guessed` : ''}. A strong heuristic player (it beats the previous pilot 51.7%), not an oracle: options within ${EVEN} Prize are effectively equal.`,
      ...(note ? [note] : []),
    ].join('\n');
  };
  for (const steps of [10, 6, 4, 2]) {
    const text = build(steps);
    if (text.length <= TURN_REVIEW_TEXT_MAX) return text;
  }
  const last = build(1);
  return last.length <= TURN_REVIEW_TEXT_MAX ? last : `${last.slice(0, TURN_REVIEW_TEXT_MAX - 40)}… (review cut)`;
}

const deckPath = (deckId: string): string => `/decks/${encodeURIComponent(deckId)}`;

const battleTurnReviewTool = defineTool({
  name: 'battle_turn_review',
  title: 'Simulator review of one turn',
  description:
    "Ask the battle simulator's strongest pilot what it would have done on one of the reader's turns of a stored PTCG " +
    'Live game: its best first actions, the line each leads to and the Prizes it takes, ranked beside what the reader ' +
    'did. Use it in a game review on the turns that decided the game (battle_digest shows them). Read-only.',
  inputSchema: z.object({
    deck_id: z.string().describe('The deck, by UUID or by NAME.'),
    log_id: z.number().int().positive().describe('Battle log id (the #N from battle_logs).'),
    turn: z.number().int().min(1).max(400).describe("The game's turn number (both players counted), one of the reader's turns."),
    player_name: z.string().max(100).optional().describe('Only when told the owner could not be identified: their screen name in the log.'),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async ({ deck_id: deckRef, log_id, turn, player_name }, ctx) => {
    try {
      const picked = await needDeck(ctx, deckRef);
      if (!picked.ok) return fail(picked.message);
      const qs = player_name?.trim() ? `?playerName=${encodeURIComponent(player_name.trim())}` : '';
      let payload: TurnReviewPayload;
      try {
        payload = (await ctx.api.get(
          `${deckPath(picked.value.id)}/logs/${encodeURIComponent(log_id)}/turns/${encodeURIComponent(turn)}/review${qs}`,
        )) as TurnReviewPayload;
      } catch (err) {
        const message = errText(err);
        if (/^no game log to review\b/i.test(message)) return ok(`Battle #${log_id}: ${message}. There is no turn to replay.`);
        throw err;
      }
      return ok(renderTurnReview(payload, picked.value.name, picked.note));
    } catch (err) {
      return fail(`battle_turn_review failed: ${errText(err)}`);
    }
  },
});

export const battleTurnReviewTools: ToolDefinition[] = [battleTurnReviewTool];
