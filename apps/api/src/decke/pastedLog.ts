/**
 * The paste channel — extract the raw PTCG Live battle log the READER pasted
 * into the conversation, so the model never has to re-emit it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE BLOCKER THIS CLOSES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Deck-E's chat model runs with `maxOutputTokens` 8000 (`models.ts`, chat tier).
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
 * Each USER message is scanned from a log anchor to its closeout, rather than
 * for an unbroken run of recognized lines. Live periodically adds client lines
 * that this lightweight detector does not know yet; treating one as a boundary
 * silently stored only the largest fragment of a real game. A span qualifies
 * only when it has:
 *   • >= 8 matching lines AND >= 400 chars, AND
 *   • at least one ANCHOR — a `Setup` line or a `<name>'s Turn` header — so a
 *     long prose passage that happens to contain eight "played X" lines does
 *     not qualify. Real logs always carry an anchor; real prose almost never
 *     does, and the turn-header match is anchored to end-of-line (`$`) so
 *     "it was PlayerA's turn to shine" does not read as one.
 * At least 70% of its non-blank lines must match. That leaves room for the
 * occasional unknown Live template while rejecting chat prose wrapped around a
 * few log-shaped sentences. The downstream parser (`parseBattleLog`) still
 * gates on parse quality, but a false match here would paste garbage into a
 * deck, so the bar remains "looks like a log end to end", not "contains some
 * log lines".
 *
 * The NEWEST log wins: walking USER messages newest-first, the last complete
 * game in the first message with an anchor is returned. An anchored newest
 * message that does not qualify is a failed new paste, not permission to reuse
 * an older game's raw log. The raw block is returned verbatim (capped at
 * `RAW_LOG_MAX` = 50,000 chars, the route's own ceiling on `add_battle_log`'s
 * `log` and on `rawLog`), or `null` when nothing matched.
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

/** An anchored span that qualified as a battle log. */
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
    if (block && block.matches >= 8 && block.text.length >= 400) {
      return block.text.slice(0, RAW_LOG_MAX);
    }
    // 2026-10-10: once the reader's newest message contains a real anchor, it
    // is the paste they are asking about. Falling through used an older game
    // when this paste was truncated or malformed, making `@pasted` silently
    // duplicate history. Fail closed here; the model can ask for a fresh paste.
    if (containsLogAnchor(text)) return null;
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
 * Blank lines are NOT matched here; they count neither for nor against an
 * anchored span's recognition density.
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
  if (/^Pokémon Checkup\s*$/.test(line)) return true;
  // ── Setup-section actions (deck/battlelog.ts's SETUP_RE) ─────────────────
  if (
    /^.+ (chose (heads|tails)|won the coin toss|decided to go (first|second)|drew \d+ cards for the opening hand|took a mulligan)\b/.test(
      line,
    )
  )
    return true;
  // Mulligan compensation: "PlayerA drew 1 more card because PlayerB took at
  // least 1 mulligan." — the one setup line that is not the SETUP_RE shape.
  if (/^Cards revealed from Mulligan \d+\s*$/.test(line)) return true;
  if (/^.+ drew \d+ more cards? because .+ took at least \d+ mulligan\.$/.test(line)) return true;
  // ── Action lines with a player prefix ─────────────────────────────────────
  if (
    /^.+ (played .+ to the (Bench|Active Spot|Stadium spot)|evolved .+ to .+ on the Bench|attached .+ to .+ (in the Active Spot|on the Bench)|took \d+ Prize cards?|took a Prize card|ended their turn|retreated .+ to the Bench|shuffled their deck|didn't take an action in time|lost connection and reconnected to the server|can no longer use .+)\b/.test(
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
  if (/^.+'s .+ (was Knocked Out!|used .+ on .+'s .+ for \d+ damage\.|is now in the Active Spot|is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\.|took \d+ damage from (Poison|Burn)\.)/.test(line)) return true;
  if (/^.+ flipped (a coin|\d+ coins)(?:\.{3,}|…)\s*$/.test(line)) return true;
  if (/^.+ put \d+ damage counters on .+'s .+\.$/.test(line)) return true;
  if (/^Entering Sudden Death\.$/.test(line)) return true;
  // ── Closeout ───────────────────────────────────────────────────────────────
  if (/^(?:(?:All Prize cards taken|Opponent took all of their Prize cards|Opponent conceded)\.\s+)?(.+) wins\.\s*$/.test(line)) return true;
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
 * Find an anchor-to-closeout span in `text`.
 *
 * Live can display a game in reverse order, in which case its closeout is
 * first and Setup is last. Reverse mode is only possible when no closeout
 * follows the first anchor: prose such as "I conceded last time" before a
 * normal paste must not reverse it. In normal order, each anchor following a
 * closeout starts another game and the last complete game wins. One paste
 * channel carries one game; the reader can paste any earlier games separately.
 * Without a closeout we stop at the last recognized line, preserving the old
 * useful partial-log behavior. Unknown lines inside a span are retained.
 */
function largestLogBlock(text: string): LogBlock | null {
  const lines = text.split(/\r?\n/);
  const setup = lines.findIndex((line) => isSetup(line));
  const firstTurn = lines.findIndex((line) => isTurnHeader(line));
  const anchor = setup >= 0 ? setup : firstTurn;
  if (anchor < 0) return null;

  const closeouts = lines
    .map((line, index) => (isCloseout(line) ? index : -1))
    .filter((index) => index >= 0);
  const closeoutsAfterAnchor = closeouts.filter((index) => index >= anchor);

  if (closeoutsAfterAnchor.length > 0) {
    let previousCloseout = -1;
    let newest: { lo: number; hi: number } | null = null;
    for (const closeout of closeouts) {
      if (closeout < anchor) {
        previousCloseout = closeout;
        continue;
      }
      const lo = firstAnchorBetween(lines, previousCloseout + 1, closeout);
      if (lo >= 0) newest = { lo, hi: trailingLogLines(lines, closeout) };
      previousCloseout = closeout;
    }
    return newest ? logBlock(lines, newest.lo, newest.hi) : null;
  }

  const closeoutBeforeAnchor = closeouts.filter((index) => index < anchor).at(-1);
  if (closeoutBeforeAnchor !== undefined) {
    // Reverse Display Order: use the result nearest the anchor. Without Setup,
    // reversed opening-hand lines follow the physical turn headers, so retain
    // through the last recognized line instead of truncating at the first turn.
    const hi = setup >= 0 ? setup : lastRecognizedLine(lines, anchor);
    return logBlock(lines, closeoutBeforeAnchor, hi);
  }

  return logBlock(lines, anchor, lastRecognizedLine(lines, anchor));
}

function logBlock(lines: string[], lo: number, hi: number): LogBlock | null {
  if (hi < lo) return null;
  let matches = 0;
  let nonBlank = 0;
  for (let i = lo; i <= hi; i++) {
    const line = lines[i] ?? '';
    if (line.trim()) {
      nonBlank++;
      if (isLogLine(line)) matches++;
    }
  }
  // 70% tolerates a few templates introduced by the Live client between our
  // releases, but makes a prose paragraph with scattered action verbs fail.
  if (nonBlank === 0 || matches / nonBlank < 0.7) return null;
  return { text: lines.slice(lo, hi + 1).join('\n'), matches };
}

function firstAnchorBetween(lines: string[], from: number, through: number): number {
  for (let i = from; i <= through; i++) {
    if (isSetup(lines[i] ?? '')) return i;
  }
  for (let i = from; i <= through; i++) {
    if (isTurnHeader(lines[i] ?? '')) return i;
  }
  return -1;
}

function containsLogAnchor(text: string): boolean {
  return text.split(/\r?\n/).some((line) => isSetup(line) || isTurnHeader(line));
}

function isSetup(raw: string): boolean {
  return /^Setup\s*$/.test(raw.trim());
}

function isTurnHeader(raw: string): boolean {
  return /^(.+)'s Turn\s*$/.test(raw.trim().replace(/[’‘]/g, "'"));
}

function lastRecognizedLine(lines: string[], from: number): number {
  for (let i = lines.length - 1; i >= from; i--) {
    if (isLogLine(lines[i] ?? '')) return i;
  }
  return from - 1;
}

/**
 * A few Live exports append cleanup events immediately after the result (for
 * example an Energy activation resolving as the final Pokémon is knocked out).
 * `isLogLine` is intentionally too broad here: every dash bullet and another
 * `wins.` sentence count as log-shaped there. Keep only client templates seen
 * after real results, only while directly attached, and never a second result.
 * A blank is a conservative hard boundary; this also pins the common
 * result-blank-reader-question shape without guessing whether the prose is Live.
 */
function trailingLogLines(lines: string[], closeout: number): number {
  let end = closeout;
  for (let i = closeout + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim() || isCloseout(line) || !isPostCloseoutLine(line)) break;
    end = i;
  }
  return end;
}

function isPostCloseoutLine(raw: string): boolean {
  const line = raw.replace(/[’‘]/g, "'").trimEnd();
  if (/^.+ was activated\.$/.test(line)) return true;
  if (/^(?:.+|A card) was added to .+'s hand\.$/.test(line)) return true;
  if (/^-\s+.+ (?:drew (?:a card|\d+ cards?|[A-Z].*)|shuffled their deck)\.$/.test(line)) return true;
  // `slowking-vs-beedrill.log` (2026-10-10 harness corpus): Boomerang
  // Energy activates after the result, then reports its attached destination.
  return /^-\s+.+ attached .+ to .+ (?:in the Active Spot|on the Bench)\.$/.test(line);
}

function isCloseout(raw: string): boolean {
  const line = raw.replace(/[’‘]/g, "'").trim();
  return /^(?:(?:All Prize cards taken|Opponent took all of their Prize cards|Opponent conceded)\.\s+)?(.+) wins\.\s*$/.test(line) || /^(.+) conceded\b/.test(line);
}
