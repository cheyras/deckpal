/**
 * On the Quick tier, a close game's digest tells Haiku to `consult` before he writes the review.
 *
 * ── WHY A NUDGE AND NOT ONLY THE PATHWAY (2026-11-17) ───────────────────────
 *
 * PR #315 gave the Quick tier `consult`: Haiku asks Sonnet one question with a brief he writes, so a game worth
 * learning from gets real analysis without moving the whole request to Standard. The battle_log pathway already said to
 * call it on a standard-depth game. Measured with the replay probe (`battle-log-digest-consult`, a close 4–6 loss on
 * Quick): in 2 runs of 2 Haiku called `battle_digest`, skipped `consult`, and wrote the review himself. The pathway is
 * read once, thousands of tokens before the digest arrives; the digest result is the last thing he reads before he
 * writes. So the instruction rides on that result, the same way `progressNudge.ts` and `toldAlready.ts` put a line where
 * the model is actually looking.
 *
 * ── WHO SEES IT ─────────────────────────────────────────────────────────────
 *
 * - Deck-E only. The shared `battle_digest` tool's TEXT is unchanged; it reports `closeGame` in its `structured` echo,
 *   which only Deck-E's adapter reads — `toCallToolResult` (apps/mcp/src/adapters/mcp.ts) never sends it. An MCP client
 *   has no consult tool, so telling it to call one would be an instruction it cannot follow.
 * - Quick only. `consult` exists only in a Quick request's tool set (`toolsForTier`, from `tierOffersConsult`), and the
 *   caller passes `consultOffered` from that same predicate, so the note can never name a tool the request lacks.
 * - Close games only: `closeGame` is the digest's own verdict (`digestBattleLog` in apps/api/src/deck/battlelog.ts — the
 *   lead changed hands, or the final gap was at most 2 Prizes with someone at 3 or more).
 *
 * The note is addressed to the model, after the digest's own text, and never reaches the chip (`summarise` reads the
 * first line) or grounding (observed before the note is added). The consult's own limits are unchanged: at most
 * `CONSULT_MAX_PER_REQUEST` per request, metered at cost, and its answer is never grounding.
 */

/** The line appended to a close game's `battle_digest` result on the Quick tier. */
export const CLOSE_GAME_CONSULT_NOTE =
  '\n\n(For you, not the reader: this was a close game, so before you write its review call `consult` once. ' +
  "The brief is this digest text plus the reader's own words about the game; the question is what decided this game " +
  'and the one lesson for next time. Then write the review in your own words from its answer.)'

/**
 * The note for this tool result, or `''`.
 *
 * Pure, so the three conditions are tested here rather than inferred from a transcript: the tool is `battle_digest`,
 * this request offers `consult`, and the tool's structured echo says `closeGame: true` (an exact `true` — a missing or
 * malformed echo, such as an older agent-tools build, adds nothing).
 */
export function closeGameConsultNote(
  toolName: string,
  structured: Record<string, unknown> | undefined,
  consultOffered: boolean | undefined,
): string {
  if (toolName !== 'battle_digest' || consultOffered !== true) return ''
  return structured?.closeGame === true ? CLOSE_GAME_CONSULT_NOTE : ''
}
