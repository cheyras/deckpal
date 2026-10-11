/**
 * What `showDeck` reaches for, re-exported so `api/chat.mjs` reaches it through
 * `apps/api/dist` like every other Deck-E import. The root package does not
 * depend on `@deckpal/agent-tools`; importing it there resolves locally through
 * hoisting and fails in the deployed function (`scripts/check-functions.mjs`).
 *
 * Both take a `Ctx` — they call `ctx.api` — not the `ToolCtxOptions` the chat
 * function holds as `toolCtx`. Call them inside `withToolCtx` (`./ctx.ts`), as
 * the data tools are; handing `checkDeck` the options object is what broke
 * showDeck from #267 until #301.
 */
import { needDeck, type Ctx } from '@deckpal/agent-tools'

export { checkDeck } from '@deckpal/agent-tools'

/**
 * A deck from the READER'S OWN, by id or exact name — `showDeck`'s `deck_id`.
 *
 * Through the API with the reader's token, so their decks are the only ones
 * there are to find: another account's id, a deleted deck and a guess all
 * miss. STRICT, like every tool that leads to a write: a near name is a
 * choice, never a pick. A miss returns the sentence `needDeck` writes, which
 * names the reader's real candidates rather than inventing one.
 */
export async function ownedDeck(
  ctx: Ctx,
  ref: string,
): Promise<{ deck: { id: string; name: string } } | { miss: string }> {
  const picked = await needDeck(ctx, ref, { strict: true })
  return picked.ok ? { deck: { id: picked.value.id, name: picked.value.name } } : { miss: picked.message }
}
