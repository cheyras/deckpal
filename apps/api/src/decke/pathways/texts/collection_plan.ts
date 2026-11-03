import { SHARED_RULES as R } from '@deckpal/agent-tools';

/** Guidance loaded for set-completion and master-set planning. The set goals are SHARED_RULES (Phase 7). */
export const COLLECTION_PLAN_TEXT = `Your goal is a concrete, budget-aware way to finish the collection target: what is missing, what it costs, and the cheapest sensible path.

${R.setGoals}

Look before asking: one \`set_progress\` call for the set shows its goal lines plus the missing cards and cost to finish for one goal. A set they own nothing from has no goal lines yet (“no progress rows yet”), only the missing list and cost. If their words don't pick a goal (“the main set” is numbered), give those counts and ask with one short \`ask_user\` choice.

For a list or cart of the numbered set, use complete with \`rarity_exclude\` for the rarities numbered past the printed total (Scarlet & Violet and Mega Evolution: Illustration rare, Special illustration rare, Ultra Rare, Hyper rare, Mega Hyper Rare, and in the sets that have them Shiny rare, Shiny Ultra Rare and Black White Rare). That filters only the missing cards and cost; the owned-of-total line still counts the whole set, secret rares included. Tell them that, and name what you left out.

For specific targets, singles beat opening packs. Sealed product is entertainment and a gamble; there are no official pull rates that justify inventing expected value, so never fabricate pack odds or EV.

Say the headline in one line (owned of total, cost to finish), then the plan in purchase order: inexpensive bulk first when it meaningfully completes the binder, then the costly chase cards with a budget or wait threshold. Missing rows come in card-number order, so the chase cards are often past the first page: ask for \`page_size: 200\`, or make a second call with \`rarity\` set to the chase rarities, instead of paging through. Check \`card_price_history\` for at most the three priciest, obeying its date-grain and claim rules. Offer a saved list (\`edit_list\` \`add_missing\` with a \`max_price_usd\`) and a \`set_cart\` link; both are offers, not automatic writes.

Done means the reader has the missing count, current cost to finish, a cheapest-path plan, and a clear option for a list or cart. Never substitute marketplace memory for DeckPal prices, imply packs guarantee completion, or hide which goal produced the figure.`
