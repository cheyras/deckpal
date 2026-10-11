/**
 * What `showDeck` reaches for, in the shape `api/chat.mjs` holds.
 *
 * Exported through `apps/api/dist` like every other Deck-E import. The root
 * package does not depend on `@deckpal/agent-tools`; importing it there
 * resolves locally through hoisting and fails in the deployed function
 * (`scripts/check-functions.mjs`).
 *
 * ── WHY THESE TAKE THE TURN'S OPTIONS, NOT A `Ctx` ───────────────────────────
 *
 * `chat.mjs` holds `toolCtx` — pool, user, token, API base — which is what
 * `withToolCtx` builds a tool `Ctx` FROM. This file used to re-export the
 * shared `checkDeck(ctx, input)` as it was, and `chat.mjs` called it with
 * `toolCtx`, which has no `api`. So every `showDeck` threw "Cannot read
 * properties of undefined (reading 'send')" before it drew anything, and
 * answered NOT SHOWN; the tests passed because they hand `buildTools` a fake
 * `checkDeck`. Taking the options and building the `Ctx` here is the fix, and
 * it is the same path `check_deck` itself runs through.
 */
import {
  checkDeck as checkDeckWith,
  needDeck,
  type CheckDeckInput,
  type DeckCheckResult,
} from '@deckpal/agent-tools'
import { withToolCtx, type ToolCtxOptions } from './ctx.js'

/** `check_deck`'s own check, as the reader. */
export function checkDeck(opts: ToolCtxOptions, input: CheckDeckInput): Promise<DeckCheckResult> {
  return withToolCtx(opts, (ctx) => checkDeckWith(ctx, input))
}

/**
 * A deck from the READER'S OWN, by id or exact name — `showDeck`'s `deck_id`.
 *
 * Through the API with the reader's token, so their decks are the only ones
 * there are to find: another account's id, a deleted deck and a guess all
 * miss. STRICT, like every tool that leads to a write: a near name is a
 * choice, never a pick. A miss returns the sentence `needDeck` writes, which
 * names the reader's real candidates rather than inventing one.
 */
export function ownedDeck(
  opts: ToolCtxOptions,
  ref: string,
): Promise<{ deck: { id: string; name: string } } | { miss: string }> {
  return withToolCtx(opts, async (ctx) => {
    const picked = await needDeck(ctx, ref, { strict: true })
    return picked.ok ? { deck: { id: picked.value.id, name: picked.value.name } } : { miss: picked.message }
  })
}
