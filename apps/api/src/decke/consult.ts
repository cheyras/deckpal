/**
 * The consult: Haiku asks Sonnet one question, inside one request.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS (2026-10-10)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Triage puts battle logging on the Quick tier (Claude Haiku 5.5), because
 * logging a game is bounded tool work and most games deserve a two-line note.
 * Some do not. A close game with a real turning point deserves an analysis, and
 * Haiku "ties Sonnet 5.5 on bounded tool work and trails it on judgment"
 * (pathways/names.ts) — judgment being exactly what that analysis is. Raising
 * the whole request to Standard for it would re-bill the entire conversation on
 * Sonnet for every step of the logging flow, approval cards included, to buy
 * one paragraph. The owner's phrasing was "Haiku prompting into Sonnet
 * internally": the cheap model does the work, and buys the judgement only for
 * the part that needs it, with a brief it writes itself.
 *
 * ── WHAT THE COLLEAGUE GETS, AND WHAT IT DOES NOT ───────────────────────────
 *
 * The brief and the question. NO tools, NO conversation, NO prompt beyond the
 * short system line below — so the call is cheap, it cannot act, and every
 * claim in its answer is traceable to text Deck-E chose to send. That is also
 * why the system line insists on grounding: a colleague with no tools that is
 * asked about a card the brief does not describe has nothing to answer from
 * but memory, which is where invented card text comes from.
 *
 * ── THE MODEL OPTIONS ───────────────────────────────────────────────────────
 *
 * Sonnet 5.5 at `effort: 'medium'` with adaptive thinking — the same setting
 * the Standard tier runs at (`chatProviderOptions` in api/chat.mjs). `effort`
 * is TOP-LEVEL in the Anthropic options: nested inside `thinking` it is
 * stripped by the provider schema and the call silently runs at the model's
 * default (chatWiring.test.ts pins the same rule for the chat tiers).
 *
 * The model arrives INJECTED, already wrapped in `observeUsageModel(...)` by
 * the caller, so the consult is metered on the reader's request like every
 * other model call and actual-cost credits stay right. Nothing here may reach
 * the Gateway on its own.
 */
import { generateText, type LanguageModel } from 'ai';

/** The colleague's whole brief on how to behave. Kept short on purpose. */
export const CONSULT_SYSTEM =
  "You are Deck-E's deeper-thinking colleague. You receive a brief and one question. " +
  'Answer with a focused analysis in plain prose and short bullets, ≤ 400 words; ' +
  'ground every claim in the brief; say what the brief cannot tell you; ' +
  'never invent cards, card text, prices or events.';

/** Tool-input bounds — enforced by the `consult` tool's schema in tools.ts. */
export const CONSULT_QUESTION_MAX = 500;
export const CONSULT_BRIEF_MAX = 8_000;

/**
 * All-in output ceiling: adaptive thinking is counted in Anthropic's output
 * tokens. The visible answer is ≤ 400 words (~600 tokens); models.ts records
 * twice what a reasoning call provisioned at the answer's length returns —
 * nothing — so this leaves thinking room several times over while bounding
 * the worst case at about eight cents of Sonnet output.
 */
export const CONSULT_MAX_OUTPUT_TOKENS = 8_000;

/** Standard tier's thinking setting. `effort` top-level — see the header. */
export const CONSULT_PROVIDER_OPTIONS = {
  anthropic: { effort: 'medium', thinking: { type: 'adaptive' } },
} as const;

export interface ConsultInput {
  question: string;
  brief: string;
  /** Sonnet 5.5 through the Gateway, wrapped in the request's usage observer. */
  model: LanguageModel;
  /** The reader's turn: a consult must stop when they do. */
  signal?: AbortSignal;
  maxOutputTokens?: number;
}

/**
 * Consults one request may run. Each is a fresh Sonnet call billed to the
 * reader, and the job that wants one (a Standard-depth game review) wants ONE;
 * the second is headroom for a question that genuinely needed rephrasing. A
 * loop past that is the model thrashing on the reader's credits.
 */
export const CONSULT_MAX_PER_REQUEST = 2;

/**
 * Why a consult did not run, in words safe to put in a tool result. Never the
 * provider's own message: that text is unvetted and lands in a model's context
 * (the same rule `safeUsageCode` keeps for the usage ledger).
 */
export function consultFailure(error: unknown): string {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const e = current as { name?: unknown; code?: unknown; statusCode?: unknown; cause?: unknown };
    if (e.name === 'AbortError') return 'the turn was stopped';
    // The metered-credit middleware's refusal (usage.ts), possibly wrapped by the SDK.
    if (e.code === 'DKCAP') return "the reader's AI credit limit for this request was reached";
    if (current instanceof EmptyConsultError) return 'it returned no analysis';
    if (e.statusCode === 429) return 'the model was rate-limited';
    current = e.cause;
  }
  return 'the model request failed';
}

/** Raised when the colleague answers with no visible text (all thinking, or a refusal). */
export class EmptyConsultError extends Error {
  constructor(readonly finishReason: string | undefined) {
    super(`the consult returned no analysis (finish: ${finishReason ?? 'unknown'})`);
    this.name = 'EmptyConsultError';
  }
}

/**
 * Ask once and return the analysis text. Throws on a provider error, an abort,
 * or an empty answer — the `consult` tool turns each into a plain "it did not
 * run" result so Deck-E writes a shorter note himself rather than stalling.
 */
export async function runConsult(input: ConsultInput): Promise<string> {
  const result = await generateText({
    model: input.model,
    instructions: CONSULT_SYSTEM,
    // The brief first, the question last: the question is what it reads
    // immediately before answering. Labelled, because both are Deck-E's prose
    // and the colleague has to know which part is the evidence.
    prompt: `Brief:\n${input.brief.trim()}\n\nQuestion:\n${input.question.trim()}`,
    providerOptions: CONSULT_PROVIDER_OPTIONS,
    maxOutputTokens: input.maxOutputTokens ?? CONSULT_MAX_OUTPUT_TOKENS,
    abortSignal: input.signal,
  });
  const text = result.text.trim();
  if (!text) throw new EmptyConsultError(result.finishReason);
  return text;
}
