/**
 * Last-resort control for a battle log pasted in the reader's latest message.
 *
 * Production showed two pasted logs for which Deck-E performed reads (or
 * nothing) and never raised the `add_battle_log` consent card. This pure gate
 * runs only after an otherwise healthy first leg. It deliberately refuses to
 * compete with ANY held approval, a browser tool, another correction, or a
 * troubled turn; those paths already chose what happens next. A held approval
 * has no result yet, so starting another AI SDK leg would reject the replayed
 * prompt before the model could raise this card (measured 2026-10-10).
 */
export function pasteBackstopNeeded(o: {
  pastedInLatestUserMessage: boolean;
  firstLegOfTurn: boolean;
  calledToolNames: readonly string[];
  anyApprovalPending: boolean;
  clientToolRan: boolean;
  correctiveChosen: boolean;
  turnTroubled: boolean;
}): boolean {
  return (
    o.pastedInLatestUserMessage &&
    o.firstLegOfTurn &&
    !o.calledToolNames.includes('add_battle_log') &&
    !o.anyApprovalPending &&
    !o.clientToolRan &&
    !o.correctiveChosen &&
    !o.turnTroubled
  );
}

/** Deck-E's own reader-facing bridge into the consent card. */
export const PASTE_BACKSTOP_LINE = '\n\nLet me get that game logged — confirm it on the card.';

/** Appended to the system prompt only for the bounded corrective leg. */
export function pasteBackstopInstruction(): string {
  return (
    'The reader pasted a PTCG Live battle log in their latest message and it has not been logged. ' +
    'Call add_battle_log now with log "@pasted". If the deck is not known, call it first without ' +
    'deck_id to rank their decks, then call it again with the best deck_id and dry_run: false. ' +
    'The approval card is where the reader confirms; do not describe the game as logged.'
  );
}
