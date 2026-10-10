/**
 * Last-resort control for a battle log pasted in the reader's latest message.
 *
 * Production showed two pasted logs for which Deck-E performed reads (or
 * nothing) and never raised the `add_battle_log` consent card. This pure gate
 * runs only after an otherwise healthy first leg. It deliberately refuses to
 * compete with ANY held approval, a browser tool, another correction, a
 * troubled turn, or an ask card; those paths already chose what happens next.
 * A held approval has no result yet, so starting another AI SDK leg would
 * reject the replayed prompt before the model could raise this card (measured
 * 2026-10-10).
 *
 * An ask card defers the backstop rather than cancelling it. The paste turn
 * that asked "which deck was this?" must not raise a card for a guessed log,
 * so the backstop waits for the answer: the reader's NEXT message, which no
 * longer holds the paste itself (`pastedBeforeAnsweredAsk`).
 */
import { extractPastedLog } from './pastedLog.js';
import { answeringAsk } from './tiers.js';

export function pasteBackstopNeeded(o: {
  pastedInLatestUserMessage: boolean;
  /**
   * The reader's latest message answers an ask card that Deck-E raised over a
   * paste in the message before it, and that turn did not log it.
   */
  pastedBeforeAnsweredAsk: boolean;
  firstLegOfTurn: boolean;
  calledToolNames: readonly string[];
  anyApprovalPending: boolean;
  clientToolRan: boolean;
  correctiveChosen: boolean;
  turnTroubled: boolean;
  /**
   * The turn showed a valid `ask_user` card. Asking IS choosing what happens
   * next: an approval card for a guessed log must not dock above the question
   * — often "which deck was this?" — whose answer the log needs.
   */
  askedReader: boolean;
}): boolean {
  return (
    (o.pastedInLatestUserMessage || o.pastedBeforeAnsweredAsk) &&
    o.firstLegOfTurn &&
    !o.calledToolNames.includes('add_battle_log') &&
    !o.anyApprovalPending &&
    !o.clientToolRan &&
    !o.correctiveChosen &&
    !o.turnTroubled &&
    !o.askedReader
  );
}

type UiMessage = { role?: unknown; parts?: unknown };
type UiPart = { type?: unknown; toolName?: unknown };

const isCall = (part: UiPart, name: string) =>
  part.type === `tool-${name}` || (part.type === 'dynamic-tool' && part.toolName === name);

/**
 * Whether the reader's latest message answers an ask that Deck-E raised over a
 * paste instead of logging it.
 *
 * Three facts, all from the replayed history: the latest message answers an
 * ask card (`answeringAsk`, the same reading routing uses); the reader's
 * message BEFORE that ask held a pasted log (the same `extractPastedLog`, on
 * that one message); and no reply between the two touched `add_battle_log` —
 * a log already raised or declined there must not be raised again.
 */
export function pastedBeforeAnsweredAsk(messages: unknown): boolean {
  if (!Array.isArray(messages) || answeringAsk(messages) === null) return false;
  const users: number[] = [];
  for (let i = messages.length - 1; i >= 0 && users.length < 2; i -= 1) {
    if ((messages[i] as UiMessage | null)?.role === 'user') users.push(i);
  }
  const [latest, previous] = users;
  if (latest === undefined || previous === undefined) return false;
  const between = messages.slice(previous + 1, latest) as (UiMessage | null)[];
  const parts = between.flatMap((message) =>
    message?.role === 'assistant' && Array.isArray(message.parts)
      ? (message.parts as unknown[]).filter((part): part is UiPart => !!part && typeof part === 'object')
      : [],
  );
  if (parts.some((part) => isCall(part, 'add_battle_log'))) return false;
  return extractPastedLog([messages[previous]]) !== null;
}

/** Deck-E's own reader-facing bridge into the consent card. */
export const PASTE_BACKSTOP_LINE = '\n\nLet me get that game logged — confirm it on the card.';

/** Appended to the system prompt only for the bounded corrective leg. */
export function pasteBackstopInstruction(o: { afterAsk?: boolean } = {}): string {
  return (
    (o.afterAsk
      ? 'The reader pasted a PTCG Live battle log in their previous message, you asked them about it, ' +
        'and their latest message answers you; the game has not been logged. Use their answers. '
      : 'The reader pasted a PTCG Live battle log in their latest message and it has not been logged. ') +
    'Call add_battle_log now with log "@pasted". If the deck is not known, call it first without ' +
    'deck_id to rank their decks, then call it again with the best deck_id and dry_run: false. ' +
    'The approval card is where the reader confirms; do not describe the game as logged.'
  );
}
