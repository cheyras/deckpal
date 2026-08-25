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
 * Three write tools have no `dry_run` at all — `deck_strategy`,
 * `add_battle_log`, `edit_battle_log` — so every call to them is a real write
 * and every call needs approval. That falls out of the rule rather than being a
 * special case, which is why the rule is written this way round.
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
 * HAVE a `dry_run`; for the three that do not, a preview is not expressible and
 * the call needed approval anyway.
 */
export function forcePreview(def: ToolDefinition, input: unknown): unknown {
  if (def.annotations.readOnlyHint) return input;
  const hasDryRun = def.inputSchema ? 'dry_run' in def.inputSchema.shape : false;
  if (!hasDryRun) return input;
  return { ...(input as Record<string, unknown>), dry_run: true };
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
 * `forcePreview` only touches tools that HAVE a `dry_run`. Three write tools do
 * not — `deck_strategy`, `add_battle_log`, `edit_battle_log` — so for those it
 * returns the input unchanged, and running the handler to populate a consent
 * dialog would PERFORM THE VERY WRITE the reader has not yet authorised. That
 * is not a hypothetical: it is one missing line away, and the failure would be
 * silent, because the dialog would still open and still look like it was asking.
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

/** One-line summary of what a tool actually returned, for its chip. */
function summarise(result: ToolResult): string {
  const first = result.text.split('\n', 1)[0] ?? '';
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
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
          : (input: unknown) => requiresApproval(def, input) && !alreadyDeclined(def.name, input),
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
        if (!requiresApproval(def, input)) return;
        if (!canPreviewSafely(def, input)) return;
        try {
          // `forcePreview` again, not a cached value: the coercion and the
          // guard must read the same expression, or a future edit can make them
          // disagree about which arguments were checked.
          const result = await withToolCtx(opts, (ctx: Ctx) =>
            def.handler(forcePreview(def, input), ctx),
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

          // If this call was NOT classified as needing approval, then it is a
          // preview — so make it one, explicitly, rather than trusting a
          // default to agree with the classification.
          const effective = requiresApproval(def, args) ? args : forcePreview(def, args);

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
            const result = await withToolCtx(opts, (ctx: Ctx) => def.handler(effective, ctx));
            const text = clampToolText(result.text, maxChars);
            // BEFORE the clamp would have been wrong: an id cut off by the
            // ceiling is an id the model never saw, and grounding it would let
            // a half-read page license a full grid. Observe exactly what he
            // gets.
            if (!result.isError) opts.grounding?.observe(text);
            opts.onEvent?.({
              phase: result.isError ? 'error' : 'ok',
              ...chip,
              summary: summarise(result),
            });
            return { text, failed: result.isError === true };
          };

          if (!def.annotations.readOnlyHint) {
            ledger.invalidate();
            return (await runOnce()).text;
          }

          const { text, repeated } = await ledger.share(callKey(def.name, effective), runOnce);

          if (repeated) {
            // A REPEAT GETS ITS OWN CHIP, and it says so. The reader watching
            // nine identical rows stack up was watching nine lookups; they
            // should be able to see that eight of them were the same question.
            opts.onEvent?.({ phase: 'ok', ...chip, summary: 'asked again — same answer as before' });
          }
          return text;
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
