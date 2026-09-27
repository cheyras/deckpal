---
date: "2026-08-08"
title: "the header search was never wired; a deck card sheet that knows it's in a deck"
decided_by: "Not recorded"
areas: ["decks","catalog"]
supersedes: []
---
## 2026-08-08 — the header search was never wired; a deck card sheet that knows it's in a deck

Two in-app bug reports, both closed on `main` and deployed.

**The search button did nothing because there was nowhere to go.** `AppShell`'s header
carried a `<button aria-label="Search">` with **no `onClick`** and an `<input type="search">`
with **no `value`/`onChange`/submit** — a static mockup, dead on every page, not just the
`me05` set page the report came from. The deeper gap: the API has shipped a full 12-filter
`GET /deckpal/api/search` for a long time, and `api.searchCards()` was already used by the
deck builder and list modals, but **the SPA had no search route at all**. Added `/search`
(`routes/SearchResults.tsx` + `routes/globalSearch.ts`, registered in `main.tsx`) holding
`q/sort/dir/page` in the URL per the FRONTEND §A.5 idiom, and pointed the header at it —
desktop submits on Enter, the mobile circular button is now a `<Link>`.

One thing the search API could not do: **route a result**. It selected `ser.tcgdex_id`
purely to build cache paths (`cardImages(serie, …)`) and never exposed it, but card links
need the series **slug** (`/series/mega-evolution/me05`, not `me`). Added
`series: {slug, name}` to each search card. Everything else was reuse — `GridView` and
`CardTile` already support per-card `seriesSlug`/`setId` because list pages span many sets,
so cross-set results route correctly with no view changes.

**Also removed the `sliders` icon** from the header field. It was the same class of defect as
the reported one — a filter affordance with no handler and no filter UI behind it. An honest
blank beats a control that lies about what it does; the API's filter vocabularies are still
there when someone builds the panel.

**The deck sheet was composed, not forked.** The report asked for a card sheet on the deck
page that is "obviously scoped to the card in the context of the deck" — the list thumbnails
are 37px wide and unreadable. Rather than clone `CardSheet`, gave it an optional
`contextSlot` rendered above the shared `CardDetailBody`. `DeckCardContext` leads with the
art at a readable size, then answers the questions that only exist *inside a deck*: copies
run (with a live stepper wired to the same mutation as the row), owned-vs-needed, shortfall,
and deck cost (unit x copies), plus a warning strip when this card is what makes the deck
illegal. Driven by `?card=` on the deck route exactly like the set page, so opening and
closing never unmounts `DeckBuilder` — scroll, filters and tab survive — and the card
resolves from live deck data so the panel updates as `+`/`-` mutations settle.

**Gotcha for the next person:** search results legitimately show `—` for price. Promo sets
(`smp`) and TCG Pocket (`A3b`) have no `price_current` row for their primary variant. That is
missing upstream data, not a mapping bug — verified against the endpoint before believing the UI.

Verified in a real browser at 390px and 1440px, first on a main-tree dev server (:5199) and
then against the deployed build, zero console errors in both. Deployed: API rebuilt and
restarted (additive `series` field), web rebuilt.

