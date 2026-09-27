/**
 * What a Deck-E write leaves stale on the page behind the chat.
 *
 * Reported from the audit (UXD-01): he said "Done — Counter Catcher is out and
 * you are on four Iono", and the deck page behind him still listed Counter
 * Catcher and three Iono. It kept doing so after the panel closed and after a
 * trip to /decks and back, because every page query is fresh for five minutes
 * and nothing told the cache his write had happened. The quantity steppers
 * send ABSOLUTE counts from what is on screen, so tapping − on that stale
 * "Iono 3" wrote 2: his change undone, and one more card gone.
 *
 * The chip for a write is the one event that proves a handler really ran (the
 * server emits it from its execute wrapper, never the model), so the hook
 * invalidates these query roots when a write tool's chip finishes. Invalidating
 * refetches only what is mounted; everything else is marked stale and
 * refetches when it is next shown, so an over-broad entry costs little and a
 * missing one is the bug above.
 *
 * Every tool that can ask for approval must have an entry, even an empty one,
 * and `__tests__/writeRefresh.test.ts` fails when one is missing — the same
 * rule `approvalPhrases.test.ts` enforces for the consent sentence.
 */

type QueryRoot = readonly [string]

const DECK: readonly QueryRoot[] = [
  ['deck'], ['decks'], ['deck-versions'], ['battle-logs'], ['battle-log'],
  ['pricing'], ['deck-massentry'], ['export'], ['testhand'],
]
const LISTS: readonly QueryRoot[] = [['lists'], ['list']]
/**
 * Ownership shows wherever a card does: set grids and card sheets, dex
 * completion, insights, the profile showcase, list progress, and every deck's
 * owned counts and missing-cards cart.
 */
const COLLECTION: readonly QueryRoot[] = [
  ['card'], ['set'], ['series'], ['seriesDetail'], ['species'], ['dex'], ['dex-completion'],
  ['insights'], ['ownedCards'], ['showcase'], ...LISTS,
  ['deck'], ['decks'], ['pricing'], ['deck-massentry'],
]
const union = (...groups: (readonly QueryRoot[])[]): readonly QueryRoot[] => {
  const seen = new Map<string, QueryRoot>()
  for (const root of groups.flat()) seen.set(root[0], root)
  return [...seen.values()]
}

export const WRITE_REFRESH: Record<string, readonly QueryRoot[]> = {
  log_cards: COLLECTION,
  // The approval card's own commit, when the reader corrected a row before
  // accepting (`runAccept`, path B in `approvalCardState.ts`): a collection
  // batch sent by the browser rather than by a tool.
  collection_batch: COLLECTION,
  save_deck: DECK,
  delete_deck: DECK,
  deck_strategy: DECK,
  add_battle_log: DECK,
  edit_battle_log: DECK,
  delete_battle_log: DECK,
  deck_history: DECK,
  edit_list: LISTS,
  delete_list: LISTS,
  // Undo can reach anything the mutation log records.
  revert: union(COLLECTION, DECK),
  // The deep tier. Only the guide writer stores anything; the others spend
  // credits, which the host already re-reads when a turn ends.
  write_strategy_guide: DECK,
  plan_deck: [],
  analyze_collection: [],
  research_meta: [],
}

/**
 * The query roots to invalidate for this chip, or none.
 *
 * Any FINISHED phase counts except `declined`, which is the one outcome known
 * to have written nothing. `error` is included because a call that timed out
 * may still have landed, and a refetch is how the page finds out. A preview
 * also finishes `ok` and refetches for nothing; telling the two apart would
 * mean trusting the model's arguments, and a missed refresh is the bug this
 * exists to fix.
 */
export function staleQueries(chip: { name: string; phase: string }): readonly QueryRoot[] {
  if (chip.phase !== 'ok' && chip.phase !== 'partial' && chip.phase !== 'error') return []
  return WRITE_REFRESH[chip.name] ?? []
}
