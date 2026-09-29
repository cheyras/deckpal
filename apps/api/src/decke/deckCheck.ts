/**
 * `checkDeck`, re-exported so `api/chat.mjs` reaches it through `apps/api/dist`
 * like every other Deck-E import. The root package does not depend on
 * `@deckpal/agent-tools`; importing it there resolves locally through hoisting
 * and fails in the deployed function (`scripts/check-functions.mjs`).
 */
export { checkDeck } from '@deckpal/agent-tools'
