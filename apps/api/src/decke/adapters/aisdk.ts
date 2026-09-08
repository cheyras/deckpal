/**
 * `ToolDefinition` → the AI SDK's `tool()`. The other front-end onto the same
 * 23 tools the MCP server exposes.
 *
 * `apps/mcp/src/adapters/mcp.ts` is this file's sibling and its mirror: same
 * definitions, different protocol. A tool added for Claude appears for Deck-E in
 * the same commit, because there is now only one place a tool can be added.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * The tool layer is not the magic, and wiring it alone would make things worse
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Worth saying here, where someone will read it while adding a tool: the MCP
 * server is a data layer and a filing cabinet. There is no intelligence in it.
 * `deck_strategy`'s whole contract is "pass markdown to REPLACE the whole
 * guide" — it STORES a strategy guide, it does not write one.
 *
 * So porting the tools without also routing the thinking (`models.ts`) produces
 * a well-informed version of the same disappointment: he reads 604 cards
 * correctly and then has a fast model write the deck plan. The two are one
 * deliverable. Neither ships alone.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * READ-ONLY BY DEFAULT — but the conversation is no longer a default caller
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This heading used to read "READ TOOLS ONLY, until the approval flow exists",
 * and it outlived the condition it named. The approval round-trip HAS been
 * built (`needsApproval` below, and §15e of `ARCHITECTURE.md`), and
 * `api/chat.mjs` now passes `include: () => true`, so all 23 tools reach the
 * conversational model and the write half is held by the SDK rather than
 * filtered out here. A header describing a policy the file's own code
 * contradicts twenty lines later is worse than no header, which is why this
 * says what changed rather than being quietly deleted.
 *
 * `include` still DEFAULTS to read-only, and that default still earns its keep:
 * the deep-tier sub-agents (`deep.ts`) take it as-is, and a write tool reachable
 * from an unattended sub-agent — one with no reader watching a dialog — is a
 * tool that will eventually be called by accident.
 *
 * The filter is on `annotations.readOnlyHint` and NEVER on the verb in the
 * name. That distinction is load-bearing: `set_cart` sounds like a write and
 * only composes an outbound URL; `deck_history` sounds like a read and can roll
 * a deck back.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { allTools, type Ctx, type ToolDefinition, type ToolResult } from '@deckpal/agent-tools';
import { withToolCtx, type ToolCtxOptions } from '../ctx.js';
import { CallLedger, callKey } from '../repeat.js';
import { alreadyDeclinedMessage } from '../declined.js';
import {
  circuitChipSummary,
  circuitMessage,
  circuitOpen,
  circuitOpenLogLine,
} from '../failing.js';
import { NoOpMemo, noOpMessage } from '../noOp.js';
import { ALREADY_TOLD_NOTE, alreadyTold } from '../toldAlready.js';
import { briefArgs } from '../toolArgs.js';

/**
 * A tool-call lifecycle event, for the chip the reader sees.
 *
 * Work is currently indistinguishable from theatre: `thinking` is driven by
 * request latency, so a fabricated answer and a real one look exactly the same
 * while they are being produced. These events are what make the difference
 * visible.
 *
 * EMITTED FROM HERE, not from the model. A chip the model could ask for would
 * be a second surface to fabricate on — "Checking your collection…" with no
 * lookup behind it is strictly worse than no chip, because it manufactures
 * evidence. Every chip corresponds 1:1 to a real invocation of a real handler,
 * by construction, because this is the only code that emits one.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * FIVE PHASES, AND WHY THE LAST TWO WERE ADDED
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The owner sat watching a deep call for 210 seconds with no signal at all — the
 * UI was pixel-identical for 61 of them, by direct frame comparison — and then
 * praised the reply on camera as "a great response". It was a tool-failure
 * message: *"The analyze tool timed out before it could finish reading your full
 * collection…"*. He did not notice it had failed.
 *
 * Two separate defects, and fixing either alone leaves that experience intact:
 *
 *   `progress`  breaks the silence. A running tool says what it is doing while
 *               it does it, so a 210-second wait is legible rather than dead.
 *   `partial`   breaks the lie. A call that hit its wall clock, or its output
 *               budget, or its step cap, returns what it has — and must NOT
 *               resolve as `ok`, because `ok` is the word that let a failure be
 *               praised.
 *
 * `progress` carries the heartbeat AND the narration beat on ONE channel. That
 * is deliberate: one emission point is what keeps the truthfulness rule above
 * enforceable. Everything on it is composed by the server from something the
 * server observed — a tool that really started, a source the provider really
 * reported, prose the sub-agent really produced, or the plain fact that an
 * invocation opened N seconds ago and is still open. There is no code path by
 * which the model can ask for one.
 *
 * `note` is destined for an expandable detail row in the transcript, NEVER for
 * Deck-E's speech bubble. Some of it is sub-agent prose, and the sub-agents are
 * deliberately not written in his voice (see `deep.ts`'s `ANALYST`) — two
 * characters talking over each other in one answer is the failure that rule
 * exists to prevent.
 */
export type ToolEvent =
  | { phase: 'start'; id: string; name: string; title: string; args?: Record<string, unknown> }
  | { phase: 'progress'; id: string; name: string; title: string; note: string; step?: number }
  | { phase: 'ok'; id: string; name: string; title: string; summary: string }
  | {
      phase: 'partial';
      id: string;
      name: string;
      title: string;
      summary: string;
      reason: 'timeout' | 'truncated';
    }
  | { phase: 'error'; id: string; name: string; title: string; summary: string }
  /**
   * The reader already refused this exact call earlier in the conversation, so
   * it was neither run nor asked about again. See `declined.ts`.
   *
   * `declined` was already the transcript's word for a refused call — the
   * CLIENT emits it when somebody answers a dialog with no, and `shapeTools` in
   * `deckeHistory.ts` has always accepted it. This is the same phase reached
   * without a dialog, so a reader scanning their history sees one kind of row
   * for "this did not happen because I said no", however it was decided.
   */
  | { phase: 'declined'; id: string; name: string; title: string; summary: string; args?: Record<string, unknown> };

/**
 * One printing a row could mean, for the picker on the approval card.
 *
 * Not a score and not a ranking. `isPrimary` says which one the catalog calls
 * the default, and `ownedQty` says how many of that printing the reader already
 * has — two facts, both from the database, neither of them a confidence.
 */
export type ApprovalPreviewCandidate = {
  variantId: number;
  kindCode: string;
  label: string;
  isPrimary: boolean;
  ownedQty: number;
};

/**
 * One row of the held write, as the reader will see it.
 *
 * `index` IS THE JOIN KEY back into the held call's `input.items`, and it is
 * load-bearing rather than convenient: without it the browser cannot rebuild an
 * item list comparable to the one the SDK signed, and the "did the reader edit
 * anything?" check has nothing to compare.
 */
export type ApprovalPreviewRow = {
  index: number;
  cardId: string;
  cardName: string;
  setId: string | null;
  number: string | null;
  /**
   * Which bucket this row belongs to. FOUR VALUES AND TWO BUCKETS, never a
   * meter: `stated` and `only-one` need no question, `unstated` and `ambiguous`
   * do, and `unresolvable` is why a card stops being editable. There is no
   * ordering between them and rendering one as "high confidence" is the mistake
   * the design exists to avoid.
   */
  certainty: 'stated' | 'only-one' | 'unstated' | 'ambiguous' | 'unresolvable';
  candidates: ApprovalPreviewCandidate[];
  /** What the server silently resolved to, for an `unstated` row. SHOWN, never written unasked. */
  wouldUseVariantId: number | null;
  /** The resolved printing for a row that needed no question. */
  variantId: number | null;
  variantLabel: string | null;
  mode: 'delta' | 'quantity';
  value: number;
  before: number | null;
  after: number | null;
  clamped: boolean;
};

/**
 * The structured preview of a held write, keyed to the call it belongs to.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * EMITTED FROM HERE, 1:1 WITH A REAL DRY RUN — THE SAME RULE AS THE CHIPS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Every field below comes from a real invocation of the real handler with
 * `dry_run` FORCED. There is no path by which a model can ask for a row to
 * appear on this card, which matters more here than for a chip: this is a
 * consent dialog, and a fabricated row is a fabricated authorisation.
 *
 * ── AND NO CHIP IS EMITTED FOR IT ────────────────────────────────────────────
 *
 * A chip says work happened for the reader. This work happened for the DIALOG,
 * and a chip would put "Log collection changes — would apply 3" in the
 * transcript beside a change nobody has agreed to yet.
 *
 * ── WHEN IT ARRIVES, WHICH IS NOT WHAT THE DESIGN FIRST CLAIMED ──────────────
 *
 * The design note said the SDK awaits `onInputAvailable` before it signs. That
 * is true of `generateText` and FALSE on the path this product runs.
 * `invokeToolCallbacksFromStream` (`ai/dist/index.js:8228-8271`) calls
 * `controller.enqueue(chunk)` FIRST and only then awaits the callback, so the
 * chunk reaches `executeToolsFromStream`, which resolves the approval, signs it
 * (`8097-8127`) and enqueues `tool-approval-request` CONCURRENTLY with the dry
 * run still running. An HMAC does not lose a race to a database round trip: the
 * approval request essentially always reaches the wire first.
 *
 * THE REAL INVARIANT, which does hold, is a property of the browser and not of
 * the SDK:
 *
 *   the await blocks the transform from processing the step's later chunks, so
 *   the stream CANNOT CLOSE until the preview part has been written — and the
 *   client does not open the dialog until the leg's stream has completed
 *   (`useDeckeChat.ts` collects approvals during `streamLeg` and asks after it
 *   returns).
 *
 * So: preview-before-close, and card-after-close. That invariant dies silently
 * the day someone renders an approval card mid-stream, which is a plausible
 * move in the liveness direction the rest of this pass pushes. The client must
 * therefore key on `toolCallId` and never on arrival order, and a gate should
 * assert the preview part precedes the stream's finish part rather than merely
 * appearing.
 *
 * Honest about the cost, too: the dry run does not run "for free while the
 * model streams" — it STALLS THE TAIL of the stream behind the await, so the
 * turn completes 100-400 ms later than it otherwise would. That is a fine price
 * for a populated consent dialog; it is not zero.
 */
export type ApprovalPreview = {
  /** The join key to the approval. `PendingApproval` carries the same id. */
  toolCallId: string;
  tool: string;
  title: string;
  /**
   * The first line of the REAL dry run's result.
   *
   * The keyed replacement for `previewOf()` in `DeckeChat.tsx`, which scanned
   * backwards for the last `ok` chip of any tool and therefore showed the wrong
   * preview on any turn where a read ran after the write was held.
   */
  summary: string;
  /** Did the dry run itself succeed? A failed one still renders the plain dialog. */
  ok: boolean;
  /**
   * May the reader edit this card — strike rows, pick printings, commit part of
   * it?
   *
   * FALSE IS THE SAFE ANSWER and it is taken often: a tool that is not
   * `log_cards`, a dry run that failed, a row that did not resolve. The card
   * then renders as today's plain dialog and the ordinary signed path still
   * works. A broken preview must degrade the UI, never the write.
   */
  editable: boolean;
  rows: ApprovalPreviewRow[];
  /** Rows the planner refused outright, with no candidates to offer. */
  skipped: { index: number; reason: string }[];
};

export interface AiSdkAdapterOptions extends ToolCtxOptions {
  /**
   * Which tools to expose. Defaults to every read-only tool.
   *
   * Pass a narrower list to give a sub-agent a subset — a research sub-agent
   * must never hold a write tool, and the way to guarantee that is to not hand
   * it one.
   */
  include?: (def: ToolDefinition) => boolean;
  /**
   * `callKey`s the reader has explicitly refused earlier in this conversation.
   *
   * A matching call is refused without a dialog and without running — see
   * `declined.ts` for the reader's own complaint about being asked three times
   * for the same thing. Absent means nothing was refused, which is correct for
   * a sub-agent (no reader, no dialog) and for the tests.
   */
  declined?: ReadonlySet<string>;
  /**
   * How many distinct earlier turns each tool has FAILED in, this conversation.
   *
   * Rebuilt per request from the replayed history by `failing.ts`, the same way
   * `declined` is. A tool at or over `CIRCUIT_BUDGET` is not called: the reader
   * watched `battle_logs` 500 across four turns and be re-called every one of
   * them, because the error chips were erased at the turn boundary and the
   * model had no way to know. Absent means nothing has failed — correct for a
   * sub-agent and for the tests.
   */
  failing?: ReadonlyMap<string, number>;
  /**
   * Did the READER's own latest message ask for a retry?
   *
   * The one bypass, and the only thing that closes an open circuit — see
   * `failing.ts`. The model cannot write this sentence; only they can.
   */
  retryRequested?: boolean;
  /**
   * The `<tool>\u0000<summary>` keys of every lookup the READER WAS ALREADY
   * SHOWN in an earlier turn of this conversation.
   *
   * Rebuilt per request from the replayed lookup records by `toldAlready.ts`,
   * the same way `declined` and `failing` are. A call whose summary matches one
   * of these still RUNS and still gets its ordinary `ok` chip — only the
   * model-facing result text is annotated, telling it not to deliver the same
   * answer a second time. The reader watched the same deck summary arrive on
   * five consecutive turns and said so twice. Absent means nothing has been
   * reported yet — correct for a sub-agent and for the tests.
   */
  priorSummaries?: ReadonlySet<string>;
  /**
   * This conversation's id, for the one structured log line a tripped breaker
   * writes. Never used for anything else, and its absence must never suppress
   * the line.
   */
  conversationId?: string;
  /** Receives the lifecycle events above. Optional; the chips are a UI concern. */
  onEvent?: (e: ToolEvent) => void;
  /**
   * Receives the structured preview of a HELD write, before the reader is asked.
   *
   * Optional, and its absence costs nothing: no preview runs at all if nobody
   * is listening, so a sub-agent's tool set does not pay for a dialog it has no
   * way to show.
   */
  onApprovalPreview?: (p: ApprovalPreview) => void;
  /**
   * Did the READER name a printing in their own latest message?
   *
   * When false, a row the resolver classified `stated` is re-opened as a
   * question — because the thing that "stated" it was Deck-E, not them.
   * Measured: he sets a printing on 100 items out of 100 when none was named,
   * and a prompt rule telling him not to moved that number not at all. See
   * `printingSaid.ts`.
   *
   * Defaults to FALSE, which is the safe direction: the cost of asking when
   * they did say is one tap on a picker already on screen; the cost of not
   * asking when they did not is writing a printing they never chose.
   */
  readerNamedPrinting?: boolean;
  /**
   * Collects the card ids these tools return, so `showScreen` can refuse to
   * render an id no tool produced.
   *
   * Fed from the RESULT TEXT of every successful call — the same text the model
   * sees — so the evidence and the claim come from exactly one source. If they
   * ever came from two, the check would eventually be verifying something other
   * than what the model was told.
   */
  grounding?: { observe(text: string): void };
  /**
   * Where the human approval for these tools was obtained.
   *
   * `'here'` (the default) means each write pauses the turn and asks — the
   * conversational path, where there IS a person and a UI to ask with.
   *
   * `'upstream'` means a person has ALREADY approved the operation these tools
   * are being used to carry out, at a coarser boundary, and asking again is not
   * possible.
   *
   * ── WHY THIS EXISTS, AND WHY IT IS NOT A HOLE ────────────────────────────
   *
   * A sub-agent runs inside `streamText`'s own loop with nothing draining an
   * approval channel. So a write tool handed to a sub-agent is not "gated" —
   * it is SUSPENDED FOR EVER. Found by the adversarial pass: the sub-agent
   * composed a strategy guide, called `deck_strategy`, the SDK held the call,
   * the sub-agent reported "stored", and nothing was written. Security-positive
   * and functionally a lie — the exact failure this whole effort exists to
   * remove, reintroduced by the mechanism added to prevent a different one.
   *
   * The fix is to move the question to a boundary where it can be answered, not
   * to answer it automatically. `write_strategy_guide` itself now requires
   * approval, so the human is asked once — "let him write and store a guide for
   * this deck?" — which is the operation they actually understand. The inner
   * `deck_strategy` call is that same approved act, so re-asking would be a
   * question about an implementation detail nobody can evaluate.
   *
   * A sub-agent may still ONLY hold the writes its own approved purpose needs.
   * `include` remains the fence, and it is a narrow one.
   */
  approvals?: 'here' | 'upstream';
  /**
   * Character budget for one tool's output. See `clamp` below.
   * `0` disables truncation — for the analysis tier, which wants everything.
   */
  maxChars?: number;
  /**
   * The raw PTCG Live battle log the READER pasted into this conversation, or
   * `null` when none was found.
   *
   * The paste channel: `add_battle_log` requires re-emitting a pasted 8–15 KB
   * log (~3,000 tokens) as its `log` argument, and the chat model's
   * `maxOutputTokens` is 1,200 — the arithmetic forbids it. The raw log already
   * sits in the USER message the model is answering; `api/chat.mjs` passes this
   * as `() => extractPastedLog(messages)` (see `pastedLog.ts`), and the adapter
   * substitutes it for a call whose `log` is the sentinel `@pasted` (the model
   * declines to re-type it) or a truncated prefix of the paste (the model tried
   * and ran out of budget). See `applyPastedLog` below.
   *
   * OPTIONAL and absent by default — MCP and the sub-agent tool sets pay
   * nothing, and every existing test is unaffected — the substitution is a
   * no-op when nobody supplies a paste.
   */
  pastedLog?: () => string | null;
}

/**
 * How much tool output one call may put into the model's context.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS (spec §8.7)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The MCP's prose was written for Claude's context window and for human pacing
 * — a person reads a 200-row page and scrolls. `search_cards` pages to 200
 * rows; `set_progress` can list every missing card in a set. Twelve steps of
 * that into a fast conversational model, on every turn, is both a quality
 * problem and a cost problem, and the cost one is the sort that is invisible
 * until someone reads `usage`.
 *
 * So the CHAT tier gets a ceiling and the analysis tier does not. 6,000
 * characters is roughly 1,500 tokens — enough for a full `collection_summary`
 * or a couple of dozen card rows, and far short of a 200-row dump.
 *
 * TRUNCATION IS ANNOUNCED, never silent. A model handed a quietly cut list will
 * describe it as the whole list, which is the same failure mode as everything
 * else being fixed here: a confident statement about data that was not actually
 * seen. The replacement text tells him what happened and what to do about it,
 * in words he can also say out loud.
 */
export const DEFAULT_MAX_TOOL_CHARS = 6_000;

export function clampToolText(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) return text;
  // Cut on a line boundary. Half a row reads as data and is not.
  const cut = text.lastIndexOf('\n', maxChars);
  const head = text.slice(0, cut > maxChars * 0.5 ? cut : maxChars);
  const shownLines = head.split('\n').length;
  const totalLines = text.split('\n').length;
  return (
    `${head}\n\n[Cut off here: showing ${shownLines} of ${totalLines} lines. ` +
    `This is NOT the whole result — do not describe it as complete. ` +
    `Narrow the search, or ask for the next page.]`
  );
}

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WRITES: A REAL CONTROL, NOT A PROMPT
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * This codebase twice records the same lesson in the same words — "a prompt is
 * not an enforcement mechanism" — once about `click` and once about trying to
 * stop a model repeating itself by asking it not to. Writing "wait for
 * confirmation before writing" into the system prompt would be a third.
 *
 * `ai@7.0.66` ships a real one. A tool declaring `needsApproval` is NOT
 * EXECUTED until an approval arrives; the SDK emits a `tool-approval-request`
 * chunk carrying an `approvalId` and stops. Verified against the pinned version
 * rather than read from a changelog: with `needsApproval: true` the execute
 * function ran exactly 0 times and the wire carried
 * `{"type":"tool-approval-request","approvalId":"…","toolCallId":"call_w"}`.
 *
 * ── WHAT NEEDS APPROVAL ──────────────────────────────────────────────────────
 *
 * Derived from the annotations and the schema, never from the verb in the name:
 *
 *   destructiveHint          ALWAYS. `delete_deck`, `delete_list`,
 *                            `delete_battle_log`, `revert` — data that is not
 *                            otherwise recoverable.
 *   a real write             ALWAYS. Anything that would actually mutate.
 *   a PREVIEW (dry_run)      No. It changes nothing by contract, and making the
 *                            preview itself need approval would mean the reader
 *                            has to authorise something before being told what
 *                            it would do — which is the opposite of the point.
 *
 * One write tool has no `dry_run` at all — `deck_strategy` — so every call to
 * it is a real write and every call needs approval. That falls out of the rule
 * rather than being a special case, which is why the rule is written this way
 * round. (`add_battle_log` and `edit_battle_log` now HAVE a `dry_run`, so the
 * schema-driven `wouldMutate` / `forcePreview` / `canPreviewSafely` below treat
 * them as previewable exactly like any other dry_run write — see the test that
 * pins it. `deck_strategy` is the lone hold-out because a guide replace has no
 * meaningful "what would change" short of the whole guide.)
 *
 * ── AND THE SERVER FORCES THE PREVIEW ────────────────────────────────────────
 *
 * Belt and braces, and worth the belt. When a call is classified as a preview,
 * `dry_run: true` is written into the arguments EXPLICITLY rather than left to
 * the tool's default. The classification and the coercion then agree by
 * construction: there is no path where this code decided "preview, no approval
 * needed" and the tool received something that mutates — including if a
 * default changes, or a tool is added whose default is the other way.
 */

/** Would this call actually change something? */
export function wouldMutate(def: ToolDefinition, input: unknown): boolean {
  if (def.annotations.readOnlyHint) return false;
  // ── add_battle_log with NO deck_id is a pure read, not a write ─────────────
  //
  // SECURITY FINDING (A): the tool's own contract makes its omitted-deck_id
  // branch a read BY CONSTRUCTION. deckIntel.ts: "OMIT deck_id to rank the log
  // against your decks first … and writes nothing — call it again with deck_id
  // set". That branch calls POST /decks/log-preview (a read), renders ranked
  // candidates, and returns BEFORE `dry_run` is ever consulted — so the call
  // cannot mutate regardless of dry_run. But `wouldMutate` classified on
  // `dry_run` alone (default false), so the reader was shown a consent dialog
  // for a call that is incapable of writing. Misleading consent is the
  // opposite of informed consent, so this returns false for that shape.
  //
  // WHY A NAME-SCOPED SPECIAL CASE IS ACCEPTABLE HERE, mirroring the existing
  // `log_cards`-only editable hard-code in `buildApprovalPreview` (another
  // name-scoped carve-out that exists because a tool's own contract, not a
  // generic rule, decides the shape): the omitted-deck read is a property of
  // the tool's CONTRACT, not a heuristic about the input. The handler takes it
  // before dry_run, so no input value can make that branch write. Narrowly
  // scoped to add_battle_log; `edit_battle_log` requires deck_id+log_id and has
  // no read branch, so it is untouched.
  //
  // `forcePreview` needs no change: for a no-deck_id call it flips dry_run to
  // true (harmless — the handler's read branch ignores dry_run), and the
  // handler takes the same read branch either way.
  if (def.name === 'add_battle_log' && !(input as { deck_id?: unknown } | null | undefined)?.deck_id) {
    return false;
  }
  // ── deck_strategy with NO markdown is a pure read, not a write ─────────────
  //
  // Same class as the `add_battle_log` carve-out above, one tool over, and the
  // same argument: the tool's own contract makes the branch a read BY
  // CONSTRUCTION. `deckIntel.ts` returns the guide text and RETURNS before the
  // `PUT /decks/{id}/strategy` that only a `markdown` argument can reach, so no
  // input value can make that branch write — while `wouldMutate` classified on
  // `dry_run` alone (deck_strategy has none) and returned true for every shape.
  // The reader asked for "the low-down on my deck", a pure read, and was shown
  // "Let him write the strategy guide for this deck?" — a consent dialog for a
  // call incapable of writing, which is the opposite of informed consent.
  //
  // `declined.ts`'s `isGuideWrite` already encodes exactly this rule ("A read
  // (no `markdown`) is a different question and is explicitly NOT suppressed");
  // this file was the only one in the stack that did not know it.
  //
  // THE WRITE SHAPE IS UNTOUCHED: `markdown` present is still always-approval
  // and still unpreviewable (X3, and WS2's "keep deck_strategy always-approval"
  // is about the replace, which is what has no dry_run to preview with).
  if (
    def.name === 'deck_strategy' &&
    (input as { markdown?: unknown } | null | undefined)?.markdown === undefined
  ) {
    return false;
  }
  const hasDryRun = def.inputSchema ? 'dry_run' in def.inputSchema.shape : false;
  if (!hasDryRun) return true;
  const dry = (input as { dry_run?: unknown } | null | undefined)?.dry_run;
  // ANYTHING BUT an explicit `false` is a preview. A missing value, a null, a
  // string "false" from a model that stringified a boolean — none of those may
  // be read as permission to write.
  return dry === false;
}

/** Does this call need the reader to approve it before it runs? */
export function requiresApproval(def: ToolDefinition, input: unknown): boolean {
  if (def.annotations.readOnlyHint) return false;
  if (def.annotations.destructiveHint) return true;
  return wouldMutate(def, input);
}

/**
 * Force a preview to actually be one.
 *
 * Returns the arguments a preview call should run with. Only touches tools that
 * HAVE a `dry_run`; for the one that does not (`deck_strategy`), a preview is
 * not expressible and the call needed approval anyway.
 */
export function forcePreview(def: ToolDefinition, input: unknown): unknown {
  if (def.annotations.readOnlyHint) return input;
  const hasDryRun = def.inputSchema ? 'dry_run' in def.inputSchema.shape : false;
  if (!hasDryRun) return input;
  return { ...(input as Record<string, unknown>), dry_run: true };
}

/**
 * The paste channel — what the model is told instead of being asked to re-type
 * a ~3,000-token log into a 1,200-token output budget.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE SEAM, NEXT TO THE OTHER COERCIONS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `forcePreview` coerces a held write into a dry run; this coerces a
 * paste-referencing `add_battle_log` call into carrying the log the READER
 * already pasted, so the model never re-types it. It sits beside `forcePreview`
 * for the same reason `forcePreview` sits beside `wouldMutate`: the coercion and
 * the classification must read the same expression, and a future edit that
 * changes one without the other is the bug this placement makes visible.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHEN IT SUBSTITUTES — and when it refuses
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Scoped to `add_battle_log` ONLY (the one tool whose `log` argument is a
 * pasted battle log): for any other tool the call passes through untouched,
 * which is the "other tools untouched" property the test pins. Within
 * `add_battle_log`, a `log` argument is substituted when it is either:
 *
 *   • the sentinel `'@pasted'` — the model explicitly declines to re-emit the
 *     log and asks the server to substitute the one in the conversation; OR
 *   • a TRUNCATED PREFIX of the paste — `>= 200` chars that match the extracted
 *     paste after whitespace-normalization (runs of whitespace collapsed to one
 *     space and trimmed). The model tried to paste the log and ran out of
 *     budget; what it sent is a prefix of what the reader did. `>= 200` keeps a
 *     short coincidence ("Setup\nPlayerA's Turn") from counting as a prefix.
 *
 * When the sentinel is used BUT no paste was found this conversation, the call
 * does NOT proceed with the literal `'@pasted'` — that would reach the parser as
 * the string "@pasted" and log garbage. It returns a fail-shaped result telling
 * the model no pasted log was found and to ask the reader to paste one, and the
 * handler is never called. A truncated prefix with no paste is left as the
 * model sent it: there is nothing to substitute, the parser gates on quality,
 * and using the model's (truncated) log is the best available answer.
 */
export const PASTED_LOG_SENTINEL = '@pasted';

/** What the model is told when it sent `@pasted` but no paste was found. */
export const NO_PASTE_FOUND_MESSAGE =
  'No pasted battle log was found in this conversation, so add_battle_log did not run. ' +
  'Ask the reader to paste the full PTCG Live battle log, then call add_battle_log again ' +
  `with log set to ${PASTED_LOG_SENTINEL}.`;

/** The result of {@link applyPastedLog}: either a substituted value or a refusal. */
export type PasteSubstitution =
  | { kind: 'ok'; value: unknown }
  | { kind: 'fail'; message: string };

/**
 * Substitute the reader's pasted log into an `add_battle_log` call, or refuse.
 *
 * Pure and exported so the substitution is unit-testable with a stub handler
 * that records its args (the parser is not the thing under test — the seam is).
 * Called from `execute` and from the forced-preview path in `onInputAvailable`;
 * both thread the `ok` value to the handler and return the `fail` message
 * without calling it.
 *
 * @param def   the tool definition — only `add_battle_log` is touched.
 * @param input the (already-`forcePreview`-coerced) call arguments.
 * @param paste the extracted paste, or `null`/`undefined` when none was found.
 */
export function applyPastedLog(
  def: ToolDefinition,
  input: unknown,
  paste: string | null | undefined,
): PasteSubstitution {
  // ONLY add_battle_log carries a `log` argument the model would paste-trim;
  // every other tool passes through untouched.
  if (def.name !== 'add_battle_log') return { kind: 'ok', value: input };
  const args = input as { log?: unknown } | null | undefined;
  const log = args?.log;
  if (typeof log !== 'string') return { kind: 'ok', value: input };

  // The sentinel: the model declines to re-type and asks the server to
  // substitute. With no paste found, refuse rather than hand the handler the
  // literal string "@pasted" — the handler is never called.
  if (log === PASTED_LOG_SENTINEL) {
    if (!paste) return { kind: 'fail', message: NO_PASTE_FOUND_MESSAGE };
    return { kind: 'ok', value: { ...(args as Record<string, unknown>), log: paste } };
  }

  // A truncated prefix: what the model sent is a >= 200-char prefix of the
  // paste (after whitespace-normalization). Substitute the full text; the
  // parser downstream still gates on quality, but the model meant the whole log.
  if (log.length >= 200 && paste) {
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
    if (norm(paste).startsWith(norm(log))) {
      return { kind: 'ok', value: { ...(args as Record<string, unknown>), log: paste } };
    }
  }
  return { kind: 'ok', value: input };
}

/**
 * What a failed tool is allowed to tell the model.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * A TOOL ERROR IS NOT A LOG LINE — IT GOES INTO THE CONVERSATION
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Whatever this returns lands in the model's context, and the model may well
 * say it out loud. So the bar is higher than for a log, not lower.
 *
 * CodeQL flagged the sibling case on this PR — logging a caught error's
 * `message` where that error can come from `pg` — and the same reasoning
 * applies here with more force. A `pg` connection failure's message is built
 * from the connection parameters (PGHOST/PGUSER/PGPASSWORD), so
 * "password authentication failed for user …" and DSN fragments live in it. The
 * tool path can absolutely raise one: `openRlsSession` runs inside the very
 * first `db.query` a tool makes.
 *
 * Handing that to a language model puts database credentials one "what went
 * wrong?" away from being repeated into a chat transcript.
 *
 * So: OUR OWN errors pass through, because we wrote them and they are written
 * to be said out loud ("that lookup went past 10000 ms, so I stopped waiting
 * for it"). Everything else is reduced to a shape and a code.
 */
export function safeToolError(err: unknown): string {
  // Errors this codebase raises deliberately, phrased for a reader.
  //
  // `ToolHoldTimeout` is allowlisted by CLASS, which is the strong form — a
  // check on message content would pass anything that happened to look
  // friendly. `'aborted'` is matched on its exact text because it is thrown as
  // a plain `Error` in two places (`ctx.ts`'s `abortableApi`, `rls.ts`'s
  // already-aborted guard) and giving it a class purely to be recognised here
  // would be ceremony. An EXACT equality, never a substring: "aborted" is safe
  // to say, and "connection aborted while authenticating as deckpal@10.1.2.3"
  // is not, and only one of them is equal to it.
  if (err instanceof Error && (err.name === 'ToolHoldTimeout' || err.message === 'aborted')) {
    return err.message
  }
  // SHAPE-CHECKED, matching what the meter's log line does. Reading `code`
  // instead of `message` was not enough there and is not enough here: a
  // SQLSTATE is five characters and a syscall code is one word, but nothing
  // guarantees a future driver puts something that short in the field. This
  // surface feeds a MODEL, so it should not have the weaker check of the two.
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code)) {
    return `it failed with ${code}`
  }
  return 'it failed'
}

/**
 * May this call be previewed WITHOUT writing anything?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE GUARD THAT KEEPS THE DIALOG FROM BECOMING THE WRITE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * `forcePreview` only touches tools that HAVE a `dry_run`. One write tool does
 * not — `deck_strategy` — so for it `forcePreview` returns the input unchanged,
 * and running the handler to populate a consent dialog would PERFORM THE VERY
 * WRITE the reader has not yet authorised. That is not a hypothetical: it is
 * one missing line away, and the failure would be silent, because the dialog
 * would still open and still look like it was asking.
 *
 * (`add_battle_log` and `edit_battle_log` gained a `dry_run`, so they are no
 * longer in this set — `forcePreview` flips them to a preview and the handler
 * writes nothing, the same as any other dry_run write. The editable hard-code
 * in `buildApprovalPreview` is unchanged and stays `log_cards`-only: their
 * approval cards populate with the dry run's first line, but the reader cannot
 * strike rows on them.)
 *
 * So the question is not "does this tool have a dry run" — it is the same
 * question `execute` asks, put to the coerced arguments: after `forcePreview`,
 * would this still mutate? If yes, there is no preview to run and the reader
 * gets the plain dialog. The classification and the coercion agree by
 * construction, exactly as they do in `execute`.
 */
export function canPreviewSafely(def: ToolDefinition, input: unknown): boolean {
  return !wouldMutate(def, forcePreview(def, input));
}

/** A number off a parsed structured row, or null. Never `NaN`, never a string. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function candidatesOf(v: unknown): ApprovalPreviewCandidate[] {
  if (!Array.isArray(v)) return [];
  const out: ApprovalPreviewCandidate[] = [];
  for (const raw of v) {
    const c = raw as Record<string, unknown>;
    const variantId = num(c?.variantId);
    if (variantId === null) continue;
    out.push({
      variantId,
      kindCode: str(c.kindCode),
      label: str(c.label) || str(c.kindCode),
      isPrimary: c.isPrimary === true,
      ownedQty: num(c.ownedQty) ?? 0,
    });
  }
  return out;
}

const CERTAINTIES = new Set(['stated', 'only-one', 'unstated', 'ambiguous', 'unresolvable']);

/**
 * Turn `log_cards`' structured echo into the rows the card renders.
 *
 * `log_cards` has always returned a `structured` alongside its text
 * (`ok(text, {items: […]})`), and this adapter has always discarded it, because
 * only `text` goes to the model. This is what it was for.
 *
 * READS `skipped` AS WELL AS THE APPLIED ROWS, which the design's first draft
 * did not and a reviewer caught (finding m-1): the planner's `planned.push`
 * happens only for `status: 'ok'`, so an `ambiguous` row — one of the two kinds
 * that DEFINE the "ask about these" section — is a skip, not a planned row. A
 * skip that carries candidates is a question; a skip that does not is a row
 * nothing can be done about.
 */
function rowsFromLogCards(structured: unknown): {
  rows: ApprovalPreviewRow[];
  skipped: { index: number; reason: string }[];
  wasDryRun: boolean;
} {
  const s = structured as Record<string, unknown> | null | undefined;
  const items = Array.isArray(s?.items) ? s.items : [];
  const rows: ApprovalPreviewRow[] = [];
  const skipped: { index: number; reason: string }[] = [];

  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const index = num(it?.index);
    if (index === null) continue;
    const certainty = CERTAINTIES.has(str(it.certainty))
      ? (str(it.certainty) as ApprovalPreviewRow['certainty'])
      : 'unresolvable';
    const candidates = candidatesOf(it.candidates);
    const cardId = str(it.cardId);

    // A skip with no candidates is not a question — it is a row that cannot be
    // written under any answer, and it belongs in the "these did not resolve"
    // line rather than in a picker with nothing to pick.
    if (it.outcome === 'skipped' && candidates.length === 0) {
      skipped.push({ index, reason: str(it.reason) || 'could not be resolved' });
      continue;
    }

    rows.push({
      index,
      cardId,
      cardName: str(it.cardName) || cardId,
      setId: typeof it.setId === 'string' ? it.setId : null,
      number: typeof it.number === 'string' ? it.number : null,
      certainty,
      candidates,
      wouldUseVariantId: num(it.wouldUseVariantId),
      variantId: num(it.variantId),
      variantLabel: typeof it.variantLabel === 'string' ? it.variantLabel : null,
      mode: it.mode === 'quantity' ? 'quantity' : 'delta',
      value: num(it.value) ?? 0,
      before: num(it.oldQuantity),
      after: num(it.newQuantity),
      clamped: it.clamped === true,
    });
  }

  return { rows, skipped, wasDryRun: s?.dryRun === true };
}

/**
 * A printing Deck-E chose is a PROPOSAL. A printing the reader named is a
 * decision. The resolver cannot tell them apart; here, we can.
 *
 * `stated` means "an explicit printing came in with the call", and for an MCP
 * caller that is the person themselves — nothing to ask. Deck-E is a proxy, and
 * measured he fills that field on 100 items out of 100 when nobody named one.
 * So the row arrives `stated`, the picker never renders, and the reader is never
 * told there was a choice. That is the reported defect, and this is where it is
 * closed — in Deck-E's own adapter, leaving the shared tool correct for callers
 * who really did state it.
 *
 * Re-opening needs candidates to pick from, which is why `resolve.ts` now
 * carries them on `stated` too. A row that somehow arrives without them is left
 * exactly as it was: an empty picker is worse than no picker, and `editable`
 * would refuse the card anyway.
 *
 * `only-one` is NEVER re-opened. There is genuinely nothing to choose, and
 * turning a fact into a question is how a dialog starts feeling like paperwork.
 */
/** Exported for `proxyStated.test.ts`; not part of the adapter's surface. */
export function reopenIfProxyStated(
  row: ApprovalPreviewRow,
  readerNamedPrinting: boolean,
): ApprovalPreviewRow {
  if (readerNamedPrinting) return row;
  if (row.certainty !== 'stated') return row;
  if (row.candidates.length < 2) return row;
  return {
    ...row,
    certainty: 'unstated',
    // The printing he proposed becomes the pre-selection, not the answer.
    wouldUseVariantId: row.wouldUseVariantId ?? row.variantId,
  };
}

/**
 * The whole preview, assembled — including the decision about whether the
 * reader may edit it.
 *
 * `editable` fails CLOSED, in five separate ways, and every one of them lands
 * the reader on the plain dialog with the ordinary signed approval path intact.
 * A card that cannot be trusted to rebuild the batch must not offer to.
 */
function buildApprovalPreview(
  def: ToolDefinition,
  toolCallId: string,
  result: ToolResult,
  readerNamedPrinting: boolean,
): ApprovalPreview {
  const base = {
    toolCallId,
    tool: def.name,
    title: def.title,
    summary: summarise(result),
    ok: !result.isError,
  };
  if (def.name !== 'log_cards' || result.isError) {
    return { ...base, editable: false, rows: [], skipped: [] };
  }
  const { rows: rawRows, skipped, wasDryRun } = rowsFromLogCards(result.structured);
  const rows = rawRows.map((r) => reopenIfProxyStated(r, readerNamedPrinting));
  const editable =
    // The handler must have agreed with us that this was a preview. If it says
    // otherwise, something wrote, and the card is the least of the problems.
    wasDryRun &&
    rows.length > 0 &&
    // A row that did not resolve has no operation to rebuild, so the client
    // cannot construct a batch it is confident in. Plain dialog.
    rows.every((r) => r.certainty !== 'unresolvable') &&
    // Every non-asking row must already name its printing; every asking row
    // must have something to pick from. Either failing means the rows and the
    // classification disagree, which is a bug, not a UI state.
    rows.every((r) =>
      r.certainty === 'unstated' || r.certainty === 'ambiguous'
        ? r.candidates.length > 0
        : r.variantId !== null,
    );
  return { ...base, editable, rows, skipped };
}

/** The chip's length ceiling, shared by both summarisers so they cannot drift. */
const SUMMARY_CAP = 120;

/**
 * One-line summary of a result's TEXT — the first line, capped.
 *
 * Split out from `summarise` below because it has a second caller that has only
 * the text: the already-told annotation compares this turn's summary against
 * the summaries earlier turns replayed, and on a repeat-ledger hit the
 * `ToolResult` object belongs to a call that settled in a different closure.
 * ONE function, so the string the reader was shown and the string compared
 * against it cannot drift apart. (Clamping cannot separate them either: it cuts
 * at `maxChars`, thousands of characters past this cap, and only ever appends.)
 */
export function summariseText(text: string): string {
  const first = text.split('\n', 1)[0] ?? '';
  return first.length > SUMMARY_CAP ? `${first.slice(0, SUMMARY_CAP - 3)}…` : first;
}

/** One-line summary of what a tool actually returned, for its chip. */
function summarise(result: ToolResult): string {
  return summariseText(result.text);
}

/**
 * The same summary for a FAILED result — first line plus what it was leading to.
 *
 * A resolver miss is written as a lead-in and a list. `entities.ts`'s
 * `explainMiss` returns:
 *
 *   No deck is named exactly 'slowking toolbox'. The closest is:
 *   <id> — Toolbox Slowking | …
 *   If that is the one you mean, call this again with its id.
 *
 * The MODEL received all three lines. The reader's chip showed only the first,
 * and the first line's entire job is to introduce the second — so the row read
 * *"The closest is:"* and stopped, which is how it appeared in the transcript
 * and is why the candidate looked missing when it never was. The other
 * `explainMiss` shapes ("Closest:", "Say which by passing its id:") fail the
 * same way.
 *
 * So an error keeps its following lines, joined with ` · `, under the SAME cap
 * as every other chip — the cap is what bounds a chip, not the line count. Only
 * the error path takes this: a successful result's first line is a summary by
 * construction and the rest of it is the payload the panel already shows.
 */
export function summariseError(result: ToolResult): string {
  const lines = result.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return '';
  let out = lines[0]!;
  for (const line of lines.slice(1)) {
    const next = `${out} · ${line}`;
    if (next.length > SUMMARY_CAP) break;
    out = next;
  }
  return out.length > SUMMARY_CAP ? `${out.slice(0, SUMMARY_CAP - 3)}…` : out;
}

/**
 * Build the AI SDK tool set.
 *
 * Every `execute` is wrapped so that a tool CANNOT throw into the stream. A
 * thrown tool kills the turn; a returned error is a sentence the model can
 * react to and recover from — "that lookup timed out, want me to try a narrower
 * search?" is a usable answer and a stack trace is not. This is the same
 * reasoning `runUiTool` carries on the browser side.
 */

/**
 * `{ args }`, or nothing at all.
 *
 * Spread rather than assigned, so a call that genuinely took no arguments
 * carries no `args` key rather than an empty object — the transcript stores
 * this verbatim and `{}` beside `health` would suggest it takes some.
 */
function argsPart(input: unknown): { args?: Record<string, unknown> } {
  const a = briefArgs(input);
  return a ? { args: a } : {};
}

export function buildDataTools(opts: AiSdkAdapterOptions): ToolSet {
  const include = opts.include ?? ((d: ToolDefinition) => d.annotations.readOnlyHint);
  // ONE PER TOOL SET, which is one per request — never module state. A sub-agent
  // builds its own tool set and gets its own ledger, and nothing here is shared
  // between users or between requests. That isolation is the difference between
  // a cache and a cross-account read.
  const ledger = new CallLedger();
  // Empty when the caller does not supply one, which means "nothing was ever
  // refused" — the right default for a sub-agent, which has no reader and no
  // dialog, and for the tests.
  const declined = opts.declined ?? new Set<string>();
  const alreadyDeclined = (name: string, input: unknown): boolean =>
    declined.size > 0 && declined.has(callKey(name, input));
  // ── AND WHAT HAS BEEN FAILING ALL CONVERSATION ────────────────────────────
  //
  // Same shape as `declined` above and for the same reason: rebuilt per request
  // from the replayed history, never held between them. Empty for a sub-agent,
  // which has no conversation to have failed in.
  const failing = opts.failing ?? new Map<string, number>();
  const retryRequested = opts.retryRequested === true;
  // ── AND WHAT THEY HAVE ALREADY BEEN SHOWN ─────────────────────────────────
  //
  // Third of the same shape, and the last: rebuilt per request from the
  // replayed lookup records, never held between them. Empty for a sub-agent,
  // which has no reader to have told anything to.
  const told = opts.priorSummaries ?? new Set<string>();
  // ONE LOG LINE PER TOOL PER REQUEST. A breaker that trips on three calls in
  // one turn is one outage, and three identical lines is three times the noise
  // for the same fact.
  const circuitLogged = new Set<string>();
  /**
   * "Would this write change anything?", memoised for this request.
   *
   * Read by `needsApproval` and by `execute`, exactly as `alreadyDeclined` is
   * and for the identical reason — see `noOp.ts` for the recording behind it.
   * Every failure resolves to `false`, so the worst this can do is leave the
   * dialog exactly where it was.
   */
  const noOp = new NoOpMemo();
  const isNoOpWrite = (name: string, input: unknown): Promise<boolean> =>
    noOp.isNoOpWrite(name, input, (fn) => withToolCtx(opts, fn));
  const maxChars = opts.maxChars ?? DEFAULT_MAX_TOOL_CHARS;
  const out: ToolSet = {};

  for (const def of allTools()) {
    if (!include(def)) continue;

    out[def.name] = tool({
      description: def.description,
      // The tools' own zod objects, unchanged. `health` genuinely has no
      // schema; the SDK requires one, so it gets an empty object — which is
      // what the MCP wire already advertises for it anyway.
      inputSchema: def.inputSchema ?? z.object({}),
      // THE CONTROL. A tool that would mutate is not executed until the reader
      // approves it — enforced by the SDK, not requested in a prompt. A preview
      // passes straight through, because being made to authorise something
      // before being told what it would do is the opposite of informed consent.
      // `upstream` means a human already approved this operation at a coarser
      // boundary and there is no channel here to ask on — see `approvals`. It
      // is never the default, and never reachable from the conversational path.
      // ── AND A CALL THEY ALREADY REFUSED IS NOT ASKED AGAIN ──────────────
      //
      // `false` here does NOT mean "run it" — `execute` refuses it below. It
      // means "do not raise a dialog", which is the whole complaint: the reader
      // was shown the same `deck_strategy` panel on three consecutive turns
      // having declined it each time, and said so in the chat.
      //
      // The pair has to stay in step. `needsApproval` false with an `execute`
      // that did NOT check would silently perform an unapproved write, so the
      // two read the same predicate and there is a test for it.
      needsApproval:
        opts.approvals === 'upstream'
          ? false
          : async (input: unknown) => {
              if (!requiresApproval(def, input)) return false;
              if (alreadyDeclined(def.name, input)) return false;
              // AND NOT FOR A WRITE THAT CHANGES NOTHING. `noOp.ts` carries the
              // measurement: asked for insights about a deck, he read the
              // stored strategy guide and proposed saving it back byte for
              // byte, which put a consent dialog in front of the reader for a
              // no-op. Consent is for consequences.
              return !(await isNoOpWrite(def.name, input));
            },
      /**
       * RUN THE DRY RUN FOR THE DIALOG, HERE, BEFORE ANYONE IS ASKED.
       *
       * The reader has to be told what a write would do in order to consent to
       * it, and the previous answer to that — hope he narrates it — produced a
       * measured turn in which he said NOTHING AT ALL and the dialog read "Let
       * him log cards?" with no numbers under it. A consent dialog whose
       * content depends on a model remembering to speak is a consent dialog
       * that will sometimes be blank.
       *
       * The other rejected answer was to tell him to preview first. That
       * sentence was deleted on 2026-08-22 because it stopped him calling the
       * write tool at all (0/15 → 21/30 once removed), and a test asserts its
       * absence. So this runs the preview WITHOUT the model: deterministically,
       * for every held write, with no prompt change and no extra leg.
       *
       * Four guards, in order, and none of them is decoration:
       *   • nobody listening        → do no work at all.
       *   • `upstream` approvals    → nothing is held here, so nothing is asked.
       *   • not held               → a preview is not held, and previewing a
       *                              preview would be a second identical query.
       *   • cannot preview safely   → `canPreviewSafely`, which is the guard
       *                              that stops this from performing the write
       *                              it exists to describe.
       *
       * And the whole thing is wrapped: a preview that throws must NEVER take
       * the held call down with it. The card falls back to the plain dialog and
       * the write is still approvable.
       */
      onInputAvailable: async ({ input, toolCallId }) => {
        const emit = opts.onApprovalPreview;
        if (!emit) return;
        if (opts.approvals === 'upstream') return;
        // ALREADY REFUSED — no dialog will open, so a preview here is work
        // against the reader's data for a question they closed, and the card it
        // emits is an orphan no approval will ever match. `execute` below states
        // that a declined call "must not run even as a dry run"; this is the
        // other half of that sentence, and it was missing.
        if (alreadyDeclined(def.name, input)) return;
        if (!requiresApproval(def, input)) return;
        if (!canPreviewSafely(def, input)) return;
        // ── THE PASTE CHANNEL (preview half) ──────────────────────────────────
        //
        // Same substitution as `execute` below, on the dry run that populates
        // the approval card: a `@pasted` or truncated-prefix `log` is replaced
        // with the reader's pasted log before the handler runs, so the card
        // shows the real log rather than the literal "@pasted". When the
        // sentinel was used but no paste was found, skip the preview — `execute`
        // will return the fail result and the card falls back to the plain
        // dialog, exactly as a preview that could not run does.
        const previewInput = forcePreview(def, input);
        const pastedPreview = opts.pastedLog;
        const subPreview: PasteSubstitution = pastedPreview
          ? applyPastedLog(def, previewInput, pastedPreview())
          : { kind: 'ok', value: previewInput };
        if (subPreview.kind === 'fail') return;
        try {
          // `forcePreview` again, not a cached value: the coercion and the
          // guard must read the same expression, or a future edit can make them
          // disagree about which arguments were checked.
          const result = await withToolCtx(opts, (ctx: Ctx) =>
            def.handler(subPreview.value, ctx),
          );
          emit(buildApprovalPreview(def, toolCallId, result, opts.readerNamedPrinting === true));
        } catch {
          // Deliberately silent, and deliberately not an `onEvent`. A chip for
          // a failed dialog-preview would tell the reader a tool failed when
          // the tool they asked about has not run yet.
        }
      },
      execute: async (args: unknown, { toolCallId }) => {
        const chip = { id: toolCallId, name: def.name, title: def.title };
        // ARGS ON THE START EVENT, and only there — the client carries them
        // forward across later phases. They are what makes the transcript able
        // to answer 'with WHAT', which is where every defect this pass fixed
        // actually lived. Bounded by `briefArgs`; see `toolArgs.ts`.
        opts.onEvent?.({ phase: 'start', ...chip, ...argsPart(args) });
        try {
          // REFUSED HERE, not executed and not asked. The counterpart to
          // `needsApproval` above: that stops the dialog, this stops the work.
          // Checked BEFORE the preview coercion, because a call they refused
          // must not run even as a dry run — a preview is still a query against
          // their data on their behalf, for a question they closed.
          if (alreadyDeclined(def.name, args)) {
            const message = alreadyDeclinedMessage(def.name);
            opts.onEvent?.({
              phase: 'declined',
              ...chip,
              summary: 'already declined — not asked again',
              ...argsPart(args),
            });
            return message;
          }

          // ── AND A TOOL THAT HAS BEEN DOWN ALL CONVERSATION IS NOT CALLED ──
          //
          // Placed HERE, immediately after the decline short-circuit, because
          // that block is the proven pattern for this exact job: it emits its
          // own chip AND returns its own model-visible string, both BEFORE the
          // handler runs, so no backend call is made and both surfaces tell the
          // same truth.
          //
          // Measured: `battle_logs` returned "Internal server error" on four
          // turns and was re-called on every one of them, once in the turn
          // straight after Deck-E promised to stop. It was not disobeying — the
          // error chips were erased at the turn boundary, so nothing in its
          // context said the tool had ever failed. See `failing.ts`.
          //
          // X2: the chip is `error`, never `ok`, and its summary says the call
          // was NOT made. The trip is a real event; a fabricated success would
          // not be.
          if (circuitOpen(failing, def.name, retryRequested)) {
            const failures = failing.get(def.name) ?? 0;
            if (!circuitLogged.has(def.name)) {
              circuitLogged.add(def.name);
              // REPORTING v1, and the whole of it: one structured line into
              // Vercel's error stream. The reader asked for a mechanism to
              // report a tooling bug; this is the operator's half of it, and
              // `circuitMessage` is the reader's.
              console.error(circuitOpenLogLine(def.name, failures, opts.conversationId));
            }
            opts.onEvent?.({
              phase: 'error',
              ...chip,
              summary: circuitChipSummary(def.name, failures),
              ...argsPart(args),
            });
            return circuitMessage(def.name, failures);
          }

          // NOT EXECUTED EITHER, and this is the half that keeps the pair in
          // step: `needsApproval` returned false for this call, so nothing
          // held it — running it here would be an unapproved write. It is a
          // no-op by construction, but "it would not have mattered" is not the
          // standard this boundary is held to. The memo means this costs no
          // second round trip; it is the same answer `needsApproval` got.
          if (await isNoOpWrite(def.name, args)) {
            opts.onEvent?.({
              phase: 'ok',
              ...chip,
              summary: 'nothing to change — already says exactly that',
              ...argsPart(args),
            });
            return noOpMessage(def.name);
          }

          // If this call was NOT classified as needing approval, then it is a
          // preview — so make it one, explicitly, rather than trusting a
          // default to agree with the classification.
          const effective = requiresApproval(def, args) ? args : forcePreview(def, args);

          // ── THE PASTE CHANNEL (execute half) ────────────────────────────────
          //
          // Substitute the reader's pasted log into an `add_battle_log` call
          // before the handler runs — see `applyPastedLog`. ONE seam, read here
          // and in the forced-preview path above, so a future edit that changes
          // the substitution changes both or neither. When the sentinel was sent
          // but no paste was found, refuse WITHOUT calling the handler: return
          // the fail message so the model can ask the reader to paste the log,
          // and never hand the parser the literal string "@pasted".
          const pasted = opts.pastedLog;
          const sub: PasteSubstitution = pasted
            ? applyPastedLog(def, effective, pasted())
            : { kind: 'ok', value: effective };
          if (sub.kind === 'fail') {
            opts.onEvent?.({ phase: 'error', ...chip, summary: 'no pasted log found this conversation' });
            return sub.message;
          }
          const runEffective = sub.value;

          // ── ASKED ALREADY? ───────────────────────────────────────────────
          //
          // Only reads take this path. A write is always executed — "add one
          // more" twice is two adds — and it drops the ledger, because every
          // read taken before it may now be stale. See `repeat.ts` for the
          // measurements this exists for (the same failing call up to 14 times
          // in one turn, twice ending a turn with no answer at all).
          //
          // `readOnlyHint` and not the verb in the name: `set_cart` only
          // composes a URL and is a read, `deck_history` can roll a deck back
          // and is a write. `registry.ts` says so and this is why it is
          // required there.
          const runOnce = async (): Promise<{ text: string; failed: boolean }> => {
            const result = await withToolCtx(opts, (ctx: Ctx) => def.handler(runEffective, ctx));
            const text = clampToolText(result.text, maxChars);
            // BEFORE the clamp would have been wrong: an id cut off by the
            // ceiling is an id the model never saw, and grounding it would let
            // a half-read page license a full grid. Observe exactly what he
            // gets.
            if (!result.isError) opts.grounding?.observe(text);
            opts.onEvent?.({
              phase: result.isError ? 'error' : 'ok',
              ...chip,
              // A FAILURE KEEPS ITS FOLLOWING LINES. `summarise` cuts to the
              // first line, and a resolver miss's first line is a colon-ended
              // lead-in whose whole job is to introduce the candidates — the
              // reader saw "The closest is:" and nothing after it. See
              // `summariseError`.
              summary: result.isError ? summariseError(result) : summarise(result),
            });
            return { text, failed: result.isError === true };
          };

          if (!def.annotations.readOnlyHint) {
            ledger.invalidate();
            // AND THE NO-OP MEMO, for the same reason and on the same trigger:
            // a guide that matched before an edit does not match after one, and
            // a stale "that would change nothing" would drop a real edit.
            noOp.invalidate();
            return (await runOnce()).text;
          }

          const { text, repeated } = await ledger.share(callKey(def.name, runEffective), runOnce);

          if (repeated) {
            // A REPEAT GETS ITS OWN CHIP, and it says so. The reader watching
            // nine identical rows stack up was watching nine lookups; they
            // should be able to see that eight of them were the same question.
            opts.onEvent?.({ phase: 'ok', ...chip, summary: 'asked again — same answer as before' });
          }

          // ── AND A RUN OF DIFFERENT CALLS THAT ALL FIND NOTHING ────────────
          //
          // The ledger above catches the same call made twice. This catches
          // five DIFFERENT wordings of a question the tool was never going to
          // answer — measured, and the reason one turn spent its whole budget
          // rewording "hidden gem" instead of researching it.
          //
          // "Empty" is judged HERE rather than inside the ledger because only
          // the tool knows what its own nothing looks like: every one of these
          // says so in its first line, which is the same line `summarise` reads
          // for the chip.
          const emptyish = /^no (?:cards|sets?|decks|lists|battle logs)\b|found nothing/i.test(
            text.trimStart(),
          );
          const nudge = ledger.noteEmptiness(def.name, emptyish);

          // ── AND AN ANSWER THEY HAVE ALREADY BEEN GIVEN ────────────────────
          //
          // The two guards above are both PER LEG. This one is the only thing
          // in `execute` that can see across a turn boundary on a SUCCEEDING
          // tool, and that is the gap the transcript fell through: `decks`
          // returned the same summary on turns 3, 4, 5, 6 and 7 — never once
          // failing, so the breaker above could not open — and the same deck
          // stats were narrated to the reader every one of those turns. They
          // said so twice. See `toldAlready.ts`.
          //
          // X2: THE CHIP IS NOT TOUCHED. The lookup really ran and `ok` is the
          // truth about it; this rides on the MODEL's copy of the result only,
          // and nothing here reaches the transcript. It is also not a turn-end
          // guard, so it does not spend the one-note-per-turn budget
          // (`guardFired`) — it is a property of this result, not an admission
          // about the turn.
          const restated = alreadyTold(told, def.name, summariseText(text))
            ? ALREADY_TOLD_NOTE
            : '';
          return `${text}${nudge ?? ''}${restated}`;
        } catch (err) {
          // A message, not an object: this string goes straight into the
          // model's context, and it should read like something that happened
          // rather than like a serialised exception.
          const message = safeToolError(err);
          opts.onEvent?.({ phase: 'error', ...chip, summary: message });
          return `That did not work: ${message}`;
        }
      },
    });
  }

  return out;
}

/**
 * The same list, as `{name, title}` for the system prompt.
 *
 * Generated from the definitions rather than typed into the prompt, so a tool
 * that is added, removed or renamed cannot leave the prompt describing a
 * capability he does not have — which is precisely how he came to spend every
 * turn offering to look things up with no tool that could look.
 */
export function dataToolSummary(opts?: {
  include?: (def: ToolDefinition) => boolean;
}): { name: string; title: string }[] {
  const include = opts?.include ?? ((d: ToolDefinition) => d.annotations.readOnlyHint);
  return allTools()
    .filter(include)
    .map((d) => ({ name: d.name, title: d.title }));
}
