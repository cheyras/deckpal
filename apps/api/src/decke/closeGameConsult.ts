/**
 * On the Quick tier, a genuinely close game's digest tells Haiku to `consult` before he writes the review.
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
 * - Deck-E only. The shared `battle_digest` tool's TEXT is unchanged; the facts this judges on travel in its
 *   `structured` echo (`digestEcho` in packages/agent-tools/src/tools/battleDigest.ts), which only Deck-E's adapter
 *   reads — `toCallToolResult` (apps/mcp/src/adapters/mcp.ts) never sends it. An MCP client has no consult tool, so
 *   telling it to call one would be an instruction it cannot follow.
 * - Quick, on a battle pathway. `consult` exists only in a Quick request's tool set (`toolsForTier`, from
 *   `tierOffersConsult`), and api/chat.mjs passes `consultOffered` from {@link closeGameConsultOffered}: that same
 *   predicate AND a routed pathway that writes or reviews a game (`battle_log`, `battle_review`). A Quick request on
 *   another pathway reading a digest for a lookup never sees the note.
 *
 * ── WHICH GAMES (narrowed 2026-11-25) ───────────────────────────────────────
 *
 * The digest's own `closeGame` (`digestBattleLog` in apps/api/src/deck/battlelog.ts) is broad on purpose — it drives
 * the "Close game" badge and counts ANY lead change, so a 1–6 loss where the reader took the first Prize is "close".
 * A consult costs the reader credits, so the note asks for more (see {@link isConsultWorthyClose}): the game ended on
 * play rather than a concession, the owner is known (an ownerless digest has no side to review), and either the final
 * gap was at most 2 Prizes with someone at 3 or more, or the lead changed hands after BOTH sides had taken 3.
 *
 * ── THE WORDING IS CONDITIONAL ──────────────────────────────────────────────
 *
 * The note is part of the tool output, and the browser replays recent tool outputs to the model on later turns
 * (`FULL_REPLAY_TURNS` in apps/web/src/character/host/chat/toolReplay.ts) — turns that may be on Standard, without
 * `consult`, or only asking a follow-up question. So it says "if you are about to write this game's review and you
 * hold `consult`", never a bare "call `consult`".
 *
 * The note is addressed to the model, after the digest's own text, and never reaches the chip (`summarise` reads the
 * first line) or grounding (observed before the note is added). The consult's own limits are unchanged: at most
 * `CONSULT_MAX_PER_REQUEST` per request, metered at cost, and its answer is never grounding.
 */
import { CONSULT_BRIEF_MAX } from './consult.js'
import type { PathwayName } from './pathways/names.js'

/** The routed pathways on which a digest may be read to write or review that game. */
export const CLOSE_GAME_CONSULT_PATHWAYS: readonly PathwayName[] = ['battle_log', 'battle_review']

/**
 * Does this request get the close-game note? `holdsConsult` is `tierOffersConsult(decision.tier)` — passed in rather
 * than imported, so this module stays free of tools.ts (which imports the adapter that imports this).
 */
export function closeGameConsultOffered(holdsConsult: boolean, pathways: readonly PathwayName[]): boolean {
  return holdsConsult && pathways.some((p) => CLOSE_GAME_CONSULT_PATHWAYS.includes(p))
}

/** The line appended to a genuinely close game's `battle_digest` result. */
export const CLOSE_GAME_CONSULT_NOTE =
  '\n\n(For you, not the reader: this was a close game. If you are about to write this game\'s review and you hold ' +
  '`consult`, call it once first. The brief is the parts of this digest that matter, under ' +
  `${CONSULT_BRIEF_MAX.toLocaleString('en-US')} characters, plus the reader's own words about the game; the question ` +
  'is what decided this game and the one lesson for next time. Then write the review in your own words from its ' +
  'answer. If you are only answering a question about the game, or you do not hold `consult`, ignore this.)'

/**
 * The same note when the replay's depth line says brief: the consult still happens (a genuinely close game is worth
 * one), and the review stays as short as the depth line asks.
 */
export const CLOSE_GAME_BRIEF_CONSULT_NOTE =
  `${CLOSE_GAME_CONSULT_NOTE.slice(0, -1)} Its depth line says brief, so after the consult the review is still two or ` +
  'three lines: what decided it and the lesson.)'

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Close enough to pay for a consult, judged on the digest's structured echo. Anything missing or malformed (an older
 * agent-tools build, an ownerless digest) is NOT close: the note is only ever added on positive evidence.
 */
export function isConsultWorthyClose(s: Record<string, unknown> | undefined): boolean {
  if (!s || s.closeGame !== true) return false
  if (s.endReason === 'concede' || s.ownerKnown !== true) return false
  const fp = s.finalPrizes as { me?: unknown; opponent?: unknown } | null | undefined
  if (!fp || !num(fp.me) || !num(fp.opponent)) return false
  const tightFinish = Math.abs(fp.me - fp.opponent) <= 2 && Math.max(fp.me, fp.opponent) >= 3
  return tightFinish || s.lateLeadChange === true
}

/**
 * The note for this tool result, or `''`.
 *
 * Pure, so the conditions are tested here rather than inferred from a transcript: the tool is `battle_digest`, this
 * request gets the note (`consultOffered`, from {@link closeGameConsultOffered}), and the structured echo shows a
 * genuinely close game ({@link isConsultWorthyClose}).
 */
export function closeGameConsultNote(
  toolName: string,
  structured: Record<string, unknown> | undefined,
  consultOffered: boolean | undefined,
): string {
  if (toolName !== 'battle_digest' || consultOffered !== true) return ''
  if (!isConsultWorthyClose(structured)) return ''
  return structured?.reviewDepth === 'brief' ? CLOSE_GAME_BRIEF_CONSULT_NOTE : CLOSE_GAME_CONSULT_NOTE
}
