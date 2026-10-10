/** The bounded shape emitted by the server's `ask_user` tool. */
export type AskOption = { label: string; description?: string }
export type AskQuestion = {
  header: string
  question: string
  options: AskOption[]
  multi?: boolean
}

/**
 * The `ask_user` tool input, KEPT WHOLE.
 *
 * Only `questions` drives the card, but the input is replayed to the server
 * verbatim: `answeringAsk` in `apps/api/src/decke/tiers.ts` reads `about` (the
 * pathway the question serves) off the replayed `tool-ask_user` part to route
 * the reader's answer to the job that asked. Rebuilding the input as
 * `{ questions }` silently dropped that, so the answer was routed from scratch.
 */
export type AskInput = { questions: AskQuestion[]; about?: string } & Record<string, unknown>

/** The transcript's stored form of a completed ask (`ChatPart` of kind `ask`). */
export type AskPart = {
  kind: 'ask'
  id: string
  toolCallId: string
  state: 'output-available'
  input: AskInput
  output: unknown
}

export type AskAnswer = {
  /** Option labels, in the same order the reader selected them. */
  selected: string[]
  /** When present and non-blank, this replaces the selected option labels. */
  other?: string
}

type MessageLike = { role?: unknown; parts?: readonly unknown[] }

/** The exact sentence sent when the reader leaves the whole card unanswered. */
export const SKIP_TEXT = 'Skip those questions — go with your best judgment.'

function questionsFromPart(part: unknown): AskQuestion[] | null {
  if (!part || typeof part !== 'object') return null
  const value = part as Record<string, unknown>

  // AI SDK static tools use `tool-${name}`. The hand-rolled Deck-E stream
  // stores the same state as `kind: ask`, because the transcript has its own
  // deliberately smaller part vocabulary. Both forms represent a completed
  // server tool call, never model prose.
  const sdkAsk = value.type === 'tool-ask_user' && value.state === 'output-available'
  const deckeAsk = value.kind === 'ask' && value.state === 'output-available'
  if (!sdkAsk && !deckeAsk) return null

  const input = value.input
  if (!input || typeof input !== 'object') return null
  const questions = (input as { questions?: unknown }).questions
  return Array.isArray(questions) ? questions as AskQuestion[] : null
}

/**
 * Return only the unanswered ask on the newest assistant message.
 *
 * A user message after the call is the answer boundary. We deliberately do not
 * inspect its words: answers return as normal user text because Anthropic's
 * Haiku/Sonnet 5.5 guidance says words embedded in tool results may be treated
 * as untrusted and ignored.
 */
export function pendingAsk(messages: readonly MessageLike[]): AskQuestion[] | null {
  let assistantAt = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return null
    if (messages[i]?.role === 'assistant') {
      assistantAt = i
      break
    }
  }
  if (assistantAt < 0) return null
  const parts = messages[assistantAt]?.parts ?? []
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const questions = questionsFromPart(parts[i])
    if (questions) return questions
  }
  return null
}

/** Turn the card into the ordinary user message the model will receive. */
export function formatAnswers(
  questions: readonly AskQuestion[],
  answers: readonly (AskAnswer | undefined)[],
): string {
  const lines: string[] = []
  for (const [index, question] of questions.entries()) {
    const answer = answers[index]
    // Blank is omitted, but non-blank Other text is sent verbatim. Rewriting a
    // reader's words at this boundary would defeat the reason the answer is a
    // normal user message instead of untrusted text nested in a tool result.
    const other = answer?.other
    const value = other?.trim() ? other : answer?.selected.filter(Boolean).join(', ')
    if (value) lines.push(`${question.header} — ${value}`)
  }
  return lines.join('\n')
}

/**
 * The stored ask for one streamed `ask_user` call, or null when its input is
 * not one. The input object is retained AS STREAMED — see `AskInput` — and
 * only checked for the one field the card cannot render without.
 */
export function askFromStream(
  toolCallId: string,
  input: unknown,
  output: unknown,
): Omit<AskPart, 'kind' | 'id'> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  if (!Array.isArray((input as { questions?: unknown }).questions)) return null
  return { toolCallId, state: 'output-available', input: input as AskInput, output }
}

/** Whether a message holds an ask. An ask-only reply is still a real turn. */
export function hasAsk(parts: readonly { kind: string }[]): boolean {
  return parts.some((part) => part.kind === 'ask')
}

/**
 * A message's asks as the AI SDK tool parts the server reads back, in order.
 * `input` and `output` go out exactly as they were stored.
 */
export function askWireParts(parts: readonly { kind: string }[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const part of parts) {
    if (part.kind !== 'ask') continue
    const ask = part as AskPart
    out.push({
      type: 'tool-ask_user',
      toolCallId: ask.toolCallId,
      state: 'output-available',
      input: ask.input,
      output: ask.output,
    })
  }
  return out
}

/**
 * What a screen reader hears when the card docks: the first question, and how
 * many follow it. Without this an ask-only reply ended its turn in silence,
 * because `replyAnnouncement` counts only words and panels.
 */
export function askAnnouncement(questions: readonly AskQuestion[] | null | undefined): string {
  const first = questions?.[0]?.question?.trim()
  if (!first) return ''
  const sentence = /[.?!…]$/.test(first) ? first : `${first}.`
  const more = (questions?.length ?? 1) - 1
  return `Deck-E asks: ${sentence}${more > 0 ? ` Plus ${more} more question${more === 1 ? '' : 's'}.` : ''}`
}
