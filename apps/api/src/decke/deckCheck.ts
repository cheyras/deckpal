/**
 * `checkDeck`, re-exported so `api/chat.mjs` reaches it through `apps/api/dist`
 * like every other Deck-E import. The root package does not depend on
 * `@deckpal/agent-tools`; importing it there resolves locally through hoisting
 * and fails in the deployed function (`scripts/check-functions.mjs`).
 *
 * It takes a `Ctx` — it calls `ctx.api` — not the `ToolCtxOptions` the chat
 * function holds as `toolCtx`. Call it inside `withToolCtx` (`./ctx.ts`), as
 * the data tools are; handing it the options object is what broke showDeck.
 */
export { checkDeck } from '@deckpal/agent-tools'
