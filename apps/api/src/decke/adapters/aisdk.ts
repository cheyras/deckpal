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
 */
export type ToolEvent =
  | { phase: 'start'; id: string; name: string; title: string }
  | { phase: 'ok'; id: string; name: string; title: string; summary: string }
  | { phase: 'error'; id: string; name: string; title: string; summary: string };

export interface AiSdkAdapterOptions extends ToolCtxOptions {
  /**
   * Which tools to expose. Defaults to every read-only tool.
   *
   * Pass a narrower list to give a sub-agent a subset — a research sub-agent
   * must never hold a write tool, and the way to guarantee that is to not hand
   * it one.
   */
  include?: (def: ToolDefinition) => boolean;
  /** Receives the lifecycle events above. Optional; the chips are a UI concern. */
  onEvent?: (e: ToolEvent) => void;
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
export function buildDataTools(opts: AiSdkAdapterOptions): ToolSet {
  const include = opts.include ?? ((d: ToolDefinition) => d.annotations.readOnlyHint);
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
      needsApproval:
        opts.approvals === 'upstream'
          ? false
          : (input: unknown) => requiresApproval(def, input),
      execute: async (args: unknown, { toolCallId }) => {
        const chip = { id: toolCallId, name: def.name, title: def.title };
        opts.onEvent?.({ phase: 'start', ...chip });
        try {
          // If this call was NOT classified as needing approval, then it is a
          // preview — so make it one, explicitly, rather than trusting a
          // default to agree with the classification.
          const effective = requiresApproval(def, args) ? args : forcePreview(def, args);
          const result = await withToolCtx(opts, (ctx: Ctx) => def.handler(effective, ctx));
          const text = clampToolText(result.text, maxChars);
          // BEFORE the clamp would have been wrong: an id cut off by the
          // ceiling is an id the model never saw, and grounding it would let a
          // half-read page license a full grid. Observe exactly what he gets.
          if (!result.isError) opts.grounding?.observe(text);
          opts.onEvent?.({
            phase: result.isError ? 'error' : 'ok',
            ...chip,
            summary: summarise(result),
          });
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
