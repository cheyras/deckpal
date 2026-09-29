/** Conversation-long memory of exact tool calls the reader declined. */
import { callKey } from './repeat.js'
import { NO_WORK } from './deepOutcome.js'

/** Closing a consent panel is not the same as refusing its change. */
const ABANDONED_REASON = 'the reader did not answer'

/**
 * Every exact (tool, arguments) pair explicitly denied anywhere on the wire.
 * The browser now replays denials as `output-denied`; accepting the older
 * approval shape as well keeps in-flight conversations valid during rollout.
 */
export function declinedCalls(messages: unknown): Set<string> {
  const declined = new Set<string>()
  if (!Array.isArray(messages)) return declined

  for (const message of messages) {
    if (!Array.isArray(message?.parts)) continue
    for (const part of message.parts) {
      if (!part || typeof part.type !== 'string' || !part.type.startsWith('tool-')) continue
      if (part.approval?.approved !== false) continue
      if (part.approval.reason === ABANDONED_REASON) continue
      declined.add(callKey(part.type.slice('tool-'.length), part.input ?? {}))
    }
  }
  return declined
}

/** Research provenance survives turn boundaries through replayed tool parts. */
export function researchRanInConversation(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false
  for (const message of messages) {
    if (!Array.isArray(message?.parts)) continue
    for (const part of message.parts) {
      if (part?.type !== 'tool-web_research' && part?.type !== 'tool-research_meta') continue
      if (part.state === 'output-available' || part.approval?.approved === true) return true
    }
  }
  return false
}

/** Exact declines prevent only the identical change, never a whole tool family. */
export function alreadyDeclinedMessage(tool: string): string {
  return (
    `${NO_WORK} The reader said no to this exact ${tool} change, so nothing changed. ` +
    `Do not ask again for the same change. Carry on with what they said next.`
  )
}
