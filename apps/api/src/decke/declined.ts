/**
 * Conversation-long memory of exact tool calls the reader declined. On 2026-09-28
 * spoken declines and name-level suppression were removed: browser replay now
 * carries real denials, so exact calls are the only durable, non-overbroad memory.
 */
import { createHash } from 'node:crypto'
import { callKey } from './repeat.js'
import { NO_WORK } from './deepOutcome.js'
import { PASTED_LOG_SENTINEL, extractPastedLog, pasteReferencedBy } from './pastedLog.js'

/** Closing a consent panel is not the same as refusing its change. */
const ABANDONED_REASON = 'the reader did not answer'

/**
 * Every exact (tool, arguments) pair explicitly denied anywhere on the wire.
 * The browser now replays denials as `output-denied`; accepting the older
 * approval shape as well keeps in-flight conversations valid during rollout.
 * Exact matching prevents one declined write from suppressing a different request.
 */
export function declinedCalls(messages: unknown): Set<string> {
  const declined = new Set<string>()
  if (!Array.isArray(messages)) return declined

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (!Array.isArray(message?.parts)) continue
    for (const part of message.parts) {
      if (!part || typeof part.type !== 'string' || !part.type.startsWith('tool-')) continue
      if (part.approval?.approved !== false) continue
      if (part.approval.reason === ABANDONED_REASON) continue
      const name = part.type.slice('tool-'.length)
      // WHICH GAME WAS DECLINED. The replayed part carries what the MODEL sent
      // — `@pasted`, or a truncated prefix — never the log the server
      // substituted into it, so the replay alone cannot say which game the card
      // proposed. What it does carry is the conversation up to that call, and
      // the substitution read exactly that: `extractPastedLog` over the
      // messages before and including this one finds the same paste the
      // adapter found when it raised the card. Nothing later can reach back and
      // change it, because the walk never sees a later message.
      const paste = name === 'add_battle_log' ? extractPastedLog(messages.slice(0, index + 1)) : null
      declined.add(declineCallKey(name, part.input ?? {}, paste))
    }
  }
  return declined
}

/**
 * The key a decline is remembered under — `callKey`, except for a battle log.
 *
 * 2026-10-10 (review of #291): `add_battle_log`'s arguments are the sentinel
 * `@pasted` plus a deck, so after a reader declined ONE pasted game's card,
 * every later paste for the same deck in that conversation had the identical
 * key and was refused as "already declined" — and the paste backstop leg, which
 * exists to log exactly that paste, ended in its failure line. The key now
 * names the GAME: whenever `log` stands for the paste (`pasteReferencedBy`, the
 * adapter's own substitution rule), the paste's SHA-256 replaces it; a log the
 * model typed out in full is hashed the same way. So declining game A still
 * refuses game A — by sentinel, by prefix, or re-typed — and never game B.
 * Hashed rather than inlined so the set does not hold a second 8–15 KB copy of
 * every declined log.
 *
 * Both sides must pass the paste the call could have referred to: the live
 * adapter passes the conversation's current paste, `declinedCalls` the paste
 * as it stood when the declined call was made. A sentinel with no paste stays
 * keyed on the sentinel; that call cannot run anyway.
 */
export function declineCallKey(tool: string, input: unknown, paste?: string | null): string {
  if (tool !== 'add_battle_log' || !input || typeof input !== 'object' || Array.isArray(input)) {
    return callKey(tool, input)
  }
  const args = input as Record<string, unknown>
  const game =
    pasteReferencedBy(args.log, paste) ??
    (typeof args.log === 'string' && args.log !== PASTED_LOG_SENTINEL ? args.log : null)
  if (game === null) return callKey(tool, input)
  return callKey(tool, { ...args, log: `sha256:${createHash('sha256').update(game).digest('hex')}` })
}

/** Research provenance survives turn boundaries through replayed tool parts, not a fragile spoken summary. */
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
