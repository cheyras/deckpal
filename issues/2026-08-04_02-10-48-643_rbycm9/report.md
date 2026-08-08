---
id: 2026-08-04_02-10-48-643_rbycm9
status: resolved
resolvedAt: 2026-08-08T02:00:00.000Z
resolution: Deck rows now open a deck-scoped card sheet. Rather than fork CardSheet, gave it an optional contextSlot rendered above the shared CardDetailBody (plus an ariaLabel), so the deck supplies its own framing and the card body stays one implementation. DeckCardContext leads with the art at a readable size (the ask — list thumbnails are 37px wide) then answers the deck-only questions: copies run with a live stepper, owned-vs-needed, shortfall, and deck cost (unit price x copies), with a warning strip when the card is what makes the deck illegal. Driven by ?card= on the deck route (deckSearch.ts) exactly like the set page, so opening/closing never unmounts DeckBuilder and scroll/filter/tab state survives; the card resolves from live deck data so the sheet updates as +/- mutations settle. The row's identity area is the tap target — the +/-/x steppers keep their own hit boxes. Verified in-browser at 390px and 1440px against the deployed build, zero console errors.
createdAt: 2026-08-04T02:10:48.643Z
page: /pokedex/decks/7100c2d9-68a6-4ebc-a607-ce79cce255ef
viewport: 428x926
userAgent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1
screenshot: screenshot.jpg
---

On this page I’d like to be able to open a card detail bottom sheet - not the exact same as what we have elsewhere but one that is obviously scoped to information relative to the card in the context of the deck. But it would be good to have it so I can see details about the card since the thumbnails are so small here.
