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
 * an older game's raw log. `pastedLogCount` reports how many games that
 * message held, so a two-game paste is disclosed rather than silently halved.
 * The raw block is returned verbatim (capped at `RAW_LOG_MAX` = 50,000 chars,
 * the route's own ceiling on `add_battle_log`'s `log` and on `rawLog`), or
 * `null` when nothing matched.
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

/** What one user message holds: the span the channel carries, and how many games. */
interface PastedLogAnalysis {
  /** The span the paste channel carries, or `null` when nothing qualified. */
  block: LogBlock | null;
  /**
   * Games found in the message. Normal display order counts every complete
   * game (the channel carries the last); a reverse-order or unfinished paste
   * is one game.
   */
  games: number;
}

/**
 * The `log` value with which the model says "the log the reader pasted" instead
 * of re-typing it. `adapters/aisdk.ts` re-exports it with the full story; it
 * lives here so `declined.ts` can apply the same substitution rule without
 * importing the adapter (which imports `declined.ts`).
 */
export const PASTED_LOG_SENTINEL = '@pasted';

/**
 * The paste an `add_battle_log` `log` argument stands for, or `null` when it
 * stands for nothing but itself.
 *
 * The ONE substitution rule, shared by the adapter (`applyPastedLog`, which
 * performs it) and the decline memory (`declined.ts`, which must name the game
 * the call actually carried). Two copies would drift, and a drift there would
 * either re-ask a declined game or refuse an undeclined one.
 *
 *   • `@pasted` stands for the paste;
 *   • a >= 200-char prefix of the paste, after whitespace-normalization, is a
 *     log the model tried to re-type and ran out of budget on — it stands for
 *     the paste too. `>= 200` keeps a short coincidence from counting.
 */
export function pasteReferencedBy(log: unknown, paste: string | null | undefined): string | null {
  if (!paste || typeof log !== 'string') return null;
  if (log === PASTED_LOG_SENTINEL) return paste;
  if (log.length < 200) return null;
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  return norm(paste).startsWith(norm(log)) ? paste : null;
}

/**
 * Extract the raw PTCG Live battle log from the replayed conversation, or
 * `null` when no user message contains one.
 *
 * @param messages the replayed message array as `api/chat.mjs` holds it —
 *   `{ role, parts }` (UI messages) or `{ role, content }` (model messages).
 */
export function extractPastedLog(messages: unknown): string | null {
  const paste = newestPaste(messages);
  return paste?.block ? paste.block.text.slice(0, RAW_LOG_MAX) : null;
}

/**
 * How many games the message behind {@link extractPastedLog} held: 0 when there
 * is no paste, 1 for an ordinary paste, N > 1 when one message held N complete
 * games — of which the channel carried only the last.
 *
 * 2026-10-10 (review of #291): one paste channel carries one game by design,
 * but nothing told the model or the reader that the others were left behind,
 * so a two-game paste logged one game and the reader believed both were in.
 * The adapter turns N > 1 into a sentence on the tool result and the approval
 * card. It reads the SAME message `extractPastedLog` does (`newestPaste`), so
 * the count can never describe a different paste from the one carried.
 */
export function pastedLogCount(messages: unknown): number {
  return newestPaste(messages)?.games ?? 0;
}

/**
 * The newest user message's paste, analysed — or `null`.
 *
 * Walking newest-first, the first USER message whose span qualifies wins.
 * 2026-10-10: once the reader's newest message contains a real anchor, it is
 * the paste they are asking about. Falling through used an older game when this
 * paste was truncated or malformed, making `@pasted` silently duplicate
 * history. Fail closed there; the model can ask for a fresh paste.
 */
function newestPaste(messages: unknown): PastedLogAnalysis | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m !== 'object') continue;
    if ((m as { role?: unknown }).role !== 'user') continue;
    const text = messageText(m);
    if (!text) continue;
    const analysis = analyzeLogBlocks(text);
    if (qualifies(analysis.block)) return analysis;
    if (containsLogAnchor(text)) return null;
  }
  return null;
}

/** The size bar a span must clear: >= 8 recognized lines AND >= 400 chars. */
function qualifies(block: LogBlock | null): block is LogBlock {
  return block !== null && block.matches >= 8 && block.text.length >= 400;
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
 * Find an anchor-to-closeout span in `text`, and count the games it held.
 *
 * Live can display a game in reverse order, in which case its closeout is
 * first and Setup is last. In normal order, each anchor following a closeout
 * starts another game and the last complete game wins. One paste channel
 * carries one game; `games` says how many the message held so the reader can
 * be told to paste the others separately. Without a closeout we stop at the
 * last recognized line, preserving the old useful partial-log behavior.
 * Unknown lines inside a span are retained.
 *
 * ── A CLOSEOUT COUNTS ONLY WHEN IT IS ATTACHED TO THE LOG ─────────────────
 *
 * 2026-10-10, reproduced by the #291 review on real logs. "conceded" and
 * "wins." are ordinary English, so reader prose around a paste is full of
 * closeout-shaped lines, and a closeout ANYWHERE used to pick the display
 * order:
 *   • "Kingofslowbros conceded last time.\nHere's tonight's game so far:"
 *     above an unfinished normal-order paste read as REVERSE order: the span
 *     began at the prose and reported a result for a game still in progress;
 *   • "Honestly I should have conceded." a blank line below a reverse paste
 *     without Setup read as NORMAL order: the span ended at the chat and
 *     dropped the real result — and "Kingofslowbros conceded? no, I lost."
 *     flipped it.
 * So a normal-order result must sit under log lines in its own paragraph
 * (`isForwardCloseoutAttached`), a reverse result must lead straight into the
 * log (`isReverseCloseoutAttached`), a reverse game without Setup ends where
 * its run of log paragraphs ends (`endOfReverseRun`) rather than at the last
 * log-shaped line anywhere in the message, and an unfinished game stops
 * before the first detached closeout-shaped sentence below it.
 *
 * Each order's span must still clear the size bar to win; one that does not
 * falls through to the next reading, so a closeout-shaped sentence that
 * closes nothing cannot fail an otherwise good paste.
 */
function analyzeLogBlocks(text: string): PastedLogAnalysis {
  const lines = text.split(/\r?\n/);
  const setup = lines.findIndex((line) => isSetup(line));
  const firstTurn = lines.findIndex((line) => isTurnHeader(line));
  const anchor = setup >= 0 ? setup : firstTurn;
  if (anchor < 0) return { block: null, games: 0 };
  // The physically first anchor of either kind: a normal-order result follows
  // it, a reverse-order result precedes every anchor.
  const firstAnchor = setup >= 0 && firstTurn >= 0 ? Math.min(setup, firstTurn) : anchor;

  const closeouts = lines
    .map((line, index) => (isCloseout(line) ? index : -1))
    .filter((index) => index >= 0);

  // ── Normal display order. Every attached result after the first anchor
  // closes one game. A candidate below the size bar is not a game (a
  // closeout-shaped sentence under a stray anchor in chat), so it neither
  // counts nor displaces the last real one.
  let previousCloseout = -1;
  let newest: LogBlock | null = null;
  let games = 0;
  for (const closeout of closeouts) {
    if (closeout < firstAnchor || !isForwardCloseoutAttached(lines, closeout)) continue;
    const lo = firstAnchorBetween(lines, previousCloseout + 1, closeout);
    previousCloseout = closeout;
    if (lo < 0) continue;
    const candidate = logBlock(lines, lo, trailingLogLines(lines, closeout));
    if (qualifies(candidate)) {
      newest = candidate;
      games++;
    }
  }
  if (newest) return { block: newest, games };

  // ── Reverse Display Order: the attached result nearest the anchor. With
  // Setup the game ends there; without it, at the end of its run of log
  // paragraphs.
  const reverseCloseout = closeouts
    .filter((index) => index < anchor && isReverseCloseoutAttached(lines, index))
    .at(-1);
  if (reverseCloseout !== undefined) {
    const hi = setup >= 0 ? setup : endOfReverseRun(lines, anchor);
    const block = logBlock(lines, leadingLogLines(lines, reverseCloseout), hi);
    if (qualifies(block)) return { block, games: 1 };
  }

  // ── An unfinished game: no attached result. Any closeout-shaped line below
  // the anchor is therefore the reader's sentence, and everything from it on
  // is their chat — stop before it, or the parser reads it as a result.
  const detached = closeouts.find((index) => index > anchor) ?? lines.length;
  const partial = logBlock(lines, anchor, lastRecognizedLine(lines, anchor, detached));
  return { block: partial, games: qualifies(partial) ? 1 : 0 };
}

/**
 * Is this normal-order result part of the log above it?
 *
 * Only when it sits under log lines in its own paragraph: walking up from it, a
 * recognized log line comes before any blank line. Reader chat after a paste
 * starts a paragraph of its own ("…ended their turn.\n\nHonestly I should have
 * conceded."), so a result reached only across a blank, or only through prose,
 * is not one. The walk passes over unrecognized lines, so an unknown Live
 * template directly above a real result still attaches it — the same tolerance
 * a span gives unknown lines everywhere else.
 */
function isForwardCloseoutAttached(lines: string[], closeout: number): boolean {
  for (let i = closeout - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (!line.trim()) return false;
    if (isLogLine(line)) return true;
  }
  return false;
}

/**
 * Is this result the head of a Reverse Display Order log?
 *
 * Only when the log starts right under it: the next non-blank line is a
 * recognized log line (and not a second result), and nothing between it and the
 * nearest anchor below reads as the reader's prose. "Here's tonight's game so
 * far:" between a closeout-shaped sentence and the log is exactly that prose.
 * An unknown Live template sandwiched between log lines is not prose and is
 * tolerated, as it is everywhere else in a span; an unrecognized line at the
 * edge of a paragraph is not.
 *
 * And the stretch above a reverse game's first physical anchor (its LAST turn)
 * never holds the opening — coin flip, opening hands, mulligans sit at the very
 * bottom in reverse order. An opening line there means a normal-order paste
 * under a one-line closeout-shaped preamble, not a reverse game.
 */
function isReverseCloseoutAttached(lines: string[], closeout: number): boolean {
  let nearest = -1;
  for (let i = closeout + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (isSetup(line) || isTurnHeader(line)) {
      nearest = i;
      break;
    }
  }
  if (nearest < 0) return false;
  let first = closeout + 1;
  while (first < nearest && !(lines[first] ?? '').trim()) first++;
  const head = lines[first] ?? '';
  if (!isLogLine(head) || isCloseout(head)) return false;
  for (let i = first; i < nearest; i++) {
    const line = lines[i] ?? '';
    if (!line.trim()) continue;
    if (isOpeningLine(line)) return false;
    if (isLogLine(line)) continue;
    if (!isLogLine(lines[i - 1] ?? '') || !isLogLine(lines[i + 1] ?? '')) return false;
  }
  return true;
}

/**
 * Where a Reverse Display Order game without Setup ends: the last log line of
 * the run that starts at its first physical turn header.
 *
 * Live separates turns with blank lines, so a blank is inside the run when the
 * paragraph after it is log (see `isLogParagraph`). Reader chat after the paste
 * fails that — it is prose, or it is a closeout-shaped sentence, and a reverse
 * game's only result is its first line. Within the run, unknown lines are kept
 * when a log line follows them, and trailing ones are dropped.
 */
function endOfReverseRun(lines: string[], from: number): number {
  let end = from;
  let i = from + 1;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      let next = i + 1;
      while (next < lines.length && !(lines[next] ?? '').trim()) next++;
      if (next >= lines.length || !isLogParagraph(lines, next)) break;
      i = next;
      continue;
    }
    if (isCloseout(line)) break;
    if (isLogLine(line)) end = i;
    i++;
  }
  return end;
}

/**
 * Does the paragraph starting at `start` read as log? At least half its lines
 * recognized, and no closeout-shaped line. A Live turn is a paragraph of
 * recognized lines with the odd unknown template; chat is mostly prose, and a
 * chat line shaped like a result ("I should have conceded.") is never part of a
 * game whose result was already read.
 */
function isLogParagraph(lines: string[], start: number): boolean {
  let matches = 0;
  let total = 0;
  for (let i = start; i < lines.length && (lines[i] ?? '').trim(); i++) {
    const line = lines[i] ?? '';
    if (isCloseout(line)) return false;
    total++;
    if (isLogLine(line)) matches++;
  }
  return matches > 0 && matches * 2 >= total;
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

/** The last recognized line in `[from, before)`, or `from - 1` when there is none. */
function lastRecognizedLine(lines: string[], from: number, before = lines.length): number {
  for (let i = Math.min(before, lines.length) - 1; i >= from; i--) {
    if (isLogLine(lines[i] ?? '')) return i;
  }
  return from - 1;
}

/**
 * An opening line: coin flip, the opening-hand draws, a mulligan
 * (`deck/battlelog.ts`'s SETUP_RE shapes). Normal order puts them before the
 * first turn; reverse order puts them after the last.
 */
function isOpeningLine(raw: string): boolean {
  const line = raw.replace(/[’‘]/g, "'").trim();
  return /^.+ (chose (heads|tails)|won the coin toss|decided to go (first|second)|drew \d+ cards for the opening hand|took a mulligan)\b/.test(line);
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

/**
 * `trailingLogLines` for Reverse Display Order, where the same cleanup events
 * sit directly ABOVE the result. `slowking-vs-beedrill.log` (2026-10-10 harness
 * corpus) reversed lost its Boomerang Energy activation this way: the span
 * began at the result and the two attached lines above it were dropped. Same
 * narrow templates, same attachment rule, walking up instead of down.
 */
function leadingLogLines(lines: string[], closeout: number): number {
  let start = closeout;
  for (let i = closeout - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (!line.trim() || isCloseout(line) || !isPostCloseoutLine(line)) break;
    start = i;
  }
  return start;
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
