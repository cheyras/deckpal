import type { z } from 'zod';
import type { Ctx } from './ctx.js';
import type { ToolResult } from './result.js';

/**
 * What a DeckPal tool IS, independent of who is calling it.
 *
 * ## Why this exists
 *
 * Until this package the tools were defined by calling
 * `server.registerTool(name, config, handler)` inside
 * `register*Tools(server, ctx)`. That shape bakes in two things that turned out
 * to be separate concerns wearing one coat:
 *
 *  1. **The protocol.** `registerTool` is MCP's API and the handler had to
 *     return MCP's `CallToolResult`. Nothing else about the tools is
 *     MCP-specific — they are SQL and REST calls that render compact text.
 *  2. **The identity.** `ctx` was a *closure* variable, captured when
 *     `register*Tools` ran. That is only correct because the MCP server is
 *     rebuilt per request (stateless HTTP, SPEC §2): a fresh `McpServer` and a
 *     fresh registration for every single call, precisely so the closure could
 *     hold the right user. Cheap, but it means the tool list cannot be built
 *     once and shared — and a chat agent that wants the tool catalogue to
 *     answer "what can I do?" would have to invent a context to get one.
 *
 * A `ToolDefinition` takes `ctx` as a handler *parameter* instead. One list of
 * definitions, built at module load, serves every request for every user; the
 * caller supplies the identity at call time. That is what makes
 * `allTools()` a constant rather than a factory, and it is the whole reason the
 * MCP adapter can register the same values the AI SDK adapter exposes.
 *
 * ## What did NOT change
 *
 * `inputSchema` is still the zod object the tools already passed to
 * `registerTool` — not a raw shape, not a re-derived JSON Schema. The SDK
 * accepts a `ZodObject` directly and derives the advertised JSON Schema from it,
 * so handing it the identical object keeps the advertised tool schema
 * byte-identical. `annotations` is passed through unchanged for the same reason.
 */

/**
 * Behaviour hints, structurally identical to MCP's `ToolAnnotations` but
 * declared here so this package does not depend on the MCP SDK.
 *
 * `readOnlyHint` is REQUIRED, unlike MCP's optional version. It is no longer
 * merely documentation: it is the control that decides which tools an agent may
 * run without asking, so a tool that forgets to declare it is a safety bug, not
 * a cosmetic omission. Making it required means the compiler catches that
 * instead of a reviewer. Derive read-vs-write from this field and never from
 * the verb in the tool's name — `set_cart` only composes an outbound URL and is
 * a read; `deck_history` can roll a deck back and is a write.
 */
export interface ToolAnnotations {
  /** True when the tool cannot change any state. Required — see above. */
  readOnlyHint: boolean;
  /**
   * True when the tool can destroy data that is not otherwise recoverable.
   *
   * NARROWER THAN MCP'S `destructiveHint`, deliberately. Deck-E reads this one
   * as "always ask, even for a preview" (`requiresApproval` in
   * apps/api/src/decke/adapters/aisdk.ts), so it stays on the deletes and
   * `revert`. MCP's flag means "may do anything but add" — see
   * `overwriteHint`, which the MCP adapter folds in when it advertises the
   * tool.
   */
  destructiveHint?: boolean;
  /**
   * True when a write can replace or remove existing data even though DeckPal
   * can usually get it back: a card list reconciled, a guide replaced, a
   * quantity lowered, a list item removed. Together with `destructiveHint`
   * this is MCP's `destructiveHint` ("may perform destructive updates" rather
   * than "only additive updates"); apps/mcp/src/adapters/mcp.ts advertises
   * the OR of the two. Deck-E does not read it.
   */
  overwriteHint?: boolean;
  /** True when calling twice with the same arguments has the same effect as once. */
  idempotentHint?: boolean;
  /**
   * True when the tool touches the wider world rather than only DeckPal's
   * data. MCP's default for an omitted value is TRUE; the MCP adapter
   * advertises `false` unless a tool sets this, because every DeckPal tool
   * works on DeckPal's own data.
   */
  openWorldHint?: boolean;
  /** Human-readable title; DeckPal sets `title` on the definition instead. */
  title?: string;
}

/** Any zod object usable as a tool's argument schema. */
type AnyZodObject = z.ZodObject<Record<string, z.ZodType>>;

/**
 * A tool, erased of its argument type so a heterogeneous list is expressible.
 *
 * The handler's `args` is `never`-free `unknown`-adjacent on purpose: the schema
 * that proves its shape is right there on the same object, and each adapter
 * validates against that schema before calling. Inside a `defineTool(...)` call
 * the argument type is fully inferred, so tool authors never see this erased
 * form.
 */
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /** Absent for a genuinely no-argument tool (`health`). */
  inputSchema?: AnyZodObject;
  annotations: ToolAnnotations;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: Ctx) => Promise<ToolResult>;
  /**
   * What the MCP server advertises and runs INSTEAD, for the rare tool whose
   * two front-ends need different contracts. Deck-E ignores it.
   *
   * One user today: `deck_strategy`. In Deck-E the reader's approval card
   * shows the whole new guide before anything is saved, so the approval IS the
   * preview, and a dry run would only send a 40,000-character guide twice. An
   * MCP client's approval prompt may show nothing of the sort, so over MCP the
   * tool previews by default like every other write (`dry_run`, 2026-10-12).
   */
  mcp?: {
    description: string;
    inputSchema: AnyZodObject;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (args: any, ctx: Ctx) => Promise<ToolResult>;
  };
}

/** Everything a tool declares, with its argument type still attached. */
interface ToolSpec<S extends AnyZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  handler: (args: z.output<S>, ctx: Ctx) => Promise<ToolResult>;
  mcp?: ToolDefinition['mcp'];
}

/** The same, for a tool that takes no arguments at all. */
interface NoArgToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema?: undefined;
  annotations: ToolAnnotations;
  handler: (args: Record<string, never>, ctx: Ctx) => Promise<ToolResult>;
}

/**
 * Declare a tool. Two overloads rather than one optional field, because the
 * no-argument case is genuinely different: `health` has NO `inputSchema` — not
 * an empty one — and that distinction reaches the wire. Registering it with
 * `z.object({})` would advertise an empty object schema where the tool
 * currently advertises none, which is a protocol-visible change for a tool that
 * has never taken an argument.
 */
export function defineTool<S extends AnyZodObject>(spec: ToolSpec<S>): ToolDefinition;
export function defineTool(spec: NoArgToolSpec): ToolDefinition;
export function defineTool(spec: ToolSpec<AnyZodObject> | NoArgToolSpec): ToolDefinition {
  return spec as ToolDefinition;
}
