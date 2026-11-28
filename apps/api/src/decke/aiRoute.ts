/**
 * Which road a model call takes: Anthropic directly, or the Vercel AI Gateway.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE RULE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   - An ANTHROPIC model, with `ANTHROPIC_API_KEY` set, goes to the Anthropic
 *     API first, on the owner's own key. That covers every caller — Deck-E
 *     turns made for end users as much as the owner's own.
 *   - If that call is refused because the Anthropic account cannot pay for it
 *     (see `directRefusal` for the exact list), the SAME request is sent
 *     through the Gateway instead. Nothing the reader sees changes.
 *   - Any other failure — a bad request, a plain rate limit, a 5xx, an
 *     overload, a network error — is the call's real answer and is returned
 *     as-is. Retrying those on the Gateway would hide outages and double-bill.
 *   - Every other lab's model goes through the Gateway exactly as before.
 *   - With no `ANTHROPIC_API_KEY`, `createModelProvider` returns the Gateway
 *     provider's models untouched: behaviour is byte-for-byte what it was.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * METERING PARITY
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Credits are settled from `cost_usd`, which on the Gateway road comes from
 * `providerMetadata.gateway.cost`. Anthropic's API reports tokens, not dollars,
 * so the direct road prices the SAME token counts at the Gateway's own
 * published per-token rates (`DIRECT_MODELS`, copied from
 * `https://ai-gateway.vercel.sh/v1/models`; the boot model check compares the
 * two and warns on drift). The result rides in `providerMetadata.deckpal`, and
 * the routed model reports the Gateway's `provider` and `modelId`, so the
 * usage middleware (`usage.ts`) writes the same operation row either way. Only
 * `route` (and the provider's own generation id) differ. An Anthropic model
 * with no rate row here is not routed directly at all, so a call is never
 * served at an unknown price.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * STREAMS
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A fallback happens only BEFORE any output exists: either the direct request
 * is refused outright (the normal shape of a billing error — an HTTP error
 * before the stream opens), or its stream errors before its first content
 * part. Parts read while deciding are buffered, not forwarded, so nothing has
 * reached the reader when the Gateway takes over. Once a content part has been
 * read the direct stream is committed; two streams are never spliced.
 */
import { createGateway } from '@ai-sdk/gateway';
import { createAnthropic } from '@ai-sdk/anthropic';
import { AI_ROUTES, type AiRoute } from './usageMetadata.js';

type GatewayProviderFn = ReturnType<typeof createGateway>;
/** A provider-level language model (`LanguageModelV4`), as the Gateway returns it. */
export type RoutableModel = ReturnType<GatewayProviderFn>;
type CallOptions = Parameters<RoutableModel['doStream']>[0];
type StreamResult = Awaited<ReturnType<RoutableModel['doStream']>>;
type GenerateResult = Awaited<ReturnType<RoutableModel['doGenerate']>>;
type StreamPart = StreamResult['stream'] extends ReadableStream<infer P> ? P : never;

/** What the caller passes around in place of the Gateway provider. */
export type ModelProvider = (modelId: string) => RoutableModel;

export { AI_ROUTES, type AiRoute };

// ─────────────────────────────────────────────────────────────────────────────
// Rates
// ─────────────────────────────────────────────────────────────────────────────

/** USD per token, as the decimal strings the Gateway publishes. */
export interface TokenRates {
  readonly input: string;
  readonly output: string;
  readonly cacheRead: string;
  /** The 5-minute cache write — the only TTL DeckPal uses. */
  readonly cacheWrite: string;
}
export interface DirectModel {
  /** Anthropic's own model id for the same model. */
  readonly anthropicId: string;
  readonly rates: TokenRates;
  /** A higher rate band once the prompt exceeds `above` tokens. */
  readonly longContext?: { readonly above: number; readonly rates: TokenRates };
}

/**
 * Every Anthropic model that may be served directly, keyed by Gateway id.
 *
 * Rates copied from the Gateway's public model list on 2026-11-27 (default
 * region, standard speed). They are what the Gateway charges, so pricing
 * Anthropic's token report with them reproduces the Gateway's `cost`. Haiku
 * 5.5's long-context band: the Gateway's tier starts at `min: 100001`, so the
 * upper rates apply when the prompt is MORE than 100,000 tokens.
 */
export const DIRECT_MODELS: Readonly<Record<string, DirectModel>> = {
  'anthropic/claude-haiku-5.5': {
    anthropicId: 'claude-haiku-5-5',
    rates: { input: '0.0000001', output: '0.0000005', cacheRead: '0.00000001', cacheWrite: '0.000000125' },
    longContext: {
      above: 100_000,
      rates: { input: '0.0000005', output: '0.0000025', cacheRead: '0.00000005', cacheWrite: '0.000000625' },
    },
  },
  'anthropic/claude-sonnet-5.5': {
    anthropicId: 'claude-sonnet-5-5',
    rates: { input: '0.000002', output: '0.00001', cacheRead: '0.0000001', cacheWrite: '0.0000025' },
  },
  'anthropic/claude-opus-5.5': {
    anthropicId: 'claude-opus-5-5',
    rates: { input: '0.000004', output: '0.00002', cacheRead: '0.0000002', cacheWrite: '0.000005' },
  },
  'anthropic/claude-sonnet-5': {
    anthropicId: 'claude-sonnet-5',
    rates: { input: '0.000002', output: '0.00001', cacheRead: '0.0000002', cacheWrite: '0.0000025' },
  },
  'anthropic/claude-opus-5': {
    anthropicId: 'claude-opus-5',
    rates: { input: '0.000005', output: '0.000025', cacheRead: '0.0000005', cacheWrite: '0.00000625' },
  },
  'anthropic/claude-haiku-4.5': {
    anthropicId: 'claude-haiku-4-5',
    rates: { input: '0.000001', output: '0.000005', cacheRead: '0.0000001', cacheWrite: '0.00000125' },
  },
};

/** The Gateway's published web-search price: $10 per 1,000 requests. */
const WEB_SEARCH_USD = '0.01';

// Exact decimal arithmetic at 12 places — `cost_usd` is numeric(24,12) and
// every published rate has at most 10, so products of whole token counts are
// exact. Floats would round a fraction of a micro-dollar differently from the
// Gateway on some token counts, which is exactly the drift this file exists to
// prevent.
const PLACES = 12;
const SCALE = 10n ** BigInt(PLACES);
function toUnits(value: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`not a decimal rate: ${value}`);
  const fraction = match[2] ?? '';
  if (fraction.length > PLACES) throw new Error(`rate has more than ${PLACES} places: ${value}`);
  return BigInt(match[1]!) * SCALE + BigInt(fraction.padEnd(PLACES, '0') || '0');
}
function fromUnits(units: bigint): string {
  const whole = units / SCALE;
  const fraction = (units % SCALE).toString().padStart(PLACES, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * The USD cost of one direct call, from the AI SDK's normalised usage (and the
 * raw Anthropic usage it carries). `null` when the counts are not all present —
 * the honest "unknown", which the meter records as unknown, never as zero.
 */
export function directCostUsd(gatewayId: string, usage: unknown): string | null {
  const model = DIRECT_MODELS[gatewayId];
  if (!model) return null;
  const u = record(usage);
  const input = record(u.inputTokens);
  const output = record(u.outputTokens);
  const raw = record(u.raw);
  const noCache = count(input.noCache);
  const cacheRead = count(input.cacheRead) ?? 0;
  const cacheWrite = count(input.cacheWrite) ?? 0;
  const out = count(output.total);
  if (noCache === null || out === null) return null;
  const oneHour = Math.min(count(record(raw.cache_creation).ephemeral_1h_input_tokens) ?? 0, cacheWrite);
  const webSearches = count(record(raw.server_tool_use).web_search_requests) ?? 0;
  const prompt = noCache + cacheRead + cacheWrite;
  const rates = model.longContext && prompt > model.longContext.above ? model.longContext.rates : model.rates;
  const units =
    BigInt(noCache) * toUnits(rates.input) +
    BigInt(cacheRead) * toUnits(rates.cacheRead) +
    BigInt(cacheWrite - oneHour) * toUnits(rates.cacheWrite) +
    // A 1-hour write is 2x base input on Anthropic's price list. DeckPal never
    // asks for one; priced rather than dropped in case a future caller does.
    BigInt(oneHour) * 2n * toUnits(rates.input) +
    BigInt(out) * toUnits(rates.output) +
    BigInt(webSearches) * toUnits(WEB_SEARCH_USD);
  return fromUnits(units);
}

// ─────────────────────────────────────────────────────────────────────────────
// When a direct failure falls back
// ─────────────────────────────────────────────────────────────────────────────

/** Why a direct call was handed to the Gateway. Never a raw provider message. */
export type DirectRefusal = 'billing' | 'credit_balance' | 'usage_limit' | 'spend_limit' | 'auth';

function parsedBody(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length > 64_000) return record(value);
  try { return record(JSON.parse(value)); } catch { return {}; }
}

/**
 * Is this direct-call failure the Anthropic ACCOUNT being unable to serve
 * (out of credit, over a usage or spend limit, key rejected), rather than
 * something about the request? Only those fall back.
 *
 * Falls back:
 *   - HTTP 402, or error type `billing_error`                     → billing
 *   - "Your credit balance is too low…" (Anthropic sends it as a
 *     400 `invalid_request_error`)                                → credit_balance
 *   - "You have reached your specified API usage limits…" (also a
 *     400 `invalid_request_error`)                                → usage_limit
 *   - HTTP 429 with `error.details.error_code` =
 *     `enforced_spend_limit_reached` (the monthly spend cap — the
 *     one 429 a retry cannot clear), or a 4xx whose message names a
 *     spend limit/cap                                             → spend_limit
 *   - HTTP 401 / `authentication_error` — the owner's key is
 *     revoked or rotated; the request itself is fine and the
 *     Gateway can serve it at the same metered price              → auth
 *
 * Does NOT fall back: any other 400, 403, 404, 413, a plain 429 rate limit, any
 * 5xx, 529 overloaded, a network error, an abort, or a refusal (which is not an
 * error at all — it is a `stop_reason`). Message patterns are only consulted on
 * a 4xx or an in-stream error, never on a 5xx.
 */
export function directRefusal(error: unknown): DirectRefusal | null {
  const e = record(error);
  if (e.name === 'AbortError') return null;
  const body = parsedBody(e.responseBody);
  const data = record(e.data);
  // An HTTP error carries Anthropic's JSON body (`{type:'error', error:{...}}`);
  // an in-stream error carries the bare `{type, message}` object as `data`.
  const detail = record(body.error ?? data.error ?? (data.type !== undefined ? data : null));
  const status = typeof e.statusCode === 'number' ? e.statusCode : typeof e.status === 'number' ? e.status : null;
  const type = String(detail.type ?? e.type ?? '');
  const message = String(detail.message ?? e.message ?? '');
  const code = String(record(detail.details).error_code ?? detail.error_code ?? '');
  if (status !== null && (status < 400 || status >= 500)) return null;
  if (status === 402 || type === 'billing_error') return 'billing';
  if (/credit balance is too low/i.test(message)) return 'credit_balance';
  if (/reached your (specified )?(api )?usage limits?/i.test(message)) return 'usage_limit';
  if (code === 'enforced_spend_limit_reached') return 'spend_limit';
  if (/spend(ing)? (limit|cap)/i.test(message)) return 'spend_limit';
  if (status === 401 || type === 'authentication_error') return 'auth';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode and the boot line
// ─────────────────────────────────────────────────────────────────────────────

export type AiRouteMode =
  | { mode: 'anthropic-direct'; key: string }
  | { mode: 'gateway-only'; reason: 'unset' | 'malformed' };

/** Read `ANTHROPIC_API_KEY`. A value without the `sk-ant-` prefix is ignored, loudly. */
export function aiRouteMode(env: NodeJS.ProcessEnv = process.env): AiRouteMode {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { mode: 'gateway-only', reason: 'unset' };
  if (!key.startsWith('sk-ant-')) return { mode: 'gateway-only', reason: 'malformed' };
  return { mode: 'anthropic-direct', key };
}

/** What `/health` reports. Never any part of the key. */
export function aiRouteStatus(env: NodeJS.ProcessEnv = process.env): 'anthropic-direct' | 'gateway-only' | 'gateway-only-malformed-key' {
  const m = aiRouteMode(env);
  return m.mode === 'anthropic-direct' ? 'anthropic-direct' : m.reason === 'malformed' ? 'gateway-only-malformed-key' : 'gateway-only';
}

/** The one startup line (B11). Names the mode, never the key. */
export function aiRouteBootLine(env: NodeJS.ProcessEnv = process.env): string {
  const m = aiRouteMode(env);
  if (m.mode === 'anthropic-direct') {
    return '[ai-route] mode: anthropic-direct — Anthropic models call the Anthropic API on ANTHROPIC_API_KEY, ' +
      'falling back to the AI Gateway only when that account is out of credit, over a usage/spend limit, or rejects the key; ' +
      'other models use the Gateway.';
  }
  if (m.reason === 'malformed') {
    return '[ai-route] mode: gateway-only — ANTHROPIC_API_KEY is set but does not start with "sk-ant-", so it is IGNORED. ' +
      'Every model call goes through the AI Gateway. Re-run `pnpm ai:set-anthropic-key`.';
  }
  return '[ai-route] mode: gateway-only — ANTHROPIC_API_KEY is unset, so every model call goes through the AI Gateway (as before).';
}

// ─────────────────────────────────────────────────────────────────────────────
// The provider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * After a credit-shaped refusal, how long this process skips the direct road.
 * Without it a turn of a dozen model steps would pay a failed round trip on
 * every step while the account is empty. Per instance, in memory: a fresh
 * instance tries direct again, which is how recovery after a top-up is found.
 */
export const DIRECT_COOLDOWN_MS = 60_000;

export interface ModelProviderOptions {
  gatewayKey: string;
  /** Defaults to `aiRouteMode()`'s key. `null` forces gateway-only. */
  anthropicKey?: string | null;
  /** Test seams: build the two underlying providers. */
  gateway?: (modelId: string) => RoutableModel;
  anthropic?: (anthropicId: string) => RoutableModel;
  /** Test seam for the Anthropic provider's HTTP. */
  anthropicFetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

function withRoute(metadata: unknown, route: AiRoute, extra: Record<string, string | null> = {}) {
  return { ...record(metadata), deckpal: { ...extra, route } } as GenerateResult['providerMetadata'];
}

/** Add `deckpal.route` to a Gateway stream's finish part. */
function tagGatewayStream(result: StreamResult, route: AiRoute): StreamResult {
  const stream = result.stream.pipeThrough(new TransformStream<StreamPart, StreamPart>({
    transform(part, controller) {
      controller.enqueue(part.type === 'finish' ? { ...part, providerMetadata: withRoute(part.providerMetadata, route) } : part);
    },
  }));
  return { ...result, stream };
}

/** Parts that exist before any output: safe to hold while deciding. */
const PREAMBLE = new Set(['stream-start', 'response-metadata', 'raw']);

export function createModelProvider(options: ModelProviderOptions): ModelProvider {
  const gatewayModel = options.gateway ?? createGateway({ apiKey: options.gatewayKey });
  const anthropicKey = options.anthropicKey === undefined
    ? (() => { const m = aiRouteMode(); return m.mode === 'anthropic-direct' ? m.key : null; })()
    : options.anthropicKey;
  if (!anthropicKey && !options.anthropic) return gatewayModel;
  const anthropicModel = options.anthropic ??
    createAnthropic({ apiKey: anthropicKey!, ...(options.anthropicFetch ? { fetch: options.anthropicFetch } : {}) });
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.warn(line));
  let coolUntil = 0;

  const refused = (gatewayId: string, reason: DirectRefusal) => {
    coolUntil = now() + DIRECT_COOLDOWN_MS;
    log(reason === 'auth'
      ? `[ai-route] ANTHROPIC_API_KEY was REJECTED (401) for ${gatewayId} — retried through the AI Gateway. Rotate the key with \`pnpm ai:set-anthropic-key\`.`
      : `[ai-route] Anthropic direct refused ${gatewayId} (${reason}: account credit/usage exhausted) — retried through the AI Gateway.`);
  };

  return (modelId: string) => {
    const gateway = gatewayModel(modelId);
    const spec = DIRECT_MODELS[modelId];
    if (!spec) return gateway;
    const direct = anthropicModel(spec.anthropicId);
    const cooling = () => now() < coolUntil;

    const model: RoutableModel = {
      specificationVersion: gateway.specificationVersion,
      // The Gateway's identity, on purpose: the usage middleware records these
      // on the operation row, and a row must not differ by road.
      provider: gateway.provider,
      modelId: gateway.modelId,
      // The narrower of the two: a URL the direct provider cannot take is
      // downloaded and inlined by the SDK, which both roads accept.
      supportedUrls: direct.supportedUrls,

      async doGenerate(call: CallOptions): Promise<GenerateResult> {
        if (cooling()) {
          const result = await gateway.doGenerate(call);
          return { ...result, providerMetadata: withRoute(result.providerMetadata, 'gateway_fallback') };
        }
        let result: GenerateResult;
        try {
          result = await direct.doGenerate(call);
        } catch (error) {
          const reason = directRefusal(error);
          if (!reason) throw error;
          refused(modelId, reason);
          const fallback = await gateway.doGenerate(call);
          return { ...fallback, providerMetadata: withRoute(fallback.providerMetadata, 'gateway_fallback') };
        }
        return {
          ...result,
          providerMetadata: withRoute(result.providerMetadata, 'direct', {
            cost: directCostUsd(modelId, result.usage),
            generationId: typeof result.response?.id === 'string' ? result.response.id : null,
          }),
        };
      },

      async doStream(call: CallOptions): Promise<StreamResult> {
        const viaGateway = async () => tagGatewayStream(await gateway.doStream(call), 'gateway_fallback');
        if (cooling()) return viaGateway();
        let result: StreamResult;
        try {
          result = await direct.doStream(call);
        } catch (error) {
          const reason = directRefusal(error);
          if (!reason) throw error;
          refused(modelId, reason);
          return viaGateway();
        }
        // Hold parts until the first one that is output. An error before that
        // point is still a refusal of the whole request; after it, never.
        const reader = result.stream.getReader();
        const held: StreamPart[] = [];
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          const part = next.value;
          if (part.type === 'error') {
            const reason = directRefusal(part.error);
            if (reason) {
              await reader.cancel().catch(() => {});
              refused(modelId, reason);
              return viaGateway();
            }
          }
          held.push(part);
          if (!PREAMBLE.has(part.type)) break;
        }
        let generationId: string | null = null;
        const normalise = (part: StreamPart): StreamPart => {
          if (part.type === 'response-metadata' && typeof part.id === 'string') generationId = part.id;
          if (part.type !== 'finish') return part;
          return {
            ...part,
            providerMetadata: withRoute(part.providerMetadata, 'direct', {
              cost: directCostUsd(modelId, part.usage),
              generationId,
            }),
          };
        };
        const stream = new ReadableStream<StreamPart>({
          start(controller) { for (const part of held) controller.enqueue(normalise(part)); },
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) controller.close();
              else controller.enqueue(normalise(next.value));
            } catch (error) { controller.error(error); }
          },
          async cancel(reason) { await reader.cancel(reason); },
        });
        return { ...result, stream };
      },
    };
    return model;
  };
}
