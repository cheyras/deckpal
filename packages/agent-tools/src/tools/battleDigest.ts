import { z } from 'zod';
import { defineTool, type ToolDefinition } from '../registry.js';
import { fail, ok } from '../result.js';
import { errText } from '../shared.js';
import { needDeck } from '../entities.js';
import { row } from '../format.js';

/**
 * `battle_digest` — one stored game, read into the shape a model can judge.
 *
 * ── WHY A SECOND READ TOOL FOR BATTLES (2026-10-10) ──────────────────────────
 *
 * `battle_logs` gives a model two choices for one game: the thin parse (who won,
 * prizes, the KO lists) or the raw log with `include_raw` — up to 50,000
 * characters, most of it "drew a card". Neither says WHEN anything happened,
 * and when is the review: a 4–6 loss that was even until the last turn and one
 * that was over by turn five deserve different notes. The owner asked for
 * Deck-E to review with judgement — a nothing-burger gets two lines, a game worth
 * learning from gets a real analysis — and the cheap model doing the logging
 * cannot read 50k characters for that, nor should it be paid to.
 *
 * So the API digests the stored log (`GET /decks/:id/logs/:logId/digest`,
 * `digestBattleLog` in apps/api/src/deck/battlelog.ts) and this renders it in
 * under 3,000 characters: small enough to read every time, and to paste into a
 * brief for a stronger model.
 *
 * Read-only, and like `battle_logs` it resolves the deck LOOSELY — a near-miss
 * on a read costs a sentence, and the resolved deck is named in the result.
 */

/** The digest's hard ceiling on the text a model receives. */
export const DIGEST_TEXT_MAX = 3_000;

// ── API payload (only the fields this tool renders) ─────────────────────────

type Side = 'me' | 'opponent';

interface Sides<T> {
  me: T;
  opponent: T;
}

interface PrizeEvent {
  turn: number;
  side: Side;
  prizes: number;
  knockedOut: string | null;
  score: Sides<number>;
}

interface Digest {
  players: { me: string | null; opponent: string | null };
  playerNames: string[];
  confidence: 'high' | 'low';
  result: 'win' | 'loss' | 'tie' | null;
  wentFirst: Side | null;
  totalTurns: number;
  turns: Sides<number> | null;
  mulligans: Sides<number> | null;
  firstAttackTurn: Sides<number | null> | null;
  finalPrizes: Sides<number> | null;
  prizeTimeline: PrizeEvent[];
  opponentCards: { name: string; count: number }[];
  myPokemonUsed: string[];
  opponentArchetypeGuess: string | null;
  endReason: 'prizes' | 'concede' | 'deck-out' | 'other';
  leadChanged: boolean;
  closeGame: boolean;
  unknowns: string[];
}

export interface DigestPayload {
  logId: number;
  deckVersion: number;
  origin: string;
  /** The STORED result — explicit corrections win over the log text. */
  result: 'win' | 'loss' | 'tie' | null;
  digest: Digest;
}

// ── Rendering ────────────────────────────────────────────────────────────────

const ENDED: Record<Digest['endReason'], string> = {
  prizes: 'on prizes',
  concede: 'by concession',
  'deck-out': 'by deck-out',
  other: 'other (timeout, or a wording the digest does not know)',
};

const side = (s: Side): string => (s === 'me' ? 'me' : 'opp');
const turnLabel = (t: number | null): string => (t === null ? 'never' : `T${t}`);
const resultLabel = (r: string | null): string => (r ? r.toUpperCase() : 'NO RESULT');

/** "a, b, c +4 more" — the first `n` of a list, saying how many were left out. */
function capped(items: string[], n: number): string {
  if (items.length <= n) return items.join(', ');
  return `${items.slice(0, n).join(', ')} +${items.length - n} more`;
}

function timeline(events: PrizeEvent[], n: number): string {
  const one = (e: PrizeEvent): string =>
    `T${e.turn} ${side(e.side)} +${e.prizes}${e.knockedOut ? ` ${e.knockedOut}` : ''} (${e.score.me}–${e.score.opponent})`;
  if (events.length <= n) return events.map(one).join(' · ');
  // Keep the opening and the finish — the turning point is usually in one of
  // them, and the middle is what a reader can most afford to lose.
  const head = Math.ceil(n / 2);
  const tail = n - head;
  return [
    ...events.slice(0, head).map(one),
    `… ${events.length - n} more …`,
    ...events.slice(events.length - tail).map(one),
  ].join(' · ');
}

/**
 * The digest as compact text, never over {@link DIGEST_TEXT_MAX} characters.
 * The long lists shrink first (opponent cards, then the prize timeline); a hard
 * cut is the last resort and says so.
 */
export function renderBattleDigest(p: DigestPayload, deckName: string, note?: string | null): string {
  const d = p.digest;
  const build = (cardCap: number, eventCap: number, monCap: number): string => {
    const lines: string[] = [];
    const logResult = d.result && p.result && d.result !== p.result ? ` (the log text reads ${resultLabel(d.result)})` : '';
    lines.push(row(`battle digest #${p.logId}`, `v${p.deckVersion}`, `'${deckName}'`, `stored result ${resultLabel(p.result)}${logResult}`));

    if (d.players.me === null) {
      lines.push(
        `players: could not tell which one is the reader — the log names ${d.playerNames.join(' and ') || 'nobody'}. ` +
          'Re-call with player_name set to their exact screen name for the per-side digest.',
      );
      lines.push(row(`${d.totalTurns} turns`, `ended ${ENDED[d.endReason]}`, d.closeGame ? 'close game' : 'not close'));
    } else {
      lines.push(row(
        `players: me ${d.players.me} vs ${d.players.opponent ?? '?'}`,
        d.confidence === 'low' ? 'owner identification LOW confidence' : null,
      ));
      lines.push(row(
        `ended ${ENDED[d.endReason]}`,
        d.turns ? `${d.totalTurns} turns (me ${d.turns.me}, opp ${d.turns.opponent})` : `${d.totalTurns} turns`,
        `went first: ${d.wentFirst ?? 'unknown'}`,
        d.mulligans ? `mulligans: me ${d.mulligans.me}, opp ${d.mulligans.opponent}` : null,
      ));
      if (d.firstAttackTurn) {
        lines.push(`first attack damage: me ${turnLabel(d.firstAttackTurn.me)}, opp ${turnLabel(d.firstAttackTurn.opponent)}`);
      }
      if (d.finalPrizes) {
        const gap = Math.abs(d.finalPrizes.me - d.finalPrizes.opponent);
        const close = d.closeGame
          ? `close game${d.leadChanged ? ' (the lead changed hands)' : ` (gap ${gap})`}`
          : `not close (gap ${gap})`;
        lines.push(`prizes taken: me ${d.finalPrizes.me} – opp ${d.finalPrizes.opponent} · ${close}`);
      }
      if (d.prizeTimeline.length) {
        lines.push(`prize timeline (T = game turn, both players counted; score me–opp after): ${timeline(d.prizeTimeline, eventCap)}`);
      }
      if (d.myPokemonUsed.length) lines.push(`my Pokemon used: ${capped(d.myPokemonUsed, monCap)}`);
      if (d.opponentArchetypeGuess) lines.push(`opponent archetype guess (from their board): ${d.opponentArchetypeGuess}`);
      if (d.opponentCards.length) {
        lines.push(`opponent cards seen (× times shown): ${capped(d.opponentCards.map((c) => `${c.name} ×${c.count}`), cardCap)}`);
      }
    }
    if (d.unknowns.length) lines.push(`unknown (never guess these): ${d.unknowns.join('; ')}`);
    if (note) lines.push(note);
    return lines.join('\n');
  };

  // Shrink in order of what a review can best do without.
  const attempts: Array<[number, number, number]> = [
    [40, 24, 15], [25, 16, 12], [15, 10, 10], [8, 6, 8], [4, 4, 6],
  ];
  for (const [cards, events, mons] of attempts) {
    const text = build(cards, events, mons);
    if (text.length <= DIGEST_TEXT_MAX) return text;
  }
  const last = build(4, 4, 6);
  return `${last.slice(0, DIGEST_TEXT_MAX - 30)}… (digest cut at ${DIGEST_TEXT_MAX} chars)`;
}

// ── The tool ─────────────────────────────────────────────────────────────────

const deckPath = (deckId: string): string => `/decks/${encodeURIComponent(deckId)}`;

const battleDigestTool = defineTool({
  name: 'battle_digest',
  title: 'Read one game as a digest',
  description:
    'Read ONE stored PTCG Live game as a compact digest: who went first, mulligans, turns, each ' +
    "side's first attack, the prize timeline turn by turn (with the Knock Out each prize paid " +
    'for), every card the opponent showed, how it ended, whether it was close, and what the log ' +
    'cannot tell (their hand, the prized cards). Use it to judge or review a game — it is a small ' +
    'fraction of the raw log that battle_logs include_raw returns. A game reported in person has ' +
    'no log to digest; read its notes and review with battle_logs log_id instead. Read-only.',
  inputSchema: z.object({
    deck_id: z.string().describe('The deck, by UUID or by NAME.'),
    log_id: z.number().int().positive().describe('Battle log id (the #N from battle_logs or add_battle_log).'),
    player_name: z
      .string()
      .max(100)
      .optional()
      .describe("Only when a digest said it could not tell which player is the reader: their exact screen name in the log."),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true },
  handler: async ({ deck_id: deckRef, log_id, player_name }, ctx) => {
    try {
      // Loose — a read, like battle_logs; the resolved deck is named below.
      const picked = await needDeck(ctx, deckRef);
      if (!picked.ok) return fail(picked.message);
      const qs = player_name?.trim() ? `?playerName=${encodeURIComponent(player_name.trim())}` : '';
      let payload: DigestPayload;
      try {
        payload = (await ctx.api.get(
          `${deckPath(picked.value.id)}/logs/${encodeURIComponent(log_id)}/digest${qs}`,
        )) as DigestPayload;
      } catch (err) {
        // NOT A FAILURE: an in-person game has no log, and that is an answer.
        // Returned as one so a model reviewing a season of mixed games does not
        // count every in-person entry against the failing-tool budget.
        const message = errText(err);
        if (/^no game log to digest\b/i.test(message)) {
          return ok(
            `Battle #${log_id}: ${message}. Read its notes and saved review with battle_logs (log_id ${log_id}) instead.`,
          );
        }
        throw err;
      }
      return ok(renderBattleDigest(payload, picked.value.name, picked.note));
    } catch (err) {
      return fail(`battle_digest failed: ${errText(err)}`);
    }
  },
});

export const battleDigestTools: ToolDefinition[] = [battleDigestTool];
