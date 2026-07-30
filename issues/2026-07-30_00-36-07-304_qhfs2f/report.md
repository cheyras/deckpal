---
id: 2026-07-30_00-36-07-304_qhfs2f
status: resolved
createdAt: 2026-07-30T00:36:07.304Z
resolvedAt: 2026-07-30T01:04:54.070Z
resolution: Purchase Set now opens a preferences menu (goal complete/master/grandmaster + finish filter; condition/printing prefs are NOT link-encodable per TCGplayer Mass Entry docs, stated in the menu) and generates chunked TCGplayer Mass Entry cart deep links via the new GET /sets/:setId/massentry endpoint (apps/api/src/routes/massentry.ts), reused by the new rotom-mcp set_cart tool (apps/mcp/src/tools/shopping.ts); Shop keeps the set-search link. UI in apps/web/src/components/PurchaseSetMenu.tsx + SetHeader.tsx.
page: /pokedex/series/mega-evolution/me05
viewport: 428x781
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: screenshot.jpg
---

The shop and purchase set buttons currently do the same thing. What the purchase set should do is it should generate and link to a properly formatted deep link to TCG player that adds all of the cards that are needed to complete the set to the cart on pkmn.gg it also comes up with a little menu where you can put in preferences like which types of listings to include so you know are we including basic or like normal reverse hollow foil, hollow foil you know whatever variance are we including near meant lightly played moderately played heavily played whatever do research on this and get it right let’s make sure that it is forming these links properly. I’m thinking that we have the link generation be an API call because then we can give the MCP the same ability to be able to generate the deep link to tcgplayer.com. That actually creates the cart and that would give us the ability to gently plan out a purchase to complete a deck or whatever.
