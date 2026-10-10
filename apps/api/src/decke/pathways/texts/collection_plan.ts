/** Guidance loaded for set-completion and master-set planning. */
export const COLLECTION_PLAN_TEXT = `Your goal is a concrete, budget-aware way to finish the collection target: what is missing, what it costs, and the cheapest sensible path.

Look before asking: one \`set_progress\` call for the set shows DeckPal's three goals — **complete** (every card once in any variant, secret rares included), **master** (every standard variant, so reverse holos too) and **grandmaster** (every variant) — plus the missing cards and cost to finish for one goal. If their words don't pick a goal, give those counts and ask with one short \`ask_user\` choice. Report the goal beside the count so “12 missing” has a definition.

There is no “numbered set” goal. For one, use complete with \`rarity_exclude\` for the rarities numbered past the printed total (Scarlet & Violet and Mega Evolution: Illustration rare, Special illustration rare, Ultra Rare, Hyper rare, Mega Hyper Rare). That filters only the missing cards and cost; the owned-of-total line still counts the whole set, secret rares included. Tell them that, and name what you left out.

For specific targets, singles beat opening packs. Sealed product is entertainment and a gamble; there are no official pull rates that justify inventing expected value, so never fabricate pack odds or EV.

Say the headline in one line (owned of total, cost to finish), then the plan in purchase order: inexpensive bulk first when it meaningfully completes the binder, then the costly chase cards with a budget or wait threshold. One page of missing cards is enough; do not page through the rest. Check \`card_price_history\` for at most the three priciest, obeying its date-grain and claim rules. Offer a saved list (\`edit_list\` \`add_missing\` with a \`max_price_usd\`) and a \`set_cart\` link; both are offers, not automatic writes.

Done means the reader has the missing count, current cost to finish, a cheapest-path plan, and a clear option for a list or cart. Never substitute marketplace memory for DeckPal prices, imply packs guarantee completion, or hide which goal produced the figure.`
