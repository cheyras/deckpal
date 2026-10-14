/**
 * The battle digest's second half: the simulator's reading of the same stored log (`replayInsights` in
 * packages/sim/src/replay/insights.ts). The board at the start of every turn, every attack with its printed damage and
 * what changed it, the moments worth a look, a one-line text for every card each side showed, and how much a review is
 * worth (`assessReview`).
 *
 * WHY (2026-10-13). In the owner's claude.ai tests a cheap model reviewing a game missed a self-Knock-Out that gave up
 * the last Prize, a turn the opponent's timer ran out, and why damage to a Benched Tera Pokémon did nothing: the digest
 * said who took which Prize when, and nothing about the board. The simulator already replays real logs move by move
 * (scripts/pilot-agreement.ts), so the digest reads the board from it instead of asking a model to reconstruct it.
 *
 * Side 0 is always the reader when the digest named them: the players are passed in that order, and checked afterwards
 * (the parser and the simulator normalise names the same way, but a mismatch must never silently swap the sides).
 */
import { assessReview, replayInsights, type ReplayInsights, type ReviewAssessment } from '@deckpal/sim';
import { samePlayerName, type BattleDigest } from './battlelog.js';

export interface ReplayDigest extends ReplayInsights {
  /** The reader's side in `players` (0 when known), or null when the digest could not tell which player they are. */
  me: 0 | 1 | null;
  assessment: ReviewAssessment | null;
  /** How long the replay took, for the logs. */
  ms: number;
}

export function replayDigest(
  raw: string,
  d: Pick<BattleDigest, 'players' | 'finalPrizes' | 'leadChanged' | 'result'>,
  o: { storedResult?: 'win' | 'loss' | 'tie' | null; notes?: string | null } = {},
): ReplayDigest | null {
  const t0 = Date.now();
  const mine = d.players.me;
  const theirs = d.players.opponent;
  const ins = replayInsights(raw, mine && theirs ? { players: [mine, theirs] } : {});
  if (!ins.turns.length && !ins.attacks.length) return null;
  const idx = mine ? ins.players.findIndex((n) => samePlayerName(n, mine)) : -1;
  const me = idx === 0 || idx === 1 ? idx : null;
  const assessment =
    me === null
      ? null
      : assessReview(ins, me, {
          finalPrizes: d.finalPrizes,
          leadChanged: d.leadChanged,
          result: o.storedResult ?? d.result,
          hasNotes: !!o.notes?.trim(),
        });
  return { ...ins, me, assessment, ms: Date.now() - t0 };
}
