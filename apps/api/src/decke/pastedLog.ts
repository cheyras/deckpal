/**
 * The paste channel — extract the raw PTCG Live battle log the READER pasted
 * into the conversation, so the model never has to re-emit it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE BLOCKER THIS CLOSES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Deck-E's chat model runs with `maxOutputTokens` 1200 (`models.ts`, chat tier).
 * The battle-log flow requires re-emitting a pasted 8–15 KB log (~3,000 tokens)
 * as `add_battle_log`'s `log` argument — the arithmetic forbids it. The raw log
 * already sits in the USER MESSAGE the model is answering; `extractPastedLog`
 * finds it there, and the AI SDK adapter (`adapters/aisdk.ts`) substitutes it
 * for a sentinel (`@pasted`) or a truncated prefix the model CAN afford to type.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE SHAPE IT READS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `api/chat.mjs` holds the replayed conversation as messages with `role` and
 * `parts` — an array of `{ type: 'text', text }` — the AI SDK's UI-message
 * shape (`latestUserText` in chat.mjs reads exactly this). The model-message
 * form (`content`, a string or an array of the same `{ type, text }` parts) is
 * accepted too: the replayed history is the one shape the server ever sees, and
 * being narrower would degrade silently if it changed. Only USER messages are
 * walked — the log is the reader's, never Deck-E's.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE HEURISTIC — a false null degrades to the old behavior; a false MATCH logs garbage
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A PTCG Live battle log is line-oriented and narrowly shaped (see
 * `deck/battlelog.ts` for the full grammar the parser understands): a `Setup`
 * section, turn headers `<name>'s Turn`, and action lines like `<name> played
 * <card> to the Bench`, `drew`, `attached`, `evolved … to …`, `took N Prize
 * cards`, `<mon> was Knocked Out!`, `<mon> used <attack> … for N damage`, Live
 * card codes in parens `(sv10_102)`, and the closing `All Prize cards taken.
 * <name> wins.`
 *
 * Each USER message is scanned for the largest CONTIGUOUS run of lines that
 * look like log lines (matching that grammar) or the blank lines Live puts
 * between turns. A run qualifies only when it has:
 *   • >= 8 matching lines AND >= 400 chars, AND
 *   • at least one ANCHOR — a `Setup` line or a `<name>'s Turn` header — so a
 *     long prose passage that happens to contain eight "played X" lines does
 *     not qualify. Real logs always carry an anchor; real prose almost never
 *     does, and the turn-header match is anchored to end-of-line (`$`) so
 *     "it was PlayerA's turn to shine" does not read as one.
 * Every non-blank line in the run must match: a prose line in the middle breaks
 * the run, which is the conservative choice this file was asked to make. The
 * downstream parser (`parseBattleLog`) still gates on parse quality, but a
 * false match here would paste garbage into a deck, so the bar is "looks like a
 * log end to end", not "contains some log lines".
 *
 * The NEWEST log wins: walking USER messages newest-first, the first message
 * that yields a qualifying run is returned. The raw block is returned verbatim
 * (capped at `RAW_LOG_MAX` = 50,000 chars, the route's own ceiling on
 * `add_battle_log`'s `log` and on `rawLog`), or `null` when nothing matched.
 *
 * Pure — no imports from `chat.mjs`, no I/O, no DB. A unit-test feeds it a
 * message array and asserts on the string it returns.
 */

/**
 * The route's own ceiling on a raw battle log. `add_battle_log`'s schema is
 * `z.string().max(50000)` and `POST /decks/:id/logs` refuses `rawLog` past
 * `RAW_LOG_MAX` (apps/api/src/routes/decks.ts); the paste channel returns at
 * most the same, so a paste that would overflow the route is truncated here
 * rather than rejected there. Defined locally rather than imported so this
 * stays pure — the value is duplicated in exactly one other place, and a
 * mismatch would surface as a route 400 the reader could not act on.
 */
const RAW_LOG_MAX = 50_000;

/** A run that qualified as a battle log. */
interface LogBlock {
  text: string;
  matches: number;
}

/**
 * Extract the raw PTCG Live battle log from the replayed conversation, or
 * `null` when no user message contains one.
 *
 * @param messages the replayed message array as `api/chat.mjs` holds it —
 *   `{ role, parts }` (UI messages) or `{ role, content }` (model messages).
 */
export function extractPastedLog(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m !== 'object') continue;
    if ((m as { role?: unknown }).role !== 'user') continue;
    const text = messageText(m);
    if (!text) continue;
    const block = largestLogBlock(text);
    if (block && block.matches >= 8 && block.text.length >= 400 && hasAnchor(text, block)) {
      return block.text.slice(0, RAW_LOG_MAX);
    }
  }
  return null;
}

/**
 * The text of one message, read from either shape the replayed history carries.
 *
 * `parts` is the AI SDK UI-message form (`api/chat.mjs`'s `latestUserText` reads
 * it); `content` is the model-message form (a bare string, or an array of
 * `{ type, text }`). Multiple text parts are joined on newlines so a log split
 * across parts keeps its line structure — a space join would run two turn
 * headers together.
 */
function messageText(m: unknown): string {
  const msg = m as { parts?: unknown; content?: unknown };
  const parts = msg.parts;
  if (Array.isArray(parts)) {
    return parts
      .map(textPart)
      .filter((t): t is string => typeof t === 'string')
      .join('\n');
  }
  const content = msg.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : textPart(p)))
      .filter((t): t is string => typeof t === 'string')
      .join('\n');
  }
  return '';
}

/** The `text` of a `{ type: 'text', text }` part, or `null` for anything else. */
function textPart(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as { type?: unknown; text?: unknown };
  if (o.type === 'text' && typeof o.text === 'string') return o.text;
  return null;
}

/**
 * Does a line look like a PTCG Live battle-log line?
 *
 * The grammar is `deck/battlelog.ts`'s own — the same shapes the parser
 * understands — narrowed to what is distinctive enough to carry the signal
 * without matching prose. Curly apostrophes are normalized first, as the
 * parser does, so `PlayerA’s` and `PlayerA's` read the same.
 *
 * Blank lines are NOT matched here; the caller allows them inside a run (Live
 * separates turns with them) and breaks a run on any other non-matching line.
 */
function isLogLine(raw: string): boolean {
  const line = raw.replace(/[’‘]/g, "'").replace(/\s+$/, '');
  if (!line.trim()) return false;
  // ── Sub-bullet continuation lines ────────────────────────────────────────
  // Live folds draws/shuffles/discards under the triggering action as
  // `- …` lines, and card lists as `   • …` lines. Both are part of the log;
  // prose does not use either shape, and a dash-prefixed line inside an
  // anchored, all-matching run is not a sentence.
  if (/^\s*•/.test(line)) return true;
  if (/^-\s+\S/.test(line)) return true;
  // ── Strong anchors ───────────────────────────────────────────────────────
  // `Setup` is a line of its own; a turn header is exactly `<name>'s Turn`.
  // Both end at `$` so prose that merely contains the phrase does not match.
  if (/^Setup\s*$/.test(line)) return true;
  if (/^(.+)'s Turn\s*$/.test(line)) return true;
  // ── Setup-section actions (deck/battlelog.ts's SETUP_RE) ─────────────────
  if (
    /^.+ (chose (heads|tails)|won the coin toss|decided to go (first|second)|drew \d+ cards for the opening hand|took a mulligan)\b/.test(
      line,
    )
  )
    return true;
  // Mulligan compensation: "PlayerA drew 1 more card because PlayerB took at
  // least 1 mulligan." — the one setup line that is not the SETUP_RE shape.
  if (/^.+ drew \d+ more card/.test(line)) return true;
  if (/^.+ took at least \d+ mulligan/.test(line)) return true;
  // ── Action lines with a player prefix ─────────────────────────────────────
  if (
    /^.+ (played .+ to the (Bench|Active Spot|Stadium spot)|evolved .+ to .+|attached .+ to .+|took \d+ Prize cards?|took a Prize card|ended their turn|retreated .+)\b/.test(
      line,
    )
  )
    return true;
  // A bare `played <card>.` (trainer / stadium replay) — broader than the
  // location form, but the anchor + every-line rules carry the signal; prose
  // that says "I played X." does not appear inside a Setup/Turn-anchored,
  // all-matching run. Excludes the location form, which the branch above owns.
  if (/^.+ played [A-Z].*\.$/.test(line) && !/ played .+ to the /.test(line)) return true;
  // `drew` — a card, a named card, or N cards. Sub-action `drew N cards` is
  // dash-prefixed (caught above); this catches the top-level forms.
  if (/^.+ drew (a card\b|[A-Z].*|\d+ cards?)\./.test(line)) return true;
  // ── Possession lines: `<name>'s <mon> …` ───────────────────────────────────
  // No trailing `\b`: `was Knocked Out!` ends in `!` (non-word) at end-of-line,
  // where a word-boundary cannot match — a `\b` here broke the run at every KO.
  if (/^.+'s .+ (was Knocked Out!|used .+|is now in the Active Spot)/.test(line)) return true;
  // ── Closeout ───────────────────────────────────────────────────────────────
  if (/^(All Prize cards taken\.\s+)?(.+) wins\.?\s*$/.test(line)) return true;
  if (/^(.+) conceded\b/.test(line)) return true;
  // ── Hand / discard / activation ────────────────────────────────────────────
  if (/^.+ was added to .+'s hand\.$/.test(line)) return true;
  if (/^A card was added to .+'s hand\.$/.test(line)) return true;
  if (/^.+ was discarded from .+'s .+/.test(line)) return true;
  if (/^.+ was activated\.$/.test(line)) return true;
  if (/^Effects of .+ did not affect/.test(line)) return true;
  // ── A Live card code anywhere on the line, e.g. `(sv10_102)` ───────────────
  // The same shape `deck/battlelog.ts`'s `LIVE_CARD_CODE` strips: a parenthesized
  // set token, underscore, then digits. A line carrying one is a log line.
  if (/\([A-Za-z0-9][A-Za-z0-9.-]*_\d+[A-Za-z_]*\)/.test(line)) return true;
  return false;
}

/**
 * Find the largest contiguous run of log/blank lines in `text`.
 *
 * Returns the verbatim block (blank lines between turns kept), its match count,
 * and nothing else. A non-matching, non-blank line ends a run; the caller
 * decides whether a run is long enough and anchored to count.
 */
function largestLogBlock(text: string): LogBlock | null {
  const lines = text.split(/\r?\n/);
  // Collect maximal [start, end] runs of (log line | blank). A run is bounded
  // by the first non-matching, non-blank line on either side.
  const runs: Array<[number, number]> = [];
  let start: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    const blank = l.trim() === '';
    const log = !blank && isLogLine(l);
    if (blank || log) {
      if (start === null) start = i;
    } else if (start !== null) {
      runs.push([start, i - 1]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, lines.length - 1]);

  let best: LogBlock | null = null;
  for (const [s, e] of runs) {
    // Trim leading/trailing blank lines — they belong to the gap around the
    // log, not to the log itself, and returning them would pad the block.
    let lo = s;
    let hi = e;
    while (lo <= hi && (lines[lo] ?? '').trim() === '') lo++;
    while (hi >= lo && (lines[hi] ?? '').trim() === '') hi--;
    if (lo > hi) continue;
    let matches = 0;
    for (let i = lo; i <= hi; i++) {
      const line = lines[i] ?? '';
      if (line.trim() !== '' && isLogLine(line)) matches++;
    }
    const blockText = lines.slice(lo, hi + 1).join('\n');
    if (!best || blockText.length > best.text.length) {
      best = { text: blockText, matches };
    }
  }
  return best;
}

/**
 * Does a qualifying block contain at least one ANCHOR — a `Setup` line or a
 * `<name>'s Turn` header? The strong signal that distinguishes a log from
 * prose that happens to use its verbs; required for a block to count.
 */
function hasAnchor(_text: string, block: LogBlock): boolean {
  for (const line of block.text.split(/\r?\n/)) {
    const t = line.replace(/[’‘]/g, "'").trim();
    if (t === 'Setup') return true;
    if (/^(.+)'s Turn$/.test(t)) return true;
  }
  return false;
}
