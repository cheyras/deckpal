/**
 * Local ollama embedding client (OpenAI-compatible /v1/embeddings).
 *
 * BATTLE-INTEL-SPEC §1 Ground Truth #5: embedding infra already exists on this
 * box — `nomic-embed-text` in local ollama, same approach as a co-hosted app. This is
 * the ONLY model call the mcp server ever makes (synthesis itself is chat-driven;
 * no server-side LLM).
 *
 * Failure discipline (A2 plan): ollama being down must be HONEST — callers catch
 * OllamaUnavailableError, save the synthesis anyway, and flag the embedding as
 * pending. Never a silent null.
 */

export const EMBED_MODEL = process.env.POKEDEX_EMBED_MODEL ?? 'nomic-embed-text';
export const OLLAMA_BASE = process.env.POKEDEX_OLLAMA_BASE ?? 'http://127.0.0.1:11434';
/** nomic-embed-text output dimension — battle_memories.embedding is vector(768). */
export const EMBED_DIMS = 768;

const TIMEOUT_MS = 20_000;

/** ollama unreachable / timed out / errored — the "save succeeds, embedding pending" path. */
export class OllamaUnavailableError extends Error {
  constructor(detail: string) {
    super(`ollama embedding unavailable (${OLLAMA_BASE}, model ${EMBED_MODEL}): ${detail}`);
    this.name = 'OllamaUnavailableError';
  }
}

/**
 * Parse an OpenAI-compatible embeddings response body. Pure — unit-tested
 * without a live ollama. Throws plain Error on a malformed body (that is a
 * contract bug, not an availability problem).
 */
export function parseEmbeddingsResponse(body: unknown): number[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('embeddings response has no data[] — unexpected body shape');
  }
  const embedding = (data[0] as { embedding?: unknown })?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0 || !embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('embeddings response data[0].embedding is not a finite number array');
  }
  if (embedding.length !== EMBED_DIMS) {
    throw new Error(`embedding has ${embedding.length} dims, expected ${EMBED_DIMS} (${EMBED_MODEL})`);
  }
  return embedding as number[];
}

/** Render a vector as a pgvector literal: [0.1,0.2,…] (bind as text, cast ::vector). */
export function vectorLiteral(v: readonly number[]): string {
  return `[${v.join(',')}]`;
}

/**
 * Embed one text via POST {OLLAMA_BASE}/v1/embeddings. Throws
 * OllamaUnavailableError when ollama is down/slow/5xx; plain Error on a
 * malformed 200 body.
 */
export async function embedText(text: string): Promise<number[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/v1/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
      signal: ctl.signal,
    });
  } catch (err) {
    const detail = (err as Error).name === 'AbortError' ? `no response within ${TIMEOUT_MS / 1000}s` : (err as Error).message;
    throw new OllamaUnavailableError(detail);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new OllamaUnavailableError(`HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  return parseEmbeddingsResponse(await res.json());
}
