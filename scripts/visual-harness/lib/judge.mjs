/**
 * Ask a frontier vision model what it can actually see.
 *
 * WHY THIS EXISTS. The rest of this harness produces evidence — screenshots,
 * videos, contact sheets. Evidence nobody looks at proves nothing, and the
 * failure this project has already shipped once is precisely "the code said it
 * worked" (see `scripts/decke-gates.mjs`'s header: the transcript is the
 * witness under suspicion). A screenshot has the same problem one level up: an
 * agent that captures a PNG and then asserts, from memory, that the character
 * grew from zero has verified nothing.
 *
 * So this reads the artifact back with an independent pair of eyes. It is the
 * visual equivalent of what `decke-gates.mjs` does with the network: check the
 * thing itself, not the report about the thing.
 *
 * WHAT IT IS NOT. A vision model is not an oracle. Use `assert` mode for a
 * claim a human could settle by looking for two seconds ("is the character
 * facing left or right"), not for a judgement call ("does this feel polished").
 * A `fail` is a reason to go and look, not a fact. Model verdicts are recorded
 * with the model id and the raw answer so a human can overrule them.
 *
 * COST. Roughly $0.01–$0.03 per call at current gateway pricing. Cheap against
 * an engineer's attention, not free — do not put it in a loop.
 *
 * CREDENTIAL. Reads `AI_GATEWAY_API_KEY` from the environment, falling back to
 * the gitignored `.env.prod` / `.env` at the repo root. This is deliberately
 * the SHARED gateway key, not `DECKE_VERCEL_AI_GATEWAY_KEY` — Deck-E's own key
 * exists so his per-user spend stays legible (see `api/chat.mjs`'s comment on
 * why the two are separate), and dev tooling must not pollute that number. The
 * key is never printed, logged, or included in any returned value.
 */
import { readFileSync, existsSync } from 'node:fs'
import { extname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Default model. Overridable per call and via VISUAL_JUDGE_MODEL. */
export const DEFAULT_JUDGE_MODEL =
  process.env.VISUAL_JUDGE_MODEL ?? 'google/gemini-3.1-pro-preview'

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Find the gateway key without ever surfacing it.
 * @returns {string|null} the key, or null if none is configured
 */
function findKey() {
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY
  for (const file of ['.env.prod', '.env']) {
    const path = join(REPO_ROOT, file)
    if (!existsSync(path)) continue
    const match = readFileSync(path, 'utf8').match(/^AI_GATEWAY_API_KEY=(.+)$/m)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

/**
 * Is a vision model reachable from this checkout?
 *
 * THE JUDGE IS OPTIONAL, ON PURPOSE. Not every collaborator has a gateway key,
 * and the rest of this harness — screenshots, video, contact sheets — is
 * useful without one. A missing key must degrade to "here is the artifact, go
 * look at it", never to a broken harness. Callers check this first and say so
 * plainly rather than failing.
 *
 * @returns {{ available: boolean, reason: string }}
 */
export function judgeAvailability() {
  if (findKey()) return { available: true, reason: 'AI_GATEWAY_API_KEY found' }
  return {
    available: false,
    reason:
      'No vision model configured: AI_GATEWAY_API_KEY is unset and absent from .env.prod / .env.\n' +
      'The harness still produces screenshots, videos and contact sheets — open them and look.\n' +
      'To enable automated judging, export AI_GATEWAY_API_KEY (a Vercel AI Gateway key).',
  }
}

/** @returns {string} @throws if no key is configured */
function gatewayKey() {
  const key = findKey()
  if (!key) throw new Error(judgeAvailability().reason)
  return key
}

function imagePart(path) {
  const mime = MIME[extname(path).toLowerCase()]
  if (!mime) throw new Error(`judge: unsupported image type for ${path} (want png/jpg/webp/gif)`)
  if (!existsSync(path)) throw new Error(`judge: no such image: ${path}`)
  const b64 = readFileSync(path).toString('base64')
  return { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
}

/**
 * Put a question to a vision model about one or more images.
 *
 * @param {object} opts
 * @param {string[]} opts.images - absolute paths. Order is preserved and named to the model.
 * @param {string} opts.prompt
 * @param {string} [opts.model]
 * @param {boolean} [opts.json] - force a JSON object response
 * @param {number} [opts.maxTokens=4096]
 * @returns {Promise<{ text: string, model: string, usd: number|null }>}
 */
export async function judge({ images, prompt, model = DEFAULT_JUDGE_MODEL, json = false, maxTokens = 4096 }) {
  if (!prompt) throw new Error('judge: prompt is required')
  if (!images?.length) throw new Error('judge: at least one image is required')

  const content = [{ type: 'text', text: prompt }]
  for (const path of images) {
    // Naming each image lets the prompt refer to them positionally, which
    // matters when comparing a before/after pair.
    content.push({ type: 'text', text: `\n[image: ${basename(path)}]` })
    content.push(imagePart(path))
  }

  const body = { model, messages: [{ role: 'user', content }], max_tokens: maxTokens }
  if (json) body.response_format = { type: 'json_object' }

  const res = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${gatewayKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // The body can echo request detail but never the Authorization header.
    throw new Error(`judge: gateway ${res.status}: ${(await res.text()).slice(0, 800)}`)
  }
  const data = await res.json()
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    model: data.model ?? model,
    usd: typeof data.usage?.cost === 'number' ? data.usage.cost : null,
  }
}

/**
 * Settle one falsifiable visual claim.
 *
 * The prompt deliberately pushes toward `unclear` rather than a guess: a
 * confident wrong answer is worse than an admission, because the whole point is
 * to catch the case where the implementer's belief and the pixels disagree.
 *
 * @param {object} opts
 * @param {string[]} opts.images
 * @param {string} opts.claim - a statement that is plainly true or plainly false by looking
 * @param {string} [opts.context] - what the images are, if not self-evident
 * @param {string} [opts.model]
 * @returns {Promise<{ verdict: 'pass'|'fail'|'unclear', observed: string, reasoning: string, model: string, usd: number|null, raw: string }>}
 */
export async function assertVisual({ images, claim, context = '', model = DEFAULT_JUDGE_MODEL }) {
  const prompt = [
    context && `Context: ${context}`,
    `You are verifying one claim about the attached image(s). Multiple images are in the order listed.`,
    ``,
    `CLAIM: ${claim}`,
    ``,
    `Describe only what is actually visible. Do not assume what the software was supposed to do.`,
    `If the images genuinely do not settle the claim, answer "unclear" — that is a useful answer, a guess is not.`,
    ``,
    `Reply with JSON only:`,
    `{"verdict":"pass"|"fail"|"unclear","observed":"<what you actually see, one or two sentences>","reasoning":"<why that settles or fails to settle the claim>"}`,
  ]
    .filter(Boolean)
    .join('\n')

  const { text, model: used, usd } = await judge({ images, prompt, model, json: true })
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    // A model that ignored the format still said something useful; surface it
    // as `unclear` rather than throwing away the observation.
    return {
      verdict: 'unclear',
      observed: text.slice(0, 500),
      reasoning: 'the model did not return parseable JSON',
      model: used,
      usd,
      raw: text,
    }
  }
  const verdict = ['pass', 'fail', 'unclear'].includes(parsed.verdict) ? parsed.verdict : 'unclear'
  return {
    verdict,
    observed: String(parsed.observed ?? ''),
    reasoning: String(parsed.reasoning ?? ''),
    model: used,
    usd,
    raw: text,
  }
}
