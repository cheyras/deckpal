import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { allTools, deckeImprovementTools, type Ctx, type ToolDefinition, type ToolResult } from '@deckpal/agent-tools';

/**
 * The MCP adapter — the ONLY place in DeckPal that knows the tool layer is
 * being spoken to over MCP.
 *
 * Everything here used to be spread across nine `tools/*.ts` modules: each one
 * imported `McpServer` for its `register*Tools(server, ctx)` signature, called
 * `server.registerTool(...)` per tool, and returned MCP's `CallToolResult` from
 * `ok()`/`fail()`. That is three protocol details and no more — the other
 * ~4,000 lines were SQL, REST calls and text rendering. Collapsing those three
 * into this file is what let the tools move to `@deckpal/agent-tools` unchanged,
 * and it is what lets a second adapter exist without a second copy of them.
 */

/**
 * `ToolResult` → MCP's wire result.
 *
 * `text` becomes the single text content block and `isError` passes through.
 * **`structured` deliberately does NOT become `structuredContent`.** That needs
 * the paragraph below, because it used to and the change is a visible one.
 *
 * ── WHY `structuredContent` IS NOT SENT ──────────────────────────────────────
 *
 * Eleven tools pass a second argument to `ok()` — `search_cards`, `get_card`,
 * `set_progress`, `collection_log`, `mutation_history`, `health` and the rest.
 * Every one of those was answering a client with its METADATA AND NOTHING ELSE.
 * Observed directly, 2026-08-23, against production:
 *
 *   search_cards("charizard")  →  {"total":125,"page":1,"pageSize":3}
 *   get_card("me05-084")       →  {"cardId":"me05-084","variantCount":3}
 *   set_progress("me05")       →  {"set":"me05","goal":"complete","missing":50}
 *
 * Not one card, in the tool the whole catalogue is searched through. Meanwhile
 * `decks`, `lists`, `battle_logs`, `deck_history` and `collection_summary` —
 * the five that pass no metadata — returned their full rendered text. Same
 * client, same session, same round trip. The presence of `structuredContent`
 * is the only variable.
 *
 * **The server was not at fault and neither is the SDK.** `projectCallToolResult`
 * in `@modelcontextprotocol/server` only ever APPENDS to `content`; it has no
 * path that drops it. Both blocks went out on the wire. A client is then free to
 * decide which one it shows, and at least one major one shows the structured
 * half — reasonably, since `structuredContent` normally travels with an
 * `outputSchema` that says what it means.
 *
 * **No tool here declares an `outputSchema`.** So the structured payload was
 * unlabelled, unvalidated, and a client had nothing to interpret it with.
 *
 * ── AND NOTHING IS LOST BY DROPPING IT ───────────────────────────────────────
 *
 * Every field any of the eleven put in there is ALREADY IN THE TEXT: the paging
 * numbers come from `pagingFooter`, `missing` from the "missing for 'complete'
 * (50)" line, `cardId`/`variantCount` from the identity and variant lines. It
 * was pure redundancy, and the redundancy was costing the answer.
 *
 * The INTERNAL `ToolResult.structured` is untouched and still carries data —
 * Deck-E's AI-SDK adapter reads it to render `log_cards` rows
 * (`apps/api/src/decke/adapters/aisdk.ts`). That path never goes near MCP and
 * was never affected by this; Deck-E has always received `result.text` in full.
 *
 * **If it comes back, it comes back with an `outputSchema`**, so a client knows
 * what it is holding and the text is not competing with an unlabelled blob.
 */
export function toCallToolResult(result: ToolResult): CallToolResult {
  return {
    content: [{ type: 'text', text: capText(result.text) }],
    ...(result.isError ? { isError: true } : {}),
  };
}

/**
 * The most text one tool result may put in a model's context (~25k tokens).
 *
 * A BACKSTOP, not the budget. Every list-shaped tool pages on its own, and
 * `pnpm mcp:audit --responses` measures each of them against the budgets in
 * apps/mcp/audit/responses.mjs; nothing a tool returns by default comes near
 * this. It exists for the case nobody measured — a field with no upper
 * bound, a new tool — so that a result is cut here, visibly and with a way
 * forward, rather than by the client, silently, or not at all.
 */
export const RESULT_TEXT_MAX = 100_000;

function capText(text: string): string {
  if (text.length <= RESULT_TEXT_MAX) return text;
  const note =
    `\n\n[deckpal-mcp cut this result at ${RESULT_TEXT_MAX.toLocaleString('en-US')} of ` +
    `${text.length.toLocaleString('en-US')} characters. Ask for less: a smaller page_size, a narrower filter, or one item.]`;
  return text.slice(0, RESULT_TEXT_MAX - note.length) + note;
}

/**
 * The annotations a client is shown, per the MCP spec (2025-11-25 schema).
 *
 * Three places where DeckPal's own `ToolAnnotations` and the spec differ, all
 * resolved here rather than in the definitions, because Deck-E reads the
 * definitions too:
 *
 *  - `destructiveHint`: the spec's means "may perform destructive updates"
 *    (anything but purely additive) and DEFAULTS TO TRUE when omitted;
 *    DeckPal's means "can destroy what is not otherwise recoverable", which
 *    is what Deck-E's always-approve rule keys on. Advertised as the OR of
 *    DeckPal's flag and `overwriteHint`, explicitly, on every write tool.
 *  - `openWorldHint`: the spec's default is TRUE. Every DeckPal tool works on
 *    DeckPal's own data, so it is advertised as false unless a tool says so.
 *  - `title`: the spec puts a top-level `title` on the tool (2025-06-18) and
 *    keeps `annotations.title` for older clients — the SDK still negotiates
 *    2025-03-26 and 2024-11-05, which only know the latter. Both are sent.
 *
 * `destructiveHint` and `idempotentHint` are "meaningful only when readOnlyHint
 * is false", so a read tool advertises neither.
 */
export function wireAnnotations(tool: ToolDefinition): McpToolAnnotations {
  const a = tool.annotations;
  return {
    title: tool.title,
    readOnlyHint: a.readOnlyHint,
    ...(a.readOnlyHint
      ? {}
      : { destructiveHint: Boolean(a.destructiveHint || a.overwriteHint), idempotentHint: a.idempotentHint ?? false }),
    openWorldHint: a.openWorldHint ?? false,
  };
}

/** MCP's ToolAnnotations (all optional on the wire). */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * The tool's zod schema, advertised without its `$schema` line.
 *
 * zod writes `"$schema": "https://json-schema.org/draft/2020-12/schema"` at
 * the top of every schema it converts, and tools/list carried it 27 times —
 * about 1,500 characters a turn that say nothing: the MCP spec makes 2020-12
 * the default dialect when `$schema` is absent ("Schema Dialect", basic
 * protocol, 2025-11-25). Only the JSON Schema the SDK derives is changed.
 * Validation still runs through zod's own `~standard.validate`, so defaults,
 * transforms and refinements are exactly what they were.
 */
type ZodLike = NonNullable<ToolDefinition['inputSchema']>;
interface StandardJsonSchema {
  input: (options: unknown) => Record<string, unknown>;
  output: (options: unknown) => Record<string, unknown>;
}
const advertised = new WeakMap<ZodLike, ZodLike>();
export function advertisedSchema(schema: ZodLike): ZodLike {
  const cached = advertised.get(schema);
  if (cached) return cached;
  const standard = (schema as unknown as { '~standard': Record<string, unknown> & { jsonSchema?: StandardJsonSchema } })['~standard'];
  const json = standard.jsonSchema;
  if (!json) return schema;
  const strip = (out: Record<string, unknown>) => {
    const { $schema: _dialect, ...rest } = out;
    return rest;
  };
  const wrapped = { ...standard, jsonSchema: { input: (o: unknown) => strip(json.input(o)), output: (o: unknown) => strip(json.output(o)) } };
  const proxy = new Proxy(schema, {
    get: (target, prop, receiver) => (prop === '~standard' ? wrapped : Reflect.get(target, prop, receiver)),
  });
  advertised.set(schema, proxy);
  return proxy;
}

/**
 * Register every tool on a fresh `McpServer`.
 *
 * The two branches are not stylistic. The SDK's callback signature depends on
 * whether a config carries an `inputSchema`: with one the handler is called as
 * `(args, serverCtx)`, without one as `(serverCtx)` — the FIRST argument is the
 * server context, not an empty args object. `health` is the no-argument tool
 * (SPEC §5 #1), so registering it through the with-args branch would hand its
 * handler the server context in the position where it expects its arguments.
 * Branching on `inputSchema` keeps that impossible rather than merely unlikely.
 *
 * What is advertised is derived from the definition, not copied: the
 * annotations through {@link wireAnnotations} (MCP's meanings and defaults
 * differ from DeckPal's in three places) and the schema through
 * {@link advertisedSchema} (zod's `$schema` line removed). Validation still
 * runs on the tool's own zod object.
 */
export interface ToolVisibility {
  readOnly?: boolean;
  deckeImprovementRead?: boolean;
}

const IMPROVEMENT_TOOLS = new Set([
  'decke_improvement_list',
  'decke_improvement_read',
  'decke_improvement_search',
]);

export function registerAllTools(server: McpServer, ctx: Ctx, { readOnly = false, deckeImprovementRead = false }: ToolVisibility = {}): void {
  for (const tool of [...allTools(), ...deckeImprovementTools]) {
    // A read-only connection (migration 075) is never shown a tool that
    // writes, so a model cannot even try one. `readOnlyHint` is required on
    // every definition (registry.ts), so nothing slips through by omission.
    if (readOnly && !tool.annotations.readOnlyHint) continue;
    // This is an advertised-surface gate only. The API/SQL reader independently
    // checks the live token row on every call, so revoking the capability takes
    // effect even for a client holding a previously cached tool catalogue.
    if (IMPROVEMENT_TOOLS.has(tool.name) && !deckeImprovementRead) continue;
    register(server, ctx, tool);
  }
}

function register(server: McpServer, ctx: Ctx, tool: ToolDefinition): void {
  const base = {
    title: tool.title,
    description: tool.description,
    annotations: wireAnnotations(tool),
  };

  if (tool.inputSchema === undefined) {
    server.registerTool(tool.name, base, async () => toCallToolResult(await tool.handler({}, ctx)));
    return;
  }

  server.registerTool(
    tool.name,
    { ...base, inputSchema: advertisedSchema(tool.inputSchema) },
    async (args) => toCallToolResult(await tool.handler(args, ctx)),
  );
}
